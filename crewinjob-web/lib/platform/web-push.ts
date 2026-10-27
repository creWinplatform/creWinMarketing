import 'server-only';
import { createHash, randomUUID, sign } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { decryptCredentials, encryptCredentials } from './credential-envelope';
import { teamAlerts } from './team-alerts';
import { approvalQueue } from './approvals';
import { webPushConfiguration, type WebPushConfig as Config } from './web-push-config';

type Fetcher = (url: string, init: RequestInit) => Promise<{ status: number }>;
const MINUTE = 60000, DAY = 24 * 60 * MINUTE;
export const WEB_PUSH_LIMITS = { gapMinutes: 30, checkMinutes: 10, perTick: 5, failures: 5, projects: 50, devices: 10 } as const;
// Push services of the browsers we support. A subscription must point at one of them, so the worker never posts to an
// address someone typed in.
const HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/, /^web\.push\.apple\.com$/];
const b64 = (value: Buffer | string) => Buffer.from(value).toString('base64url');

export function pushEndpoint(value: unknown) {
  if (typeof value !== 'string' || value.length > 1024) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && HOSTS.some(host => host.test(url.hostname)) ? url.toString() : null; } catch { return null; }
}
// RFC 8292 VAPID: an ES256 token for the push service's origin, valid for 12 hours.
export function vapidAuthorization(endpoint: string, config: Config, now = Date.now()) {
  const point = Buffer.from(config.publicKey, 'base64url');
  const key = { kty: 'EC', crv: 'P-256', d: config.privateKey, x: b64(point.subarray(1, 33)), y: b64(point.subarray(33, 65)) };
  const data = `${b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: config.subject }))}`;
  const signature = sign('sha256', Buffer.from(data), { key, format: 'jwk', dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64(signature)}, k=${config.publicKey}`;
}
// The push carries no payload, so nothing about the project travels through the browser vendor; the service worker
// shows a fixed notice and opens the portfolio.
export async function sendPush(endpoint: string, config: Config, fetcher: Fetcher = (url, init) => fetch(url, init)) {
  const response = await fetcher(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { TTL: '86400', Urgency: 'normal', 'Content-Length': '0', Authorization: vapidAuthorization(endpoint, config) } });
  return response.status;
}
const hash = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');

// What the person may act on in every project they belong to: alerts by record, approvals by kind with their oldest
// item and count (a higher count is new; a lower one is not).
function openNotices(db: Database.Database, userId: string, now: number) {
  const keys: { organizationId: string; projectId: string; key: string; approval?: { prefix: string; count: number } }[] = [];
  for (const space of new PlatformRepository(db).workspaces(userId).filter(item => item.project.productPack === 'standard').slice(0, WEB_PUSH_LIMITS.projects)) {
    const scope = { subject: userId, organizationId: space.organization.id, projectId: space.project.id }, base = { organizationId: scope.organizationId, projectId: scope.projectId };
    for (const alert of teamAlerts(db, scope, now)) for (const key of alert.keys) if (!key.startsWith('invite:') || !keys.some(item => item.key === key)) keys.push({ ...base, key: key.startsWith('invite:') ? key : `${scope.projectId}:${key}` });
    for (const item of approvalQueue(db, scope, now)) { const prefix = `${scope.projectId}:approval:${item.kind}:${item.oldest || '-'}#`; keys.push({ ...base, key: `${prefix}${item.count}`, approval: { prefix, count: item.count } }); }
  }
  return keys.filter(item => item.key.length <= 200);
}
function freshNotices(db: Database.Database, subscriptionId: string, notices: ReturnType<typeof openNotices>) {
  const seen = db.prepare('SELECT 1 FROM platform_push_notices WHERE subscription_id=? AND notice_key=?'), counted = db.prepare("SELECT notice_key FROM platform_push_notices WHERE subscription_id=? AND substr(notice_key,1,?)=?");
  return notices.filter(item => item.approval ? !(counted.all(subscriptionId, item.approval.prefix.length, item.approval.prefix) as { notice_key: string }[]).some(row => Number(row.notice_key.slice(item.approval!.prefix.length)) >= item.approval!.count) : !seen.get(subscriptionId, item.key));
}
function markNotices(db: Database.Database, subscriptionId: string, notices: ReturnType<typeof openNotices>, at: string) {
  const mark = db.prepare('INSERT OR IGNORE INTO platform_push_notices(subscription_id,organization_id,project_id,notice_key,notified_at) VALUES(?,?,?,?,?)');
  for (const item of notices) mark.run(subscriptionId, item.organizationId, item.projectId, item.key, at);
}

export class WebPush {
  private repo: PlatformRepository;
  constructor(private db: Database.Database, private scope: MarketingScope, private key: string) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private authorize() {
    if (!this.repo.can(this.scope.subject, ...this.args(), 'read') || this.repo.workspace(this.scope.subject, ...this.args())?.project.productPack !== 'standard') throw new MarketingStoreError('Bildirimler için standart proje erişimi gerekli.', 403);
  }
  private audit(operation: string) { this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), operation, new Date().toISOString()); }
  private endpoint(raw: Record<string, unknown>) {
    if (Object.keys(raw).some(key => !['action', 'endpoint'].includes(key))) throw new MarketingStoreError('Geçersiz bildirim isteği.');
    const endpoint = pushEndpoint(raw.endpoint); if (!endpoint) throw new MarketingStoreError('Bu tarayıcının bildirim adresi desteklenmiyor.');
    return endpoint;
  }
  // The browser asks whether its own subscription belongs to this person; the address itself is never sent back.
  read(raw: Record<string, unknown> = {}) {
    this.authorize(); const config = webPushConfiguration();
    const endpoint = raw.endpoint === undefined ? null : this.endpoint(raw);
    return { enabled: Boolean(config), publicKey: config?.publicKey || null, subscribed: Boolean(endpoint && this.db.prepare('SELECT 1 FROM platform_push_subscriptions WHERE endpoint_hash=? AND user_id=?').get(hash(endpoint), this.scope.subject)) };
  }
  // One subscription per browser and person, for all their projects. What is already open counts as seen, so the first
  // notification is about something new.
  subscribe(raw: Record<string, unknown>) {
    this.authorize(); const endpoint = this.endpoint(raw);
    if (!webPushConfiguration()) throw new MarketingStoreError('Telefon bildirimleri bu sunucuda kapalı.', 409);
    this.db.transaction(() => {
      this.authorize(); const at = new Date().toISOString(), digest = hash(endpoint);
      this.db.prepare('DELETE FROM platform_push_subscriptions WHERE endpoint_hash=?').run(digest);
      if ((this.db.prepare('SELECT COUNT(*) AS n FROM platform_push_subscriptions WHERE user_id=?').get(this.scope.subject) as { n: number }).n >= WEB_PUSH_LIMITS.devices) throw new MarketingStoreError(`En fazla ${WEB_PUSH_LIMITS.devices} cihazda bildirim açılabilir. Önce kullanmadığınız bir cihazda kapatın.`, 409);
      const id = `push_${randomUUID()}`;
      this.db.prepare('INSERT INTO platform_push_subscriptions(id,user_id,organization_id,project_id,endpoint_hash,encrypted_endpoint,created_at) VALUES(?,?,?,?,?,?,?)').run(id, this.scope.subject, ...this.args(), digest, encryptCredentials({ endpoint }, this.key, ...this.args(), `push:${id}`), at);
      markNotices(this.db, id, openNotices(this.db, this.scope.subject, Date.now()), at);
      this.audit('push.subscribe');
    }).immediate();
    return this.read({ endpoint });
  }
  unsubscribe(raw: Record<string, unknown>) {
    this.authorize(); const endpoint = this.endpoint(raw);
    this.db.transaction(() => { this.db.prepare('DELETE FROM platform_push_subscriptions WHERE endpoint_hash=? AND user_id=?').run(hash(endpoint), this.scope.subject); this.audit('push.unsubscribe'); }).immediate();
    return this.read({ endpoint });
  }
}

// Worker step: a few subscriptions per tick, least recently checked first. A push goes only for alerts or decisions the
// person has not been told about, at most once every 30 minutes per device. The records are marked before the call
// and never retried. A push service that says the subscription is gone (404/410) removes it; repeated errors do too.
export async function deliverDuePushes(db: Database.Database, key: string, config = webPushConfiguration(), fetcher?: Fetcher, now = Date.now()) {
  if (!config) return 0;
  let sent = 0;
  for (let index = 0; index < WEB_PUSH_LIMITS.perTick; index++) {
    const claimed = db.transaction(() => {
      const at = new Date(now).toISOString();
      const row = db.prepare('SELECT id,user_id,organization_id,project_id,encrypted_endpoint,last_sent_at FROM platform_push_subscriptions WHERE checked_at IS NULL OR checked_at<=? ORDER BY checked_at IS NOT NULL,checked_at,id LIMIT 1').get(new Date(now - WEB_PUSH_LIMITS.checkMinutes * MINUTE).toISOString()) as { id: string; user_id: string; organization_id: string; project_id: string; encrypted_endpoint: string; last_sent_at: string | null } | undefined;
      if (!row) return undefined;
      db.prepare('UPDATE platform_push_subscriptions SET checked_at=? WHERE id=?').run(at, row.id);
      // A person who left the project the subscription was made in subscribes again from a project they still have.
      if (!new PlatformRepository(db).can(row.user_id, row.organization_id, row.project_id, 'read')) { db.prepare('DELETE FROM platform_push_subscriptions WHERE id=?').run(row.id); return null; }
      if (row.last_sent_at && now - Date.parse(row.last_sent_at) < WEB_PUSH_LIMITS.gapMinutes * MINUTE) return null;
      const notices = openNotices(db, row.user_id, now);
      if (!freshNotices(db, row.id, notices).length) return null;
      markNotices(db, row.id, notices, at);
      db.prepare('UPDATE platform_push_subscriptions SET last_sent_at=? WHERE id=?').run(at, row.id);
      // Notices of records that are no longer open are forgotten after 30 days; open ones stay.
      const open = new Set(notices.map(item => item.key)), forget = db.prepare('DELETE FROM platform_push_notices WHERE subscription_id=? AND notice_key=?');
      for (const old of db.prepare('SELECT notice_key FROM platform_push_notices WHERE subscription_id=? AND notified_at<? LIMIT 500').all(row.id, new Date(now - 30 * DAY).toISOString()) as { notice_key: string }[]) if (!open.has(old.notice_key)) forget.run(row.id, old.notice_key);
      let endpoint: string | null = null;
      try { endpoint = pushEndpoint(decryptCredentials<{ endpoint: string }>(row.encrypted_endpoint, key, row.organization_id, row.project_id, `push:${row.id}`).endpoint); } catch { endpoint = null; }
      if (!endpoint) { db.prepare('DELETE FROM platform_push_subscriptions WHERE id=?').run(row.id); return null; }
      return { id: row.id, endpoint };
    }).immediate();
    if (claimed === undefined) break;
    if (!claimed) continue;
    let status = 0;
    try { status = await sendPush(claimed.endpoint, config, fetcher); } catch { status = 0; }
    if (status === 404 || status === 410) db.prepare('DELETE FROM platform_push_subscriptions WHERE id=?').run(claimed.id);
    else if (status >= 200 && status < 300) { db.prepare('UPDATE platform_push_subscriptions SET failures=0 WHERE id=?').run(claimed.id); sent++; }
    else { db.prepare('UPDATE platform_push_subscriptions SET failures=failures+1 WHERE id=?').run(claimed.id); db.prepare('DELETE FROM platform_push_subscriptions WHERE id=? AND failures>=?').run(claimed.id, WEB_PUSH_LIMITS.failures); }
  }
  return sent;
}
