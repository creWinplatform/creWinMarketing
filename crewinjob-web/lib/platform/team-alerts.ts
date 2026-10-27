import 'server-only';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { hasMessagingDuty } from './messaging-duties';
import { identityEmailConfiguration } from './identity-email';
import { deliverCoachDigest, type DigestDelivery, type DigestMail } from './coach-digest';
import { INBOX_LIMITS } from './social-inbox-types';
import { receivedInvites } from './member-invites';
import { webPushConfiguration } from './web-push-config';
import { TEAM_ALERT_LIMITS as LIMITS, type TeamAlert, type TeamAlertsView } from './team-alerts-types';

type Lang = 'tr' | 'en';
type Scope = { subject: string; organizationId: string; projectId: string };
const HOUR = 3600000, DAY = 24 * HOUR;
const args = (scope: Scope) => [scope.organizationId, scope.projectId] as const;
// Email is off unless the switch is on and the platform's account email (SES) is configured.
export function alertEmailConfiguration() { return process.env.PLATFORM_ALERT_EMAIL_ENABLED === '1' ? identityEmailConfiguration() : null; }

// Alerts the member may act on, each only with the right that acting needs. Read-only; nothing is changed here.
export function teamAlerts(db: Database.Database, scope: Scope, now = Date.now()): TeamAlert[] {
  const repo = new PlatformRepository(db), can = (permission: Parameters<PlatformRepository['can']>[3]) => repo.can(scope.subject, ...args(scope), permission);
  const project = can('read') ? repo.workspace(scope.subject, ...args(scope))?.project : undefined;
  if (!project || project.productPack !== 'standard') return [];
  const alerts: TeamAlert[] = [], iso = (value: number) => new Date(value).toISOString();
  // Messages whose reply window closes within the warning time and that have no reply on its way.
  if (hasMessagingDuty(db, scope.subject, ...args(scope), 'source.read')) {
    const window = INBOX_LIMITS.messageWindowHours * HOUR;
    const rows = db.prepare("SELECT id,received_at FROM platform_social_inbox WHERE organization_id=? AND project_id=? AND kind='message' AND state='new' AND (reply_state IS NULL OR reply_state IN ('draft','rejected')) AND received_at>? AND received_at<=? ORDER BY received_at,id LIMIT 200")
      .all(...args(scope), iso(now - window), iso(now - window + LIMITS.inboxWarningHours * HOUR)) as { id: string; received_at: string }[];
    if (rows.length) alerts.push({ kind: 'inbox_window', severity: 'urgent', count: rows.length, at: iso(Date.parse(rows[0].received_at) + window), href: '/?tab=campaigns&campaignView=inbox', keys: rows.map(row => `inbox:${row.id}`) });
  }
  // Live posts the provider rejected, that were stopped, or whose outcome is unknown, in the last week.
  if (can('campaign.dispatch')) {
    const rows = db.prepare("SELECT p.job_id,p.state,j.updated_at FROM platform_social_publications p JOIN platform_jobs j ON j.id=p.job_id AND j.organization_id=p.organization_id AND j.project_id=p.project_id WHERE p.organization_id=? AND p.project_id=? AND p.mode='publish' AND p.state IN ('rejected','uncertain','blocked') AND j.updated_at>=? ORDER BY j.updated_at DESC LIMIT 100")
      .all(...args(scope), iso(now - LIMITS.eventDays * DAY)) as { job_id: string; state: string; updated_at: string }[];
    if (rows.length) alerts.push({ kind: 'publication_failed', severity: rows.some(row => row.state === 'uncertain') ? 'urgent' : 'warning', count: rows.length, at: rows[0].updated_at, href: '/?tab=calendar&planning=social', keys: rows.map(row => `publication:${row.job_id}:${row.state}`) });
  }
  // Social account grants that end within a week or have ended.
  if (can('connections.manage')) {
    const rows = db.prepare("SELECT c.id,s.expires_at FROM platform_connections c JOIN platform_social_accounts s ON s.connection_id=c.id WHERE c.organization_id=? AND c.project_id=? AND c.active=1 AND c.provider='social' AND s.expires_at IS NOT NULL AND s.expires_at<? ORDER BY s.expires_at,c.id LIMIT 50")
      .all(...args(scope), now + LIMITS.accessDays * DAY) as { id: string; expires_at: number }[];
    if (rows.length) alerts.push({ kind: 'connection_expiring', severity: rows.some(row => row.expires_at <= now) ? 'urgent' : 'warning', count: rows.length, at: iso(rows[0].expires_at), href: '/?tab=project&settings=connections', keys: rows.map(row => `connection:${row.id}:${row.expires_at}`) });
  }
  // The paid period (or its grace) or the trial is about to end, and no later period is paid.
  if (can('billing.manage')) {
    const at = iso(now);
    let period: { ends_at: string; grace_ends_at: string } | undefined;
    try { period = db.prepare('SELECT ends_at,grace_ends_at FROM platform_project_subscriptions WHERE organization_id=? AND project_id=? AND starts_at<=? AND grace_ends_at>? ORDER BY ends_at DESC LIMIT 1').get(...args(scope), at, at) as typeof period; } catch { period = undefined; }
    const later = period && db.prepare('SELECT 1 FROM platform_project_subscriptions WHERE organization_id=? AND project_id=? AND starts_at>=?').get(...args(scope), period.ends_at);
    if (period && !later) {
      if (period.ends_at <= at) alerts.push({ kind: 'billing_period', phase: 'grace', severity: 'urgent', count: 1, at: period.grace_ends_at, href: '/?tab=project&settings=plan', keys: [`billing:grace:${period.grace_ends_at}`] });
      else if (Date.parse(period.ends_at) - now <= LIMITS.paidDays * DAY) alerts.push({ kind: 'billing_period', phase: 'paid_ending', severity: 'warning', count: 1, at: period.ends_at, href: '/?tab=project&settings=plan', keys: [`billing:paid:${period.ends_at}`] });
    } else if (!period) {
      const trial = db.prepare("SELECT ends_at FROM platform_project_entitlements WHERE organization_id=? AND project_id=? AND mode='trial'").get(...args(scope)) as { ends_at: string | null } | undefined;
      if (trial?.ends_at && trial.ends_at > at && Date.parse(trial.ends_at) - now <= LIMITS.trialDays * DAY) alerts.push({ kind: 'billing_period', phase: 'trial_ending', severity: 'warning', count: 1, at: trial.ends_at, href: '/?tab=project&settings=plan', keys: [`billing:trial:${trial.ends_at}`] });
    }
  }
  // Ad plans with a provider error in the last week (start refused, pause unconfirmed, create half done).
  if (can('connections.manage') && can('campaign.approve')) {
    const rows = db.prepare("SELECT id,revision,updated_at FROM platform_ad_plans WHERE organization_id=? AND project_id=? AND last_error IS NOT NULL AND last_error<>'' AND state IN ('created','paused','failed','active') AND updated_at>=? ORDER BY updated_at DESC LIMIT 50")
      .all(...args(scope), iso(now - LIMITS.eventDays * DAY)) as { id: string; revision: number; updated_at: string }[];
    if (rows.length) alerts.push({ kind: 'ad_error', severity: 'warning', count: rows.length, at: rows[0].updated_at, href: '/?tab=campaigns&campaignView=ads', keys: rows.map(row => `ad:${row.id}:${row.revision}`) });
  }
  // Invitations to other projects belong to the person, not this project; they are accepted in the portfolio.
  const invites = receivedInvites(db, scope.subject);
  if (invites.length) alerts.push({ kind: 'invite_pending', severity: 'warning', count: invites.length, at: [...invites].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0].expiresAt, href: '/portfolio', keys: invites.map(item => `invite:${item.id}`) });
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'urgent' ? -1 : 1));
}

// Plain text with counts and links only: no message text, contact, account or plan name.
export function alertMessage(alerts: TeamAlert[], lang: Lang, project: { name: string; timezone: string }, origin: string): Pick<DigestMail, 'subject' | 'text'> {
  const tr = lang === 'tr', locale = tr ? 'tr-TR' : 'en-GB', n = (value: number) => value.toLocaleString(locale);
  const time = (value: string | null) => value ? new Date(value).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: project.timezone }) : '';
  const line = (alert: TeamAlert) => {
    switch (alert.kind) {
      case 'inbox_window': return tr ? `${n(alert.count)} mesajın 24 saatlik cevap penceresi kapanmak üzere (${alert.count > 1 ? 'ilk kapanış' : 'kapanış'}: ${time(alert.at)}). Pencere kapanınca bu kanaldan cevap gönderilemez.` : `The 24-hour reply window of ${n(alert.count)} message(s) is about to close (${alert.count > 1 ? 'first closes' : 'closes'} ${time(alert.at)}). After it closes, no reply can be sent on that channel.`;
      case 'publication_failed': return tr ? `${n(alert.count)} gerçek yayın reddedildi, durduruldu veya sonucu belirsiz. Tekrar yayınlamadan önce sosyal hesabı kontrol edin.` : `${n(alert.count)} live post(s) were rejected, stopped or have an unknown outcome. Check the social account before publishing again.`;
      case 'connection_expiring': return tr ? `${n(alert.count)} sosyal hesap bağlantısının izni bitti veya 7 gün içinde bitiyor (${alert.count > 1 ? 'ilk bitiş' : 'bitiş'}: ${time(alert.at)}). Planlı yayınların gitmesi için yeniden bağlanın.` : `${n(alert.count)} social account grant(s) ended or end within 7 days (${alert.count > 1 ? 'first ends' : 'ends'} ${time(alert.at)}). Reconnect so scheduled posts can go out.`;
      case 'billing_period': return alert.phase === 'grace' ? (tr ? `Ücretli dönem bitti; ek süre ${time(alert.at)} tarihinde sona eriyor. Sonra yeni üretim durur, kayıtlar korunur.` : `The paid period has ended; the grace period ends at ${time(alert.at)}. After that, new work stops and records are kept.`)
        : alert.phase === 'trial_ending' ? (tr ? `Deneme süresi ${time(alert.at)} tarihinde bitiyor.` : `The trial ends at ${time(alert.at)}.`)
        : (tr ? `Ücretli dönem ${time(alert.at)} tarihinde bitiyor. Yenileme otomatik değildir.` : `The paid period ends at ${time(alert.at)}. Renewal is not automatic.`);
      case 'ad_error': return tr ? `${n(alert.count)} reklam planında sağlayıcı hatası var. Harcamanın durumunu reklam hesabından kontrol edin.` : `${n(alert.count)} ad plan(s) have a provider error. Check the spend status in the ad account.`;
      case 'invite_pending': return tr ? `${n(alert.count)} proje daveti kabulünüzü bekliyor (ilk bitiş: ${time(alert.at)}).` : `${n(alert.count)} project invitation(s) are waiting for you (first expires ${time(alert.at)}).`;
    }
  };
  const lines = [tr ? `${project.name} · dikkat gerekenler` : `${project.name} · needs attention`, ''];
  for (const alert of alerts) lines.push(`- ${line(alert)}`, `  ${origin}${alert.href}`);
  lines.push('', tr ? 'Bu e-postayı, Ryzevo genel bakışındaki “Dikkat gerekenler” uyarılarına abone olduğunuz için aldınız. Aboneliği aynı karttan kapatabilirsiniz. Müşterilere hiçbir şey gönderilmedi.' : 'You receive this email because you subscribed to “Needs attention” alerts on the Ryzevo overview. You can turn them off from the same card. Nothing was sent to customers.');
  const total = alerts.reduce((sum, alert) => sum + alert.count, 0);
  return { subject: tr ? `Ryzevo · ${project.name} · dikkat gereken ${n(total)} konu` : `Ryzevo · ${project.name} · ${n(total)} item(s) need attention`, text: lines.join('\n').slice(0, 20000) };
}

export class TeamAlerts {
  private repo: PlatformRepository;
  constructor(private db: Database.Database, private scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  private authorize() {
    if (!this.repo.can(this.scope.subject, ...args(this.scope), 'read') || this.repo.workspace(this.scope.subject, ...args(this.scope))?.project.productPack !== 'standard') throw new MarketingStoreError('Uyarılar için standart proje erişimi gerekli.', 403);
  }
  private email() { return (this.db.prepare('SELECT email FROM platform_account_emails WHERE user_id=?').get(this.scope.subject) as { email: string } | undefined)?.email || null; }
  private subscription() { return this.db.prepare('SELECT language FROM platform_alert_subscriptions WHERE user_id=? AND organization_id=? AND project_id=?').get(this.scope.subject, ...args(this.scope)) as { language: Lang } | undefined; }
  private audit(operation: string) { this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...args(this.scope), operation, new Date().toISOString()); }
  read(): TeamAlertsView {
    this.authorize(); const subscription = this.subscription();
    return { alerts: teamAlerts(this.db, this.scope), timezone: this.repo.workspace(this.scope.subject, ...args(this.scope))!.project.timezone,
      email: { enabled: Boolean(alertEmailConfiguration()), subscribed: Boolean(subscription), language: subscription?.language || null, hasVerifiedEmail: Boolean(this.email()) }, push: { enabled: Boolean(webPushConfiguration()) } };
  }
  // Opting in marks what is already open as seen, so the first email is about something new.
  subscribe(raw: Record<string, unknown>) {
    this.authorize(); const language = raw.language === 'en' ? 'en' : raw.language === 'tr' ? 'tr' : null;
    if (!language || Object.keys(raw).some(key => !['action', 'language'].includes(key))) throw new MarketingStoreError('Geçersiz uyarı ayarı.');
    if (!this.email()) throw new MarketingStoreError('Uyarıları e-postayla almak için önce hesap e-postanızı doğrulayın.', 409);
    this.db.transaction(() => {
      this.authorize(); const now = new Date().toISOString(), fresh = !this.subscription();
      this.db.prepare('INSERT INTO platform_alert_subscriptions(user_id,organization_id,project_id,language,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,organization_id,project_id) DO UPDATE SET language=excluded.language').run(this.scope.subject, ...args(this.scope), language, now);
      if (fresh) { const seen = this.db.prepare('INSERT OR IGNORE INTO platform_alert_notices(user_id,organization_id,project_id,alert_key,notified_at) VALUES(?,?,?,?,?)'); for (const key of teamAlerts(this.db, this.scope).flatMap(item => item.keys)) seen.run(this.scope.subject, ...args(this.scope), key, now); }
      this.audit('alerts.subscribe');
    }).immediate();
    return this.read();
  }
  unsubscribe() {
    this.authorize();
    this.db.transaction(() => { this.db.prepare('DELETE FROM platform_alert_subscriptions WHERE user_id=? AND organization_id=? AND project_id=?').run(this.scope.subject, ...args(this.scope)); this.audit('alerts.unsubscribe'); }).immediate();
    return this.read();
  }
}

// Worker step: looks at one subscriber per tick (least recently checked first). An email goes only for records the
// member has not been told about, at most once every three hours and six times a day. It is marked submitted before the
// provider call and never retried; the records it covered are not mailed again.
export async function deliverNextAlertEmail(db: Database.Database, deliver: DigestDelivery = deliverCoachDigest, configuration = alertEmailConfiguration(), now = Date.now()) {
  if (!configuration) return false;
  const claimed = db.transaction(() => {
    const at = new Date(now).toISOString();
    const row = db.prepare('SELECT user_id,organization_id,project_id,language FROM platform_alert_subscriptions WHERE checked_at IS NULL OR checked_at<=? ORDER BY checked_at IS NOT NULL,checked_at,user_id LIMIT 1').get(new Date(now - 10 * 60000).toISOString()) as { user_id: string; organization_id: string; project_id: string; language: Lang } | undefined;
    if (!row) return null;
    db.prepare('UPDATE platform_alert_subscriptions SET checked_at=? WHERE user_id=? AND organization_id=? AND project_id=?').run(at, row.user_id, row.organization_id, row.project_id);
    const scope = { subject: row.user_id, organizationId: row.organization_id, projectId: row.project_id };
    const repo = new PlatformRepository(db), workspace = repo.can(row.user_id, row.organization_id, row.project_id, 'read') ? repo.workspace(row.user_id, row.organization_id, row.project_id) : null;
    const email = (db.prepare('SELECT email FROM platform_account_emails WHERE user_id=?').get(row.user_id) as { email: string } | undefined)?.email;
    if (!workspace || workspace.project.productPack !== 'standard' || !email) return null;
    const recent = db.prepare("SELECT MAX(created_at) AS last,SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) AS today FROM platform_alert_deliveries WHERE user_id=? AND organization_id=? AND project_id=?").get(new Date(now - DAY).toISOString(), row.user_id, row.organization_id, row.project_id) as { last: string | null; today: number | null };
    if (recent.last && now - Date.parse(recent.last) < LIMITS.emailGapHours * HOUR || (recent.today || 0) >= LIMITS.emailsPerDay) return null;
    const alerts = teamAlerts(db, scope, now), seen = db.prepare('SELECT 1 FROM platform_alert_notices WHERE user_id=? AND organization_id=? AND project_id=? AND alert_key=?');
    const fresh = alerts.flatMap(item => item.keys).filter(key => !seen.get(row.user_id, row.organization_id, row.project_id, key));
    if (!fresh.length) return null;
    const id = `alert_${randomUUID()}`, mark = db.prepare('INSERT OR IGNORE INTO platform_alert_notices(user_id,organization_id,project_id,alert_key,notified_at) VALUES(?,?,?,?,?)');
    for (const key of alerts.flatMap(item => item.keys)) mark.run(row.user_id, row.organization_id, row.project_id, key, at);
    db.prepare("INSERT INTO platform_alert_deliveries(id,organization_id,project_id,user_id,state,alert_count,created_at,updated_at) VALUES(?,?,?,?,'submitted',?,?,?)").run(id, row.organization_id, row.project_id, row.user_id, alerts.reduce((sum, item) => sum + item.count, 0), at, at);
    // Notices of records that are no longer open are forgotten after 30 days; open ones stay, so they are not mailed again.
    const open = new Set(alerts.flatMap(item => item.keys)), forget = db.prepare('DELETE FROM platform_alert_notices WHERE user_id=? AND organization_id=? AND project_id=? AND alert_key=?');
    for (const old of db.prepare('SELECT alert_key FROM platform_alert_notices WHERE user_id=? AND organization_id=? AND project_id=? AND notified_at<? LIMIT 500').all(row.user_id, row.organization_id, row.project_id, new Date(now - 30 * DAY).toISOString()) as { alert_key: string }[]) if (!open.has(old.alert_key)) forget.run(row.user_id, row.organization_id, row.project_id, old.alert_key);
    return { id, mail: { to: email, ...alertMessage(alerts, row.language, workspace.project, configuration.origin) } };
  }).immediate();
  if (!claimed) return false;
  let state: 'sent' | 'uncertain' = 'sent';
  try { await deliver(claimed.mail, configuration); } catch { state = 'uncertain'; }
  db.prepare('UPDATE platform_alert_deliveries SET state=?,updated_at=? WHERE id=?').run(state, new Date().toISOString(), claimed.id);
  return true;
}
