// Voice features (speech to text, read-aloud and the voice assistant / phone agent through ElevenLabs, added in a later
// task). This file holds only the switch and the provider region: no SDK, no key and no request to ElevenLabs.
// Off by default. With the switch off nothing new is shown, no new request is made, and the security headers, the
// privacy notice and every plan screen stay exactly as they were. docs/voice/ENABLE-CHECKLIST.md lists what must be done
// before it is turned on.
// Pure module: safe in the browser and on the server.

const on = (value: string | undefined) => value === '1' || value === 'true';

/**
 * The one switch for server and browser. The browser sees NEXT_PUBLIC_VOICE_FEATURES_ENABLED (inlined at build time);
 * the server needs both it and VOICE_FEATURES_ENABLED, so a server gate is never open while the screens are hidden
 * (or the reverse after a half-done change). Set both to 1 (or true), rebuild and restart.
 */
export function isVoiceEnabled(): boolean {
  const browser = on(process.env.NEXT_PUBLIC_VOICE_FEATURES_ENABLED);
  if (typeof window !== 'undefined') return browser;
  return browser && on(process.env.VOICE_FEATURES_ENABLED);
}

// Where the voice provider processes recordings. VOICE_PROVIDER_REGION (server only), "US" unless set to "EU".
export type VoiceRegion = 'US' | 'EU';
export const voiceRegion = (): VoiceRegion => (process.env.VOICE_PROVIDER_REGION || '').trim().toUpperCase() === 'EU' ? 'EU' : 'US';
// The [ülke] / [region] placeholder of the consent texts.
export const VOICE_REGION_NAMES: Record<VoiceRegion, { tr: string; en: string }> = {
  US: { tr: 'ABD', en: 'the United States' },
  EU: { tr: 'AB', en: 'the European Union' },
};
