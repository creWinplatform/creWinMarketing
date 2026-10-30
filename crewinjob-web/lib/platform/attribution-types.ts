// First-touch attribution: a product event may report the first tagged link its person arrived through (the snippet keeps
// it in the site's own cookie). Ryzevo then counts, per tagged post or email, the people who went on to reach each goal
// stage. Counts are observed arrivals of people who carried the tag, never credited causes.
export const ATTRIBUTION_WINDOW_DAYS = 90;
export const ATTRIBUTION_LIMITS = { retentionDays: 400, touchDays: 500, rowsPerProject: 200000, items: 50, other: 5 } as const;
export const ATTRIBUTION_PERIODS = [30, 90] as const;
export type AttributionPeriod = typeof ATTRIBUTION_PERIODS[number];
export const ATTRIBUTION_CAMPAIGN = /^[A-Za-z0-9._:-]{1,100}$/;
export const ATTRIBUTION_LABEL = /^[A-Za-z0-9._:-]{1,64}$/;
export const ATTRIBUTION_COOKIE = 'ryz_touch';

export type AttributionTouch = { campaign: string; source: string | null; medium: string | null; touchedAt: string | null };
// One goal stage the team mapped to a product event (Analytics → Automatic measurements), or a bare event name when no
// stage is mapped yet.
export type AttributionStage = { goalId: string | null; stageIndex: number | null; label: { tr: string; en: string }; connectionId: string; eventName: string };
export type AttributionItem = {
  tag: string; kind: 'content' | 'campaign'; id: string; title: string; sources: string[];
  // Sessions GA4 reported for the tag in its own stored period (null when GA4 is not connected or not read yet).
  sessions: number | null;
  counts: number[]; value: number | null;
};
export type AttributionChannel = { source: string; counts: number[]; value: number | null };
export type AttributionOther = { campaign: string; source: string | null; counts: number[] };
export type AttributionCoverage = { entities: number; touched: number; ryzevo: number };
export type AttributionSetup = {
  sources: number; activeSources: number; touches: number; lastTouchAt: string | null; stagesMapped: boolean; canManage: boolean;
};
export type AttributionReport = {
  days: AttributionPeriod; from: string; to: string; windowDays: number;
  setup: AttributionSetup; stages: AttributionStage[];
  items: AttributionItem[]; channels: AttributionChannel[]; other: AttributionOther[]; unmatched: number[];
  // Of the people who reached the first stage in the period: how many carried any first touch, and how many a Ryzevo tag.
  coverage: AttributionCoverage | null;
  value: { currency: string; eventName: string } | null;
  site: { from: string | null; to: string | null };
};
// What one tagged post or email brought, for its card.
export type AttributionTagResult = { stages: { tr: string; en: string }[]; counts: number[]; days: number } | null;
export type AttributionSettingsView = {
  valueConnectionId: string | null; valueEvent: string | null; valueKey: string | null; currency: string | null; updatedAt: string | null;
  canManage: boolean;
  options: { connectionId: string; name: string; eventNames: string[]; numberKeys: string[] }[];
};

// The snippet the team pastes into its own site. It writes nothing until the site's consent banner calls
// ryzevoTouch.allow() (or the tag carries data-consent="granted"), keeps the first touch only and never sends anything.
export const ATTRIBUTION_SNIPPET = `<script data-consent="ask">
/* Ryzevo: keeps the first tagged link a visitor arrived through in your site's own cookie (90 days). */
(function (w, d) {
  var s = d.currentScript, domain = s && s.getAttribute('data-domain');
  var q = new URLSearchParams(w.location.search);
  var clean = function (v, n) { return v && v.length <= n && /^[A-Za-z0-9._:-]+$/.test(v) ? v : null; };
  var campaign = clean(q.get('utm_campaign'), 100);
  var touch = campaign && { campaign: campaign, source: clean(q.get('utm_source'), 64), medium: clean(q.get('utm_medium'), 64), touchedAt: new Date().toISOString() };
  var get = function () { var m = d.cookie.match(/(?:^|;\\s*)${ATTRIBUTION_COOKIE}=([^;]+)/); try { return m ? JSON.parse(decodeURIComponent(m[1])) : null; } catch (e) { return null; } };
  var allow = function () { if (!touch || get()) return; d.cookie = '${ATTRIBUTION_COOKIE}=' + encodeURIComponent(JSON.stringify(touch)) + '; Max-Age=' + 90 * 86400 + '; Path=/; SameSite=Lax; Secure' + (domain ? '; Domain=' + domain : ''); };
  w.ryzevoTouch = { allow: allow, get: get };
  if (s && s.getAttribute('data-consent') === 'granted') allow();
})(window, document);
</script>`;
// How the team's server adds the stored touch to the event it sends when a person signs up.
export const ATTRIBUTION_SERVER_EXAMPLE = `// When a person signs up: read the cookie and send it with the event.
const raw = req.cookies['${ATTRIBUTION_COOKIE}'];
let touch = null;
try { touch = raw ? JSON.parse(decodeURIComponent(raw)) : null; } catch {}
const event = {
  id: 'signup-' + user.id, entityId: user.id, eventName: 'user.signed_up',
  occurredAt: new Date().toISOString(), attributes: { /* your declared attributes */ },
  ...(touch ? { attribution: touch } : {}),
};`;
