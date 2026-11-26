import type { Db } from '../db/client';
import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { COACH_BANNED, coachObject, coachText, type CoachGenerator } from './coach';
import { parseCoachJson, runCoachAi } from './coach-ai';
import { decryptCredentials, encryptCredentials } from './credential-envelope';
import { SOURCE_TERMS_VERSION } from './prospect-sources-types';
import { ProjectProspects } from './prospects';
import { ProspectOutreach } from './prospect-outreach';
import { DECISION, companyKey, fold, sameCompany } from './prospect-contacts';
import { NETWORK_LIMITS as LIMITS, type NetworkCompany, type NetworkContact, type NetworkMatch, type NetworkSnapshot, type NetworkState } from './prospect-network-types';

type Json = Record<string, unknown>;
type Row = { id: string; contact_key: string; encrypted_person: string; company: string; company_key: string; position: string; state: NetworkState; asked_at: string | null; prospect_id: string | null };
type Person = { firstName: string; lastName: string; email: string; url: string };
export { companyKey, sameCompany };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

// The LinkedIn "Connections" export (Settings → Data privacy → Get a copy of your data → Connections): a few note lines,
// then a header row with First Name, Last Name, URL, Email Address, Company, Position, Connected On.
export function parseConnections(text: string, maxRows: number = LIMITS.perImport) {
  const source = text.replace(/^﻿/, ''), rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) { if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; } else if (char === '"') quoted = false; else cell += char; continue; }
    if (char === '"') quoted = true; else if (char === ',' || char === ';') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') { if (char === '\r' && source[index + 1] === '\n') index++; row.push(cell); cell = ''; if (row.some(value => value.trim())) rows.push(row); row = []; if (rows.length > maxRows + 20) break; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); if (row.some(value => value.trim())) rows.push(row); }
  const names: Record<string, string[]> = { first: ['first name', 'ad', 'adı', 'isim'], last: ['last name', 'soyad', 'soyadı'], url: ['url', 'profile url', 'profil'], email: ['email address', 'e-posta', 'e-posta adresi', 'email'], company: ['company', 'şirket', 'firma'], position: ['position', 'pozisyon', 'unvan', 'title'], connected: ['connected on', 'bağlantı tarihi'] };
  const start = rows.findIndex(cells => cells.some(value => names.first.includes(value.trim().toLocaleLowerCase('tr'))) && cells.some(value => names.company.includes(value.trim().toLocaleLowerCase('tr'))));
  if (start < 0) throw new MarketingStoreError('Dosyada “First Name” ve “Company” sütunları bulunamadı. LinkedIn’den indirdiğiniz Connections.csv dosyasını yükleyin.');
  const header = rows[start].map(value => value.trim().toLocaleLowerCase('tr')), at = (key: string) => header.findIndex(value => names[key].includes(value));
  const col = Object.fromEntries(Object.keys(names).map(key => [key, at(key)])) as Record<string, number>;
  const get = (cells: string[], key: string, max: number) => col[key] >= 0 ? clean(cells[col[key]], max) : '';
  return rows.slice(start + 1, start + 1 + maxRows).map(cells => ({ firstName: get(cells, 'first', 60), lastName: get(cells, 'last', 60), url: get(cells, 'url', 300), email: get(cells, 'email', 120).toLowerCase(), company: get(cells, 'company', 120), position: get(cells, 'position', 120), connected: get(cells, 'connected', 40) }))
    .filter(item => item.firstName && item.company);
}

export class ProspectNetwork {
  private repo: PlatformRepository;
  constructor(private db: Db, private scope: MarketingScope, private key: string) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private can(need: 'read' | 'content.write') { return this.repo.can(this.scope.subject, ...this.args(), need); }
  private async authorize(need: 'read' | 'content.write' = 'read') {
    if (!await this.can('read') || (await this.repo.workspace(this.scope.subject, ...this.args()))?.project.productPack !== 'standard') throw new MarketingStoreError('Aday listesi için standart proje erişimi gerekli.', 403);
    if (!await this.can(need)) throw new MarketingStoreError('Bu işlem için içerik yazma yetkisi gerekir.', 403);
  }
  private async audit(operation: string) { await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), operation, new Date().toISOString()); }
  private async usage(resource: string, limit: number, message: string) {
    const day = new Date().toISOString().slice(0, 10), used = (await this.db.prepare('SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource=?').get(...this.args(), day, resource) as { count: number } | undefined)?.count || 0;
    if (used >= limit) throw new MarketingStoreError(message, 429);
    await this.db.prepare('INSERT INTO platform_usage VALUES(?,?,?,?,1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1').run(...this.args(), day, resource);
  }
  private async termsAccepted() { const row = await this.db.prepare("SELECT terms_version FROM platform_prospect_source_terms WHERE organization_id=? AND project_id=? AND kind='list'").get(...this.args()) as { terms_version: string } | undefined; return row?.terms_version === SOURCE_TERMS_VERSION; }
  private person(row: Row): Person { return decryptCredentials<Person>(row.encrypted_person, this.key, ...this.args(), `network:${row.id}`); }
  private view(row: Row): NetworkContact { const person = this.person(row); return { id: row.id, name: `${person.firstName} ${person.lastName}`.trim(), position: row.position, company: row.company, url: person.url, state: row.state, askedAt: row.asked_at, decisionMaker: DECISION.test(row.position) }; }
  private async contact(id: unknown) { const row = typeof id === 'string' ? await this.db.prepare('SELECT * FROM platform_network_contacts WHERE id=? AND organization_id=? AND project_id=?').get(id, ...this.args()) as Row | undefined : undefined; if (!row) throw new MarketingStoreError('Tanıdık bulunamadı.', 404); return row; }

  async read(raw: Json = {}): Promise<NetworkSnapshot> {
    await this.authorize();
    const rows = await this.db.prepare('SELECT * FROM platform_network_contacts WHERE organization_id=? AND project_id=?').all(...this.args()) as Row[];
    const prospects = await this.db.prepare('SELECT p.id,p.company,p.website,p.state,COALESCE(l.stage,\'new\') stage FROM platform_prospects p LEFT JOIN platform_prospect_pipeline l ON l.prospect_id=p.id WHERE p.organization_id=? AND p.project_id=? AND p.state<>\'rejected\'').all(...this.args()) as { id: string; company: string; website: string; state: string; stage: string }[];
    // People who work at a company the team wants to reach: the warmest way in.
    const matches: NetworkMatch[] = [];
    for (const row of rows) { const found = prospects.filter(item => sameCompany(row.company_key, item)); if (found.length) matches.push({ contact: this.view(row), prospects: found.map(item => ({ id: item.id, company: item.company, stage: item.stage })) }); }
    matches.sort((a, b) => Number(b.contact.decisionMaker) - Number(a.contact.decisionMaker) || Number(a.contact.state !== 'new') - Number(b.contact.state !== 'new'));
    // Companies in the network that are not on the list yet: early customers are often there.
    const groups = new Map<string, NetworkCompany>();
    for (const row of rows) {
      if (!row.company_key || prospects.some(item => sameCompany(row.company_key, item))) continue;
      const group = groups.get(row.company_key) || { key: row.company_key, company: row.company, people: 0, decisionMakers: 0 };
      group.people++; if (DECISION.test(row.position)) group.decisionMakers++; groups.set(row.company_key, group);
    }
    const companies = [...groups.values()].sort((a, b) => b.decisionMakers - a.decisionMakers || b.people - a.people || a.company.localeCompare(b.company, 'tr')).slice(0, LIMITS.companies);
    const query = fold(clean(raw.q, 80));
    const results = query.length >= 2 ? rows.map(row => this.view(row)).filter(item => fold(`${item.name} ${item.company} ${item.position}`).includes(query)).slice(0, LIMITS.search) : [];
    const imported = await this.db.prepare('SELECT MAX(imported_at) at FROM platform_network_contacts WHERE organization_id=? AND project_id=?').get(...this.args()) as { at: string | null };
    return { total: rows.length, asked: rows.filter(row => row.state !== 'new').length, importedAt: imported?.at || null, termsAccepted: await this.termsAccepted(), matches: matches.slice(0, 100), companies, results,
      aiConfigured: Boolean(process.env.PLATFORM_GEMINI_API_KEY && process.env.PLATFORM_GEMINI_MODEL), canWrite: await this.can('content.write') };
  }
  // Imports (or refreshes) the connections; the same person is updated, never doubled. Names and addresses are stored
  // encrypted; the company and the position stay readable for matching.
  async importCsv(raw: Json) {
    await this.authorize('content.write');
    if (!await this.termsAccepted()) throw new MarketingStoreError('Tanıdık listesi yüklemek için proje sahibinin liste ve kişi verisi sorumluluk metnini kabul etmesi gerekir (Firma bul → Gelişmiş kaynaklar).', 409);
    if (typeof raw.csv !== 'string' || !raw.csv.trim() || raw.csv.length > 90_000) throw new MarketingStoreError('Dosya boş veya çok büyük.');
    const people = parseConnections(raw.csv);
    if (!people.length) throw new MarketingStoreError('Dosyada kişi satırı yok.');
    // A large file arrives in parts (the browser splits it under the request size limit); only the first part counts.
    if (raw.part === undefined || raw.part === 0) await this.usage('network_import', LIMITS.importsPerDay, 'Bugünkü tanıdık listesi yükleme hakkı doldu. Yarın tekrar deneyin.');
    const now = new Date().toISOString();
    const result = await this.db.transaction(async () => {
      const existing = new Map((await this.db.prepare('SELECT id,contact_key FROM platform_network_contacts WHERE organization_id=? AND project_id=?').all(...this.args()) as { id: string; contact_key: string }[]).map(row => [row.contact_key, row.id]));
      let added = 0, updated = 0, skipped = 0;
      for (const item of people) {
        const key = sha(JSON.stringify([fold(item.firstName), fold(item.lastName), item.url ? item.url.toLowerCase() : companyKey(item.company)]));
        const person: Person = { firstName: item.firstName, lastName: item.lastName, email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(item.email) ? item.email : '', url: /^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(item.url) ? item.url : '' };
        const id = existing.get(key);
        if (id) {
          await this.db.prepare('UPDATE platform_network_contacts SET encrypted_person=?,company=?,company_key=?,position=?,imported_at=?,updated_at=? WHERE id=?').run(encryptCredentials(person, this.key, ...this.args(), `network:${id}`), item.company, companyKey(item.company), item.position, now, now, id);
          updated++; continue;
        }
        if (existing.size >= LIMITS.contacts) { skipped++; continue; }
        const newId = `network_${randomUUID()}`;
        await this.db.prepare("INSERT INTO platform_network_contacts(id,organization_id,project_id,contact_key,encrypted_person,company,company_key,position,connected_on,state,asked_at,prospect_id,imported_by,imported_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'new',NULL,NULL,?,?,?)")
          .run(newId, ...this.args(), key, encryptCredentials(person, this.key, ...this.args(), `network:${newId}`), item.company, companyKey(item.company), item.position, item.connected || null, this.scope.subject, now, now);
        existing.set(key, newId); added++;
      }
      await this.audit('prospect.network.import');
      return { added, updated, skipped };
    });
    return { ...result, snapshot: await this.read() };
  }
  async clear() {
    await this.authorize('content.write');
    await this.db.prepare('DELETE FROM platform_network_contacts WHERE organization_id=? AND project_id=?').run(...this.args());
    await this.audit('prospect.network.clear');
    return await this.read();
  }
  // A short, personal message asking for an introduction (or, for a company not on the list yet, for a first chat).
  async draft(raw: Json, generator?: CoachGenerator) {
    await this.authorize('content.write');
    const row = await this.contact(raw.contactId), person = this.person(row), project = (await this.repo.workspace(this.scope.subject, ...this.args()))!.project, tr = project.language !== 'en';
    const target = typeof raw.prospectId === 'string' ? await this.db.prepare('SELECT company,reason FROM platform_prospects WHERE id=? AND organization_id=? AND project_id=?').get(raw.prospectId, ...this.args()) as { company: string; reason: string } | undefined : undefined;
    const brief = await this.db.prepare('SELECT brief_json FROM platform_growth_coach WHERE organization_id=? AND project_id=? AND brief_json IS NOT NULL').get(...this.args()) as { brief_json: string } | undefined;
    const offer = clean(brief ? (JSON.parse(brief.brief_json) as { positioning?: string }).positioning : '', 300);
    await this.usage('network_draft', LIMITS.draftsPerDay, 'Bugünkü tanıdık mesajı hakkı doldu.');
    const template = tr
      ? `Merhaba ${person.firstName}, nasılsın? ${project.name} üzerinde çalışıyorum${offer ? `: ${offer.replace(/\.$/, '')}` : ''}. ${target ? `${row.company} tarafında bu konuyla ilgilenen kişiyle 15 dakikalık bir tanışma ayarlamama yardım edebilir misin?` : `${row.company} için faydalı olabilir mi, 15 dakika fikrini alabilir miyim?`}`
      : `Hi ${person.firstName}, how are you? I am working on ${project.name}${offer ? `: ${offer.replace(/\.$/, '')}` : ''}. ${target ? `Could you help me set up a 15-minute intro with the right person at ${row.company}?` : `Could it help ${row.company}? Could I get your view in 15 minutes?`}`;
    if (!generator) return { text: template.slice(0, 600), source: 'template' as const };
    const prompt = `Write a short, warm LinkedIn message in ${tr ? 'Turkish' : 'English'} from a founder to someone they already know (a first-degree connection). Rules: at most ${LIMITS.words} words; friendly and direct; no invented facts, numbers, results or shared memories; no links; no percentages; end with exactly one clear ask. ${target ? `Ask them for a short introduction to the right person at their company, ${row.company}, because we would like to help them.` : `Ask whether what we do could help their company, ${row.company}, and for 15 minutes of their view.`}
Our side: ${JSON.stringify({ product: project.name, offer, whyThisCompany: clean(target?.reason, 300) })}
Their side: ${JSON.stringify({ firstName: person.firstName, position: row.position, company: row.company })}
Return JSON only: {"text":"..."}`;
    return await runCoachAi(this.db, this.scope, generator, prompt, output => {
      const value = coachObject(parseCoachJson(output)); let text = '';
      try { text = coachText(value.text, 1200); } catch { text = ''; }
      if (!text || text.split(/\s+/).length > LIMITS.words + 15 || /https?:\/\/|www\./i.test(text) || COACH_BANNED.test(text)) throw new MarketingStoreError('AI mesajı kurallara uymadı. Hazır şablonu kullanabilirsiniz.', 422);
      return text;
    }, async text => { await this.audit('prospect.network.draft.ai'); return { text, source: 'ai' as const }; });
  }
  // The person sent the message from their own account: the contact is marked, and the target company counts as contacted.
  async mark(raw: Json) {
    await this.authorize('content.write');
    const row = await this.contact(raw.contactId), state = ['asked', 'helped', 'not_relevant', 'new'].includes(String(raw.state)) ? raw.state as NetworkState : null;
    if (!state) throw new MarketingStoreError('Geçersiz durum.');
    const prospectId = typeof raw.prospectId === 'string' ? raw.prospectId : null, now = new Date().toISOString();
    await this.db.prepare('UPDATE platform_network_contacts SET state=?,asked_at=CASE WHEN ?=\'asked\' THEN ? ELSE asked_at END,prospect_id=COALESCE(?,prospect_id),updated_at=? WHERE id=?').run(state, state, now, prospectId, now, row.id);
    if (state === 'asked' && prospectId) {
      const prospect = await this.db.prepare('SELECT state FROM platform_prospects WHERE id=? AND organization_id=? AND project_id=?').get(prospectId, ...this.args()) as { state: string } | undefined;
      if (prospect?.state === 'approved') await new ProspectOutreach(this.db, this.scope, this.key).touch({ id: prospectId, channel: 'network' });
    }
    await this.audit(`prospect.network.${state}`);
    return await this.read();
  }
  // A company from the network goes on the prospect list (the team gives its website).
  async addCompany(raw: Json) {
    await this.authorize('content.write');
    const key = clean(raw.key, 120), row = await this.db.prepare('SELECT company FROM platform_network_contacts WHERE organization_id=? AND project_id=? AND company_key=?').get(...this.args(), key) as { company: string } | undefined;
    if (!row) throw new MarketingStoreError('Firma bulunamadı.', 404);
    await new ProjectProspects(this.db, this.scope).add({ company: row.company, website: raw.website, reason: 'Tanıdık ağında kişiler var.', sector: '', country: '', contactRole: '' });
    await this.audit('prospect.network.add_company');
    return await this.read();
  }
}
