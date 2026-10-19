import type { LocalizedText } from './catalog';
// SEO operations for standard projects: client-safe types only; the store lives in seo-operations.ts.
export const SEO_SCAN_MAX_PAGES=20;
export type SeoFindingState='open'|'fixed'|'ignored';
export type SeoFindingEvent={kind:'detected'|'fixed'|'reopened'|'ignored'|'restored'|'planned';at:string;scanId:string|null};
export type SeoFindingView={
  id:string;url:string;siteWide:boolean;category:string;title:string;priority:'high'|'medium'|'low';impact:'high'|'medium'|'low';
  detail:string;evidence:string;recommendation:string;why:LocalizedText;how:LocalizedText;
  state:SeoFindingState;firstSeenAt:string;lastSeenAt:string;fixedAt:string|null;revision:number;
  task:{id:string;status:string}|null;events:SeoFindingEvent[];
};
export type SeoScanView={id:string;origin:string;source:'sitemap'|'homepage_links';discovered:number;state:'running'|'completed'|'cancelled';
  startedAt:string;finishedAt:string|null;pages:{total:number;done:number;failed:number;pending:number;skipped:number}};
export type SeoOperationsSnapshot={
  origin:string|null;scan:SeoScanView|null;counts:Record<SeoFindingState,number>;findings:SeoFindingView[];
  maxPages:number;canWrite:boolean;
};
// Search Console opportunities: fixed editorial rules over the stored query snapshot; no prediction or uplift.
export type SeoOpportunity={query:string;clicks:number;impressions:number;ctr:number;position:number;kind:'near_first_page'|'low_ctr'};
export type SeoOpportunitiesSnapshot={
  state:'not_connected'|'restricted'|'not_fetched'|'ready'|'no_data'|'unavailable';from:string|null;to:string|null;checkedAt:string|null;
  queries:number;items:SeoOpportunity[];canRefresh:boolean;
};
