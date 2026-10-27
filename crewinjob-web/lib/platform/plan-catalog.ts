export const PLAN_CATALOG_VERSION = '2026-10-v1';
export type OfferedPlanId = 'launch' | 'growth' | 'team';
export const PLAN_CATALOG = Object.freeze([
  Object.freeze({ id: 'launch' as const, name: 'Launch', monthlyUsdMinor: 2900, seats: 2, socialAccounts: 3, ai: 50, audits: 10, availability: 'planned' as const }),
  Object.freeze({ id: 'growth' as const, name: 'Growth', monthlyUsdMinor: 7900, seats: 5, socialAccounts: 5, ai: 200, audits: 25, availability: 'planned' as const }),
  Object.freeze({ id: 'team' as const, name: 'Team', monthlyUsdMinor: 14900, seats: 10, socialAccounts: 10, ai: 500, audits: 50, availability: 'later' as const }),
]);
export type PlanCatalogEntry = typeof PLAN_CATALOG[number];
// Agency package: one prepaid period on the agency's own project; it and up to ten linked client projects get Growth rights.
export const AGENCY_PACKAGE = Object.freeze({ id: 'agency' as const, name: 'Agency', monthlyUsdMinor: 29900, projects: 10, plan: 'growth' as const });
