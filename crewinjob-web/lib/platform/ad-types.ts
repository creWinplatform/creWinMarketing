// Ad management for standard projects: client-safe types only; the store lives in ad-manager.ts.
// Plans are approved by a person, created on Meta as PAUSED, and only start after a second, explicit go-ahead.
export const AD_LIMITS={plans:50,maxDays:31,countries:10} as const;
export const AD_OBJECTIVES=['OUTCOME_AWARENESS','OUTCOME_TRAFFIC','OUTCOME_APP_PROMOTION'] as const;
export const AD_SPECIAL_CATEGORIES=['NONE','EMPLOYMENT','HOUSING','CREDIT','ISSUES_ELECTIONS_POLITICS'] as const;
export type AdPlanState='draft'|'approved'|'creating'|'created'|'starting'|'active'|'paused'|'failed';
export type AdAccountView={connectionId:string;adAccountId:string;name:string;currency:string;status:number|null;timezone:string|null;checkedAt:string};
export type AdPolicyView={currency:string;dailyCapMinor:number;monthlyCapMinor:number;revision:number;updatedAt:string};
export type AdPlanView={
  id:string;name:string;objective:typeof AD_OBJECTIVES[number];specialCategory:typeof AD_SPECIAL_CATEGORIES[number];dailyBudgetMinor:number;currency:string;
  startDate:string;endDate:string;days:number;totalMinor:number;countries:string[];linkUrl:string;state:AdPlanState;
  app:{store:'apple'|'google';appId:string;storeUrl:string;metaApplicationId?:string;targetCostMinor?:number}|null;
  approved:boolean;approvedAt:string|null;providerCampaignId:string|null;lastError:string|null;spendMinor:number|null;impressions:number|null;clicks:number|null;spendCheckedAt:string|null;revision:number;updatedAt:string;
};
// An ad image of a created Meta or TikTok plan (ad-creatives.ts); the thumbnail is a small JPEG data URL.
export type AdCreativeView={id:string;planId:string;thumbnail:string;width:number;height:number;headline:string;primaryText:string;cta:string;pageId:string;state:'draft'|'approved'|'uploading'|'uploaded'|'failed';approved:boolean;revision:number;imageRef:string|null;adRef:string|null;lastError:string|null;uploadedAt:string|null;updatedAt:string};
export type AdsSnapshot={
  account:AdAccountView|null;policy:AdPolicyView|null;plans:AdPlanView[];minorUnit:number;
  plannedActiveMinor:number;launchEnabled:boolean;canWrite:boolean;canManage:boolean;canApprove:boolean;
  provider:'meta'|'google'|'linkedin'|'tiktok'|'apple_search';pendingVerification:boolean;providerReady:boolean;
  // The project's mobile apps (Mobile growth), offered as the promoted app of an app-install plan.
  apps:{id:string;name:string;appleId:string;packageName:string}[];
  // Spend warnings of this provider's running plans and the project's thresholds (ad-alerts.ts).
  alerts?:{warnings:{kind:'overspend'|'cpi';planId:string;day:string;spendMinor:number;limitMinor:number;installs?:number;cpiMinor?:number|null;currency:string}[];settings:{overspendPercent:number;cpiCaps:Record<string,number>;updatedAt:string|null};canEdit:boolean};
};
