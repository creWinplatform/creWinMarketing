import 'server-only';
import { createHmac } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { productTimestamp } from './product-records';
import { normalizeWebhookConfig } from './product-webhook-types';
import { linkTag } from './link-tracking';
import { LINK_TAG } from './link-tracking-types';
import { ATTRIBUTION_CAMPAIGN, ATTRIBUTION_LABEL, ATTRIBUTION_LIMITS as LIMITS, ATTRIBUTION_PERIODS, ATTRIBUTION_WINDOW_DAYS as WINDOW, type AttributionChannel, type AttributionItem, type AttributionOther, type AttributionPeriod, type AttributionReport, type AttributionSettingsView, type AttributionStage, type AttributionTagResult, type AttributionTouch } from './attribution-types';

type Scope = { organizationId: string; projectId: string };
type Settings = { value_connection_id: string | null; value_event: string | null; value_key: string | null; currency: string | null; updated_at: string };
type Group = { campaign: string; source: string | null; n: number; value: number | null };
const DAY = 86400000;
const args = (scope: Scope) => [scope.organizationId, scope.projectId] as const;
const RYZEVO = "length(t.campaign)=13 AND t.campaign GLOB 'rz_[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'";
// The event counts for the touch only when it came first and no more than the window before it.
const IN_WINDOW = `e.occurred_at>=t.touched_at AND julianday(e.occurred_at)-julianday(t.touched_at)<=${WINDOW}`;
const JOIN = 'JOIN platform_attribution_touches t ON t.organization_id=e.organization_id AND t.project_id=e.project_id AND t.entity_key=e.entity_key';

// The optional `attribution` of a product event: the first tagged link its person arrived through. A malformed value is
// dropped (the event itself is still accepted), so a stray utm parameter never costs the team a signup event.
export function normalizeAttribution(value: unknown, observedAt: string): { touch: AttributionTouch | null; invalid: boolean } {
  if (value === undefined) return { touch: null, invalid: false };
  const invalid = { touch: null, invalid: true };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['campaign', 'source', 'medium', 'touchedAt'].includes(key)) || typeof raw.campaign !== 'string' || !ATTRIBUTION_CAMPAIGN.test(raw.campaign)) return invalid;
  const label = (input: unknown) => input === undefined || input === null ? null : typeof input === 'string' && ATTRIBUTION_LABEL.test(input) ? input : undefined;
  const source = label(raw.source), medium = label(raw.medium);
  if (source === undefined || medium === undefined) return invalid;
  let touchedAt: string | null = null;
  if (raw.touchedAt !== undefined && raw.touchedAt !== null) {
    try { touchedAt = productTimestamp(raw.touchedAt); } catch { return invalid; }
    if (Date.parse(touchedAt) < Date.parse(observedAt) - LIMITS.retentionDays * DAY) return invalid;
  }
  return { touch: { campaign: raw.campaign, source, medium, touchedAt }, invalid: false };
}
// The same person across the project's sources (same entity type and id), without keeping the id.
export const attributionEntity = (key: string, scope: Scope, entityType: string, externalId: string) =>
  createHmac('sha256', Buffer.from(key, 'hex')).update(JSON.stringify(['attribution-entity', scope.organizationId, scope.projectId, entityType, externalId])).digest('hex');

// Runs inside the webhook transaction, right after the raw event is stored. The first touch wins: a touch reported later
// replaces the stored one only when it happened earlier (out-of-order deliveries).
export function recordAttribution(db: Database.Database, scope: Scope, key: string, input: { connectionId: string; entityType: string; eventId: string; eventName: string; externalId: string; observedAt: string; attributes: Record<string, string | number | boolean>; touch: AttributionTouch | null }, receivedAt: string) {
  const entity = attributionEntity(key, scope, input.entityType, input.externalId);
  const settings = db.prepare('SELECT value_connection_id,value_event,value_key FROM platform_attribution_settings WHERE organization_id=? AND project_id=?').get(...args(scope)) as Pick<Settings, 'value_connection_id' | 'value_event' | 'value_key'> | undefined;
  const raw = settings?.value_connection_id === input.connectionId && settings.value_event === input.eventName && settings.value_key ? input.attributes[settings.value_key] : undefined;
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  db.prepare('INSERT INTO platform_attribution_events VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,event_id) DO NOTHING').run(input.connectionId, input.eventId, ...args(scope), entity, input.eventName, input.observedAt, value, receivedAt);
  if (!input.touch) return false;
  // A touch cannot come after the event that reported it.
  const touchedAt = input.touch.touchedAt && input.touch.touchedAt < input.observedAt ? input.touch.touchedAt : input.observedAt;
  const old = db.prepare('SELECT touched_at FROM platform_attribution_touches WHERE organization_id=? AND project_id=? AND entity_key=?').get(...args(scope), entity) as { touched_at: string } | undefined;
  if (old && old.touched_at <= touchedAt) return false;
  db.prepare(`INSERT INTO platform_attribution_touches VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,project_id,entity_key) DO UPDATE SET campaign=excluded.campaign,source=excluded.source,medium=excluded.medium,
    touched_at=excluded.touched_at,connection_id=excluded.connection_id,event_id=excluded.event_id,recorded_at=excluded.recorded_at`).run(...args(scope), entity, input.touch.campaign, input.touch.source, input.touch.medium, touchedAt, input.connectionId, input.eventId, receivedAt);
  return true;
}
export function pruneAttribution(db: Database.Database, now = Date.now()) {
  return db.transaction(() => {
    const cutoff = new Date(now - LIMITS.retentionDays * DAY).toISOString(), touchCutoff = new Date(now - LIMITS.touchDays * DAY).toISOString();
    let events = db.prepare('DELETE FROM platform_attribution_events WHERE rowid IN (SELECT rowid FROM platform_attribution_events WHERE occurred_at<? LIMIT 1000)').run(cutoff).changes;
    const touches = db.prepare('DELETE FROM platform_attribution_touches WHERE rowid IN (SELECT rowid FROM platform_attribution_touches WHERE touched_at<? LIMIT 1000)').run(touchCutoff).changes;
    // A project over its row cap loses its oldest trail first.
    for (const row of db.prepare('SELECT organization_id,project_id,COUNT(*) AS n FROM platform_attribution_events GROUP BY organization_id,project_id HAVING n>?').all(LIMITS.rowsPerProject) as { organization_id: string; project_id: string; n: number }[])
      events += db.prepare('DELETE FROM platform_attribution_events WHERE rowid IN (SELECT rowid FROM platform_attribution_events WHERE organization_id=? AND project_id=? ORDER BY occurred_at LIMIT ?)').run(row.organization_id, row.project_id, Math.min(row.n - LIMITS.rowsPerProject, 1000)).changes;
    return { events, touches };
  })();
}

export class ProjectAttribution {
  private repo: PlatformRepository;
  constructor(private db: Database.Database, private scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  private project() { return this.repo.workspace(this.scope.subject, ...args(this.scope))?.project; }
  private canManage() { return this.repo.can(this.scope.subject, ...args(this.scope), 'connections.manage'); }
  private authorize(manage = false) {
    if (!this.repo.can(this.scope.subject, ...args(this.scope), 'read') || this.project()?.productPack !== 'standard' || manage && !this.canManage()) throw new MarketingStoreError('Kaynak atfına erişim reddedildi.', 403);
  }
  private settingsRow() { return this.db.prepare('SELECT * FROM platform_attribution_settings WHERE organization_id=? AND project_id=?').get(...args(this.scope)) as Settings | undefined; }
  private sources() {
    return (this.db.prepare(`SELECT s.connection_id,s.config_json,s.enabled,c.active,c.account_name FROM platform_product_sources s JOIN platform_connections c ON c.id=s.connection_id AND c.organization_id=s.organization_id AND c.project_id=s.project_id
      WHERE s.organization_id=? AND s.project_id=? AND c.provider='product_webhook' ORDER BY c.account_name,s.connection_id`).all(...args(this.scope)) as { connection_id: string; config_json: string; enabled: number; active: number; account_name: string }[]);
  }
  // Goal stages mapped to product events, in goal and stage order. Without a mapping, the most frequent event names stand in.
  stages(): AttributionStage[] {
    const goals = this.project()?.goals || [];
    const rows = this.db.prepare("SELECT goal_id,stage_index,connection_id,definition_json FROM platform_measurement_bindings WHERE organization_id=? AND project_id=? AND provider='product_webhook'").all(...args(this.scope)) as { goal_id: string; stage_index: number; connection_id: string; definition_json: string }[];
    const mapped = rows.flatMap(row => {
      const goal = goals.findIndex(item => item.id === row.goal_id), label = goals[goal]?.stages[row.stage_index], eventName = (JSON.parse(row.definition_json) as { eventName?: string }).eventName;
      return goal >= 0 && label && eventName ? [{ order: goal * 100 + row.stage_index, stage: { goalId: row.goal_id, stageIndex: row.stage_index, label: { tr: label.tr, en: label.en }, connectionId: row.connection_id, eventName } }] : [];
    }).sort((a, b) => a.order - b.order).map(item => item.stage);
    if (mapped.length) return mapped;
    const since = new Date(Date.now() - 90 * DAY).toISOString();
    return (this.db.prepare('SELECT connection_id,event_name,COUNT(*) AS n FROM platform_attribution_events WHERE organization_id=? AND project_id=? AND occurred_at>=? GROUP BY connection_id,event_name ORDER BY n DESC,event_name LIMIT 4').all(...args(this.scope), since) as { connection_id: string; event_name: string }[])
      .map(row => ({ goalId: null, stageIndex: null, label: { tr: row.event_name, en: row.event_name }, connectionId: row.connection_id, eventName: row.event_name }));
  }
  // People who reached one stage in [from, to), grouped by the touch they carried; the value sum when the stage is the
  // value event.
  private groups(stage: AttributionStage, from: string, to: string, value: Settings | undefined, filter = '', ...extra: unknown[]): Group[] {
    const isValue = Boolean(value?.value_connection_id === stage.connectionId && value.value_event === stage.eventName);
    return this.db.prepare(`SELECT t.campaign,t.source,COUNT(DISTINCT e.entity_key) AS n,${isValue ? 'SUM(e.value)' : 'NULL'} AS value FROM platform_attribution_events e ${JOIN}
      WHERE e.organization_id=? AND e.project_id=? AND e.connection_id=? AND e.event_name=? AND e.occurred_at>=? AND e.occurred_at<? AND ${IN_WINDOW}${filter} GROUP BY t.campaign,t.source`)
      .all(...args(this.scope), stage.connectionId, stage.eventName, from, to, ...extra) as Group[];
  }
  private coverage(stage: AttributionStage, from: string, to: string) {
    const row = this.db.prepare(`SELECT COUNT(DISTINCT e.entity_key) AS entities,COUNT(DISTINCT CASE WHEN t.entity_key IS NOT NULL AND ${IN_WINDOW} THEN e.entity_key END) AS touched,
      COUNT(DISTINCT CASE WHEN t.entity_key IS NOT NULL AND ${IN_WINDOW} AND ${RYZEVO} THEN e.entity_key END) AS ryzevo
      FROM platform_attribution_events e LEFT ${JOIN} WHERE e.organization_id=? AND e.project_id=? AND e.connection_id=? AND e.event_name=? AND e.occurred_at>=? AND e.occurred_at<?`)
      .get(...args(this.scope), stage.connectionId, stage.eventName, from, to) as { entities: number; touched: number; ryzevo: number };
    return { entities: row.entities || 0, touched: row.touched || 0, ryzevo: row.ryzevo || 0 };
  }
  // The project's own content items and campaigns, by the tag their links carry.
  private items() {
    const content = this.db.prepare("SELECT id,COALESCE(json_extract(payload,'$.headline'),substr(json_extract(payload,'$.content'),1,80)) AS title FROM platform_content_history WHERE organization_id=? AND project_id=?").all(...args(this.scope)) as { id: string; title: string | null }[];
    const campaigns = this.db.prepare("SELECT id,json_extract(payload,'$.name') AS title FROM platform_campaigns WHERE organization_id=? AND project_id=?").all(...args(this.scope)) as { id: string; title: string | null }[];
    return new Map<string, { kind: 'content' | 'campaign'; id: string; title: string }>([
      ...content.map(item => [linkTag(this.scope, 'content', item.id), { kind: 'content' as const, id: item.id, title: item.title || '' }] as const),
      ...campaigns.map(item => [linkTag(this.scope, 'campaign', item.id), { kind: 'campaign' as const, id: item.id, title: item.title || '' }] as const),
    ]);
  }
  private hasTouches() { return Boolean(this.db.prepare('SELECT 1 FROM platform_attribution_touches WHERE organization_id=? AND project_id=? LIMIT 1').get(...args(this.scope))); }
  // Everything the Analytics panel shows for the last 30 or 90 days.
  report(rawDays: unknown = 30): AttributionReport {
    this.authorize();
    const days = (ATTRIBUTION_PERIODS as readonly number[]).includes(Number(rawDays)) ? Number(rawDays) as AttributionPeriod : 30;
    const now = Date.now(), from = new Date(now - days * DAY).toISOString(), to = new Date(now + 1000).toISOString();
    const result = this.compute(from, to, LIMITS.items);
    const sources = this.sources(), touch = this.db.prepare('SELECT COUNT(*) AS n,MAX(recorded_at) AS last FROM platform_attribution_touches WHERE organization_id=? AND project_id=?').get(...args(this.scope)) as { n: number; last: string | null };
    const tracking = this.db.prepare('SELECT connection_id,period_from,period_to FROM platform_link_tracking WHERE organization_id=? AND project_id=?').get(...args(this.scope)) as { connection_id: string | null; period_from: string | null; period_to: string | null } | undefined;
    const mapped = (this.db.prepare("SELECT COUNT(*) AS n FROM platform_measurement_bindings WHERE organization_id=? AND project_id=? AND provider='product_webhook'").get(...args(this.scope)) as { n: number }).n > 0;
    return { days, from, to: new Date(now).toISOString(), windowDays: WINDOW, ...result,
      setup: { sources: sources.filter(item => item.active).length, activeSources: sources.filter(item => item.active && item.enabled).length, touches: touch.n, lastTouchAt: touch.last, stagesMapped: mapped, canManage: this.canManage() },
      site: { from: tracking?.connection_id ? tracking.period_from : null, to: tracking?.connection_id ? tracking.period_to : null } };
  }
  private compute(from: string, to: string, limit: number) {
    const stages = this.stages(), settings = this.settingsRow(), items = this.items();
    const sessions = new Map((this.db.prepare('SELECT r.tag,SUM(r.sessions) AS sessions FROM platform_link_results r JOIN platform_link_tracking l ON l.organization_id=r.organization_id AND l.project_id=r.project_id AND l.connection_id IS NOT NULL WHERE r.organization_id=? AND r.project_id=? GROUP BY r.tag').all(...args(this.scope)) as { tag: string; sessions: number }[]).map(row => [row.tag, row.sessions]));
    const byItem = new Map<string, AttributionItem>(), byChannel = new Map<string, AttributionChannel>(), other = new Map<string, AttributionOther>(), unmatched = stages.map(() => 0);
    const valueStage = stages.findIndex(stage => settings?.value_connection_id === stage.connectionId && settings.value_event === stage.eventName && settings.value_key && settings.currency);
    stages.forEach((stage, index) => {
      for (const group of this.groups(stage, from, to, settings)) {
        const zero = () => stages.map(() => 0), value = index === valueStage ? group.value || 0 : 0;
        if (!LINK_TAG.test(group.campaign)) {
          const key = `${group.campaign}\n${group.source || ''}`, row = other.get(key) || { campaign: group.campaign, source: group.source, counts: zero() };
          row.counts[index] += group.n; other.set(key, row); continue;
        }
        const item = items.get(group.campaign);
        if (!item) { unmatched[index] += group.n; continue; }
        const row = byItem.get(group.campaign) || { tag: group.campaign, kind: item.kind, id: item.id, title: item.title, sources: [], sessions: sessions.has(group.campaign) ? sessions.get(group.campaign)! : null, counts: zero(), value: valueStage >= 0 ? 0 : null };
        row.counts[index] += group.n; if (row.value !== null) row.value += value;
        if (group.source && !row.sources.includes(group.source)) row.sources.push(group.source);
        byItem.set(group.campaign, row);
        const channelKey = group.source || '', channel = byChannel.get(channelKey) || { source: channelKey, counts: zero(), value: valueStage >= 0 ? 0 : null };
        channel.counts[index] += group.n; if (channel.value !== null) channel.value += value; byChannel.set(channelKey, channel);
      }
    });
    // Deepest stage first: a payment outranks any number of signups.
    const order = (a: { counts: number[] }, b: { counts: number[] }) => { for (let i = a.counts.length - 1; i >= 0; i--) if (b.counts[i] !== a.counts[i]) return b.counts[i] - a.counts[i]; return 0; };
    return {
      stages,
      items: [...byItem.values()].sort((a, b) => order(a, b) || (b.sessions ?? -1) - (a.sessions ?? -1) || a.title.localeCompare(b.title)).slice(0, limit),
      channels: [...byChannel.values()].sort((a, b) => order(a, b) || a.source.localeCompare(b.source)),
      other: [...other.values()].sort((a, b) => order(a, b) || a.campaign.localeCompare(b.campaign)).slice(0, LIMITS.other),
      unmatched,
      coverage: stages.length ? this.coverage(stages[0], from, to) : null,
      value: valueStage >= 0 ? { currency: settings!.currency!, eventName: settings!.value_event! } : null,
    };
  }
  // One tagged post or email: people per stage in the last 90 days who arrived through this tag (and this channel).
  forTag(tag: string | null, source: string | null): AttributionTagResult {
    if (!tag || !LINK_TAG.test(tag) || this.project()?.productPack !== 'standard' || !this.hasTouches()) return null;
    const stages = this.stages();
    if (!stages.length) return null;
    const from = new Date(Date.now() - 90 * DAY).toISOString(), to = new Date(Date.now() + 1000).toISOString();
    const counts = stages.map(stage => this.groups(stage, from, to, undefined, source ? ' AND t.campaign=? AND t.source=?' : ' AND t.campaign=?', ...(source ? [tag, source] : [tag])).reduce((sum, group) => sum + group.n, 0));
    return { stages: stages.map(stage => stage.label), counts, days: 90 };
  }
  // People per stage for every Ryzevo tag in [from, to), and per tag and channel: the coach's learning loop reads its own
  // drafts' and campaigns' tags from this.
  tagCounts(from: string, to: string) {
    const stages = this.project()?.productPack === 'standard' && this.hasTouches() ? this.stages() : [];
    const byTag = new Map<string, number[]>(), byTagSource = new Map<string, number[]>();
    stages.forEach((stage, index) => {
      for (const group of this.groups(stage, from, to, undefined, ` AND ${RYZEVO}`)) {
        for (const [map, key] of [[byTag, group.campaign], [byTagSource, `${group.campaign}\n${group.source || ''}`]] as const) {
          const row = map.get(key) || stages.map(() => 0); row[index] += group.n; map.set(key, row);
        }
      }
    });
    return { stages, byTag, byTagSource };
  }
  // The month's figures for the monthly report: people counted by the time they reached the stage.
  monthResults(from: string, to: string) {
    if (this.project()?.productPack !== 'standard' || !this.hasTouches()) return null;
    const result = this.compute(from, to, 10);
    if (!result.stages.length) return null;
    return { stages: result.stages.map(stage => stage.label), coverage: result.coverage, value: result.value,
      items: result.items.map(item => ({ title: item.title, kind: item.kind, sources: item.sources, counts: item.counts, value: item.value })),
      channels: result.channels.map(item => ({ source: item.source, counts: item.counts, value: item.value })) };
  }
  settings(): AttributionSettingsView {
    this.authorize(); const row = this.settingsRow(), canManage = this.canManage();
    return { valueConnectionId: row?.value_connection_id || null, valueEvent: row?.value_event || null, valueKey: row?.value_key || null, currency: row?.currency || null, updatedAt: row?.updated_at || null, canManage,
      options: canManage ? this.sources().filter(item => item.active).map(item => { const config = normalizeWebhookConfig(JSON.parse(item.config_json)); return { connectionId: item.connection_id, name: item.account_name, eventNames: config.eventNames, numberKeys: config.attributes.filter(field => field.type === 'number').map(field => field.key) }; }) : [] };
  }
  // Which numeric attribute of which event is the amount. It applies to events received from now on.
  saveSettings(input: unknown) {
    this.authorize(true);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['action', 'valueConnectionId', 'valueEvent', 'valueKey', 'currency'].includes(key))) throw new MarketingStoreError('Geçersiz tutar ayarı.');
    const raw = input as Record<string, unknown>, fields = [raw.valueConnectionId, raw.valueEvent, raw.valueKey, raw.currency];
    const clear = fields.every(value => value === null || value === undefined || value === '');
    if (!clear) {
      if (fields.some(value => typeof value !== 'string' || !value || value.length > 100) || !/^[A-Z]{3}$/.test(String(raw.currency))) throw new MarketingStoreError('Tutar için kaynak, olay, sayısal alan ve 3 harfli para birimi (ör. TRY) gerekli.');
      const option = this.settings().options.find(item => item.connectionId === raw.valueConnectionId);
      if (!option || !option.eventNames.includes(String(raw.valueEvent)) || !option.numberKeys.includes(String(raw.valueKey))) throw new MarketingStoreError('Seçilen olay veya sayısal alan bu kaynakta yok.', 409);
    }
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO platform_attribution_settings VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET value_connection_id=excluded.value_connection_id,value_event=excluded.value_event,value_key=excluded.value_key,currency=excluded.currency,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
        .run(...args(this.scope), clear ? null : raw.valueConnectionId, clear ? null : raw.valueEvent, clear ? null : raw.valueKey, clear ? null : raw.currency, this.scope.subject, now);
      this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...args(this.scope), 'attribution.settings', now);
    })();
    return this.settings();
  }
}
