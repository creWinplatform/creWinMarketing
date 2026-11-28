import type { Db } from '../db/client';
import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fetchPublic, readLimited } from '../site-audit';
import { PlatformRepository } from './repository';
import { projectFeatures } from './entitlements';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { extraContacts, suppressedHosts } from './prospect-contacts';
import { joinSegment, segmentExists } from './prospect-segments';
import { isNoSite } from './prospect-types';
import {
  FINDER_LIMITS, FINDER_SECTORS, MAPS_QUOTA, type MapsQuota, FINDER_TERMS_VERSION, SIGNALS, SIGNAL_KEYS,
  type FinderSearch, type FinderSettings, type FinderSnapshot, type ProspectAnalysis, type ProspectContact, type ProspectInsight, type ProspectScore, type Signal, type SignalKey, type SignalWish,
} from './prospect-finder-types';

// Sales assistant, part 2 of the B2B prospects. Companies are found on Google Maps (through DataForSEO, after the
// project owner accepted the terms) or on OpenStreetMap; each company's own public site is read for signals and for
// the contact addresses it publishes itself (role addresses such as info@, never personal ones); a score orders the
// list; a mini analysis can be shared through a link. Nothing here sends anything to anyone.
type Json = Record<string, unknown>;
export type FinderHttp = (url: string, init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text: string }>;
export type SiteReader = (url: string) => Promise<{ finalUrl: string; html: string }>;
type Listing = { name: string; website: string; city: string; address: string; category: string; rating: number | null; reviews: number | null; phone: string; email: string; ref: string };
type InsightRow = { prospect_id: string; source: ProspectInsight['source']; source_ref: string | null; city: string; address: string; category: string; rating: number | null; reviews: number | null; signals_json: string | null; scanned_at: string | null };
type ProspectRow = { id: string; company: string; website: string; reason: string; reason_source: string | null; check_status: string; state: string };

const AGENT = 'Ryzevo/1.0 (+https://ryzevo.com)';
const OVERPASS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const NOT_A_SITE = /(^|\.)(facebook|instagram|linktr|wa|whatsapp|twitter|x|tiktok|youtube|google|goo|maps\.app\.goo|sahibinden|yemeksepeti|trendyol|hepsiburada|booking|tripadvisor)\.[a-z.]+$/i;
// Role addresses: a company's own published contact points, not a person.
const ROLE = /^(info|iletisim|contact|hello|merhaba|bilgi|satis|sales|destek|support|office|ofis|randevu|rezervasyon|reservation|booking|muhasebe|siparis|order|musteri|customer|hizmet|kurumsal|pazarlama|marketing|ik|hr|kariyer|career|team|mail|admin|yonetim|klinik|resepsiyon|reception)([._-][a-z0-9]+)?$/i;
export const ROLE_ADDRESS = ROLE;
const JUNK_DOMAIN = /(^|\.)(example\.(com|org)|sentry\.io|wixpress\.com|domain\.com|email\.com|yourdomain\.com|sentry-next\.wixpress\.com)$/i;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const decode = (value: string) => value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#64;/g, '@').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
const plain = (html: string) => decode(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export function siteOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.') || NOT_A_SITE.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}
const host = (value: string) => { try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

export const finderHttp: FinderHttp = async (url, init) => {
  const response = await fetch(url, { method: init.method, headers: { 'User-Agent': AGENT, Accept: 'application/json', ...init.headers }, body: init.body, signal: AbortSignal.timeout(40000) });
  return { status: response.status, text: (await response.text()).slice(0, 5_000_000) };
};
export const readSite: SiteReader = async url => {
  const { response, finalUrl } = await fetchPublic(new URL(url));
  const type = response.headers.get('content-type') || '';
  if (response.status !== 200 || (!type.includes('text/html') && !type.includes('application/xhtml+xml'))) throw new Error('not_html');
  return { finalUrl: finalUrl.toString(), html: await readLimited(response, 1_000_000) };
};
export const dataForSeoConfigured = () => Boolean(process.env.PLATFORM_DATAFORSEO_LOGIN && process.env.PLATFORM_DATAFORSEO_PASSWORD);
// Platform-wide ceiling for paid requests (the wallet guard); the server may lower or raise it.
const platformCap = (name: 'DAY' | 'MONTH', fallback: number) => { const value = Number(process.env[`PLATFORM_DATAFORSEO_${name}_CAP`]); return Number.isSafeInteger(value) && value >= 0 ? value : fallback; };
const MAPS = 'dataforseo_maps';

// ---- Signals and contacts from a company's own page ----
export function readSignals(html: string, finalUrl: string, now = new Date()): Signal[] {
  const lower = html.slice(0, 1_000_000), text = plain(lower), found = (pattern: RegExp, source = lower) => { const match = pattern.exec(source); return match ? clean(match[0], 80) : ''; };
  const description = decode(lower.match(/<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i)?.[0].match(/content\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '').trim();
  const years = [...text.matchAll(/(?:©|copyright|telif)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/gi)].map(match => Number(match[1]));
  const signal = (key: SignalKey, evidence: string, present = Boolean(evidence)): Signal => ({ key, present, evidence: present ? evidence : '' });
  const list: Signal[] = [
    signal('https', finalUrl.startsWith('https://') ? 'https' : ''),
    signal('mobile', found(/<meta\b[^>]*name\s*=\s*["']viewport["'][^>]*>/i)),
    signal('online_booking', found(/calendly\.com|booksy\.com|fresha\.com|treatwell\.|setmore\.com|simplybook\.|doktortakvimi\.com|randevuburada|appointy\.com|acuityscheduling\.com|opentable\.|randevu al|online randevu|randevu oluştur|rezervasyon yap|online rezervasyon|book now|book online|book an appointment/i)),
    signal('whatsapp', found(/wa\.me\/[0-9]*|api\.whatsapp\.com\/send|web\.whatsapp\.com\/send|whatsapp:\/\/send/i)),
    signal('meta_pixel', found(/connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init/i)),
    signal('google_tag', found(/googletagmanager\.com\/(?:gtag\/js|gtm\.js)|google-analytics\.com\/(?:analytics|ga)\.js/i)),
    signal('contact_form', found(/<form\b[\s\S]{0,4000}?(?:type\s*=\s*["']email["']|<textarea)/i) ? 'form' : ''),
    signal('ecommerce', found(/woocommerce|cdn\.shopify\.com|ikas\.|ticimax|ideasoft|tsoft|shopier\.com|sepete ekle|add to cart/i)),
    signal('blog', found(/href\s*=\s*["'][^"']*\/(?:blog|haberler|makaleler|news|articles)(?:[/"'?#]|$)/i)),
    signal('meta_description', description.length >= 50 ? clean(description, 80) : ''),
    signal('social', found(/(?:instagram\.com|facebook\.com|linkedin\.com\/company|tiktok\.com\/@|youtube\.com)\/[A-Za-z0-9_.@-]+/i)),
    signal('hiring', found(/href\s*=\s*["'][^"']*\/(?:kariyer|careers?|jobs|is-ilanlari|acik-pozisyonlar|insan-kaynaklari)(?:[/"'?#.]|$)|açık pozisyonlar|iş ilanlarımız|we(?:'|’)?re hiring|join our team/i)),
    years.length ? signal('fresh', String(Math.max(...years)), Math.max(...years) >= now.getUTCFullYear() - 1) : { key: 'fresh', present: null, evidence: '' },
  ];
  return list;
}
export function readContacts(html: string, pageUrl: string): { emails: string[]; phones: string[] } {
  const emails = new Set<string>(), phones = new Set<string>();
  const add = (raw: string) => {
    const email = decode(raw).trim().toLowerCase().replace(/^mailto:/, '').split('?')[0];
    const [local, domain] = email.split('@');
    if (!local || !domain || email.length > 80 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || /\.(png|jpe?g|gif|webp|svg)$/.test(domain) || JUNK_DOMAIN.test(domain) || !ROLE.test(local)) return;
    emails.add(email);
  };
  for (const match of html.matchAll(/mailto:([^"'?\s>]+)/gi)) add(match[1]);
  for (const match of plain(html).matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) add(match[0]);
  for (const match of html.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) { const digits = decode(match[1]).replace(/[^\d+]/g, ''); if (digits.replace(/\D/g, '').length >= 10 && digits.length <= 16) phones.add(digits); }
  void pageUrl;
  return { emails: [...emails].slice(0, FINDER_LIMITS.emails), phones: [...phones].slice(0, FINDER_LIMITS.phones) };
}
function contactPage(html: string, base: string) {
  for (const match of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    if (!/(iletisim|contact|bize-ulasin|ulasim|kontakt)/i.test(match[1])) continue;
    try { const url = new URL(decode(match[1]), base); if (url.origin === new URL(base).origin && url.href !== base) return url.href; } catch { /* next */ }
  }
  return null;
}
// Score: fit (the written or AI reason), the signals the team chose as opportunities, and whether the company
// publishes a contact address. Without chosen signals the score is over fit and reach only.
export function scoreOf(prospect: Pick<ProspectRow, 'reason' | 'reason_source'>, signals: Signal[] | null, settings: FinderSettings, contacts: { kind: string }[]): ProspectScore {
  const reason = prospect.reason.trim();
  const fit = /^(Güçlü uyum|Strong fit)/.test(reason) ? 40 : /^(Olası uyum|Possible fit)/.test(reason) ? 25 : /^(Zayıf uyum|Weak fit)/.test(reason) ? 5 : reason ? 30 : 0;
  const wished = Object.entries(settings.signals) as [SignalKey, SignalWish][], signalsCounted = wished.length > 0;
  const matched = signals ? wished.filter(([key, wish]) => { const item = signals.find(signal => signal.key === key); return item && item.present !== null && (wish === 'missing' ? !item.present : item.present); }).length : 0;
  const signalPart = signalsCounted ? Math.round((matched / wished.length) * 40) : 0;
  const reach = contacts.some(item => item.kind === 'email') ? 20 : contacts.some(item => item.kind === 'phone') ? 10 : 0;
  return { total: Math.round(((fit + signalPart + reach) / (signalsCounted ? 100 : 60)) * 100), fit, signals: signalPart, reach, signalsCounted };
}

export class ProspectFinder {
  private repo: PlatformRepository;
  constructor(private db: Db, private scope: MarketingScope, private http: FinderHttp = finderHttp, private site: SiteReader = readSite) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private can(permission: 'read' | 'content.write' | 'campaign.approve' | 'billing.manage') { return this.repo.can(this.scope.subject, ...this.args(), permission); }
  private async authorize(permission: 'read' | 'content.write' | 'campaign.approve' | 'billing.manage' = 'read') {
    if (!await this.can('read') || (await this.repo.workspace(this.scope.subject, ...this.args()))?.project.productPack !== 'standard') throw new MarketingStoreError('Aday listesi için standart proje erişimi gerekli.', 403);
    if (!await this.can(permission)) throw new MarketingStoreError(permission === 'billing.manage' ? 'Koşulları yalnız projenin sahibi kabul edebilir.' : 'Bu işlem için içerik yazma yetkisi gerekir.', 403);
  }
  private async audit(operation: string) { await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), operation, new Date().toISOString()); }
  private async used(resource: string) { return (await this.db.prepare('SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource=?').get(...this.args(), new Date().toISOString().slice(0, 10), resource) as { count: number } | undefined)?.count || 0; }
  private async count(resource: string) { await this.db.prepare('INSERT INTO platform_usage VALUES(?,?,?,?,1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1').run(...this.args(), new Date().toISOString().slice(0, 10), resource); }
  private async prospect(id: unknown) {
    const row = typeof id === 'string' ? await this.db.prepare('SELECT id,company,website,reason,reason_source,check_status,state FROM platform_prospects WHERE id=? AND organization_id=? AND project_id=?').get(id, ...this.args()) as ProspectRow | undefined : undefined;
    if (!row) throw new MarketingStoreError('Aday bulunamadı.', 404); return row;
  }
  private async settings(): Promise<FinderSettings> {
    const row = await this.db.prepare('SELECT signals_json FROM platform_prospect_settings WHERE organization_id=? AND project_id=?').get(...this.args()) as { signals_json: string } | undefined;
    return { signals: row ? JSON.parse(row.signals_json) : {} };
  }
  // ---- Paid Google Maps requests ----
  private periods() { const now = new Date().toISOString(); return { day: now.slice(0, 10), month: now.slice(0, 7) }; }
  private async providerCount(scopeKey: string, period: string) { return Number((await this.db.prepare('SELECT requests FROM platform_provider_usage WHERE provider=? AND scope_key=? AND period=?').get(MAPS, scopeKey, period) as { requests: number } | undefined)?.requests || 0); }
  private async projectMapsLimits() {
    // The plan decides: Launch 30, Growth 100, Team 300 a month; a running trial 5; no active plan, none.
    const features = await projectFeatures(this.db, this.args2());
    return features.mapsSearches > 0 ? { day: features.mapsPerDay, month: features.mapsSearches } : null;
  }
  private args2() { return { organizationId: this.scope.organizationId, projectId: this.scope.projectId }; }
  async mapsQuota(): Promise<MapsQuota> {
    const { day, month } = this.periods(), limits = await this.projectMapsLimits(), project = `project:${this.scope.projectId}`;
    const usedToday = await this.providerCount(project, day), usedMonth = await this.providerCount(project, month);
    let blocked: MapsQuota['blocked'] = null;
    if (!limits) blocked = 'inactive';
    else if (usedToday >= limits.day || usedMonth >= limits.month) blocked = 'project';
    else if (await this.providerCount(`user:${this.scope.subject}`, day) >= MAPS_QUOTA.perUserDay) blocked = 'user';
    else if (await this.providerCount('platform', day) >= platformCap('DAY', MAPS_QUOTA.platformDay) || await this.providerCount('platform', month) >= platformCap('MONTH', MAPS_QUOTA.platformMonth)) blocked = 'platform';
    return { usedToday, usedMonth, dayLimit: limits?.day || 0, monthLimit: limits?.month || 0, blocked };
  }
  // Counts one paid request for the project (day and month), the person (day) and the platform (day and month) in one
  // transaction and refuses it when any limit would be passed, so parallel requests cannot slip through. A request
  // that then fails at the provider stays counted (no retry loop at our cost).
  private async reserveMaps() {
    const limits = await this.projectMapsLimits();
    if (!limits) throw new MarketingStoreError('Google Haritalar araması etkin bir plan gerektirir. Plan ve ödeme bölümünden planınızı yenileyin.', 402);
    const { day, month } = this.periods(), dayCap = platformCap('DAY', MAPS_QUOTA.platformDay), monthCap = platformCap('MONTH', MAPS_QUOTA.platformMonth);
    const keys: [string, string, number, string][] = [
      [`project:${this.scope.projectId}`, day, limits.day, `Bu projenin bugünkü Google Haritalar hakkı (${limits.day}) doldu. Yarın tekrar deneyin veya OpenStreetMap ile arayın.`],
      [`project:${this.scope.projectId}`, month, limits.month, `Bu projenin bu ayki Google Haritalar hakkı (${limits.month}) doldu. OpenStreetMap ile arayabilirsiniz.`],
      [`user:${this.scope.subject}`, day, MAPS_QUOTA.perUserDay, `Bugün tüm projelerinizde en çok ${MAPS_QUOTA.perUserDay} Google Haritalar araması yapabilirsiniz. Yarın tekrar deneyin.`],
      ['platform', day, dayCap, 'Google Haritalar araması bugün için geçici olarak kapalı. OpenStreetMap ile arayabilir veya yarın tekrar deneyebilirsiniz.'],
      ['platform', month, monthCap, 'Google Haritalar araması bu ay için geçici olarak kapalı. OpenStreetMap ile arayabilirsiniz.'],
    ];
    await this.db.transaction(async () => {
      for (const [scopeKey, period, limit, message] of keys) {
        await this.db.prepare('INSERT INTO platform_provider_usage(provider,scope_key,period,requests) VALUES(?,?,?,1) ON CONFLICT(provider,scope_key,period) DO UPDATE SET requests=requests+1').run(MAPS, scopeKey, period);
        if (await this.providerCount(scopeKey, period) > limit) throw new MarketingStoreError(message, 429);
      }
    });
    const today = await this.providerCount('platform', day);
    if (today === Math.ceil(dayCap * 0.8)) console.warn(`[ryzevo] DataForSEO Maps: ${today}/${dayCap} platform requests today (80%).`);
  }
  private cacheKey(keyword: string, place: { lat: number; lon: number } | null, language: string) {
    return sha(JSON.stringify([keyword.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim(), place ? [place.lat.toFixed(3), place.lon.toFixed(3)] : null, language]));
  }
  private async cached(key: string) {
    const row = await this.db.prepare('SELECT listings_json,created_at FROM platform_maps_cache WHERE query_hash=?').get(key) as { listings_json: string; created_at: string } | undefined;
    return row && Date.now() - Date.parse(row.created_at) < MAPS_QUOTA.cacheDays * 86400000 ? JSON.parse(row.listings_json) as Listing[] : null;
  }
  private async remember(key: string, listings: Listing[]) {
    const now = new Date().toISOString();
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM platform_maps_cache WHERE query_hash=? OR created_at<?').run(key, new Date(Date.now() - MAPS_QUOTA.cacheDays * 86400000).toISOString());
      await this.db.prepare('INSERT INTO platform_maps_cache(query_hash,listings_json,created_at) VALUES(?,?,?)').run(key, JSON.stringify(listings), now);
    });
  }
  private async terms() { return await this.db.prepare('SELECT accepted_by,accepted_at,terms_version FROM platform_prospect_consents WHERE organization_id=? AND project_id=? AND revoked_at IS NULL').get(...this.args()) as { accepted_by: string; accepted_at: string; terms_version: string } | undefined; }

  async read(): Promise<FinderSnapshot> {
    await this.authorize();
    const settings = await this.settings(), prospects = await this.db.prepare('SELECT id,company,website,reason,reason_source,check_status,state FROM platform_prospects WHERE organization_id=? AND project_id=?').all(...this.args()) as ProspectRow[];
    const insights = new Map((await this.db.prepare('SELECT * FROM platform_prospect_insights WHERE organization_id=? AND project_id=?').all(...this.args()) as InsightRow[]).map(row => [row.prospect_id, row]));
    const contacts = await this.db.prepare('SELECT id,prospect_id,kind,value,source,source_url FROM platform_prospect_contacts WHERE organization_id=? AND project_id=? ORDER BY kind,found_at').all(...this.args()) as (ProspectContact & { prospect_id: string; source_url: string | null })[];
    const reports = new Map((await this.db.prepare('SELECT prospect_id,views,last_viewed_at,expires_at,revoked_at,created_at FROM platform_prospect_reports WHERE organization_id=? AND project_id=?').all(...this.args()) as { prospect_id: string; views: number; last_viewed_at: string | null; expires_at: string; revoked_at: string | null; created_at: string }[]).map(row => [row.prospect_id, row]));
    const extras = await extraContacts(this.db, this.args2()), changes = new Map<string, string>();
    try { for (const row of await this.db.prepare("SELECT prospect_id,MAX(created_at) at FROM platform_prospect_events WHERE organization_id=? AND project_id=? AND kind='site_changed' AND created_at>? GROUP BY prospect_id").all(...this.args(), new Date(Date.now() - 60 * 86400000).toISOString()) as { prospect_id: string; at: string }[]) changes.set(row.prospect_id, row.at); } catch { /* before schema 83 */ }
    const now = new Date().toISOString(), out: Record<string, ProspectInsight> = {};
    for (const prospect of prospects) {
      const insight = insights.get(prospect.id), own = [...contacts.filter(item => item.prospect_id === prospect.id), ...extras.filter(item => item.prospectId === prospect.id).map(item => ({ ...item.contact, source_url: null }))], signals = insight?.signals_json ? JSON.parse(insight.signals_json) as Signal[] : null, report = reports.get(prospect.id);
      out[prospect.id] = { source: insight?.source || 'manual', city: insight?.city || '', address: insight?.address || '', category: insight?.category || '', rating: insight?.rating ?? null, reviews: insight?.reviews ?? null,
        signals, scannedAt: insight?.scanned_at || null, score: scoreOf(prospect, signals, settings, own),
        contacts: own.map(item => ({ id: item.id, kind: item.kind, value: item.value, source: item.source, sourceUrl: item.source_url, ...('person' in item ? { person: item.person, confidence: item.confidence, note: item.note } : {}) })),
        triggers: { hiring: Boolean(signals?.find(item => item.key === 'hiring')?.present), newBusiness: insight?.source === 'maps' && insight.reviews !== null && insight.rating !== null && Number(insight.reviews) < 10, siteChangedAt: changes.get(prospect.id) || null },
        report: report ? { active: !report.revoked_at && report.expires_at > now, views: Number(report.views), lastViewedAt: report.last_viewed_at, expiresAt: report.expires_at, createdAt: report.created_at } : null };
    }
    const terms = await this.terms();
    const searches = (await this.db.prepare('SELECT id,source,city,sector,found,added,without_website,status,created_at FROM platform_prospect_searches WHERE organization_id=? AND project_id=? ORDER BY created_at DESC LIMIT 10').all(...this.args()) as Json[])
      .map(row => ({ id: row.id, source: row.source, city: row.city, sector: row.sector, found: Number(row.found), added: Number(row.added), withoutWebsite: Number(row.without_website), status: row.status, createdAt: row.created_at }) as FinderSearch);
    return { insights: out, settings, maps: await this.mapsQuota(), searchesLeft: Math.max(0, FINDER_LIMITS.searchesPerDay - await this.used('prospect_search')), searches, mapsConfigured: dataForSeoConfigured(),
      termsAccepted: terms && terms.terms_version === FINDER_TERMS_VERSION ? { by: terms.accepted_by, at: terms.accepted_at } : null, canWrite: await this.can('content.write'), canApprove: await this.can('campaign.approve'), canAcceptTerms: await this.can('billing.manage') };
  }
  async saveSettings(raw: Json) {
    await this.authorize('content.write');
    const input = raw.signals && typeof raw.signals === 'object' && !Array.isArray(raw.signals) ? raw.signals as Json : {};
    const signals = Object.fromEntries(SIGNAL_KEYS.filter(key => input[key] === 'missing' || input[key] === 'present').map(key => [key, input[key]])), now = new Date().toISOString();
    await this.db.prepare('INSERT INTO platform_prospect_settings(organization_id,project_id,signals_json,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET signals_json=excluded.signals_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(...this.args(), JSON.stringify(signals), this.scope.subject, now);
    await this.audit('prospect.finder.settings');
    return await this.read();
  }
  // The project owner accepts the data provider terms once (versioned); recorded in the audit log.
  async acceptTerms(raw: Json) {
    await this.authorize('billing.manage');
    if (raw.accepted !== true || raw.version !== FINDER_TERMS_VERSION) throw new MarketingStoreError('Devam etmek için koşulları okuyup kabul edin.');
    const now = new Date().toISOString();
    await this.db.prepare('INSERT INTO platform_prospect_consents(organization_id,project_id,terms_version,accepted_by,accepted_at,revoked_by,revoked_at) VALUES(?,?,?,?,?,NULL,NULL) ON CONFLICT(organization_id,project_id) DO UPDATE SET terms_version=excluded.terms_version,accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at,revoked_by=NULL,revoked_at=NULL').run(...this.args(), FINDER_TERMS_VERSION, this.scope.subject, now);
    await this.audit(`prospect.finder.terms.accept:${FINDER_TERMS_VERSION}`);
    return await this.read();
  }
  async revokeTerms() {
    await this.authorize('billing.manage');
    await this.db.prepare('UPDATE platform_prospect_consents SET revoked_by=?,revoked_at=? WHERE organization_id=? AND project_id=? AND revoked_at IS NULL').run(this.scope.subject, new Date().toISOString(), ...this.args());
    await this.audit('prospect.finder.terms.revoke');
    return await this.read();
  }

  // ---- Discovery ----
  private async json(url: string, init: Parameters<FinderHttp>[1]) { const response = await this.http(url, init); if (response.status !== 200) throw new Error(`http_${response.status}`); return JSON.parse(response.text) as unknown; }
  private async geocode(city: string) {
    const results = await this.json(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q: city, format: 'jsonv2', limit: '1', addressdetails: '1', 'accept-language': 'tr' })}`, { method: 'GET' }) as Json[];
    const place = results[0]; if (!place) return null;
    return { type: String(place.osm_type), id: Number(place.osm_id), lat: Number(place.lat), lon: Number(place.lon), country: clean((place.address as Json | undefined)?.country, 60), name: clean(place.name, 80) };
  }
  private async fromMaps(keyword: string, place: Awaited<ReturnType<ProspectFinder['geocode']>>, language: 'tr' | 'en'): Promise<Listing[]> {
    const auth = Buffer.from(`${process.env.PLATFORM_DATAFORSEO_LOGIN}:${process.env.PLATFORM_DATAFORSEO_PASSWORD}`).toString('base64');
    const task = { keyword: keyword.slice(0, 200), language_code: language, depth: 100, ...(place ? { location_coordinate: `${place.lat.toFixed(6)},${place.lon.toFixed(6)},13z` } : { location_code: 2792 }) };
    const payload = await this.json('https://api.dataforseo.com/v3/serp/google/maps/live/advanced', { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify([task]) }) as Json;
    const result = ((payload.tasks as Json[] | undefined)?.[0]) as Json | undefined;
    if (payload.status_code !== 20000 || !result || result.status_code !== 20000) throw new Error(`dataforseo_${String(result?.status_code || payload.status_code)}`);
    const items = (((result.result as Json[] | undefined)?.[0] as Json | undefined)?.items as Json[] | undefined) || [];
    return items.filter(item => item.type === 'maps_search' && typeof item.title === 'string').map(item => {
      const info = (item.address_info || {}) as Json, rating = (item.rating || {}) as Json;
      return { name: clean(item.title, 120), website: clean(item.url, 300), city: clean(info.city || info.borough, 80), address: clean(item.address, 200), category: clean(item.category, 80),
        rating: typeof rating.value === 'number' ? rating.value : null, reviews: typeof rating.votes_count === 'number' ? rating.votes_count : null, phone: clean(item.phone, 30), email: '', ref: clean(item.place_id || item.cid, 120) };
    });
  }
  private async fromOsm(sectorId: string, place: NonNullable<Awaited<ReturnType<ProspectFinder['geocode']>>>): Promise<Listing[]> {
    const sector = FINDER_SECTORS.find(item => item.id === sectorId); if (!sector) return [];
    const filter = place.type === 'relation' ? `(area.a)` : `(around:5000,${place.lat},${place.lon})`;
    const parts = sector.osm.flatMap(([key, value]) => ['website', 'contact:website'].map(site => `nwr["${key}"="${value}"]["${site}"]${filter};`)).join('');
    const query = `[out:json][timeout:25];${place.type === 'relation' ? `area(${3600000000 + place.id})->.a;` : ''}(${parts});out tags center 120;`;
    let lastError: unknown = null;
    for (const server of OVERPASS) {
      try {
        const payload = await this.json(server, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }).toString() }) as Json;
        return ((payload.elements as Json[] | undefined) || []).map(element => {
          const tags = (element.tags || {}) as Record<string, string>;
          return { name: clean(tags.name || tags.brand, 120), website: clean(tags.website || tags['contact:website'], 300), city: clean(tags['addr:district'] || tags['addr:city'] || place.name, 80),
            address: clean([tags['addr:street'], tags['addr:housenumber'], tags['addr:district'] || tags['addr:city']].filter(Boolean).join(' '), 200), category: sector.tr, rating: null, reviews: null,
            phone: clean(tags.phone || tags['contact:phone'], 30), email: clean(tags.email || tags['contact:email'], 80), ref: `${element.type}/${element.id}` };
        });
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('overpass');
  }
  // Finds companies for a city and a sector and adds the ones with a website as candidates (duplicates skipped).
  async discover(raw: Json) {
    await this.authorize('content.write');
    const city = clean(raw.city, 80), sectorText = clean(raw.sector, 80), source = raw.source === 'osm' ? 'osm' : 'maps';
    if (city.length < 2 || sectorText.length < 2) throw new MarketingStoreError('Şehir veya ilçe ile sektörü yazın.');
    if (await this.used('prospect_search') >= FINDER_LIMITS.searchesPerDay) throw new MarketingStoreError('Bugünkü firma arama hakkınız doldu. Yarın tekrar deneyin.', 429);
    // Businesses without a website (Google Maps only: OpenStreetMap lists only those with one) when the team asks.
    const includeNoSite = raw.includeNoSite === true && source === 'maps';
    // A search made for a customer group puts the companies it finds under that group.
    const segmentId = await segmentExists(this.db, this.args2(), raw.segmentId) ? String(raw.segmentId) : null;
    const sectorId = FINDER_SECTORS.find(item => item.id === raw.sectorId || item.tr.toLocaleLowerCase('tr') === sectorText.toLocaleLowerCase('tr') || item.en.toLowerCase() === sectorText.toLowerCase())?.id || '';
    if (source === 'maps') {
      if (!dataForSeoConfigured()) throw new MarketingStoreError('Google Haritalar araması bu sunucuda henüz yapılandırılmadı. OpenStreetMap ile arayabilirsiniz.', 503);
      const terms = await this.terms(); if (!terms || terms.terms_version !== FINDER_TERMS_VERSION) throw new MarketingStoreError('Google Haritalar araması için proje sahibinin veri sağlayıcı koşullarını kabul etmesi gerekir.', 409);
    } else if (!sectorId) throw new MarketingStoreError('OpenStreetMap yalnız listedeki sektörlerle aranabilir.');
    const project = (await this.repo.workspace(this.scope.subject, ...this.args()))!.project, language = project.language === 'en' ? 'en' : 'tr';
    if (source === 'maps') {
      const quota = await this.mapsQuota();
      if (quota.blocked === 'inactive') throw new MarketingStoreError('Google Haritalar araması etkin bir plan gerektirir. Plan ve ödeme bölümünden planınızı yenileyin.', 402);
    }
    await this.count('prospect_search');
    let listings: Listing[] = [], country = '', failed = false;
    try {
      if (source === 'maps') {
        // A repeated search within 30 days comes from the shared cache: no paid request, no quota used.
        const place = await this.geocode(city).catch(() => null), keyword = `${sectorText} ${city}`, key = this.cacheKey(keyword, place, language); country = place?.country || '';
        const hit = await this.cached(key);
        if (hit) listings = hit;
        else { await this.reserveMaps(); listings = await this.fromMaps(keyword, place, language); await this.remember(key, listings); }
      } else {
        const place = await this.geocode(city); country = place?.country || '';
        if (!place) throw new MarketingStoreError('Bu şehir veya ilçe haritada bulunamadı. Yazımı kontrol edin.', 404); listings = await this.fromOsm(sectorId, place);
      }
    } catch (error) { failed = true; if (error instanceof MarketingStoreError) throw error; }
    const now = new Date().toISOString(), searchId = `psearch_${randomUUID()}`;
    if (failed) {
      await this.db.prepare("INSERT INTO platform_prospect_searches(id,organization_id,project_id,source,city,sector,found,added,without_website,status,created_by,created_at) VALUES(?,?,?,?,?,?,0,0,0,'failed',?,?)").run(searchId, ...this.args(), source, city, sectorText, this.scope.subject, now);
      throw new MarketingStoreError(source === 'maps' ? 'Google Haritalar sonuçları şu anda alınamadı. Biraz sonra tekrar deneyin.' : 'OpenStreetMap şu anda yanıt vermiyor. Biraz sonra tekrar deneyin.', 502);
    }
    const withSite = listings.map(item => ({ ...item, origin: siteOrigin(item.website) })).filter((item): item is Listing & { origin: string } => Boolean(item.origin && item.name)), withoutWebsite = listings.length - withSite.length;
    // Companies that asked never to be contacted again are not added back.
    const suppressed = await suppressedHosts(this.db, this.args2());
    const added = await this.db.transaction(async () => {
      const existing = await this.db.prepare('SELECT website FROM platform_prospects WHERE organization_id=? AND project_id=?').all(...this.args()) as { website: string }[];
      const seen = new Set(existing.map(row => host(row.website))), listed = new Set(existing.map(row => row.website)); let room = Math.max(0, 200 - existing.length), count = 0, noSite = 0; const ids: string[] = [];
      for (const item of withSite) {
        if (count >= FINDER_LIMITS.perSearch || room <= 0) break;
        const key = host(item.origin); if (!key || seen.has(key) || suppressed.has(key)) continue; seen.add(key);
        const id = `prospect_${randomUUID()}`;
        await this.db.prepare('INSERT INTO platform_prospects(id,organization_id,project_id,company,website,sector,country,reason,contact_role,reason_source,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, ...this.args(), item.name, item.origin, (item.category || sectorText).slice(0, 80), country, '', '', null, this.scope.subject, now, now);
        await this.db.prepare('INSERT INTO platform_prospect_insights(prospect_id,organization_id,project_id,source,source_ref,city,address,category,rating,reviews,signals_json,scanned_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL,NULL,?)').run(id, ...this.args(), source, item.ref || null, item.city, item.address, item.category, item.rating, item.reviews, now);
        // A business phone or a role address the listing itself publishes.
        if (/^\+?[\d\s()-]{10,20}$/.test(item.phone)) await this.contact(id, 'phone', item.phone.replace(/[^\d+]/g, ''), source, null, now);
        const email = item.email.toLowerCase(); if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) && ROLE.test(email.split('@')[0])) await this.contact(id, 'email', email, source, null, now);
        count++; room--; ids.push(id);
      }
      // Without a website: the Maps listing is the evidence (already checked), "no website" is its only signal, and
      // the phone it lists is how the team reaches it.
      if (includeNoSite) for (const item of listings.filter(listing => !siteOrigin(listing.website) && listing.name && listing.ref)) {
        if (count >= FINDER_LIMITS.perSearch || room <= 0) break;
        const key = `nosite:${createHash('sha256').update(`maps:${item.ref}`).digest('hex').slice(0, 32)}`; if (listed.has(key)) continue; listed.add(key);
        const id = `prospect_${randomUUID()}`, listing = /^ChIJ/.test(item.ref) ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(item.ref)}` : `https://maps.google.com/?cid=${encodeURIComponent(item.ref)}`;
        const evidence = clean([item.name, item.category, item.address].filter(Boolean).join(' · '), 400);
        await this.db.prepare("INSERT INTO platform_prospects(id,organization_id,project_id,company,website,sector,country,reason,contact_role,reason_source,check_status,source_url,page_title,page_summary,evidence,checked_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'','',NULL,'ok',?,?,?,?,?,?,?,?)")
          .run(id, ...this.args(), item.name, key, (item.category || sectorText).slice(0, 80), country, listing, item.name.slice(0, 200), language === 'tr' ? 'Google Haritalar kaydı; web sitesi yok.' : 'Google Maps listing; no website.', evidence, now, this.scope.subject, now, now);
        await this.db.prepare('INSERT INTO platform_prospect_insights(prospect_id,organization_id,project_id,source,source_ref,city,address,category,rating,reviews,signals_json,scanned_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, ...this.args(), source, item.ref, item.city, item.address, item.category, item.rating, item.reviews, JSON.stringify([{ key: 'website', present: false, evidence: '' }]), now, now);
        if (/^\+?[\d\s()-]{10,20}$/.test(item.phone)) await this.contact(id, 'phone', item.phone.replace(/[^\d+]/g, ''), source, listing, now);
        count++; room--; noSite++; ids.push(id);
      }
      if (segmentId) await joinSegment(this.db, this.args2(), segmentId, ids);
      await this.db.prepare("INSERT INTO platform_prospect_searches(id,organization_id,project_id,source,city,sector,found,added,without_website,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,'done',?,?)").run(searchId, ...this.args(), source, city, sectorText, listings.length, count, withoutWebsite, this.scope.subject, now);
      await this.audit(`prospect.finder.discover:${source}`);
      return { count, noSite };
    });
    return { found: listings.length, added: added.count, addedNoSite: added.noSite, withoutWebsite, snapshot: await this.read() };
  }
  private async contact(prospectId: string, kind: 'email' | 'phone', value: string, source: string, sourceUrl: string | null, now: string) {
    if (await this.db.prepare('SELECT 1 FROM platform_prospect_contacts WHERE prospect_id=? AND kind=? AND value=?').get(prospectId, kind, value)) return;
    await this.db.prepare('INSERT INTO platform_prospect_contacts(id,prospect_id,organization_id,project_id,kind,value,source,source_url,found_at) VALUES(?,?,?,?,?,?,?,?,?)').run(`pcontact_${randomUUID()}`, prospectId, ...this.args(), kind, value, source, sourceUrl, now);
  }

  // ---- Reading a company's site: signals, contact addresses, and the same check record as "Check the website" ----
  async scan(raw: Json) {
    await this.authorize('content.write');
    const prospect = await this.prospect(raw.id);
    if (isNoSite(prospect.website)) throw new MarketingStoreError('Bu işletmenin web sitesi yok; kanıtı Google Haritalar kaydıdır.', 409);
    if ((await this.used('prospect_check')) >= 50) throw new MarketingStoreError('Günlük web sitesi kontrol sınırına ulaşıldı.', 429);
    let page: { finalUrl: string; html: string } | null = null;
    try { page = await this.site(prospect.website); if (host(page.finalUrl) !== host(prospect.website)) page = null; } catch { page = null; }
    let extra: { finalUrl: string; html: string } | null = null;
    const link = page ? contactPage(page.html, page.finalUrl) : null;
    if (link) { try { extra = await this.site(link); if (host(extra.finalUrl) !== host(prospect.website)) extra = null; } catch { extra = null; } }
    const now = new Date().toISOString(), history = ['sales', 'segments'].includes(String(await prospectDetailsReady(this.db)));
    await this.db.transaction(async () => {
      await this.count('prospect_check');
      if (!page) { await this.db.prepare("UPDATE platform_prospects SET check_status='unreachable',checked_at=?,revision=revision+1,updated_at=? WHERE id=?").run(now, now, prospect.id); await this.audit('prospect.scan'); return; }
      const title = plain(page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 200), description = decode(page.html.match(/<meta\b[^>]*name\s*=\s*["']description["'][^>]*>/i)?.[0].match(/content\s*=\s*(["'])([\s\S]*?)\1/i)?.[2] || '').trim().slice(0, 400);
      const headings = [...page.html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map(match => plain(match[1])).filter(Boolean).slice(0, 8).map(item => item.slice(0, 160)), summary = [description, ...headings].filter(Boolean).join(' · ').slice(0, 600);
      await this.db.prepare("UPDATE platform_prospects SET check_status='ok',source_url=?,page_title=?,page_summary=?,evidence=COALESCE(evidence,?),checked_at=?,revision=revision+1,updated_at=? WHERE id=?").run(page.finalUrl, title || null, summary || null, (description || headings[0] || title || '').slice(0, 300) || null, now, now, prospect.id);
      const signals = readSignals(page.html, page.finalUrl);
      // A rescan that finds a different site (a new booking link, a pixel, a fresh year) is a moment worth a message.
      const before = await this.db.prepare('SELECT signals_json FROM platform_prospect_insights WHERE prospect_id=?').get(prospect.id) as { signals_json: string | null } | undefined;
      if (history && before?.signals_json) {
        const old = new Map((JSON.parse(before.signals_json) as Signal[]).map(item => [item.key, item.present]));
        const changed = signals.filter(item => item.present !== null && old.has(item.key) && old.get(item.key) !== null && old.get(item.key) !== item.present).map(item => item.key);
        if (changed.length) await this.db.prepare('INSERT INTO platform_prospect_events(id,prospect_id,organization_id,project_id,kind,detail_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`pevent_${randomUUID()}`, prospect.id, ...this.args(), 'site_changed', JSON.stringify({ keys: changed }), this.scope.subject, now);
      }
      if (await this.db.prepare('SELECT 1 FROM platform_prospect_insights WHERE prospect_id=?').get(prospect.id)) await this.db.prepare('UPDATE platform_prospect_insights SET signals_json=?,scanned_at=?,updated_at=? WHERE prospect_id=?').run(JSON.stringify(signals), now, now, prospect.id);
      else await this.db.prepare("INSERT INTO platform_prospect_insights(prospect_id,organization_id,project_id,source,source_ref,city,address,category,rating,reviews,signals_json,scanned_at,updated_at) VALUES(?,?,?,'manual',NULL,'','','',NULL,NULL,?,?,?)").run(prospect.id, ...this.args(), JSON.stringify(signals), now, now);
      for (const [pageUrl, html] of [[page.finalUrl, page.html], ...(extra ? [[extra.finalUrl, extra.html]] : [])] as [string, string][]) {
        const found = readContacts(html, pageUrl);
        for (const email of found.emails) await this.contact(prospect.id, 'email', email, 'site', pageUrl, now);
        for (const phone of found.phones) await this.contact(prospect.id, 'phone', phone, 'site', pageUrl, now);
      }
      await this.audit('prospect.scan');
    });
    return await this.read();
  }
  // "Find companies like my best customers": the sector, the place and the site signals most of them share, from the
  // companies marked won in the pipeline or from up to five websites the team enters. Nothing is saved until the team
  // applies the signals to the score.
  async lookalike(raw: Json) {
    await this.authorize('content.write');
    type Example = { sector: string; city: string; signals: Signal[] };
    let examples: Example[] = [];
    if (raw.from === 'won') {
      try {
        examples = (await this.db.prepare("SELECT p.sector,i.city,i.category,i.signals_json FROM platform_prospect_pipeline l JOIN platform_prospects p ON p.id=l.prospect_id JOIN platform_prospect_insights i ON i.prospect_id=p.id WHERE l.organization_id=? AND l.project_id=? AND l.stage='won' AND i.signals_json IS NOT NULL ORDER BY l.updated_at DESC LIMIT 20").all(...this.args()) as { sector: string; city: string; category: string; signals_json: string }[])
          .map(row => ({ sector: row.category || row.sector, city: row.city, signals: JSON.parse(row.signals_json) as Signal[] }));
      } catch { examples = []; }
      if (examples.length < 2) throw new MarketingStoreError('Benzer firma profili için satış hunisinde sitesi taranmış en az 2 kazanılmış firma gerekir. Dilerseniz en iyi müşterilerinizin sitelerini yazın.', 409);
    } else {
      const sites = [...new Set((Array.isArray(raw.websites) ? raw.websites : []).map(siteOrigin).filter((item): item is string => Boolean(item)))].slice(0, 5);
      if (sites.length < 2) throw new MarketingStoreError('En iyi müşterilerinizden en az 2, en çok 5 web sitesi yazın.');
      if ((await this.used('prospect_check')) + sites.length > 50) throw new MarketingStoreError('Günlük web sitesi kontrol sınırına ulaşıldı.', 429);
      for (const site of sites) {
        await this.count('prospect_check');
        try { const page = await this.site(site); if (host(page.finalUrl) === host(site)) examples.push({ sector: '', city: '', signals: readSignals(page.html, page.finalUrl) }); } catch { /* unreachable sites are skipped */ }
      }
      if (examples.length < 2) throw new MarketingStoreError('Sitelerden en az ikisi okunamadı. Adresleri kontrol edin.', 502);
    }
    const common = (values: string[]) => { const counts = new Map<string, number>(); for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1); return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || ''; };
    const signals: Partial<Record<SignalKey, SignalWish>> = {};
    for (const key of SIGNAL_KEYS.filter(key => !['https', 'fresh', 'meta_description'].includes(key))) {
      const known = examples.map(item => item.signals.find(signal => signal.key === key)?.present).filter((value): value is boolean => value === true || value === false);
      if (known.length < 2) continue;
      const share = known.filter(Boolean).length / known.length;
      if (share >= 0.75) signals[key] = 'present'; else if (share <= 0.25) signals[key] = 'missing';
    }
    await this.audit('prospect.finder.lookalike');
    return { examples: examples.length, sector: common(examples.map(item => item.sector)), city: common(examples.map(item => item.city)), signals };
  }
  async removeContact(raw: Json) {
    await this.authorize('content.write');
    const table = typeof raw.contactId === 'string' && raw.contactId.startsWith('pxcontact_') ? 'platform_prospect_extra_contacts' : 'platform_prospect_contacts';
    const changed = (await this.db.prepare(`DELETE FROM ${table} WHERE id=? AND organization_id=? AND project_id=?`).run(raw.contactId, ...this.args())).changes;
    if (!changed) throw new MarketingStoreError('İletişim bilgisi bulunamadı.', 404);
    await this.audit('prospect.contact.remove');
    return await this.read();
  }

  // ---- Mini analysis link ----
  async createReport(raw: Json, origin: string) {
    await this.authorize('content.write');
    const prospect = await this.prospect(raw.id), insight = await this.db.prepare('SELECT signals_json,scanned_at FROM platform_prospect_insights WHERE prospect_id=?').get(prospect.id) as { signals_json: string | null; scanned_at: string | null } | undefined;
    if (!insight?.signals_json || !insight.scanned_at) throw new MarketingStoreError('Önce firmanın sitesini tarayın.', 409);
    const project = (await this.repo.workspace(this.scope.subject, ...this.args()))!.project, language: 'tr' | 'en' = project.language === 'en' ? 'en' : 'tr', idx = language === 'tr' ? 0 : 1;
    const kit = await this.db.prepare('SELECT kit_json,logo_data,logo_mime FROM platform_brand_kits WHERE organization_id=? AND project_id=?').get(...this.args()) as { kit_json: string; logo_data: string | null; logo_mime: string | null } | undefined;
    const brand = kit ? JSON.parse(kit.kit_json) as { colors?: { primary?: string; accent?: string }; tagline?: string } : {}, settings = await this.settings();
    // A missing item is shown only when it matters for any site (the core set) or the team chose it for its offer;
    // a dental clinic is not told it lacks a web shop.
    const core: SignalKey[] = ['https', 'mobile', 'meta_description', 'google_tag', 'fresh'];
    const signals = (JSON.parse(insight.signals_json) as Signal[]).filter((item): item is Signal & { present: boolean } => item.present !== null && item.key !== 'hiring' && (item.present || core.includes(item.key) || Boolean(settings.signals[item.key])));
    const wished = (key: SignalKey) => settings.signals[key] ? 0 : 1;
    const findings = signals.sort((a, b) => wished(a.key) - wished(b.key) || Number(a.present) - Number(b.present)).map(item => ({ key: item.key, present: item.present, text: SIGNALS[item.key][item.present ? 'yes' : 'no'][idx] }));
    const now = new Date(), expires = new Date(now.getTime() + FINDER_LIMITS.reportDays * 86400000).toISOString(), token = randomBytes(32).toString('base64url');
    const content: ProspectAnalysis = { language, company: prospect.company, website: prospect.website, scannedAt: insight.scanned_at, expiresAt: expires, findings,
      sender: { name: project.name, website: project.website, tagline: clean(brand.tagline, 80), primary: /^#[0-9a-f]{6}$/i.test(brand.colors?.primary || '') ? brand.colors!.primary! : '#191f16', accent: /^#[0-9a-f]{6}$/i.test(brand.colors?.accent || '') ? brand.colors!.accent! : '#baf331',
        logo: kit?.logo_data && kit.logo_mime ? `data:${kit.logo_mime};base64,${kit.logo_data}` : null } };
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM platform_prospect_reports WHERE prospect_id=? AND organization_id=? AND project_id=?').run(prospect.id, ...this.args());
      await this.db.prepare('INSERT INTO platform_prospect_reports(id,prospect_id,organization_id,project_id,token_hash,content_json,views,last_viewed_at,expires_at,revoked_at,created_by,created_at) VALUES(?,?,?,?,?,?,0,NULL,?,NULL,?,?)').run(`preport_${randomUUID()}`, prospect.id, ...this.args(), sha(token), JSON.stringify(content), expires, this.scope.subject, now.toISOString());
      await this.audit('prospect.report.create');
    });
    // The token is shown once; only its hash is kept. It travels in the fragment, so it never reaches a server log.
    return { url: `${origin}/analiz#token=${token}`, snapshot: await this.read() };
  }
  async revokeReport(raw: Json) {
    await this.authorize('content.write');
    const prospect = await this.prospect(raw.id);
    await this.db.prepare('UPDATE platform_prospect_reports SET revoked_at=? WHERE prospect_id=? AND organization_id=? AND project_id=? AND revoked_at IS NULL').run(new Date().toISOString(), prospect.id, ...this.args());
    await this.audit('prospect.report.revoke');
    return await this.read();
  }
}

// Public: the mini analysis behind a link. Unknown, expired and revoked links look the same. A preview by the team
// (the page adds preview=1) is not counted as a view.
export async function openProspectAnalysis(db: Db, token: string, preview = false): Promise<ProspectAnalysis | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await db.prepare('SELECT id,content_json,expires_at,revoked_at FROM platform_prospect_reports WHERE token_hash=?').get(sha(token)) as { id: string; content_json: string; expires_at: string; revoked_at: string | null } | undefined;
  const now = new Date().toISOString();
  if (!row || row.revoked_at || row.expires_at <= now) return null;
  if (!preview) await db.prepare('UPDATE platform_prospect_reports SET views=views+1,last_viewed_at=? WHERE id=?').run(now, row.id);
  return JSON.parse(row.content_json) as ProspectAnalysis;
}
// Whether the sales assistant tables exist (db:upgrade adds them). Asked outside a transaction: on SQL Server a
// missing table inside one would end the whole transaction.
// 'sales' when the outreach tables (schema 83) exist too, 'segments' when the customer groups (schema 84) do as well.
export async function prospectDetailsReady(db: Db): Promise<false | 'finder' | 'sales' | 'segments'> {
  try { await db.prepare('SELECT COUNT(*) AS n FROM platform_prospect_insights WHERE 1=0').get(); } catch { return false; }
  try { await db.prepare('SELECT COUNT(*) AS n FROM platform_prospect_outreach WHERE 1=0').get(); } catch { return 'finder'; }
  try { await db.prepare('SELECT COUNT(*) AS n FROM platform_prospect_segment_members WHERE 1=0').get(); return 'segments'; } catch { return 'sales'; }
}
// Dependent rows of a prospect, removed before the prospect itself. The touch history (no names, no addresses) stays
// for the team's figures; blocked addresses stay blocked.
export async function removeProspectDetails(db: Db, prospectId: string, level: 'finder' | 'sales' | 'segments' = 'finder') {
  if (level === 'segments') await db.prepare('DELETE FROM platform_prospect_segment_members WHERE prospect_id=?').run(prospectId);
  if (level === 'sales' || level === 'segments') {
    await db.prepare('DELETE FROM platform_prospect_outreach_sends WHERE outreach_id IN (SELECT id FROM platform_prospect_outreach WHERE prospect_id=?)').run(prospectId);
    for (const table of ['platform_prospect_outreach', 'platform_prospect_pipeline', 'platform_prospect_extra_contacts', 'platform_prospect_proposals']) await db.prepare(`DELETE FROM ${table} WHERE prospect_id=?`).run(prospectId);
  }
  for (const table of ['platform_prospect_contacts', 'platform_prospect_reports', 'platform_prospect_insights']) await db.prepare(`DELETE FROM ${table} WHERE prospect_id=?`).run(prospectId);
}
