import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials, encryptCredentials, type StoredCredentials } from './credential-envelope';
import { refreshGoogleCredentials } from './google-client';
import { readGoogleLinkResults, type LinkResultsReader, type LinkResultsReport } from './measurement-google';
import { LINK_SOURCES, LINK_TAG, type LinkResultState, type LinkSyncState, type LinkTrackingView, type PublicationSiteResult, type SiteSummary } from './link-tracking-types';

type Scope = { organizationId: string; projectId: string };
type Settings = { organization_id: string; project_id: string; enabled: number; connection_id: string | null; manager_id: string | null; state: LinkSyncState; reason: string | null; result_state: LinkResultState | null; period_from: string | null; period_to: string | null; timezone: string | null; checked_at: string | null; attempted_at: string | null; next_sync_at: string | null; lease_token: string | null; lease_until: string | null };
type Connection = { id: string; integration_id: string; encrypted_credentials: string };
const DAY = 86400000, PERIOD_DAYS = 90, DAILY_READS = 24, MANUAL_GAP = 10 * 60000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const args = (scope: Scope) => [scope.organizationId, scope.projectId] as const;

// One tag per saved content item or campaign; utm_source tells the channels apart. Project-scoped, so it reveals no id.
export function linkTag(scope: Scope, kind: string, id: string) { return 'rz_' + hash(JSON.stringify([scope.organizationId, scope.projectId, kind, id])).slice(0, 10); }
// No settings row means tagging is on: the team sees every tagged link in the preview before approving.
export function linkTrackingEnabled(db: Database.Database, scope: Scope) {
  const row = db.prepare('SELECT enabled FROM platform_link_tracking WHERE organization_id=? AND project_id=?').get(...args(scope)) as { enabled: number } | undefined;
  return row ? Boolean(row.enabled) : true;
}
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
// Adds utm_source/utm_medium/utm_campaign to links on the project's own site (and its subdomains). Links elsewhere and
// links that already carry any utm_ parameter are left exactly as written.
export function tagOwnLinks(text: string, website: string, platform: string, tag: string) {
  const source = LINK_SOURCES[platform];
  let host = '';
  try { host = new URL(website).hostname.toLowerCase().replace(/^www\./, ''); } catch { host = ''; }
  if (!source || !host || !LINK_TAG.test(tag)) return { text, tagged: 0 };
  let tagged = 0;
  const output = text.replace(URL_PATTERN, match => {
    const trail = match.match(/[.,;:!?)\]}»”’]+$/)?.[0] || '', raw = match.slice(0, match.length - trail.length);
    let url: URL;
    try { url = new URL(raw); } catch { return match; }
    const name = url.hostname.toLowerCase();
    if (name !== host && !name.endsWith(`.${host}`) || url.username || url.password || [...url.searchParams.keys()].some(key => key.toLowerCase().startsWith('utm_'))) return match;
    url.searchParams.set('utm_source', source); url.searchParams.set('utm_medium', 'social'); url.searchParams.set('utm_campaign', tag);
    tagged++; return url.toString() + trail;
  });
  return { text: output, tagged };
}
// The last 90 complete days; GA4 keeps processing today's data, so the period ends yesterday.
export function linkPeriod(now = Date.now()) {
  const to = new Date(now - DAY).toISOString().slice(0, 10);
  return { from: new Date(Date.parse(to) - (PERIOD_DAYS - 1) * DAY).toISOString().slice(0, 10), to };
}
function settings(db: Database.Database, scope: Scope) { return db.prepare('SELECT * FROM platform_link_tracking WHERE organization_id=? AND project_id=?').get(...args(scope)) as Settings | undefined; }
function audit(db: Database.Database, actor: string, scope: Scope, operation: string) { db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(actor, ...args(scope), operation, new Date().toISOString()); }

export class LinkTracking {
  private repo: PlatformRepository;
  constructor(private db: Database.Database, private scope: MarketingScope, private key = '') { this.repo = new PlatformRepository(db); }
  private standard(subject = this.scope.subject) { return this.repo.workspace(subject, ...args(this.scope))?.project.productPack === 'standard'; }
  private can(subject = this.scope.subject) { return this.repo.can(subject, ...args(this.scope), 'connections.manage') && this.standard(subject); }
  private authorize(manage = false) {
    if (!this.repo.can(this.scope.subject, ...args(this.scope), 'read') || !this.standard() || manage && !this.can()) throw new MarketingStoreError('Bağlantı sonuçlarına erişim reddedildi.', 403);
  }
  private connections() { return this.db.prepare("SELECT id,account_name AS name,integration_id AS property FROM platform_connections WHERE organization_id=? AND project_id=? AND active=1 AND provider='ga4' ORDER BY account_name,id").all(...args(this.scope)) as LinkTrackingView['connections']; }
  view(): LinkTrackingView {
    this.authorize(); const row = settings(this.db, this.scope), canManage = this.can();
    const tagged = (this.db.prepare("SELECT COUNT(*) AS n FROM platform_social_publications WHERE organization_id=? AND project_id=? AND mode='publish' AND state='accepted' AND link_tag IS NOT NULL").get(...args(this.scope)) as { n: number }).n;
    return { enabled: row ? Boolean(row.enabled) : true, canManage, website: this.repo.workspace(this.scope.subject, ...args(this.scope))!.project.website,
      connectionId: row?.connection_id || null, connections: canManage ? this.connections() : [], state: row?.state === 'refreshing' && (!row.lease_until || row.lease_until <= new Date().toISOString()) ? 'failed' : row?.state || 'idle', reason: row?.reason || null, resultState: row?.result_state || null,
      from: row?.period_from || null, to: row?.period_to || null, checkedAt: row?.checked_at || null, attemptedAt: row?.attempted_at || null, nextSyncAt: row?.next_sync_at || null, tagged };
  }
  // Tagging on/off and the GA4 property to read. Choosing another property (or none) drops the stored results.
  configure(input: unknown) {
    this.authorize(true);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['action', 'enabled', 'connectionId'].includes(key))) throw new MarketingStoreError('Geçersiz ayar.');
    const value = input as { enabled?: unknown; connectionId?: unknown };
    if (typeof value.enabled !== 'boolean' || value.connectionId !== null && (typeof value.connectionId !== 'string' || !value.connectionId || value.connectionId.length > 100)) throw new MarketingStoreError('Geçersiz ayar.');
    const connectionId = value.connectionId as string | null, enabled = value.enabled;
    this.db.transaction(() => {
      this.authorize(true);
      if (connectionId && !this.connections().some(item => item.id === connectionId)) throw new MarketingStoreError('Etkin Google Analytics bağlantısı bulunamadı.', 409);
      const old = settings(this.db, this.scope), now = new Date().toISOString(), changed = (old?.connection_id || null) !== connectionId;
      if (!old) this.db.prepare("INSERT INTO platform_link_tracking(organization_id,project_id,enabled,connection_id,manager_id,next_sync_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(...args(this.scope), Number(enabled), connectionId, connectionId ? this.scope.subject : null, connectionId ? now : null, now);
      else if (changed) {
        this.db.prepare("UPDATE platform_link_tracking SET enabled=?,connection_id=?,manager_id=?,state='idle',reason=NULL,result_state=NULL,period_from=NULL,period_to=NULL,timezone=NULL,checked_at=NULL,next_sync_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE organization_id=? AND project_id=?").run(Number(enabled), connectionId, connectionId ? this.scope.subject : null, connectionId ? now : null, now, ...args(this.scope));
        this.db.prepare('DELETE FROM platform_link_results WHERE organization_id=? AND project_id=?').run(...args(this.scope));
      } else this.db.prepare('UPDATE platform_link_tracking SET enabled=?,manager_id=?,updated_at=? WHERE organization_id=? AND project_id=?').run(Number(enabled), connectionId ? this.scope.subject : null, now, ...args(this.scope));
      audit(this.db, this.scope.subject, this.scope, 'link.tracking.configure');
    }).immediate();
    return this.view();
  }
  async refresh(read: LinkResultsReader = readGoogleLinkResults, refresh = refreshGoogleCredentials) {
    this.authorize(true); const row = settings(this.db, this.scope);
    if (!row?.connection_id) throw new MarketingStoreError('Önce bir Google Analytics mülkü seçin.', 409);
    if (row.attempted_at && Date.now() - Date.parse(row.attempted_at) < MANUAL_GAP) throw new MarketingStoreError('Sonuçlar 10 dakikada bir yenilenebilir.', 429);
    if (!await syncLinkResults(this.db, this.scope, this.key, read, refresh, this.scope.subject)) throw new MarketingStoreError('Sonuçlar şu anda yenilenemiyor. Biraz sonra tekrar deneyin.', 429);
    return this.view();
  }
  // What GA4 reported for one accepted publication's tag and channel. "none" means GA4 had data for the period but no
  // session arrived through this link; a missing report is never shown as zero.
  result(tag: string | null, platform: string, publishedAt: string | null): PublicationSiteResult | undefined {
    const source = LINK_SOURCES[platform];
    if (!tag || !source) return undefined;
    const row = settings(this.db, this.scope), empty = { sessions: null, keyEvents: null, from: row?.period_from || null, to: row?.period_to || null, checkedAt: row?.checked_at || null };
    if (!row?.connection_id) return { status: 'not_connected', ...empty };
    if (!row.result_state || !row.period_to) return { status: row.state === 'failed' || row.state === 'blocked' ? 'failed' : 'pending', ...empty };
    if (publishedAt && publishedAt.slice(0, 10) > row.period_to) return { status: 'pending', ...empty };
    const value = this.db.prepare('SELECT sessions,key_events FROM platform_link_results WHERE organization_id=? AND project_id=? AND tag=? AND source=?').get(...args(this.scope), tag, source) as { sessions: number; key_events: number } | undefined;
    if (!value) return { status: row.result_state === 'partial' ? 'partial' : 'none', ...empty };
    return { status: row.result_state === 'partial' ? 'partial' : 'ready', ...empty, sessions: value.sessions, keyEvents: value.key_events };
  }
  // Channel totals and the posts that brought the most sessions, for accepted tagged publications in the stored period.
  summary(): SiteSummary | null {
    const row = settings(this.db, this.scope);
    if (!row?.connection_id || !row.result_state || !row.period_from || !row.period_to || !row.checked_at) return null;
    const posts = this.db.prepare(`SELECT p.link_tag AS tag,p.source_kind AS kind,p.source_id AS id,a.platform,MIN(COALESCE(p.submitted_at,p.scheduled_at)) AS published,
      CASE p.source_kind WHEN 'content' THEN (SELECT COALESCE(json_extract(h.payload,'$.headline'),substr(json_extract(h.payload,'$.content'),1,80)) FROM platform_content_history h WHERE h.id=p.source_id AND h.organization_id=p.organization_id AND h.project_id=p.project_id)
        ELSE (SELECT json_extract(c.payload,'$.name') FROM platform_campaigns c WHERE c.id=p.source_id AND c.organization_id=p.organization_id AND c.project_id=p.project_id) END AS title
      FROM platform_social_publications p JOIN platform_jobs j ON j.id=p.job_id AND j.organization_id=p.organization_id AND j.project_id=p.project_id JOIN platform_social_accounts a ON a.connection_id=j.connection_id
      WHERE p.organization_id=? AND p.project_id=? AND p.mode='publish' AND p.state='accepted' AND p.link_tag IS NOT NULL GROUP BY p.link_tag,a.platform`).all(...args(this.scope)) as { tag: string; kind: string; id: string; platform: string; published: string | null; title: string | null }[];
    const results = new Map((this.db.prepare('SELECT tag,source,sessions,key_events FROM platform_link_results WHERE organization_id=? AND project_id=?').all(...args(this.scope)) as { tag: string; source: string; sessions: number; key_events: number }[]).map(item => [`${item.tag}\n${item.source}`, item]));
    const channels = new Map<string, SiteSummary['byChannel'][number]>(), top: SiteSummary['top'] = [];
    for (const post of posts) {
      const source = LINK_SOURCES[post.platform];
      if (!source || post.published && post.published.slice(0, 10) > row.period_to) continue;
      const value = results.get(`${post.tag}\n${source}`), sessions = value?.sessions || 0, keyEvents = value?.key_events || 0;
      const channel = channels.get(source) || { source, posts: 0, sessions: 0, keyEvents: 0 };
      channel.posts++; channel.sessions += sessions; channel.keyEvents += keyEvents; channels.set(source, channel);
      if (sessions > 0) top.push({ title: post.title || source, source, sessions, keyEvents, publishedAt: post.published });
    }
    top.sort((a, b) => b.sessions - a.sessions || b.keyEvents - a.keyEvents || a.title.localeCompare(b.title));
    return { resultState: row.result_state, from: row.period_from, to: row.period_to, checkedAt: row.checked_at, posts: [...channels.values()].reduce((sum, item) => sum + item.posts, 0),
      byChannel: [...channels.values()].sort((a, b) => b.sessions - a.sessions || a.source.localeCompare(b.source)), top: top.slice(0, 5) };
  }
}

// One read of one project's GA4 property, as the person who chose it (and the manual runner, when there is one). The
// lease keeps two readers apart; any change of person, property or credentials during the read stores nothing.
export async function syncLinkResults(db: Database.Database, scope: Scope, key: string, read: LinkResultsReader = readGoogleLinkResults, refresh = refreshGoogleCredentials, manualRunner?: string) {
  const lease = randomUUID(), repo = new PlatformRepository(db);
  const holder = () => Boolean(db.prepare('SELECT 1 FROM platform_link_tracking WHERE organization_id=? AND project_id=? AND lease_token=? AND lease_until>?').get(...args(scope), lease, new Date().toISOString()));
  const claimed = db.transaction(() => {
    const row = settings(db, scope), now = new Date().toISOString();
    if (!row?.connection_id || !row.manager_id || row.state === 'refreshing' && row.lease_until && row.lease_until > now) return null;
    const day = now.slice(0, 10), usage = db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='link_results'").get(...args(scope), day) as { count: number } | undefined;
    if ((usage?.count || 0) >= DAILY_READS) return null;
    db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'link_results',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...args(scope), day);
    db.prepare("UPDATE platform_link_tracking SET state='refreshing',lease_token=?,lease_until=?,attempted_at=?,next_sync_at=? WHERE organization_id=? AND project_id=?").run(lease, new Date(Date.now() + 60000).toISOString(), now, new Date(Date.now() + DAY).toISOString(), ...args(scope));
    return row;
  }).immediate();
  if (!claimed) return false;
  const live = () => {
    const row = settings(db, scope);
    const allowed = (subject: string) => repo.can(subject, ...args(scope), 'connections.manage') && repo.workspace(subject, ...args(scope))?.project.productPack === 'standard';
    if (!row || row.connection_id !== claimed.connection_id || row.manager_id !== claimed.manager_id || !allowed(claimed.manager_id!) || manualRunner && !allowed(manualRunner)) throw new Error('Authority changed.');
    const connection = db.prepare("SELECT id,integration_id,encrypted_credentials FROM platform_connections WHERE id=? AND organization_id=? AND project_id=? AND provider='ga4' AND active=1").get(claimed.connection_id, ...args(scope)) as Connection | undefined;
    if (!connection) throw new Error('Connection changed.');
    return connection;
  };
  const period = linkPeriod();
  let report: LinkResultsReport | undefined, error = 'provider_unavailable', resource = '';
  try {
    const connection = live(), revision = connection.encrypted_credentials, credentials = decryptCredentials<StoredCredentials>(revision, key, ...args(scope), connection.id), fresh = await refresh(credentials);
    if (fresh !== credentials) db.transaction(() => {
      if (!holder()) throw new Error(); live();
      const changed = db.prepare('UPDATE platform_connections SET encrypted_credentials=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND active=1 AND encrypted_credentials=?').run(encryptCredentials(fresh, key, ...args(scope), connection.id), new Date().toISOString(), connection.id, ...args(scope), revision);
      if (!changed.changes) throw new Error();
      db.prepare('DELETE FROM platform_connection_checks WHERE connection_id=?').run(connection.id);
    }).immediate();
    if (!holder()) return false; resource = live().integration_id;
    report = await read({ resource, ...period, token: fresh.accessToken });
  } catch { try { live(); } catch { error = 'changed'; } }
  db.transaction(() => {
    if (!holder()) return;
    try { const current = live(); if (report && current.integration_id !== resource) throw new Error(); } catch { error = 'changed'; report = undefined; }
    const done = new Date().toISOString();
    if (!report || !['ready', 'partial', 'no_data'].includes(report.status) || !Array.isArray(report.rows) || report.rows.length > 1000) {
      db.prepare('UPDATE platform_link_tracking SET state=?,reason=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE organization_id=? AND project_id=?').run(error === 'changed' ? 'blocked' : 'failed', error, done, ...args(scope));
      if (error === 'changed') {
        db.prepare('UPDATE platform_link_tracking SET result_state=NULL,period_from=NULL,period_to=NULL,timezone=NULL,checked_at=NULL WHERE organization_id=? AND project_id=?').run(...args(scope));
        db.prepare('DELETE FROM platform_link_results WHERE organization_id=? AND project_id=?').run(...args(scope));
      }
      audit(db, manualRunner || claimed.manager_id!, scope, 'link.results.failed'); return;
    }
    db.prepare('DELETE FROM platform_link_results WHERE organization_id=? AND project_id=?').run(...args(scope));
    const insert = db.prepare('INSERT OR IGNORE INTO platform_link_results(organization_id,project_id,tag,source,sessions,key_events) VALUES(?,?,?,?,?,?)');
    for (const item of report.rows) if (LINK_TAG.test(item.tag) && /^[a-z0-9._-]{1,40}$/.test(item.source) && Number.isSafeInteger(item.sessions) && item.sessions >= 0 && Number.isFinite(item.keyEvents) && item.keyEvents >= 0) insert.run(...args(scope), item.tag, item.source, item.sessions, item.keyEvents);
    db.prepare("UPDATE platform_link_tracking SET state='ready',reason=NULL,result_state=?,period_from=?,period_to=?,timezone=?,checked_at=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE organization_id=? AND project_id=?").run(report.status, period.from, period.to, report.timezone, report.checkedAt, done, ...args(scope));
    audit(db, manualRunner || claimed.manager_id!, scope, 'link.results.sync');
  }).immediate();
  return true;
}

// Private cron entry point: at most one due project per tick, read as the person who chose its GA4 property.
export async function syncDueLinkResults(db: Database.Database, key: string, read: LinkResultsReader = readGoogleLinkResults, refresh = refreshGoogleCredentials) {
  const now = new Date().toISOString();
  const due = db.prepare("SELECT organization_id,project_id FROM platform_link_tracking WHERE connection_id IS NOT NULL AND next_sync_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_sync_at LIMIT 1").get(now, now) as { organization_id: string; project_id: string } | undefined;
  if (!due) return 0;
  try { return await syncLinkResults(db, { organizationId: due.organization_id, projectId: due.project_id }, key, read, refresh) ? 1 : 0; }
  catch { return 0; }
}
