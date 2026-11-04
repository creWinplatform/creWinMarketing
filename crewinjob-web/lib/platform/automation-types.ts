// Lifecycle automation for standard projects: client-safe types only; the store lives in automations.ts.
// Trigger → wait → checks → human-approved email pilot, push or in-app message → exit. Nothing is sent without an approver.
export const AUTOMATION_LIMITS={automations:20,waitDays:30,capDays:90,enrollPerRun:1000,approvePerRun:500} as const;
export type AutomationTrigger={kind:'segment';segmentId:string;segmentVersion:number}|{kind:'event';sourceId:string;eventName:string};
// channel: email (the default; older rules have none) goes through the email pilot; push and in-app through the mobile
// app's message flow, to the people whose app id is the trigger source's id.
export type AutomationChannel='email'|'push'|'in_app';
export type AutomationDefinition={name:string;trigger:AutomationTrigger;waitDays:number;exitEvent:string|null;exitOnLeave:boolean;campaignId:string;capDays:number;channel?:AutomationChannel;mobile?:{appId:string;connectionId:string}|null};
export type AutomationState='draft'|'active'|'paused';
export type EnrollmentState='waiting'|'ready'|'sent'|'exited';
export type AutomationView=AutomationDefinition&{
  id:string;state:AutomationState;revision:number;sourceId:string;activatedAt:string|null;lastEvaluatedAt:string|null;updatedAt:string;
  counts:Record<EnrollmentState,number>;reasons:Record<string,number>;
  runs:{kind:'evaluate'|'approve';mode:'rehearsal'|'send'|null;createdAt:string;counts:Record<string,number>;jobId:string|null}[];
  campaignName:string|null;segmentName:string|null;
};
export type AutomationsSnapshot={
  automations:AutomationView[];
  segments:{id:string;name:string;version:number;sourceId:string}[];
  sources:{id:string;name:string;eventNames:string[]}[];
  campaigns:{id:string;name:string;sourceId:string|null;approval:string;email:boolean}[];
  mobile:{apps:{id:string;name:string}[];connections:{id:string;appId:string;provider:string}[]};
  canWrite:boolean;canActivate:boolean;canApprove:boolean;sendingEnabled:boolean;
};
