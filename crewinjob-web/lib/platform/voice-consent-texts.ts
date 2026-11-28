// Voice consent texts, word for word as legal gave them. Pure module (browser and server).
// Every text has a version. When a text changes, add a new version and point CURRENT_VOICE_TEXTS at it; never edit or
// delete an old one: consent records name the version the person saw.
// Where a language has no approved text yet, the screen shows the approved text of the other language and the entry is
// marked "TODO: hukuk onaylı çeviri". Nothing here is machine-translated.
// Placeholders in square brackets are filled with fillVoiceText(); a placeholder without a value stays visible.
import { VOICE_REGION_NAMES, type VoiceRegion } from './voice-features';

export type VoiceLang = 'tr' | 'en';
// End-user consent types. voice_assistant: voice recordings processed for transcription (the assistant on the booking
// page); call_informational: phone calls about the person's own booking; call_commercial: commercial calls (İYS).
export const VOICE_CONSENT_TYPES = ['voice_assistant', 'call_informational', 'call_commercial'] as const;
export type VoiceConsentType = typeof VOICE_CONSENT_TYPES[number];

export type VoiceText = { version: string; lang: VoiceLang; type: VoiceConsentType | 'privacy'; body: string; checkbox?: string };

export const VOICE_TEXTS: Readonly<Record<string, VoiceText>> = Object.freeze({
  'voice-tr-1.0': {
    version: 'voice-tr-1.0', lang: 'tr', type: 'voice_assistant',
    body: "Sesli [özellik] için ses kaydınız, yazıya çevrilmek üzere hizmet sağlayıcımız ElevenLabs'e ([ülke]) gönderilir. Kayıt yazıya çevrildikten sonra silinir; yalnızca metin saklanır. Bu özelliği kullanmak zorunda değilsiniz, yazarak da devam edebilirsiniz. Onayınızı Ayarlar'dan istediğiniz zaman geri alabilirsiniz.",
    checkbox: 'Ses kaydımın yazıya çevrilmek amacıyla işlenmesine açık rıza veriyorum.',
  },
  'voice-en-1.0': {
    version: 'voice-en-1.0', lang: 'en', type: 'voice_assistant',
    body: 'To use voice [feature], your recording is sent to our service provider ElevenLabs ([region]) to be transcribed. The recording is deleted after transcription; only the text is kept. Voice is optional, and you can always type instead. You can withdraw consent at any time in Settings.',
    checkbox: 'I consent to my voice recording being processed for transcription.',
  },
  'call-tr-1.0': {
    version: 'call-tr-1.0', lang: 'tr', type: 'call_informational', body: '',
    checkbox: 'Randevumla ilgili olarak [İşletme adı] tarafından bir çalışan veya yapay zekâ asistanı aracılığıyla telefonla aranmayı kabul ediyorum.',
  },
  'iys-call-tr-1.0': {
    version: 'iys-call-tr-1.0', lang: 'tr', type: 'call_commercial', body: '',
    checkbox: "Kampanya ve fırsatlarla ilgili ticari arama almak istiyorum. (İYS'ye kaydedilir.)",
  },
  'privacy-voice-tr-1.0': {
    version: 'privacy-voice-tr-1.0', lang: 'tr', type: 'privacy',
    body: "Sesli özellikler. [Ürün] üzerinde sesli özellikleri kullanırsanız ses kaydınız ve yazıya dökülmüş hali işlenir. Bu veriler [amaç] amacıyla, açık rızanıza dayanılarak işlenir. Ses kayıtları, veri işleyenimiz ElevenLabs ([ülke]) tarafından yazıya çevrilir ve işlemden sonra silinir. Metinler [süre] boyunca saklanır. Sesli asistan cevapları için [LLM sağlayıcı], telefon görüşmeleri için [Twilio] kullanılır. Bu aktarımlar KVKK m.9 kapsamında imzalanıp Kurum'a bildirilmiş standart sözleşmelere dayanır. Sesiniz kimlik tespiti veya duygu analizi için kullanılmaz. KVKK m.11'deki haklarınız için: [iletişim].",
  },
});

// The version shown for each type and language. A missing language falls back to the approved text of the other one.
export const CURRENT_VOICE_TEXTS: Readonly<Record<VoiceConsentType | 'privacy', Record<VoiceLang, string>>> = Object.freeze({
  voice_assistant: { tr: 'voice-tr-1.0', en: 'voice-en-1.0' },
  call_informational: { tr: 'call-tr-1.0', en: 'call-tr-1.0' }, // TODO: hukuk onaylı çeviri (EN)
  call_commercial: { tr: 'iys-call-tr-1.0', en: 'iys-call-tr-1.0' }, // TODO: hukuk onaylı çeviri (EN)
  privacy: { tr: 'privacy-voice-tr-1.0', en: 'privacy-voice-tr-1.0' }, // TODO: hukuk onaylı çeviri (EN)
});
export const currentVoiceText = (type: VoiceConsentType | 'privacy', lang: VoiceLang) => VOICE_TEXTS[CURRENT_VOICE_TEXTS[type][lang]];
// True when the text shown in this language is the other language's text, waiting for an approved translation.
export const voiceTextNeedsTranslation = (type: VoiceConsentType | 'privacy', lang: VoiceLang) => currentVoiceText(type, lang).lang !== lang;

// The assistant's opening line, keyed by language, for the agent settings of the later integration.
export const VOICE_AGENT_OPENING: Readonly<Record<VoiceLang, string>> = Object.freeze({
  tr: "Merhaba, ben [İşletme adı]'nın yapay zekâ asistanıyım. Konuşmamız yazıya dökülür. İsterseniz sizi bir çalışana yönlendirebilirim.",
  en: "Merhaba, ben [İşletme adı]'nın yapay zekâ asistanıyım. Konuşmamız yazıya dökülür. İsterseniz sizi bir çalışana yönlendirebilirim.", // TODO: hukuk onaylı çeviri (EN)
});

// Ryzevo's fills: the feature is the assistant; the product and the purpose of the privacy addendum.
export const VOICE_FEATURE_NAME: Record<VoiceLang, string> = { tr: 'asistan', en: 'assistant' };
export const VOICE_PRIVACY_FILLS = { 'Ürün': 'Ryzevo', 'amaç': 'sesli asistan hizmetinin sunulması' } as const;

export type VoiceFills = Record<string, string | undefined>;
/** The standard fills for a region and language: [özellik]/[feature] and [ülke]/[region]. */
export function voiceFills(region: VoiceRegion, extra: VoiceFills = {}): VoiceFills {
  return { 'özellik': VOICE_FEATURE_NAME.tr, feature: VOICE_FEATURE_NAME.en, 'ülke': VOICE_REGION_NAMES[region].tr, region: VOICE_REGION_NAMES[region].en, ...extra };
}
/** Splits a text into plain parts and placeholders; a filled placeholder becomes plain text. */
export function voiceTextParts(text: string, fills: VoiceFills): ({ text: string } | { placeholder: string })[] {
  const parts: ({ text: string } | { placeholder: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
    const value = fills[match[1]];
    if (match.index! > last) parts.push({ text: text.slice(last, match.index) });
    parts.push(value ? { text: value } : { placeholder: match[1] });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
/** The text with its placeholders filled; an unfilled one stays as [name]. */
export const fillVoiceText = (text: string, fills: VoiceFills) => voiceTextParts(text, fills).map(part => 'text' in part ? part.text : `[${part.placeholder}]`).join('');
