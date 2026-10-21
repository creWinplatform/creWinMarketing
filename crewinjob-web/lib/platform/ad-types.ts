// Ad management for standard projects: client-safe types only; the store lives in ad-manager.ts.
// Plans are approved by a person, created on Meta as PAUSED, and only start after a second, explicit go-ahead.
export const AD_LIMITS={plans:50,maxDays:31,countries:10} as const;
export const AD_OBJECTIVES=['OUTCOME_AWARENESS','OUTCOME_TRAFFIC'] as const;
export const AD_SPECIAL_CATEGORIES=['NONE','EMPLOYMENT','HOUSING','CREDIT','ISSUES_ELECTIONS_POLITICS'] as const;
export type AdPlanState='draft'|'approved'|'created'|'active'|'paused'|'failed';
export type AdAccountView={connectionId:string;adAccountId:string;name:string;currency:string;status:number|null;timezone:string|null;checkedAt:string};
export type AdPolicyView={currency:string;dailyCapMinor:number;monthlyCapMinor:number;revision:number;updatedAt:string};
export type AdPlanView={
  id:string;name:string;objective:typeof AD_OBJECTIVES[number];specialCategory:typeof AD_SPECIAL_CATEGORIES[number];dailyBudgetMinor:number;currency:string;
  startDate:string;endDate:string;days:number;totalMinor:number;countries:string[];linkUrl:string;state:AdPlanState;
  approved:boolean;approvedAt:string|null;providerCampaignId:string|null;lastError:string|null;spendMinor:number|null;impressions:number|null;clicks:number|null;spendCheckedAt:string|null;revision:number;updatedAt:string;
};
export type AdsSnapshot={
  account:AdAccountView|null;policy:AdPolicyView|null;plans:AdPlanView[];minorUnit:number;
  plannedActiveMinor:number;launchEnabled:boolean;canWrite:boolean;canManage:boolean;canApprove:boolean;
  provider:'meta'|'google'|'linkedin';pendingVerification:boolean;providerReady:boolean;
};
