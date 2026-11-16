import type { Db } from '../db/client';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { ProjectAds } from './ad-manager';
import type { AdProvider } from './ad-providers';
import { adWarnings, type AdWarning } from './ad-alerts';

// Opt-in automatic pause: when a running plan passes the team's spend threshold (overspend, or the CPI cap), the worker
// pauses it — the same pause a person presses, as the person who switched the rule on, and only while that person
// still approves ads and manages connections. Ryzevo only ever pauses: it never starts, edits or raises a budget.
// Every attempt is logged; a failed pause is not retried for six hours and the team keeps the warning.
export type AutoPauseKind = AdWarning['kind'];
export type AdAutoPauseView = {
  enabled: boolean; kinds: AutoPauseKind[]; enabledAt: string | null; enabledByMe: boolean;
  recent: { planId: string; kind: AutoPauseKind; outcome: 'paused' | 'failed'; spendMinor: number; limitMinor: number; currency: string; at: string }[];
};
type Scope = { subject: string; organizationId: string; projectId: string };
type Row = { enabled: number; kinds_json: string; enabled_by: string | null; enabled_at: string | null };
const KINDS: AutoPauseKind[] = ['overspend', 'cpi'];
const args = (scope: { organizationId: string; projectId: string }) => [scope.organizationId, scope.projectId] as const;
const parseKinds = (value: string) => { try { const list = JSON.parse(value); return Array.isArray(list) ? KINDS.filter(kind => list.includes(kind)) : []; } catch { return []; } };
async function rights(db: Db, subject: string, scope: { organizationId: string; projectId: string }) {
  const repo = new PlatformRepository(db);
  return await repo.can(subject, ...args(scope), 'campaign.approve') && await repo.can(subject, ...args(scope), 'connections.manage');
}

export async function adAutoPause(db: Db, scope: Scope): Promise<AdAutoPauseView> {
  // Until db:upgrade has added schema 80 the tables are missing: the ads screen keeps working and shows the rule as off.
  try { return await readAutoPause(db, scope); } catch { return { enabled: false, kinds: ['overspend'], enabledAt: null, enabledByMe: false, recent: [] }; }
}
async function readAutoPause(db: Db, scope: Scope): Promise<AdAutoPauseView> {
  const row = await db.prepare('SELECT enabled,kinds_json,enabled_by,enabled_at FROM platform_ad_auto_pause WHERE organization_id=? AND project_id=?').get(...args(scope)) as Row | undefined;
  const recent = await db.prepare('SELECT plan_id,kind,outcome,spend_minor,limit_minor,currency,created_at FROM platform_ad_auto_pause_log WHERE organization_id=? AND project_id=? ORDER BY created_at DESC LIMIT 10').all(...args(scope)) as { plan_id: string; kind: AutoPauseKind; outcome: 'paused' | 'failed'; spend_minor: number; limit_minor: number; currency: string; created_at: string }[];
  return {
    enabled: Boolean(row?.enabled), kinds: row ? parseKinds(row.kinds_json) : ['overspend'], enabledAt: row?.enabled ? row.enabled_at : null, enabledByMe: Boolean(row?.enabled && row.enabled_by === scope.subject),
    recent: recent.map(item => ({ planId: item.plan_id, kind: item.kind, outcome: item.outcome, spendMinor: Number(item.spend_minor), limitMinor: Number(item.limit_minor), currency: item.currency, at: item.created_at })),
  };
}
// Turning it on needs both ad rights and an explicit acknowledgement; turning it off needs the same rights.
export async function saveAdAutoPause(db: Db, scope: Scope, raw: Record<string, unknown>) {
  if (!await rights(db, scope.subject, scope)) throw new MarketingStoreError('Otomatik duraklatmayı yalnız reklam onay ve bağlantı yetkisi olan ekip üyeleri açıp kapatabilir.', 403);
  if (typeof raw.enabled !== 'boolean') throw new MarketingStoreError('Geçersiz otomatik duraklatma ayarı.');
  const kinds = Array.isArray(raw.kinds) ? KINDS.filter(kind => (raw.kinds as unknown[]).includes(kind)) : [];
  if (raw.enabled && !kinds.length) throw new MarketingStoreError('En az bir eşik seçin (bütçe aşımı veya yükleme başına maliyet).');
  if (raw.enabled && raw.acknowledged !== true) throw new MarketingStoreError('Otomatik duraklatmayı açmak için onay kutusunu işaretleyin.');
  const now = new Date().toISOString();
  await db.transaction(async () => {
    const row = await db.prepare('SELECT enabled FROM platform_ad_auto_pause WHERE organization_id=? AND project_id=?').get(...args(scope)) as { enabled: number } | undefined;
    const enabledBy = raw.enabled ? scope.subject : null, enabledAt = raw.enabled ? now : null;
    if (!row) await db.prepare('INSERT INTO platform_ad_auto_pause(organization_id,project_id,enabled,kinds_json,enabled_by,enabled_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(...args(scope), raw.enabled ? 1 : 0, JSON.stringify(kinds.length ? kinds : ['overspend']), enabledBy, enabledAt, scope.subject, now);
    else await db.prepare('UPDATE platform_ad_auto_pause SET enabled=?,kinds_json=?,enabled_by=?,enabled_at=?,updated_by=?,updated_at=? WHERE organization_id=? AND project_id=?').run(raw.enabled ? 1 : 0, JSON.stringify(kinds.length ? kinds : ['overspend']), enabledBy, enabledAt, scope.subject, now, ...args(scope));
    await db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(scope.subject, ...args(scope), raw.enabled ? 'ads.auto_pause.on' : 'ads.auto_pause.off', now);
  });
  return await adAutoPause(db, scope);
}

type Pauser = { pause: (raw: Record<string, unknown>) => Promise<unknown> };
// Worker step: up to three projects per tick, the least recently checked first.
export async function runAdAutoPause(db: Db, key: string, now = Date.now(), make?: (db: Db, scope: Scope, key: string, provider: AdProvider) => Pauser) {
  const due = await db.prepare("SELECT a.organization_id,a.project_id,a.kinds_json,a.enabled_by FROM platform_ad_auto_pause a JOIN platform_projects p ON p.id=a.project_id AND p.organization_id=a.organization_id AND p.product_pack='standard' WHERE a.enabled=1 AND (a.checked_at IS NULL OR a.checked_at<?) ORDER BY a.checked_at IS NOT NULL,a.checked_at LIMIT 3")
    .all(new Date(now - 15 * 60000).toISOString()) as { organization_id: string; project_id: string; kinds_json: string; enabled_by: string | null }[];
  let paused = 0;
  for (const item of due) {
    const scope = { subject: item.enabled_by || '', organizationId: item.organization_id, projectId: item.project_id }, at = new Date(now).toISOString();
    await db.prepare('UPDATE platform_ad_auto_pause SET checked_at=? WHERE organization_id=? AND project_id=?').run(at, ...args(scope));
    // The person who switched it on lost the rights: the rule switches off and says so in the audit log.
    if (!item.enabled_by || !await rights(db, item.enabled_by, scope)) {
      await db.prepare('UPDATE platform_ad_auto_pause SET enabled=0,enabled_by=NULL,enabled_at=NULL,updated_at=? WHERE organization_id=? AND project_id=?').run(at, ...args(scope));
      await db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(item.enabled_by || 'system', ...args(scope), 'ads.auto_pause.off_rights', at);
      continue;
    }
    const kinds = parseKinds(item.kinds_json), warnings = (await adWarnings(db, scope, now)).filter(warning => kinds.includes(warning.kind));
    for (const warning of warnings.filter((value, index, list) => list.findIndex(other => other.planId === value.planId) === index)) {
      const failedLately = await db.prepare("SELECT 1 FROM platform_ad_auto_pause_log WHERE organization_id=? AND project_id=? AND plan_id=? AND outcome='failed' AND created_at>?").get(...args(scope), warning.planId, new Date(now - 6 * 3600000).toISOString());
      if (failedLately) continue;
      const ads = make ? make(db, scope, key, warning.provider) : new ProjectAds(db, scope, key, undefined, warning.provider);
      let detail: string | null = null;
      try { await ads.pause({ id: warning.planId }); } catch (error) { detail = error instanceof MarketingStoreError ? error.message.slice(0, 300) : 'pause_failed'; }
      const plan = await db.prepare('SELECT state,last_error FROM platform_ad_plans WHERE id=? AND organization_id=? AND project_id=?').get(warning.planId, ...args(scope)) as { state: string; last_error: string | null } | undefined;
      const ok = !detail && plan?.state === 'paused';
      await db.prepare('INSERT INTO platform_ad_auto_pause_log(id,organization_id,project_id,plan_id,kind,spend_minor,limit_minor,currency,outcome,detail,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), ...args(scope), warning.planId, warning.kind, warning.kind === 'cpi' ? warning.cpiMinor ?? warning.spendMinor : warning.spendMinor, warning.limitMinor, warning.currency, ok ? 'paused' : 'failed', ok ? null : detail || plan?.last_error?.slice(0, 300) || 'pause_failed', at);
      await db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(scope.subject, ...args(scope), ok ? 'ads.plan.auto_pause' : 'ads.plan.auto_pause_failed', at);
      if (ok) paused++;
    }
  }
  return paused;
}
