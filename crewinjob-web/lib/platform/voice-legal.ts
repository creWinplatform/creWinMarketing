// What the privacy notice (/legal/privacy) adds for voice features. Both answers are null while voice features are off,
// so the page shows exactly today's text. Pure module.
import { VOICE_REGION_NAMES, type VoiceRegion } from './voice-features';
import { VOICE_PRIVACY_FILLS, currentVoiceText, voiceFills, voiceTextParts, voiceTextNeedsTranslation, type VoiceLang } from './voice-consent-texts';

/** The privacy addendum (privacy-voice-tr-1.0): text parts, with unfilled placeholders left for the page to mark. */
export function voicePrivacyAddendum(enabled: boolean, region: VoiceRegion, lang: VoiceLang, contact: string) {
  if (!enabled) return null;
  const text = currentVoiceText('privacy', lang);
  // [süre] (how long transcripts are kept) is not decided yet: it stays a visible placeholder (TODO, legal review).
  return { version: text.version, untranslated: voiceTextNeedsTranslation('privacy', lang), parts: voiceTextParts(text.body, voiceFills(region, { ...VOICE_PRIVACY_FILLS, 'iletişim': contact.trim() || undefined })) };
}

/** The voice lines of the processor list in "Transfers" (ElevenLabs, Twilio); empty while voice features are off.
 *  Google (Gemini) is already listed as the AI provider. TODO: legal review of these entries. */
export function voiceSubprocessors(enabled: boolean, region: VoiceRegion, lang: VoiceLang): string[] {
  if (!enabled) return [];
  return lang === 'en'
    ? [`Voice features: ElevenLabs (${VOICE_REGION_NAMES[region].en}), when voice features are used, to transcribe voice recordings; recordings are deleted after transcription.`,
      'Phone calls: Twilio (the United States), when the voice assistant takes or makes a phone call.']
    : [`Sesli özellikler: ElevenLabs (${VOICE_REGION_NAMES[region].tr}), sesli özellikler kullanıldığında ses kayıtlarının yazıya çevrilmesi için; kayıtlar yazıya çevrildikten sonra silinir.`,
      'Telefon görüşmeleri: Twilio (ABD), sesli asistan bir telefon görüşmesi yaptığında veya yanıtladığında.'];
}
