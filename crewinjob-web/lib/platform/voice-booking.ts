// Voice consents on the public booking page (/randevu). Used by /api/booking only while voice features are on; with
// them off the route never calls this file and the page answers exactly as before.
import type { Db } from '../db/client';
import 'server-only';
import { MarketingStoreError } from './errors';
import { bookingTenant } from './prospect-workflow';
import { queueIysConsent } from './iys';
import { isVoiceEnabled } from './voice-features';
import { CURRENT_VOICE_TEXTS, type VoiceLang } from './voice-consent-texts';
import { normalizeVoicePhone, recordVoiceConsent, latestVoiceConsent, VOICE_CONSENT_FILE } from './voice-consent';

// A visitor's assistant session: a random id the page makes in the browser tab (crypto.randomUUID), not a fingerprint.
const VISITOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const langOf = (value: unknown, fallback: VoiceLang): VoiceLang => value === 'tr' || value === 'en' ? value : fallback;

async function tenantOf(db: Db, key: unknown) {
  if (!isVoiceEnabled()) throw new MarketingStoreError('Sesli özellikler kapalı.', 404);
  const tenant = await bookingTenant(db, key);
  if (!tenant) throw new MarketingStoreError('Bu randevu sayfası kapalı.', 404);
  return tenant;
}

/** voice_consent / voice_withdraw / voice_status for the assistant on the booking page. */
export async function bookingVoiceAction(db: Db, input: Record<string, unknown>, file = VOICE_CONSENT_FILE) {
  const tenant = await tenantOf(db, input.key);
  const visitor = typeof input.visitor === 'string' && VISITOR.test(input.visitor) ? input.visitor : '';
  if (!visitor) throw new MarketingStoreError('Asistan oturumu geçersiz.');
  const lang = langOf(input.lang, tenant.language), subject = { kind: 'visitor' as const, id: visitor }, scope = { organizationId: tenant.organizationId, projectId: tenant.projectId };
  if (input.action === 'voice_status') return { granted: Boolean((await latestVoiceConsent(scope, subject, 'voice_assistant', file))?.granted) };
  if (input.action === 'voice_consent' && input.consent !== true) throw new MarketingStoreError('Sesli asistan için onay kutusunu işaretleyin.');
  const record = await recordVoiceConsent({ tenant: scope, subject, type: 'voice_assistant', textVersion: CURRENT_VOICE_TEXTS.voice_assistant[lang], lang, granted: input.action === 'voice_consent', source: 'web' }, file);
  return { granted: record.granted };
}

export type BookingCallConsents = { phone: string; informational: boolean; commercial: boolean } | null;
/** The optional phone and call consents of the booking form, checked before the booking is made. */
export function bookingCallConsents(input: Record<string, unknown>): BookingCallConsents {
  const informational = input.callConsent === true, commercial = input.iysCallConsent === true;
  if (!informational && !commercial) return null;
  const phone = normalizeVoicePhone(input.phone);
  if (!phone) throw new MarketingStoreError('Aranmak için telefon numaranızı ülke koduyla yazın (ör. +905321234567).');
  return { phone, informational, commercial };
}
/** Records the call consents of a booking just made (one line each), for the person known by the booking email. A
 *  commercial call consent of a Turkish number is also queued for İYS (channel ARAMA, source HS_WEB) when the business
 *  declared İYS for Turkey; İYS then has it within three business days and assertOutboundCallAllowed checks it there. */
export async function recordBookingCallConsents(db: Db, key: unknown, email: string, lang: unknown, consents: BookingCallConsents, credentialKey: string, file = VOICE_CONSENT_FILE) {
  if (!consents) return;
  const tenant = await tenantOf(db, key), language = langOf(lang, tenant.language), scope = { organizationId: tenant.organizationId, projectId: tenant.projectId };
  const base = { tenant: scope, subject: { kind: 'lead' as const, id: email }, lang: language, granted: true, source: 'form' as const, phone: consents.phone };
  if (consents.informational) await recordVoiceConsent({ ...base, type: 'call_informational', textVersion: CURRENT_VOICE_TEXTS.call_informational[language] }, file);
  if (!consents.commercial) return;
  const record = await recordVoiceConsent({ ...base, type: 'call_commercial', textVersion: CURRENT_VOICE_TEXTS.call_commercial[language] }, file);
  if (/^\+90\d{10}$/.test(consents.phone)) return await queueIysConsent(db, scope, credentialKey, { channel: 'ARAMA', recipient: consents.phone, status: 'ONAY', source: 'HS_WEB', consentDate: record.at, actor: 'booking' });
}
