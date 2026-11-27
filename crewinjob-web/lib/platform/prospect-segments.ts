import type { Db } from '../db/client';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { COACH_BANNED, coachObject, type CoachGenerator } from './coach';
import { parseCoachJson, runCoachAi } from './coach-ai';
import { SIGNALS, SIGNAL_KEYS, type SignalKey } from './prospect-finder-types';
import { SEGMENT_LIMITS as LIMITS, segmentAdvice, type SegmentView, type SegmentsSnapshot } from './prospect-segments-types';

// Sales assistant: customer groups (see prospect-segments-types.ts). A suggestion rests on what the project already
// knows: the growth coach's customer profile and positioning, the competitors the team listed, and the sectors of the
// companies it approved or won. Nothing is invented about real companies; a group is a description and a search phrase.
type Json = Record<string, unknown>;
type Row = { id: string; name: string; reason: string; fit: number; keyword: string; signals_json: string; state: 'active' | 'paused'; source: 'ai' | 'template' | 'human'; created_at: string };
const line = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
const CONTACT = /[^\s@]+@[^\s@]+\.[a-z]{2,}|https?:\/\/|www\.|\+?\d[\d\s().-]{8,}\d/i;
const signalsOf = (value: unknown) => [...new Set((Array.isArray(value) ? value : []).filter((key): key is SignalKey => typeof key === 'string' && (SIGNAL_KEYS as string[]).includes(key)))].slice(0, LIMITS.signals);

// The group a company was found for; the outreach keeps it on each email event so the results survive the company.
export async function segmentOf(db: Db, prospectId: string) {
  try { return (await db.prepare('SELECT segment_id FROM platform_prospect_segment_members WHERE prospect_id=?').get(prospectId) as { segment_id: string } | undefined)?.segment_id || null; } catch { return null; }
}
// Puts companies a search found under a group (called by Find companies; ignored before schema 84).
export async function joinSegment(db: Db, scope: { organizationId: string; projectId: string }, segmentId: string, prospectIds: string[]) {
  if (!prospectIds.length) return;
  const now = new Date().toISOString();
  for (const id of prospectIds) await db.prepare('INSERT INTO platform_prospect_segment_members(prospect_id,segment_id,organization_id,project_id,added_at) VALUES(?,?,?,?,?) ON CONFLICT(prospect_id) DO NOTHING').run(id, segmentId, scope.organizationId, scope.projectId, now);
}
export async function segmentExists(db: Db, scope: { organizationId: string; projectId: string }, id: unknown) {
  if (typeof id !== 'string' || !id) return false;
  try { return Boolean(await db.prepare('SELECT 1 FROM platform_prospect_segments WHERE id=? AND organization_id=? AND project_id=?').get(id, scope.organizationId, scope.projectId)); } catch { return false; }
}

export class ProspectSegments {
  private repo: PlatformRepository;
  constructor(private db: Db, private scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private async authorize(write = false) {
    if (!await this.repo.can(this.scope.subject, ...this.args(), 'read') || (await this.repo.workspace(this.scope.subject, ...this.args()))?.project.productPack !== 'standard') throw new MarketingStoreError('Aday listesi için standart proje erişimi gerekli.', 403);
    if (write && !await this.repo.can(this.scope.subject, ...this.args(), 'content.write')) throw new MarketingStoreError('Bu işlem için içerik yazma yetkisi gerekir.', 403);
  }
  private async audit(operation: string) { await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), operation, new Date().toISOString()); }
  private async used() { return (await this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='prospect_segments'").get(...this.args(), new Date().toISOString().slice(0, 10)) as { count: number } | undefined)?.count || 0; }
  private async count() { await this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'prospect_segments',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(), new Date().toISOString().slice(0, 10)); }
  private async rows() { return await this.db.prepare('SELECT * FROM platform_prospect_segments WHERE organization_id=? AND project_id=? ORDER BY created_at').all(...this.args()) as Row[]; }
  private async row(id: unknown) {
    const row = typeof id === 'string' ? await this.db.prepare('SELECT * FROM platform_prospect_segments WHERE id=? AND organization_id=? AND project_id=?').get(id, ...this.args()) as Row | undefined : undefined;
    if (!row) throw new MarketingStoreError('Müşteri grubu bulunamadı.', 404); return row;
  }
  // What the project already knows about its customers.
  private async basis() {
    const coach = await this.db.prepare('SELECT brief_json FROM platform_growth_coach WHERE organization_id=? AND project_id=? AND brief_json IS NOT NULL').get(...this.args()) as { brief_json: string } | undefined;
    const brief = coach ? JSON.parse(coach.brief_json) as { positioning?: string; icp?: { summary?: string; pains?: string[] } } : null;
    let competitors: { name: string; says: string }[] = [];
    try { const brand = await this.db.prepare('SELECT competitors_json FROM platform_coach_brand WHERE organization_id=? AND project_id=?').get(...this.args()) as { competitors_json: string | null } | undefined; competitors = brand?.competitors_json ? JSON.parse(brand.competitors_json) : []; } catch { competitors = []; }
    const sectors = await this.db.prepare("SELECT p.sector, p.state, COALESCE(l.stage,'new') stage FROM platform_prospects p LEFT JOIN platform_prospect_pipeline l ON l.prospect_id=p.id WHERE p.organization_id=? AND p.project_id=? AND p.state='approved'").all(...this.args()) as { sector: string; state: string; stage: string }[];
    return { brief, competitors: competitors.slice(0, 6), approved: sectors, won: sectors.filter(row => row.stage === 'won') };
  }

  async read(): Promise<SegmentsSnapshot> {
    await this.authorize();
    const rows = await this.rows(), basis = await this.basis();
    const members = await this.db.prepare("SELECT m.segment_id, p.id, p.state, COALESCE(l.stage,'new') stage FROM platform_prospect_segment_members m JOIN platform_prospects p ON p.id=m.prospect_id LEFT JOIN platform_prospect_pipeline l ON l.prospect_id=p.id WHERE m.organization_id=? AND m.project_id=?").all(...this.args()) as { segment_id: string; id: string; state: string; stage: string }[];
    // Results from the email and touch history (kept on the events, so they survive removed companies).
    const events = await this.db.prepare("SELECT prospect_id,kind,detail_json FROM platform_prospect_events WHERE organization_id=? AND project_id=? AND kind IN ('email_sent','touch','reply')").all(...this.args()) as { prospect_id: string; kind: string; detail_json: string }[];
    const replies = new Map<string, string>(), first = new Map<string, Set<string>>();
    for (const event of events) {
      const detail = JSON.parse(event.detail_json) as { step?: number; segment?: string; kind?: string };
      if (event.kind === 'reply') { if (detail.kind && detail.kind !== 'auto_reply') replies.set(event.prospect_id, detail.kind); continue; }
      if (event.kind === 'email_sent' && detail.step !== 0) continue;
      const segment = detail.segment || members.find(row => row.id === event.prospect_id)?.segment_id;
      if (segment) (first.get(segment) || first.set(segment, new Set()).get(segment)!).add(event.prospect_id);
    }
    const segments: SegmentView[] = rows.map(row => {
      const mine = members.filter(item => item.segment_id === row.id), touched = [...first.get(row.id) || []];
      const sends = touched.length, replied = touched.filter(id => replies.has(id)).length, interested = touched.filter(id => replies.get(id) === 'interested').length;
      return { id: row.id, name: row.name, reason: row.reason, fit: Number(row.fit), keyword: row.keyword, signals: JSON.parse(row.signals_json) as SignalKey[], state: row.state, source: row.source,
        prospects: mine.length, approved: mine.filter(item => item.state === 'approved').length, sends, replies: replied, interested,
        meetings: mine.filter(item => ['meeting', 'proposal', 'won'].includes(item.stage)).length, won: mine.filter(item => item.stage === 'won').length,
        advice: segmentAdvice(sends, replied, interested), createdAt: row.created_at };
    });
    return { segments, members: Object.fromEntries(members.map(item => [item.id, item.segment_id])), aiConfigured: Boolean(process.env.PLATFORM_GEMINI_API_KEY && process.env.PLATFORM_GEMINI_MODEL), canWrite: await this.repo.can(this.scope.subject, ...this.args(), 'content.write'),
      suggestionsLeft: Math.max(0, LIMITS.suggestPerDay - await this.used()), basis: { profile: Boolean(basis.brief?.icp?.summary || basis.brief?.positioning), competitors: basis.competitors.length, approved: basis.approved.length, won: basis.won.length } };
  }

  private validate(raw: Json) {
    const name = line(raw.name, LIMITS.name), reason = line(raw.reason, LIMITS.reason), keyword = line(raw.keyword, LIMITS.keyword);
    if (name.length < 3) throw new MarketingStoreError('Grubun adını yazın (ör. Online randevusu olmayan diş klinikleri).');
    if (keyword.length < 2) throw new MarketingStoreError('Firma bul’da aranacak sektör ifadesini yazın (ör. diş kliniği).');
    if ([name, reason, keyword].some(value => CONTACT.test(value))) throw new MarketingStoreError('Grup bilgilerine adres, telefon veya bağlantı yazılmaz.');
    const fit = raw.fit === undefined || raw.fit === null || raw.fit === '' ? 50 : Number(raw.fit);
    if (!Number.isInteger(fit) || fit < 0 || fit > 100) throw new MarketingStoreError('Tahmini uyum 0 ile 100 arasında olmalı.');
    return { name, reason, keyword, fit, signals: signalsOf(raw.signals) };
  }
  private async insert(value: { name: string; reason: string; keyword: string; fit: number; signals: SignalKey[] }, source: 'ai' | 'template' | 'human') {
    const now = new Date().toISOString();
    await this.db.prepare("INSERT INTO platform_prospect_segments(id,organization_id,project_id,name,reason,fit,keyword,signals_json,state,source,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'active',?,?,?,?)")
      .run(`psegment_${randomUUID()}`, ...this.args(), value.name, value.reason, value.fit, value.keyword, JSON.stringify(value.signals), source, this.scope.subject, now, now);
  }
  async save(raw: Json) {
    await this.authorize(true);
    const value = this.validate(raw);
    await this.db.transaction(async () => {
      if (raw.id) {
        const row = await this.row(raw.id);
        await this.db.prepare("UPDATE platform_prospect_segments SET name=?,reason=?,fit=?,keyword=?,signals_json=?,source=CASE WHEN source='human' THEN 'human' ELSE source END,updated_at=? WHERE id=?").run(value.name, value.reason, value.fit, value.keyword, JSON.stringify(value.signals), new Date().toISOString(), row.id);
      } else {
        if ((await this.rows()).length >= LIMITS.max) throw new MarketingStoreError(`En çok ${LIMITS.max} müşteri grubu tutulur. Sonuç vermeyen bir grubu silin.`, 409);
        await this.insert(value, 'human');
      }
      await this.audit('prospect.segments.save');
    });
    return await this.read();
  }
  async state(raw: Json) {
    await this.authorize(true);
    const row = await this.row(raw.id), state = raw.state === 'paused' ? 'paused' : 'active';
    await this.db.prepare('UPDATE platform_prospect_segments SET state=?,updated_at=? WHERE id=?').run(state, new Date().toISOString(), row.id);
    await this.audit(`prospect.segments.${state}`);
    return await this.read();
  }
  // Removing a group keeps its companies (they just have no group any more).
  async remove(raw: Json) {
    await this.authorize(true);
    const row = await this.row(raw.id);
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM platform_prospect_segment_members WHERE segment_id=?').run(row.id);
      await this.db.prepare('DELETE FROM platform_prospect_segments WHERE id=?').run(row.id);
      await this.audit('prospect.segments.remove');
    });
    return await this.read();
  }
  // Puts a company under a group by hand (for example one from an uploaded list), or takes it out.
  async assign(raw: Json) {
    await this.authorize(true);
    const prospect = typeof raw.prospectId === 'string' ? await this.db.prepare('SELECT id FROM platform_prospects WHERE id=? AND organization_id=? AND project_id=?').get(raw.prospectId, ...this.args()) as { id: string } | undefined : undefined;
    if (!prospect) throw new MarketingStoreError('Aday bulunamadı.', 404);
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM platform_prospect_segment_members WHERE prospect_id=?').run(prospect.id);
      if (raw.segmentId) { const row = await this.row(raw.segmentId); await joinSegment(this.db, this.scope, row.id, [prospect.id]); }
      await this.audit('prospect.segments.assign');
    });
    return await this.read();
  }

  // Suggests up to four groups. With AI from the whole basis; without it, from the sectors of the approved and won
  // companies and the customer profile. Earlier AI suggestions that never got a company are replaced.
  async suggest(raw: Json, generator?: CoachGenerator) {
    await this.authorize(true);
    if (await this.used() >= LIMITS.suggestPerDay) throw new MarketingStoreError('Bugünkü grup önerisi hakkı doldu. Yarın tekrar deneyin.', 429);
    const project = (await this.repo.workspace(this.scope.subject, ...this.args()))!.project, tr = project.language !== 'en', basis = await this.basis();
    const profile = line(basis.brief?.icp?.summary, 400), positioning = line(basis.brief?.positioning, 400);
    const bySector = new Map<string, { count: number; won: number }>();
    for (const row of basis.approved) { const key = line(row.sector, 60); if (!key) continue; const item = bySector.get(key) || { count: 0, won: 0 }; item.count++; if (row.stage === 'won') item.won++; bySector.set(key, item); }
    const existing = await this.rows(), names = existing.map(row => row.name.toLocaleLowerCase('tr'));
    const store = async (items: { name: string; reason: string; keyword: string; fit: number; signals: SignalKey[] }[], source: 'ai' | 'template') => await this.db.transaction(async () => {
      for (const row of existing.filter(item => item.source !== 'human')) {
        const used = await this.db.prepare('SELECT 1 FROM platform_prospect_segment_members WHERE segment_id=?').get(row.id);
        if (!used) await this.db.prepare('DELETE FROM platform_prospect_segments WHERE id=?').run(row.id);
      }
      const room = LIMITS.max - (await this.rows()).length;
      for (const item of items.filter(item => !names.includes(item.name.toLocaleLowerCase('tr'))).slice(0, Math.max(0, room))) await this.insert(item, source);
      await this.count(); await this.audit(`prospect.segments.suggest.${source}`);
      return await this.read();
    });
    if (!generator || raw.mode === 'template') {
      const items = [...bySector].sort((a, b) => b[1].won - a[1].won || b[1].count - a[1].count).slice(0, LIMITS.suggestions).map(([sector, item]) => ({
        name: tr ? `${sector} (onayladığınız firmalar gibi)` : `${sector} (like the companies you approved)`.slice(0, LIMITS.name), keyword: sector.toLocaleLowerCase(tr ? 'tr' : 'en'), signals: [] as SignalKey[],
        reason: tr ? `${item.count} firmayı onayladınız${item.won ? `, ${item.won} tanesi müşteri oldu` : ''}.` : `You approved ${item.count} companies${item.won ? `, ${item.won} became customers` : ''}.`, fit: Math.min(90, 50 + item.count * 5 + item.won * 15) }));
      if (!items.length) throw new MarketingStoreError(tr ? 'Öneri için önce birkaç firmayı onaylayın ya da Büyüme koçunda müşteri profilinizi oluşturun; isterseniz grubu kendiniz ekleyin.' : 'Approve a few companies first or build your customer profile in the Growth coach; or add a group yourself.', 409);
      return await store(items.map(item => ({ ...item, name: item.name.slice(0, LIMITS.name) })), 'template');
    }
    if (!profile && !positioning && !bySector.size && !basis.competitors.length) throw new MarketingStoreError('Öneri için Büyüme koçunda müşteri profilinizi oluşturun veya birkaç firmayı onaylayın; isterseniz grubu kendiniz ekleyin.', 409);
    const prompt = `You help a small business decide which groups of companies (B2B customers) to sell to first. Language: ${tr ? 'Turkish' : 'English'}.
Use ONLY the facts below; never name real companies, never invent numbers or results; no percentages in the text, no "guarantee", no links, addresses or phone numbers.
Suggest ${LIMITS.suggestions} concrete customer groups. Each: "name" (at most ${LIMITS.name} characters, specific: a type of business plus a situation, e.g. "dental clinics without online booking"), "reason" (one sentence, at most 200 characters, why this group needs what we sell, based on the facts), "fit" (an integer 1-95, your honest estimate of fit; lower when the facts are thin), "keyword" (the business type to type into a Google Maps search, 1-4 words, e.g. "diş kliniği"), "signals" (0-3 keys from this list that, seen on their website, show the opportunity: ${SIGNAL_KEYS.map(key => `${key} (${SIGNALS[key].label[1]})`).join(', ')}).
Do not repeat these existing groups: ${JSON.stringify(existing.map(row => row.name))}.
Facts: ${JSON.stringify({ business: project.name, website: project.website, positioning, customerProfile: profile, pains: (basis.brief?.icp?.pains || []).slice(0, 5).map(item => line(item, 160)), competitors: basis.competitors.map(item => ({ name: line(item.name, 80), says: line(item.says, 200) })), approvedSectors: [...bySector].map(([sector, item]) => ({ sector, approved: item.count, won: item.won })) })}
Return JSON only: {"segments":[{"name":"...","reason":"...","fit":0,"keyword":"...","signals":["..."]}]}`;
    return await runCoachAi(this.db, this.scope, generator, prompt, output => {
      const list = coachObject(parseCoachJson(output)).segments, fail = () => new MarketingStoreError('AI önerisi kurallara uymadı. Grubu kendiniz ekleyebilir veya tekrar deneyebilirsiniz.', 422);
      if (!Array.isArray(list) || !list.length) throw fail();
      // An item with a missing name or search phrase is left out; the others stay.
      const items = list.slice(0, LIMITS.suggestions).map(item => { try { const value = coachObject(item); return { name: line(value.name, LIMITS.name), reason: line(value.reason, LIMITS.reason), keyword: line(value.keyword, LIMITS.keyword), fit: Math.max(1, Math.min(95, Math.round(Number(value.fit) || 50))), signals: signalsOf(value.signals) }; } catch { return null; } })
        .filter((item): item is NonNullable<typeof item> => Boolean(item && item.name.length >= 3 && item.keyword.length >= 2));
      if (!items.length || items.some(item => COACH_BANNED.test(`${item.name} ${item.reason}`) || CONTACT.test(`${item.name} ${item.reason} ${item.keyword}`))) throw fail();
      return items;
    }, async items => await store(items, 'ai'));
  }
}
