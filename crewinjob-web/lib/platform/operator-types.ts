import type { LocalizedText } from './catalog';
// Operator console (the team that runs Ryzevo, signed in as the deployment administrator): client-safe types only.
// Readiness reports whether each server setting is present, never its value; the funnel reports counts, never people.
export type ReadinessState = 'ready' | 'warning' | 'missing' | 'off';
export type ReadinessGroup = 'core' | 'email' | 'social' | 'messaging' | 'ads' | 'ai' | 'billing';
export type ReadinessItem = { id: string; group: ReadinessGroup; state: ReadinessState; label: LocalizedText; detail: LocalizedText; env: string[]; probe?: 'gemini' };
export type ConnectionHealth = { provider: string; active: number; projects: number; checkedRecently: number };
export type ReadinessSnapshot = { generatedAt: string; items: ReadinessItem[]; connections: ConnectionHealth[]; webhooks: { path: string; label: LocalizedText }[] };
export const FUNNEL_STEPS = ['created', 'diagnosis', 'brief', 'path', 'connection', 'rehearsal', 'live'] as const;
export type FunnelStep = typeof FUNNEL_STEPS[number];
export type FunnelSnapshot = {
  generatedAt: string; days: number; stalledAfterDays: number;
  steps: { id: FunnelStep; reached: number; stalled: number }[];
  trials: { active: number; ended: number; pilot: number };
};
// detail: what the provider's answer means, in plain words (never a setting value).
export type ProbeResult = { id: 'gemini' | 'google' | 'meta'; ok: boolean; status: number | null; checkedAt: string; detail?: LocalizedText };
