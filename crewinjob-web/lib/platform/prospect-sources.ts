import type { Db } from '../db/client';
import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials, encryptCredentials } from './credential-envelope';
import { PROSPECT_LIMITS } from './prospect-types';
import { ROLE_ADDRESS, siteOrigin } from './prospect-finder';
import { ProjectProspects } from './prospects';
import { suppressedHosts } from './prospect-contacts';
import { PERSONAL_MAIL, SOURCE_LIMITS as LIMITS, SOURCE_TERMS_VERSION, type ExtraContact, type SourceKind, type SourcesSnapshot, type VisitorCompany } from './prospect-sources-types';

// Advanced sources for the sales assistant. Each one is the project's own decision: the owner accepts its
// responsibility text first, and every row keeps where it came from.
type Json = Record<string, unknown>;
type Need = 'read' | 'content.write' | 'connections.manage' | 'billing.manage';
export type SourceHttp = (url: string, headers: Record<string, string>) => Promise<{ status: number; text: string }>;
export type VisitLookup = (ip: string) => Promise<{ name: string; domain: string; kind: string } | null>;
const DAY = 86400000;
const sourceHttp: SourceHttp = async (url, headers) => { const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Ryzevo/1.0 (+https://ryzevo.com)', ...headers }, signal: AbortSignal.timeout(15000) }); return { status: response.status, text: (await response.text()).slice(0, 1_000_000) }; };
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const host = (website: string) => { try { return new URL(website).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const fold = (value: string) => value.toLocaleLowerCase('tr').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/i̇/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').normalize('NFKD').replace(/[^a-z]/g, '');

// ---- A list the team brings: CSV with a header row (comma or semicolon) ----
const HEADERS: Record<string, string[]> = {
  company: ['firma', 'firma adı', 'firma adi', 'şirket', 'sirket', 'unvan', 'ticari unvan', 'company', 'company name', 'name', 'ad'],
  website: ['web', 'web sitesi', 'website', 'site', 'url', 'internet sitesi'],
  email: ['e-posta', 'eposta', 'e-mail', 'email', 'mail'],
  phone: ['telefon', 'tel', 'phone', 'gsm'],
  sector: ['sektör', 'sektor', 'sector', 'kategori', 'category', 'industry'],
  city: ['şehir', 'sehir', 'il', 'ilçe', 'ilce', 'city', 'town'],
};
export function parseCsv(text: string, maxRows: number) {
  const source = text.replace(/^﻿/, ''), firstLine = source.split(/\r?\n/, 1)[0] || '', separator = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) { if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; } else if (char === '"') quoted = false; else cell += char; continue; }
    if (char === '"') quoted = true; else if (char === separator) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') { if (char === '\r' && source[index + 1] === '\n') index++; row.push(cell); cell = ''; if (row.some(value => value.trim())) rows.push(row); row = []; if (rows.length > maxRows + 1) break; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); if (row.some(value => value.trim())) rows.push(row); }
  const header = (rows.shift() || []).map(value => value.trim().toLocaleLowerCase('tr'));
  const column = (name: string) => header.findIndex(value => HEADERS[name].includes(value));
  const at = Object.fromEntries(Object.keys(HEADERS).map(name => [name, column(name)])) as Record<string, number>;
  if (at.company < 0 || at.website < 0) throw new MarketingStoreError('CSV’nin ilk satırında en az “Firma” ve “Web sitesi” sütunları olmalı.');
  return { rows: rows.slice(0, maxRows).map(cells => Object.fromEntries(Object.entries(at).map(([name, index]) => [name, index >= 0 ? clean(cells[index], name === 'website' ? 300 : 120) : '']))), more: rows.length > maxRows };
}
// Person name guesses: the usual company patterns, Turkish letters folded.
export function guessAddresses(first: string, last: string, domain: string) {
  const f = fold(first), l = fold(last.split(/\s+/).pop() || '');
  if (f.length < 2 || l.length < 2 || !domain) return [];
  return [...new Set([`${f}.${l}`, `${f}`, `${f[0]}${l}`, `${f}${l}`, `${f}_${l}`])].map(local => `${local}@${domain}`).filter(value => EMAIL.test(value));
}

export class ProspectSources {
  private repo: PlatformRepository;
  constructor(private db: Db, private scope: MarketingScope, private key: string, private http: SourceHttp = sourceHttp) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private can(need: Need) { return this.repo.can(this.scope.subject, ...this.args(), need); }
  private async authorize(need: Need = 'read') {
    if (!await this.can('read') || (await this.repo.workspace(this.scope.subject, ...this.args()))?.project.productPack !== 'standard') throw new MarketingStoreError('Aday listesi için standart proje erişimi gerekli.', 403);
    if (!await this.can(need)) throw new MarketingStoreError(need === 'billing.manage' ? 'Koşulları yalnız projenin sahibi kabul edebilir.' : need === 'connections.manage' ? 'Bu işlem için bağlantı yöneticisi yetkisi gerekir.' : 'Bu işlem için içerik yazma yetkisi gerekir.', 403);
  }
  private async audit(operation: string) { await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), operation, new Date().toISOString()); }
  private async usage(resource: string, limit: number, message: string) {
    const day = new Date().toISOString().slice(0, 10), used = (await this.db.prepare('SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource=?').get(...this.args(), day, resource) as { count: number } | undefined)?.count || 0;
    if (used >= limit) throw new MarketingStoreError(message, 429);
    await this.db.prepare('INSERT INTO platform_usage VALUES(?,?,?,?,1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1').run(...this.args(), day, resource);
  }
  private async used(resource: string) { return (await this.db.prepare('SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource=?').get(...this.args(), new Date().toISOString().slice(0, 10), resource) as { count: number } | undefined)?.count || 0; }
  private async terms(kind: SourceKind) { const row = await this.db.prepare('SELECT accepted_by,accepted_at,terms_version FROM platform_prospect_source_terms WHERE organization_id=? AND project_id=? AND kind=?').get(...this.args(), kind) as { accepted_by: string; accepted_at: string; terms_version: string } | undefined; return row && row.terms_version === SOURCE_TERMS_VERSION ? { by: row.accepted_by, at: row.accepted_at } : null; }
  private async requireTerms(kind: SourceKind) { if (!await this.terms(kind)) throw new MarketingStoreError(kind === 'list' ? 'Liste yükleme ve kişi adresi kaynakları için proje sahibinin sorumluluk metnini kabul etmesi gerekir.' : 'Ziyaretçi firma tespiti için proje sahibinin sorumluluk metnini kabul etmesi gerekir.', 409); }
  private async prospect(id: unknown) {
    const row = typeof id === 'string' ? await this.db.prepare('SELECT id,company,website,state FROM platform_prospects WHERE id=? AND organization_id=? AND project_id=?').get(id, ...this.args()) as { id: string; company: string; website: string; state: string } | undefined : undefined;
    if (!row) throw new MarketingStoreError('Aday bulunamadı.', 404); return row;
  }
  private async addExtra(prospectId: string, item: { kind: 'email' | 'phone'; value: string; source: ExtraContact['source']; person: boolean; confidence: number | null; note: string }) {
    if (await this.db.prepare('SELECT 1 FROM platform_prospect_extra_contacts WHERE prospect_id=? AND kind=? AND value=?').get(prospectId, item.kind, item.value)) return false;
    if (item.kind === 'email' && await this.db.prepare("SELECT 1 FROM platform_prospect_contacts WHERE prospect_id=? AND kind='email' AND value=?").get(prospectId, item.value)) return false;
    await this.db.prepare('INSERT INTO platform_prospect_extra_contacts(id,prospect_id,organization_id,project_id,kind,value,source,recipient_type,confidence,note,found_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(`pxcontact_${randomUUID()}`, prospectId, ...this.args(), item.kind, item.value, item.source, item.person ? 'person' : 'company', item.confidence, item.note.slice(0, 160), new Date().toISOString());
    return true;
  }

  async read(): Promise<SourcesSnapshot> {
    await this.authorize();
    const key = await this.db.prepare("SELECT masked FROM platform_prospect_provider_keys WHERE organization_id=? AND project_id=? AND provider='hunter'").get(...this.args()) as { masked: string } | undefined;
    const imports = (await this.db.prepare('SELECT id,rows_count,added,skipped,created_at FROM platform_prospect_imports WHERE organization_id=? AND project_id=? ORDER BY created_at DESC LIMIT 5').all(...this.args()) as Json[]).map(row => ({ id: String(row.id), rows: Number(row.rows_count), added: Number(row.added), skipped: Number(row.skipped), createdAt: String(row.created_at) }));
    const visitor = await this.db.prepare('SELECT site_key,enabled FROM platform_visitor_settings WHERE organization_id=? AND project_id=?').get(...this.args()) as { site_key: string; enabled: number } | undefined;
    const hosts = new Map((await this.db.prepare('SELECT id,website FROM platform_prospects WHERE organization_id=? AND project_id=?').all(...this.args()) as { id: string; website: string }[]).map(row => [host(row.website), row.id]));
    const companies = (await this.db.prepare('SELECT * FROM platform_visitor_companies WHERE organization_id=? AND project_id=? AND last_seen>? ORDER BY last_seen DESC LIMIT ?').all(...this.args(), new Date(Date.now() - LIMITS.visitorDays * DAY).toISOString(), LIMITS.visitorCompanies) as Json[])
      .map((row): VisitorCompany => ({ key: String(row.company_key), name: String(row.name), domain: String(row.domain || ''), kind: String(row.kind || ''), visits: Number(row.visits), pages: JSON.parse(String(row.pages_json)), firstSeen: String(row.first_seen), lastSeen: String(row.last_seen), prospectId: row.domain ? hosts.get(String(row.domain)) || null : null }));
    const origin = process.env.PLATFORM_PUBLIC_ORIGIN || '';
    return { terms: { list: await this.terms('list'), visitors: await this.terms('visitors') }, hunter: { configured: Boolean(key), masked: key?.masked || null, usedToday: await this.used('hunter_search') }, imports,
      visitors: { enabled: Boolean(visitor?.enabled), siteKey: visitor?.enabled ? visitor.site_key : null, providerConfigured: Boolean(process.env.PLATFORM_IPINFO_TOKEN),
        snippet: visitor?.enabled && origin ? `<script src="${origin.replace(/\/$/, '')}/rz-visit.js" data-key="${visitor.site_key}" defer></script>` : null, companies },
      canWrite: await this.can('content.write'), canManage: await this.can('connections.manage'), canAcceptTerms: await this.can('billing.manage') };
  }
  async acceptTerms(raw: Json) {
    await this.authorize('billing.manage');
    const kind = raw.kind === 'list' || raw.kind === 'visitors' ? raw.kind : null;
    if (!kind || raw.accepted !== true || raw.version !== SOURCE_TERMS_VERSION) throw new MarketingStoreError('Devam etmek için koşulları okuyup kabul edin.');
    await this.db.prepare('INSERT INTO platform_prospect_source_terms(organization_id,project_id,kind,terms_version,accepted_by,accepted_at) VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,project_id,kind) DO UPDATE SET terms_version=excluded.terms_version,accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at').run(...this.args(), kind, SOURCE_TERMS_VERSION, this.scope.subject, new Date().toISOString());
    await this.audit(`prospect.sources.terms.${kind}:${SOURCE_TERMS_VERSION}`);
    return await this.read();
  }
  async revokeTerms(raw: Json) {
    await this.authorize('billing.manage');
    const kind = raw.kind === 'list' || raw.kind === 'visitors' ? raw.kind : null; if (!kind) throw new MarketingStoreError('Geçersiz kaynak.');
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM platform_prospect_source_terms WHERE organization_id=? AND project_id=? AND kind=?').run(...this.args(), kind);
      if (kind === 'visitors') await this.db.prepare('UPDATE platform_visitor_settings SET enabled=0,updated_by=?,updated_at=? WHERE organization_id=? AND project_id=?').run(this.scope.subject, new Date().toISOString(), ...this.args());
      await this.audit(`prospect.sources.terms.revoke.${kind}`);
    });
    return await this.read();
  }

  // ---- A list the team brings ----
  async importList(raw: Json) {
    await this.authorize('content.write'); await this.requireTerms('list');
    if (typeof raw.csv !== 'string' || !raw.csv.trim() || raw.csv.length > 300_000) throw new MarketingStoreError('CSV metni boş veya çok büyük (en çok 200 satır).');
    const { rows, more } = parseCsv(raw.csv, LIMITS.importRows);
    if (!rows.length) throw new MarketingStoreError('CSV’de firma satırı yok.');
    await this.usage('prospect_import', LIMITS.importsPerDay, 'Bugünkü liste yükleme hakkı doldu. Yarın tekrar deneyin.');
    const suppressed = await suppressedHosts(this.db, { organizationId: this.scope.organizationId, projectId: this.scope.projectId });
    const id = `pimport_${randomUUID()}`, now = new Date().toISOString();
    const result = await this.db.transaction(async () => {
      const existing = await this.db.prepare('SELECT website FROM platform_prospects WHERE organization_id=? AND project_id=?').all(...this.args()) as { website: string }[];
      const seen = new Set(existing.map(row => host(row.website))); let room = Math.max(0, PROSPECT_LIMITS.prospects - existing.length), added = 0, skipped = 0;
      for (const row of rows) {
        const origin = siteOrigin(row.website), key = origin ? host(origin) : '';
        if (!origin || !row.company || !key || seen.has(key) || suppressed.has(key) || room <= 0) { skipped++; continue; }
        seen.add(key); room--; added++;
        const prospectId = `prospect_${randomUUID()}`;
        await this.db.prepare('INSERT INTO platform_prospects(id,organization_id,project_id,company,website,sector,country,reason,contact_role,reason_source,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(prospectId, ...this.args(), row.company, origin, row.sector.slice(0, 80), '', '', '', null, this.scope.subject, now, now);
        await this.db.prepare("INSERT INTO platform_prospect_insights(prospect_id,organization_id,project_id,source,source_ref,city,address,category,rating,reviews,signals_json,scanned_at,updated_at) VALUES(?,?,?,'manual',?,?,'',?,NULL,NULL,NULL,NULL,?)").run(prospectId, ...this.args(), `import:${id}`, row.city.slice(0, 80), row.sector.slice(0, 80), now);
        const email = row.email.toLowerCase();
        if (EMAIL.test(email)) await this.addExtra(prospectId, { kind: 'email', value: email, source: 'import', person: PERSONAL_MAIL.test(email) || !ROLE_ADDRESS.test(email.split('@')[0]), confidence: null, note: '' });
        const phone = row.phone.replace(/[^\d+]/g, ''); if (phone.replace(/\D/g, '').length >= 10 && phone.length <= 16) await this.addExtra(prospectId, { kind: 'phone', value: phone, source: 'import', person: false, confidence: null, note: '' });
      }
      await this.db.prepare('INSERT INTO platform_prospect_imports(id,organization_id,project_id,rows_count,added,skipped,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, ...this.args(), rows.length, added, skipped, this.scope.subject, now);
      await this.audit('prospect.sources.import');
      return { added, skipped };
    });
    return { ...result, more, snapshot: await this.read() };
  }

  // ---- Person addresses: the team's own Hunter account, or a guess from a name on the company's site ----
  async saveHunterKey(raw: Json) {
    await this.authorize('connections.manage'); await this.requireTerms('list');
    const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
    if (!/^[A-Za-z0-9]{20,80}$/.test(apiKey)) throw new MarketingStoreError('Geçerli bir Hunter API anahtarı girin.');
    let ok = false; try { ok = (await this.http('https://api.hunter.io/v2/account', { 'X-API-KEY': apiKey })).status === 200; } catch { ok = false; }
    if (!ok) throw new MarketingStoreError('Hunter bu anahtarı doğrulamadı. Anahtarı Hunter hesabınızdan kontrol edin.', 400);
    await this.db.prepare("INSERT INTO platform_prospect_provider_keys(organization_id,project_id,provider,encrypted_key,masked,added_by,added_at) VALUES(?,?,'hunter',?,?,?,?) ON CONFLICT(organization_id,project_id,provider) DO UPDATE SET encrypted_key=excluded.encrypted_key,masked=excluded.masked,added_by=excluded.added_by,added_at=excluded.added_at")
      .run(...this.args(), encryptCredentials({ apiKey }, this.key, ...this.args(), 'prospect-hunter'), `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`, this.scope.subject, new Date().toISOString());
    await this.audit('prospect.sources.hunter.save');
    return await this.read();
  }
  async removeHunterKey() {
    await this.authorize('connections.manage');
    await this.db.prepare("DELETE FROM platform_prospect_provider_keys WHERE organization_id=? AND project_id=? AND provider='hunter'").run(...this.args());
    await this.audit('prospect.sources.hunter.remove');
    return await this.read();
  }
  async hunter(raw: Json) {
    await this.authorize('content.write'); await this.requireTerms('list');
    const prospect = await this.prospect(raw.id), domain = host(prospect.website);
    const row = await this.db.prepare("SELECT encrypted_key FROM platform_prospect_provider_keys WHERE organization_id=? AND project_id=? AND provider='hunter'").get(...this.args()) as { encrypted_key: string } | undefined;
    if (!row) throw new MarketingStoreError('Önce Hunter API anahtarınızı ekleyin.', 409);
    await this.usage('hunter_search', LIMITS.hunterPerDay, 'Bugünkü Hunter arama sınırına ulaşıldı.');
    const { apiKey } = decryptCredentials<{ apiKey: string }>(row.encrypted_key, this.key, ...this.args(), 'prospect-hunter');
    let emails: Json[] = [];
    try {
      const response = await this.http(`https://api.hunter.io/v2/domain-search?${new URLSearchParams({ domain, limit: String(LIMITS.hunterEmails) })}`, { 'X-API-KEY': apiKey });
      if (response.status === 401 || response.status === 403) throw new MarketingStoreError('Hunter anahtarı artık geçerli değil. Bağlantı yöneticisi yenilemeli.', 409);
      if (response.status !== 200) throw new Error(`hunter_${response.status}`);
      emails = (((JSON.parse(response.text) as Json).data as Json | undefined)?.emails as Json[] | undefined) || [];
    } catch (error) { if (error instanceof MarketingStoreError) throw error; throw new MarketingStoreError('Hunter şu anda yanıt vermiyor. Biraz sonra tekrar deneyin.', 502); }
    let found = 0;
    await this.db.transaction(async () => {
      for (const item of emails.slice(0, LIMITS.hunterEmails)) {
        const value = clean(item.value, 120).toLowerCase(); if (!EMAIL.test(value) || !value.endsWith(`@${domain}`)) continue;
        const note = [clean([item.first_name, item.last_name].filter(Boolean).join(' '), 80), clean(item.position, 80)].filter(Boolean).join(' · ');
        if (await this.addExtra(prospect.id, { kind: 'email', value, source: 'hunter', person: item.type !== 'generic', confidence: Number.isInteger(item.confidence) ? Number(item.confidence) : null, note })) found++;
      }
      await this.audit('prospect.sources.hunter.search');
    });
    return { found, snapshot: await this.read() };
  }
  async guess(raw: Json) {
    await this.authorize('content.write'); await this.requireTerms('list');
    const prospect = await this.prospect(raw.id), first = clean(raw.firstName, 40), last = clean(raw.lastName, 60), list = guessAddresses(first, last, host(prospect.website));
    if (!list.length) throw new MarketingStoreError('Kişinin adını ve soyadını yazın (firmanın sitesinde geçtiği gibi).');
    await this.usage('prospect_guess', LIMITS.guessesPerDay, 'Bugünkü tahmin sınırına ulaşıldı.');
    let added = 0;
    await this.db.transaction(async () => {
      for (const value of list) if (await this.addExtra(prospect.id, { kind: 'email', value, source: 'guess', person: true, confidence: null, note: `${first} ${last}`.trim() })) added++;
      await this.audit('prospect.sources.guess');
    });
    return { added, snapshot: await this.read() };
  }
  async removeExtra(raw: Json) {
    await this.authorize('content.write');
    const changed = (await this.db.prepare('DELETE FROM platform_prospect_extra_contacts WHERE id=? AND organization_id=? AND project_id=?').run(raw.contactId, ...this.args())).changes;
    if (!changed) throw new MarketingStoreError('İletişim bilgisi bulunamadı.', 404);
    await this.audit('prospect.sources.contact.remove');
    return await this.read();
  }

  // ---- Visitor companies ----
  async setVisitors(raw: Json) {
    await this.authorize('billing.manage');
    if (raw.enabled === true) await this.requireTerms('visitors');
    const project = (await this.repo.workspace(this.scope.subject, ...this.args()))!.project, siteHost = host(project.website);
    if (raw.enabled === true && !siteHost) throw new MarketingStoreError('Önce proje ayarlarına sitenizin adresini girin.', 409);
    const now = new Date().toISOString(), existing = await this.db.prepare('SELECT site_key FROM platform_visitor_settings WHERE organization_id=? AND project_id=?').get(...this.args()) as { site_key: string } | undefined;
    if (existing) await this.db.prepare('UPDATE platform_visitor_settings SET enabled=?,allowed_host=?,updated_by=?,updated_at=? WHERE organization_id=? AND project_id=?').run(raw.enabled === true ? 1 : 0, siteHost, this.scope.subject, now, ...this.args());
    else await this.db.prepare('INSERT INTO platform_visitor_settings(organization_id,project_id,site_key,enabled,allowed_host,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)').run(...this.args(), `rzk_${randomBytes(18).toString('base64url')}`, raw.enabled === true ? 1 : 0, siteHost, this.scope.subject, now);
    await this.audit(`prospect.visitors.${raw.enabled === true ? 'on' : 'off'}`);
    return await this.read();
  }
  async addVisitor(raw: Json) {
    await this.authorize('content.write');
    const row = await this.db.prepare('SELECT name,domain FROM platform_visitor_companies WHERE organization_id=? AND project_id=? AND company_key=?').get(...this.args(), raw.key) as { name: string; domain: string } | undefined;
    if (!row?.domain) throw new MarketingStoreError('Bu kurumun web sitesi bilinmiyor; elle ekleyebilirsiniz.', 404);
    await new ProjectProspects(this.db, this.scope).add({ company: row.name.slice(0, 120), website: `https://${row.domain}`, sector: '', country: '', reason: '' });
    await this.audit('prospect.visitors.add');
    return await this.read();
  }
}

// ---- The public beacon (/api/visit) ----
const PRIVATE = /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;
const ACCESS = /(telekom|turkcell|vodafone|superonline|turknet|kablonet|millenicom|türksat|turksat|ttnet|d-smart|dsmart|google|amazon|microsoft|cloudflare|akamai|fastly|ovh|hetzner|digitalocean|linode|contabo|apple|facebook|meta platforms|t-mobile|comcast|verizon|at&t|orange|telefonica|deutsche telekom)/i;
const lookups = new Map<string, { at: number; value: Awaited<ReturnType<VisitLookup>> }>();
export const ipinfoLookup: VisitLookup = async ip => {
  const token = process.env.PLATFORM_IPINFO_TOKEN; if (!token) return null;
  const response = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (response.status !== 200) return null;
  const data = await response.json() as { org?: string; company?: { name?: string; domain?: string; type?: string }; asn?: { domain?: string; type?: string } };
  const name = clean(data.company?.name || (data.org || '').replace(/^AS\d+\s+/, ''), 120), kind = clean(data.company?.type || data.asn?.type || '', 20).toLowerCase(), domain = clean(data.company?.domain || data.asn?.domain || '', 120).toLowerCase();
  return name ? { name, domain: /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain.replace(/^www\./, '') : '', kind } : null;
};
// Records one consented page view: only an organisation (never an access provider, a host or a person), its domain
// and the page path. The IP address is used for the lookup and then dropped.
export async function recordVisit(db: Db, input: { key: string; origin: string | null; path: string; ip: string }, lookup: VisitLookup = ipinfoLookup) {
  if (!/^rzk_[A-Za-z0-9_-]{24}$/.test(input.key)) return 'ignored';
  const settings = await db.prepare('SELECT organization_id,project_id,allowed_host,enabled FROM platform_visitor_settings WHERE site_key=?').get(input.key) as { organization_id: string; project_id: string; allowed_host: string; enabled: number } | undefined;
  if (!settings?.enabled) return 'ignored';
  let originHost = ''; try { originHost = input.origin ? new URL(input.origin).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { originHost = ''; }
  if (!originHost || originHost !== settings.allowed_host) return 'ignored';
  if (!isIP(input.ip) || PRIVATE.test(input.ip)) return 'ignored';
  const args = [settings.organization_id, settings.project_id] as const, day = new Date().toISOString().slice(0, 10);
  const used = (await db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='visitor_beacon'").get(...args, day) as { count: number } | undefined)?.count || 0;
  if (used >= LIMITS.beaconsPerDay) return 'ignored';
  await db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'visitor_beacon',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...args, day);
  let found = lookups.get(input.ip);
  if (!found || Date.now() - found.at > DAY) {
    let value: Awaited<ReturnType<VisitLookup>> = null; try { value = await lookup(input.ip); } catch { value = null; }
    found = { at: Date.now(), value }; lookups.set(input.ip, found); if (lookups.size > 5000) lookups.delete(lookups.keys().next().value!);
  }
  const company = found.value;
  if (!company || ['isp', 'hosting'].includes(company.kind) || ACCESS.test(company.name) || company.domain === settings.allowed_host) return 'ignored';
  const key = (company.domain || company.name.toLocaleLowerCase('tr')).slice(0, 120), path = (input.path.split(/[?#]/)[0] || '/').replace(/[^\w\-./~%]/g, '').slice(0, 120) || '/', now = new Date().toISOString();
  await db.transaction(async () => {
    const row = await db.prepare('SELECT pages_json FROM platform_visitor_companies WHERE organization_id=? AND project_id=? AND company_key=?').get(...args, key) as { pages_json: string } | undefined;
    const pages = [path, ...(row ? JSON.parse(row.pages_json) as string[] : []).filter(item => item !== path)].slice(0, LIMITS.pagesKept);
    if (row) await db.prepare('UPDATE platform_visitor_companies SET name=?,domain=?,kind=?,visits=visits+1,pages_json=?,last_seen=? WHERE organization_id=? AND project_id=? AND company_key=?').run(company.name, company.domain, company.kind, JSON.stringify(pages), now, ...args, key);
    else await db.prepare('INSERT INTO platform_visitor_companies(organization_id,project_id,company_key,name,domain,kind,visits,pages_json,first_seen,last_seen) VALUES(?,?,?,?,?,?,1,?,?,?)').run(...args, key, company.name, company.domain, company.kind, JSON.stringify(pages), now, now);
  });
  return 'recorded';
}
export async function pruneVisitorCompanies(db: Db) { return (await db.prepare('DELETE FROM platform_visitor_companies WHERE last_seen<?').run(new Date(Date.now() - 90 * DAY).toISOString())).changes; }
export async function sourcesReady(db: Db) { try { await db.prepare('SELECT COUNT(*) AS n FROM platform_visitor_settings WHERE 1=0').get(); return true; } catch { return false; } }
