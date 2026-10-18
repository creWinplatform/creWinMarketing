import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository, passwordHash } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import type { WorkspaceRole } from './access';

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function consumeLoginAttempt(db: Database.Database, username: string) {
  const key = digest(username.trim().toLowerCase()),
    now = Date.now();
  return db.transaction(() => {
    db.prepare('DELETE FROM platform_login_limits WHERE expires_at<=?').run(now);
    const bucket = 'global:' + Math.floor(now / 60000),
      global = db
        .prepare('SELECT count FROM platform_login_limits WHERE key=?')
        .get(bucket) as { count: number } | undefined;
    if ((global?.count || 0) >= 300) return false;
    db.prepare(
      'INSERT INTO platform_login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',
    ).run(bucket, now + 60000);
    const row = db
      .prepare('SELECT count FROM platform_login_limits WHERE key=?')
      .get(key) as { count: number } | undefined;
    if ((row?.count || 0) >= 20) return false;
    db.prepare(
      'INSERT INTO platform_login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',
    ).run(key, now + 15 * 60000);
    return true;
  }).immediate();
}
export function securityVersion(db: Database.Database, userId: string) {
  return (
    (
      db
        .prepare('SELECT version FROM platform_user_security WHERE user_id=?')
        .get(userId) as { version: number } | undefined
    )?.version || 0
  );
}

// Trusted password-change/reset path only; already submitted work cannot be recalled.
export function invalidateAccountAccess(db:Database.Database,userId:string){
  db.transaction(()=>{
    const now=new Date().toISOString();
    db.prepare('INSERT INTO platform_user_security VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET version=version+1').run(userId);
    db.prepare('DELETE FROM platform_oauth_requests WHERE actor_id=?').run(userId);
    db.prepare('DELETE FROM platform_social_publish_checks WHERE manager_id=?').run(userId);
    db.prepare("UPDATE platform_identity_challenges SET used_at=?,encrypted_delivery='' WHERE user_id=? AND used_at IS NULL").run(Date.now(),userId);
    db.prepare("UPDATE platform_social_publications SET state='blocked',reason='changed' WHERE submitted_at IS NULL AND job_id IN (SELECT id FROM platform_jobs WHERE actor_id=? AND status IN ('queued','running'))").run(userId);
    db.prepare("UPDATE platform_email_pilot_recipients SET state=CASE WHEN state IN ('checking','submitting') THEN 'uncertain' ELSE 'cancelled' END,reason=CASE WHEN state IN ('checking','submitting') THEN 'interrupted' ELSE 'cancelled' END,updated_at=? WHERE state IN ('queued','checking','submitting') AND job_id IN (SELECT id FROM platform_jobs WHERE actor_id=? AND status IN ('queued','running') AND job_type='email.pilot_send')").run(now,userId);
    db.prepare("UPDATE platform_email_pilots SET outcome='cancelled' WHERE job_id IN (SELECT id FROM platform_jobs WHERE actor_id=? AND status IN ('queued','running') AND job_type='email.pilot_send')").run(userId);
    db.prepare("UPDATE platform_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE actor_id=? AND status IN ('queued','running') AND (job_type='email.pilot_send' OR job_type='social.publish' AND id IN (SELECT job_id FROM platform_social_publications WHERE submitted_at IS NULL))").run(now,userId);
    db.prepare("INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) SELECT user_id,organization_id,project_id,'account.credentials_changed',? FROM platform_memberships WHERE user_id=? AND active=1").run(now,userId);
  }).immediate();
}

export class PlatformAccounts {
  private repository: PlatformRepository;
  constructor(private db: Database.Database) {
    this.repository = new PlatformRepository(db);
  }
  invitation(token: string) {
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token))
      throw new MarketingStoreError('Davet geçersiz veya süresi dolmuş.');
    const row = this.db
      .prepare(
        'SELECT username,organization_id,project_id,issuer_id FROM platform_enrollments WHERE token_hash=? AND used_at IS NULL AND expires_at>?',
      )
      .get(digest(token), new Date().toISOString()) as
      | {
          username: string;
          organization_id: string | null;
          project_id: string | null;
          issuer_id: string;
        }
      | undefined;
    if (
      !row ||
      !this.repository.can(
        row.issuer_id,
        row.organization_id || 'crewin',
        row.project_id || 'crewinjob',
        'members.manage',
      )
    )
      throw new MarketingStoreError('Davet geçersiz veya süresi dolmuş.');
    return { username: row.username, newOrganization: !row.organization_id };
  }
  invite(
    scope: MarketingScope,
    input: { username: string; role: WorkspaceRole; newOrganization?: boolean },
  ) {
    if (
      !this.repository.can(
        scope.subject,
        scope.organizationId,
        scope.projectId,
        'members.manage',
      )
    )
      throw new MarketingStoreError('Ekip yönetimi yetkisi gerekli.', 403);
    if (
      !['admin', 'editor', 'analyst', 'viewer'].includes(input.role) ||
      typeof input.username !== 'string' ||
      !/^[a-zA-Z0-9@._+-]{3,160}$/.test(input.username)
    )
      throw new MarketingStoreError('Geçerli kullanıcı adı ve rol seçin.');
    if (input.newOrganization && scope.subject !== 'legacy-admin')
      throw new MarketingStoreError(
        'Yeni organizasyon daveti yalnız platform yöneticisine açıktır.',
        403,
      );
    if (
      this.db
        .prepare('SELECT id FROM platform_users WHERE username=?')
        .get(input.username)
    )
      throw new MarketingStoreError(
        'Bu kullanıcı mevcut. Yeni hesap için farklı kullanıcı adı seçin.',
        409,
      );
    const token = randomBytes(32).toString('base64url'),
      expiresAt = new Date(Date.now() + 48 * 3600000).toISOString();
    this.db
      .prepare(
        'DELETE FROM platform_enrollments WHERE issuer_id=? AND username=? AND used_at IS NULL',
      )
      .run(scope.subject, input.username);
    this.db
      .prepare('INSERT INTO platform_enrollments VALUES(?,?,?,?,?,?,?,NULL)')
      .run(
        digest(token),
        scope.subject,
        input.newOrganization ? null : scope.organizationId,
        input.newOrganization ? null : scope.projectId,
        input.username,
        input.newOrganization ? 'owner' : input.role,
        expiresAt,
      );
    return { token, expiresAt };
  }
  redeem(
    token: string,
    input: {
      password: string;
      organizationName: string;
      projectName: string;
      website: string;
      timezone?: string;
    },
  ) {
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token))
      throw new MarketingStoreError('Davet geçersiz veya süresi dolmuş.');
    return this.db.transaction(() => {
      const row = this.db
        .prepare(
          'SELECT * FROM platform_enrollments WHERE token_hash=? AND used_at IS NULL AND expires_at>?',
        )
        .get(digest(token), new Date().toISOString()) as
        | {
            issuer_id: string;
            organization_id: string | null;
            project_id: string | null;
            username: string;
            role: WorkspaceRole;
          }
        | undefined;
      if (!row)
        throw new MarketingStoreError('Davet geçersiz veya süresi dolmuş.');
      let userId: string;
      if (row.organization_id && row.project_id)
        userId = this.repository.addMember(
          row.issuer_id,
          row.organization_id,
          row.project_id,
          { username: row.username, password: input.password, role: row.role },
        ).userId;
      else
        userId = this.repository.provision(row.issuer_id, {
          ...input,
          username: row.username,
        }).userId;
      this.db
        .prepare(
          'UPDATE platform_enrollments SET used_at=? WHERE token_hash=? AND used_at IS NULL',
        )
        .run(new Date().toISOString(), digest(token));
      return { userId };
    })();
  }
  changePassword(
    scope: MarketingScope,
    currentPassword: string,
    nextPassword: string,
  ) {
    if (
      !this.repository.can(
        scope.subject,
        scope.organizationId,
        scope.projectId,
        'read',
      )
    )
      throw new MarketingStoreError('Erişim reddedildi.', 403);
    const user = this.db
      .prepare(
        "SELECT username FROM platform_users WHERE id=? AND kind='platform'",
      )
      .get(scope.subject) as { username: string } | undefined;
    if (
      !user ||
      typeof currentPassword !== 'string' ||
      !this.repository.authenticate(user.username, currentPassword)
    )
      throw new MarketingStoreError('Mevcut şifre hatalı.');
    const hash = passwordHash(nextPassword);
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE platform_users SET password_hash=? WHERE id=?')
        .run(hash, scope.subject);
      invalidateAccountAccess(this.db,scope.subject);
    })();
  }
}
