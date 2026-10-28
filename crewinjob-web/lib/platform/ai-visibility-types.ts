// AI search visibility: client-safe types. The store is ai-visibility.ts.
// A check asks a search-grounded assistant one of the team's questions and records whether the answer names the
// brand, cites the site and which competitors it mentions. Answers vary from run to run: this is a sample, not a rank.
export const AI_VISIBILITY_LIMITS = { questions: 10, perScheduledRun: 10, history: 8, weeklyDays: 7 } as const;
export type AiVisibilitySource = { domain: string; title: string };
export type AiVisibilityCheck = {
  askedAt: string; status: 'ok' | 'failed'; brandMentioned: boolean | null; siteCited: boolean | null;
  competitors: string[]; sources: AiVisibilitySource[]; queries: string[]; excerpt: string | null; via: 'manual' | 'schedule';
};
export type AiVisibilityQuestion = { id: string; question: string; createdAt: string; latest: AiVisibilityCheck | null; history: Pick<AiVisibilityCheck, 'askedAt' | 'status' | 'brandMentioned' | 'siteCited'>[] };
export type AiVisibilityView = {
  brand: string; domain: string | null; competitors: string[];
  questions: AiVisibilityQuestion[];
  weekly: { on: boolean; nextAt: string | null; lastError: string | null; ownedByYou: boolean };
  summary: { asked: number; mentioned: number; cited: number };
  canWrite: boolean; aiConfigured: boolean; provider: string | null;
};
// What the grounded generator returns for one question.
export type GroundedAnswer = {
  text: string; sources: AiVisibilitySource[]; queries: string[];
  usage: { provider: string; model: string; prompt: number; output: number; thinking: number; total: number } | null;
  provider: string; model: string;
};
export type GroundedGenerator = (question: string, language: 'tr' | 'en') => Promise<GroundedAnswer>;
