'use client';
import { useState, useEffect, useCallback } from 'react';
import { useLang } from '@/lib/lang';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';

type Range = '7' | '30' | '90';
type Lang = 'tr' | 'en';

// TR/EN metin seçici ve sayı/tarih yerel ayarı
const L = (lang: Lang, tr: string, en: string) => lang === 'tr' ? tr : en;
const localeOf = (lang: Lang) => localeTag(lang);
// Backend boş hata döndürdüğünde render sırasında çevrilen yer tutucu
const UNKNOWN_ERROR = '__unknown__';

// ── GA4 Types ─────────────────────────────────────────────────────────────────

interface GA4MetricValue    { value: string; }
interface GA4DimensionValue { value: string; }
interface GA4Row { dimensionValues: GA4DimensionValue[]; metricValues: GA4MetricValue[]; }
interface GA4Report { rows?: GA4Row[]; }

interface Overview {
  sessions: number; activeUsers: number; newUsers: number;
  bounceRate: number; avgDuration: number; engagementRate: number;
}
interface PrevOv { sessions: number; activeUsers: number; newUsers: number; bounceRate: number; avgDuration: number; }
interface DayRow { date: string; sessions: number; users: number; }
interface BarRow  { name: string; value: number; sub?: number; }

interface AnalyticsResponse {
  ok: boolean; notConfigured?: boolean; error?: string; fetchedAt?: string;
  overview?: GA4Report; prevOverview?: GA4Report; topPages?: GA4Report;
  countries?: GA4Report; cities?: GA4Report; sources?: GA4Report;
  devices?: GA4Report; daily?: GA4Report;
  campaigns?: GA4Report;
}

// ── GSC Types ─────────────────────────────────────────────────────────────────

interface GscRow  { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number; }
interface GscReport { rows?: GscRow[]; }

interface GscOverview { clicks: number; impressions: number; ctr: number; position: number; }

interface GscResponse {
  ok: boolean; notConfigured?: boolean; error?: string; fetchedAt?: string;
  overview?: GscReport; queries?: GscReport; pages?: GscReport; daily?: GscReport;
}

// ── Crewin growth report types ────────────────────────────────────────────────

interface AcquisitionSummary {
  registrations?: number;
  attributedRegistrations?: number;
  unattributedRegistrations?: number;
  startedProfiles?: number;
  activatedSeafarers?: number;
  completedProfiles?: number;
  activationRate?: number;
}

interface BreakdownRow {
  key?: string;
  label?: string;
  name?: string;
  registrations?: number;
  activatedSeafarers?: number;
  activationRate?: number;
  percentage?: number;
  count?: number;
}

interface AcquisitionRow extends AcquisitionSummary {
  countryCode?: string;
  countryName?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  campaignId?: string;
}

interface AcquisitionResult extends AcquisitionSummary {
  summary?: AcquisitionSummary;
  items?: AcquisitionRow[];
  periods?: AcquisitionRow[];
  sourceBreakdown?: BreakdownRow[];
  mediumBreakdown?: BreakdownRow[];
  campaignBreakdown?: BreakdownRow[];
  countryBreakdown?: BreakdownRow[];
  totalCount?: number;
  dataNote?: string;
  isHistorical?: boolean;
}

interface ActivationTrendRow extends AcquisitionSummary {
  date?: string;
  day?: string;
}

interface ActivationTrendResult {
  items?: ActivationTrendRow[];
  totalCount?: number;
  dataNote?: string;
  isHistorical?: boolean;
  totalRegistrations?: number;
  totalActivatedSeafarers?: number;
  activationRate?: number;
}

interface GrowthResponse<T> {
  available: boolean;
  reason?: 'backend_not_ready' | 'backend_error' | 'permission_denied' | 'authentication_required' | 'rate_limited';
  error?: string;
  result?: T;
}

interface GrowthFilters {
  from: string;
  to: string;
  interval: 'day' | 'week' | 'month';
  source: string;
  medium: string;
  campaign: string;
  countryCode: string;
}

// ── GA4 Parsers ───────────────────────────────────────────────────────────────

function parseOv(d: GA4Report | null | undefined): Overview | null {
  if (!d?.rows?.[0]) return null;
  const v = d.rows[0].metricValues;
  return {
    sessions:       +v[0].value,
    activeUsers:    +v[1].value,
    newUsers:       +v[2].value,
    bounceRate:     +(+v[3].value * 100).toFixed(1),
    avgDuration:    +v[4].value,
    engagementRate: v[5] ? +(+v[5].value * 100).toFixed(1) : 0,
  };
}

function parsePrevOv(d: GA4Report | null | undefined): PrevOv | null {
  if (!d?.rows?.[0]) return null;
  const v = d.rows[0].metricValues;
  return {
    sessions:    +v[0].value, activeUsers: +v[1].value, newUsers: +v[2].value,
    bounceRate:  +(+v[3].value * 100).toFixed(1), avgDuration: +v[4].value,
  };
}

function parseRows(d: GA4Report | null | undefined, limit = 10): BarRow[] {
  if (!d?.rows) return [];
  return d.rows.slice(0, limit).map(r => ({
    name:  r.dimensionValues[0].value,
    value: +r.metricValues[0].value,
    sub:   r.metricValues[1] ? +r.metricValues[1].value : undefined,
  }));
}

function parseDailyTrend(d: GA4Report | null | undefined): DayRow[] {
  if (!d?.rows) return [];
  return d.rows.map(r => {
    const raw = r.dimensionValues[0].value;
    return {
      date: `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`,
      sessions: +r.metricValues[0].value,
      users:    +r.metricValues[1].value,
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

// ── GSC Parsers ───────────────────────────────────────────────────────────────

function parseGscOverview(d: GscReport | null | undefined): GscOverview | null {
  if (!d?.rows?.[0]) return null;
  const r = d.rows[0];
  return {
    clicks:      r.clicks,
    impressions: r.impressions,
    ctr:         +(r.ctr * 100).toFixed(1),
    position:    +r.position.toFixed(1),
  };
}

function parseGscRows(d: GscReport | null | undefined, limit = 10) {
  if (!d?.rows) return [];
  return d.rows.slice(0, limit).map(r => ({
    key:         r.keys?.[0] ?? '—',
    clicks:      r.clicks,
    impressions: r.impressions,
    ctr:         +(r.ctr * 100).toFixed(1),
    position:    +r.position.toFixed(1),
  }));
}

function parseGscDaily(d: GscReport | null | undefined) {
  if (!d?.rows) return [];
  return d.rows.map(r => ({
    date:        r.keys?.[0] ?? '',
    clicks:      r.clicks,
    impressions: r.impressions,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, lang: Lang = 'tr') { return n.toLocaleString(localeOf(lang)); }
function fmtOptional(n: number | undefined, lang: Lang = 'tr') { return n === undefined ? '–' : fmt(n, lang); }
function pct(n: number, lang: Lang = 'tr') {
  const value = n.toLocaleString(localeOf(lang), { maximumFractionDigits: 1 });
  return lang === 'tr' ? `%${value}` : `${value}%`;
}
function pctOptional(n: number | undefined, lang: Lang = 'tr') {
  return n === undefined ? '–' : pct(n, lang);
}

function rangeFilters(range: Range): GrowthFilters {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - Number(range) + 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    interval: 'day',
    source: '',
    medium: '',
    campaign: '',
    countryCode: '',
  };
}
function fmtDur(s: number, lang: Lang = 'tr') {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return lang === 'tr' ? `${m}dk ${sec}s` : `${m}m ${sec}s`;
}
function fmtTime(iso: string, lang: Lang = 'tr') {
  return new Date(iso).toLocaleTimeString(localeOf(lang), { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(value: string | undefined, lang: Lang = 'tr') {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(localeOf(lang));
}
function pctChange(curr: number, prev: number): { val: number; up: boolean } | null {
  if (!prev) return null;
  return { val: Math.round(((curr - prev) / prev) * 100), up: curr >= prev };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <div className="border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin"
      style={{ width: size * 4, height: size * 4 }} />
  );
}

function ChangeBadge({ curr, prev, invert = false, lang }: { curr: number; prev: number; invert?: boolean; lang: Lang }) {
  const ch = pctChange(curr, prev);
  if (!ch) return null;
  const good = invert ? !ch.up : ch.up;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ${
      good ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
           : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
      {ch.up ? '↑' : '↓'}{pct(Math.abs(ch.val), lang)}
    </span>
  );
}

function MetricCard({
  label, value, curr, prev, invert = false, accent = false, lang,
}: {
  label: string; value: string; lang: Lang;
  curr?: number; prev?: number; invert?: boolean; accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-3 sm:p-4 ${
      accent
        ? 'bg-blue-600 border-blue-500 text-white'
        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
      <div className={`text-xs mb-1 leading-tight ${accent ? 'text-blue-200' : 'text-slate-500 dark:text-slate-400'}`}>
        {label}
      </div>
      <div className={`text-xl sm:text-2xl font-bold leading-none ${accent ? 'text-white' : 'text-slate-900 dark:text-slate-100'}`}>
        {value}
      </div>
      {curr !== undefined && prev !== undefined && (
        <div className="mt-1.5 h-5 flex items-center">
          <ChangeBadge curr={curr} prev={prev} invert={invert} lang={lang} />
        </div>
      )}
    </div>
  );
}

function SmallMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 sm:p-4">
      <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">{label}</div>
      <div className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 leading-none">{value}</div>
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

function BarList({ rows, label, color = 'bg-blue-500', lang }: { rows: BarRow[]; label: string; color?: string; lang: Lang }) {
  if (!rows.length) return <div className="text-sm text-slate-400 py-4 text-center">{L(lang, 'Veri yok', 'No data')}</div>;
  const unknown = L(lang, '(bilinmiyor)', '(unknown)');
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-xs mb-1 gap-2">
            <span className="truncate text-slate-700 dark:text-slate-300 min-w-0" title={r.name || unknown}>
              {r.name || unknown}
            </span>
            <span className="text-slate-500 shrink-0 font-medium">{fmt(r.value, lang)}</span>
          </div>
          <div className="bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
            <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          {r.sub !== undefined && (
            <div className="text-xs text-slate-400 mt-0.5 text-right">{fmtDur(r.sub, lang)}</div>
          )}
        </div>
      ))}
      {rows.length > 0 && <div className="text-xs text-slate-400 pt-0.5 text-right">{label}</div>}
    </div>
  );
}

const DEVICE_LABELS: Record<string, [string, string]> = { mobile: ['Mobil', 'Mobile'], desktop: ['Masaüstü', 'Desktop'], tablet: ['Tablet', 'Tablet'] };
const DEVICE_ICONS:  Record<string, string> = { mobile: '📱', desktop: '💻', tablet: '📟' };
const DEVICE_COLORS = ['bg-blue-500', 'bg-indigo-500', 'bg-violet-500'];

function DeviceBars({ rows, lang }: { rows: BarRow[]; lang: Lang }) {
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  return (
    <div className="space-y-2">
      {rows.map((r, i) => {
        const share = Math.round((r.value / total) * 100);
        const key = r.name.toLowerCase();
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span>{DEVICE_ICONS[key] ?? '🖥️'}</span>
            <span className="text-slate-600 dark:text-slate-400 w-20 shrink-0">{DEVICE_LABELS[key]?.[lang === 'tr' ? 0 : 1] ?? r.name}</span>
            <div className="flex-1 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 min-w-0">
              <div className={`${DEVICE_COLORS[i] ?? 'bg-slate-400'} h-1.5 rounded-full`} style={{ width: `${share}%` }} />
            </div>
            <span className="text-slate-500 w-8 text-right shrink-0 font-medium">{pct(share, lang)}</span>
          </div>
        );
      })}
    </div>
  );
}

function AreaChart({ data, lang }: { data: DayRow[]; lang: Lang }) {
  if (data.length < 2) return (
    <div className="h-28 flex items-center justify-center text-sm text-slate-400">{L(lang, 'Yeterli veri yok', 'Not enough data')}</div>
  );
  const W = 700, H = 110, PX = 4, PY = 10;
  const maxVal = Math.max(...data.map(d => Math.max(d.sessions, d.users)), 1);
  const tx = (i: number) => PX + (i / (data.length - 1)) * (W - PX * 2);
  const ty = (v: number) => PY + (H - PY * 2) * (1 - v / maxVal);
  const sPts = data.map((d, i) => `${tx(i).toFixed(1)},${ty(d.sessions).toFixed(1)}`).join(' ');
  const uPts = data.map((d, i) => `${tx(i).toFixed(1)},${ty(d.users).toFixed(1)}`).join(' ');
  const sArea = [`${tx(0).toFixed(1)},${(H - PY).toFixed(1)}`, sPts, `${tx(data.length - 1).toFixed(1)},${(H - PY).toFixed(1)}`].join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 110 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="ga-area-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f, i) => (
        <line key={i} x1={PX} y1={ty(maxVal * f).toFixed(1)} x2={W - PX} y2={ty(maxVal * f).toFixed(1)}
          stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
      ))}
      <polygon points={sArea} fill="url(#ga-area-grad)" />
      <polyline fill="none" stroke="#3b82f6" strokeWidth="2" points={sPts} strokeLinejoin="round" strokeLinecap="round" />
      <polyline fill="none" stroke="#22c55e" strokeWidth="1.5" strokeDasharray="5 3" points={uPts} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function GscMiniChart({ data }: { data: { date: string; clicks: number; impressions: number }[] }) {
  if (data.length < 2) return null;
  const W = 700, H = 70, PX = 4, PY = 6;
  const maxC = Math.max(...data.map(d => d.clicks), 1);
  const maxI = Math.max(...data.map(d => d.impressions), 1);
  const tx = (i: number) => PX + (i / (data.length - 1)) * (W - PX * 2);
  const tyC = (v: number) => PY + (H - PY * 2) * (1 - v / maxC);
  const tyI = (v: number) => PY + (H - PY * 2) * (1 - v / maxI);
  const cPts = data.map((d, i) => `${tx(i).toFixed(1)},${tyC(d.clicks).toFixed(1)}`).join(' ');
  const iPts = data.map((d, i) => `${tx(i).toFixed(1)},${tyI(d.impressions).toFixed(1)}`).join(' ');
  const cArea = [`${tx(0).toFixed(1)},${(H - PY).toFixed(1)}`, cPts, `${tx(data.length-1).toFixed(1)},${(H-PY).toFixed(1)}`].join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 70 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="gsc-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={cArea} fill="url(#gsc-grad)" />
      <polyline fill="none" stroke="#f97316" strokeWidth="2" points={cPts} strokeLinejoin="round" />
      <polyline fill="none" stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" points={iPts} strokeLinejoin="round" />
    </svg>
  );
}

function QueryTable({ rows, lang }: { rows: ReturnType<typeof parseGscRows>; lang: Lang }) {
  if (!rows.length) return <div className="text-sm text-slate-400 py-4 text-center">{L(lang, 'Veri yok', 'No data')}</div>;
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-400 border-b border-slate-100 dark:border-slate-700">
            <th className="text-left py-2 px-1 font-medium">{L(lang, 'Arama sorgusu', 'Search query')}</th>
            <th className="text-right py-2 px-1 font-medium">{L(lang, 'Tıklama', 'Clicks')}</th>
            <th className="text-right py-2 px-1 font-medium">{L(lang, 'Gösterim', 'Impressions')}</th>
            <th className="text-right py-2 px-1 font-medium">CTR</th>
            <th className="text-right py-2 px-1 font-medium">{L(lang, 'Pozisyon', 'Position')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
              <td className="py-2 px-1 text-slate-700 dark:text-slate-300 max-w-[200px] truncate" title={r.key}>{r.key}</td>
              <td className="py-2 px-1 text-right font-medium text-slate-800 dark:text-slate-200">{fmt(r.clicks, lang)}</td>
              <td className="py-2 px-1 text-right text-slate-500">{fmt(r.impressions, lang)}</td>
              <td className="py-2 px-1 text-right text-slate-500">{pct(r.ctr, lang)}</td>
              <td className="py-2 px-1 text-right">
                <span className={`font-medium ${r.position <= 3 ? 'text-green-600 dark:text-green-400' : r.position <= 10 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`}>
                  #{fmt(r.position, lang)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageClickList({ rows, lang }: { rows: ReturnType<typeof parseGscRows>; lang: Lang }) {
  if (!rows.length) return <div className="text-sm text-slate-400 py-4 text-center">{L(lang, 'Veri yok', 'No data')}</div>;
  const max = Math.max(...rows.map(r => r.clicks), 1);
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-xs mb-1 gap-2">
            <span className="truncate text-slate-700 dark:text-slate-300 min-w-0" title={r.key}>{r.key}</span>
            <span className="text-slate-500 shrink-0 font-medium">{fmt(r.clicks, lang)}</span>
          </div>
          <div className="bg-slate-100 dark:bg-slate-700 rounded-full h-1.5">
            <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${(r.clicks / max) * 100}%` }} />
          </div>
        </div>
      ))}
      <div className="text-xs text-slate-400 pt-0.5 text-right">{L(lang, 'tıklama', 'clicks')}</div>
    </div>
  );
}

function BreakdownList({ title, rows, lang }: { title: string; rows: BreakdownRow[]; lang: Lang }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map(row => Number(row.registrations ?? row.count ?? 0)), 1);
  return (
    <div className="min-w-0">
      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">{title}</h4>
      <div className="space-y-2">
        {rows.slice(0, 8).map((row, index) => {
          const value = Number(row.registrations ?? row.count ?? 0);
          const label = row.label || row.name || row.key || L(lang, 'Bilinmiyor', 'Unknown');
          return <div key={`${label}-${index}`}><div className="flex justify-between gap-3 text-xs"><span className="truncate text-slate-600 dark:text-slate-300" title={label}>{label}</span><span className="shrink-0 text-slate-500">{fmt(value, lang)}{row.activationRate !== undefined ? ` · ${pctOptional(row.activationRate, lang)}` : ''}</span></div><div className="h-1.5 bg-slate-100 dark:bg-slate-700 mt-1 overflow-hidden"><div className="h-1.5 bg-cyan-500" style={{ width: `${value > 0 ? Math.max(value / max * 100, 2) : 0}%` }} /></div></div>;
        })}
      </div>
    </div>
  );
}

function GrowthReports({
  acquisition,
  activationTrend,
  loading,
  error,
  filters,
  onFiltersChange,
  onApply,
  onClear,
  lang,
}: {
  lang: Lang;
  acquisition: GrowthResponse<AcquisitionResult> | null;
  activationTrend: GrowthResponse<ActivationTrendResult> | null;
  loading: boolean;
  error: string;
  filters: GrowthFilters;
  onFiltersChange: (filters: GrowthFilters) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const acquisitionResult = acquisition?.available ? acquisition.result : undefined;
  const summary = acquisitionResult?.summary || acquisitionResult;
  const rows = acquisitionResult?.items || [];
  const trendRows = activationTrend?.available ? activationTrend.result?.items || [] : [];
  // "Profil başlatan" yalnızca backend bu alanı döndürüyorsa gösterilir (GetActivationTrend sözleşmesinde yok)
  const hasStartedProfiles = trendRows.some(row => typeof row.startedProfiles === 'number');
  const backendReady = Boolean(acquisition?.available || activationTrend?.available);
  const waitingForBackend = acquisition?.reason === 'backend_not_ready' && activationTrend?.reason === 'backend_not_ready';
  const funnel = summary ? [
    { label: L(lang, 'Kayıt', 'Registrations'), value: summary.registrations, color: 'bg-blue-500' },
    { label: L(lang, 'Attribution bulunan', 'Attributed'), value: summary.attributedRegistrations, color: 'bg-cyan-500' },
    { label: L(lang, 'Activated Seafarer', 'Activated seafarers'), value: summary.activatedSeafarers, color: 'bg-green-500' },
  ].filter((stage): stage is { label: string; value: number; color: string } => stage.value !== undefined) : [];
  const funnelMax = Math.max(funnel[0]?.value || 0, 1);

  return (
    <section className="border-t border-slate-200 dark:border-slate-700 pt-5 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{L(lang, 'Edinimden aktivasyona', 'Acquisition to activation')}</h3>
        {loading && <Spinner size={3} />}
        {!loading && backendReady && <span className="text-xs text-green-600 dark:text-green-400">{L(lang, 'Crewin verisi', 'Crewin data')}</span>}
        {!loading && acquisition?.reason === 'backend_not_ready' && activationTrend?.available && <span className="text-xs text-amber-600 dark:text-amber-400">{L(lang, 'Edinim raporu backend bekliyor', 'Acquisition report awaiting backend')}</span>}
        {!loading && activationTrend?.reason === 'backend_not_ready' && acquisition?.available && <span className="text-xs text-amber-600 dark:text-amber-400">{L(lang, 'Trend raporu backend bekliyor', 'Trend report awaiting backend')}</span>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-2">
        <input type="date" aria-label={L(lang, 'Başlangıç tarihi', 'Start date')} value={filters.from} onChange={event => onFiltersChange({ ...filters, from: event.target.value })} className="col-span-1 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-2 py-2 text-xs" />
        <input type="date" aria-label={L(lang, 'Bitiş tarihi', 'End date')} value={filters.to} onChange={event => onFiltersChange({ ...filters, to: event.target.value })} className="col-span-1 border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-2 py-2 text-xs" />
        <select aria-label={L(lang, 'Rapor aralığı', 'Report interval')} value={filters.interval} onChange={event => onFiltersChange({ ...filters, interval: event.target.value as GrowthFilters['interval'] })} className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-2 py-2 text-xs"><option value="day">{L(lang, 'Günlük', 'Daily')}</option><option value="week">{L(lang, 'Haftalık', 'Weekly')}</option><option value="month">{L(lang, 'Aylık', 'Monthly')}</option></select>
        <input aria-label={L(lang, 'Kaynak', 'Source')} value={filters.source} onChange={event => onFiltersChange({ ...filters, source: event.target.value })} placeholder={L(lang, 'Kaynak', 'Source')} className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-2 py-2 text-xs" />
        <input aria-label="Medium" value={filters.medium} onChange={event => onFiltersChange({ ...filters, medium: event.target.value })} placeholder="Medium" className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-2 py-2 text-xs" />
        <input aria-label={L(lang, 'Kampanya', 'Campaign')} value={filters.campaign} onChange={event => onFiltersChange({ ...filters, campaign: event.target.value })} placeholder={L(lang, 'Kampanya', 'Campaign')} className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-2 py-2 text-xs" />
        <input aria-label={L(lang, 'Ülke kodu', 'Country code')} value={filters.countryCode} onChange={event => onFiltersChange({ ...filters, countryCode: event.target.value.toUpperCase() })} placeholder={L(lang, 'Ülke (TR)', 'Country (TR)')} maxLength={3} className="border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-2 py-2 text-xs" />
        <div className="flex gap-1"><button type="button" onClick={onApply} disabled={loading || !filters.from || !filters.to} className="flex-1 bg-blue-600 text-white rounded-lg px-2 py-2 text-xs font-medium disabled:opacity-50">{L(lang, 'Uygula', 'Apply')}</button><button type="button" onClick={onClear} disabled={loading} className="border border-slate-300 dark:border-slate-600 text-slate-500 rounded-lg px-2 py-2 text-xs disabled:opacity-50" title={L(lang, 'Filtreleri temizle', 'Clear filters')}>{L(lang, 'Temizle', 'Clear')}</button></div>
      </div>

      {waitingForBackend && !loading && (
        <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 rounded-lg">
          {L(lang,
            'Crewin edinim ve aktivasyon raporları backend yayını tamamlandığında bu bölüm otomatik dolacak. GA4 UTM performansı çalışmaya devam ediyor.',
            'This section fills in once the Crewin acquisition and activation reports are live on the backend. GA4 UTM performance keeps working.')}
        </div>
      )}
      {error && !loading && (
        <div className="border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 rounded-lg"><Msg text={error} /></div>
      )}

      {summary && acquisition?.available && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <SmallMetric label={L(lang, 'Kayıt', 'Registrations')} value={fmtOptional(summary.registrations, lang)} />
            <SmallMetric label={L(lang, 'Attribution var', 'Attributed')} value={fmtOptional(summary.attributedRegistrations, lang)} />
            <SmallMetric label={L(lang, 'Attribution yok', 'Unattributed')} value={fmtOptional(summary.unattributedRegistrations, lang)} />
            <SmallMetric label={L(lang, 'Activated Seafarer', 'Activated seafarers')} value={fmtOptional(summary.activatedSeafarers, lang)} />
            <SmallMetric label={L(lang, 'Aktivasyon oranı', 'Activation rate')} value={pctOptional(summary.activationRate, lang)} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 border-y border-slate-200 dark:border-slate-700 py-4">
            {funnel.map(stage => <div key={stage.label} className="min-w-0"><div className="flex justify-between gap-2 text-xs mb-2"><span className="text-slate-500 dark:text-slate-400 truncate">{stage.label}</span><b className="text-slate-800 dark:text-slate-100">{fmt(stage.value, lang)}</b></div><div className="h-2 bg-slate-100 dark:bg-slate-700 overflow-hidden"><div className={`h-2 ${stage.color}`} style={{ width: `${stage.value > 0 ? Math.max((stage.value / funnelMax) * 100, 2) : 0}%` }} /></div></div>)}
          </div>
        </>
      )}

      {(acquisitionResult?.dataNote || activationTrend?.result?.dataNote) && (
        <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
          {acquisitionResult?.dataNote && <p><Msg text={acquisitionResult.dataNote} /></p>}
          {activationTrend?.result?.dataNote && activationTrend.result.dataNote !== acquisitionResult?.dataNote && <p><Msg text={activationTrend.result.dataNote} /></p>}
        </div>
      )}

      {activationTrend?.available && activationTrend.result?.isHistorical === false && (
        <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 rounded-lg">{L(lang, 'Bu dönem için aktivasyon verisi mevcut profil durumundan yaklaşık olarak hesaplanmıştır.', 'Activation data for this period is approximated from current profile status.')}</div>
      )}

      {acquisition?.available && acquisitionResult && (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-5 border-y border-slate-200 dark:border-slate-700 py-4">
          <BreakdownList lang={lang} title={L(lang, 'Kaynaklar', 'Sources')} rows={acquisitionResult.sourceBreakdown || []} />
          <BreakdownList lang={lang} title="Medium" rows={acquisitionResult.mediumBreakdown || []} />
          <BreakdownList lang={lang} title={L(lang, 'Kampanyalar', 'Campaigns')} rows={acquisitionResult.campaignBreakdown || []} />
          <BreakdownList lang={lang} title={L(lang, 'Ülkeler', 'Countries')} rows={acquisitionResult.countryBreakdown || []} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto border-y border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-400"><th className="py-2 px-2">{L(lang, 'Ülke', 'Country')}</th><th className="py-2 px-2">{L(lang, 'Kaynak / Medium', 'Source / Medium')}</th><th className="py-2 px-2">{L(lang, 'Kampanya', 'Campaign')}</th><th className="py-2 px-2 text-right">{L(lang, 'Kayıt', 'Registrations')}</th><th className="py-2 px-2 text-right">{L(lang, 'Aktive', 'Activated')}</th><th className="py-2 px-2 text-right">{L(lang, 'Oran', 'Rate')}</th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={`${row.countryCode || ''}-${row.source || ''}-${row.campaignId || row.campaign || index}`} className="border-t border-slate-100 dark:border-slate-800"><td className="py-2 px-2 text-slate-700 dark:text-slate-200">{row.countryName || row.countryCode || L(lang, 'Bilinmiyor', 'Unknown')}</td><td className="py-2 px-2 text-slate-600 dark:text-slate-300">{row.source || '(direct)'} / {row.medium || '(none)'}</td><td className="py-2 px-2 text-slate-600 dark:text-slate-300">{row.campaign || row.campaignId || '-'}</td><td className="py-2 px-2 text-right">{fmt(row.registrations || 0, lang)}</td><td className="py-2 px-2 text-right">{fmt(row.activatedSeafarers || 0, lang)}</td><td className="py-2 px-2 text-right">{pct(Number(row.activationRate || 0), lang)}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      {trendRows.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">{L(lang, 'Aktivasyon trendi', 'Activation trend')}</div>
          <div className="overflow-x-auto border-y border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-400"><th className="py-2 px-2">{L(lang, 'Tarih', 'Date')}</th><th className="py-2 px-2 text-right">{L(lang, 'Kayıt', 'Registrations')}</th>{hasStartedProfiles && <th className="py-2 px-2 text-right">{L(lang, 'Profil başlatan', 'Started profiles')}</th>}<th className="py-2 px-2 text-right">{L(lang, 'Aktive', 'Activated')}</th><th className="py-2 px-2 text-right">{L(lang, 'Oran', 'Rate')}</th></tr></thead>
              <tbody>{trendRows.map((row, index) => <tr key={row.date || row.day || index} className="border-t border-slate-100 dark:border-slate-800"><td className="py-2 px-2 text-slate-700 dark:text-slate-200">{fmtDate(row.date || row.day, lang)}</td><td className="py-2 px-2 text-right">{fmtOptional(row.registrations, lang)}</td>{hasStartedProfiles && <td className="py-2 px-2 text-right">{fmtOptional(row.startedProfiles, lang)}</td>}<td className="py-2 px-2 text-right">{fmtOptional(row.activatedSeafarers, lang)}</td><td className="py-2 px-2 text-right">{pctOptional(row.activationRate, lang)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Setup guide ───────────────────────────────────────────────────────────────

const SETUP_STEPS: Array<{ step: string; title: [string, string]; desc: [string, string] }> = [
  { step: '1', title: ['Google Cloud service account oluştur', 'Create a Google Cloud service account'], desc: ['console.cloud.google.com → IAM → Service Accounts → Yeni hesap oluştur', 'console.cloud.google.com → IAM → Service Accounts → Create account'] },
  { step: '2', title: ['Analytics Viewer rolü ver', 'Grant the Analytics Viewer role'],                  desc: ['GA4 Admin → Mülk erişim yönetimi → Hesabı ekle → Viewer rolü seç', 'GA4 Admin → Property access management → Add account → choose Viewer'] },
  { step: '3', title: ['JSON key indir', 'Download the JSON key'],                                       desc: ['Service Account → Keys → Add Key → JSON → indir', 'Service Account → Keys → Add Key → JSON → download'] },
  { step: '4', title: ['GA4 Property ID al', 'Get the GA4 property ID'],                                 desc: ['GA4 Admin → Mülk → Mülk bilgileri → Property ID (sadece rakamlar, G- değil)', 'GA4 Admin → Property → Property details → Property ID (digits only, not G-)'] },
  { step: '5', title: [".env.local'a ekle", 'Add to .env.local'],                                        desc: ["GOOGLE_SERVICE_ACCOUNT_JSON='{\"type\":\"service_account\",...}'\nGA4_PROPERTY_ID=123456789", "GOOGLE_SERVICE_ACCOUNT_JSON='{\"type\":\"service_account\",...}'\nGA4_PROPERTY_ID=123456789"] },
];

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AnalyticsTab() {
  const { lang } = useLang();
  const [range, setRange]       = useState<Range>('30');
  const [data, setData]         = useState<AnalyticsResponse | null>(null);
  const [gscData, setGscData]   = useState<GscResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [gscLoading, setGscLoading] = useState(true);
  const [error, setError]       = useState('');
  const [gscError, setGscError] = useState('');
  const [acquisition, setAcquisition] = useState<GrowthResponse<AcquisitionResult> | null>(null);
  const [activationTrend, setActivationTrend] = useState<GrowthResponse<ActivationTrendResult> | null>(null);
  const [growthLoading, setGrowthLoading] = useState(true);
  const [growthError, setGrowthError] = useState('');
  const [growthFilters, setGrowthFilters] = useState<GrowthFilters>(() => rangeFilters('30'));
  const [appliedGrowthFilters, setAppliedGrowthFilters] = useState<GrowthFilters>(() => rangeFilters('30'));

  const loadGa4 = useCallback(async (r: Range) => {
    setLoading(true); setError('');
    try {
      const res  = await fetch(`/api/analytics?range=${r}`);
      const json = await res.json() as AnalyticsResponse;
      setData(json);
      if (!json.ok && !json.notConfigured) setError(json.error || (res.ok ? UNKNOWN_ERROR : `HTTP ${res.status}`));
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  const loadGsc = useCallback(async (r: Range) => {
    setGscLoading(true); setGscError('');
    try {
      const res  = await fetch(`/api/search-console?range=${r}`);
      const json = await res.json() as GscResponse;
      setGscData(json);
      if (!json.ok && !json.notConfigured) setGscError(json.error || (res.ok ? UNKNOWN_ERROR : `HTTP ${res.status}`));
    } catch (e) { setGscError((e as Error).message); }
    finally { setGscLoading(false); }
  }, []);

  const loadGrowth = useCallback(async (filters: GrowthFilters) => {
    setGrowthLoading(true); setGrowthError('');
    const query = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      interval: filters.interval,
      skip: '0',
      take: '100',
    });
    for (const key of ['source', 'medium', 'campaign', 'countryCode'] as const) {
      if (filters[key].trim()) query.set(key, filters[key].trim());
    }
    try {
      const [acquisitionRes, trendRes] = await Promise.all([
        fetch(`/api/growth/acquisition?${query}`),
        fetch(`/api/growth/activation-trend?${query}`),
      ]);
      const [acquisitionJson, trendJson] = await Promise.all([
        acquisitionRes.json() as Promise<GrowthResponse<AcquisitionResult>>,
        trendRes.json() as Promise<GrowthResponse<ActivationTrendResult>>,
      ]);
      setAcquisition(acquisitionJson);
      setActivationTrend(trendJson);
      const failures = [acquisitionJson, trendJson].filter(item => item.reason === 'backend_error');
      if (failures.length) setGrowthError(failures.map(item => item.error).filter(Boolean).join(' · ') || UNKNOWN_ERROR);
    } catch (e) {
      setGrowthError(e instanceof Error ? e.message : UNKNOWN_ERROR);
    } finally { setGrowthLoading(false); }
  }, []);

  useEffect(() => { loadGa4(range); loadGsc(range); }, [range, loadGa4, loadGsc]);
  useEffect(() => { loadGrowth(appliedGrowthFilters); }, [appliedGrowthFilters, loadGrowth]);

  const RANGES: { key: Range; label: string }[] = [
    { key: '7',  label: L(lang, '7 gün', '7 days')   },
    { key: '30', label: L(lang, '30 gün', '30 days') },
    { key: '90', label: L(lang, '90 gün', '90 days') },
  ];
  // Boş hata mesajı yer tutucusunu seçili dilde göster
  const errorText = (value: string, tr: string, en: string) => value === UNKNOWN_ERROR ? L(lang, tr, en) : value;

  const Header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">📊 {L(lang, 'crewinjob.com analitik', 'crewinjob.com analytics')}</h2>
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
          {RANGES.map(({ key, label }) => (
            <button key={key} onClick={() => { const next = rangeFilters(key); setRange(key); setGrowthFilters(next); setAppliedGrowthFilters(next); }} disabled={loading}
              className={`px-3 py-1.5 font-medium transition-colors disabled:cursor-wait ${
                range === key
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => { loadGa4(range); loadGsc(range); loadGrowth(appliedGrowthFilters); }} disabled={loading || gscLoading || growthLoading}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
          {(loading || gscLoading || growthLoading) ? <Spinner size={3} /> : <span>↻</span>}
          {data?.fetchedAt && !loading ? fmtTime(data.fetchedAt, lang) : L(lang, 'Yenile', 'Refresh')}
        </button>
      </div>
    </div>
  );

  const growthReports = <GrowthReports lang={lang} error={errorText(growthError, 'Crewin growth raporu alınamadı.', "Couldn't load the Crewin growth report.")} acquisition={acquisition} activationTrend={activationTrend} loading={growthLoading} filters={growthFilters} onFiltersChange={setGrowthFilters} onApply={() => setAppliedGrowthFilters({ ...growthFilters })} onClear={() => { const next = rangeFilters(range); setGrowthFilters(next); setAppliedGrowthFilters(next); }} />;

  if (loading && !data) return (
    <div className="space-y-6">
      {Header}
      {growthReports}
      <div className="flex items-center gap-3 text-slate-400 py-8">
        <Spinner size={5} /> {L(lang, 'GA4 verileri yükleniyor…', 'Loading GA4 data…')}
      </div>
    </div>
  );

  if (data?.notConfigured) return (
    <div className="space-y-6">
      {Header}
      {growthReports}
      <div className="space-y-3 max-w-2xl">
        {SETUP_STEPS.map(s => (
          <div key={s.step} className="flex gap-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{s.step}</div>
            <div>
              <div className="font-medium text-slate-800 dark:text-slate-200 text-sm">{s.title[lang === 'tr' ? 0 : 1]}</div>
              <div className="text-xs text-slate-500 mt-0.5 whitespace-pre-line">{s.desc[lang === 'tr' ? 0 : 1]}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (error) return (
    <div className="space-y-4">
      {Header}
      {growthReports}
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4 text-sm text-red-700 dark:text-red-300 flex items-center gap-3">
        <span>❌ <Msg text={errorText(error, 'Bilinmeyen hata', 'Unknown error')} /></span>
        <button onClick={() => loadGa4(range)} className="underline shrink-0">{L(lang, 'Tekrar dene', 'Retry')}</button>
      </div>
    </div>
  );

  // ── Parse GA4 data ──────────────────────────────────────────────────────────
  const ov        = parseOv(data?.overview);
  const prev      = parsePrevOv(data?.prevOverview);
  const pages     = parseRows(data?.topPages, 8);
  const countries = parseRows(data?.countries, 6);
  const cities    = parseRows(data?.cities, 5);
  const sources   = parseRows(data?.sources, 8);
  const devices   = parseRows(data?.devices, 3);
  const trend     = parseDailyTrend(data?.daily);
  const campaignRows = parseRows(data?.campaigns, 12).filter(row => row.name && row.name !== '(not set)');

  // ── Parse GSC data ──────────────────────────────────────────────────────────
  const gscOv      = parseGscOverview(gscData?.overview);
  const gscQueries = parseGscRows(gscData?.queries, 10);
  const gscPages   = parseGscRows(gscData?.pages, 6);
  const gscDaily   = parseGscDaily(gscData?.daily);

  return (
    <div className={`space-y-5 transition-opacity ${(loading || gscLoading) && data ? 'opacity-70' : ''}`}>
      {Header}

      {/* ── GA4 Metric cards ───────────────────────────────────────────────── */}
      {ov && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <MetricCard lang={lang} label={L(lang, 'Oturum', 'Sessions')}                  value={fmt(ov.sessions, lang)}         accent curr={ov.sessions}    prev={prev?.sessions ?? 0} />
          <MetricCard lang={lang} label={L(lang, 'Aktif kullanıcı', 'Active users')}     value={fmt(ov.activeUsers, lang)}      curr={ov.activeUsers}   prev={prev?.activeUsers ?? 0} />
          <MetricCard lang={lang} label={L(lang, 'Yeni kullanıcı', 'New users')}         value={fmt(ov.newUsers, lang)}         curr={ov.newUsers}      prev={prev?.newUsers ?? 0} />
          <MetricCard lang={lang} label={L(lang, 'Etkileşim oranı', 'Engagement rate')} value={pct(ov.engagementRate, lang)} />
          <MetricCard lang={lang} label={L(lang, 'Hemen çıkma', 'Bounce rate')}          value={pct(ov.bounceRate, lang)}       curr={ov.bounceRate}    prev={prev?.bounceRate ?? 0} invert />
          <MetricCard lang={lang} label={L(lang, 'Ort. süre', 'Avg. duration')}          value={fmtDur(ov.avgDuration, lang)}   curr={ov.avgDuration}   prev={prev?.avgDuration ?? 0} />
        </div>
      )}

      {/* ── Trend chart ────────────────────────────────────────────────────── */}
      {trend.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{L(lang, 'Günlük trend', 'Daily trend')}</div>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#3b82f6" strokeWidth="2" /></svg>
                {L(lang, 'Oturum', 'Sessions')}
              </span>
              <span className="flex items-center gap-1.5">
                <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#22c55e" strokeWidth="1.5" strokeDasharray="5 3" /></svg>
                {L(lang, 'Kullanıcı', 'Users')}
              </span>
            </div>
          </div>
          <AreaChart data={trend} lang={lang} />
          <div className="flex justify-between text-xs text-slate-400 mt-2">
            <span>{fmtDate(trend[0]?.date, lang)}</span><span>{fmtDate(trend[trend.length - 1]?.date, lang)}</span>
          </div>
        </div>
      )}

      {/* ── GA4 Bottom panels ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">{L(lang, 'En çok görüntülenen sayfalar', 'Top pages')}</div>
          <BarList lang={lang} rows={pages} label={L(lang, 'görüntülenme', 'views')} color="bg-blue-500" />
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-5">
          <div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">{L(lang, 'Trafik kaynakları', 'Traffic sources')}</div>
            <BarList lang={lang} rows={sources} label={L(lang, 'oturum', 'sessions')} color="bg-violet-500" />
          </div>
          {devices.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 pt-1 border-t border-slate-100 dark:border-slate-700">{L(lang, 'Cihazlar', 'Devices')}</div>
              <DeviceBars rows={devices} lang={lang} />
            </div>
          )}
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-5">
          <div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">{L(lang, 'Ülkeler', 'Countries')}</div>
            <BarList lang={lang} rows={countries} label={L(lang, 'oturum', 'sessions')} color="bg-emerald-500" />
          </div>
          {cities.length > 0 && (
            <div>
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 pt-1 border-t border-slate-100 dark:border-slate-700">{L(lang, 'Şehirler', 'Cities')}</div>
              <BarList lang={lang} rows={cities} label={L(lang, 'oturum', 'sessions')} color="bg-teal-500" />
            </div>
          )}
        </div>
      </div>

      {campaignRows.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{L(lang, 'UTM kampanya performansı', 'UTM campaign performance')}</div>
            <span className="text-xs text-slate-400">{L(lang, 'Oturum · aktif kullanıcı', 'Sessions · active users')}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-400 border-b border-slate-100 dark:border-slate-700"><th className="py-2">{L(lang, 'Kampanya', 'Campaign')}</th><th className="py-2 text-right">{L(lang, 'Oturum', 'Sessions')}</th><th className="py-2 text-right">{L(lang, 'Aktif kullanıcı', 'Active users')}</th></tr></thead>
              <tbody>{campaignRows.map(row => <tr key={row.name} className="border-b border-slate-50 dark:border-slate-800"><td className="py-2 text-slate-700 dark:text-slate-200 font-medium">{row.name}</td><td className="py-2 text-right text-slate-600 dark:text-slate-300">{fmt(row.value, lang)}</td><td className="py-2 text-right text-slate-500">{fmt(row.sub || 0, lang)}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {growthReports}

      {/* ── Search Console section ─────────────────────────────────────────── */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="text-base font-bold text-slate-900 dark:text-slate-100">🔍 {L(lang, 'Organik arama (Search Console)', 'Organic search (Search Console)')}</div>
          {gscLoading && <Spinner size={3} />}
          {gscData?.notConfigured && (
            <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full">
              {L(lang, 'GSC_SITE_URL yapılandırılmadı', 'GSC_SITE_URL not configured')}
            </span>
          )}
          {gscError && !gscLoading && (
            <span className="text-xs text-red-600 dark:text-red-400"><Msg text={errorText(gscError, 'GSC hatası', 'GSC error')} /></span>
          )}
        </div>

        {gscOv && (
          <>
            {/* GSC metric cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <SmallMetric label={L(lang, 'Organik tıklama', 'Organic clicks')} value={fmt(gscOv.clicks, lang)}      hint={L(lang, 'son arama', 'recent searches')} />
              <SmallMetric label={L(lang, 'Gösterim', 'Impressions')}           value={fmt(gscOv.impressions, lang)} hint={L(lang, "SERP'te görünme", 'SERP appearances')} />
              <SmallMetric label={L(lang, 'Ort. CTR', 'Avg. CTR')}              value={pct(gscOv.ctr, lang)}         hint={L(lang, 'tıklama oranı', 'click-through rate')} />
              <SmallMetric label={L(lang, 'Ort. pozisyon', 'Avg. position')}    value={`#${fmt(gscOv.position, lang)}`}         hint={L(lang, 'arama sıralaması', 'search ranking')} />
            </div>

            {/* GSC mini trend */}
            {gscDaily.length > 1 && (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 mb-4">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">{L(lang, 'Organik tıklama trendi', 'Organic click trend')}</div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1.5">
                      <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#f97316" strokeWidth="2" /></svg>
                      {L(lang, 'Tıklama', 'Clicks')}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" /></svg>
                      {L(lang, 'Gösterim', 'Impressions')}
                    </span>
                  </div>
                </div>
                <GscMiniChart data={gscDaily} />
                <div className="flex justify-between text-xs text-slate-400 mt-1">
                  <span>{fmtDate(gscDaily[0]?.date, lang)}</span><span>{fmtDate(gscDaily[gscDaily.length-1]?.date, lang)}</span>
                </div>
              </div>
            )}

            {/* GSC queries + pages */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">{L(lang, 'En çok tıklanan arama sorguları', 'Top search queries')}</div>
                <QueryTable rows={gscQueries} lang={lang} />
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
                <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">{L(lang, 'Organik trafik alan sayfalar', 'Top organic pages')}</div>
                <PageClickList rows={gscPages} lang={lang} />
              </div>
            </div>
          </>
        )}

        {!gscOv && !gscLoading && !gscData?.notConfigured && !gscError && (
          <div className="text-sm text-slate-400 py-4 text-center">{L(lang, 'Search Console verisi bulunamadı', 'No Search Console data found')}</div>
        )}
      </div>

      {/* Footer */}
      {data?.fetchedAt && (
        <div className="text-xs text-slate-400 text-right">
          {L(lang, 'Son güncelleme', 'Last updated')}: {new Date(data.fetchedAt).toLocaleString(localeOf(lang))} · {RANGES.find(r => r.key === range)?.label} {L(lang, 'verisi', 'of data')}
        </div>
      )}
    </div>
  );
}
