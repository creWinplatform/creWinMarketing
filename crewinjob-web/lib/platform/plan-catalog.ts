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
// Voice rights (ElevenLabs, later), separate from the AI text units above: AI voiceover minutes, voice/phone agent
// minutes and outbound calls a month. 0 in every plan for now. Kept out of PLAN_CATALOG so the catalog the screens and
// the sales terms read stays exactly as it is; plan screens show these only with voice features on and a value above 0.
export type VoicePlanRights = { voiceoverMinutes: number; agentMinutes: number; outboundCalls: number };
export const VOICE_PLAN_RIGHTS: Readonly<Record<OfferedPlanId, Readonly<VoicePlanRights>>> = Object.freeze({
  launch: Object.freeze({ voiceoverMinutes: 0, agentMinutes: 0, outboundCalls: 0 }),
  growth: Object.freeze({ voiceoverMinutes: 0, agentMinutes: 0, outboundCalls: 0 }),
  team: Object.freeze({ voiceoverMinutes: 0, agentMinutes: 0, outboundCalls: 0 }),
});
/** The voice rights a plan screen may show: null while voice features are off or the plan has none. */
export function visibleVoicePlanRights(planId: OfferedPlanId, enabled: boolean): VoicePlanRights | null {
  const rights = VOICE_PLAN_RIGHTS[planId];
  return enabled && rights && (rights.voiceoverMinutes > 0 || rights.agentMinutes > 0 || rights.outboundCalls > 0) ? rights : null;
}
