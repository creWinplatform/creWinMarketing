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
export type SeoScanView={id:string;origin:string;source:'sitemap'|'homepage_links';discovered:number;state:'running'|'completed'|'cancelled';startedVia:'manual'|'schedule';
  startedAt:string;finishedAt:string|null;pages:{total:number;done:number;failed:number;pending:number;skipped:number}};
export type SeoOperationsSnapshot={
  origin:string|null;scan:SeoScanView|null;counts:Record<SeoFindingState,number>;findings:SeoFindingView[];
  maxPages:number;canWrite:boolean;schedule:SeoScheduleView;
};
// Scheduled scans run as the member who set them, from the plan's audit quota; new findings become team alerts.
export const SEO_SCHEDULE_DAYS={weekly:7,monthly:30} as const;
export type SeoScheduleView={cadence:'weekly'|'monthly'|null;nextAt:string|null;lastStartedAt:string|null;lastError:string|null;ownedByYou:boolean};
// Weekly Search Console totals: the last 7 complete days against the 7 before. A drop is a fixed rule, not a forecast.
export const SEARCH_DROP={minPreviousClicks:20,ratio:0.7} as const;
export const searchDropped=(clicks:number|null,previous:number|null)=>clicks!==null&&previous!==null&&previous>=SEARCH_DROP.minPreviousClicks&&clicks<=previous*SEARCH_DROP.ratio;
export type SeoSearchWatchView={
  state:'not_connected'|'restricted'|'not_scheduled'|'not_checked'|'ready'|'no_data'|'unavailable';
  currentFrom:string|null;currentTo:string|null;clicks:number|null;impressions:number|null;previousClicks:number|null;previousImpressions:number|null;checkedAt:string|null;drop:boolean;
};
// Search Console opportunities: fixed editorial rules over the stored query snapshot; no prediction or uplift.
export type SeoOpportunity={query:string;clicks:number;impressions:number;ctr:number;position:number;kind:'near_first_page'|'low_ctr'};
export type SeoOpportunitiesSnapshot={
  state:'not_connected'|'restricted'|'not_fetched'|'ready'|'no_data'|'unavailable';from:string|null;to:string|null;checkedAt:string|null;
  queries:number;items:SeoOpportunity[];canRefresh:boolean;watch:SeoSearchWatchView;
};
