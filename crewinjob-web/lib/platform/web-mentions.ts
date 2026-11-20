import type { Db } from '../db/client';
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { fetchPublic } from '../site-audit';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { projectFeatures } from './entitlements';
import { ryzevoFeature } from './ryzevo-features';
import { inboxSignal } from './inbox-signals';

// Web mentions: what the open web says about the brand, beyond the project's own social accounts. Sources are Google
// News searches for the team's words (its public RSS) and RSS/Atom feeds the team adds (a Google Alerts feed, a forum's
// feed). The worker reads them every 3 hours; each new item is labelled with the same complaint/escalation rules as the
// inbox (inbox-signals.ts) and complaints raise a team alert. Only titles, links and short snippets are kept, 90 days.
export type WebWatch = { enabled: boolean; queries: string[]; feeds: string[]; language: 'tr' | 'en'; checkedAt: string | null; lastError: string | null; canEdit: boolean; limits: { queries: number; feeds: number } };
export type WebMention = { id: string; source: string; title: string; url: string; snippet: string; publishedAt: string | null; level: 'urgent' | 'complaint' | 'none'; state: 'new' | 'seen'; firstSeenAt: string };
type Scope = MarketingScope;
const args = (scope: { organizationId: string; projectId: string }) => [scope.organizationId, scope.projectId] as const;
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const EVERY = 3 * 3600000, KEEP_DAYS = 90, MAX_NEW = 60;

async function authorize(db: Db, scope: Scope, write: boolean) {
  const repo = new PlatformRepository(db), workspace = await repo.workspace(scope.subject, ...args(scope)), pack = workspace?.project.productPack;
  if (!workspace || !(pack === 'standard' || ryzevoFeature(pack, 'brand'))) throw new MarketingStoreError('Web takibi için proje erişimi gerekli.', 403);
  if (write && !await repo.can(scope.subject, ...args(scope), 'content.write')) throw new MarketingStoreError('Web takibini değiştirmek için içerik yazma yetkisi gerekir.', 403);
  return { repo, project: workspace.project };
}
export function normalizeWatch(raw: Record<string, unknown>) {
  const queries = Array.isArray(raw.queries) ? raw.queries.map(item => clean(item, 80)).filter(Boolean) : [];
  if (queries.length > 3) throw new MarketingStoreError('En çok 3 arama ifadesi ekleyin.');
  if (queries.some(item => item.length < 2)) throw new MarketingStoreError('Arama ifadeleri en az 2 harf olmalı.');
  const feeds = Array.isArray(raw.feeds) ? raw.feeds.map(item => clean(item, 500)).filter(Boolean) : [];
  if (feeds.length > 5) throw new MarketingStoreError('En çok 5 besleme ekleyin.');
  for (const feed of feeds) {
    let url: URL; try { url = new URL(feed); } catch { throw new MarketingStoreError('Besleme adresi geçerli bir https bağlantısı olmalı.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new MarketingStoreError('Besleme adresi geçerli bir https bağlantısı olmalı.');
  }
  if (raw.enabled === true && !queries.length && !feeds.length) throw new MarketingStoreError('Takibi açmak için en az bir arama ifadesi veya besleme ekleyin.');
  return { enabled: raw.enabled === true, queries, feeds, language: raw.language === 'en' ? 'en' as const : 'tr' as const };
}
export async function webWatch(db: Db, scope: Scope): Promise<WebWatch> {
  const { repo, project } = await authorize(db, scope, false);
  const row = await db.prepare('SELECT enabled,queries_json,feeds_json,language,checked_at,last_error FROM platform_web_watch WHERE organization_id=? AND project_id=?').get(...args(scope)) as { enabled: number; queries_json: string; feeds_json: string; language: 'tr' | 'en'; checked_at: string | null; last_error: string | null } | undefined;
  return { enabled: Boolean(row?.enabled), queries: row ? JSON.parse(row.queries_json) : [project.name], feeds: row ? JSON.parse(row.feeds_json) : [], language: row?.language || (project.language === 'en' ? 'en' : 'tr'),
    checkedAt: row?.checked_at || null, lastError: row?.last_error || null, canEdit: await repo.can(scope.subject, ...args(scope), 'content.write'), limits: await watchLimits(db, scope) };
}
// Launch and trials: one search term and no feeds; Growth and higher (and pilots): three terms and five feeds.
async function watchLimits(db: Db, scope: Scope) {
  const features = await projectFeatures(db, scope);
  return { queries: features.webQueries, feeds: features.webFeeds };
}
export async function saveWebWatch(db: Db, scope: Scope, raw: Record<string, unknown>) {
  await authorize(db, scope, true);
  const value = normalizeWatch(raw), now = new Date().toISOString(), limits = await watchLimits(db, scope);
  if (value.enabled && (value.queries.length > limits.queries || value.feeds.length > limits.feeds)) throw new MarketingStoreError(limits.queries === 0
    ? 'Web takibi etkin bir plan gerektirir. Plan ve ödeme bölümünden planınızı yenileyin.'
    : limits.feeds ? `Paketiniz en çok ${limits.queries} arama ifadesi ve ${limits.feeds} besleme içerir. Fazlasını kaldırın veya paketinizi yükseltin.`
    : `Paketiniz en çok ${limits.queries} arama ifadesi içerir; RSS/Atom beslemeleri Growth ve üstü paketlerde. Fazlasını kaldırın veya paketinizi yükseltin.`, 402);
  await db.prepare('INSERT INTO platform_web_watch(organization_id,project_id,enabled,queries_json,feeds_json,language,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET enabled=excluded.enabled,queries_json=excluded.queries_json,feeds_json=excluded.feeds_json,language=excluded.language,checked_at=NULL,last_error=NULL,updated_by=excluded.updated_by,updated_at=excluded.updated_at')
    .run(...args(scope), value.enabled ? 1 : 0, JSON.stringify(value.queries), JSON.stringify(value.feeds), value.language, scope.subject, now);
  await db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(scope.subject, ...args(scope), 'web_watch.save', now);
  return await webWatch(db, scope);
}
export async function webMentions(db: Db, scope: Scope): Promise<WebMention[]> {
  await authorize(db, scope, false);
  const rows = await db.prepare('SELECT id,source,title,url,snippet,published_at,level,state,first_seen_at FROM platform_web_mentions WHERE organization_id=? AND project_id=? ORDER BY first_seen_at DESC,id LIMIT 100').all(...args(scope)) as { id: string; source: string; title: string; url: string; snippet: string; published_at: string | null; level: WebMention['level']; state: WebMention['state']; first_seen_at: string }[];
  return rows.map(row => ({ id: row.id, source: row.source, title: row.title, url: row.url, snippet: row.snippet, publishedAt: row.published_at, level: row.level, state: row.state, firstSeenAt: row.first_seen_at }));
}
export async function markMentions(db: Db, scope: Scope, raw: Record<string, unknown>) {
  await authorize(db, scope, true);
  const ids = Array.isArray(raw.ids) ? raw.ids.filter((id): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)).slice(0, 100) : [];
  for (const id of ids) await db.prepare("UPDATE platform_web_mentions SET state='seen' WHERE id=? AND organization_id=? AND project_id=?").run(id, ...args(scope));
  return await webMentions(db, scope);
}

// RSS 2.0 and Atom, read leniently with patterns (no XML library): title, link, date and a short plain-text snippet.
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => code[0] === '#' ? String.fromCodePoint(code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)) : ENTITIES[code.toLowerCase()] ?? all);
}
const plain = (value: string) => decode(decode(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const tag = (block: string, name: string) => { const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block); return match ? match[1] : ''; };
export function parseFeed(xml: string, origin: string): { title: string; url: string; snippet: string; publishedAt: string | null; source: string }[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return items.slice(0, 50).map(block => {
    let url = plain(tag(block, 'link')) || (/<link[^>]*href="([^"]+)"/i.exec(block)?.[1] ? decode(/<link[^>]*href="([^"]+)"/i.exec(block)![1]) : '');
    // Google Alerts wraps the real address: https://www.google.com/url?...&url=<real>&...
    try { const wrapped = new URL(url); if (wrapped.hostname === 'www.google.com' && wrapped.pathname === '/url' && wrapped.searchParams.get('url')) url = wrapped.searchParams.get('url')!; } catch { url = ''; }
    const date = plain(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated')), parsed = Date.parse(date);
    const source = plain(tag(block, 'source')) || origin;
    return { title: plain(tag(block, 'title')).slice(0, 200), url, snippet: plain(tag(block, 'description') || tag(block, 'summary') || tag(block, 'content')).slice(0, 300), publishedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null, source: source.slice(0, 80) };
  }).filter(item => item.title && /^https?:\/\//.test(item.url));
}
export function newsFeedUrl(query: string, language: 'tr' | 'en') {
  return `https://news.google.com/rss/search?${new URLSearchParams({ q: `"${query}"`, hl: language === 'en' ? 'en-US' : 'tr', gl: language === 'en' ? 'US' : 'TR', ceid: language === 'en' ? 'US:en' : 'TR:tr' })}`;
}
type Reader = (url: URL) => Promise<string>;
const readFeed: Reader = async url => {
  const { response } = await fetchPublic(url, 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5');
  if (response.status !== 200) { await response.body?.cancel().catch(() => undefined); throw new Error(`status ${response.status}`); }
  const text = await response.text();
  if (text.length > 3_000_000) throw new Error('too_large');
  return text;
};

// Worker step: the project read least recently, once its last read is 3 hours old (one project per tick).
export async function readDueWebMentions(db: Db, now = Date.now(), reader: Reader = readFeed) {
  const due = await db.prepare("SELECT w.organization_id,w.project_id,w.queries_json,w.feeds_json,w.language FROM platform_web_watch w JOIN platform_projects p ON p.id=w.project_id AND p.organization_id=w.organization_id WHERE w.enabled=1 AND (w.checked_at IS NULL OR w.checked_at<?) ORDER BY w.checked_at IS NOT NULL,w.checked_at LIMIT 1")
    .get(new Date(now - EVERY).toISOString()) as { organization_id: string; project_id: string; queries_json: string; feeds_json: string; language: 'tr' | 'en' } | undefined;
  if (!due) return 0;
  const scope = { organizationId: due.organization_id, projectId: due.project_id }, at = new Date(now).toISOString();
  await db.prepare('UPDATE platform_web_watch SET checked_at=? WHERE organization_id=? AND project_id=?').run(at, ...args(scope));
  const sources = [...(JSON.parse(due.queries_json) as string[]).map(query => ({ url: newsFeedUrl(query, due.language), origin: 'Google News' })), ...(JSON.parse(due.feeds_json) as string[]).map(url => ({ url, origin: new URL(url).hostname }))];
  let added = 0; const errors: string[] = [];
  for (const source of sources) {
    let items: ReturnType<typeof parseFeed>;
    try { items = parseFeed(await reader(new URL(source.url)), source.origin); } catch { errors.push(source.origin); continue; }
    for (const item of items) {
      if (added >= MAX_NEW) break;
      const hash = createHash('sha256').update(item.url).digest('hex');
      if (await db.prepare('SELECT 1 FROM platform_web_mentions WHERE organization_id=? AND project_id=? AND url_hash=?').get(...args(scope), hash)) continue;
      // Items older than the keep window are not news to anyone.
      if (item.publishedAt && Date.parse(item.publishedAt) < now - KEEP_DAYS * 86400000) continue;
      const level = inboxSignal(`${item.title} ${item.snippet}`).level;
      await db.prepare("INSERT INTO platform_web_mentions(id,organization_id,project_id,url_hash,source,title,url,snippet,published_at,level,state,first_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,'new',?)")
        .run(randomUUID(), ...args(scope), hash, item.source, item.title, item.url.slice(0, 1000), item.snippet, item.publishedAt, level, at);
      added++;
    }
  }
  await db.prepare('UPDATE platform_web_watch SET last_error=? WHERE organization_id=? AND project_id=?').run(errors.length ? `unreadable:${errors.slice(0, 5).join(',')}`.slice(0, 300) : null, ...args(scope));
  await db.prepare('DELETE FROM platform_web_mentions WHERE organization_id=? AND project_id=? AND first_seen_at<?').run(...args(scope), new Date(now - KEEP_DAYS * 86400000).toISOString());
  return added;
}
// For the team alerts: unseen complaints and escalations found in the last 3 days.
export async function recentNegativeMentions(db: Db, scope: { organizationId: string; projectId: string }, now = Date.now()) {
  return await db.prepare("SELECT id,level,first_seen_at FROM platform_web_mentions WHERE organization_id=? AND project_id=? AND state='new' AND level IN ('urgent','complaint') AND first_seen_at>? ORDER BY first_seen_at DESC LIMIT 100")
    .all(...args(scope), new Date(now - 3 * 86400000).toISOString()) as { id: string; level: 'urgent' | 'complaint'; first_seen_at: string }[];
}
