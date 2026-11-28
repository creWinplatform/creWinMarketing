// ─── Voice consents of end users (people who use a Ryzevo customer's booking page) ─────────────────────────────────
// Ryzevo processes these on behalf of its customer (the business), who is the controller.
// Built like lib/legacy-whatsapp-consent.ts: a person and a phone number are kept only as a one-way key (HMAC with
// TRACKING_SECRET or AUTH_SECRET) and a short hint (+90•••34), in the panel's data store (data/voice-consents.jsonl, or
// legacy_records 'web:voice-consents' with PLATFORM_LEGACY_STORE=mssql). No database schema change.
// Append-only: every consent and every withdrawal is a new line; a line is never changed or removed. The latest line
// for a person (or number), type and business decides. No IP address, user agent or device fingerprint is kept.
//
// Voice is never used to identify a person, to verify identity by voice, to clone a voice, or to analyse emotion or
// personality. canUseVoice() only answers "may this person's recording be transcribed for the assistant now".
import 'server-only';
import path from 'path';
import { createHmac, randomUUID } from 'node:crypto';
import { appendStore, readStore, webStore } from '../legacy-store';
import { MarketingStoreError } from './errors';
import { isVoiceEnabled } from './voice-features';
import { VOICE_CONSENT_TYPES, VOICE_TEXTS, type VoiceConsentType, type VoiceLang } from './voice-consent-texts';

export const VOICE_CONSENT_FILE = path.join(process.cwd(), 'data', 'voice-consents.jsonl');
export const VOICE_CONSENT_SOURCES = ['web', 'mobile', 'form', 'agent'] as const;
export type VoiceConsentSource = typeof VOICE_CONSENT_SOURCES[number];
// user: a Ryzevo panel user; lead: a person known by email (booking form); visitor: an anonymous assistant session on a
// public page (a random id made in the browser tab, not derived from the device).
export type VoiceSubject = { kind: 'user' | 'lead' | 'visitor'; id: string };
export type VoiceTenant = { organizationId: string; projectId: string };
const CALL_TYPES: readonly VoiceConsentType[] = ['call_informational', 'call_commercial'];
const E164 = /^\+[1-9]\d{7,14}$/;

export type VoiceConsentRecord = {
  id: string;
  tenant: string;              // one-way key of the business (organization and project)
  subject: string;             // one-way key of the person
  subjectKind: VoiceSubject['kind'];
  type: VoiceConsentType;
  textVersion: string;         // the exact text the person saw, e.g. voice-tr-1.0
  lang: VoiceLang;             // the page language
  granted: boolean;            // true: consent given; false: withdrawn or refused
  at: string;                  // UTC ISO time
  source: VoiceConsentSource;
  phoneKey?: string;           // call consents: one-way key of the E.164 number
  phoneHint?: string;          // +90•••34
};

function secret(): string {
  const value = process.env.TRACKING_SECRET || process.env.AUTH_SECRET;
  if (!value || value.length < 16) throw new MarketingStoreError('Ses onayı kaydı için sunucuda TRACKING_SECRET veya AUTH_SECRET gerekli.', 503);
  return value;
}
const hmac = (value: string, text: string) => createHmac('sha256', value).update(`voice-consent-v1:${text}`).digest('base64url');
const tenantKey = (value: string, tenant: VoiceTenant) => hmac(value, `tenant:${tenant.organizationId}:${tenant.projectId}`);
const subjectKey = (value: string, tenant: VoiceTenant, subject: VoiceSubject) => hmac(value, `subject:${tenant.organizationId}:${tenant.projectId}:${subject.kind}:${subject.id.trim().toLowerCase()}`);
const phoneKey = (value: string, tenant: VoiceTenant, phone: string) => hmac(value, `phone:${tenant.organizationId}:${tenant.projectId}:${phone}`);
const hint = (phone: string) => `${phone.slice(0, 3)}•••${phone.slice(-2)}`;
const store = (file: string) => webStore(path.basename(file), 'array', { file, format: 'jsonl' });

/** +905321234567 for "+90 532 123 45 67", "0090 (532) 123-4567" …; null without a country code. */
export function normalizeVoicePhone(value: unknown): string | null {
  const compact = String(value ?? '').replace(/[\s().-]/g, '').replace(/^00/, '+');
  return E164.test(compact) ? compact : null;
}

const validSubject = (subject: VoiceSubject | undefined) => Boolean(subject && ['user', 'lead', 'visitor'].includes(subject.kind) && typeof subject.id === 'string' && subject.id.trim().length >= 3 && subject.id.length <= 200);

/**
 * Records one consent or withdrawal as a new line. Refused while voice features are off: nothing is written.
 * A consent must name a known text of its type; a call consent needs the number in E.164.
 */
export async function recordVoiceConsent(input: {
  tenant: VoiceTenant; subject: VoiceSubject; type: VoiceConsentType; textVersion: string; lang: VoiceLang;
  granted: boolean; source: VoiceConsentSource; phone?: string | null;
}, file = VOICE_CONSENT_FILE): Promise<VoiceConsentRecord> {
  if (!isVoiceEnabled()) throw new MarketingStoreError('Sesli özellikler kapalı.', 404);
  if (!(VOICE_CONSENT_TYPES as readonly string[]).includes(input.type)) throw new MarketingStoreError('Geçersiz onay türü.');
  const text = VOICE_TEXTS[input.textVersion];
  if (!text || text.type !== input.type) throw new MarketingStoreError('Onay metni sürümü bu onay türüne ait değil.');
  if (input.lang !== 'tr' && input.lang !== 'en') throw new MarketingStoreError('Geçersiz dil.');
  if (!(VOICE_CONSENT_SOURCES as readonly string[]).includes(input.source)) throw new MarketingStoreError('Geçersiz onay kaynağı.');
  if (!validSubject(input.subject) || !input.tenant?.organizationId || !input.tenant?.projectId) throw new MarketingStoreError('Onay kime ait, belirlenemedi.');
  const call = CALL_TYPES.includes(input.type), phone = call ? normalizeVoicePhone(input.phone) : null;
  if (call && !phone) throw new MarketingStoreError('Telefon numarasını ülke koduyla, uluslararası biçimde girin (ör. +905321234567).');
  const value = secret();
  const record: VoiceConsentRecord = {
    id: `vc_${randomUUID()}`, tenant: tenantKey(value, input.tenant), subject: subjectKey(value, input.tenant, input.subject), subjectKind: input.subject.kind,
    type: input.type, textVersion: input.textVersion, lang: input.lang, granted: input.granted === true, at: new Date().toISOString(), source: input.source,
    ...(phone ? { phoneKey: phoneKey(value, input.tenant, phone), phoneHint: hint(phone) } : {}),
  };
  await appendStore(store(file), [record]);
  return record;
}

/** A withdrawal: a new line with granted=false and the text version the person sees now. */
export const withdrawVoiceConsent = (input: Omit<Parameters<typeof recordVoiceConsent>[0], 'granted'>, file = VOICE_CONSENT_FILE) => recordVoiceConsent({ ...input, granted: false }, file);

async function latest(file: string, match: (record: VoiceConsentRecord) => boolean): Promise<VoiceConsentRecord | null> {
  const records = await readStore<VoiceConsentRecord>(store(file));
  let found: VoiceConsentRecord | null = null;
  // Lines are in the order they were written; the last matching one is the current decision.
  for (const record of records) if (record && match(record)) found = record;
  return found;
}
const valid = (record: VoiceConsentRecord | null): boolean => Boolean(record?.granted && VOICE_TEXTS[record.textVersion]?.type === record.type);

/** The current decision of a person for one type, or null when there is none. */
export async function latestVoiceConsent(tenant: VoiceTenant, subject: VoiceSubject, type: VoiceConsentType, file = VOICE_CONSENT_FILE) {
  if (!validSubject(subject)) return null;
  const value = secret(), t = tenantKey(value, tenant), s = subjectKey(value, tenant, subject);
  return await latest(file, record => record.tenant === t && record.subject === s && record.type === type);
}

/**
 * The gate every voice call to the provider must pass, on the server, before anything is sent: false while voice
 * features are off, and false unless the person's latest decision for this type is a consent that was not withdrawn.
 * Voice is never used for identification, voice verification, voice cloning, or emotion or personality analysis; a
 * true answer allows transcription for the assistant only.
 */
export async function canUseVoice(tenant: VoiceTenant, subject: VoiceSubject, type: VoiceConsentType, file = VOICE_CONSENT_FILE): Promise<boolean> {
  if (!isVoiceEnabled()) return false;
  try { return valid(await latestVoiceConsent(tenant, subject, type, file)); } catch { return false; }
}

/** Whether a number has a current, not withdrawn call consent of this type with this business. */
export async function hasCallConsent(tenant: VoiceTenant, phoneE164: string, type: 'call_informational' | 'call_commercial', file = VOICE_CONSENT_FILE): Promise<boolean> {
  if (!isVoiceEnabled()) return false;
  const phone = normalizeVoicePhone(phoneE164); if (!phone) return false;
  try {
    const value = secret(), t = tenantKey(value, tenant), p = phoneKey(value, tenant, phone);
    return valid(await latest(file, record => record.tenant === t && record.phoneKey === p && record.type === type));
  } catch { return false; }
}
