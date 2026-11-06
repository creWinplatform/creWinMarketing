import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { GrowthCoach } from './coach';
import { pageFacts, readIntakePage, robotsDisallows, type IntakeReader } from './coach-intake';
import type { CoachCompetitor, CompetitorSiteChange, CompetitorSiteView } from './coach-types';

// Competitor watch for websites: the competitors' public home page (and their pricing page, when linked) are read once
// a week, robots.txt respected, with the site audit's public fetcher. What changed since the last read is noted by
// fixed rules: the title or description, the main headings, new content pages, the pricing page. The team gets the
// change and a suggestion; nothing is sent to the competitor and no AI is used.
type Snapshot = { title: string; description: string; headings: string[]; paths: { path: string; text: string }[]; pricing: { url: string; hash: string; excerpt: string } | null };
type Scope = { organizationId: string; projectId: string };
const DAY = 86400000, WEEK = 7 * DAY;
const args = (scope: Scope) => [scope.organizationId, scope.projectId] as const;
export const competitorSiteKey = (url: string) => createHash('sha256').update(new URL(url).toString().replace(/\/+$/, '').toLowerCase()).digest('hex').slice(0, 16);
const CONTENT = /blog|haber|news|yaz[ıi]|makale|article|post|duyuru|kampanya|campaign|[üu]r[üu]n|product|hizmet|service|[çc][öo]z[üu]m|solution|feature|[öo]zellik|case|vaka|m[üu][şs]teri/i;
const LEGAL = /terms|privacy|policy|cookie|legal|kvkk|gizlilik|[çc]erez|ko[şs]ul|s[öo]zle[şs]me|ayd[ıi]nlatma|login|giri[şs]|signup|kay[ıi]t-ol|cart|sepet/i;
const PRICING = /fiyat|pricing|price|paket|plans?\b|tarife/i;

export function siteSnapshot(homeHtml: string, homeUrl: string, pricingHtml: string | null, pricingUrl: string | null): Snapshot {
  const home = pageFacts(homeHtml, homeUrl), origin = new URL(home.url), seen = new Set<string>(), paths: Snapshot['paths'] = [];
  for (const link of home.links) {
    let url: URL; try { url = new URL(link.href, origin); } catch { continue; }
    if (url.hostname !== origin.hostname || !/^https?:$/.test(url.protocol) || /\.(pdf|jpe?g|png|gif|webp|svg|zip|css|js)$/i.test(url.pathname)) continue;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || seen.has(path) || LEGAL.test(path)) continue;
    seen.add(path); paths.push({ path, text: link.text.slice(0, 80) }); if (paths.length >= 200) break;
  }
  const pricing = pricingHtml && pricingUrl ? (() => { const facts = pageFacts(pricingHtml, pricingUrl); return { url: facts.url, hash: createHash('sha256').update(facts.text).digest('hex'), excerpt: facts.text.slice(0, 300) }; })() : null;
  return { title: home.title, description: home.description, headings: home.headings.slice(0, 12), paths, pricing };
}
// Changes worth a look; the first read is only a baseline. Rotating home-page headings are noise, so one heading alone is not reported.
export function siteChanges(before: Snapshot, after: Snapshot): { kind: CompetitorSiteChange['kind']; detail: Record<string, unknown> }[] {
  const changes: ReturnType<typeof siteChanges> = [];
  if (before.title && after.title && before.title !== after.title) changes.push({ kind: 'title', detail: { before: before.title, after: after.title } });
  if (before.description && after.description && before.description !== after.description) changes.push({ kind: 'description', detail: { before: before.description, after: after.description } });
  const added = after.headings.filter(item => !before.headings.includes(item)), removed = before.headings.filter(item => !after.headings.includes(item));
  if (added.length >= 2 || removed.length >= 2) changes.push({ kind: 'headings', detail: { added: added.slice(0, 5), removed: removed.slice(0, 5) } });
  const known = new Set(before.paths.map(item => item.path)), fresh = after.paths.filter(item => !known.has(item.path) && CONTENT.test(`${item.path} ${item.text}`));
  if (fresh.length) changes.push({ kind: 'new_pages', detail: { pages: fresh.slice(0, 5) } });
  if (before.pricing && after.pricing && before.pricing.hash !== after.pricing.hash) changes.push({ kind: 'pricing', detail: { url: after.pricing.url, before: before.pricing.excerpt, after: after.pricing.excerpt } });
  return changes;
}

function competitors(db: Database.Database, scope: Scope): (CoachCompetitor & { key: string })[] {
  const row = db.prepare('SELECT competitors_json FROM platform_coach_brand WHERE organization_id=? AND project_id=?').get(...args(scope)) as { competitors_json: string | null } | undefined;
  let list: CoachCompetitor[] = []; try { list = JSON.parse(row?.competitors_json || '[]'); } catch { list = []; }
  return list.filter(item => item.url && /^https?:\/\//i.test(item.url)).flatMap(item => { try { return [{ ...item, key: competitorSiteKey(item.url) }]; } catch { return []; } });
}
const latest = (db: Database.Database, scope: Scope, key: string) => db.prepare('SELECT status,snapshot_json,checked_at FROM platform_competitor_sites WHERE organization_id=? AND project_id=? AND site_key=? ORDER BY checked_at DESC LIMIT 1').get(...args(scope), key) as { status: 'ok' | 'blocked' | 'unreadable'; snapshot_json: string | null; checked_at: string } | undefined;

// Reads one competitor site now and records the snapshot and any changes.
export async function checkCompetitorSite(db: Database.Database, scope: Scope, site: CoachCompetitor & { key: string }, reader: IntakeReader = readIntakePage, now = Date.now()) {
  const start = new URL(site.url), at = new Date(now).toISOString(), day = at.slice(0, 10);
  let status: 'ok' | 'blocked' | 'unreadable' = 'unreadable', snapshot: Snapshot | null = null;
  try {
    let robots = '';
    try { const page = await reader(new URL('/robots.txt', start), 'text/plain'); if (page.status === 200 && /text\/plain/i.test(page.type)) robots = page.body; } catch { robots = ''; }
    if (robotsDisallows(robots, start.pathname || '/')) status = 'blocked';
    else {
      const home = await reader(start, 'text/html,application/xhtml+xml');
      if (home.status === 200 && /html/i.test(home.type) && home.body) {
        const facts = pageFacts(home.body, home.url), host = new URL(home.url).hostname;
        const pricingHref = facts.links.map(link => { try { const url = new URL(link.href, home.url); return url.hostname === host && PRICING.test(`${url.pathname} ${link.text}`) && !LEGAL.test(url.pathname) ? url.toString() : ''; } catch { return ''; } }).find(Boolean) || null;
        let pricingHtml: string | null = null, pricingUrl: string | null = null;
        if (pricingHref && !robotsDisallows(robots, new URL(pricingHref).pathname)) {
          try { const page = await reader(new URL(pricingHref), 'text/html,application/xhtml+xml'); if (page.status === 200 && /html/i.test(page.type) && new URL(page.url).hostname === host) { pricingHtml = page.body; pricingUrl = page.url; } } catch { pricingHtml = null; }
        }
        snapshot = siteSnapshot(home.body, home.url, pricingHtml, pricingUrl); status = 'ok';
      }
    }
  } catch { status = 'unreadable'; }
  const previous = latest(db, scope, site.key), before = previous?.status === 'ok' && previous.snapshot_json ? JSON.parse(previous.snapshot_json) as Snapshot : null;
  const changes = snapshot && before ? siteChanges(before, snapshot) : [];
  db.transaction(() => {
    db.prepare('INSERT INTO platform_competitor_sites VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,project_id,site_key,checked_on) DO UPDATE SET url=excluded.url,name=excluded.name,status=excluded.status,snapshot_json=excluded.snapshot_json,checked_at=excluded.checked_at')
      .run(...args(scope), site.key, site.url, site.name, day, status, snapshot ? JSON.stringify(snapshot) : null, at);
    for (const change of changes) db.prepare('INSERT INTO platform_competitor_site_changes VALUES(?,?,?,?,?,?,?,?)').run(`cschange_${randomUUID()}`, ...args(scope), site.key, site.name, change.kind, JSON.stringify(change.detail), at);
    // Snapshots older than 180 days go (each site keeps its newest); change notes stay a year.
    db.prepare('DELETE FROM platform_competitor_sites WHERE organization_id=? AND project_id=? AND site_key=? AND checked_at<? AND checked_at<(SELECT MAX(checked_at) FROM platform_competitor_sites WHERE organization_id=? AND project_id=? AND site_key=?)').run(...args(scope), site.key, new Date(now - 180 * DAY).toISOString(), ...args(scope), site.key);
    db.prepare('DELETE FROM platform_competitor_site_changes WHERE organization_id=? AND project_id=? AND detected_at<?').run(...args(scope), new Date(now - 365 * DAY).toISOString());
  })();
  return { status, changes: changes.length };
}

// Worker: the competitor site read least recently, once it is a week old (one site per tick, across projects).
export async function refreshDueCompetitorSites(db: Database.Database, reader: IntakeReader = readIntakePage, now = Date.now()) {
  const projects = db.prepare("SELECT organization_id,project_id FROM platform_coach_brand WHERE competitors_json IS NOT NULL AND competitors_json LIKE '%http%'").all() as { organization_id: string; project_id: string }[];
  let due: { scope: Scope; site: CoachCompetitor & { key: string }; at: number } | null = null;
  for (const project of projects) {
    const scope = { organizationId: project.organization_id, projectId: project.project_id };
    for (const site of competitors(db, scope)) {
      const last = latest(db, scope, site.key), at = last ? Date.parse(last.checked_at) : 0;
      if (now - at >= WEEK && (!due || at < due.at)) due = { scope, site, at };
    }
  }
  return due ? checkCompetitorSite(db, due.scope, due.site, reader, now) : null;
}
export function recentCompetitorSiteChanges(db: Database.Database, scope: Scope, now = Date.now(), days = 7) {
  return db.prepare('SELECT id,site_key,name,kind,detected_at FROM platform_competitor_site_changes WHERE organization_id=? AND project_id=? AND detected_at>=? ORDER BY detected_at DESC LIMIT 50').all(...args(scope), new Date(now - days * DAY).toISOString()) as { id: string; site_key: string; name: string; kind: CompetitorSiteChange['kind']; detected_at: string }[];
}

export class CompetitorSites {
  coach: GrowthCoach;
  constructor(private db: Database.Database, private scope: MarketingScope, private reader: IntakeReader = readIntakePage) { this.coach = new GrowthCoach(db, scope); }
  view(): CompetitorSiteView[] {
    this.coach.authorize();
    return competitors(this.db, this.scope).map(site => {
      const last = latest(this.db, this.scope, site.key);
      const changes = (this.db.prepare('SELECT id,kind,detail_json,detected_at FROM platform_competitor_site_changes WHERE organization_id=? AND project_id=? AND site_key=? AND detected_at>=? ORDER BY detected_at DESC LIMIT 10').all(...args(this.scope), site.key, new Date(Date.now() - 90 * DAY).toISOString()) as { id: string; kind: CompetitorSiteChange['kind']; detail_json: string; detected_at: string }[])
        .map(row => ({ id: row.id, kind: row.kind, detail: JSON.parse(row.detail_json) as Record<string, unknown>, detectedAt: row.detected_at }));
      return { key: site.key, name: site.name, url: site.url, status: last?.status || null, checkedAt: last?.checked_at || null, changes };
    });
  }
  // "Check now": at most three reads an hour per project.
  async checkNow(raw: Record<string, unknown>) {
    this.coach.authorize('content.write');
    const site = competitors(this.db, this.scope).find(item => item.key === raw.key); if (!site) throw new MarketingStoreError('Rakip sitesi bulunamadı.', 404);
    const key = `competitor-site:${this.scope.organizationId}:${this.scope.projectId}`, now = Date.now();
    this.db.transaction(() => {
      const old = this.db.prepare('SELECT count,expires_at FROM platform_login_limits WHERE key=?').get(key) as { count: number; expires_at: number } | undefined;
      if (old && old.expires_at > now && old.count >= 3) throw new MarketingStoreError('Rakip sitesi kontrol sınırına ulaşıldı. Bir saat sonra tekrar deneyin.', 429);
      this.db.prepare('INSERT INTO platform_login_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires_at=excluded.expires_at').run(key, old && old.expires_at > now ? old.count + 1 : 1, old && old.expires_at > now ? old.expires_at : now + 3600000);
    }).immediate();
    await checkCompetitorSite(this.db, this.scope, site, this.reader);
    return this.view();
  }
}
