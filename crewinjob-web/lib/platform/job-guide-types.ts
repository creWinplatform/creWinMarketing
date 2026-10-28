import type { LocalizedText } from './catalog';
// "What would you like to do?": each job is an outcome with the steps that lead to it. A step is done only when the
// project's records show it (never because someone clicked here); the first step that is not done is the next one.
export type JobId = 'social_post' | 'inbox' | 'google' | 'ai_answers' | 'email' | 'ads' | 'results' | 'team' | 'repurpose';
export type JobStep = {
  id: string; label: LocalizedText; detail: LocalizedText; state: 'done' | 'todo' | 'blocked';
  href: string; canAct: boolean;
  // Why this member cannot do it, and who can (a teammate with a role, or the Ryzevo operator).
  reason: LocalizedText | null;
};
export type JobGuideItem = {
  id: JobId; title: LocalizedText; outcome: LocalizedText; keywords: string[];
  steps: JobStep[]; done: number; total: number; nextStepId: string | null; complete: boolean;
  // Something waiting right now (new messages, open findings…), shown next to the job.
  badge: { count: number; label: LocalizedText } | null;
  // Higher first: the member's own goal, waiting work and jobs already in progress come first.
  relevance: number;
};
export type JobGuideView = { jobs: JobGuideItem[]; intent: string | null };
