import 'server-only';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { identityEmailConfiguration } from './identity-email';
import { deliverCoachDigest, type DigestDelivery } from './coach-digest';
import { SALES_TERMS_VERSION } from './sales-terms';
import { salesTermsPlainText } from './sales-terms-document';

// The accepted terms as a durable copy: the exact text is frozen with the order when the buyer accepts it, and once
// PayTR's signed notification confirms the payment, that text is emailed to the buyer's verified account address
// through the platform's account-email (SES) configuration. Sent once; an unclear outcome is "uncertain", never resent.
type Lang = 'tr' | 'en';
export type ContractEmailState = 'queued' | 'submitted' | 'sent' | 'uncertain' | 'skipped';

// The Turkish text always comes first and prevails; an English order also gets the English translation.
export function termsSnapshot(language: Lang, origin: string) {
  const turkish = salesTermsPlainText('tr', origin);
  const text = language === 'en' ? `${turkish}\n\n----------\n\nENGLISH TRANSLATION (for information; the Turkish text prevails)\n\n${salesTermsPlainText('en', origin)}` : turkish;
  return { version: SALES_TERMS_VERSION, language, text, digest: createHash('sha256').update(text).digest('hex') };
}

type Order = { id: string; plan_id: string; package?: 'agency' | null; cadence: 'monthly' | 'yearly'; amount_minor: number; paid_at: string | null; terms_version: string | null; terms_language: Lang | null; terms_text: string | null };
type Period = { starts_at: string; ends_at: string } | undefined;
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '-');
export function contractEmailMessage(order: Order, period: Period) {
  const tr = order.terms_language !== 'en', plan = `Ryzevo ${order.package === 'agency' ? 'Agency' : order.plan_id === 'growth' ? 'Growth' : 'Launch'} (${order.cadence === 'monthly' ? (tr ? 'aylık' : 'monthly') : (tr ? 'yıllık' : 'yearly')})`;
  const amount = `$${(order.amount_minor / 100).toFixed(order.amount_minor % 100 ? 2 : 0)} (USD)`;
  const subject = tr ? `Ryzevo siparişiniz ve satış sözleşmeniz (${order.id})` : `Your Ryzevo order and terms of sale (${order.id})`;
  const head = tr
    ? ['Ödemeniz PayTR tarafından onaylandı ve planınız başladı.', 'Bu e-posta, sipariş sırasında kabul ettiğiniz ön bilgilendirme formu ile mesafeli satış sözleşmesinin bir kopyasıdır. Lütfen saklayın.', '',
      `Sipariş no: ${order.id}`, `Plan: ${plan}`, `Tutar: ${amount}`, `Dönem: ${day(period?.starts_at)} – ${day(period?.ends_at)} (UTC)`, `Ödeme onayı: ${day(order.paid_at)}`, `Sözleşme sürümü: ${order.terms_version || '-'}`, '',
      'Faturanız ayrıca gönderilir. Bu e-postaya yanıt vermeyin; sorularınız için sözleşmedeki iletişim bilgilerini kullanın.']
    : ['PayTR has confirmed your payment and your plan has started.', 'This email is a copy of the pre-contract information and distance sales contract you accepted when ordering. Please keep it.', '',
      `Order: ${order.id}`, `Plan: ${plan}`, `Amount: ${amount}`, `Period: ${day(period?.starts_at)} – ${day(period?.ends_at)} (UTC)`, `Payment confirmed: ${day(order.paid_at)}`, `Terms version: ${order.terms_version || '-'}`, '',
      'Your invoice is sent separately. Do not reply to this email; for questions use the contact details in the contract.'];
  return { subject, text: [...head, '', '==========', '', order.terms_text || ''].join('\n') };
}

// Called inside the signed-notification transaction when an order becomes paid.
export function queueContractEmail(db: Database.Database, order: { id: string; organization_id: string; project_id: string; actor_id: string; terms_text: string | null }, at: string) {
  if (!order.terms_text) return false;
  return db.prepare("INSERT OR IGNORE INTO platform_billing_contract_emails(order_id,organization_id,project_id,user_id,state,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?)").run(order.id, order.organization_id, order.project_id, order.actor_id, at, at).changes > 0;
}

// Worker step: while account email is not configured the copy waits in the queue. One claim per tick, marked
// submitted before the provider call; a buyer without a verified email any more is skipped with a reason.
export async function deliverNextContractEmail(db: Database.Database, deliver: DigestDelivery = deliverCoachDigest, configuration = identityEmailConfiguration()) {
  if (!configuration) return false;
  const claimed = db.transaction(() => {
    const row = db.prepare("SELECT order_id,user_id FROM platform_billing_contract_emails WHERE state='queued' ORDER BY created_at,rowid LIMIT 1").get() as { order_id: string; user_id: string } | undefined;
    if (!row) return null;
    const now = new Date().toISOString(), skip = (reason: string) => { db.prepare("UPDATE platform_billing_contract_emails SET state='skipped',reason=?,updated_at=? WHERE order_id=?").run(reason, now, row.order_id); return 'skipped' as const; };
    const order = db.prepare("SELECT id,plan_id,package,cadence,amount_minor,paid_at,terms_version,terms_language,terms_text FROM platform_billing_live_orders WHERE id=? AND state='paid'").get(row.order_id) as Order | undefined;
    if (!order?.terms_text) return skip('no_paid_snapshot');
    const email = (db.prepare('SELECT email FROM platform_account_emails WHERE user_id=?').get(row.user_id) as { email: string } | undefined)?.email;
    if (!email) return skip('no_verified_email');
    const period = db.prepare('SELECT starts_at,ends_at FROM platform_project_subscriptions WHERE order_id=?').get(order.id) as Period;
    db.prepare("UPDATE platform_billing_contract_emails SET state='submitted',updated_at=? WHERE order_id=? AND state='queued'").run(now, row.order_id);
    return { id: row.order_id, mail: { to: email, ...contractEmailMessage(order, period) } };
  }).immediate();
  if (!claimed || claimed === 'skipped') return claimed;
  let state: 'sent' | 'uncertain' = 'sent'; try { await deliver(claimed.mail, configuration); } catch { state = 'uncertain'; }
  db.prepare('UPDATE platform_billing_contract_emails SET state=?,updated_at=? WHERE order_id=?').run(state, new Date().toISOString(), claimed.id);
  return state;
}
