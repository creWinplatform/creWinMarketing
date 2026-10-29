import type { LocalizedText } from './catalog';
// "What would you like to do?": each job is an outcome with the steps that lead to it. A step is done only when the
// project's records show it (never because someone clicked here); the first step that is not done is the next one.
export type JobId = 'social_post' | 'inbox' | 'google' | 'ai_answers' | 'email' | 'ads' | 'results' | 'team' | 'repurpose'
  // Crewin's own workspace (legacy tabs): jobs read from its JSON stores and the Crewin backend.
  | 'crewin_jobs' | 'crewin_profiles' | 'crewin_social' | 'crewin_leads' | 'crewin_campaign' | 'crewin_seo' | 'crewin_results' | 'crewin_credits'
  | 'crewin_growth' | 'crewin_ai' | 'crewin_search' | 'crewin_inbox';
export type JobStep = {
  id: string; label: LocalizedText; detail: LocalizedText; state: 'done' | 'todo' | 'blocked';
  href: string; canAct: boolean;
  // Why this member cannot do it, and who can (a teammate with a role, or the Ryzevo operator).
  reason: LocalizedText | null;
  // What the records show (e.g. “last post 2 days ago”), so a step that repeats weekly says where it stands.
  evidence?: LocalizedText | null;
  // A step waiting for a server setting: the setup guide card that explains it (for the team running the server).
  setupHref?: string;
};
export type JobGuideItem = {
  id: JobId; title: LocalizedText; outcome: LocalizedText; keywords: string[];
  steps: JobStep[]; done: number; total: number; nextStepId: string | null; complete: boolean;
  // Something waiting right now (new messages, open findings…), shown next to the job.
  badge: { count: number; label: LocalizedText } | null;
  // Higher first: the member's own goal, waiting work and jobs already in progress come first.
  relevance: number;
};
// unavailable: jobs left out because their records could not be read right now (said, never hidden silently).
export type JobGuideView = { jobs: JobGuideItem[]; intent: string | null; unavailable?: LocalizedText[] };
