import type { Db } from '../db/client';
import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { ProjectOperations } from './operations';
import { COACH_BANNED, coachObject, coachText, zonedDateKey, zonedInstant, type CoachGenerator } from './coach';
import { parseCoachJson, runCoachAi } from './coach-ai';
import { decryptCredentials, encryptCredentials } from './credential-envelope';
import { emailAddress, publicEmailOrigin } from './email-safety';
import { SIGNALS, type Signal } from './prospect-finder-types';
import { PERSONAL_MAIL } from './prospect-sources-types';
import {
  BOOKING_LIMITS, DEFAULT_BOOKING, PROPOSAL_LIMITS,
  type BookingSettings, type BookingSnapshot, type BookingView, type ProposalContent, type ProposalView, type PublicBooking, type PublicProposal,
} from './prospect-workflow-types';

// Sales assistant, after the first answer: the team's own booking page (no Calendly needed) and a proposal draft
// built from the brief and the company's findings, shared through a link like the mini analysis.
type Json = Record<string, unknown>;
type Need = 'read' | 'content.write' | 'campaign.approve';
const HOUR = 3600000, DAY = 24 * HOUR;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const line = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const block = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '';
const URLS = /https?:\/\/|www\./i, PERSONAL = /[^\s@]+@[^\s@]+\.[a-z]{2,}|\+?\d[\d\s().-]{8,}\d/i;
const host = (website: string) => { try { return new URL(website).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const brand = async (db: Db, organizationId: string, projectId: string) => {
  const kit = await db.prepare('SELECT kit_json,logo_data,logo_mime FROM platform_brand_kits WHERE organization_id=? AND project_id=?').get(organizationId, projectId) as { kit_json: string; logo_data: string | null; logo_mime: string | null } | undefined;
  const value = kit ? JSON.parse(kit.kit_json) as { colors?: { primary?: string; accent?: string } } : {};
  return { primary: /^#[0-9a-f]{6}$/i.test(value.colors?.primary || '') ? value.colors!.primary! : '#191f16', accent: /^#[0-9a-f]{6}$/i.test(value.colors?.accent || '') ? value.colors!.accent! : '#baf331', logo: kit?.logo_data && kit.logo_mime ? `data:${kit.logo_mime};base64,${kit.logo_data}` : null };
};
abstract class Scoped {
  protected repo: PlatformRepository;
  constructor(protected db: Db, protected scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  protected args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  protected can(need: Need) { return this.repo.can(this.scope.subject, ...this.args(), need); }
  protected async project() { return (await this.repo.workspace(this.scope.subject, ...this.args()))!.project; }
  protected async authorize(need: Need = 'read') {
    if (!await this.can('read') || (await this.repo.workspace(this.scope.subject, ...this.args()))?.project.productPack !== 'standard') throw new MarketingStoreError('Aday listesi için standart proje erişimi gerekli.', 403);
    if (!await this.can(need)) throw new MarketingStoreError(need === 'campaign.approve' ? 'Bu ayarı onay yetkisi olan ekip üyeleri değiştirir.' : 'Bu işlem için içerik yazma yetkisi gerekir.', 403);
  }
  protected async audit(operation: string) { await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), operation, new Date().toISOString()); }
  protected async usage(resource: string, limit: number, message: string) {
    const day = new Date().toISOString().slice(0, 10), used = (await this.db.prepare('SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource=?').get(...this.args(), day, resource) as { count: number } | undefined)?.count || 0;
    if (used >= limit) throw new MarketingStoreError(message, 429);
    await this.db.prepare('INSERT INTO platform_usage VALUES(?,?,?,?,1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1').run(...this.args(), day, resource);
  }
}

// ---- Booking page ----
type BookingRow = { organization_id: string; project_id: string; booking_key: string; enabled: number; title: string; duration_min: number; weekdays: string; start_hour: number; end_hour: number; notice_hours: number; horizon_days: number; owner_id: string };
const settingsOf = (row: BookingRow | undefined): BookingSettings => row ? { enabled: Boolean(row.enabled), title: row.title, durationMin: Number(row.duration_min), weekdays: JSON.parse(row.weekdays), startHour: Number(row.start_hour), endHour: Number(row.end_hour), noticeHours: Number(row.notice_hours), horizonDays: Number(row.horizon_days) } : { ...DEFAULT_BOOKING };
export const bookingLink = (key: string) => { const origin = publicEmailOrigin(); return origin ? `${origin}/randevu#k=${key}` : null; };
// Free start times: the chosen weekdays and hours in the project's time zone, after the notice period, without taken ones.
export function bookingSlots(settings: BookingSettings, timeZone: string, taken: Set<string>, now = Date.now()) {
  const out: string[] = [], days = new Set<string>();
  for (let index = 0; index <= settings.horizonDays && out.length < BOOKING_LIMITS.slots; index++) {
    const key = zonedDateKey(new Date(now + index * DAY), timeZone); if (days.has(key)) continue; days.add(key);
    if (!settings.weekdays.includes(new Date(`${key}T12:00:00Z`).getUTCDay())) continue;
    for (let minute = settings.startHour * 60; minute + settings.durationMin <= settings.endHour * 60; minute += settings.durationMin) {
      const at = Date.parse(zonedInstant(key, Math.floor(minute / 60), timeZone)) + (minute % 60) * 60000, iso = new Date(at).toISOString();
      if (at >= now + settings.noticeHours * HOUR && !taken.has(iso)) out.push(iso);
    }
  }
  return out.slice(0, BOOKING_LIMITS.slots);
}
export class ProspectBooking extends Scoped {
  constructor(db: Db, scope: MarketingScope, private key: string) { super(db, scope); }
  private async row() { return await this.db.prepare('SELECT * FROM platform_booking_settings WHERE organization_id=? AND project_id=?').get(...this.args()) as BookingRow | undefined; }
  async read(): Promise<BookingSnapshot> {
    await this.authorize();
    const row = await this.row(), rows = await this.db.prepare("SELECT * FROM platform_bookings WHERE organization_id=? AND project_id=? AND starts_at>? ORDER BY starts_at LIMIT 50").all(...this.args(), new Date(Date.now() - DAY).toISOString()) as Json[];
    const upcoming = rows.map((item): BookingView => { const contact = decryptCredentials<{ name: string; email: string; company: string; note: string }>(String(item.encrypted_contact), this.key, ...this.args(), `booking:${item.id}`);
      return { id: String(item.id), startsAt: String(item.starts_at), endsAt: String(item.ends_at), ...contact, prospectId: item.prospect_id ? String(item.prospect_id) : null, state: item.state as BookingView['state'] }; });
    return { settings: settingsOf(row), link: row?.enabled ? bookingLink(row.booking_key) : null, upcoming, canManage: await this.can('campaign.approve'), canWrite: await this.can('content.write') };
  }
  async save(raw: Json) {
    await this.authorize('campaign.approve');
    const weekdays = Array.isArray(raw.weekdays) ? [...new Set(raw.weekdays.map(Number))].filter(day => Number.isInteger(day) && day >= 0 && day <= 6).sort() : [];
    const value: BookingSettings = { enabled: raw.enabled === true, title: line(raw.title, 80), durationMin: Number(raw.durationMin), weekdays, startHour: Number(raw.startHour), endHour: Number(raw.endHour), noticeHours: Number(raw.noticeHours), horizonDays: Number(raw.horizonDays) };
    if (!(BOOKING_LIMITS.durations as readonly number[]).includes(value.durationMin) || !weekdays.length || !Number.isInteger(value.startHour) || !Number.isInteger(value.endHour) || value.startHour < 6 || value.endHour > 23 || value.endHour * 60 - value.startHour * 60 < value.durationMin
      || !Number.isInteger(value.noticeHours) || value.noticeHours < 1 || value.noticeHours > 168 || !Number.isInteger(value.horizonDays) || value.horizonDays < 3 || value.horizonDays > 60) throw new MarketingStoreError('Randevu ayarları geçersiz: en az bir gün, başlangıçtan sonra biten saatler, 15–60 dakikalık görüşme, 1–168 saat ön süre ve 3–60 gün ileri.');
    if (value.enabled && !publicEmailOrigin()) throw new MarketingStoreError('Randevu sayfası için sunucunun genel adresi (PLATFORM_PUBLIC_ORIGIN) gerekli.', 503);
    const now = new Date().toISOString(), title = value.title || (await this.project()).name;
    if (await this.row()) await this.db.prepare('UPDATE platform_booking_settings SET enabled=?,title=?,duration_min=?,weekdays=?,start_hour=?,end_hour=?,notice_hours=?,horizon_days=?,owner_id=?,updated_at=? WHERE organization_id=? AND project_id=?').run(value.enabled ? 1 : 0, title, value.durationMin, JSON.stringify(weekdays), value.startHour, value.endHour, value.noticeHours, value.horizonDays, this.scope.subject, now, ...this.args());
    else await this.db.prepare('INSERT INTO platform_booking_settings(organization_id,project_id,booking_key,enabled,title,duration_min,weekdays,start_hour,end_hour,notice_hours,horizon_days,owner_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...this.args(), `rzb_${randomBytes(18).toString('base64url')}`, value.enabled ? 1 : 0, title, value.durationMin, JSON.stringify(weekdays), value.startHour, value.endHour, value.noticeHours, value.horizonDays, this.scope.subject, now);
    await this.audit(`prospect.booking.${value.enabled ? 'on' : 'off'}`);
    return await this.read();
  }
  async cancel(raw: Json) {
    await this.authorize('content.write');
    const changed = (await this.db.prepare("UPDATE platform_bookings SET state='cancelled',updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND state='booked'").run(new Date().toISOString(), raw.id, ...this.args())).changes;
    if (!changed) throw new MarketingStoreError('Randevu bulunamadı.', 404);
    await this.audit('prospect.booking.cancel');
    return await this.read();
  }
}
const bookingRow = async (db: Db, key: unknown) => typeof key === 'string' && /^rzb_[A-Za-z0-9_-]{24}$/.test(key) ? await db.prepare('SELECT b.*,p.name,p.website,p.timezone,s.language FROM platform_booking_settings b JOIN platform_projects p ON p.id=b.project_id AND p.organization_id=b.organization_id LEFT JOIN platform_project_settings s ON s.project_id=p.id AND s.organization_id=p.organization_id WHERE b.booking_key=? AND b.enabled=1').get(key) as (BookingRow & { name: string; website: string; timezone: string; language: string }) | undefined : undefined;
const taken = async (db: Db, row: BookingRow) => new Set((await db.prepare("SELECT starts_at FROM platform_bookings WHERE organization_id=? AND project_id=? AND state='booked' AND starts_at>?").all(row.organization_id, row.project_id, new Date().toISOString()) as { starts_at: string }[]).map(item => item.starts_at));
export async function publicBooking(db: Db, key: unknown): Promise<PublicBooking | null> {
  const row = await bookingRow(db, key); if (!row) return null;
  return { title: row.title, project: row.name, website: row.website, durationMin: Number(row.duration_min), timezone: row.timezone, slots: bookingSlots(settingsOf(row), row.timezone, await taken(db, row)), language: (row.language || 'tr') === 'en' ? 'en' : 'tr', ...await brand(db, row.organization_id, row.project_id) };
}
// A visitor books a time. The slot must still be free; the team gets a Calendar task and, when the address belongs to
// a company in the pipeline, the company moves to "meeting".
export async function bookMeeting(db: Db, key: string, raw: Json, credentialKey: string) {
  const row = await bookingRow(db, key); if (!row) throw new MarketingStoreError('Bu randevu sayfası kapalı.', 404);
  const name = line(raw.name, 80), email = emailAddress(typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : ''), company = line(raw.company, 120), note = block(raw.note, BOOKING_LIMITS.note), start = typeof raw.start === 'string' ? raw.start : '';
  if (name.length < 2 || !email || raw.consent !== true) throw new MarketingStoreError('Adınızı, e-posta adresinizi yazın ve bilgilendirmeyi onaylayın.');
  const args = [row.organization_id, row.project_id] as const, settings = settingsOf(row);
  return await db.transaction(async () => {
    const day = new Date().toISOString().slice(0, 10), used = (await db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='booking'").get(...args, day) as { count: number } | undefined)?.count || 0;
    if (used >= BOOKING_LIMITS.perDay) throw new MarketingStoreError('Bugün için randevu alınamıyor. Lütfen yarın tekrar deneyin.', 429);
    if (!bookingSlots(settings, row.timezone, await taken(db, row)).includes(start)) throw new MarketingStoreError('Bu saat artık uygun değil. Başka bir saat seçin.', 409);
    await db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'booking',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...args, day);
    const id = `booking_${randomUUID()}`, now = new Date().toISOString(), ends = new Date(Date.parse(start) + settings.durationMin * 60000).toISOString(), domain = email.split('@')[1];
    const prospect = PERSONAL_MAIL.test(email) ? undefined : (await db.prepare("SELECT id,website FROM platform_prospects WHERE organization_id=? AND project_id=? AND state='approved'").all(...args) as { id: string; website: string }[]).find(item => host(item.website) === domain);
    const scope = { subject: row.owner_id, organizationId: row.organization_id, projectId: row.project_id };
    let taskId: string | null = null;
    try { taskId = (await new ProjectOperations(db, scope).saveTask({ title: `${row.language === 'en' ? 'Meeting' : 'Görüşme'}: ${company || name}`.slice(0, 160), dueAt: start, status: 'planned', note: [row.title, `${name}${company ? ` · ${company}` : ''}`, row.language === 'en' ? 'Booked through the Ryzevo booking page; details in the sales assistant.' : 'Ryzevo randevu sayfasından alındı; ayrıntılar Satış asistanında.'].join('\n') })).id; } catch { taskId = null; }
    await db.prepare("INSERT INTO platform_bookings(id,organization_id,project_id,starts_at,ends_at,encrypted_contact,email_domain,prospect_id,state,task_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'booked',?,?,?)")
      .run(id, ...args, start, ends, encryptCredentials({ name, email, company, note }, credentialKey, ...args, `booking:${id}`), domain, prospect?.id || null, taskId, now, now);
    if (prospect) {
      const stage = (await db.prepare('SELECT stage FROM platform_prospect_pipeline WHERE prospect_id=?').get(prospect.id) as { stage: string } | undefined)?.stage || 'new';
      if (['new', 'contacted', 'replied'].includes(stage)) {
        await db.prepare("INSERT INTO platform_prospect_pipeline(prospect_id,organization_id,project_id,stage,value_minor,currency,lost_reason,assigned_to,updated_by,updated_at) VALUES(?,?,?,'meeting',NULL,'','',NULL,'booking',?) ON CONFLICT(prospect_id) DO UPDATE SET stage='meeting',updated_by=excluded.updated_by,updated_at=excluded.updated_at").run(prospect.id, ...args, now);
        await db.prepare('INSERT INTO platform_prospect_events(id,prospect_id,organization_id,project_id,kind,detail_json,actor_id,created_at) VALUES(?,?,?,?,?,?,NULL,?)').run(`pevent_${randomUUID()}`, prospect.id, ...args, 'stage', JSON.stringify({ from: stage, to: 'meeting', via: 'booking' }), now);
      }
      await db.prepare("UPDATE platform_prospect_outreach SET state=CASE WHEN state='active' THEN 'replied' ELSE state END,stop_reason=CASE WHEN state='active' THEN 'replied' ELSE stop_reason END,next_due_at=NULL WHERE prospect_id=?").run(prospect.id);
    }
    await db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run('booking', ...args, 'prospect.booking.booked', now);
    return { startsAt: start, endsAt: ends, title: row.title, project: row.name };
  });
}

// ---- Proposals ----
type ProposalRow = { id: string; prospect_id: string; content_json: string; source: ProposalView['source']; token_hash: string; views: number; last_viewed_at: string | null; expires_at: string | null; revoked_at: string | null; shared_at: string | null; revision: number; created_at: string; updated_at: string };
function readContent(raw: unknown, price: string): ProposalContent {
  const value = coachObject(raw), list = (items: unknown) => (Array.isArray(items) ? items : []).map(item => line(item, PROPOSAL_LIMITS.item)).filter(Boolean).slice(0, PROPOSAL_LIMITS.items);
  const content = { title: line(value.title, PROPOSAL_LIMITS.title), summary: block(value.summary, PROPOSAL_LIMITS.text), needs: list(value.needs), solution: block(value.solution, PROPOSAL_LIMITS.text), scope: list(value.scope), successMetrics: list(value.successMetrics), timeline: block(value.timeline, 400), price: line(price, PROPOSAL_LIMITS.price), nextStep: block(value.nextStep, 400) };
  if (!content.title || !content.summary || !content.solution) throw new MarketingStoreError('Teklifte başlık, özet ve çözüm bölümleri gerekli.');
  const all = [content.title, content.summary, content.solution, content.timeline, content.nextStep, ...content.needs, ...content.scope, ...content.successMetrics].join('\n');
  if (URLS.test(all) || PERSONAL.test(all) || COACH_BANNED.test(all)) throw new MarketingStoreError('Teklif metninde bağlantı, adres, telefon, yüzde veya garanti olmamalı; fiyatı yalnız Fiyat alanına yazın.');
  return content;
}
export class ProspectProposals extends Scoped {
  private async prospect(id: unknown) {
    const row = typeof id === 'string' ? await this.db.prepare('SELECT id,company,website,sector,state FROM platform_prospects WHERE id=? AND organization_id=? AND project_id=?').get(id, ...this.args()) as { id: string; company: string; website: string; sector: string; state: string } | undefined : undefined;
    if (!row) throw new MarketingStoreError('Aday bulunamadı.', 404); return row;
  }
  private async row(prospectId: string) { return await this.db.prepare('SELECT * FROM platform_prospect_proposals WHERE prospect_id=? AND organization_id=? AND project_id=?').get(prospectId, ...this.args()) as ProposalRow | undefined; }
  private view(row: ProposalRow | undefined): ProposalView | null {
    if (!row) return null; const now = new Date().toISOString();
    return { content: JSON.parse(row.content_json), source: row.source, shared: row.shared_at && row.expires_at ? { active: !row.revoked_at && row.expires_at > now, views: Number(row.views), lastViewedAt: row.last_viewed_at, expiresAt: row.expires_at } : null, revision: Number(row.revision), updatedAt: row.updated_at };
  }
  async read(raw: Json) { await this.authorize(); const prospect = await this.prospect(raw.id); return { proposal: this.view(await this.row(prospect.id)) }; }
  private async store(prospectId: string, content: ProposalContent, source: ProposalView['source']) {
    await this.db.transaction(async () => {
      const current = await this.row(prospectId), now = new Date().toISOString();
      if (current) await this.db.prepare('UPDATE platform_prospect_proposals SET content_json=?,source=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(content), source, now, current.id);
      else await this.db.prepare('INSERT INTO platform_prospect_proposals(id,prospect_id,organization_id,project_id,content_json,source,token_hash,views,last_viewed_at,expires_at,revoked_at,shared_at,revision,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,NULL,NULL,NULL,NULL,1,?,?,?)')
        .run(`proposal_${randomUUID()}`, prospectId, ...this.args(), JSON.stringify(content), source, sha(randomBytes(32).toString('hex')), this.scope.subject, now, now);
      await this.audit(`prospect.proposal.${source}`);
    });
    return { proposal: this.view(await this.row(prospectId)) };
  }
  async draft(raw: Json, generator?: CoachGenerator) {
    await this.authorize('content.write');
    const prospect = await this.prospect(raw.id); if (prospect.state !== 'approved') throw new MarketingStoreError('Teklif yalnız onaylı adaylar için hazırlanır.', 409);
    await this.usage('proposal_draft', PROPOSAL_LIMITS.perDay, 'Bugünkü teklif taslağı hakkı doldu. Yarın tekrar deneyin.');
    const project = await this.project(), tr = project.language !== 'en', price = line(raw.price, PROPOSAL_LIMITS.price);
    const brief = await this.db.prepare('SELECT brief_json FROM platform_growth_coach WHERE organization_id=? AND project_id=? AND brief_json IS NOT NULL').get(...this.args()) as { brief_json: string } | undefined;
    const context = brief ? JSON.parse(brief.brief_json) as { positioning?: string; offer?: string; icp?: { summary?: string } } : {};
    const insight = await this.db.prepare('SELECT signals_json FROM platform_prospect_insights WHERE prospect_id=?').get(prospect.id) as { signals_json: string | null } | undefined;
    const findings = insight?.signals_json ? (JSON.parse(insight.signals_json) as Signal[]).filter(item => item.present === false && item.key !== 'hiring').map(item => SIGNALS[item.key].no[tr ? 0 : 1]).slice(0, 5) : [];
    const template = (): ProposalContent => ({ title: tr ? `${prospect.company} için teklif` : `Proposal for ${prospect.company}`,
      summary: tr ? `${project.name} olarak ${prospect.company} ile görüşmemizde konuştuğumuz konular için bu teklifi hazırladık.` : `At ${project.name} we prepared this proposal for the topics we discussed with ${prospect.company}.`,
      needs: findings.length ? findings : [tr ? 'Görüşmede konuşulan ihtiyaçları buraya yazın.' : 'Write the needs discussed in the meeting here.'],
      solution: line(context.positioning, 600) || (tr ? 'Önerdiğimiz çözümü buraya yazın.' : 'Describe the proposed solution here.'),
      scope: [tr ? 'Kapsamdaki işleri madde madde yazın.' : 'List the work in scope.'], successMetrics: [tr ? 'Birlikte anlaştığınız ölçütü yazın (ör. ayda 20 online randevu).' : 'Write the measure you agreed on together (e.g. 20 online bookings a month).'], timeline: tr ? 'Başlangıçtan itibaren …' : 'From the start …', price, nextStep: tr ? 'Onayınızla birlikte başlangıç görüşmesini planlayalım.' : 'With your approval, let’s plan the kick-off.' });
    if (!generator || raw.mode === 'template') return await this.store(prospect.id, template(), 'template');
    const prompt = `Write a short, honest B2B proposal draft in ${tr ? 'Turkish' : 'English'} from a small business to a company. Use ONLY the facts below; do not invent results, numbers, percentages, prices, dates, names, guarantees or links. Keep it plain and specific. "needs", "scope" and "successMetrics" are short bullet lines (at most 6 each); successMetrics are measurable outcomes the customer would check, only from the notes and findings, never invented numbers.
Our side: ${JSON.stringify({ name: project.name, positioning: line(context.positioning, 400), offer: line(context.offer, 300), idealCustomer: line(context.icp?.summary, 300) })}
Their side: ${JSON.stringify({ company: prospect.company, sector: prospect.sector, observedOnTheirSite: findings, notesFromTheTeam: line(raw.notes, 600) })}
Return JSON only: {"title":"...","summary":"...","needs":["..."],"solution":"...","scope":["..."],"successMetrics":["..."],"timeline":"...","nextStep":"..."}`;
    return await runCoachAi(this.db, this.scope, generator, prompt, output => { try { return readContent(parseCoachJson(output), price); } catch { throw new MarketingStoreError('AI teklif taslağı kurallara uymadı. Şablonla başlayıp kendiniz düzenleyebilirsiniz.', 422); } },
      async content => { const current = await this.row(prospect.id), now = new Date().toISOString();
        if (current) await this.db.prepare("UPDATE platform_prospect_proposals SET content_json=?,source='ai',revision=revision+1,updated_at=? WHERE id=?").run(JSON.stringify(content), now, current.id);
        else await this.db.prepare("INSERT INTO platform_prospect_proposals(id,prospect_id,organization_id,project_id,content_json,source,token_hash,views,last_viewed_at,expires_at,revoked_at,shared_at,revision,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'ai',?,0,NULL,NULL,NULL,NULL,1,?,?,?)").run(`proposal_${randomUUID()}`, prospect.id, ...this.args(), JSON.stringify(content), sha(randomBytes(32).toString('hex')), this.scope.subject, now, now);
        await this.audit('prospect.proposal.ai'); return { proposal: this.view(await this.row(prospect.id)) }; });
  }
  async save(raw: Json) {
    await this.authorize('content.write');
    const prospect = await this.prospect(raw.id), current = await this.row(prospect.id);
    if (!current) throw new MarketingStoreError('Önce bir teklif taslağı hazırlayın.', 404);
    if (raw.expectedRevision !== current.revision) throw new MarketingStoreError('Teklif başka bir sekmede değişti. Yenileyip tekrar deneyin.', 409);
    const value = coachObject(raw.content);
    return await this.store(prospect.id, readContent(value, typeof value.price === 'string' ? value.price : ''), 'human');
  }
  // Shares the proposal: a new link (only its hash is kept; the old one stops), 60 days, and the company moves to
  // "proposal" in the pipeline if it was earlier.
  async share(raw: Json, origin: string) {
    await this.authorize('content.write');
    const prospect = await this.prospect(raw.id), current = await this.row(prospect.id);
    if (!current) throw new MarketingStoreError('Önce bir teklif taslağı hazırlayın.', 404);
    const token = randomBytes(32).toString('base64url'), now = new Date(), expires = new Date(now.getTime() + PROPOSAL_LIMITS.days * DAY).toISOString();
    await this.db.transaction(async () => {
      await this.db.prepare('UPDATE platform_prospect_proposals SET token_hash=?,views=0,last_viewed_at=NULL,expires_at=?,revoked_at=NULL,shared_at=?,updated_at=? WHERE id=?').run(sha(token), expires, now.toISOString(), now.toISOString(), current.id);
      const stage = (await this.db.prepare('SELECT stage FROM platform_prospect_pipeline WHERE prospect_id=?').get(prospect.id) as { stage: string } | undefined)?.stage || 'new';
      if (['new', 'contacted', 'replied', 'meeting'].includes(stage)) {
        await this.db.prepare("INSERT INTO platform_prospect_pipeline(prospect_id,organization_id,project_id,stage,value_minor,currency,lost_reason,assigned_to,updated_by,updated_at) VALUES(?,?,?,'proposal',NULL,'','',NULL,?,?) ON CONFLICT(prospect_id) DO UPDATE SET stage='proposal',updated_by=excluded.updated_by,updated_at=excluded.updated_at").run(prospect.id, ...this.args(), this.scope.subject, now.toISOString());
        await this.db.prepare('INSERT INTO platform_prospect_events(id,prospect_id,organization_id,project_id,kind,detail_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`pevent_${randomUUID()}`, prospect.id, ...this.args(), 'stage', JSON.stringify({ from: stage, to: 'proposal', via: 'proposal' }), this.scope.subject, now.toISOString());
      }
      await this.audit('prospect.proposal.share');
    });
    return { url: `${origin}/teklif#token=${token}`, proposal: this.view(await this.row(prospect.id)) };
  }
  async revoke(raw: Json) {
    await this.authorize('content.write');
    const prospect = await this.prospect(raw.id);
    await this.db.prepare('UPDATE platform_prospect_proposals SET revoked_at=? WHERE prospect_id=? AND organization_id=? AND project_id=? AND revoked_at IS NULL').run(new Date().toISOString(), prospect.id, ...this.args());
    await this.audit('prospect.proposal.revoke');
    return { proposal: this.view(await this.row(prospect.id)) };
  }
}
// Public: the proposal behind a link; unknown, expired and revoked links look the same. A team preview is not counted.
export async function openProposal(db: Db, token: string, preview = false): Promise<PublicProposal | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await db.prepare('SELECT r.*,p.company,j.name,j.website,s.language FROM platform_prospect_proposals r JOIN platform_prospects p ON p.id=r.prospect_id JOIN platform_projects j ON j.id=r.project_id AND j.organization_id=r.organization_id LEFT JOIN platform_project_settings s ON s.project_id=j.id AND s.organization_id=j.organization_id WHERE r.token_hash=?').get(sha(token)) as (ProposalRow & { organization_id: string; project_id: string; company: string; name: string; website: string; language: string }) | undefined;
  const now = new Date().toISOString();
  if (!row || !row.shared_at || row.revoked_at || !row.expires_at || row.expires_at <= now) return null;
  if (!preview) await db.prepare('UPDATE platform_prospect_proposals SET views=views+1,last_viewed_at=? WHERE id=?').run(now, row.id);
  const booking = await db.prepare('SELECT booking_key FROM platform_booking_settings WHERE organization_id=? AND project_id=? AND enabled=1').get(row.organization_id, row.project_id) as { booking_key: string } | undefined;
  return { language: row.language === 'en' ? 'en' : 'tr', company: row.company, content: JSON.parse(row.content_json), createdAt: row.shared_at, sender: { name: row.name, website: row.website, ...await brand(db, row.organization_id, row.project_id) }, booking: booking ? bookingLink(booking.booking_key) : null };
}
export async function bookingUrlFor(db: Db, scope: { organizationId: string; projectId: string }) {
  try { const row = await db.prepare('SELECT booking_key FROM platform_booking_settings WHERE organization_id=? AND project_id=? AND enabled=1').get(scope.organizationId, scope.projectId) as { booking_key: string } | undefined; return row ? bookingLink(row.booking_key) : null; } catch { return null; }
}
