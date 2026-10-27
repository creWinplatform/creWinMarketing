import 'server-only';
import type Database from 'better-sqlite3';
import { PILOT_LIMITS } from './limits';
import { MarketingStoreError } from './errors';
import { PLAN_CATALOG } from './plan-catalog';

type Scope = { organizationId: string; projectId: string };
export const TRIAL_LIMITS = Object.freeze({ ai: 10, audits: 3, campaigns: 10, content: 25, tasks: 25, members: 10 });
export const TRIAL_DAYS = 14;
type EntitlementRow = { mode: 'pilot' | 'trial' | 'agency'; started_at: string; ends_at: string | null };

// Only baseline rights are persisted. A package preference or sandbox payment cannot grant paid rights.
type PaidRow = { plan_id: string; package: 'agency' | null; starts_at: string; ends_at: string; grace_ends_at: string; via_agency?: number };
// The project's own period first; otherwise the running agency package of the agency the project is linked to.
function paidPeriod(db: Database.Database, scope: Scope): PaidRow | undefined {
  const at = new Date().toISOString();
  try {
    return db.prepare('SELECT plan_id,package,starts_at,ends_at,grace_ends_at FROM platform_project_subscriptions WHERE organization_id=? AND project_id=? AND starts_at<=? AND grace_ends_at>? ORDER BY ends_at DESC LIMIT 1').get(scope.organizationId, scope.projectId, at, at) as PaidRow | undefined
      ?? db.prepare("SELECT s.plan_id,s.package,s.starts_at,s.ends_at,s.grace_ends_at,1 AS via_agency FROM platform_agency_links l JOIN platform_project_subscriptions s ON s.organization_id=l.agency_organization_id AND s.project_id=l.agency_project_id AND s.package='agency' WHERE l.organization_id=? AND l.project_id=? AND l.state='linked' AND s.starts_at<=? AND s.grace_ends_at>? ORDER BY s.ends_at DESC LIMIT 1").get(scope.organizationId, scope.projectId, at, at) as PaidRow | undefined;
  } catch { return undefined; }
}
export function projectEntitlement(db: Database.Database, scope: Scope) {
  const project = db.prepare('SELECT product_pack FROM platform_projects WHERE id=? AND organization_id=?').get(scope.projectId, scope.organizationId) as {product_pack: string} | undefined;
  if (!project) throw new MarketingStoreError('Proje bulunamadı.', 404);
  const row = project.product_pack === 'crewin' ? {mode: 'pilot' as const, started_at: '', ends_at: null} : db.prepare('SELECT mode,started_at,ends_at FROM platform_project_entitlements WHERE organization_id=? AND project_id=?').get(scope.organizationId, scope.projectId) as EntitlementRow | undefined;
  if (!row || !['pilot', 'trial', 'agency'].includes(row.mode)) throw new MarketingStoreError('Proje planı doğrulanamadı.', 409);
  // A paid period (created only from a signed, amount-matching PayTR notification) replaces trial rights while it or
  // its 7-day grace runs. Pilot projects keep their pilot rights. After the grace the project falls back to its base row.
  const paid = project.product_pack === 'standard' && row.mode !== 'pilot' ? paidPeriod(db, scope) : undefined;
  const plan = paid && PLAN_CATALOG.find(item => item.id === paid.plan_id);
  if (paid && plan) return { id: 'paid' as const, plan: plan.id, ...(paid.package === 'agency' ? { agency: paid.via_agency ? 'linked' as const : 'home' as const } : {}), active: true, startsAt: paid.starts_at, endsAt: paid.ends_at, graceEndsAt: paid.grace_ends_at, inGrace: paid.ends_at <= new Date().toISOString(),
    limits: { ...PILOT_LIMITS, ai: plan.ai, audits: plan.audits, members: plan.seats }, seats: plan.seats, socialAccounts: plan.socialAccounts, liveDeliveryAllowed: true, periodKey: null };
  // An agency-opened project without a running package: like an ended trial, records stay and new work stops.
  if (row.mode === 'agency') return { id: 'trial' as const, agency: 'lapsed' as const, active: false, startsAt: row.started_at, endsAt: row.started_at,
    limits: TRIAL_LIMITS, seats: 2, socialAccounts: 1, liveDeliveryAllowed: false, periodKey: 'trial-v1' };
  const trial = row.mode === 'trial';
  if (trial && (!Number.isFinite(Date.parse(row.started_at)) || !row.ends_at || !Number.isFinite(Date.parse(row.ends_at)) || Date.parse(row.ends_at) - Date.parse(row.started_at) !== TRIAL_DAYS * 86400000)) throw new MarketingStoreError('Deneme dönemi doğrulanamadı.', 409);
  const active = !trial || Date.now() >= Date.parse(row.started_at) && Date.now() < Date.parse(row.ends_at!);
  return { id: row.mode, active, startsAt: trial ? row.started_at : null, endsAt: row.ends_at,
    limits: trial ? TRIAL_LIMITS : PILOT_LIMITS, seats: trial ? 2 : null, socialAccounts: trial ? 1 : null,
    liveDeliveryAllowed: !trial, periodKey: trial ? 'trial-v1' : null };
}

export function assertProjectWork(db: Database.Database, scope: Scope) {
  const rights = projectEntitlement(db, scope);
  if (!rights.active) throw new MarketingStoreError('Deneme süresi doldu. Mevcut kayıtlarınız korunuyor; yeni üretim için yöneticiyle iletişime geçin.', 403);
  return rights;
}

export function assertProjectDelivery(db: Database.Database, scope: Scope) {
  const rights = assertProjectWork(db, scope);
  if (!rights.liveDeliveryAllowed) throw new MarketingStoreError('Deneme planında gerçek e-posta ve sosyal yayın kapalıdır. Prova kullanabilirsiniz.', 403);
}

export function assertSeatCapacity(db: Database.Database, scope: Scope) {
  const rights = assertProjectWork(db, scope);
  if (rights.seats === null) return;
  const count = (db.prepare('SELECT COUNT(*) AS n FROM platform_memberships m JOIN platform_users u ON u.id=m.user_id WHERE m.organization_id=? AND m.project_id=? AND m.active=1 AND u.active=1').get(scope.organizationId, scope.projectId) as {n:number}).n;
  if (count >= rights.seats) throw new MarketingStoreError('Aktif ekip üyesi sınırına ulaşıldı.', 429);
}
