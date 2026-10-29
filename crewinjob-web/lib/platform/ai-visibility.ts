import 'server-only';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { ProjectOperations } from './operations';
import { recordAiUsage } from './coach-ai';
import { AI_VISIBILITY_LIMITS as LIMITS, type AiVisibilityCheck, type AiVisibilityView, type GroundedAnswer, type GroundedGenerator } from './ai-visibility-types';
import { ryzevoFeature } from './ryzevo-features';

type CheckRow = { question_id: string; status: 'ok' | 'failed'; brand_mentioned: number | null; site_cited: number | null; competitors_json: string; sources_json: string; queries_json: string; excerpt: string | null; via: 'manual' | 'schedule'; asked_at: string };
const DAY = 86400000;
// Lower case, accents and Turkish dotless i folded, punctuation as spaces: "Kahve Dükkanı" matches "kahve dukkani".
const fold = (value: string) => ` ${value.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const contains = (text: string, name: string) => { const needle = fold(name); return needle.trim().length >= 3 && fold(text).includes(needle); };
const host = (website: string) => { try { return new URL(website).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
const sameSite = (domain: string, site: string) => { const value = domain.replace(/^www\./, '').toLowerCase(); return value === site || value.endsWith(`.${site}`); };
const view = (row: CheckRow): AiVisibilityCheck => ({ askedAt: row.asked_at, status: row.status, brandMentioned: row.brand_mentioned === null ? null : Boolean(row.brand_mentioned), siteCited: row.site_cited === null ? null : Boolean(row.site_cited), competitors: JSON.parse(row.competitors_json), sources: JSON.parse(row.sources_json), queries: JSON.parse(row.queries_json), excerpt: row.excerpt, via: row.via });

/** What the answer says about the project: read from the answer text and the cited sources only. */
export function judgeAnswer(answer: Pick<GroundedAnswer, 'text' | 'sources'>, brand: string, website: string, competitors: string[]) {
  const site = host(website), brandMentioned = contains(answer.text, brand) || Boolean(site && answer.text.toLowerCase().includes(site));
  const siteCited = Boolean(site && answer.sources.some(source => sameSite(source.domain, site)));
  return { brandMentioned, siteCited, competitors: competitors.filter(name => contains(answer.text, name)).slice(0, 10) };
}

export class AiVisibility {
  private repo: PlatformRepository;
  constructor(private db: Database.Database, private scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private can(permission: 'read' | 'content.write') { return this.repo.can(this.scope.subject, ...this.args(), permission); }
  private project() { return this.repo.workspace(this.scope.subject, ...this.args())?.project; }
  private authorize(permission: 'read' | 'content.write' = 'read') {
    if (!this.can('read') || !ryzevoFeature(this.project()?.productPack, 'ai_visibility')) throw new MarketingStoreError('AI görünürlüğü için standart proje erişimi gerekli.', 403);
    if (!this.can(permission)) throw new MarketingStoreError('Bu işlem için içerik yazma yetkisi gerekir.', 403);
  }
  private audit(operation: string) { this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), operation, new Date().toISOString()); }
  // Competitor names come from Brand & competitors; nothing else is treated as a competitor.
  private competitors() { const row = this.db.prepare('SELECT competitors_json FROM platform_coach_brand WHERE organization_id=? AND project_id=?').get(...this.args()) as { competitors_json: string | null } | undefined; try { return ((row?.competitors_json ? JSON.parse(row.competitors_json) : []) as { name?: unknown }[]).map(item => String(item.name || '').trim()).filter(Boolean).slice(0, 10); } catch { return []; } }
  private settings() { return this.db.prepare('SELECT owner_id,next_at,last_error FROM platform_ai_visibility_settings WHERE organization_id=? AND project_id=?').get(...this.args()) as { owner_id: string; next_at: string; last_error: string | null } | undefined; }
  read(provider: string | null = null): AiVisibilityView {
    this.authorize(); const project = this.project()!, settings = this.settings();
    const questions = this.db.prepare('SELECT id,question,created_at FROM platform_ai_visibility_questions WHERE organization_id=? AND project_id=? ORDER BY created_at,id').all(...this.args()) as { id: string; question: string; created_at: string }[];
    const checks = this.db.prepare('SELECT * FROM platform_ai_visibility_checks WHERE question_id=? AND organization_id=? AND project_id=? ORDER BY asked_at DESC LIMIT ?');
    const list = questions.map(item => { const rows = checks.all(item.id, ...this.args(), LIMITS.history) as CheckRow[]; return { id: item.id, question: item.question, createdAt: item.created_at, latest: rows[0] ? view(rows[0]) : null, history: rows.map(row => ({ askedAt: row.asked_at, status: row.status, brandMentioned: row.brand_mentioned === null ? null : Boolean(row.brand_mentioned), siteCited: row.site_cited === null ? null : Boolean(row.site_cited) })) }; });
    const answered = list.map(item => item.latest).filter((item): item is AiVisibilityCheck => Boolean(item && item.status === 'ok'));
    return { brand: project.name, domain: host(project.website), competitors: this.competitors(), questions: list,
      weekly: { on: Boolean(settings), nextAt: settings?.next_at || null, lastError: settings?.last_error || null, ownedByYou: settings?.owner_id === this.scope.subject },
      summary: { asked: answered.length, mentioned: answered.filter(item => item.brandMentioned).length, cited: answered.filter(item => item.siteCited).length },
      canWrite: this.can('content.write'), aiConfigured: Boolean(provider), provider };
  }
  add(raw: Record<string, unknown>) {
    this.authorize('content.write');
    if (Object.keys(raw).some(key => !['action', 'question'].includes(key)) || typeof raw.question !== 'string') throw new MarketingStoreError('Geçersiz soru.');
    const question = raw.question.replace(/\s+/g, ' ').trim();
    if (question.length < 8 || question.length > 300) throw new MarketingStoreError('Soru 8–300 karakter olmalı.');
    this.db.transaction(() => {
      this.authorize('content.write');
      const count = (this.db.prepare('SELECT COUNT(*) n FROM platform_ai_visibility_questions WHERE organization_id=? AND project_id=?').get(...this.args()) as { n: number }).n;
      if (count >= LIMITS.questions) throw new MarketingStoreError(`En fazla ${LIMITS.questions} soru izlenebilir.`, 409);
      if (this.db.prepare('SELECT 1 FROM platform_ai_visibility_questions WHERE organization_id=? AND project_id=? AND lower(question)=lower(?)').get(...this.args(), question)) throw new MarketingStoreError('Bu soru zaten listede.', 409);
      this.db.prepare('INSERT INTO platform_ai_visibility_questions(id,organization_id,project_id,question,created_by,created_at) VALUES(?,?,?,?,?,?)').run(`aiq_${randomUUID()}`, ...this.args(), question, this.scope.subject, new Date().toISOString());
      this.audit('ai_visibility.question.add');
    }).immediate();
    return this.read();
  }
  remove(raw: Record<string, unknown>) {
    this.authorize('content.write');
    const changed = this.db.prepare('DELETE FROM platform_ai_visibility_questions WHERE id=? AND organization_id=? AND project_id=?').run(String(raw.id || ''), ...this.args());
    if (!changed.changes) throw new MarketingStoreError('Soru bulunamadı.', 404);
    this.audit('ai_visibility.question.remove'); return this.read();
  }
  // Weekly checks run as the member who turns them on and use one AI credit per question.
  weekly(raw: Record<string, unknown>) {
    this.authorize('content.write');
    if (raw.on === false) { this.db.prepare('DELETE FROM platform_ai_visibility_settings WHERE organization_id=? AND project_id=?').run(...this.args()); this.audit('ai_visibility.weekly.off'); return this.read(); }
    if (raw.on !== true) throw new MarketingStoreError('Geçersiz ayar.');
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO platform_ai_visibility_settings(organization_id,project_id,owner_id,next_at,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET owner_id=excluded.owner_id,last_error=NULL,updated_at=excluded.updated_at').run(...this.args(), this.scope.subject, new Date(Date.now() + LIMITS.weeklyDays * DAY).toISOString(), now, now);
    this.audit('ai_visibility.weekly.on'); return this.read();
  }
  /** Asks one question now. A failed answer is recorded as failed (never as "not mentioned") and its AI credit is refunded. */
  async ask(raw: Record<string, unknown>, generator: GroundedGenerator | undefined, via: 'manual' | 'schedule' = 'manual') {
    this.authorize('content.write');
    if (!generator) throw new MarketingStoreError('Bu platform için AI sağlayıcısı ve model henüz yapılandırılmadı.', 503);
    const row = this.db.prepare('SELECT id,question FROM platform_ai_visibility_questions WHERE id=? AND organization_id=? AND project_id=?').get(String(raw.id || ''), ...this.args()) as { id: string; question: string } | undefined;
    if (!row) throw new MarketingStoreError('Soru bulunamadı.', 404);
    const project = this.project()!, operations = new ProjectOperations(this.db, this.scope), reservation = operations.reserveAi(), at = () => new Date().toISOString();
    let answer: GroundedAnswer;
    try { answer = await generator(row.question, project.language === 'en' ? 'en' : 'tr'); }
    catch {
      try { operations.refundAi(reservation); } catch { console.error('platform_usage_release_failed'); }
      this.db.prepare("INSERT INTO platform_ai_visibility_checks(id,organization_id,project_id,question_id,provider,model,status,asked_by,via,asked_at) VALUES(?,?,?,?,'unknown','unknown','failed',?,?,?)").run(`aic_${randomUUID()}`, ...this.args(), row.id, this.scope.subject, via, at());
      throw new MarketingStoreError('AI cevabı alınamadı. Biraz sonra yeniden deneyin.', 502);
    }
    const judged = judgeAnswer(answer, project.name, project.website, this.competitors());
    const sources = answer.sources.filter(item => item.domain).slice(0, 10).map(item => ({ domain: item.domain.slice(0, 120), title: item.title.slice(0, 160) }));
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO platform_ai_visibility_checks(id,organization_id,project_id,question_id,provider,model,status,brand_mentioned,site_cited,competitors_json,sources_json,queries_json,excerpt,asked_by,via,asked_at) VALUES(?,?,?,?,?,?,'ok',?,?,?,?,?,?,?,?,?)")
        .run(`aic_${randomUUID()}`, ...this.args(), row.id, answer.provider.slice(0, 40), answer.model.slice(0, 80), judged.brandMentioned ? 1 : 0, judged.siteCited ? 1 : 0, JSON.stringify(judged.competitors), JSON.stringify(sources), JSON.stringify(answer.queries.slice(0, 5).map(item => item.slice(0, 200))), answer.text.replace(/\s+/g, ' ').trim().slice(0, 600), this.scope.subject, via, at());
      operations.completeAi(reservation); if (answer.usage) recordAiUsage(this.db, this.scope, reservation, answer.usage);
      this.audit(via === 'schedule' ? 'ai_visibility.check.scheduled' : 'ai_visibility.check');
    }).immediate();
    return this.read(answer.provider);
  }
}

// Worker step: one due project per tick, its questions asked as the member who turned weekly checks on.
export async function runAiVisibilityChecks(db: Database.Database, generator: GroundedGenerator | undefined, now = Date.now()) {
  if (!generator) return 0;
  const at = new Date(now).toISOString(), row = db.prepare('SELECT * FROM platform_ai_visibility_settings WHERE next_at<=? ORDER BY next_at LIMIT 1').get(at) as { organization_id: string; project_id: string; owner_id: string } | undefined;
  if (!row) return 0;
  const repo = new PlatformRepository(db), scope = { subject: row.owner_id, organizationId: row.organization_id, projectId: row.project_id };
  if (!repo.can(row.owner_id, row.organization_id, row.project_id, 'content.write')) { db.prepare('DELETE FROM platform_ai_visibility_settings WHERE organization_id=? AND project_id=?').run(row.organization_id, row.project_id); return 0; }
  db.prepare('UPDATE platform_ai_visibility_settings SET next_at=?,last_error=NULL,updated_at=? WHERE organization_id=? AND project_id=?').run(new Date(now + LIMITS.weeklyDays * DAY).toISOString(), at, row.organization_id, row.project_id);
  const service = new AiVisibility(db, scope), questions = db.prepare('SELECT id FROM platform_ai_visibility_questions WHERE organization_id=? AND project_id=? ORDER BY created_at,id LIMIT ?').all(row.organization_id, row.project_id, LIMITS.perScheduledRun) as { id: string }[];
  let asked = 0;
  for (const question of questions) {
    try { await service.ask({ id: question.id }, generator, 'schedule'); asked++; }
    catch (error) {
      // Quota used up or provider down: stop this run and say why on the screen; the next run is next week.
      db.prepare('UPDATE platform_ai_visibility_settings SET last_error=? WHERE organization_id=? AND project_id=?').run((error instanceof MarketingStoreError ? error.message : 'Haftalık kontrol tamamlanamadı.').slice(0, 300), row.organization_id, row.project_id);
      break;
    }
  }
  return asked;
}
