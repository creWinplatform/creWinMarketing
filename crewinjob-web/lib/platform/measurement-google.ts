import 'server-only';
import { MEASUREMENT_METRICS, type MeasurementDefinition, type MeasurementResult } from './measurement-types';

export type GoogleMeasurementRequest = { provider: 'ga4' | 'search_console'; resource: string; definition: MeasurementDefinition; from: string; to: string; token: string };
export type GoogleMeasurementReader = (input: GoogleMeasurementRequest) => Promise<MeasurementResult>;
const number = (value: unknown) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value))) throw new Error('Invalid provider metric.');
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1e12) throw new Error('Invalid provider metric.');
  return parsed;
};
const timezone = (value: unknown) => {
  if (typeof value !== 'string') throw new Error('Missing property timezone.');
  new Intl.DateTimeFormat('en', { timeZone: value }); return value;
};
export const readGoogleMeasurement: GoogleMeasurementReader = async input => {
  const ga = input.provider === 'ga4';
  if (!['ga4','search_console'].includes(input.provider) || !(MEASUREMENT_METRICS[input.provider] as readonly string[]).includes(input.definition.metric)) throw new Error('Unsupported report metric.');
  if (ga && !/^\d{1,20}$/.test(input.resource)) throw new Error('Invalid property.');
  if (!ga && !/^sc-domain:[a-z0-9.-]+$/i.test(input.resource)) {
    const site = new URL(input.resource);
    if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password || site.hash || site.search) throw new Error('Invalid site.');
  }
  const url = ga ? `https://analyticsdata.googleapis.com/v1beta/properties/${input.resource}:runReport`
    : `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(input.resource)}/searchAnalytics/query`;
  const body = ga ? {
    dateRanges: [{ startDate: input.from, endDate: input.to }], metrics: [{ name: input.definition.metric }], limit: '1', keepEmptyRows: true,
    ...(input.definition.eventName ? { dimensionFilter: { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: input.definition.eventName, caseSensitive: true } } } } : {}),
  } : { startDate: input.from, endDate: input.to, dimensions: ['date'], type: 'web', aggregationType: 'byProperty', dataState: 'final', rowLimit: 32 };
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Provider report unavailable.'); }
  if (Number(response.headers.get('content-length')) > 131072) { await response.body?.cancel(); throw new Error('Provider response too large.'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty response.');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 131072) throw new Error('Provider response too large.'); chunks.push(part.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')), rows = payload.rows || [], checkedAt = new Date().toISOString();
  if (!Array.isArray(rows)) throw new Error('Invalid provider rows.');
  const zone = ga ? timezone(payload.metadata?.timeZone) : 'America/Los_Angeles';
  if (ga) {
    // A filter that matches nothing (e.g. an event name that never fired) comes back as 200 with no rows and no metric headers.
    const empty = !rows.length && payload.metricHeaders === undefined && !Number(payload.rowCount || 0);
    if (!empty && (!Array.isArray(payload.metricHeaders) || payload.metricHeaders.length !== 1 || payload.metricHeaders[0].name !== input.definition.metric || rows.length > 1 || Number(payload.rowCount || 0) > 1)) throw new Error('Invalid report shape.');
    const partial = payload.metadata?.subjectToThresholding === true || payload.metadata?.dataLossFromOtherRow === true || Boolean(payload.metadata?.samplingMetadatas?.length);
    if (!rows.length) return { status: 'no_data', value: null, reason: 'no_rows', rows: 0, timezone: zone, checkedAt };
    if (!Array.isArray(rows[0].metricValues) || rows[0].metricValues.length !== 1) throw new Error('Invalid metric.');
    const value = number(rows[0].metricValues[0].value);
    return { status: partial ? 'partial' : 'ready', value: partial ? null : value, reason: partial ? 'provider_partial' : null, rows: rows.length, timezone: zone, checkedAt };
  }
  if (payload.responseAggregationType !== undefined && payload.responseAggregationType !== 'byProperty' || rows.length && payload.responseAggregationType !== 'byProperty') throw new Error('Unexpected aggregation.');
  if (!rows.length) return { status: 'no_data', value: null, reason: 'no_rows', rows: 0, timezone: zone, checkedAt };
  const dates = new Set<string>(); let value = 0;
  for (const row of rows) {
    const date = row.keys?.[0];
    if (!Array.isArray(row.keys) || row.keys.length !== 1 || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < input.from || date > input.to || dates.has(date)) throw new Error('Invalid report dates.');
    dates.add(date); value += number(row[input.definition.metric]);
  }
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000 + 1, partial = dates.size !== days;
  return { status: partial ? 'partial' : 'ready', value: partial ? null : number(value), reason: partial ? 'coverage' : null, rows: dates.size, timezone: zone, checkedAt };
};

// Sessions and key events per tagged campaign and source (utm_campaign=rz_…, utm_source=channel) for one GA4 property.
// Rows that are not Ryzevo tags are dropped; thresholding, sampling, the "(other)" row or a truncated table make it partial.
export type LinkResultsRequest = { resource: string; from: string; to: string; token: string };
export type LinkResultsReport = { status: 'ready' | 'partial' | 'no_data'; rows: { tag: string; source: string; sessions: number; keyEvents: number }[]; timezone: string; checkedAt: string };
export type LinkResultsReader = (input: LinkResultsRequest) => Promise<LinkResultsReport>;
const LINK_ROW_LIMIT = 1000;
export const readGoogleLinkResults: LinkResultsReader = async input => {
  if (!/^\d{1,20}$/.test(input.resource)) throw new Error('Invalid property.');
  for (const value of [input.from, input.to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid period.');
  const body = {
    dateRanges: [{ startDate: input.from, endDate: input.to }], dimensions: [{ name: 'sessionCampaignName' }, { name: 'sessionSource' }],
    metrics: [{ name: 'sessions' }, { name: 'keyEvents' }], limit: String(LINK_ROW_LIMIT),
    dimensionFilter: { filter: { fieldName: 'sessionCampaignName', stringFilter: { matchType: 'BEGINS_WITH', value: 'rz_', caseSensitive: true } } },
  };
  const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${input.resource}:runReport`, { method: 'POST', headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Provider report unavailable.'); }
  if (Number(response.headers.get('content-length')) > 524288) { await response.body?.cancel(); throw new Error('Provider response too large.'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty response.');
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 524288) throw new Error('Provider response too large.'); chunks.push(part.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')), rows = payload.rows || [], checkedAt = new Date().toISOString(), zone = timezone(payload.metadata?.timeZone);
  if (!Array.isArray(rows) || rows.length > LINK_ROW_LIMIT) throw new Error('Invalid provider rows.');
  if (!rows.length) return { status: 'no_data', rows: [], timezone: zone, checkedAt };
  const names = (headers: unknown) => Array.isArray(headers) ? headers.map(item => (item as { name?: unknown })?.name) : [];
  if (JSON.stringify(names(payload.dimensionHeaders)) !== '["sessionCampaignName","sessionSource"]' || JSON.stringify(names(payload.metricHeaders)) !== '["sessions","keyEvents"]') throw new Error('Invalid report shape.');
  const seen = new Set<string>(), out: LinkResultsReport['rows'] = [];
  let partial = payload.metadata?.subjectToThresholding === true || payload.metadata?.dataLossFromOtherRow === true || Boolean(payload.metadata?.samplingMetadatas?.length) || Number(payload.rowCount || 0) > rows.length;
  for (const row of rows) {
    const keys = row?.dimensionValues, values = row?.metricValues;
    if (!Array.isArray(keys) || keys.length !== 2 || !Array.isArray(values) || values.length !== 2) throw new Error('Invalid report row.');
    const tag = keys[0]?.value, source = keys[1]?.value;
    if (typeof tag !== 'string' || typeof source !== 'string') throw new Error('Invalid report row.');
    if (tag === '(other)') { partial = true; continue; }
    if (!/^rz_[a-f0-9]{10}$/.test(tag) || !/^[a-z0-9._-]{1,40}$/.test(source) || seen.has(`${tag}\n${source}`)) continue;
    seen.add(`${tag}\n${source}`);
    out.push({ tag, source, sessions: number(values[0]?.value), keyEvents: number(values[1]?.value) });
  }
  return { status: partial ? 'partial' : out.length ? 'ready' : 'no_data', rows: out, timezone: zone, checkedAt };
};
