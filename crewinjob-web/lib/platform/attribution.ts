import { forEachSeries, mapSeries } from '../db/async-array';
import type { Db } from '../db/client';
import 'server-only';
import { createHmac } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { productTimestamp } from './product-records';
import { normalizeWebhookConfig } from './product-webhook-types';
import { linkTag } from './link-tracking';
import { LINK_TAG } from './link-tracking-types';
import { ryzevoFeature } from './ryzevo-features';
import { crewinTaggedItems } from './crewin-links';
import { ATTRIBUTION_CAMPAIGN, ATTRIBUTION_LABEL, ATTRIBUTION_LIMITS as LIMITS, ATTRIBUTION_MODELS, ATTRIBUTION_PERIODS, type AttributionModel, ATTRIBUTION_WINDOW_DAYS as WINDOW, type AttributionChannel, type AttributionItem, type AttributionOther, type AttributionPeriod, type AttributionReport, type AttributionItemKind, type AttributionSettingsView, type AttributionStage, type AttributionTagResult, PROFILE_NAMES, PROFILE_PLATFORMS, type AttributionTouch } from './attribution-types';

type Scope = { organizationId: string; projectId: string };
type Settings = { value_connection_id: string | null; value_event: string | null; value_key: string | null; currency: string | null; updated_at: string };
type Group = { campaign: string; source: string | null; n: number; value: number | null };
const DAY = 86400000;
const args = (scope: Scope) => [scope.organizationId, scope.projectId] as const;
const RYZEVO = "length(t.campaign)=13 AND t.campaign GLOB 'rz_[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'";
// The event counts for the touch only when it came first and no more than the window before it.
const IN_WINDOW = `e.occurred_at>=t.touched_at AND julianday(e.occurred_at)-julianday(t.touched_at)<=${WINDOW}`;
const JOIN = 'JOIN platform_attribution_touches t ON t.organization_id=e.organization_id AND t.project_id=e.project_id AND t.entity_key=e.entity_key';
const LOG = 'JOIN platform_attribution_touch_log t ON t.organization_id=e.organization_id AND t.project_id=e.project_id AND t.entity_key=e.entity_key';
// first: the stored first touch; last: the person's latest logged arrival at or before the event; any: every logged
// arrival in the window.
const MODEL_JOIN: Record<AttributionModel, string> = {
  first: JOIN,
  last: `${LOG} AND t.touched_at=(SELECT MAX(l.touched_at) FROM platform_attribution_touch_log l WHERE l.organization_id=e.organization_id AND l.project_id=e.project_id AND l.entity_key=e.entity_key AND l.touched_at<=e.occurred_at)`,
  any: LOG,
};

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
// The optional `touches` of a product event: the person's recent tagged arrivals (the snippet keeps the last five).
// Like `attribution`, a malformed list is dropped as a whole and the event is still accepted.
export function normalizeTouches(value: unknown, observedAt: string): { touches: AttributionTouch[]; invalid: boolean } {
  if (value === undefined) return { touches: [], invalid: false };
  if (!Array.isArray(value) || value.length > LIMITS.touchesPerEvent) return { touches: [], invalid: true };
  const touches: AttributionTouch[] = [];
  for (const item of value) {
    const { touch, invalid } = normalizeAttribution(item, observedAt);
    if (invalid || !touch) return { touches: [], invalid: true };
    touches.push(touch);
  }
  return { touches, invalid: false };
}
// The same person across the project's sources (same entity type and id), without keeping the id.
export const attributionEntity = (key: string, scope: Scope, entityType: string, externalId: string) =>
  createHmac('sha256', Buffer.from(key, 'hex')).update(JSON.stringify(['attribution-entity', scope.organizationId, scope.projectId, entityType, externalId])).digest('hex');

// Runs inside the webhook transaction, right after the raw event is stored. The first touch wins: a touch reported later
// replaces the stored one only when it happened earlier (out-of-order deliveries).
export async function recordAttribution(db: Db, scope: Scope, key: string, input: { connectionId: string; entityType: string; eventId: string; eventName: string; externalId: string; observedAt: string; attributes: Record<string, string | number | boolean>; touch: AttributionTouch | null; touches?: AttributionTouch[] }, receivedAt: string) {
  const entity = attributionEntity(key, scope, input.entityType, input.externalId);
  const settings = await db.prepare('SELECT value_connection_id,value_event,value_key FROM platform_attribution_settings WHERE organization_id=? AND project_id=?').get(...args(scope)) as Pick<Settings, 'value_connection_id' | 'value_event' | 'value_key'> | undefined;
  const raw = settings?.value_connection_id === input.connectionId && settings.value_event === input.eventName && settings.value_key ? input.attributes[settings.value_key] : undefined;
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  await db.prepare('INSERT INTO platform_attribution_events VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,event_id) DO NOTHING').run(input.connectionId, input.eventId, ...args(scope), entity, input.eventName, input.observedAt, value, receivedAt);
  for (const touch of input.touches || []) await logTouch(db, scope, entity, touch, input.observedAt, receivedAt);
  if (!input.touch) return false;
  return await writeTouch(db, scope, entity, input.touch, input.connectionId, input.eventId, input.observedAt, receivedAt);
}
// A touch cannot come after the event that reported it.
const touchTime = (touch: AttributionTouch, observedAt: string) => touch.touchedAt && touch.touchedAt < observedAt ? touch.touchedAt : observedAt;
// Every tagged arrival, for the last-touch and all-touches views; a person keeps the latest 20.
async function logTouch(db: Db, scope: Scope, entity: string, touch: AttributionTouch, observedAt: string, receivedAt: string) {
  await db.prepare('INSERT OR IGNORE INTO platform_attribution_touch_log VALUES(?,?,?,?,?,?,?,?)').run(...args(scope), entity, touch.campaign, touch.source, touch.medium, touchTime(touch, observedAt), receivedAt);
  await db.prepare(`DELETE FROM platform_attribution_touch_log WHERE organization_id=? AND project_id=? AND entity_key=? AND rowid NOT IN
    (SELECT rowid FROM platform_attribution_touch_log WHERE organization_id=? AND project_id=? AND entity_key=? ORDER BY touched_at DESC LIMIT ${LIMITS.touchesPerPerson})`).run(...args(scope), entity, ...args(scope), entity);
}
async function writeTouch(db: Db, scope: Scope, entity: string, touch: AttributionTouch, connectionId: string, eventId: string, observedAt: string, receivedAt: string) {
  await logTouch(db, scope, entity, touch, observedAt, receivedAt);
  const touchedAt = touchTime(touch, observedAt);
  const old = await db.prepare('SELECT touched_at FROM platform_attribution_touches WHERE organization_id=? AND project_id=? AND entity_key=?').get(...args(scope), entity) as { touched_at: string } | undefined;
  if (old && old.touched_at <= touchedAt) return false;
  await db.prepare(`INSERT INTO platform_attribution_touches VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,project_id,entity_key) DO UPDATE SET campaign=excluded.campaign,source=excluded.source,medium=excluded.medium,
    touched_at=excluded.touched_at,connection_id=excluded.connection_id,event_id=excluded.event_id,recorded_at=excluded.recorded_at`).run(...args(scope), entity, touch.campaign, touch.source, touch.medium, touchedAt, connectionId, eventId, receivedAt);
  return true;
}
// Mobile events reach the trail through the app's own source under an app-specific id. For an event that carries the
// app's customer id (the same opaque id the team's backend sends with entity type "user"), the trail moves to that
// person, so an app install and a backend signup are one person. An install or attribution the provider credits to a
// campaign is that person's touch, with medium "app"; provider labels are cleaned to the tag alphabet.
const tagLabel = (value: unknown, max: number) => { const text = String(value ?? '').trim().replace(/[^A-Za-z0-9._:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max); return text && !/^(unknown|none|null|organic)$/i.test(text) ? text : null; };
export async function linkMobileAttribution(db: Db, scope: Scope, key: string, input: { connectionId: string; eventId: string; externalId: string; observedAt: string; campaign?: unknown; channel?: unknown; touch: boolean }, receivedAt: string) {
  const entity = attributionEntity(key, scope, 'user', input.externalId);
  await db.prepare('UPDATE platform_attribution_events SET entity_key=? WHERE connection_id=? AND event_id=? AND organization_id=? AND project_id=?').run(entity, input.connectionId, input.eventId, ...args(scope));
  const campaign = input.touch ? tagLabel(input.campaign, 100) : null;
  if (!campaign) return false;
  return await writeTouch(db, scope, entity, { campaign, source: tagLabel(input.channel, 64), medium: 'app', touchedAt: input.observedAt }, input.connectionId, input.eventId, input.observedAt, receivedAt);
}
// The fixed tag of a profile link: the same for every visit, so the report counts who came through the profile.
export const profileTag = (scope: Scope, platform: string) => linkTag(scope, 'profile', platform);
export async function pruneAttribution(db: Db, now = Date.now()) {
  return await db.transaction(async () => {
    const cutoff = new Date(now - LIMITS.retentionDays * DAY).toISOString(), touchCutoff = new Date(now - LIMITS.touchDays * DAY).toISOString();
    let events = (await db.prepare('DELETE FROM platform_attribution_events WHERE rowid IN (SELECT rowid FROM platform_attribution_events WHERE occurred_at<? LIMIT 1000)').run(cutoff)).changes;
    const touches = (await db.prepare('DELETE FROM platform_attribution_touches WHERE rowid IN (SELECT rowid FROM platform_attribution_touches WHERE touched_at<? LIMIT 1000)').run(touchCutoff)).changes
      + (await db.prepare('DELETE FROM platform_attribution_touch_log WHERE rowid IN (SELECT rowid FROM platform_attribution_touch_log WHERE touched_at<? LIMIT 1000)').run(touchCutoff)).changes;
    // A project over its row cap loses its oldest trail first.
    for (const row of await db.prepare('SELECT organization_id,project_id,COUNT(*) AS n FROM platform_attribution_events GROUP BY organization_id,project_id HAVING n>?').all(LIMITS.rowsPerProject) as { organization_id: string; project_id: string; n: number }[])
      events += (await db.prepare('DELETE FROM platform_attribution_events WHERE rowid IN (SELECT rowid FROM platform_attribution_events WHERE organization_id=? AND project_id=? ORDER BY occurred_at LIMIT ?)').run(row.organization_id, row.project_id, Math.min(row.n - LIMITS.rowsPerProject, 1000))).changes;
    return { events, touches };
  });
}

export class ProjectAttribution {
  private repo: PlatformRepository;
  constructor(private db: Db, private scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  private async project() { return (await this.repo.workspace(this.scope.subject, ...args(this.scope)))?.project; }
  private async open() { return ryzevoFeature((await this.project())?.productPack, 'attribution'); }
  private async canManage() { return await this.repo.can(this.scope.subject, ...args(this.scope), 'connections.manage'); }
  private async authorize(manage = false) {
    if (!await this.repo.can(this.scope.subject, ...args(this.scope), 'read') || !await this.open() || manage && !await this.canManage()) throw new MarketingStoreError('Kaynak atfına erişim reddedildi.', 403);
  }
  private async settingsRow() { return await this.db.prepare('SELECT * FROM platform_attribution_settings WHERE organization_id=? AND project_id=?').get(...args(this.scope)) as Settings | undefined; }
  private async sources() {
    return (await this.db.prepare(`SELECT s.connection_id,s.config_json,s.enabled,c.active,c.account_name FROM platform_product_sources s JOIN platform_connections c ON c.id=s.connection_id AND c.organization_id=s.organization_id AND c.project_id=s.project_id
      WHERE s.organization_id=? AND s.project_id=? AND c.provider='product_webhook' ORDER BY c.account_name,s.connection_id`).all(...args(this.scope)) as { connection_id: string; config_json: string; enabled: number; active: number; account_name: string }[]);
  }
  // Goal stages mapped to product events, in goal and stage order. Without a mapping, the most frequent event names stand in.
  async stages(): Promise<AttributionStage[]> {
    const goals = (await this.project())?.goals || [];
    const rows = await this.db.prepare("SELECT goal_id,stage_index,connection_id,definition_json FROM platform_measurement_bindings WHERE organization_id=? AND project_id=? AND provider='product_webhook'").all(...args(this.scope)) as { goal_id: string; stage_index: number; connection_id: string; definition_json: string }[];
    const mapped = rows.flatMap(row => {
      const goal = goals.findIndex(item => item.id === row.goal_id), label = goals[goal]?.stages[row.stage_index], eventName = (JSON.parse(row.definition_json) as { eventName?: string }).eventName;
      return goal >= 0 && label && eventName ? [{ order: goal * 100 + row.stage_index, stage: { goalId: row.goal_id, stageIndex: row.stage_index, label: { tr: label.tr, en: label.en }, connectionId: row.connection_id, eventName } }] : [];
    }).sort((a, b) => a.order - b.order).map(item => item.stage);
    if (mapped.length) return mapped;
    const since = new Date(Date.now() - 90 * DAY).toISOString();
    return (await this.db.prepare('SELECT connection_id,event_name,COUNT(*) AS n FROM platform_attribution_events WHERE organization_id=? AND project_id=? AND occurred_at>=? GROUP BY connection_id,event_name ORDER BY n DESC,event_name LIMIT 4').all(...args(this.scope), since) as { connection_id: string; event_name: string }[])
      .map(row => ({ goalId: null, stageIndex: null, label: { tr: row.event_name, en: row.event_name }, connectionId: row.connection_id, eventName: row.event_name }));
  }
  // People who reached one stage in [from, to), grouped by the touch they carried; the value sum when the stage is the
  // value event.
  // The model picks the touch an event is credited to; each event counts once per touch, so an amount is never doubled.
  private async groups(stage: AttributionStage, from: string, to: string, value: Settings | undefined, { model = 'first', filter = '', extra = [] }: { model?: AttributionModel; filter?: string; extra?: unknown[] } = {}): Promise<Group[]> {
    const isValue = Boolean(value?.value_connection_id === stage.connectionId && value.value_event === stage.eventName);
    return await this.db.prepare(`SELECT campaign,source,COUNT(DISTINCT entity_key) AS n,${isValue ? 'SUM(value)' : 'NULL'} AS value FROM (SELECT DISTINCT t.campaign,t.source,e.entity_key,e.event_id,e.value
      FROM platform_attribution_events e ${MODEL_JOIN[model]} WHERE e.organization_id=? AND e.project_id=? AND e.connection_id=? AND e.event_name=? AND e.occurred_at>=? AND e.occurred_at<? AND ${IN_WINDOW}${filter}) GROUP BY campaign,source`)
      .all(...args(this.scope), stage.connectionId, stage.eventName, from, to, ...extra) as Group[];
  }
  private async coverage(stage: AttributionStage, from: string, to: string) {
    const row = await this.db.prepare(`SELECT COUNT(DISTINCT e.entity_key) AS entities,COUNT(DISTINCT CASE WHEN t.entity_key IS NOT NULL AND ${IN_WINDOW} THEN e.entity_key END) AS touched,
      COUNT(DISTINCT CASE WHEN t.entity_key IS NOT NULL AND ${IN_WINDOW} AND ${RYZEVO} THEN e.entity_key END) AS ryzevo
      FROM platform_attribution_events e LEFT ${JOIN} WHERE e.organization_id=? AND e.project_id=? AND e.connection_id=? AND e.event_name=? AND e.occurred_at>=? AND e.occurred_at<?`)
      .get(...args(this.scope), stage.connectionId, stage.eventName, from, to) as { entities: number; touched: number; ryzevo: number };
    return { entities: row.entities || 0, touched: row.touched || 0, ryzevo: row.ryzevo || 0 };
  }
  // The project's own content items and campaigns, by the tag their links carry. The Crewin workspace's posts, campaigns
  // and emails go out through its own tools, which register their tags (crewin-links.ts).
  private async items() {
    const content = await this.db.prepare("SELECT id,COALESCE(json_extract(payload,'$.headline'),substr(json_extract(payload,'$.content'),1,80)) AS title FROM platform_content_history WHERE organization_id=? AND project_id=?").all(...args(this.scope)) as { id: string; title: string | null }[];
    const campaigns = await this.db.prepare("SELECT id,json_extract(payload,'$.name') AS title FROM platform_campaigns WHERE organization_id=? AND project_id=?").all(...args(this.scope)) as { id: string; title: string | null }[];
    const whatsapp = await this.db.prepare("SELECT id,name FROM platform_whatsapp_batches WHERE organization_id=? AND project_id=? AND mode='send'").all(...args(this.scope)) as { id: string; name: string }[];
    // App links created before they carried the campaign's tag credit installs to the campaign id itself.
    const appLinked = new Set((await this.db.prepare('SELECT DISTINCT campaign_id FROM platform_mobile_links WHERE organization_id=? AND project_id=?').all(...args(this.scope)) as { campaign_id: string }[]).map(row => row.campaign_id));
    return new Map<string, { kind: AttributionItemKind; id: string; title: string }>([
      ...((await this.project())?.productPack === 'crewin' ? crewinTaggedItems() : []),
      ...PROFILE_PLATFORMS.map(platform => [profileTag(this.scope, platform), { kind: 'profile' as const, id: `profile:${platform}`, title: PROFILE_NAMES[platform] }] as const),
      ...content.map(item => [linkTag(this.scope, 'content', item.id), { kind: 'content' as const, id: item.id, title: item.title || '' }] as const),
      ...campaigns.map(item => [linkTag(this.scope, 'campaign', item.id), { kind: 'campaign' as const, id: item.id, title: item.title || '' }] as const),
      ...campaigns.filter(item => appLinked.has(item.id)).map(item => [item.id, { kind: 'campaign' as const, id: item.id, title: item.title || '' }] as const),
      ...whatsapp.map(item => [linkTag(this.scope, 'whatsapp', item.id), { kind: 'whatsapp' as const, id: item.id, title: item.name }] as const),
    ]);
  }
  private async hasTouches() { return Boolean(await this.db.prepare('SELECT 1 FROM platform_attribution_touches WHERE organization_id=? AND project_id=? LIMIT 1').get(...args(this.scope))); }
  // Everything the Analytics panel shows for the last 30 or 90 days.
  async report(rawDays: unknown = 30, rawModel: unknown = 'first'): Promise<AttributionReport> {
    await this.authorize();
    const days = (ATTRIBUTION_PERIODS as readonly number[]).includes(Number(rawDays)) ? Number(rawDays) as AttributionPeriod : 30;
    const model = (ATTRIBUTION_MODELS as readonly unknown[]).includes(rawModel) ? rawModel as AttributionModel : 'first';
    const now = Date.now(), from = new Date(now - days * DAY).toISOString(), to = new Date(now + 1000).toISOString();
    const result = await this.compute(from, to, LIMITS.items, model);
    const sources = await this.sources(), touch = await this.db.prepare('SELECT COUNT(*) AS n,MAX(recorded_at) AS last FROM platform_attribution_touches WHERE organization_id=? AND project_id=?').get(...args(this.scope)) as { n: number; last: string | null };
    const tracking = await this.db.prepare('SELECT connection_id,period_from,period_to FROM platform_link_tracking WHERE organization_id=? AND project_id=?').get(...args(this.scope)) as { connection_id: string | null; period_from: string | null; period_to: string | null } | undefined;
    const mapped = (await this.db.prepare("SELECT COUNT(*) AS n FROM platform_measurement_bindings WHERE organization_id=? AND project_id=? AND provider='product_webhook'").get(...args(this.scope)) as { n: number }).n > 0;
    return { days, model, from, to: new Date(now).toISOString(), windowDays: WINDOW, ...result,
      setup: { sources: sources.filter(item => item.active).length, activeSources: sources.filter(item => item.active && item.enabled).length, touches: touch.n, lastTouchAt: touch.last, stagesMapped: mapped, canManage: await this.canManage() },
      site: { from: tracking?.connection_id ? tracking.period_from : null, to: tracking?.connection_id ? tracking.period_to : null } };
  }
  private async compute(from: string, to: string, limit: number, model: AttributionModel = 'first') {
    const stages = await this.stages(), settings = await this.settingsRow(), items = await this.items();
    const sessions = new Map((await this.db.prepare('SELECT r.tag,SUM(r.sessions) AS sessions FROM platform_link_results r JOIN platform_link_tracking l ON l.organization_id=r.organization_id AND l.project_id=r.project_id AND l.connection_id IS NOT NULL WHERE r.organization_id=? AND r.project_id=? GROUP BY r.tag').all(...args(this.scope)) as { tag: string; sessions: number }[]).map(row => [row.tag, row.sessions]));
    const byItem = new Map<string, AttributionItem>(), byChannel = new Map<string, AttributionChannel>(), other = new Map<string, AttributionOther>(), unmatched = stages.map(() => 0);
    const valueStage = stages.findIndex(stage => settings?.value_connection_id === stage.connectionId && settings.value_event === stage.eventName && settings.value_key && settings.currency);
    await forEachSeries(stages, async (stage, index) => {
      for (const group of await this.groups(stage, from, to, settings, { model })) {
        const zero = () => stages.map(() => 0), value = index === valueStage ? group.value || 0 : 0;
        // Known items first: app links made before tagging carry the campaign's own id instead of a tag.
        const item = items.get(group.campaign);
        if (!item && !LINK_TAG.test(group.campaign)) {
          const key = `${group.campaign}\n${group.source || ''}`, row = other.get(key) || { campaign: group.campaign, source: group.source, counts: zero() };
          row.counts[index] += group.n; other.set(key, row); continue;
        }
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
      coverage: stages.length ? await this.coverage(stages[0], from, to) : null,
      value: valueStage >= 0 ? { currency: settings!.currency!, eventName: settings!.value_event! } : null,
    };
  }
  // One tagged post or email: people per stage in the last 90 days who arrived through this tag (and this channel).
  async forTag(tag: string | null, source: string | null): Promise<AttributionTagResult> {
    if (!tag || !LINK_TAG.test(tag) || !await this.open() || !await this.hasTouches()) return null;
    const stages = await this.stages();
    if (!stages.length) return null;
    const from = new Date(Date.now() - 90 * DAY).toISOString(), to = new Date(Date.now() + 1000).toISOString();
    const counts = await mapSeries(stages, async stage => (await this.groups(stage, from, to, undefined, { filter: source ? ' AND t.campaign=? AND t.source=?' : ' AND t.campaign=?', extra: source ? [tag, source] : [tag] })).reduce((sum, group) => sum + group.n, 0));
    return { stages: stages.map(stage => stage.label), counts, days: 90 };
  }
  // People per stage for every Ryzevo tag in [from, to), and per tag and channel: the coach's learning loop reads its own
  // drafts' and campaigns' tags from this.
  async tagCounts(from: string, to: string) {
    const stages = await this.open() && await this.hasTouches() ? await this.stages() : [];
    const byTag = new Map<string, number[]>(), byTagSource = new Map<string, number[]>();
    await forEachSeries(stages, async (stage, index) => {
      for (const group of await this.groups(stage, from, to, undefined, { filter: ` AND ${RYZEVO}` })) {
        for (const [map, key] of [[byTag, group.campaign], [byTagSource, `${group.campaign}\n${group.source || ''}`]] as const) {
          const row = map.get(key) || stages.map(() => 0); row[index] += group.n; map.set(key, row);
        }
      }
    });
    return { stages, byTag, byTagSource };
  }
  // The month's figures for the monthly report: people counted by the time they reached the stage.
  async monthResults(from: string, to: string) {
    if (!await this.open() || !await this.hasTouches()) return null;
    const result = await this.compute(from, to, 10);
    if (!result.stages.length) return null;
    return { stages: result.stages.map(stage => stage.label), coverage: result.coverage, value: result.value,
      items: result.items.map(item => ({ title: item.title, kind: item.kind, sources: item.sources, counts: item.counts, value: item.value })),
      channels: result.channels.map(item => ({ source: item.source, counts: item.counts, value: item.value })) };
  }
  async settings(): Promise<AttributionSettingsView> {
    await this.authorize(); const row = await this.settingsRow(), canManage = await this.canManage();
    let origin = ''; try { const url = new URL((await this.project())?.website || ''); origin = /^https?:$/.test(url.protocol) ? url.origin : ''; } catch { origin = ''; }
    const profileLinks = origin ? PROFILE_PLATFORMS.map(platform => ({ platform, url: `${origin}/?utm_source=${platform}&utm_medium=social&utm_campaign=${profileTag(this.scope, platform)}` })) : [];
    return { valueConnectionId: row?.value_connection_id || null, valueEvent: row?.value_event || null, valueKey: row?.value_key || null, currency: row?.currency || null, updatedAt: row?.updated_at || null, canManage, profileLinks,
      options: canManage ? (await this.sources()).filter(item => item.active).map(item => { const config = normalizeWebhookConfig(JSON.parse(item.config_json)); return { connectionId: item.connection_id, name: item.account_name, eventNames: config.eventNames, numberKeys: config.attributes.filter(field => field.type === 'number').map(field => field.key) }; }) : [] };
  }
  // Which numeric attribute of which event is the amount. It applies to events received from now on.
  async saveSettings(input: unknown) {
    await this.authorize(true);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['action', 'valueConnectionId', 'valueEvent', 'valueKey', 'currency'].includes(key))) throw new MarketingStoreError('Geçersiz tutar ayarı.');
    const raw = input as Record<string, unknown>, fields = [raw.valueConnectionId, raw.valueEvent, raw.valueKey, raw.currency];
    const clear = fields.every(value => value === null || value === undefined || value === '');
    if (!clear) {
      if (fields.some(value => typeof value !== 'string' || !value || value.length > 100) || !/^[A-Z]{3}$/.test(String(raw.currency))) throw new MarketingStoreError('Tutar için kaynak, olay, sayısal alan ve 3 harfli para birimi (ör. TRY) gerekli.');
      const option = (await this.settings()).options.find(item => item.connectionId === raw.valueConnectionId);
      if (!option || !option.eventNames.includes(String(raw.valueEvent)) || !option.numberKeys.includes(String(raw.valueKey))) throw new MarketingStoreError('Seçilen olay veya sayısal alan bu kaynakta yok.', 409);
    }
    const now = new Date().toISOString();
    await this.db.transaction(async () => {
      await this.db.prepare(`INSERT INTO platform_attribution_settings VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET value_connection_id=excluded.value_connection_id,value_event=excluded.value_event,value_key=excluded.value_key,currency=excluded.currency,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
        .run(...args(this.scope), clear ? null : raw.valueConnectionId, clear ? null : raw.valueEvent, clear ? null : raw.valueKey, clear ? null : raw.currency, this.scope.subject, now);
      await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...args(this.scope), 'attribution.settings', now);
    });
    return await this.settings();
  }
}
