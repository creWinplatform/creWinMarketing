import type { LocalizedText } from './catalog';
// Growth coach: diagnosis answers → reviewed/approved strategy brief → weekly next-best actions.
// Client-safe constants and types only; the server store lives in coach.ts.
// The team's main goal; the same five paths as the Growth Compass, so the approved brief can set the path directly.
export const COACH_GOALS=['leads','social','retention','seo','mobile'] as const;
export type CoachGoal=typeof COACH_GOALS[number];
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
  /** Missing only in answers saved before the goal question existed. */
  goal?:CoachGoal;
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
  prefill:{brief:string;channel:string;name:string;ref:string}|null;
  state:'open'|'done'|'skipped';taskId:string|null;assignment:CoachAssignment|null;
};
export type CoachSnapshot={
  revision:number;answers:CoachAnswers|null;
  draft:CoachBrief|null;draftSource:'ai'|'template'|null;draftAt:string|null;
  brief:CoachBrief|null;approvedAt:string|null;
  week:number|null;weekKey:string;actions:CoachAction[];resolved:CoachAction[];remaining:number;
  aiConfigured:boolean;canWrite:boolean;canApprove:boolean;previousBrief:CoachBrief|null;versions:number;
};
// Brief channel → content studio channel (blog for search/SEO work).
export const coachDraftChannel=(channel:CoachChannel|null)=>channel==='seo'?'blog':channel||'linkedin';
export const COACH_PREFILL_KEY='ryzevo.coach.prefill';
// Phase 2 · monthly content plan: AI or rule-based suggestions; each item is approved by a person before use.
export type CoachContentItem={
  id:string;month:string;channel:CoachChannel;theme:string;title:string;angle:string;goalId:string|null;plannedFor:string;
  state:'suggested'|'approved'|'dismissed';source:'ai'|'template'|'human';revision:number;taskId:string|null;approvedAt:string|null;assignment:CoachAssignment|null;
  prefill:{brief:string;channel:string;name:string;ref:string}|null;
};
export type CoachContentSnapshot={
  month:string;months:string[];today:string;items:CoachContentItem[];hasBrief:boolean;language:'tr'|'en'|null;briefChannels:CoachChannel[];
  goals:{id:string;label:LocalizedText}[];aiConfigured:boolean;canWrite:boolean;
};
// Phase 2 · SEO for non-experts. Numbers only ever come from a Search Console snapshot; suggestions carry none.
export const SEO_INTENTS=['informational','commercial','transactional','navigational'] as const;
export type SeoIntent=typeof SEO_INTENTS[number];
export type CoachSeoKeyword={phrase:string;source:'search_console'|'suggested';clicks:number|null;impressions:number|null;position:number|null};
export type CoachSeoBrief={targetKeyword:string;intent:SeoIntent;title:string;outline:string[];questions:string[];internalLinks:{anchor:string;target:string}[];notes:string};
export type CoachSeoTopic={
  id:string;cluster:string;intent:SeoIntent;keywords:CoachSeoKeyword[];source:'ai'|'template';revision:number;
  brief:CoachSeoBrief|null;briefSource:'ai'|'template'|'human'|null;briefState:'draft'|'approved'|null;
  prefill:{brief:string;channel:string;name:string;ref:string}|null;
};
export type CoachSeoSnapshot={
  topics:CoachSeoTopic[];generatedAt:string|null;hasBrief:boolean;language:'tr'|'en'|null;aiConfigured:boolean;canWrite:boolean;
  searchConsole:{state:'not_connected'|'restricted'|'not_fetched'|'ready'|'no_data'|'unavailable';from:string|null;to:string|null;checkedAt:string|null;queries:number;canRefresh:boolean};
};
// Phase 2 · weekly review: facts are counts and dated values read from project records only.
export type CoachReviewMeasurement={goalId:string;goal:LocalizedText;stage:LocalizedText;latest:number;latestAt:string;previous:number|null;previousAt:string|null;source:string};
export type CoachReviewFacts={
  from:string;to:string;measurements:CoachReviewMeasurement[];lastMeasuredAt:string|null;connections:{ga4:boolean;searchConsole:boolean};
  actions:{done:number;skipped:number;open:number;doneTitles:string[]};
  content:{drafts:number;draftsByChannel:Record<string,number>;campaigns:number;publications:number;planApproved:number};
  seo:{audits:number;briefsApproved:number};
  rose:{goal:LocalizedText;stage:LocalizedText;from:number;to:number}[];
};
export type CoachAdjustment={id:string;kind:'add'|'move'|'note';title:LocalizedText;why:LocalizedText;item:CoachPlanItem|null;actionId:string|null;toWeek:number|null;state:'proposed'|'accepted'|'rejected'};
export type CoachReview={id:string;week:string;createdAt:string;revision:number;hasData:boolean;facts:CoachReviewFacts;adjustments:CoachAdjustment[]};
export type CoachReviewSnapshot={review:CoachReview|null;history:{id:string;week:string;createdAt:string}[];hasBrief:boolean;planWeek:number|null;coachRevision:number;canWrite:boolean;canApprove:boolean};
// Phase 3 · learning loop. Drafts opened from the coach carry a coachRef; everything else is read from records.
export type CoachBriefKind='approve'|'adjust'|'positioning'|'refresh';
export const COACH_REF=/^(plan|setup|content|seo):[A-Za-z0-9_:.-]{1,130}$/;
export type CoachBriefChanges={channelsAdded:CoachChannel[];channelsRemoved:CoachChannel[];positioning:boolean;icp:boolean;planAdded:number;planRemoved:number;planMoved:number};
const planKey=(item:CoachPlanItem)=>`${item.tool}\n${item.title}`;
export function diffBriefs(before:CoachBrief,after:CoachBrief):CoachBriefChanges{
  const was=new Set(before.channels.map(item=>item.id)),now=new Set(after.channels.map(item=>item.id)),old=new Map(before.plan.map(item=>[planKey(item),item.week])),next=new Map(after.plan.map(item=>[planKey(item),item.week]));
  return {channelsAdded:[...now].filter(id=>!was.has(id)),channelsRemoved:[...was].filter(id=>!now.has(id)),positioning:before.positioning!==after.positioning,icp:before.icp.summary!==after.icp.summary||before.icp.pains.join('\n')!==after.icp.pains.join('\n'),
    planAdded:[...next.keys()].filter(key=>!old.has(key)).length,planRemoved:[...old.keys()].filter(key=>!next.has(key)).length,planMoved:[...next].filter(([key,week])=>old.has(key)&&old.get(key)!==week).length};
}
export type CoachEngagement={observed:number;totals:Record<string,number>;interactions:number};
export type CoachLearningGroup={key:string;label:string;drafts:number;published:number}&CoachEngagement;
export type CoachLearningSnapshot={
  drafts:{id:string;title:string;channel:string;source:'plan'|'setup'|'content'|'seo';theme:string;createdAt:string;published:number;rehearsed:number;engagement:CoachEngagement}[];
  byChannel:CoachLearningGroup[];byTheme:CoachLearningGroup[];
  leader:{dimension:'channel'|'theme';key:string;label:string;average:number;observed:number}|null;
  measurements:{goal:LocalizedText;stage:LocalizedText;source:string;first:number;firstAt:string;last:number;lastAt:string;entries:number}[];
  versions:{revision:number;kind:CoachBriefKind;approvedAt:string;channels:CoachChannel[];planItems:number}[];
  changes:CoachBriefChanges|null;hasBrief:boolean;
  outcomes:CoachOutcomes;email:CoachEmailResults;
};
// Phase 4 · outcomes next to coach work, week by week. A reading is shown only in the week it belongs to (manual: the day it
// was recorded; automatic: the last day of the measured period). Manual and automatic sources stay on separate rows.
export type CoachOutcomeCell={value:number;at:string;from:string|null}|null;
export type CoachOutcomeRow={goalId:string;goal:LocalizedText;stage:LocalizedText;stageIndex:number;source:string;cells:CoachOutcomeCell[]};
export type CoachWeekActivity={week:string;drafts:number;campaigns:number;publications:number;emailRecipients:number;actionsDone:number;planApproved:number;byGoal:Record<string,number>};
export type CoachOutcomes={weeks:string[];rows:CoachOutcomeRow[];activity:CoachWeekActivity[];timeZone:string};
// Phase 4 · email bridge: coach campaigns and their pilot results. Provider acceptance is not delivery; there is no open or click tracking.
export type CoachEmailResults={campaigns:number;rehearsals:number;sends:number;recipients:{accepted:number;delivered:number;bounced:number;complained:number;rejected:number;uncertain:number}};
// Phase 3 · weekly-review email: opt-in per member; queued only by an approver; off unless the platform enables it.
export type CoachDigestSnapshot={subscribed:boolean;language:'tr'|'en'|null;hasVerifiedEmail:boolean;enabled:boolean;canSend:boolean;recipients:number|null;reviewId:string|null;deliveries:Record<string,number>;preview:{subject:string;text:string}|null};
// Phase 3 · brand voice workshop and competitor notes. Competitor data is only what the team writes; nothing is fetched.
export type CoachVoiceAnswers={traits:string;avoid:string;address:'formal'|'informal'|'mixed';useWords:string;avoidWords:string;example:string};
export type CoachCompetitor={name:string;url:string;says:string;strengths:string;weaknesses:string};
export type CoachPositioning={rows:{name:string;theirClaim:string;ourAngle:string}[];positioning:string;notes:string};
export type CoachBrandSnapshot={
  revision:number;voiceAnswers:CoachVoiceAnswers|null;voiceDraft:string|null;voiceSource:'ai'|'template'|'human'|null;voiceAppliedAt:string|null;currentVoice:string;
  competitors:CoachCompetitor[];difference:string;analysis:CoachPositioning|null;analysisSource:'ai'|'template'|null;
  positioning:string|null;coachRevision:number;hasBrief:boolean;aiConfigured:boolean;canWrite:boolean;canApplyVoice:boolean;canApplyPositioning:boolean;
};
// Phase 4 · monthly renewal: a proposed brief for the next 30 days, built from the period's own records.
export type CoachRefreshFacts={
  from:string;to:string;planWeek:number;
  plan:{title:string;channel:CoachChannel|null;tool:CoachTool;week:number;state:'done'|'skipped'|'open'}[];
  drafts:Record<string,number>;publications:number;emailRecipients:number;
  measurements:{goal:LocalizedText;stage:LocalizedText;source:string;first:number;last:number;entries:number}[];
  leader:{dimension:'channel'|'theme';key:string;average:number;observed:number}|null;
};
export type CoachRefreshReason={title:string;why:string};
export type CoachRefresh={id:string;month:string;source:'ai'|'template';state:'proposed'|'approved'|'dismissed';revision:number;baseRevision:number;createdAt:string;decidedAt:string|null;facts:CoachRefreshFacts;brief:CoachBrief;reasons:CoachRefreshReason[];changes:CoachBriefChanges|null;stale:boolean};
export type CoachRefreshSnapshot={refresh:CoachRefresh|null;due:boolean;hasBrief:boolean;planWeek:number|null;month:string;coachRevision:number;aiConfigured:boolean;canWrite:boolean;canApprove:boolean;history:{month:string;state:string;decidedAt:string|null}[]};
// Phase 4 · team assignment: an owner (active teammate with content rights) and an optional due date. Nothing is sent.
export type CoachAssignment={assigneeId:string;assigneeName:string;dueOn:string|null;overdue:boolean;revision:number;mine:boolean};
export type CoachAssignmentItem={kind:'action'|'content';itemId:string;title:string;href:string;state:'open'|'done'}&CoachAssignment;
export type CoachAssignmentsSnapshot={mine:CoachAssignmentItem[];all:CoachAssignmentItem[];members:{id:string;name:string}[];today:string;canWrite:boolean};
