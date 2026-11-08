import type { Db } from '../db/client';
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { PILOT_LIMITS } from './limits';
import { assertSeatCapacity } from './entitlements';
import { normalizeAccountEmail } from './identity-email';
import type { MemberInvite, ReceivedInvite } from './member-invites-types';

type Row = { id: string; organization_id: string; project_id: string; masked_email: string; role: MemberInvite['role']; state: MemberInvite['state']; invited_by: string; created_at: string; expires_at: string; decided_at: string | null };
const DAY = 86400000, INVITE_DAYS = 14, OPEN_INVITES = 20, ROLES = ['admin', 'editor', 'analyst', 'viewer'] as const;
export const inviteEmailHash = (email: string) => createHash('sha256').update(`ryzevo-member-invite:${email}`).digest('hex');
const mask = (email: string) => { const [name, domain] = email.split('@'); return `${name.slice(0, 1)}***@${domain}`; };
const audit = async (db: Db, actor: string, organizationId: string, projectId: string, operation: string) => await db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(actor, organizationId, projectId, operation, new Date().toISOString());
const verifiedEmail = async (db: Db, userId: string) => {
  const email = (await db.prepare('SELECT email FROM platform_account_emails WHERE user_id=?').get(userId) as { email: string } | undefined)?.email;
  try { return email ? normalizeAccountEmail(email) : null; } catch { return null; }
};

// A project's side: owners and admins invite an existing account by its verified email. The answer never says whether
// such an account exists; the invitee sees the invitation in their own portfolio and accepts it there.
export class MemberInvites {
  private repo: PlatformRepository;
  constructor(private db: Db, private scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private async authorize() {
    if (!await this.repo.can(this.scope.subject, ...this.args(), 'members.manage') || (await this.repo.workspace(this.scope.subject, ...this.args()))?.project.productPack !== 'standard') throw new MarketingStoreError('Davetleri yalnız ekip yöneticileri yönetebilir.', 403);
  }
  private async role() { return (await this.db.prepare('SELECT role FROM platform_memberships WHERE user_id=? AND organization_id=? AND project_id=?').get(this.scope.subject, ...this.args()) as { role: string } | undefined)?.role; }
  async list(): Promise<MemberInvite[]> {
    await this.authorize();
    return (await this.db.prepare('SELECT * FROM platform_member_invites WHERE organization_id=? AND project_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 50').all(...this.args(), new Date(Date.now() - 30 * DAY).toISOString()) as Row[])
      .map(row => ({ id: row.id, maskedEmail: row.masked_email, role: row.role, state: row.state === 'pending' && row.expires_at <= new Date().toISOString() ? 'expired' : row.state, createdAt: row.created_at, expiresAt: row.expires_at, decidedAt: row.decided_at }));
  }
  async invite(raw: Record<string, unknown>) {
    await this.authorize();
    if (Object.keys(raw).some(key => !['action', 'email', 'role'].includes(key)) || !(ROLES as readonly unknown[]).includes(raw.role)) throw new MarketingStoreError('Geçerli bir e-posta ve rol seçin.');
    let email: string;
    try { email = normalizeAccountEmail(raw.email); } catch { throw new MarketingStoreError('Geçerli bir e-posta ve rol seçin.'); }
    const role = raw.role as MemberInvite['role'], hash = inviteEmailHash(email);
    await this.db.transaction(async () => {
      await this.authorize();
      if (role === 'admin' && await this.role() !== 'owner') throw new MarketingStoreError('Yönetici rolüyle yalnız proje sahibi davet edebilir.', 403);
      const now = new Date().toISOString();
      await this.db.prepare("UPDATE platform_member_invites SET state='revoked',decided_at=? WHERE organization_id=? AND project_id=? AND state='pending' AND expires_at<=?").run(now, ...this.args(), now);
      const member = await this.db.prepare('SELECT 1 FROM platform_account_emails e JOIN platform_memberships m ON m.user_id=e.user_id WHERE lower(trim(e.email))=? AND m.organization_id=? AND m.project_id=? AND m.active=1').get(email, ...this.args());
      if (member) throw new MarketingStoreError('Bu kişi zaten projenin ekibinde.', 409);
      if (await this.db.prepare("SELECT 1 FROM platform_member_invites WHERE project_id=? AND email_hash=? AND state='pending'").get(this.scope.projectId, hash)) throw new MarketingStoreError('Bu e-postaya açık bir davet zaten var.', 409);
      if ((await this.db.prepare("SELECT COUNT(*) n FROM platform_member_invites WHERE organization_id=? AND project_id=? AND state='pending'").get(...this.args()) as { n: number }).n >= OPEN_INVITES) throw new MarketingStoreError(`En fazla ${OPEN_INVITES} açık davet olabilir.`, 429);
      await this.db.prepare("INSERT INTO platform_member_invites(id,organization_id,project_id,email_hash,masked_email,role,state,invited_by,created_at,expires_at) VALUES(?,?,?,?,?,?,'pending',?,?,?)").run(`invite_${randomUUID()}`, ...this.args(), hash, mask(email), role, this.scope.subject, now, new Date(Date.now() + INVITE_DAYS * DAY).toISOString());
      await audit(this.db, this.scope.subject, ...this.args(), 'membership.invite');
    });
    return await this.list();
  }
  async revoke(raw: Record<string, unknown>) {
    await this.authorize();
    const changed = (await this.db.prepare("UPDATE platform_member_invites SET state='revoked',decided_at=? WHERE id=? AND organization_id=? AND project_id=? AND state='pending'").run(new Date().toISOString(), raw.id, ...this.args())).changes;
    if (!changed) throw new MarketingStoreError('Açık davet bulunamadı.', 404);
    await audit(this.db, this.scope.subject, ...this.args(), 'membership.invite.revoke');
    return await this.list();
  }
}

// The invitee's side: open invitations addressed to the account's verified email.
export async function receivedInvites(db: Db, userId: string): Promise<ReceivedInvite[]> {
  const email = await verifiedEmail(db, userId);
  if (!email) return [];
  return (await db.prepare("SELECT i.id,i.role,i.expires_at,p.name AS project_name,o.name AS organization_name,u.username AS invited_by FROM platform_member_invites i JOIN platform_projects p ON p.id=i.project_id AND p.organization_id=i.organization_id JOIN platform_organizations o ON o.id=i.organization_id JOIN platform_users u ON u.id=i.invited_by WHERE i.email_hash=? AND i.state='pending' AND i.expires_at>? AND p.product_pack='standard' AND NOT EXISTS(SELECT 1 FROM platform_memberships m WHERE m.user_id=? AND m.project_id=i.project_id AND m.active=1) ORDER BY i.created_at LIMIT 20")
    .all(inviteEmailHash(email), new Date().toISOString(), userId) as { id: string; role: ReceivedInvite['role']; expires_at: string; project_name: string; organization_name: string; invited_by: string }[])
    .map(row => ({ id: row.id, projectName: row.project_name, organizationName: row.organization_name, role: row.role, invitedBy: row.invited_by, expiresAt: row.expires_at }));
}
// Accepting adds the membership with the invited role, inside the project's team and seat limits; the inviter's rights
// are checked again, so an invitation from someone who lost them no longer works.
export async function decideInvite(db: Db, userId: string, raw: Record<string, unknown>) {
  if (typeof raw.id !== 'string' || !['accept', 'decline'].includes(raw.decision as string)) throw new MarketingStoreError('Geçersiz davet işlemi.');
  return await db.transaction(async () => {
    const email = await verifiedEmail(db, userId), now = new Date().toISOString();
    const row = email ? await db.prepare("SELECT * FROM platform_member_invites WHERE id=? AND email_hash=? AND state='pending' AND expires_at>?").get(raw.id, inviteEmailHash(email), now) as Row | undefined : undefined;
    if (!row) throw new MarketingStoreError('Davet bulunamadı, süresi doldu veya geri alındı.', 404);
    const repo = new PlatformRepository(db);
    if (raw.decision === 'decline') { await db.prepare("UPDATE platform_member_invites SET state='declined',decided_at=? WHERE id=?").run(now, row.id); await audit(db, userId, row.organization_id, row.project_id, 'membership.invite.decline'); return { organizationId: row.organization_id, projectId: row.project_id, accepted: false }; }
    const inviter = await db.prepare('SELECT role FROM platform_memberships WHERE user_id=? AND organization_id=? AND project_id=? AND active=1').get(row.invited_by, row.organization_id, row.project_id) as { role: string } | undefined;
    if (!await repo.can(row.invited_by, row.organization_id, row.project_id, 'members.manage') || row.role === 'admin' && inviter?.role !== 'owner' || (await repo.workspace(row.invited_by, row.organization_id, row.project_id))?.project.productPack !== 'standard') throw new MarketingStoreError('Davet artık geçerli değil. Proje sahibinden yeni davet isteyin.', 409);
    const existing = await db.prepare('SELECT active FROM platform_memberships WHERE user_id=? AND project_id=?').get(userId, row.project_id) as { active: number } | undefined;
    if (!existing && (await db.prepare('SELECT COUNT(*) AS n FROM platform_memberships WHERE organization_id=? AND project_id=?').get(row.organization_id, row.project_id) as { n: number }).n >= PILOT_LIMITS.members) throw new MarketingStoreError('Projenin ekip sınırı dolu.', 429);
    await assertSeatCapacity(db, { organizationId: row.organization_id, projectId: row.project_id });
    if (existing) await db.prepare('UPDATE platform_memberships SET role=?,active=1 WHERE user_id=? AND project_id=?').run(row.role, userId, row.project_id);
    else await db.prepare('INSERT INTO platform_memberships VALUES(?,?,?,?,1)').run(userId, row.organization_id, row.project_id, row.role);
    await db.prepare("UPDATE platform_member_invites SET state='accepted',decided_at=?,accepted_user_id=? WHERE id=?").run(now, userId, row.id);
    await audit(db, userId, row.organization_id, row.project_id, 'membership.invite.accept');
    return { organizationId: row.organization_id, projectId: row.project_id, accepted: true };
  });
}
