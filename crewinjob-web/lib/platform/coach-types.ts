import type { LocalizedText } from './catalog';
// Growth coach: diagnosis answers → reviewed/approved strategy brief → weekly next-best actions.
// Client-safe constants and types only; the server store lives in coach.ts.
export const COACH_MARKETS=['b2b','b2c','both'] as const;
export const COACH_PRICES=['free','low','mid','high'] as const;
export const COACH_SALES=['online','sales','local'] as const;
export const COACH_CURRENT=['website','linkedin','instagram','facebook','twitter','email','seo','ads','none'] as const;
export const COACH_HOURS=['lt2','2to5','5to10','gt10'] as const;
export const COACH_SKILLS=['writing','design','video','analytics','sales','none'] as const;
export const COACH_OBSTACLES=['start','audience','time','ideas','conversion','measurement'] as const;
export const COACH_CHANNELS=['linkedin','instagram','facebook','twitter','email','seo'] as const;
export const COACH_TOOLS=['library','campaigns','seo','calendar','project','connections','analytics'] as const;
export type CoachChannel=typeof COACH_CHANNELS[number];
export type CoachTool=typeof COACH_TOOLS[number];
export type CoachAnswers={
  offer:string;customer:string;market:typeof COACH_MARKETS[number];price:typeof COACH_PRICES[number];sales:typeof COACH_SALES[number];
  current:(typeof COACH_CURRENT[number])[];hours:typeof COACH_HOURS[number];skills:(typeof COACH_SKILLS[number])[];
  obstacle:typeof COACH_OBSTACLES[number];success:string;
};
export type CoachPlanItem={week:number;title:string;why:string;how:string;minutes:number;tool:CoachTool;channel:CoachChannel|null};
export type CoachBrief={
  language:'tr'|'en';
  icp:{summary:string;pains:string[]};
  positioning:string;
  channels:{id:CoachChannel;rationale:string}[];
  plan:CoachPlanItem[];
};
export type CoachAction={
  id:string;kind:'setup'|'plan';week:number|null;
  title:string|LocalizedText;why:string|LocalizedText;how:string|LocalizedText;minutes:number;
  tool:CoachTool;channel:CoachChannel|null;href:string;canAct:boolean;
  prefill:{brief:string;channel:string;name:string}|null;
  state:'open'|'done'|'skipped';taskId:string|null;
};
export type CoachSnapshot={
  revision:number;answers:CoachAnswers|null;
  draft:CoachBrief|null;draftSource:'ai'|'template'|null;draftAt:string|null;
  brief:CoachBrief|null;approvedAt:string|null;
  week:number|null;weekKey:string;actions:CoachAction[];resolved:CoachAction[];remaining:number;
  aiConfigured:boolean;canWrite:boolean;canApprove:boolean;
};
// Brief channel → content studio channel (blog for search/SEO work).
export const coachDraftChannel=(channel:CoachChannel|null)=>channel==='seo'?'blog':channel||'linkedin';
export const COACH_PREFILL_KEY='ryzevo.coach.prefill';
