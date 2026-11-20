// 2026-11: prices and plan features updated for the design studio, ad tools and the sales assistant (paid periods keep
// the price they were bought at).
export const PLAN_CATALOG_VERSION = '2026-11-v1';
export type OfferedPlanId = 'launch' | 'growth' | 'team';
export const PLAN_CATALOG = Object.freeze([
  // mapsSearches: Google Maps company searches a month (mapsPerDay a day); webQueries: web mention search terms (feeds
  // need Growth or higher); adTools: search ad content, budget suggestion and automatic pausing.
  Object.freeze({ id: 'launch' as const, name: 'Launch', monthlyUsdMinor: 3900, seats: 2, socialAccounts: 3, ai: 50, audits: 10, mapsSearches: 30, mapsPerDay: 10, webQueries: 1, webFeeds: 0, adTools: false, availability: 'planned' as const }),
  Object.freeze({ id: 'growth' as const, name: 'Growth', monthlyUsdMinor: 9900, seats: 5, socialAccounts: 5, ai: 200, audits: 25, mapsSearches: 100, mapsPerDay: 10, webQueries: 3, webFeeds: 5, adTools: true, availability: 'planned' as const }),
  Object.freeze({ id: 'team' as const, name: 'Team', monthlyUsdMinor: 19900, seats: 10, socialAccounts: 10, ai: 500, audits: 50, mapsSearches: 300, mapsPerDay: 20, webQueries: 3, webFeeds: 5, adTools: true, availability: 'later' as const }),
]);
export type PlanCatalogEntry = typeof PLAN_CATALOG[number];
// Agency package: one prepaid period on the agency's own project; it and up to ten linked client projects get Growth rights.
export const AGENCY_PACKAGE = Object.freeze({ id: 'agency' as const, name: 'Agency', monthlyUsdMinor: 39900, projects: 10, plan: 'growth' as const });
// A running trial tries the Growth tools with small allowances; pilot projects (set up with our team) get Growth's.
export const TRIAL_FEATURES = Object.freeze({ mapsSearches: 5, mapsPerDay: 2, webQueries: 1, webFeeds: 0, adTools: true });
