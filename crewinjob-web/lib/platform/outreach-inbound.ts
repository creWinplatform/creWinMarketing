import type { Db } from '../db/client';
import 'server-only';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { decryptCredentials, encryptCredentials } from './credential-envelope';
import { emailAddress, emailIdentity, maskEmail } from './email-safety';
import { identityEmailConfiguration } from './identity-email';
import { deliverCoachDigest, type DigestDelivery } from './coach-digest';
import type { CoachGenerator } from './coach';
import { MarketingStoreError } from './marketing-store';
import { ProspectOutreach, prospectHost, receiveOutreachFeedback } from './prospect-outreach';
import { readReplyAddress } from './sending-providers';
import { validateSnsNotification } from './ses-feedback';
import { MANAGED_LIMITS } from './managed-sending-types';
import type { ReplyClass } from './prospect-outreach-types';

// Managed sales service: replies. Every sequence sends with its own reply address (r-<sequence>.<check>@domain), and a
// reply that quotes our message id is matched too. A reply stops the follow-ups at once (an automatic "out of office"
// only moves them by a week); "remove me" style answers block the address; the rest is sorted by AI when it is set up,
// otherwise by the team. The reply is passed on to the company by email and kept encrypted for 30 days.
export type InboundMail = { to: string[]; from: string; subject: string; text: string; headers: Record<string, string>; messageId: string };
const DAY = 86400000;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

// ---- A small MIME reader: the headers, and the plain text of the new part of the message ----
function decodeWords(value: string) {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, charset: string, encoding: string, text: string) => {
    try {
      const bytes = encoding.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch { return text; }
  });
}
function splitHeaders(block: string) {
  const headers: Record<string, string> = {};
  for (const line of block.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ').split('\n')) {
    const at = line.indexOf(':'); if (at < 1) continue;
    const name = line.slice(0, at).trim().toLowerCase(), value = decodeWords(line.slice(at + 1).trim());
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return headers;
}
const param = (header: string, name: string) => new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, 'i').exec(header)?.[1] || '';
function decodeBody(body: string, headers: Record<string, string>) {
  const encoding = (headers['content-transfer-encoding'] || '').toLowerCase(), charset = param(headers['content-type'] || '', 'charset') || 'utf-8';
  const bytes = encoding === 'base64' ? Buffer.from(body.replace(/\s+/g, ''), 'base64') : encoding === 'quoted-printable' ? Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1') : Buffer.from(body, 'utf8');
  try { return new TextDecoder(charset.toLowerCase()).decode(bytes); } catch { return bytes.toString('utf8'); }
}
function partText(raw: string, depth = 0): { text: string; html: boolean } | null {
  const cut = raw.search(/\r?\n\r?\n/); const headers = splitHeaders(cut < 0 ? raw : raw.slice(0, cut)), body = cut < 0 ? '' : raw.slice(cut).replace(/^\r?\n\r?\n/, '');
  const type = (headers['content-type'] || 'text/plain').toLowerCase();
  if (type.startsWith('multipart/') && depth < 5) {
    const boundary = param(headers['content-type'] || '', 'boundary'); if (!boundary) return null;
    const parts = body.split(`--${boundary}`).slice(1).filter(part => !part.startsWith('--')).map(part => partText(part.replace(/^\r?\n/, ''), depth + 1)).filter(Boolean) as { text: string; html: boolean }[];
    return parts.find(part => !part.html) || parts[0] || null;
  }
  if (type.startsWith('text/plain')) return { text: decodeBody(body, headers), html: false };
  if (type.startsWith('text/html')) return { text: decodeBody(body, headers).replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'), html: true };
  return null;
}
// Only the new part of a reply: the quoted earlier message is left out.
export function newReplyText(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n'), out: string[] = [];
  for (const line of lines) {
    if (/^(On .{3,200} wrote:|.{3,200} tarihinde .{0,200}yazdı:|-{2,} ?(Original Message|Orijinal [Mm]esaj|İleti) ?-{2,}|From: .+@|Kimden: .+@)/.test(line.trim())) break;
    if (/^>/.test(line.trim())) continue;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MANAGED_LIMITS.inboundChars);
}
export function parseMime(raw: string): InboundMail {
  const cut = raw.search(/\r?\n\r?\n/), headers = splitHeaders(cut < 0 ? raw : raw.slice(0, cut)), body = partText(raw);
  const addresses = (value: string) => (value.match(/[^\s<>,;"]+@[^\s<>,;"]+/g) || []).map(item => item.toLowerCase());
  return { to: [...addresses(headers.to || ''), ...addresses(headers.cc || ''), ...addresses(headers['delivered-to'] || '')], from: addresses(headers.from || '')[0] || '', subject: (headers.subject || '').slice(0, 300), text: newReplyText(body?.text || ''), headers, messageId: (headers['message-id'] || '').trim().slice(0, 300) };
}

// ---- Rules before any AI ----
export function isAutoReply(mail: Pick<InboundMail, 'headers' | 'subject'>) {
  const h = mail.headers, auto = (h['auto-submitted'] || '').toLowerCase();
  return Boolean(auto && auto !== 'no' || h['x-autoreply'] || h['x-autorespond'] || /auto_reply|bulk|junk/i.test(h.precedence || '') || /^(out of office|automatic reply|auto(matic)?[- ]?reply|otomatik yanıt|ofis dışında|izindeyim|tatildeyim)/i.test(mail.subject.trim()));
}
export const isOptOut = (text: string) => /(listeden (çıkar|sil)|abonelikten çık|bir daha (yazma|göndermey)|e-?posta (göndermeyin|istemiyorum)|rahatsız etme|istemiyorum|ilgilenmiyoruz|unsubscribe|remove me|stop (emailing|sending)|not interested|do not (contact|email))/i.test(text.slice(0, 600));

// The sequence a reply belongs to: its reply address, or a reference to one of its emails' message ids.
async function findSequence(db: Db, key: string, mail: InboundMail) {
  for (const address of mail.to) { const id = readReplyAddress(key, address); if (id) return id; }
  const refs = `${mail.headers['in-reply-to'] || ''} ${mail.headers.references || ''}`;
  for (const match of refs.matchAll(/<(osend_[a-f0-9-]{36})@[^>]+>/g)) {
    const row = await db.prepare('SELECT outreach_id FROM platform_prospect_outreach_sends WHERE id=?').get(match[1]) as { outreach_id: string } | undefined;
    if (row) return row.outreach_id;
  }
  return null;
}

export async function receiveInboundReply(db: Db, key: string, mail: InboundMail) {
  const outreachId = await findSequence(db, key, mail); if (!outreachId) return { matched: false as const };
  const row = await db.prepare('SELECT o.id,o.organization_id,o.project_id,o.prospect_id,o.email_key,o.approved_by,o.created_by,p.website FROM platform_prospect_outreach o JOIN platform_prospects p ON p.id=o.prospect_id WHERE o.id=?').get(outreachId) as { id: string; organization_id: string; project_id: string; prospect_id: string; email_key: string | null; approved_by: string | null; created_by: string; website: string } | undefined;
  if (!row) return { matched: false as const };
  const scope = { organizationId: row.organization_id, projectId: row.project_id }, from = emailAddress(mail.from) || '';
  const messageKey = sha(`inbound:${mail.messageId || `${from}|${mail.subject}|${mail.text.slice(0, 500)}`}`);
  if (await db.prepare('SELECT 1 FROM platform_outreach_inbound WHERE message_key=?').get(messageKey)) return { matched: true as const, duplicate: true };
  const host = prospectHost(row.website), fromHost = from.split('@')[1] || '';
  const matched = from && row.email_key && emailIdentity(scope, key, 'email', [from]) === row.email_key ? 'address' : host && (fromHost === host || fromHost.endsWith(`.${host}`)) ? 'domain' : 'other';
  const kind: ReplyClass | null = isAutoReply(mail) ? 'auto_reply' : isOptOut(mail.text) ? 'not_interested' : null;
  const id = `inbound_${randomUUID()}`, now = new Date();
  await db.prepare("INSERT INTO platform_outreach_inbound(id,organization_id,project_id,outreach_id,prospect_id,message_key,masked_from,matched,kind,state,encrypted_message,received_at,processed_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,'new',?,?,NULL,?)")
    .run(id, scope.organizationId, scope.projectId, row.id, row.prospect_id, messageKey, from ? maskEmail(from) : '—', matched, kind,
      encryptCredentials({ from, subject: mail.subject.slice(0, 300), text: mail.text.slice(0, MANAGED_LIMITS.inboundChars) }, key, scope.organizationId, scope.projectId, `inbound:${id}`), now.toISOString(), new Date(now.getTime() + MANAGED_LIMITS.inboundDays * DAY).toISOString());
  // Stop the follow-ups now (as the person who approved the sequence); the AI sorting comes in the worker.
  const outreach = new ProspectOutreach(db, { subject: row.approved_by || row.created_by, ...scope }, key);
  await outreach.inboundReply(row.id, kind);
  if (kind) await db.prepare("UPDATE platform_outreach_inbound SET kind=?,state='processed',processed_at=? WHERE id=?").run(kind, now.toISOString(), id);
  return { matched: true as const, id, kind };
}

// Worker step: sort the replies the rules could not (AI, when set up) and pass every reply on to the company.
export async function processInboundReplies(db: Db, key: string, generator?: CoachGenerator, deliver: DigestDelivery = deliverCoachDigest, configuration = identityEmailConfiguration(), limit = 10) {
  const rows = await db.prepare("SELECT * FROM platform_outreach_inbound WHERE state IN ('new','processed') ORDER BY received_at LIMIT ?").all(limit) as { id: string; organization_id: string; project_id: string; outreach_id: string; prospect_id: string; kind: string | null; state: string; encrypted_message: string }[];
  let done = 0;
  for (const row of rows) {
    const scope = { organizationId: row.organization_id, projectId: row.project_id };
    const message = decryptCredentials<{ from: string; subject: string; text: string }>(row.encrypted_message, key, scope.organizationId, scope.projectId, `inbound:${row.id}`);
    const outreach = await db.prepare('SELECT o.approved_by,o.created_by,o.language,p.company FROM platform_prospect_outreach o JOIN platform_prospects p ON p.id=o.prospect_id WHERE o.id=?').get(row.outreach_id) as { approved_by: string | null; created_by: string; language: 'tr' | 'en'; company: string } | undefined;
    if (!outreach) { await db.prepare("UPDATE platform_outreach_inbound SET state='failed',processed_at=? WHERE id=?").run(new Date().toISOString(), row.id); continue; }
    let kind = row.kind;
    if (row.state === 'new' && !kind && generator && message.text) kind = await new ProspectOutreach(db, { subject: outreach.approved_by || outreach.created_by, ...scope }, key).inboundReply(row.outreach_id, null, message.text, generator).catch(() => null);
    // Passed on to the person who approved the managed domain (else the one who approved the sequence).
    const approver = await db.prepare("SELECT approved_by FROM platform_managed_domains WHERE organization_id=? AND project_id=? AND state='assigned'").get(scope.organizationId, scope.projectId) as { approved_by: string | null } | undefined;
    const to = (await db.prepare('SELECT email FROM platform_account_emails WHERE user_id=?').get(approver?.approved_by || outreach.approved_by || outreach.created_by) as { email: string } | undefined)?.email;
    let state = 'processed';
    if (configuration && to) {
      const tr = outreach.language !== 'en';
      const text = [tr ? `${outreach.company} satış e-postanıza yanıt verdi.` : `${outreach.company} replied to your sales email.`, '', `${tr ? 'Kimden' : 'From'}: ${message.from}`, `${tr ? 'Konu' : 'Subject'}: ${message.subject}`, '', message.text, '',
        tr ? `Cevabınızı doğrudan ${message.from} adresine kendi e-postanızdan yazın. Takip e-postaları durduruldu.` : `Answer ${message.from} directly from your own mailbox. The follow-ups were stopped.`, `${configuration.origin}/?tab=campaigns&campaignView=prospects`].join('\n');
      try { await deliver({ to, subject: `${tr ? 'Yanıt geldi' : 'Reply received'}: ${outreach.company}`.slice(0, 200), text }, configuration); state = 'forwarded'; } catch { state = 'processed'; }
    }
    await db.prepare('UPDATE platform_outreach_inbound SET state=?,kind=COALESCE(?,kind),processed_at=? WHERE id=?').run(state, kind, new Date().toISOString(), row.id);
    done++;
  }
  return done;
}
export async function pruneInboundReplies(db: Db) { try { return (await db.prepare('DELETE FROM platform_outreach_inbound WHERE expires_at<?').run(new Date().toISOString())).changes; } catch { return 0; } }

// ---- Ways in ----
// Amazon SES through SNS (PLATFORM_MANAGED_SES_TOPIC_ARN): delivery, bounce and spam report events of managed emails,
// and received replies ("Received" with the raw message).
export async function receiveManagedSesNotification(db: Db, key: string, raw: unknown, validate = validateSnsNotification) {
  const topic = process.env.PLATFORM_MANAGED_SES_TOPIC_ARN || '';
  if (!/^arn:aws:sns:[a-z]{2}-[a-z]+-\d:\d{12}:[A-Za-z0-9_-]{1,200}$/.test(topic)) throw new MarketingStoreError('Yönetimli gönderim geri bildirimi yapılandırılmadı.', 404);
  if ((raw as { Type?: unknown })?.Type === 'SubscriptionConfirmation') return { pendingConfirmation: true };
  const body = await validate(raw, topic, undefined, 200000);
  let event: Record<string, any>; try { event = JSON.parse(body.Message); } catch { throw new MarketingStoreError('SNS olay içeriği geçersiz.'); } // eslint-disable-line @typescript-eslint/no-explicit-any
  const kind = String(event.eventType || event.notificationType || '');
  if (kind === 'Received') {
    if (event.receipt?.virusVerdict?.status === 'FAIL' || event.receipt?.spamVerdict?.status === 'FAIL' || typeof event.content !== 'string') return { ignored: true };
    const content = event.receipt?.action?.encoding === 'BASE64' ? Buffer.from(event.content, 'base64').toString('utf8') : event.content;
    const mail = parseMime(content); mail.to = [...new Set([...mail.to, ...((event.mail?.destination || []) as string[]).map(item => String(item).toLowerCase())])];
    return await receiveInboundReply(db, key, mail);
  }
  if (!['Delivery', 'Bounce', 'Complaint'].includes(kind) || kind === 'Bounce' && event.bounce?.bounceType !== 'Permanent') return { ignored: true };
  const tags = event.mail?.tags, outreachId = tags?.ryzevoOutreach?.[0], attempt = tags?.ryzevoAttempt?.[0], messageId = event.mail?.messageId;
  if (typeof outreachId !== 'string' || typeof attempt !== 'string' || typeof messageId !== 'string') return { ignored: true };
  const row = await db.prepare('SELECT organization_id,project_id FROM platform_prospect_outreach WHERE id=?').get(outreachId) as { organization_id: string; project_id: string } | undefined;
  if (!row) return { ignored: true };
  const emails: unknown[] = kind === 'Delivery' ? event.delivery?.recipients : kind === 'Bounce' ? event.bounce?.bouncedRecipients?.map((item: { emailAddress: unknown }) => item.emailAddress) : event.complaint?.complainedRecipients?.map((item: { emailAddress: unknown }) => item.emailAddress);
  return await receiveOutreachFeedback(db, { organizationId: row.organization_id, projectId: row.project_id }, key, kind as 'Delivery' | 'Bounce' | 'Complaint', outreachId, attempt, emails, messageId);
}
// Any other provider (or a small relay in front of it) posts the reply as JSON, signed with
// PLATFORM_MANAGED_INBOUND_SECRET: X-Ryzevo-Timestamp (unix seconds) and X-Ryzevo-Signature = sha256=HMAC(secret, "<timestamp>.<body>").
export function verifyInboundSignature(body: string, timestamp: string | null, signature: string | null, secret = process.env.PLATFORM_MANAGED_INBOUND_SECRET || '', now = Date.now()) {
  if (secret.length < 32 || !timestamp || !signature || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`), given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
export function inboundFromJson(value: unknown): InboundMail {
  const item = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>, text = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : '';
  const headers = Object.fromEntries(Object.entries((item.headers && typeof item.headers === 'object' ? item.headers : {}) as Record<string, unknown>).slice(0, 60).map(([name, v]) => [name.toLowerCase().slice(0, 80), text(v, 2000)]));
  return { to: (Array.isArray(item.to) ? item.to : [item.to]).filter((v): v is string => typeof v === 'string').slice(0, 20).map(v => v.toLowerCase()), from: text(item.from, 254).toLowerCase(), subject: text(item.subject, 300), text: newReplyText(text(item.text, 50000)), headers, messageId: text(item.messageId, 300) };
}
