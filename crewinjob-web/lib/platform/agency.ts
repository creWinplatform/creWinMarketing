import 'server-only';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { AGENCY_PACKAGE } from './plan-catalog';
import type { AgencyClientLink, AgencyView } from './member-invites-types';

type Scope = { subject: string; organizationId: string; projectId: string };
type Link = { id: string; agency_organization_id: string; agency_project_id: string; organization_id: string; project_id: string; origin: 'created' | 'invited'; state: 'requested' | 'linked' | 'declined' | 'removed'; requested_by: string; requested_at: string; decided_at: string | null };
const now = () => new Date().toISOString();
const audit = (db: Database.Database, actor: string, organizationId: string, projectId: string, operation: string) => db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(actor, organizationId, projectId, operation, now());
// The running (or grace) agency package of a home project.
function running(db: Database.Database, home: { organizationId: string; projectId: string }) {
  const at = now();
  return db.prepare("SELECT ends_at,grace_ends_at FROM platform_project_subscriptions WHERE organization_id=? AND project_id=? AND package='agency' AND starts_at<=? AND grace_ends_at>? ORDER BY ends_at DESC LIMIT 1").get(home.organizationId, home.projectId, at, at) as { ends_at: string; grace_ends_at: string } | undefined;
}
const used = (db: Database.Database, homeProjectId: string) => (db.prepare("SELECT COUNT(*) n FROM platform_agency_links WHERE agency_project_id=? AND state IN ('requested','linked')").get(homeProjectId) as { n: number }).n;

// Projects whose owner (billing.manage) is this person and that have bought the agency package at least once.
export function agencyHomes(db: Database.Database, subject: string): AgencyView[] {
  const repo = new PlatformRepository(db);
  const homes = db.prepare("SELECT DISTINCT s.organization_id,s.project_id FROM platform_project_subscriptions s JOIN platform_memberships m ON m.organization_id=s.organization_id AND m.project_id=s.project_id AND m.user_id=? AND m.active=1 WHERE s.package='agency'").all(subject) as { organization_id: string; project_id: string }[];
  return homes.filter(home => repo.can(subject, home.organization_id, home.project_id, 'billing.manage')).map(home => new AgencyPackage(db, { subject, organizationId: home.organization_id, projectId: home.project_id }).view());
}

// The agency's side, acting from its own (home) project. Only a running package links or opens client projects.
export class AgencyPackage {
  private repo: PlatformRepository;
  constructor(private db: Database.Database, private scope: Scope) { this.repo = new PlatformRepository(db); }
  private authorize() {
    if (!this.repo.can(this.scope.subject, this.scope.organizationId, this.scope.projectId, 'billing.manage') || this.repo.workspace(this.scope.subject, this.scope.organizationId, this.scope.projectId)?.project.productPack !== 'standard'
      || !this.db.prepare("SELECT 1 FROM platform_project_subscriptions WHERE organization_id=? AND project_id=? AND package='agency'").get(this.scope.organizationId, this.scope.projectId)) throw new MarketingStoreError('Ajans paketini yalnız paketin alındığı projenin sahibi yönetebilir.', 403);
  }
  private open() {
    const period = running(this.db, this.scope);
    if (!period) throw new MarketingStoreError('Ajans paketi şu anda etkin değil. Plan ve ödeme bölümünden yenileyin.', 409);
    if (used(this.db, this.scope.projectId) >= AGENCY_PACKAGE.projects) throw new MarketingStoreError(`Ajans paketi en fazla ${AGENCY_PACKAGE.projects} müşteri projesini kapsar.`, 429);
  }
  view(): AgencyView {
    this.authorize(); const project = this.repo.workspace(this.scope.subject, this.scope.organizationId, this.scope.projectId)!.project, period = running(this.db, this.scope);
    const links = this.db.prepare("SELECT l.*,p.name AS project_name,o.name AS organization_name FROM platform_agency_links l JOIN platform_projects p ON p.id=l.project_id AND p.organization_id=l.organization_id JOIN platform_organizations o ON o.id=l.organization_id WHERE l.agency_project_id=? AND (l.state IN ('requested','linked') OR l.decided_at>=?) ORDER BY l.state='linked' DESC,l.requested_at DESC LIMIT 40").all(this.scope.projectId, new Date(Date.now() - 30 * 86400000).toISOString()) as (Link & { project_name: string; organization_name: string })[];
    return { organizationId: this.scope.organizationId, projectId: this.scope.projectId, name: project.name, limit: AGENCY_PACKAGE.projects, used: used(this.db, this.scope.projectId),
      period: period ? { endsAt: period.ends_at, graceEndsAt: period.grace_ends_at, inGrace: period.ends_at <= now() } : null,
      links: links.map(link => ({ id: link.id, organizationId: link.organization_id, projectId: link.project_id, projectName: link.project_name, organizationName: link.organization_name, origin: link.origin, state: link.state, requestedAt: link.requested_at, decidedAt: link.decided_at })) };
  }
  // A new client project in its own organization, owned by this person and covered by the package from the start. Its
  // base mode is 'agency': without a running package it keeps its records and new work stops, like an ended trial.
  createProject(raw: Record<string, unknown>) {
    this.authorize();
    if (Object.keys(raw).some(key => !['action', 'homeOrganizationId', 'homeProjectId', 'organizationName', 'projectName', 'website', 'timezone'].includes(key))) throw new MarketingStoreError('Geçersiz proje bilgisi.');
    const name = (value: unknown) => typeof value === 'string' && value.trim() && value.length <= 120 && !/[\x00-\x1f]/.test(value) ? value.trim() : null;
    const organizationName = name(raw.organizationName), projectName = name(raw.projectName);
    let website: URL;
    try { website = new URL(String(raw.website)); } catch { throw new MarketingStoreError('Geçerli bir web sitesi adresi girin.'); }
    if (!organizationName || !projectName || !['https:', 'http:'].includes(website.protocol) || website.username || website.password) throw new MarketingStoreError('Müşteri adı, proje adı ve web sitesi gerekli.');
    const timezone = typeof raw.timezone === 'string' && raw.timezone ? raw.timezone : 'Europe/Istanbul';
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new MarketingStoreError('Saat dilimi geçersiz.'); }
    return this.db.transaction(() => {
      this.authorize(); this.open();
      const organizationId = randomUUID(), projectId = randomUUID(), at = now();
      this.db.prepare('INSERT INTO platform_organizations VALUES(?,?,?)').run(organizationId, organizationName, at);
      this.db.prepare('INSERT INTO platform_projects VALUES(?,?,?,?,?,?,?)').run(projectId, organizationId, projectName, website.origin, timezone, 'standard', JSON.stringify(['dashboard', 'campaigns', 'library', 'mobile', 'seo', 'calendar', 'analytics', 'project']));
      this.db.prepare("INSERT INTO platform_memberships VALUES(?,?,?,'owner',1)").run(this.scope.subject, organizationId, projectId);
      this.db.prepare("INSERT INTO platform_project_entitlements VALUES(?,?,'agency',NULL,?,NULL)").run(organizationId, projectId, at);
      this.db.prepare("INSERT INTO platform_agency_links(id,agency_organization_id,agency_project_id,organization_id,project_id,origin,state,requested_by,requested_at,decided_by,decided_at) VALUES(?,?,?,?,?,'created','linked',?,?,?,?)").run(`agency_${randomUUID()}`, this.scope.organizationId, this.scope.projectId, organizationId, projectId, this.scope.subject, at, this.scope.subject, at);
      audit(this.db, this.scope.subject, organizationId, projectId, 'agency.project.create'); audit(this.db, this.scope.subject, this.scope.organizationId, this.scope.projectId, 'agency.project.create');
      return { organizationId, projectId };
    }).immediate();
  }
  // Adding a project the agency was invited to. Its owner agrees from that project; when this person is the owner, the
  // link is made at once.
  requestLink(raw: Record<string, unknown>) {
    this.authorize();
    const target = { organizationId: String(raw.organizationId || ''), projectId: String(raw.projectId || '') };
    return this.db.transaction(() => {
      this.authorize(); this.open();
      if (target.projectId === this.scope.projectId) throw new MarketingStoreError('Paketin alındığı proje zaten kapsamda.', 409);
      const workspace = this.repo.workspace(this.scope.subject, target.organizationId, target.projectId);
      if (!workspace || workspace.project.productPack !== 'standard') throw new MarketingStoreError('Yalnız ekibinde olduğunuz projeler pakete eklenebilir.', 403);
      const mode = (this.db.prepare('SELECT mode FROM platform_project_entitlements WHERE organization_id=? AND project_id=?').get(target.organizationId, target.projectId) as { mode: string } | undefined)?.mode;
      if (mode === 'pilot') throw new MarketingStoreError('Pilot projelerin planı ekibimizle birlikte belirlenir; ajans paketine eklenmez.', 409);
      if (this.db.prepare("SELECT 1 FROM platform_agency_links WHERE project_id=? AND state IN ('requested','linked')").get(target.projectId)) throw new MarketingStoreError('Bu proje zaten bir ajans paketinde veya onay bekliyor.', 409);
      const owner = this.repo.can(this.scope.subject, target.organizationId, target.projectId, 'billing.manage'), at = now();
      this.db.prepare('INSERT INTO platform_agency_links(id,agency_organization_id,agency_project_id,organization_id,project_id,origin,state,requested_by,requested_at,decided_by,decided_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(`agency_${randomUUID()}`, this.scope.organizationId, this.scope.projectId, target.organizationId, target.projectId, 'invited', owner ? 'linked' : 'requested', this.scope.subject, at, owner ? this.scope.subject : null, owner ? at : null);
      audit(this.db, this.scope.subject, target.organizationId, target.projectId, owner ? 'agency.link' : 'agency.link.request');
      return { state: owner ? 'linked' : 'requested' };
    }).immediate();
  }
  removeLink(raw: Record<string, unknown>) {
    this.authorize();
    const row = this.db.prepare("SELECT * FROM platform_agency_links WHERE id=? AND agency_project_id=? AND state IN ('requested','linked')").get(raw.id, this.scope.projectId) as Link | undefined;
    if (!row) throw new MarketingStoreError('Bağlı proje bulunamadı.', 404);
    this.db.prepare("UPDATE platform_agency_links SET state='removed',decided_by=?,decided_at=? WHERE id=?").run(this.scope.subject, now(), row.id);
    audit(this.db, this.scope.subject, row.organization_id, row.project_id, 'agency.link.remove');
  }
}

// The client's side, in its own project: the owner agrees to, declines or ends the agency's coverage.
export class AgencyClient {
  private repo: PlatformRepository;
  constructor(private db: Database.Database, private scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  private authorize() {
    if (!this.repo.can(this.scope.subject, this.scope.organizationId, this.scope.projectId, 'billing.manage') || this.repo.workspace(this.scope.subject, this.scope.organizationId, this.scope.projectId)?.project.productPack !== 'standard') throw new MarketingStoreError('Ajans paketi kararlarını yalnız proje sahibi verir.', 403);
  }
  list(): AgencyClientLink[] {
    this.authorize();
    const rows = this.db.prepare("SELECT l.*,p.name AS agency_name,o.name AS agency_organization,u.username AS requested_by_name FROM platform_agency_links l JOIN platform_projects p ON p.id=l.agency_project_id AND p.organization_id=l.agency_organization_id JOIN platform_organizations o ON o.id=l.agency_organization_id JOIN platform_users u ON u.id=l.requested_by WHERE l.organization_id=? AND l.project_id=? AND (l.state IN ('requested','linked') OR l.decided_at>=?) ORDER BY l.requested_at DESC LIMIT 10").all(this.scope.organizationId, this.scope.projectId, new Date(Date.now() - 30 * 86400000).toISOString()) as (Link & { agency_name: string; agency_organization: string; requested_by_name: string })[];
    return rows.map(row => ({ id: row.id, agencyName: row.agency_name, agencyOrganization: row.agency_organization, requestedBy: row.requested_by_name, origin: row.origin, state: row.state, requestedAt: row.requested_at, decidedAt: row.decided_at,
      packageRunning: Boolean(running(this.db, { organizationId: row.agency_organization_id, projectId: row.agency_project_id })) }));
  }
  decide(raw: Record<string, unknown>) {
    this.authorize();
    if (!['approve', 'decline'].includes(raw.decision as string)) throw new MarketingStoreError('Geçersiz karar.');
    this.db.transaction(() => {
      this.authorize();
      const row = this.db.prepare("SELECT * FROM platform_agency_links WHERE id=? AND organization_id=? AND project_id=? AND state='requested'").get(raw.id, this.scope.organizationId, this.scope.projectId) as Link | undefined;
      if (!row) throw new MarketingStoreError('Bekleyen ajans isteği bulunamadı.', 404);
      if (raw.decision === 'approve') {
        if (!running(this.db, { organizationId: row.agency_organization_id, projectId: row.agency_project_id })) throw new MarketingStoreError('Ajansın paketi şu anda etkin değil.', 409);
        if ((this.db.prepare("SELECT COUNT(*) n FROM platform_agency_links WHERE agency_project_id=? AND state='linked'").get(row.agency_project_id) as { n: number }).n >= AGENCY_PACKAGE.projects) throw new MarketingStoreError('Ajansın paketi dolu.', 429);
      }
      this.db.prepare('UPDATE platform_agency_links SET state=?,decided_by=?,decided_at=? WHERE id=?').run(raw.decision === 'approve' ? 'linked' : 'declined', this.scope.subject, now(), row.id);
      audit(this.db, this.scope.subject, this.scope.organizationId, this.scope.projectId, raw.decision === 'approve' ? 'agency.link.approve' : 'agency.link.decline');
    }).immediate();
    return this.list();
  }
  remove(raw: Record<string, unknown>) {
    this.authorize();
    const changed = this.db.prepare("UPDATE platform_agency_links SET state='removed',decided_by=?,decided_at=? WHERE id=? AND organization_id=? AND project_id=? AND state IN ('requested','linked')").run(this.scope.subject, now(), raw.id, this.scope.organizationId, this.scope.projectId).changes;
    if (!changed) throw new MarketingStoreError('Bağlı ajans bulunamadı.', 404);
    audit(this.db, this.scope.subject, this.scope.organizationId, this.scope.projectId, 'agency.link.remove');
    return this.list();
  }
}
