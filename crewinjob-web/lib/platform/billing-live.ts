import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials, encryptCredentials } from './credential-envelope';
import { AGENCY_PACKAGE, PLAN_CATALOG, PLAN_CATALOG_VERSION } from './plan-catalog';
import { LIVE_ORDER_ID, paytrConfiguration, paytrLiveCheckoutForm, paytrLiveReadiness, requestPaytrLiveToken, verifyPaytrLiveNotification, type PaytrConfiguration, type PaytrTransport } from './paytr';
import type { LiveBillingOrder, LiveBillingOrderState, LiveBillingPlan, LiveBillingView, LivePlanId } from './billing-types';
import { queueContractEmail, termsSnapshot, type ContractEmailState } from './billing-contract';

// Live billing: prepaid monthly or yearly periods paid through PayTR, no stored cards and no automatic renewal.
// Paid rights exist only after a signed success notification whose amount matches the order; anything contradictory
// goes to review and grants nothing. A period may be bought when none is running, or in its last 14 days or its
// 7-day grace; the new period then starts where the current one ends, so nobody pays months ahead by accident.
export const LIVE_CATALOG_VERSION = `${PLAN_CATALOG_VERSION}-live1`;
export const RENEWAL_WINDOW_DAYS = 14, GRACE_DAYS = 7, DAY = 86400000;
type OrderRow = { id: string; organization_id: string; project_id: string; actor_id: string; idempotency_key: string; request_digest: string; merchant_revision: string; catalog_version: string; plan_id: LivePlanId; cadence: 'monthly' | 'yearly'; amount_minor: number; state: LiveBillingOrderState; encrypted_token: string; notification_digest: string | null; terms_url: string; created_at: string; expires_at: string; updated_at: string; paid_at: string | null; revision: number; terms_version: string | null; terms_language: 'tr' | 'en' | null; terms_text: string | null; terms_digest: string | null; package: 'agency' | null };
type Subscription = { order_id: string; plan_id: LivePlanId; package: 'agency' | null; cadence: 'monthly' | 'yearly'; starts_at: string; ends_at: string; grace_ends_at: string };
const now = () => new Date().toISOString();

// Launch and Growth are sold; Team stays "later". The agency package is a Growth period for the agency's own project
// that also covers up to ten linked client projects. A year costs ten months.
export function livePlans(): LiveBillingPlan[] {
  const growth = PLAN_CATALOG.find(plan => plan.id === AGENCY_PACKAGE.plan)!;
  return [...PLAN_CATALOG.filter(plan => plan.availability === 'planned').map(plan => ({ ...plan, id: plan.id as LivePlanId, projects: undefined })), { ...growth, id: AGENCY_PACKAGE.id, name: AGENCY_PACKAGE.name, monthlyUsdMinor: AGENCY_PACKAGE.monthlyUsdMinor, projects: AGENCY_PACKAGE.projects }]
    .flatMap(plan => (['monthly', 'yearly'] as const).map(cadence => ({
      id: plan.id, name: plan.name, cadence, amountMinor: cadence === 'monthly' ? plan.monthlyUsdMinor : plan.monthlyUsdMinor * 10,
      seats: plan.seats, socialAccounts: plan.socialAccounts, ai: plan.ai, audits: plan.audits, ...(plan.projects ? { projects: plan.projects } : {}),
    })));
}
// Calendar periods in UTC: a month from 31 January ends on the last day of February, never in March.
export function addPeriod(startIso: string, cadence: 'monthly' | 'yearly'): string {
  const start = new Date(startIso), months = cadence === 'monthly' ? 1 : 12, target = new Date(start);
  target.setUTCDate(1); target.setUTCMonth(target.getUTCMonth() + months);
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), last));
  return target.toISOString();
}
const args = (scope: { organizationId: string; projectId: string }) => [scope.organizationId, scope.projectId] as const;
export function currentSubscription(db: Database.Database, scope: { organizationId: string; projectId: string }, at = now()): Subscription | undefined {
  return db.prepare('SELECT order_id,plan_id,package,cadence,starts_at,ends_at,grace_ends_at FROM platform_project_subscriptions WHERE organization_id=? AND project_id=? AND starts_at<=? AND grace_ends_at>? ORDER BY ends_at DESC LIMIT 1').get(...args(scope), at, at) as Subscription | undefined;
}
const latestEnd = (db: Database.Database, scope: { organizationId: string; projectId: string }) =>
  (db.prepare('SELECT MAX(ends_at) e FROM platform_project_subscriptions WHERE organization_id=? AND project_id=?').get(...args(scope)) as { e: string | null }).e;
const text = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new MarketingStoreError('Fatura ve iletişim bilgileri geçersiz.');
  return value.trim();
};

export class ProjectLiveBilling {
  constructor(private db: Database.Database, private scope: MarketingScope, private key: string, private configuration: () => PaytrConfiguration = paytrConfiguration) {}
  private authorize() {
    const repo = new PlatformRepository(this.db);
    if (!repo.can(this.scope.subject, ...args(this.scope), 'billing.manage') || repo.workspace(this.scope.subject, ...args(this.scope))?.project.productPack !== 'standard') throw new MarketingStoreError('Ödeme alanına yalnız proje sahibi erişebilir.', 403);
  }
  // Operator-provisioned pilots keep pilot rights, which a paid period never replaces, so they cannot buy one.
  private pilot() { return (this.db.prepare('SELECT mode FROM platform_project_entitlements WHERE organization_id=? AND project_id=?').get(...args(this.scope)) as { mode: string } | undefined)?.mode === 'pilot'; }
  private row(id: string) { return this.db.prepare('SELECT * FROM platform_billing_live_orders WHERE id=? AND organization_id=? AND project_id=?').get(id, ...args(this.scope)) as OrderRow | undefined; }
  private audit(operation: string) { this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...args(this.scope), operation, now()); }
  private view(row: OrderRow, ready: boolean, emails = new Map<string, ContractEmailState>()): LiveBillingOrder {
    let checkoutUrl: string | null = null;
    if (row.state === 'pending' && row.expires_at > now() && ready) {
      try { const token = decryptCredentials<{ token: string }>(row.encrypted_token, this.key, row.organization_id, row.project_id, row.id).token; if (/^[a-zA-Z0-9]{20,256}$/.test(token)) checkoutUrl = 'https://www.paytr.com/odeme/guvenli/' + token; } catch { checkoutUrl = null; }
    }
    return { id: row.id, planId: row.package === 'agency' ? 'agency' : row.plan_id, cadence: row.cadence, amountMinor: row.amount_minor, currency: 'USD', state: row.state, createdAt: row.created_at, expiresAt: row.expires_at, paidAt: row.paid_at, checkoutUrl, contract: Boolean(row.terms_text), contractEmail: emails.get(row.id) || null };
  }
  // When a new period may be bought: no period, or within 14 days of the latest end (grace included).
  private purchaseOpensAt() {
    const end = latestEnd(this.db, this.scope);
    if (!end || Date.parse(end) - Date.now() <= RENEWAL_WINDOW_DAYS * DAY) return null;
    return new Date(Date.parse(end) - RENEWAL_WINDOW_DAYS * DAY).toISOString();
  }
  read(): LiveBillingView {
    this.authorize(); const readiness = paytrLiveReadiness(this.configuration()), current = currentSubscription(this.db, this.scope);
    const rows = this.db.prepare('SELECT * FROM platform_billing_live_orders WHERE organization_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 20').all(...args(this.scope)) as OrderRow[];
    const pilot = this.pilot(), opensAt = this.purchaseOpensAt(), open = rows.some(row => ['preparing', 'pending', 'uncertain', 'review'].includes(row.state));
    const emails = new Map((this.db.prepare('SELECT order_id,state FROM platform_billing_contract_emails WHERE organization_id=? AND project_id=?').all(...args(this.scope)) as { order_id: string; state: ContractEmailState }[]).map(item => [item.order_id, item.state]));
    return {
      enabled: readiness.ready, termsUrl: readiness.ready ? readiness.termsUrl : null, plans: livePlans(),
      current: current ? { planId: current.package === 'agency' ? 'agency' : current.plan_id, cadence: current.cadence, startsAt: current.starts_at, endsAt: current.ends_at, graceEndsAt: current.grace_ends_at, inGrace: current.ends_at <= now() } : null,
      nextStartsAt: (() => { const end = latestEnd(this.db, this.scope); return end && end > now() ? end : null; })(),
      canPurchase: readiness.ready && !pilot && !opensAt && !open, pilotManaged: pilot, purchaseOpensAt: opensAt, openOrder: open,
      emailVerified: Boolean(this.db.prepare('SELECT user_id FROM platform_account_emails WHERE user_id=?').get(this.scope.subject)),
      orders: rows.map(row => this.view(row, readiness.ready, emails)),
    };
  }
  // The terms text this order was accepted with, for the owner to download (the same copy that is emailed).
  contract(id: unknown) {
    this.authorize(); const row = typeof id === 'string' && LIVE_ORDER_ID.test(id) ? this.row(id) : undefined;
    if (!row?.terms_text) throw new MarketingStoreError('Bu sipariş için saklanmış sözleşme yok.', 404);
    return { filename: `ryzevo-sozlesme-${row.id}.txt`, text: row.terms_text };
  }
  async start(input: unknown, ip: string, transport: PaytrTransport = requestPaytrLiveToken): Promise<LiveBillingOrder> {
    this.authorize(); const config = this.configuration(), readiness = paytrLiveReadiness(config);
    if (!readiness.ready) throw new MarketingStoreError('Canlı ödeme henüz açılmadı.', 503);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['action', 'planId', 'cadence', 'idempotencyKey', 'contact', 'acceptTerms', 'language'].includes(key))) throw new MarketingStoreError('Geçersiz ödeme isteği.');
    const value = input as Record<string, unknown>, plan = livePlans().find(item => item.id === value.planId && item.cadence === value.cadence);
    if (!plan) throw new MarketingStoreError('Plan bulunamadı.', 404);
    if (value.acceptTerms !== true) throw new MarketingStoreError('Devam etmek için satış sözleşmesini ve ön bilgilendirme metnini onaylayın.');
    if (typeof value.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(value.idempotencyKey) || !isIP(ip)) throw new MarketingStoreError('Geçersiz ödeme isteği.');
    const email = (this.db.prepare('SELECT email FROM platform_account_emails WHERE user_id=?').get(this.scope.subject) as { email: string } | undefined)?.email;
    if (!email) throw new MarketingStoreError('Önce hesap e-postanızı doğrulayın.', 409);
    const contact = value.contact as Record<string, unknown>;
    if (!contact || typeof contact !== 'object' || Array.isArray(contact) || Object.keys(contact).some(key => !['name', 'phone', 'address'].includes(key))) throw new MarketingStoreError('Fatura ve iletişim bilgileri geçersiz.');
    const name = text(contact.name, 2, 60), phone = text(contact.phone, 5, 20), address = text(contact.address, 5, 400), language = value.language === 'en' ? 'en' : 'tr';
    if (!/^[+\d ()-]+$/.test(phone)) throw new MarketingStoreError('Telefon numarası geçersiz.');
    // The exact terms the buyer accepts are frozen with the order (and emailed after payment).
    const terms = termsSnapshot(language, new URL(readiness.termsUrl).origin);
    const digest = createHash('sha256').update(JSON.stringify([this.scope.subject, plan, config.merchantRevision, readiness.termsUrl, terms.digest, name, phone, address, email, language])).digest('hex'), idempotency = createHash('sha256').update(value.idempotencyKey).digest('hex');
    const reservation = this.db.transaction(() => {
      this.authorize();
      const existing = this.db.prepare('SELECT * FROM platform_billing_live_orders WHERE organization_id=? AND project_id=? AND idempotency_key=?').get(...args(this.scope), idempotency) as OrderRow | undefined;
      if (existing) { if (existing.request_digest !== digest) throw new MarketingStoreError('Bu istek anahtarı başka bir ödemede kullanıldı.', 409); return { row: existing, created: false }; }
      if (this.db.prepare("SELECT id FROM platform_billing_live_orders WHERE organization_id=? AND project_id=? AND state IN ('preparing','pending','uncertain','review')").get(...args(this.scope))) throw new MarketingStoreError('Sonucu beklenen bir ödeme var. Yeni ödemeden önce sonucunu bekleyin.', 409);
      if (this.pilot()) throw new MarketingStoreError('Pilot projelerin planı ekibimizle birlikte belirlenir; buradan ödeme alınmaz.', 409);
      const opensAt = this.purchaseOpensAt();
      if (opensAt) throw new MarketingStoreError('Yeni dönem, mevcut dönemin bitmesine 14 gün kala satın alınabilir.', 409);
      if ((this.db.prepare('SELECT COUNT(*) n FROM platform_billing_live_orders WHERE organization_id=? AND project_id=? AND created_at>=?').get(...args(this.scope), new Date(Date.now() - DAY).toISOString()) as { n: number }).n >= 10) throw new MarketingStoreError('Günlük ödeme denemesi sınırına ulaşıldı.', 429);
      const id = 'RZLIVE' + randomBytes(16).toString('hex'), at = now(), expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
      // The agency package is stored as a Growth period marked package='agency'.
      this.db.prepare("INSERT INTO platform_billing_live_orders(id,organization_id,project_id,actor_id,idempotency_key,request_digest,merchant_revision,catalog_version,plan_id,cadence,amount_minor,state,terms_url,created_at,expires_at,updated_at,terms_version,terms_language,terms_text,terms_digest,package) VALUES(?,?,?,?,?,?,?,?,?,?,?,'preparing',?,?,?,?,?,?,?,?,?)")
        .run(id, ...args(this.scope), this.scope.subject, idempotency, digest, config.merchantRevision, LIVE_CATALOG_VERSION, plan.id === 'agency' ? AGENCY_PACKAGE.plan : plan.id, plan.cadence, plan.amountMinor, readiness.termsUrl, at, expiresAt, at, terms.version, terms.language, terms.text, terms.digest, plan.id === 'agency' ? 'agency' : null);
      this.audit('billing.live.prepare'); return { row: this.row(id)!, created: true };
    }).immediate();
    if (!reservation.created) return this.view(reservation.row, readiness.ready);
    const row = reservation.row; let result: Awaited<ReturnType<PaytrTransport>> = { state: 'uncertain' };
    try {
      // Re-checked just before the only external request; no automatic retries.
      this.authorize(); const current = this.configuration();
      if (current.merchantRevision !== config.merchantRevision || !paytrLiveReadiness(current).ready) throw new Error('Configuration changed.');
      result = await transport(paytrLiveCheckoutForm(config, { orderId: row.id, amountMinor: plan.amountMinor, planName: `Ryzevo ${plan.name} (${plan.cadence === 'monthly' ? (language === 'tr' ? 'aylık' : 'monthly') : (language === 'tr' ? 'yıllık' : 'yearly')})`, name, email, phone, address, ip, language }));
    } catch { result = { state: 'uncertain' }; }
    this.db.transaction(() => {
      const token = result.state === 'accepted' && /^[a-zA-Z0-9]{20,256}$/.test(result.token) ? encryptCredentials({ token: result.token }, this.key, ...args(this.scope), row.id) : '';
      const state: LiveBillingOrderState = result.state === 'accepted' ? (token ? 'pending' : 'uncertain') : result.state;
      this.db.prepare("UPDATE platform_billing_live_orders SET state=?,encrypted_token=?,updated_at=?,revision=revision+1 WHERE id=? AND state='preparing'").run(state, token, now(), row.id);
      this.audit('billing.live.response');
    }).immediate();
    this.authorize(); return this.view(this.row(row.id)!, paytrLiveReadiness(this.configuration()).ready);
  }
}

export const isLiveNotification = (body: string) => LIVE_ORDER_ID.test(new URLSearchParams(body).get('merchant_oid') || '');
// The signed order ID decides the project, never a cookie or a submitted tenant. Repeats of the same notification
// are ignored; a second, different one or any mismatch sends the order to review and grants nothing new.
export function receivePaytrLiveNotification(db: Database.Database, body: string, config: PaytrConfiguration = paytrConfiguration()) {
  const notice = verifyPaytrLiveNotification(config, body);
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM platform_billing_live_orders WHERE id=?').get(notice.orderId) as OrderRow | undefined;
    if (!row || row.merchant_revision !== config.merchantRevision) throw new MarketingStoreError('Bildirim eşleştirilemedi.', 409);
    if (row.notification_digest === notice.digest) return { state: row.state };
    const scope = { organizationId: row.organization_id, projectId: row.project_id }, at = now();
    const conflict = Boolean(row.notification_digest) || ['paid', 'failed', 'review', 'rejected'].includes(row.state) || !notice.metadataMatches || (notice.status === 'success' && notice.totalMinor !== row.amount_minor);
    const state: LiveBillingOrderState = conflict ? 'review' : notice.status === 'success' ? 'paid' : 'failed';
    if (state === 'paid') {
      const end = latestEnd(db, scope), startsAt = end && end > at ? end : at, endsAt = addPeriod(startsAt, row.cadence);
      db.prepare('INSERT INTO platform_project_subscriptions(order_id,organization_id,project_id,plan_id,cadence,starts_at,ends_at,grace_ends_at,created_at,package) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(row.id, row.organization_id, row.project_id, row.plan_id, row.cadence, startsAt, endsAt, new Date(Date.parse(endsAt) + GRACE_DAYS * DAY).toISOString(), at, row.package);
      queueContractEmail(db, row, at);
    }
    db.prepare("UPDATE platform_billing_live_orders SET state=?,notification_digest=?,encrypted_token='',paid_at=CASE WHEN ?='paid' THEN ? ELSE paid_at END,updated_at=?,revision=revision+1 WHERE id=?").run(state, notice.digest, state, at, at, row.id);
    db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(row.actor_id, row.organization_id, row.project_id, `billing.live.${state}`, at);
    return { state };
  }).immediate();
}
