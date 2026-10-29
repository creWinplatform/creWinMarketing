import type { LocalizedText } from './catalog';
// Server setup guide for the team running Ryzevo: client-safe types. It says whether each setting is present and valid
// and gives the exact values to register, never a setting's value.
export type SetupId = 'google' | 'meta' | 'gemini' | 'worker';
export type SetupState = 'ready' | 'missing' | 'invalid' | 'stale';
export type SetupStep = {
  text: LocalizedText;
  // A provider console page to open, a value to copy (a callback address, a permission list…) or both.
  link?: { href: string; label: LocalizedText };
  copy?: { label: LocalizedText; value: string };
};
export type SetupSection = {
  id: SetupId; title: LocalizedText; state: SetupState;
  // What it opens in the panel, in plain words.
  unlocks: LocalizedText[];
  // Exactly what is wrong now (empty when ready).
  problems: LocalizedText[];
  steps: SetupStep[];
  // Lines for .env.local: secrets as placeholders, everything that can be derived filled in.
  env: string | null;
  // After the settings: where to check the result in the panel.
  verify: { text: LocalizedText; href?: string; probe?: 'gemini' };
  lastRunAt?: string | null;
};
export type SetupGuide = { origin: string; local: boolean; sections: SetupSection[]; generatedAt: string };
