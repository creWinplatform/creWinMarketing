// ─── Legacy Crewin panel: WhatsApp consent and opt-out records ───────────────────────────────────────────
// Every legacy WhatsApp send (Messaging → Send WA notification and campaign deliveries) goes through
// sendLegacyWhatsApp: a number gets a message only with a recorded consent and no opt-out. A number is kept as a
// one-way key and a short hint (+90•••34), never in full, in data/whatsapp-consents.json. Opt-outs come from the
// panel (team), from a STOP reply or WhatsApp's own "stop marketing" choice on the signed webhook (reply), and from
// Meta refusing a message with 131050 (meta). As in Ryzevo projects, an opted-out number comes back only with a
// consent obtained after the opt-out day.
import 'server-only';
import path from 'path';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readJson, withFileLock, writeJsonAtomic } from './json-store';
import { WHATSAPP_STOP_WORDS } from './platform/whatsapp-types';

export const LEGACY_WHATSAPP_FILE = path.join(process.cwd(), 'data', 'whatsapp-consents.json');
export const LEGACY_WHATSAPP_LIMITS = { numbers: 500, check: 50, recent: 10, entries: 100000, evidence: 160 } as const;
// Meta: "This recipient has chosen to stop receiving marketing messages on WhatsApp from your business."
export const MARKETING_STOPPED = 131050;
const E164 = /^\+[1-9]\d{7,14}$/;
const STOP = new Set<string>(WHATSAPP_STOP_WORDS.map(word => word.toLocaleLowerCase('tr')));
// Meta rule: free text reaches only people who wrote to the business in the last 24 hours; marketing needs an approved
// template. Sent along with every free-text result.
const FREE_TEXT_NOTICE = 'Serbest metin yalnızca son 24 saat içinde size yazmış kullanıcılara ulaşır; pazarlama mesajları için onaylı WhatsApp template kullanın. / Free-text messages only reach users who messaged you in the last 24 hours; use approved WhatsApp templates for marketing.';

export type OptOutSource = 'reply' | 'team' | 'meta';
export type ConsentState = 'consented' | 'opted_out' | 'none' | 'invalid';
export type SkipReason = 'invalid' | 'no_consent' | 'opted_out';
type Entry = {
  hint: string;
  consentAt?: string;  // YYYY-MM-DD: when the person gave consent
  evidence?: string;   // form, record or document reference
  consentBy?: string;  // panel user who recorded it
  recordedAt?: string;
  optedOutAt?: string;
  optOutSource?: OptOutSource;
};
type Store = Record<string, Entry>;
export type ConsentView = { hint: string; state: ConsentState; consentAt?: string; evidence?: string; optedOutAt?: string; optOutSource?: OptOutSource };

export class LegacyWhatsAppError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function secret(): string | null {
  const value = process.env.TRACKING_SECRET || process.env.AUTH_SECRET;
  return value && value.length >= 16 ? value : null;
}
function requireSecret(): string {
  const value = secret();
  if (!value) throw new LegacyWhatsAppError('WhatsApp izin kaydı için sunucuda TRACKING_SECRET veya AUTH_SECRET gerekli.', 503);
  return value;
}
const keyOf = (phone: string, value: string) => createHmac('sha256', value).update(`legacy-whatsapp-v1:${phone}`).digest('base64url');
// Consent dates are Turkish calendar days (YYYY-MM-DD), as Crewin's team and most recipients are in Turkey.
const turkishDay = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(at);
const hint = (text: string) => `${text.slice(0, 3)}•••${text.slice(-2)}`;
const readStore = (file: string): Store => {
  const data = readJson<Store>(file, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
};
const stateOf = (entry: Entry | undefined): ConsentState => entry?.optedOutAt ? 'opted_out' : entry?.consentAt ? 'consented' : 'none';
const view = (entry: Entry): ConsentView => ({
  hint: entry.hint, state: stateOf(entry), consentAt: entry.consentAt, evidence: entry.evidence, optedOutAt: entry.optedOutAt, optOutSource: entry.optOutSource,
});

/** +905321234567 for "+90 532 123 45 67", "0090 (532) 123-4567" …; null without a country code. */
export function normalizeWhatsAppNumber(value: unknown): string | null {
  const compact = String(value ?? '').replace(/[\s().-]/g, '').replace(/^00/, '+');
  return E164.test(compact) ? compact : null;
}

function numberList(raw: unknown, limit: number): string[] {
  const items = Array.isArray(raw) ? raw.map(item => String(item ?? '').trim()).filter(Boolean) : [];
  if (!items.length) throw new LegacyWhatsAppError('En az bir numara girin.');
  if (items.length > limit) throw new LegacyWhatsAppError(`İstek başına en fazla ${limit} numara.`);
  return items;
}
function phoneList(raw: unknown): string[] {
  const phones = numberList(raw, LEGACY_WHATSAPP_LIMITS.numbers).map(normalizeWhatsAppNumber);
  if (phones.some(phone => !phone)) throw new LegacyWhatsAppError('Numaraları ülke koduyla, uluslararası biçimde girin (ör. +905321234567).');
  return [...new Set(phones as string[])];
}

/** Splits numbers into those that may get a message (normalised, once each) and those skipped with the reason. */
export function legacyWhatsAppGate(numbers: unknown[], file = LEGACY_WHATSAPP_FILE): { allowed: string[]; skipped: { hint: string; reason: SkipReason }[] } {
  const value = secret(), list = value ? readStore(file) : {}, seen = new Set<string>();
  const allowed: string[] = [], skipped: { hint: string; reason: SkipReason }[] = [];
  for (const raw of numbers) {
    const phone = normalizeWhatsAppNumber(raw);
    if (!phone) { skipped.push({ hint: hint(String(raw ?? '').trim()), reason: 'invalid' }); continue; }
    if (seen.has(phone)) continue;
    seen.add(phone);
    const state = value ? stateOf(list[keyOf(phone, value)]) : 'none';
    if (state === 'consented') allowed.push(phone);
    else skipped.push({ hint: hint(phone), reason: state === 'opted_out' ? 'opted_out' : 'no_consent' });
  }
  return { allowed, skipped };
}

/** Records consent for up to 500 numbers. A number that opted out needs a consent obtained after the opt-out day. */
export async function recordLegacyWhatsAppConsent(raw: { numbers?: unknown; evidence?: unknown; consentAt?: unknown }, actor: string, file = LEGACY_WHATSAPP_FILE) {
  const value = requireSecret();
  const evidence = typeof raw.evidence === 'string' ? raw.evidence.replace(/\s+/g, ' ').trim().slice(0, LEGACY_WHATSAPP_LIMITS.evidence) : '';
  if (!evidence) throw new LegacyWhatsAppError('İzin kanıtı (form, kayıt veya belge referansı) gerekli.');
  const consentAt = typeof raw.consentAt === 'string' ? raw.consentAt.trim() : '', day = Date.parse(`${consentAt}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(consentAt) || Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== consentAt || consentAt > turkishDay(new Date()))
    throw new LegacyWhatsAppError('Geçerli bir izin tarihi girin; gelecek tarih olamaz.');
  const phones = phoneList(raw.numbers);
  return withFileLock(file, () => {
    const list = readStore(file), now = new Date().toISOString();
    const blocked = phones.filter(phone => { const out = list[keyOf(phone, value)]?.optedOutAt; return out && consentAt <= turkishDay(new Date(out)); });
    if (blocked.length) throw new LegacyWhatsAppError(`${blocked.length} numara daha önce WhatsApp mesajlarından çıktı; yeniden eklemek için çıkıştan sonraki bir tarihte alınmış izin gerekir.`, 409);
    let added = 0, renewed = 0, existing = 0, size = Object.keys(list).length;
    for (const phone of phones) {
      const key = keyOf(phone, value), entry = list[key];
      if (stateOf(entry) === 'consented') { existing++; continue; }
      if (!entry && size++ >= LEGACY_WHATSAPP_LIMITS.entries) throw new LegacyWhatsAppError('WhatsApp izin listesi dolu.', 507);
      if (entry?.optedOutAt) renewed++; else added++;
      list[key] = { hint: hint(phone), consentAt, evidence, consentBy: actor, recordedAt: now };
    }
    if (added || renewed) writeJsonAtomic(file, list);
    return { added, renewed, existing };
  });
}

/** Records opt-outs. The first opt-out time is kept; the consent details stay for the record. An opt-out is never
 *  refused for space: only consents count towards the list limit. */
export async function recordLegacyWhatsAppOptOut(numbers: unknown, source: OptOutSource, file = LEGACY_WHATSAPP_FILE) {
  // The panel refuses a list with a bad number; webhook and Meta numbers are machine-made, so a bad one is just ignored.
  const phones = source === 'team' ? phoneList(numbers) : [...new Set((Array.isArray(numbers) ? numbers : []).map(normalizeWhatsAppNumber).filter((phone): phone is string => Boolean(phone)))];
  if (!phones.length) return { optedOut: 0, already: 0 };
  const value = requireSecret();
  return withFileLock(file, () => {
    const list = readStore(file), now = new Date().toISOString();
    let optedOut = 0, already = 0;
    for (const phone of phones) {
      const key = keyOf(phone, value), entry = list[key];
      if (entry?.optedOutAt) { already++; continue; }
      list[key] = { ...(entry || { hint: hint(phone) }), optedOutAt: now, optOutSource: source };
      optedOut++;
    }
    if (optedOut) writeJsonAtomic(file, list);
    return { optedOut, already };
  });
}

/** What the record says about each of up to 50 numbers. */
export function legacyWhatsAppStatus(numbers: unknown, file = LEGACY_WHATSAPP_FILE): ConsentView[] {
  const value = requireSecret(), list = readStore(file);
  return numberList(numbers, LEGACY_WHATSAPP_LIMITS.check).map(raw => {
    const phone = normalizeWhatsAppNumber(raw);
    if (!phone) return { hint: hint(raw), state: 'invalid' as const };
    const entry = list[keyOf(phone, value)];
    return entry ? view(entry) : { hint: hint(phone), state: 'none' as const };
  });
}

/** STOP replies are recorded on their own only when Meta's webhook is set up for the Crewin number. */
export const legacyWhatsAppHookReady = () => Boolean(hookSecret() && verifyToken() && process.env.WHATSAPP_PHONE_NUMBER_ID);

export function legacyWhatsAppSummary(file = LEGACY_WHATSAPP_FILE) {
  const entries = Object.values(readStore(file));
  const at = (entry: Entry) => [entry.recordedAt || '', entry.optedOutAt || ''].sort().at(-1) || '';
  return {
    consented: entries.filter(entry => stateOf(entry) === 'consented').length,
    optedOut: entries.filter(entry => stateOf(entry) === 'opted_out').length,
    recent: entries.sort((a, b) => at(b).localeCompare(at(a))).slice(0, LEGACY_WHATSAPP_LIMITS.recent).map(view),
    ready: Boolean(secret()),
    hook: legacyWhatsAppHookReady(),
  };
}

// ─── Meta webhook for the Crewin number ───────────────────────────────────────────────────────────────────
function hookSecret(): string | null {
  const value = process.env.WHATSAPP_APP_SECRET || '';
  return value.length >= 16 ? value : null;
}
function verifyToken(): string | null {
  const value = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '';
  return /^[A-Za-z0-9_-]{16,200}$/.test(value) ? value : null;
}
const digest = (text: string) => createHash('sha256').update(text).digest();
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const objects = (value: unknown) => Array.isArray(value) ? value.map(object).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
const waNumber = (value: unknown) => typeof value === 'string' && /^[1-9]\d{7,14}$/.test(value) ? `+${value}` : null;
// "STOP", "Stop promotions", "İptal", "ÇIKIŞ" …: both Turkish and plain lower case, so I/İ/ı spellings all match.
const isStop = (text: string) => {
  const clean = text.trim().replace(/[.!]+$/, '');
  return STOP.has(clean.toLocaleLowerCase('tr')) || STOP.has(clean.toLowerCase());
};

/** Meta's subscription check: the challenge when the mode and verify token match, otherwise null. */
export function verifyLegacyWhatsAppHook(query: URLSearchParams): string | null {
  const token = verifyToken(), challenge = query.get('hub.challenge') || '';
  if (!token || query.get('hub.mode') !== 'subscribe' || !/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) return null;
  return timingSafeEqual(digest(query.get('hub.verify_token') || ''), digest(token)) ? challenge : null;
}

/**
 * A signed Meta event for the Crewin number. STOP replies (text or the "Stop promotions" button) and WhatsApp's own
 * "stop marketing messages" choice record a reply opt-out; a message Meta refused with 131050 records a meta opt-out.
 * Nothing else is kept: no message text, no sender, no delivery state.
 */
export async function receiveLegacyWhatsAppHook(body: Uint8Array, signature: string | null, file = LEGACY_WHATSAPP_FILE): Promise<{ optOuts: number }> {
  const appSecret = hookSecret(), phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  if (!appSecret || !verifyToken() || !phoneNumberId) throw new LegacyWhatsAppError('WhatsApp bildirimleri bu sunucuda yapılandırılmadı.', 503);
  const expected = Buffer.from(`sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`), given = Buffer.from(signature || '');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new LegacyWhatsAppError('WhatsApp bildirim imzası doğrulanamadı.', 401);
  let payload: Record<string, unknown> | null;
  try { payload = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))); } catch { payload = null; }
  if (!payload) throw new LegacyWhatsAppError('WhatsApp bildirimi işlenemedi.');
  const replies: string[] = [], refused: string[] = [];
  for (const entry of objects(payload.entry)) for (const change of objects(entry.changes)) {
    const value = object(change.value);
    if (!value || object(value.metadata)?.phone_number_id !== phoneNumberId) continue;
    if (change.field === 'messages') {
      for (const message of objects(value.messages)) {
        const text = object(message.text)?.body ?? object(message.button)?.text;
        const from = waNumber(message.from);
        if (from && typeof text === 'string' && isStop(text)) replies.push(from);
      }
      for (const status of objects(value.statuses)) {
        const to = waNumber(status.recipient_id);
        if (to && status.status === 'failed' && objects(status.errors).some(error => Number(error.code) === MARKETING_STOPPED)) refused.push(to);
      }
    }
    if (change.field === 'user_preferences') for (const preference of objects(value.user_preferences)) {
      const from = waNumber(preference.wa_id);
      if (from && preference.category === 'marketing_messages' && preference.value === 'stop') replies.push(from);
    }
  }
  const optOuts = (await recordLegacyWhatsAppOptOut(replies, 'reply', file)).optedOut + (await recordLegacyWhatsAppOptOut(refused, 'meta', file)).optedOut;
  return { optOuts };
}

// ─── Sending ────────────────────────────────────────────────────────────────────────────────────────────────
type SendResult = { success: boolean; messageId?: string; error?: string; code?: number };
export type LegacyWhatsAppSender = {
  sendWhatsAppMessage(to: string, text: string): Promise<SendResult>;
  broadcastWhatsApp(numbers: string[], text: string): Promise<{ sent: number; failed: number; errors: string[]; results?: { to: string; success: boolean; code?: number }[] }>;
  sendWhatsAppTemplate(to: string, templateName: string, langCode: string, components: unknown[]): Promise<SendResult>;
};

const SKIP_ERRORS: Record<SkipReason, string> = {
  invalid: 'Numaraları ülke koduyla, uluslararası biçimde girin (ör. +905321234567).',
  no_consent: 'Bu numara için kayıtlı WhatsApp izni yok; mesaj gönderilmedi.',
  opted_out: 'Bu numara WhatsApp mesajlarından çıktı; mesaj gönderilmedi.',
};
function skipCounts(skipped: { reason: SkipReason }[]): Record<SkipReason, number> {
  const out: Record<SkipReason, number> = { invalid: 0, no_consent: 0, opted_out: 0 };
  for (const item of skipped) out[item.reason]++;
  return out;
}

/** The legacy /api/messaging/whatsapp/send logic: every mode sends only to numbers with consent and no opt-out. */
export async function sendLegacyWhatsApp(raw: unknown, sender: LegacyWhatsAppSender, file = LEGACY_WHATSAPP_FILE): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = object(raw) || {};
  const { mode, to, numbers, text, templateName, langCode, components } = body;
  if (mode === 'single' || mode === 'template') {
    if (mode === 'single' && (typeof to !== 'string' || !to || typeof text !== 'string' || !text)) return { status: 400, body: { error: '"to" and "text" are required.' } };
    if (mode === 'template' && (typeof to !== 'string' || !to || typeof templateName !== 'string' || !templateName || typeof langCode !== 'string' || !langCode)) {
      return { status: 400, body: { error: '"to", "templateName" and "langCode" are required.' } };
    }
    if (!secret()) return { status: 503, body: { error: 'WhatsApp izin kaydı için sunucuda TRACKING_SECRET veya AUTH_SECRET gerekli.' } };
    const { allowed, skipped } = legacyWhatsAppGate([to], file);
    if (!allowed.length) return { status: skipped[0].reason === 'invalid' ? 400 : 409, body: { error: SKIP_ERRORS[skipped[0].reason], skipped: skipCounts(skipped), skippedNumbers: skipped } };
    const result = mode === 'single'
      ? await sender.sendWhatsAppMessage(allowed[0], text as string)
      : await sender.sendWhatsAppTemplate(allowed[0], templateName as string, langCode as string, Array.isArray(components) ? components : []);
    const optedOutByMeta = !result.success && result.code === MARKETING_STOPPED ? (await recordLegacyWhatsAppOptOut(allowed, 'meta', file)).optedOut : 0;
    return { status: 200, body: { ...result, ...(optedOutByMeta ? { optedOutByMeta } : {}), ...(mode === 'single' ? { notice: FREE_TEXT_NOTICE } : {}) } };
  }
  if (mode === 'broadcast') {
    if (!Array.isArray(numbers) || numbers.length === 0 || typeof text !== 'string' || !text) return { status: 400, body: { error: '"numbers" and "text" are required.' } };
    if (numbers.length > LEGACY_WHATSAPP_LIMITS.numbers) return { status: 400, body: { error: 'Max 500 numbers per request.' } };
    if (!secret()) return { status: 503, body: { error: 'WhatsApp izin kaydı için sunucuda TRACKING_SECRET veya AUTH_SECRET gerekli.' } };
    const { allowed, skipped } = legacyWhatsAppGate(numbers, file), counts = skipCounts(skipped);
    if (!allowed.length) {
      return { status: 409, body: { error: 'Listedeki hiçbir numara için geçerli WhatsApp izni yok; gönderim yapılmadı.', sent: 0, failed: 0, errors: [], skipped: counts, skippedNumbers: skipped } };
    }
    const { results, ...result } = await sender.broadcastWhatsApp(allowed, text);
    const refused = (results || []).filter(item => !item.success && item.code === MARKETING_STOPPED).map(item => item.to);
    const optedOutByMeta = refused.length ? (await recordLegacyWhatsAppOptOut(refused, 'meta', file)).optedOut : 0;
    return { status: 200, body: { ...result, skipped: counts, skippedNumbers: skipped, ...(optedOutByMeta ? { optedOutByMeta } : {}), notice: FREE_TEXT_NOTICE } };
  }
  return { status: 400, body: { error: `Invalid mode: ${String(mode)}` } };
}
