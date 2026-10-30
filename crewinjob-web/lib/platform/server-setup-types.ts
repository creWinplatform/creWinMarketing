import type { LocalizedText } from './catalog';
// Server setup guide for the team running Ryzevo: client-safe types. It says whether each setting is present and valid
// and gives the exact values to register, never a setting's value.
export type SetupId = 'google' | 'meta' | 'gemini' | 'worker'
  | 'admin-password' | 'auth-secret' | 'encryption-key' | 'plaintext-secrets'
  | 'crewin-email' | 'crewin-whatsapp' | 'crewin-telegram' | 'crewin-analytics'
  | 'public-address' | 'ses-feedback' | 'account-email'
  | 'push' | 'switches';
export type SetupGroup = 'connections' | 'security' | 'crewin' | 'live' | 'notifications' | 'switches';
// later: needed only on the live server (shown on this machine, not counted); decision: switches that are off on purpose.
export type SetupState = 'ready' | 'missing' | 'invalid' | 'stale' | 'later' | 'decision';
export type SetupStep = {
  text: LocalizedText;
  // A provider console page to open, a value to copy (a callback address, a permission list…) or both.
  link?: { href: string; label: LocalizedText };
  copy?: { label: LocalizedText; value: string };
  // A value made in the browser on request and shown only there (never sent to the server): a password, a 64-character
  // hex secret, or a VAPID key pair as two .env lines.
  generate?: { kind: 'password' | 'hex' | 'vapid'; name: string };
};
export type SetupSection = {
  id: SetupId; group: SetupGroup; title: LocalizedText; state: SetupState;
  // What it opens in the panel, in plain words.
  unlocks: LocalizedText[];
  // Exactly what is wrong now (empty when ready).
  problems: LocalizedText[];
  steps: SetupStep[];
  // Lines for .env.local: secrets as placeholders, everything that can be derived filled in.
  env: string | null;
  // After the settings: where to check the result in the panel.
  verify: { text: LocalizedText; href?: string; probe?: 'gemini' | 'google' | 'meta' };
  lastRunAt?: string | null;
};
export type SetupGuide = { origin: string; local: boolean; sections: SetupSection[]; generatedAt: string };

// Go-live checklist: work that is not a setting (legal texts, provider reviews, backups…). The team ticks an item when it
// is done; the system records who and when, and does not claim to have checked it.
export type ChecklistItem = { id: string; title: LocalizedText; detail: LocalizedText; link?: { href: string; label: LocalizedText }; done: { by: string; at: string } | null };
export type Checklist = { items: ChecklistItem[] };
