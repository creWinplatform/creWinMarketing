import 'server-only';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { CREWIN_PROJECT, modulesForProject, type GoalDefinition, type ProjectProfile, type WorkspaceContext } from './catalog';
import { hasWorkspacePermission, type WorkspacePermission, type WorkspaceRole } from './access';
import { PILOT_LIMITS } from './limits';
import { assertSeatCapacity,projectEntitlement,TRIAL_DAYS } from './entitlements';

type UserRow = { id: string; username: string; password_hash: string | null; active: number; kind: string };
type MembershipRow = { user_id: string; organization_id: string; project_id: string; role: WorkspaceRole; active: number };
type ProjectRow = { id: string; organization_id: string; name: string; website: string; timezone: string; product_pack: 'crewin' | 'standard'; enabled_modules: string; organization_name: string; goals?: string; brand_voice?: string; language?: 'tr' | 'en' };
const now = () => new Date().toISOString();
export const passwordHash = (password: string) => {
  if (password.length < 12 || password.length > 256) throw new Error('Password must contain 12 to 256 characters.');
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
};
const ROLES: WorkspaceRole[] = ['owner', 'admin', 'editor', 'analyst', 'viewer'];

export class PlatformRepository {
  constructor(private db: Database.Database) {}

  bootstrapLegacy(username: string) {
    if (!username) throw new Error('Legacy administrator is not configured.');
    this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO platform_organizations VALUES(?,?,?)').run('crewin', 'Crewin', now());
      this.db.prepare('INSERT OR IGNORE INTO platform_projects VALUES(?,?,?,?,?,?,?)').run('crewinjob', 'crewin', CREWIN_PROJECT.name, CREWIN_PROJECT.website, CREWIN_PROJECT.timezone, 'crewin', JSON.stringify(CREWIN_PROJECT.enabledModules));
      const existing = this.db.prepare('SELECT id FROM platform_users WHERE username = ?').get(username) as { id: string } | undefined;
      if (existing && existing.id !== 'legacy-admin') throw new Error('Administrator username conflicts with a platform user.');
      this.db.prepare(`INSERT INTO platform_users(id,username,password_hash,active,kind,created_at) VALUES(?,?,NULL,1,'legacy_admin',?)
        ON CONFLICT(id) DO UPDATE SET username=excluded.username`).run('legacy-admin', username, now());
      this.db.prepare('INSERT OR IGNORE INTO platform_memberships VALUES(?,?,?,?,1)').run('legacy-admin', 'crewin', 'crewinjob', 'owner');
    })();
  }

  authenticate(username: string, password: string): UserRow | null {
    const user = this.db.prepare('SELECT * FROM platform_users WHERE username = ? AND kind = ?').get(username, 'platform') as UserRow | undefined;
    const hash = user?.password_hash;
    const [, salt, digest] = (hash || 'scrypt:invalid:').split(':');
    const computed = scryptSync(password.slice(0, 256), salt, 64);
    const expected = digest && /^[a-f0-9]{128}$/.test(digest) ? Buffer.from(digest, 'hex') : Buffer.alloc(64);
    const valid = timingSafeEqual(computed, expected);
    return valid && user?.active === 1 && password.length <= 256 ? user : null;
  }

  can(subject: string, organizationId: string, projectId: string, permission: WorkspacePermission) {
    const user = this.db.prepare('SELECT active FROM platform_users WHERE id = ?').get(subject) as { active: number } | undefined;
    if (user?.active !== 1) return false;
    const rows = this.db.prepare('SELECT * FROM platform_memberships WHERE user_id = ?').all(subject) as MembershipRow[];
    return hasWorkspacePermission(rows.map(row => ({ subject: row.user_id, organizationId: row.organization_id, projectIds: [row.project_id], role: row.role, active: row.active === 1 })), subject, organizationId, projectId, permission);
  }

  workspaces(subject: string) {
    const rows = this.db.prepare(`SELECT p.*,o.name AS organization_name,s.goals,s.brand_voice,s.language FROM platform_projects p
      JOIN platform_organizations o ON o.id=p.organization_id
      JOIN platform_memberships m ON m.project_id=p.id AND m.organization_id=p.organization_id
      JOIN platform_users u ON u.id=m.user_id
      LEFT JOIN platform_project_settings s ON s.project_id=p.id AND s.organization_id=p.organization_id
      WHERE m.user_id=? AND m.active=1 AND u.active=1 ORDER BY o.name,p.name`).all(subject) as ProjectRow[];
    const permissions: WorkspacePermission[] = ['read', 'content.write', 'campaign.approve', 'campaign.dispatch', 'connections.manage', 'members.manage', 'recipients.manage', 'billing.manage'];
    return rows.map(row => ({ ...this.profile(row), permissions: permissions.filter(permission => this.can(subject, row.organization_id, row.id, permission)) }));
  }

  workspace(subject: string, organizationId: string, projectId: string): WorkspaceContext | null {
    if (!this.can(subject, organizationId, projectId, 'read')) return null;
    return this.workspaces(subject).find(workspace => workspace.project.id === projectId && workspace.organization.id === organizationId) || null;
  }

  private profile(row: ProjectRow): WorkspaceContext {
    const enabledModules = JSON.parse(row.enabled_modules) as ProjectProfile['enabledModules'];
    const project: ProjectProfile = { id: row.id, organizationId: row.organization_id, name: row.name, website: row.website,
      timezone: row.timezone, productPack: row.product_pack, enabledModules,
      goals: row.goals ? JSON.parse(row.goals) : row.product_pack === 'crewin' ? structuredClone(CREWIN_PROJECT.goals) : [],
      language: row.language || 'tr', brandVoice: row.brand_voice || '' };
    const rights=row.product_pack==='standard'?projectEntitlement(this.db,{organizationId:row.organization_id,projectId:row.id}):null;
    return { organization: { id: row.organization_id, name: row.organization_name }, project,
      ...(rights?{plan:{id:rights.id,active:rights.active,endsAt:rights.endsAt,...('inGrace' in rights?{inGrace:rights.inGrace}:{})}}:{}),
      modules: modulesForProject(project.productPack, enabledModules), accessMode: 'platform_account' };
  }

  provision(actor: string, input: { organizationName: string; projectName: string; website: string; username: string; password: string; timezone?: string }) {
    // Bootstrap provisioning is restricted to the persisted legacy deployment owner.
    if (actor !== 'legacy-admin' || !this.can(actor, 'crewin', 'crewinjob', 'members.manage')) throw new Error('Access denied.');
    return insertStandardWorkspace(this.db, actor, input);
  }

  members(actor: string, organizationId: string, projectId: string) {
    if (!this.can(actor, organizationId, projectId, 'members.manage')) throw new Error('Access denied.');
    return this.db.prepare(`SELECT u.id,u.username,m.role,m.active FROM platform_memberships m
      JOIN platform_users u ON u.id=m.user_id WHERE m.organization_id=? AND m.project_id=?`).all(organizationId, projectId);
  }

  addMember(actor: string, organizationId: string, projectId: string, input: { username: string; password: string; role: WorkspaceRole }) {
    if (!ROLES.includes(input.role) || typeof input.username !== 'string' || !input.username.trim() || input.username.length > 160) throw new Error('Invalid member.');
    const hash = passwordHash(input.password);
    const userId = randomUUID();
    this.db.transaction(() => {
      if (!this.can(actor, organizationId, projectId, 'members.manage')) throw new Error('Access denied.');
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM platform_memberships WHERE organization_id=? AND project_id=?').get(organizationId,projectId) as {n:number};
      if(count.n>=PILOT_LIMITS.members) throw new Error('Pilot team limit reached.');
      assertSeatCapacity(this.db,{organizationId,projectId});
      const membership = this.db.prepare('SELECT role FROM platform_memberships WHERE user_id=? AND organization_id=? AND project_id=?').get(actor, organizationId, projectId) as { role: WorkspaceRole };
      if (input.role === 'owner' && membership.role !== 'owner') throw new Error('Only owners can manage owners.');
      this.db.prepare('INSERT INTO platform_users VALUES(?,?,?,?,?,?)').run(userId, input.username.trim(), hash, 1, 'platform', now());
      this.db.prepare('INSERT INTO platform_memberships VALUES(?,?,?,?,1)').run(userId, organizationId, projectId, input.role);
      this.audit(actor, organizationId, projectId, 'membership.create');
    })();
    return { userId };
  }

  updateMember(actor: string, organizationId: string, projectId: string, userId: string, role: WorkspaceRole, active: boolean) {
    if (!ROLES.includes(role) || typeof active !== 'boolean') throw new Error('Invalid membership.');
    this.db.transaction(() => {
      if (!this.can(actor, organizationId, projectId, 'members.manage')) throw new Error('Access denied.');
      const actorMembership = this.db.prepare('SELECT role FROM platform_memberships WHERE user_id=? AND project_id=? AND organization_id=?').get(actor, projectId, organizationId) as { role: WorkspaceRole };
      const member = this.db.prepare('SELECT * FROM platform_memberships WHERE user_id=? AND organization_id=? AND project_id=?').get(userId, organizationId, projectId) as MembershipRow | undefined;
      if (!member) throw new Error('Membership not found.');
      if(active && member.active!==1)assertSeatCapacity(this.db,{organizationId,projectId});
      if (actorMembership.role !== 'owner' && (member.role === 'owner' || role === 'owner')) throw new Error('Only owners can manage owners.');
      if (member.role === 'owner' && member.active === 1 && (!active || role !== 'owner')) {
        const owners = this.db.prepare("SELECT COUNT(*) AS count FROM platform_memberships WHERE organization_id=? AND project_id=? AND active=1 AND role='owner'").get(organizationId, projectId) as { count: number };
        if (owners.count <= 1) throw new Error('Cannot remove the last owner.');
      }
      this.db.prepare('UPDATE platform_memberships SET role=?,active=? WHERE user_id=? AND organization_id=? AND project_id=?').run(role, Number(active), userId, organizationId, projectId);
      if(!this.can(userId,organizationId,projectId,'connections.manage'))this.db.prepare('UPDATE platform_product_sources SET enabled=0,paused=1,event_coverage_from=NULL WHERE organization_id=? AND project_id=? AND webhook_actor_id=?').run(organizationId,projectId,userId);
      if(!this.can(userId,organizationId,projectId,'connections.manage'))this.db.prepare('UPDATE platform_measurement_bindings SET enabled=0,next_sync_at=NULL,version=version+1 WHERE organization_id=? AND project_id=? AND manager_id=?').run(organizationId,projectId,userId);
      if(!this.can(userId,organizationId,projectId,'connections.manage'))this.db.prepare('DELETE FROM platform_social_publish_checks WHERE organization_id=? AND project_id=? AND manager_id=?').run(organizationId,projectId,userId);
      if(!this.can(userId,organizationId,projectId,'campaign.approve')||!this.can(userId,organizationId,projectId,'campaign.dispatch')||!this.can(userId,organizationId,projectId,'connections.manage')){
        this.db.prepare("UPDATE platform_social_publications SET state='blocked',reason='changed' WHERE organization_id=? AND project_id=? AND submitted_at IS NULL AND job_id IN (SELECT id FROM platform_jobs WHERE actor_id=? AND status IN ('queued','running'))").run(organizationId,projectId,userId);
        this.db.prepare("UPDATE platform_jobs SET status='failed',lease_token=NULL,lease_until=NULL,updated_at=? WHERE organization_id=? AND project_id=? AND actor_id=? AND status IN ('queued','running') AND id IN (SELECT job_id FROM platform_social_publications WHERE state='blocked' AND submitted_at IS NULL)").run(now(),organizationId,projectId,userId);
      }
      if(!this.can(userId,organizationId,projectId,'campaign.approve')){
        const approvals=this.db.prepare(`SELECT r.* FROM platform_campaign_reviews r WHERE r.organization_id=? AND r.project_id=? AND r.actor_id=? AND r.decision='approved' AND r.id=(SELECT MAX(newer.id) FROM platform_campaign_reviews newer WHERE newer.organization_id=r.organization_id AND newer.project_id=r.project_id AND newer.campaign_id=r.campaign_id)`).all(organizationId,projectId,userId) as {campaign_id:string;content_digest:string;data_revision:string}[];
        for(const approval of approvals)this.db.prepare("INSERT INTO platform_campaign_reviews(organization_id,project_id,campaign_id,content_digest,data_revision,decision,note,actor_id,created_at) VALUES(?,?,?,?,?,'revoked',?,?,?)").run(organizationId,projectId,approval.campaign_id,approval.content_digest,approval.data_revision,'Onaylayan kişinin proje onay yetkisi kaldırıldı.',actor,now());
      }
      if(!this.can(userId,organizationId,projectId,'recipients.manage')){
        const consents=this.db.prepare(`SELECT c.contact_key FROM platform_email_consents c WHERE c.organization_id=? AND c.project_id=? AND c.actor_id=? AND c.decision='reviewed' AND c.id=(SELECT MAX(n.id) FROM platform_email_consents n WHERE n.organization_id=c.organization_id AND n.project_id=c.project_id AND n.contact_key=c.contact_key)`).all(organizationId,projectId,userId) as {contact_key:string}[];
        for(const consent of consents)this.db.prepare("INSERT INTO platform_email_consents(organization_id,project_id,contact_key,decision,encrypted_evidence,actor_id,created_at) VALUES(?,?,?,'revoked','',?,?)").run(organizationId,projectId,consent.contact_key,actor,now());
        if(consents.length)this.db.prepare('INSERT INTO platform_email_state VALUES(?,?,1) ON CONFLICT(organization_id,project_id) DO UPDATE SET revision=revision+1').run(organizationId,projectId);
      }
      if(!this.can(userId,organizationId,projectId,'recipients.manage')||!this.can(userId,organizationId,projectId,'connections.manage')){
        const sender=this.db.prepare("UPDATE platform_email_sender SET verified_at=NULL,challenge_hash='',encrypted_challenge='',revision=revision+1,updated_at=? WHERE organization_id=? AND project_id=? AND manager_id=?").run(now(),organizationId,projectId,userId).changes;
        const pilot=this.db.prepare('UPDATE platform_email_pilot_allowlist SET active=0,updated_at=? WHERE organization_id=? AND project_id=? AND granted_by=? AND active=1').run(now(),organizationId,projectId,userId).changes;
        this.db.prepare("UPDATE platform_email_ses SET checked_at=NULL,proof_json=NULL,feedback_observed_at=NULL,revision=revision+1 WHERE organization_id=? AND project_id=? AND manager_id=?").run(organizationId,projectId,userId);
        if(pilot)this.db.prepare('UPDATE platform_email_sender SET revision=revision+1,updated_at=? WHERE organization_id=? AND project_id=?').run(now(),organizationId,projectId);
        if(sender||pilot)this.db.prepare('INSERT INTO platform_email_state VALUES(?,?,1) ON CONFLICT(organization_id,project_id) DO UPDATE SET revision=revision+1').run(organizationId,projectId);
      }
      this.audit(actor, organizationId, projectId, 'membership.update');
    })();
  }

  updateProject(actor: string, organizationId: string, projectId: string, input: { name: string; website: string; timezone: string; language: string; brandVoice: string; goals: GoalDefinition[] }) {
    this.db.transaction(() => {
      if (!this.can(actor, organizationId, projectId, 'connections.manage')) throw new Error('Access denied.');
      const current = this.workspace(actor, organizationId, projectId);
      if (!current || current.project.productPack !== 'standard') throw new Error('Legacy project configuration is managed by its existing adapter.');
      if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160 || typeof input.brandVoice !== 'string' || input.brandVoice.length > 2000 || !['tr', 'en'].includes(input.language)) throw new Error('Invalid project settings.');
      const website = new URL(input.website);
      if (!['https:', 'http:'].includes(website.protocol) || website.username || website.password) throw new Error('Invalid website.');
      new Intl.DateTimeFormat('en', { timeZone: input.timezone });
      const localized = (value: unknown) => {
        const text = value as { tr?: unknown; en?: unknown };
        if (!text || ![text.tr, text.en].every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 200)) throw new Error('Invalid goal text.');
        return { tr: String(text.tr).trim(), en: String(text.en).trim() };
      };
      if (!Array.isArray(input.goals) || input.goals.length > 10) throw new Error('Invalid goals.');
      const ids = new Set<string>();
      const goals = input.goals.map(goal => {
        if (!goal || typeof goal.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(goal.id) || ids.has(goal.id) || !Array.isArray(goal.stages) || goal.stages.length < 1 || goal.stages.length > 8) throw new Error('Invalid goal.');
        ids.add(goal.id);
        return { id: goal.id, label: localized(goal.label), audience: localized(goal.audience), stages: goal.stages.map(localized) };
      });
      this.db.prepare('UPDATE platform_projects SET name=?,website=?,timezone=? WHERE id=? AND organization_id=?').run(input.name.trim(), website.origin, input.timezone, projectId, organizationId);
      this.db.prepare(`INSERT INTO platform_project_settings VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET language=excluded.language,brand_voice=excluded.brand_voice,goals=excluded.goals`)
        .run(projectId, organizationId, input.language, input.brandVoice.trim(), JSON.stringify(goals));
      this.audit(actor, organizationId, projectId, 'project.update');
    })();
    return this.workspace(actor, organizationId, projectId)!;
  }

  private audit(actor: string, organizationId: string, projectId: string, operation: string) {
    this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(actor, organizationId, projectId, operation, now());
  }
}

// Internal persistence primitive. Callers must authorize an owner or consume a verified signup proof.
export function insertStandardWorkspace(db: Database.Database, actor: string, input: { organizationName: string; projectName: string; website: string; username: string; password: string; timezone?: string }, baseline: 'pilot'|'trial' = 'pilot') {
  for (const value of [input.organizationName, input.projectName, input.username]) {
    if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new Error('Valid organization, project and username are required.');
  }
  const website = new URL(input.website);
  if (!['https:', 'http:'].includes(website.protocol) || website.username || website.password) throw new Error('Invalid website.');
  const timezone = input.timezone || 'Europe/Istanbul';
  new Intl.DateTimeFormat('en', { timeZone: timezone });
  const hash = passwordHash(input.password);
  const organizationId = randomUUID(), projectId = randomUUID(), userId = randomUUID();
  db.transaction(() => {
    db.prepare('INSERT INTO platform_users VALUES(?,?,?,?,?,?)').run(userId, input.username.trim(), hash, 1, 'platform', now());
    db.prepare('INSERT INTO platform_organizations VALUES(?,?,?)').run(organizationId, input.organizationName.trim(), now());
    db.prepare('INSERT INTO platform_projects VALUES(?,?,?,?,?,?,?)').run(projectId, organizationId, input.projectName.trim(), website.origin, timezone, 'standard', JSON.stringify(['dashboard', 'campaigns', 'library', 'mobile', 'seo', 'calendar', 'analytics', 'project']));
    db.prepare('INSERT INTO platform_memberships VALUES(?,?,?,?,1)').run(userId, organizationId, projectId, 'owner');
    const startedAt=now();
    db.prepare('INSERT INTO platform_project_entitlements VALUES(?,?,?,?,?,?)').run(organizationId,projectId,baseline,baseline==='trial'?userId:null,startedAt,baseline==='trial'?new Date(Date.parse(startedAt)+TRIAL_DAYS*86400000).toISOString():null);
    db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(actor,organizationId,projectId,'organization.provision',now());
  })();
  return { organizationId, projectId, userId };
}
