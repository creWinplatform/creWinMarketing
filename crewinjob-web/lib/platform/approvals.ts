import 'server-only';
import type Database from 'better-sqlite3';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { hasMessagingDuty } from './messaging-duties';
import { coachWeekKey, zonedDateKey, zonedInstant } from './coach';
import { coachMonthKey } from './coach-content';
import { INBOX_LIMITS } from './social-inbox-types';
import type { ApprovalItem, ApprovalsView } from './approvals-types';

type Scope = { subject: string; organizationId: string; projectId: string };
const HOUR = 3600000;
const args = (scope: Scope) => [scope.organizationId, scope.projectId] as const;

// Everything that waits for a person's decision, each only for members who may make it. Read-only: every row links to
// the screen where the decision is made, with that screen's own preview, checks and acknowledgement.
export function approvalQueue(db: Database.Database, scope: Scope, now = Date.now()): ApprovalItem[] {
  const repo = new PlatformRepository(db), can = (permission: Parameters<PlatformRepository['can']>[3]) => repo.can(scope.subject, ...args(scope), permission);
  const project = can('read') ? repo.workspace(scope.subject, ...args(scope))?.project : undefined;
  if (!project || project.productPack !== 'standard') return [];
  const items: ApprovalItem[] = [], zone = project.timezone, at = new Date(now);
  const add = (kind: ApprovalItem['kind'], count: number, oldest: string | null, href: string) => { if (count > 0) items.push({ kind, count, oldest, href }); };
  const one = <T,>(sql: string, ...values: unknown[]) => db.prepare(sql).get(...args(scope), ...values) as T;
  if (can('campaign.approve')) {
    const brief = one<{ draft_at: string | null } | undefined>('SELECT draft_at FROM platform_growth_coach WHERE organization_id=? AND project_id=? AND draft_json IS NOT NULL');
    if (brief) add('coach_brief', 1, brief.draft_at, '/?tab=dashboard');
    const review = one<{ adjustments_json: string; updated_at: string } | undefined>('SELECT adjustments_json,updated_at FROM platform_coach_reviews WHERE organization_id=? AND project_id=? AND week=?', coachWeekKey(at, zone));
    if (review) add('coach_review', (JSON.parse(review.adjustments_json) as { state?: string }[]).filter(item => item.state === 'proposed').length, review.updated_at, '/?tab=dashboard');
    const renewal = one<{ created_at: string } | undefined>("SELECT created_at FROM platform_coach_refreshes WHERE organization_id=? AND project_id=? AND month=? AND state='proposed'", coachMonthKey(at, 0, zone));
    if (renewal) add('coach_renewal', 1, renewal.created_at, '/?tab=dashboard');
    const ads = one<{ n: number; oldest: string | null }>("SELECT COUNT(*) n,MIN(updated_at) oldest FROM platform_ad_plans WHERE organization_id=? AND project_id=? AND state='draft'");
    add('ad_plan', ads.n, ads.oldest, '/?tab=campaigns&campaignView=ads');
    const batches = one<{ n: number; oldest: string | null }>("SELECT COUNT(*) n,MIN(updated_at) oldest FROM platform_whatsapp_batches WHERE organization_id=? AND project_id=? AND state='draft'");
    add('whatsapp_approve', batches.n, batches.oldest, '/?tab=campaigns&campaignView=whatsapp');
    // Last month's report, during the first ten days of the new month, when that month has anything to report.
    if (Number(zonedDateKey(at, zone).slice(8, 10)) <= 10) {
      const month = coachMonthKey(at, -1, zone), from = zonedInstant(`${month}-01`, 0, zone), to = zonedInstant(`${coachMonthKey(at, 0, zone)}-01`, 0, zone);
      const approved = one<{ n: number }>("SELECT COUNT(*) n FROM platform_monthly_reports WHERE organization_id=? AND project_id=? AND month=? AND state='approved'", month).n;
      const window = [...args(scope), from, to];
      const activity = (db.prepare("SELECT (SELECT COUNT(*) FROM platform_social_publications WHERE organization_id=? AND project_id=? AND mode='publish' AND state='accepted' AND COALESCE(submitted_at,scheduled_at)>=? AND COALESCE(submitted_at,scheduled_at)<?)+(SELECT COUNT(*) FROM platform_metric_entries WHERE organization_id=? AND project_id=? AND observed_at>=? AND observed_at<?)+(SELECT COUNT(*) FROM platform_social_inbox WHERE organization_id=? AND project_id=? AND received_at>=? AND received_at<?) n").get(...window, ...window, ...window) as { n: number }).n;
      if (!approved && activity) add('monthly_report', 1, to, '/?tab=analytics');
    }
  }
  // The content plan screen acts only on an approved brief, so its suggestions count only then.
  if (can('content.write')) {
    const plan = one<{ n: number; oldest: string | null }>("SELECT COUNT(*) n,MIN(created_at) oldest FROM platform_coach_content_items WHERE organization_id=? AND project_id=? AND state='suggested' AND month>=? AND EXISTS(SELECT 1 FROM platform_growth_coach g WHERE g.organization_id=platform_coach_content_items.organization_id AND g.project_id=platform_coach_content_items.project_id AND g.brief_json IS NOT NULL)", coachMonthKey(at, 0, zone));
    add('content_plan', plan.n, plan.oldest, '/?tab=calendar&planning=content');
  }
  // Saved inbox replies are sent by someone with the publish duty; a message reply only while its 24-hour window is open.
  if (hasMessagingDuty(db, scope.subject, ...args(scope), 'publish')) {
    const replies = one<{ n: number; oldest: string | null }>("SELECT COUNT(*) n,MIN(received_at) oldest FROM platform_social_inbox WHERE organization_id=? AND project_id=? AND state='new' AND reply_state='draft' AND reply_text<>'' AND (kind='comment' OR received_at>?)", new Date(now - INBOX_LIMITS.messageWindowHours * HOUR).toISOString());
    add('inbox_reply', replies.n, replies.oldest, '/?tab=campaigns&campaignView=inbox');
    const approvedBatches = one<{ n: number; oldest: string | null }>("SELECT COUNT(*) n,MIN(approved_at) oldest FROM platform_whatsapp_batches WHERE organization_id=? AND project_id=? AND state='approved'");
    add('whatsapp_send', approvedBatches.n, approvedBatches.oldest, '/?tab=campaigns&campaignView=whatsapp');
  }
  // Automation enrollments that are due wait for a pilot approval by someone who may also manage senders and recipients.
  if (can('campaign.approve') && can('connections.manage') && can('recipients.manage')) {
    const ready = one<{ n: number; oldest: string | null }>("SELECT COUNT(*) n,MIN(e.due_at) oldest FROM platform_automation_enrollments e JOIN platform_automations a ON a.id=e.automation_id AND a.organization_id=e.organization_id AND a.project_id=e.project_id WHERE e.organization_id=? AND e.project_id=? AND e.state='ready' AND a.state='active'");
    add('automation', ready.n, ready.oldest, '/?tab=campaigns&campaignView=automations');
  }
  return items.sort((a, b) => (a.oldest || '').localeCompare(b.oldest || ''));
}

export class ProjectApprovals {
  private repo: PlatformRepository;
  constructor(private db: Database.Database, private scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  read(): ApprovalsView {
    const project = this.repo.can(this.scope.subject, this.scope.organizationId, this.scope.projectId, 'read') ? this.repo.workspace(this.scope.subject, this.scope.organizationId, this.scope.projectId)?.project : undefined;
    if (!project || project.productPack !== 'standard') throw new MarketingStoreError('Onay listesi için standart proje erişimi gerekli.', 403);
    return { items: approvalQueue(this.db, this.scope), timezone: project.timezone };
  }
}
