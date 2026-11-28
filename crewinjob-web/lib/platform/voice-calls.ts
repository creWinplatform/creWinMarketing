// The gate for outbound phone calls by a person or by the AI phone agent (the agent comes with the voice integration).
// Every outbound call must pass assertOutboundCallAllowed() on the server first. No call is placed from here.
import type { Db } from '../db/client';
import 'server-only';
import { MarketingStoreError } from './errors';
import { iysCallGate } from './iys';
import type { IysGateReason } from './iys-types';
import { isVoiceEnabled } from './voice-features';
import { hasCallConsent, normalizeVoicePhone, VOICE_CONSENT_FILE, type VoiceTenant } from './voice-consent';

export type OutboundCallPurpose = 'informational' | 'commercial';
export type OutboundCallRefusal = 'voice_off' | 'invalid_phone' | 'invalid_purpose' | 'no_call_consent' | 'not_turkish' | 'iys_off' | IysGateReason;
export class OutboundCallRefused extends MarketingStoreError {
  constructor(readonly reason: OutboundCallRefusal, message: string) { super(message, 403); }
}
const MESSAGES: Record<OutboundCallRefusal, string> = {
  voice_off: 'Sesli özellikler kapalı; arama yapılamaz.',
  invalid_phone: 'Telefon numarası uluslararası biçimde (E.164) olmalı.',
  invalid_purpose: 'Arama amacı bilgilendirme veya ticari olmalı.',
  no_call_consent: 'Bu numara için kayıtlı, geri çekilmemiş arama onayı yok.',
  not_turkish: 'Ticari arama yalnız İYS onayı olan Türkiye numaralarına yapılabilir.',
  iys_off: 'İYS kapalı; ticari arama için İYS onayı doğrulanamıyor.',
  iys_scope_missing: 'Ticari arama için İYS beyanı (Türkiye) gerekli.',
  iys_not_connected: 'Ticari arama için İYS bağlantısı gerekli.',
  iys_no_consent: 'Bu numara için İYS’de ticari arama onayı yok.',
  iys_rejected: 'Bu numara İYS’de ticari aramayı reddetti.',
  iys_stale: 'Bu numaranın İYS durumu 24 saatten eski; önce İYS’den sorgulayın.',
};
const refuse = (reason: OutboundCallRefusal): never => { throw new OutboundCallRefused(reason, MESSAGES[reason]); };

/**
 * Refuses (throws OutboundCallRefused, status 403) unless the call is allowed:
 * - always while voice features are off;
 * - informational: the person's own call consent with this business (call_informational, not withdrawn);
 * - commercial: a Turkish number with a fresh İYS consent for calls (ARAMA), checked through iys.ts.
 * The person's voice is never used to identify them, verify identity, clone the voice or analyse emotion or personality.
 */
export async function assertOutboundCallAllowed(tenantId: VoiceTenant, phoneE164: string, purpose: OutboundCallPurpose, deps: { db: Db; credentialKey: string; file?: string }): Promise<void> {
  if (!isVoiceEnabled()) refuse('voice_off');
  const phone = normalizeVoicePhone(phoneE164);
  if (!phone || phone !== phoneE164) refuse('invalid_phone');
  if (purpose === 'informational') {
    if (!await hasCallConsent(tenantId, phone!, 'call_informational', deps.file || VOICE_CONSENT_FILE)) refuse('no_call_consent');
    return;
  }
  if (purpose !== 'commercial') refuse('invalid_purpose');
  if (!/^\+90\d{10}$/.test(phone!)) refuse('not_turkish');
  const reason = await iysCallGate(deps.db, tenantId, deps.credentialKey, phone!);
  if (reason) refuse(reason);
}
