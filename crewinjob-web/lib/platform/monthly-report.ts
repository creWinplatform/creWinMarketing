import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { zonedInstant } from './coach';
import { coachMonthKey } from './coach-content';
import { LinkTracking } from './link-tracking';
import { REPORT_LIMITS as LIMITS, type MonthlyReportFacts, type MonthlyReportView, type ReportPost, type SharedReport } from './monthly-report-types';
import { ryzevoFeature } from './ryzevo-features';
import { crewinDraftsIn, crewinPostsIn } from './coach-activity';

type Row = { id: string; month: string; state: 'draft' | 'approved'; note: string; facts_json: string | null; digest: string | null; approved_by: string | null; approved_at: string | null; revision: number };
type Need = 'read' | 'content.write' | 'campaign.approve';
const DAY = 86400000, INTERACTIONS = ['likes', 'comments', 'shares', 'clicks', 'bookmarks', 'quotes'];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const nextMonth = (month: string) => { const [year, value] = month.split('-').map(Number); return new Date(Date.UTC(year, value, 1)).toISOString().slice(0, 7); };

export class MonthlyReports {
  private repo: PlatformRepository;
  constructor(private db: Database.Database, private scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private project() { return this.repo.workspace(this.scope.subject, ...this.args())?.project; }
  private can(need: Need) { return this.repo.can(this.scope.subject, ...this.args(), need); }
  private authorize(need: Need = 'read') {
    if (!this.can('read') || !ryzevoFeature(this.project()?.productPack, 'monthly_report')) throw new MarketingStoreError('Aylık rapor için standart proje erişimi gerekli.', 403);
    if (need !== 'read' && !this.can(need)) throw new MarketingStoreError(need === 'content.write' ? 'Rapor notunu yalnız içerik yazma yetkisi olanlar düzenleyebilir.' : 'Raporu yalnız onay yetkisi olan ekip üyeleri onaylayıp paylaşabilir.', 403);
  }
  private audit(operation: string) { this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), operation, new Date().toISOString()); }
  private timezone() { return this.project()!.timezone; }
  // The current month (in progress) and the eleven before it.
  months() { const zone = this.timezone(); return Array.from({ length: LIMITS.months }, (_, index) => coachMonthKey(new Date(), -index, zone)); }
  private month(value: unknown) {
    if (typeof value !== 'string' || !MONTH.test(value) || !this.months().includes(value)) throw new MarketingStoreError('Son 12 aydan birini seçin.');
    return value;
  }
  private complete(month: string) { return month < this.months()[0]; }
  private row(month: string) { return this.db.prepare('SELECT * FROM platform_monthly_reports WHERE organization_id=? AND project_id=? AND month=?').get(...this.args(), month) as Row | undefined; }
  // Everything below is read from the project's own records for [from, to) in the project's time zone.
  facts(month: string): MonthlyReportFacts {
    const project = this.project()!, zone = project.timezone, from = zonedInstant(`${month}-01`, 0, zone), to = zonedInstant(`${nextMonth(month)}-01`, 0, zone), args = this.args();
    const count = (sql: string, ...values: unknown[]) => (this.db.prepare(sql).get(...args, ...values) as { n: number }).n;
    // Accepted live posts of the month, their public link and what providers and GA4 reported for them.
    // The Crewin workspace publishes with its own tools: its posts come from its post history, without engagement or site figures.
    const crewin = project.productPack === 'crewin';
    const posts = crewin ? crewinPostsIn(from, to).map(post => ({ job_id: '', kind: 'content', id: '', published: new Date(post.at).toISOString(), url: post.url, tag: null, platform: post.platform, counts_json: null, engagement_state: null, title: post.title || null })) : this.db.prepare(`SELECT p.job_id,p.source_kind AS kind,p.source_id AS id,COALESCE(p.submitted_at,p.scheduled_at) AS published,p.provider_url AS url,p.link_tag AS tag,COALESCE(a.platform,'social') AS platform,e.counts_json,e.state AS engagement_state,
      CASE p.source_kind WHEN 'content' THEN (SELECT COALESCE(json_extract(h.payload,'$.headline'),substr(json_extract(h.payload,'$.content'),1,80)) FROM platform_content_history h WHERE h.id=p.source_id AND h.organization_id=p.organization_id AND h.project_id=p.project_id)
        ELSE (SELECT json_extract(c.payload,'$.name') FROM platform_campaigns c WHERE c.id=p.source_id AND c.organization_id=p.organization_id AND c.project_id=p.project_id) END AS title
      FROM platform_social_publications p JOIN platform_jobs j ON j.id=p.job_id AND j.organization_id=p.organization_id AND j.project_id=p.project_id LEFT JOIN platform_social_accounts a ON a.connection_id=j.connection_id
      LEFT JOIN platform_social_engagement e ON e.job_id=p.job_id AND e.organization_id=p.organization_id AND e.project_id=p.project_id
      WHERE p.organization_id=? AND p.project_id=? AND p.mode='publish' AND p.state='accepted' AND COALESCE(p.submitted_at,p.scheduled_at)>=? AND COALESCE(p.submitted_at,p.scheduled_at)<? ORDER BY published,p.job_id LIMIT 500`)
      .all(...args, from, to) as { job_id: string; kind: string; id: string; published: string; url: string | null; tag: string | null; platform: string; counts_json: string | null; engagement_state: string | null; title: string | null }[];
    const links = crewin ? null : new LinkTracking(this.db, this.scope), channels = new Map<string, number>();
    let observed = 0, interactions = 0, sitePosts = 0, sessions = 0, keyEvents = 0;
    const items: ReportPost[] = posts.map(post => {
      channels.set(post.platform, (channels.get(post.platform) || 0) + 1);
      let own: number | null = null;
      if (post.engagement_state === 'ready' && post.counts_json) { const counts = JSON.parse(post.counts_json) as Record<string, number>; own = INTERACTIONS.reduce((sum, key) => sum + (Number.isSafeInteger(counts[key]) && counts[key] >= 0 ? counts[key] : 0), 0); observed++; interactions += own; }
      const site = links?.result(post.tag, post.platform, post.published), measured = site && (site.status === 'ready' || site.status === 'partial' || site.status === 'none');
      if (site && measured) { sitePosts++; sessions += site.sessions || 0; keyEvents += site.keyEvents || 0; }
      return { title: post.title || post.platform, channel: post.platform, publishedAt: post.published, url: post.url, sessions: measured ? site!.sessions ?? 0 : null, keyEvents: measured ? site!.keyEvents ?? 0 : null, interactions: own };
    });
    const top = [...items].sort((a, b) => (b.sessions ?? -1) - (a.sessions ?? -1) || (b.interactions ?? -1) - (a.interactions ?? -1) || a.publishedAt.localeCompare(b.publishedAt)).slice(0, LIMITS.topPosts);
    const tracking: Partial<ReturnType<LinkTracking['view']>> = links ? links.view() : {};
    const site = tracking.connectionId && tracking.resultState && tracking.from && tracking.to && tracking.checkedAt && sitePosts ? { state: tracking.resultState, from: tracking.from, to: tracking.to, checkedAt: tracking.checkedAt, posts: sitePosts, sessions, keyEvents } : null;
    // Inbox counts only: no text, author or recipient.
    const inbox = this.db.prepare("SELECT COUNT(*) received,SUM(kind='comment') comments,SUM(kind='message') messages,SUM(state='replied') replied,SUM(kind='message' AND state='replied' AND replied_at IS NOT NULL AND julianday(replied_at)-julianday(received_at)<1) in_window,SUM(state='new') open,SUM(state='dismissed') dismissed FROM platform_social_inbox WHERE organization_id=? AND project_id=? AND received_at>=? AND received_at<?").get(...args, from, to) as Record<string, number | null>;
    const inboxAccounts = count('SELECT COUNT(*) n FROM platform_social_inbox_accounts WHERE organization_id=? AND project_id=?');
    const pilots = this.db.prepare("SELECT (SELECT json_group_array(r.state) FROM platform_email_pilot_recipients r WHERE r.job_id=p.job_id) states FROM platform_email_pilots p JOIN platform_jobs j ON j.id=p.job_id AND j.organization_id=p.organization_id AND j.project_id=p.project_id WHERE p.organization_id=? AND p.project_id=? AND p.mode='send' AND j.created_at>=? AND j.created_at<?").all(...args, from, to) as { states: string | null }[];
    const email = { sends: pilots.length, accepted: 0, delivered: 0, bounced: 0, complained: 0 };
    for (const pilot of pilots) for (const state of JSON.parse(pilot.states || '[]') as string[]) if (state in email && state !== 'sends') email[state as 'accepted']++;
    // Ad plans that ran into this month; spend is what the provider last reported for the whole plan.
    const monthEnd = new Date(Date.parse(`${nextMonth(month)}-01T00:00:00Z`) - DAY).toISOString().slice(0, 10);
    const ads = (this.db.prepare("SELECT name,provider,currency,spend_minor,impressions,clicks,spend_checked_at FROM platform_ad_plans WHERE organization_id=? AND project_id=? AND provider_campaign_id IS NOT NULL AND start_date<=? AND end_date>=? ORDER BY start_date,name LIMIT 20").all(...args, monthEnd, `${month}-01`) as { name: string; provider: string; currency: string; spend_minor: number | null; impressions: number | null; clicks: number | null; spend_checked_at: string | null }[])
      .map(item => ({ name: item.name, provider: item.provider, currency: item.currency, spendMinor: item.spend_minor, impressions: item.impressions, clicks: item.clicks, checkedAt: item.spend_checked_at }));
    const entries = this.db.prepare('SELECT goal_id,stage_index,value,observed_at,source FROM platform_metric_entries WHERE organization_id=? AND project_id=? AND observed_at>=? AND observed_at<? ORDER BY observed_at,id').all(...args, from, to) as { goal_id: string; stage_index: number; value: number; observed_at: string; source: string }[];
    const measurements = project.goals.flatMap(goal => goal.stages.flatMap((stage, index) => [...new Set(entries.filter(item => item.goal_id === goal.id && item.stage_index === index).map(item => item.source))].map(source => {
      const list = entries.filter(item => item.goal_id === goal.id && item.stage_index === index && item.source === source);
      return { goal: goal.label, stage, source, first: list[0].value, firstAt: list[0].observed_at, last: list.at(-1)!.value, lastAt: list.at(-1)!.observed_at, entries: list.length };
    })));
    const drafts = crewin ? crewinDraftsIn(from, to) : count("SELECT COUNT(*) n FROM platform_content_history WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.timestamp')>=? AND json_extract(payload,'$.timestamp')<? AND json_extract(payload,'$.starter') IS NULL", Date.parse(from), Date.parse(to));
    return {
      version: 1, month, from, to, timezone: zone, language: project.language === 'en' ? 'en' : 'tr', project: { name: project.name, website: project.website },
      publications: { total: items.length, byChannel: [...channels].map(([channel, value]) => ({ channel, count: value })).sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel)), top },
      site, engagement: observed ? { observed, interactions } : null,
      inbox: inbox.received || inboxAccounts ? { received: inbox.received || 0, comments: inbox.comments || 0, messages: inbox.messages || 0, replied: inbox.replied || 0, messagesInWindow: inbox.in_window || 0, open: inbox.open || 0, dismissed: inbox.dismissed || 0 } : null,
      email: email.sends ? email : null, ads, measurements,
      work: { drafts, coachActionsDone: count("SELECT COUNT(*) n FROM platform_growth_coach_actions WHERE organization_id=? AND project_id=? AND state='done' AND updated_at>=? AND updated_at<?", from, to),
        contentPlanApproved: count('SELECT COUNT(*) n FROM platform_coach_content_items WHERE organization_id=? AND project_id=? AND approved_at>=? AND approved_at<?', from, to),
        tasksCompleted: count("SELECT COUNT(*) n FROM platform_work_items WHERE organization_id=? AND project_id=? AND status='completed' AND due_at>=? AND due_at<?", from, to) },
    };
  }
  read(raw?: unknown): MonthlyReportView {
    this.authorize(); const months = this.months(), month = raw === undefined ? months[1] : this.month(raw), row = this.row(month);
    const approved = row?.state === 'approved' && row.facts_json && row.digest, facts = approved ? JSON.parse(row.facts_json!) as MonthlyReportFacts : this.facts(month);
    const shares = approved && this.can('campaign.approve') ? (this.db.prepare('SELECT id,created_at,expires_at,revoked_at,views,last_viewed_at FROM platform_report_shares WHERE report_id=? ORDER BY created_at DESC LIMIT 20').all(row!.id) as { id: string; created_at: string; expires_at: string; revoked_at: string | null; views: number; last_viewed_at: string | null }[])
      .map(item => ({ id: item.id, createdAt: item.created_at, expiresAt: item.expires_at, revokedAt: item.revoked_at, views: item.views, lastViewedAt: item.last_viewed_at })) : [];
    const approver = row?.approved_by ? (this.db.prepare('SELECT username FROM platform_users WHERE id=?').get(row.approved_by) as { username: string } | undefined)?.username || null : null;
    return { month, months, state: approved ? 'approved' : 'draft', facts, digest: approved ? row!.digest! : hash(JSON.stringify(facts)), note: row?.note || '', approvedAt: approved ? row!.approved_at : null, approvedBy: approved ? approver : null, revision: row?.revision || 0,
      canEdit: this.can('content.write') && !approved, canApprove: this.can('campaign.approve') && this.complete(month), shares };
  }
  private keys(raw: Record<string, unknown>, allowed: string[]) { if (Object.keys(raw).some(key => !['action', ...allowed].includes(key))) throw new MarketingStoreError('Geçersiz rapor isteği.'); }
  private expected(raw: Record<string, unknown>, row: Row | undefined) { if (!Number.isSafeInteger(raw.expectedRevision) || (row?.revision || 0) !== raw.expectedRevision) throw new MarketingStoreError('Rapor değişti; yenileyip tekrar deneyin.', 409); }
  saveNote(raw: Record<string, unknown>) {
    this.authorize('content.write'); this.keys(raw, ['month', 'note', 'expectedRevision']); const month = this.month(raw.month);
    if (typeof raw.note !== 'string' || raw.note.length > LIMITS.note || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw.note)) throw new MarketingStoreError(`Not en fazla ${LIMITS.note} karakter olabilir.`);
    const note = raw.note.trim();
    this.db.transaction(() => {
      this.authorize('content.write'); const row = this.row(month); this.expected(raw, row);
      if (row?.state === 'approved') throw new MarketingStoreError('Onaylı rapor değiştirilemez. Değiştirmek için önce onayı geri alın.', 409);
      const now = new Date().toISOString();
      if (row) this.db.prepare('UPDATE platform_monthly_reports SET note=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=?').run(note, this.scope.subject, now, row.id);
      else this.db.prepare("INSERT INTO platform_monthly_reports(id,organization_id,project_id,month,state,note,revision,updated_by,updated_at) VALUES(?,?,?,?,'draft',?,1,?,?)").run(`report_${randomUUID()}`, ...this.args(), month, note, this.scope.subject, now);
      this.audit('report.note');
    }).immediate();
    return this.read(month);
  }
  // Freezes exactly what the approver saw: the live facts must still hash to the digest on their screen.
  approve(raw: Record<string, unknown>) {
    this.authorize('campaign.approve'); this.keys(raw, ['month', 'expectedDigest', 'expectedRevision', 'acknowledged']); const month = this.month(raw.month);
    if (!this.complete(month)) throw new MarketingStoreError('Yalnız tamamlanmış bir ayın raporu onaylanabilir.', 409);
    if (raw.acknowledged !== true) throw new MarketingStoreError('Onaylamak için raporu gözden geçirdiğinizi işaretleyin.');
    this.db.transaction(() => {
      this.authorize('campaign.approve'); const row = this.row(month); this.expected(raw, row);
      if (row?.state === 'approved') throw new MarketingStoreError('Bu rapor zaten onaylı.', 409);
      const facts = this.facts(month), json = JSON.stringify(facts), digest = hash(json);
      if (raw.expectedDigest !== digest) throw new MarketingStoreError('Rapordaki sayılar siz incelerken değişti. Yenileyip tekrar inceleyin.', 409);
      const now = new Date().toISOString();
      if (row) this.db.prepare("UPDATE platform_monthly_reports SET state='approved',facts_json=?,digest=?,approved_by=?,approved_at=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=?").run(json, digest, this.scope.subject, now, this.scope.subject, now, row.id);
      else this.db.prepare("INSERT INTO platform_monthly_reports(id,organization_id,project_id,month,state,note,facts_json,digest,approved_by,approved_at,revision,updated_by,updated_at) VALUES(?,?,?,?,'approved','',?,?,?,?,1,?,?)").run(`report_${randomUUID()}`, ...this.args(), month, json, digest, this.scope.subject, now, this.scope.subject, now);
      this.audit('report.approve');
    }).immediate();
    return this.read(month);
  }
  // Back to draft: every link stops working at once and the frozen numbers are dropped.
  reopen(raw: Record<string, unknown>) {
    this.authorize('campaign.approve'); this.keys(raw, ['month', 'expectedRevision']); const month = this.month(raw.month);
    this.db.transaction(() => {
      this.authorize('campaign.approve'); const row = this.row(month); this.expected(raw, row);
      if (row?.state !== 'approved') throw new MarketingStoreError('Rapor onaylı değil.', 409);
      const now = new Date().toISOString();
      this.db.prepare('UPDATE platform_report_shares SET revoked_at=? WHERE report_id=? AND revoked_at IS NULL').run(now, row.id);
      this.db.prepare("UPDATE platform_monthly_reports SET state='draft',facts_json=NULL,digest=NULL,approved_by=NULL,approved_at=NULL,revision=revision+1,updated_by=?,updated_at=? WHERE id=?").run(this.scope.subject, now, row.id);
      this.audit('report.reopen');
    }).immediate();
    return this.read(month);
  }
  // A read-only link to the approved snapshot. The token is shown once and only its hash is stored.
  share(raw: Record<string, unknown>) {
    this.authorize('campaign.approve'); this.keys(raw, ['month', 'days']); const month = this.month(raw.month);
    if (!(LIMITS.shareDays as readonly unknown[]).includes(raw.days)) throw new MarketingStoreError('Bağlantı süresi 7, 30 veya 90 gün olabilir.');
    const token = randomBytes(32).toString('base64url');
    const id = this.db.transaction(() => {
      this.authorize('campaign.approve'); const row = this.row(month), now = new Date().toISOString();
      if (row?.state !== 'approved') throw new MarketingStoreError('Önce raporu onaylayın.', 409);
      if ((this.db.prepare('SELECT COUNT(*) n FROM platform_report_shares WHERE report_id=? AND revoked_at IS NULL AND expires_at>?').get(row.id, now) as { n: number }).n >= LIMITS.sharesPerReport) throw new MarketingStoreError(`Bir rapor için en fazla ${LIMITS.sharesPerReport} etkin bağlantı olabilir. Önce birini kapatın.`, 429);
      const share = `share_${randomUUID()}`;
      this.db.prepare('INSERT INTO platform_report_shares(id,report_id,organization_id,project_id,token_hash,report_revision,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run(share, row.id, ...this.args(), hash(token), row.revision, this.scope.subject, now, new Date(Date.now() + (raw.days as number) * DAY).toISOString());
      this.audit('report.share'); return share;
    }).immediate();
    return { token, shareId: id, report: this.read(month) };
  }
  revoke(raw: Record<string, unknown>) {
    this.authorize('campaign.approve'); this.keys(raw, ['month', 'shareId']); const month = this.month(raw.month);
    this.db.transaction(() => {
      this.authorize('campaign.approve'); const row = this.row(month);
      const changed = row && typeof raw.shareId === 'string' ? this.db.prepare('UPDATE platform_report_shares SET revoked_at=? WHERE id=? AND report_id=? AND revoked_at IS NULL').run(new Date().toISOString(), raw.shareId, row.id).changes : 0;
      if (!changed) throw new MarketingStoreError('Bağlantı bulunamadı veya zaten kapalı.', 404);
      this.audit('report.share.revoke');
    }).immediate();
    return this.read(month);
  }
}

// What an unauthenticated link opens: only a live (unexpired, unrevoked) link to a still-approved report of a standard (or Crewin)
// project, at the revision it was made for. Every miss looks the same.
export function openSharedReport(db: Database.Database, token: unknown): SharedReport | null {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return db.transaction(() => {
    const now = new Date().toISOString();
    const row = db.prepare("SELECT s.id,s.expires_at,r.note,r.facts_json,r.approved_at FROM platform_report_shares s JOIN platform_monthly_reports r ON r.id=s.report_id AND r.organization_id=s.organization_id AND r.project_id=s.project_id JOIN platform_projects p ON p.id=r.project_id AND p.organization_id=r.organization_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND r.state='approved' AND r.revision=s.report_revision AND p.product_pack IN ('standard','crewin')").get(hash(token), now) as { id: string; expires_at: string; note: string; facts_json: string; approved_at: string } | undefined;
    if (!row) return null;
    db.prepare('UPDATE platform_report_shares SET views=views+1,last_viewed_at=? WHERE id=?').run(now, row.id);
    return { facts: JSON.parse(row.facts_json) as MonthlyReportFacts, note: row.note, approvedAt: row.approved_at, expiresAt: row.expires_at };
  }).immediate();
}
