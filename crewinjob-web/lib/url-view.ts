// Sub-view chosen by the address (?view=…, ?section=…), so a link such as the job guide's "Do this step" opens the
// right sub-tab of a legacy Crewin tab. Unknown values fall back to the tab's own default.
export function urlView<T extends string>(allowed: readonly T[], fallback: T, param: 'view' | 'section' = 'view'): T {
  if (typeof window === 'undefined') return fallback;
  const value = new URLSearchParams(window.location.search).get(param);
  return value && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}
export const hasUrlView = (param: 'view' | 'section' = 'view') => typeof window !== 'undefined' && new URLSearchParams(window.location.search).has(param);
