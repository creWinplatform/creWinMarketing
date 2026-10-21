'use client';
import { useState, useEffect, useCallback, useId } from 'react';
import { useLang } from '@/lib/lang';
import { localeTag, type Lang } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';
import { onTabKeys } from '@/components/platform/tab-keys';
import type {
  AdPlatform, AdPlatformStatus, AdCampaign, CampaignsResponse,
  BudgetAllocation, CreateCampaignRequest, CreateCampaignResponse,
} from '@/lib/ads-types';
import { META_OBJECTIVES, LINKEDIN_OBJECTIVES, GOOGLE_CAMPAIGN_TYPES } from '@/lib/ads-types';

// ─── helpers ─────────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  ACTIVE:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  PAUSED:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  DELETED:   'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  ARCHIVED:  'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
  DRAFT:     'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300',
  COMPLETED: 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
  UNKNOWN:   'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
};

// Platform durum değerleri (API anahtarı) çevrilmez; yalnızca ekrandaki etiket
const STATUS_LABEL: Record<string, { tr: string; en: string }> = {
  ACTIVE:    { tr: 'Aktif', en: 'Active' },
  PAUSED:    { tr: 'Duraklatıldı', en: 'Paused' },
  DELETED:   { tr: 'Silindi', en: 'Deleted' },
  ARCHIVED:  { tr: 'Arşivlendi', en: 'Archived' },
  DRAFT:     { tr: 'Taslak', en: 'Draft' },
  COMPLETED: { tr: 'Tamamlandı', en: 'Completed' },
  UNKNOWN:   { tr: 'Bilinmiyor', en: 'Unknown' },
};

const PLATFORM_META: Record<AdPlatform, { icon: string; label: string; color: string; bg: string }> = {
  meta:     { icon: '📘', label: 'Meta (FB + IG)',  color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700' },
  linkedin: { icon: '💼', label: 'LinkedIn Ads',    color: 'text-sky-700',    bg: 'bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-700' },
  google:   { icon: '🔍', label: 'Google Ads',      color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700' },
};

function fmt(n: number | null | undefined, lang: Lang) {
  if (n == null) return '–';
  return new Intl.NumberFormat(localeTag(lang), { notation: n >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
}
// Para birimi sabit USD değil — kampanyanın/hesabın para birimi (ADS_CURRENCY varsayılanı)
function money(n: number | null | undefined, lang: Lang, currency = 'USD', digits = 2) {
  if (n == null) return '–';
  try {
    return new Intl.NumberFormat(localeTag(lang), { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch {
    return `${n.toFixed(digits)} ${currency}`;
  }
}

// fetch + JSON; HTTP hatası yutulmaz, ok/status ile birlikte döner
async function fetchJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res  = await fetch(url, init);
  const data = await res.json().catch(() => ({})) as T;
  return { ok: res.ok, status: res.status, data };
}
function pct(n: number | null | undefined, lang: Lang) {
  if (n == null) return '–';
  return new Intl.NumberFormat(localeTag(lang), { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n / 100);
}
// Bütçe payı: Türkçede "%40", İngilizcede "40%"
const share = (v: number, lang: Lang) => (lang === 'tr' ? `%${v}` : `${v}%`);
// API'den gelen YYYY-MM-DD tarih; okunamazsa olduğu gibi gösterilir
function day(value: string, lang: Lang) {
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString(localeTag(lang), { day: 'numeric', month: 'short', year: 'numeric' }) : value;
}

// ─── Sub-component: Campaign card ─────────────────────────────────────────────
function CampaignCard({
  campaign, lang,
  onPause, onResume, onDelete, isUpdating, readOnly,
}: {
  campaign:   AdCampaign;
  lang:       'tr' | 'en';
  onPause:    (id: string, platform: AdPlatform) => void;
  onResume:   (id: string, platform: AdPlatform) => void;
  onDelete:   (id: string, platform: AdPlatform) => void;
  isUpdating: boolean;
  readOnly:   boolean;   // demo verisi → işlem butonları gösterilmez
}) {
  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;
  const ins = campaign.insights;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{campaign.name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[campaign.status] || STATUS_BADGE.UNKNOWN}`}>
              {STATUS_LABEL[campaign.status]?.[lang] ?? campaign.status}
            </span>
            <span className="text-[10px] text-slate-600 dark:text-slate-400">{campaign.objective}</span>
            {campaign.budgetDaily && (
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {money(campaign.budgetDaily, lang, campaign.currency)}/{t('gün', 'day')}
              </span>
            )}
            {campaign.startDate && (
              <span className="text-[10px] text-slate-600 dark:text-slate-400">
                {t('Başlangıç', 'Start')}: {day(campaign.startDate, lang)}
              </span>
            )}
          </div>
        </div>
        {!readOnly && <div className="flex gap-1.5 shrink-0">
          {campaign.status === 'ACTIVE' && (
            <button
              onClick={() => onPause(campaign.id, campaign.platform)}
              disabled={isUpdating}
              className="text-[11px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2.5 py-1 rounded-lg font-medium hover:bg-amber-200 dark:hover:bg-amber-900/50 disabled:opacity-50 transition-colors"
            >
              ⏸ {t('Duraklat', 'Pause')}
            </button>
          )}
          {campaign.status === 'PAUSED' && (
            <button
              onClick={() => onResume(campaign.id, campaign.platform)}
              disabled={isUpdating}
              className="text-[11px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2.5 py-1 rounded-lg font-medium hover:bg-green-200 dark:hover:bg-green-900/50 disabled:opacity-50 transition-colors"
            >
              ▶ {t('Devam', 'Resume')}
            </button>
          )}
          {!['DELETED', 'ARCHIVED'].includes(campaign.status) && (
            <button
              onClick={() => {
                const message = campaign.platform === 'google'
                  ? t('Google Ads kampanyası KALICI olarak kaldırılacak (geri alınamaz). Emin misiniz?', "The Google Ads campaign will be PERMANENTLY removed (this can't be undone). Are you sure?")
                  : t('Kampanya arşivlenecek. Emin misiniz?', 'The campaign will be archived. Are you sure?');
                if (confirm(message))
                  onDelete(campaign.id, campaign.platform);
              }}
              disabled={isUpdating}
              title={campaign.platform === 'google' ? t('Kaldır', 'Remove') : t('Arşivle', 'Archive')}
              aria-label={campaign.platform === 'google' ? t('Kaldır', 'Remove') : t('Arşivle', 'Archive')}
              className="text-[11px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
            >
              <span aria-hidden="true">🗑️</span>
            </button>
          )}
        </div>}
      </div>

      {/* Metrics */}
      {ins && (
        <div className="grid grid-cols-4 gap-0 divide-x divide-slate-100 dark:divide-slate-700">
          {[
            { label: t('Gösterim', 'Impressions'), value: fmt(ins.impressions, lang) },
            { label: t('Tıklama',  'Clicks'),      value: fmt(ins.clicks, lang) },
            { label: t('Harcama',  'Spend'),        value: money(ins.spend, lang, campaign.currency) },
            { label: 'CTR',                         value: pct(ins.ctr, lang) },
          ].map(m => (
            <div key={m.label} className="px-3 py-2.5 text-center">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{m.value}</p>
              <p className="text-[10px] text-slate-600 dark:text-slate-400">{m.label}</p>
            </div>
          ))}
        </div>
      )}
      {!ins && (
        <div className="px-4 py-2.5 text-[11px] text-slate-600 dark:text-slate-400">
          {t('Performans verisi yok (kampanya henüz yayınlanmadı)', 'No performance data (the campaign isn\'t live yet)')}
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: Create campaign form ──────────────────────────────────────
function CreateCampaignForm({
  platform, lang, onSave, onCancel, saving, currency,
}: {
  platform: AdPlatform;
  lang:     'tr' | 'en';
  currency: string;
  onSave:   (req: CreateCampaignRequest) => void;
  onCancel: () => void;
  saving:   boolean;
}) {
  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;
  const fid = useId();

  const objectives =
    platform === 'meta'     ? META_OBJECTIVES :
    platform === 'linkedin' ? LINKEDIN_OBJECTIVES :
    GOOGLE_CAMPAIGN_TYPES;

  const [name,        setName]        = useState('');
  const [objective,   setObjective]   = useState(objectives[0]?.value || '');
  const [budgetDaily, setBudgetDaily] = useState(15);
  const [startDate,   setStartDate]   = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState('');
  const [countries,   setCountries]   = useState('TR');

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-200 dark:border-slate-600 p-4 flex flex-col gap-3">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        <span aria-hidden="true">➕</span> {t('Yeni kampanya', 'New campaign')} — {PLATFORM_META[platform].label}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label htmlFor={`${fid}-name`} className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('Kampanya adı', 'Campaign name')} *</label>
          <input
            id={`${fid}-name`}
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder={t('Örn: Seafarer Registration Q3 2026', 'e.g. Seafarer registration Q3 2026')}
            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean focus-visible:ring-ocean"
          />
        </div>

        <div>
          <label htmlFor={`${fid}-objective`} className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('Hedef / Tür', 'Objective / Type')} *</label>
          <select
            id={`${fid}-objective`}
            value={objective} onChange={e => setObjective(e.target.value)}
            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean focus-visible:ring-ocean"
          >
            {objectives.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor={`${fid}-budget`} className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t(`Günlük bütçe (${currency})`, `Daily budget (${currency})`)} *</label>
          <div className="flex items-center gap-2">
            <input
              id={`${fid}-budget`}
              type="range" min={1} max={500} step={1} value={budgetDaily}
              onChange={e => setBudgetDaily(Number(e.target.value))}
              className="flex-1 accent-ocean"
            />
            <span className="text-sm font-bold text-ocean w-20 text-right">{money(budgetDaily, lang, currency, 0)}</span>
          </div>
          <p className="text-[10px] text-slate-600 mt-0.5">≈ {money(budgetDaily * 30, lang, currency, 0)}/{t('ay', 'mo')}</p>
        </div>

        <div>
          <label htmlFor={`${fid}-start`} className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('Başlangıç tarihi', 'Start date')} *</label>
          <input
            id={`${fid}-start`}
            type="date" value={startDate} min={today}
            onChange={e => setStartDate(e.target.value)}
            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean focus-visible:ring-ocean"
          />
        </div>

        <div>
          <label htmlFor={`${fid}-end`} className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('Bitiş tarihi (opsiyonel)', 'End date (optional)')}</label>
          <input
            id={`${fid}-end`}
            type="date" value={endDate} min={startDate || today}
            onChange={e => setEndDate(e.target.value)}
            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean focus-visible:ring-ocean"
          />
        </div>

        <div>
          <label htmlFor={`${fid}-countries`} className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('Hedef ülkeler (virgülle)', 'Target countries (comma-separated)')}</label>
          <input
            id={`${fid}-countries`}
            type="text" value={countries} onChange={e => setCountries(e.target.value)}
            placeholder="TR, PH, IN, ID"
            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean focus-visible:ring-ocean"
          />
          <p className="text-[10px] text-slate-600 mt-0.5">{t('ISO ülke kodları: TR, PH, IN…', 'ISO country codes: TR, PH, IN…')}</p>
        </div>
      </div>

      <div className="flex gap-2 mt-1">
        <button
          onClick={() => onSave({
            platform, name, objective, budgetDaily, startDate,
            ...(endDate ? { endDate } : {}),
            targeting: {
              countries: countries.split(',').map(c => c.trim().toUpperCase()).filter(Boolean),
            },
          })}
          disabled={saving || !name.trim()}
          className="flex-1 bg-ocean hover:bg-ocean-dark disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          📅 {saving ? t('Oluşturuluyor…', 'Creating…') : t('Kampanya oluştur', 'Create campaign')}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          {t('İptal', 'Cancel')}
        </button>
      </div>

      <p className="text-[10px] text-slate-600 dark:text-slate-400">
        💡 {platform === 'linkedin' ? t(
          'LinkedIn kampanyası TASLAK olarak oluşturulur — teklif ve kreatifi LinkedIn Campaign Manager’da tamamlayıp yayına alın.',
          'LinkedIn campaigns are created as DRAFT — finish bidding and creatives in LinkedIn Campaign Manager, then launch.',
        ) : t(
          'Kampanya başlangıçta DURAKLATILMIŞ olarak oluşturulur — inceledikten sonra platformdan veya buradan aktifleştirin.',
          'The campaign is created as PAUSED — review it, then activate it here or on the platform.',
        )}
      </p>
    </div>
  );
}

// ─── Budget allocation widget ─────────────────────────────────────────────────
function BudgetAllocator({
  allocation, onChange, lang, currency,
}: {
  allocation: BudgetAllocation;
  onChange:   (a: BudgetAllocation) => void;
  lang:       'tr' | 'en';
  currency:   string;
}) {
  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;
  const fid = useId();
  const total = allocation.totalMonthlyUSD;
  const p     = allocation.platforms;

  const metaUSD     = Math.round(total * p.meta     / 100);
  const linkedinUSD = Math.round(total * p.linkedin / 100);
  const googleUSD   = Math.round(total * p.google  / 100);

  const setTotal = (v: number) => onChange({ ...allocation, totalMonthlyUSD: v });
  const setMeta  = (v: number) => {
    const rest = 100 - v;
    const ratio = (p.linkedin + p.google) > 0 ? p.linkedin / (p.linkedin + p.google) : 0.5;
    onChange({ ...allocation, platforms: { meta: v, linkedin: Math.round(rest * ratio), google: Math.round(rest * (1 - ratio)) } });
  };
  const setLI = (v: number) => {
    const rest = 100 - v;
    const ratio = (p.meta + p.google) > 0 ? p.meta / (p.meta + p.google) : 0.5;
    onChange({ ...allocation, platforms: { meta: Math.round(rest * ratio), linkedin: v, google: Math.round(rest * (1 - ratio)) } });
  };
  const setGoogle = (v: number) => {
    const rest = 100 - v;
    const ratio = (p.meta + p.linkedin) > 0 ? p.meta / (p.meta + p.linkedin) : 0.5;
    onChange({ ...allocation, platforms: { meta: Math.round(rest * ratio), linkedin: Math.round(rest * (1 - ratio)), google: v } });
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
        <span><span aria-hidden="true">💰</span> {t('Aylık bütçe ve dağılım', 'Monthly budget & allocation')}</span>
      </h3>

      <div className="flex flex-col gap-4">
        {/* Total */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor={`${fid}-total`} className="text-xs text-slate-600 dark:text-slate-300 font-medium">{t('Toplam aylık bütçe', 'Total monthly budget')}</label>
            <span className="text-base font-bold text-ocean">{money(total, lang, currency, 0)}</span>
          </div>
          <input
            id={`${fid}-total`}
            type="range" min={50} max={10000} step={50} value={total}
            onChange={e => setTotal(Number(e.target.value))}
            className="w-full accent-ocean"
          />
          <div className="flex justify-between text-[10px] text-slate-600 mt-0.5">
            <span>{money(50, lang, currency, 0)}</span><span>{money(10000, lang, currency, 0)}</span>
          </div>
        </div>

        {/* Stacked bar */}
        <div aria-hidden="true" className="h-6 flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600">
          {[
            { pct: p.meta,     color: 'bg-blue-500' },
            { pct: p.linkedin, color: 'bg-sky-600' },
            { pct: p.google,   color: 'bg-red-500' },
          ].map((seg, i) => (
            <div key={i} className={`${seg.color} flex items-center justify-center transition-all duration-300`} style={{ width: `${seg.pct}%` }}>
              {seg.pct > 12 && <span className="text-[10px] font-bold text-white">{share(seg.pct, lang)}</span>}
            </div>
          ))}
        </div>

        {/* Platform sliders */}
        {[
          { key: 'meta'     as const, label: '📘 Meta',     name: 'Meta',     val: p.meta,     usd: metaUSD,     fn: setMeta },
          { key: 'linkedin' as const, label: '💼 LinkedIn', name: 'LinkedIn', val: p.linkedin, usd: linkedinUSD, fn: setLI },
          { key: 'google'   as const, label: '🔍 Google',   name: 'Google',   val: p.google,   usd: googleUSD,   fn: setGoogle },
        ].map(s => (
          <div key={s.key}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">{s.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">{money(s.usd, lang, currency, 0)}/{t('ay', 'mo')}</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{share(s.val, lang)}</span>
              </div>
            </div>
            <input
              aria-label={t(`${s.name} bütçe payı`, `${s.name} budget share`)}
              type="range" min={0} max={100} step={5} value={s.val}
              onChange={e => s.fn(Number(e.target.value))}
              className="w-full accent-ocean"
            />
          </div>
        ))}

        <p className="text-[11px] text-slate-600 dark:text-slate-400">
          ≈ {money(total / 30, lang, currency, 0)}/{t('gün toplam', 'day in total')} ·
          Meta {money(metaUSD / 30, lang, currency, 0)} · LI {money(linkedinUSD / 30, lang, currency, 0)} · Google {money(googleUSD / 30, lang, currency, 0)}
        </p>
      </div>
    </div>
  );
}

// ─── Main CampaignManagerTab ──────────────────────────────────────────────────
const PLATFORMS: AdPlatform[] = ['meta', 'linkedin', 'google'];

export default function CampaignManagerTab() {
  const { lang } = useLang();
  const t = useCallback((tr: string, en: string) => lang === 'tr' ? tr : en, [lang]);

  const [statuses,     setStatuses]     = useState<AdPlatformStatus[]>([]);
  const [campaigns,    setCampaigns]    = useState<Record<AdPlatform, AdCampaign[]>>({ meta: [], linkedin: [], google: [] });
  const [sources,      setSources]      = useState<Record<AdPlatform, 'api' | 'mock'>>({ meta: 'mock', linkedin: 'mock', google: 'mock' });
  const [errors,       setErrors]       = useState<Record<AdPlatform, string>>({ meta: '', linkedin: '', google: '' });
  const [loading,      setLoading]      = useState(true);
  const [activePlatform, setActivePlatform] = useState<AdPlatform>('meta');
  const [showForm,     setShowForm]     = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [updatingId,   setUpdatingId]   = useState<string | null>(null);
  const [saveSuccess,  setSaveSuccess]  = useState('');
  const [actionError,  setActionError]  = useState('');
  const [currencies,   setCurrencies]   = useState<Partial<Record<AdPlatform, string>>>({});

  const [budget, setBudget] = useState<BudgetAllocation>({
    totalMonthlyUSD: 500,
    platforms: { meta: 50, linkedin: 20, google: 30 },
  });

  // ── Load platform statuses + campaigns ───────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchJson<AdPlatformStatus[]>('/api/ads/status'),
      Promise.all(PLATFORMS.map(p => fetchJson<CampaignsResponse>(`/api/ads/${p}/campaigns`))),
    ]).then(([sts, lists]) => {
      if (sts.ok && Array.isArray(sts.data)) setStatuses(sts.data);
      const nextCampaigns = { meta: [], linkedin: [], google: [] } as Record<AdPlatform, AdCampaign[]>;
      const nextSources   = { meta: 'mock', linkedin: 'mock', google: 'mock' } as Record<AdPlatform, 'api' | 'mock'>;
      const nextErrors    = { meta: '', linkedin: '', google: '' } as Record<AdPlatform, string>;
      const nextCurrency: Partial<Record<AdPlatform, string>> = {};
      PLATFORMS.forEach((p, i) => {
        const { ok, status, data } = lists[i];
        nextCampaigns[p] = Array.isArray(data.campaigns) ? data.campaigns : [];
        nextSources[p]   = data.mock || data.source === 'mock' ? 'mock' : 'api';
        nextErrors[p]    = ok ? (data.error || '') : (data.error || `HTTP ${status}`);
        if (data.currency) nextCurrency[p] = data.currency;
      });
      setCampaigns(nextCampaigns);
      setSources(nextSources);
      setErrors(nextErrors);
      setCurrencies(nextCurrency);
    }).catch((err: unknown) => {
      setActionError(`${t('Reklam verileri yüklenemedi.', "Couldn't load ads data.")} ${err instanceof Error ? err.message : String(err)}`);
    }).finally(() => setLoading(false));
  }, []); // yalnızca ilk yüklemede (dil değişimi yeniden çekmez)

  // Platform canlı mı? (status yanıtı yoksa liste kaynağına bak)
  const isLive = (p: AdPlatform) => {
    const st = statuses.find(s => s.platform === p);
    return (st ? st.configured : true) && sources[p] === 'api';
  };
  const defaultCurrency = statuses.find(s => s.currency)?.currency || 'USD';
  const currencyOf = (p: AdPlatform) => currencies[p] || defaultCurrency;

  // ── Create campaign ───────────────────────────────────────────────────────────
  const handleCreate = async (req: CreateCampaignRequest) => {
    if (!isLive(req.platform)) return;   // demo modda oluşturma yok
    setSaving(true);
    setActionError('');
    try {
      const { ok, status, data } = await fetchJson<Partial<CreateCampaignResponse>>(`/api/ads/${req.platform}/campaigns`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(req),
      });
      if (!ok || !data.success) throw new Error(data.error || `HTTP ${status}`);

      // Refresh campaigns for this platform
      const fresh = await fetchJson<CampaignsResponse>(`/api/ads/${req.platform}/campaigns`);
      if (fresh.ok && Array.isArray(fresh.data.campaigns)) setCampaigns(prev => ({ ...prev, [req.platform]: fresh.data.campaigns }));
      setShowForm(false);
      setSaveSuccess(data.status === 'DRAFT'
        ? t('Kampanya TASLAK olarak oluşturuldu — LinkedIn Campaign Manager’da tamamlayıp yayına alın.', 'Campaign created as DRAFT — finish it in LinkedIn Campaign Manager to launch.')
        : t('Kampanya oluşturuldu. DURAKLATILMIŞ olarak başlatıldı.', 'Campaign created. It starts as PAUSED.'));
      setTimeout(() => setSaveSuccess(''), 4000);
    } catch (err: unknown) {
      setActionError(`${t('Kampanya oluşturulamadı.', "Couldn't create the campaign.")} ${err instanceof Error ? err.message : t('Bir hata oluştu.', 'Something went wrong.')}`);
    } finally {
      setSaving(false);
    }
  };

  // ── Pause / Resume ────────────────────────────────────────────────────────────
  // İyimser güncelleme: önce UI, hata olursa eski duruma geri alınır ve hata gösterilir
  const handleStatusChange = async (id: string, platform: AdPlatform, newStatus: 'ACTIVE' | 'PAUSED') => {
    const previous = campaigns[platform].find(c => c.id === id)?.status;
    setUpdatingId(id);
    setActionError('');
    setCampaigns(prev => ({
      ...prev,
      [platform]: prev[platform].map(c => c.id === id ? { ...c, status: newStatus } : c),
    }));
    try {
      const { ok, status, data } = await fetchJson<{ success?: boolean; error?: string }>(`/api/ads/${platform}/campaign/${encodeURIComponent(id)}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: newStatus }),
      });
      if (!ok || data.success === false) throw new Error(data.error || `HTTP ${status}`);
    } catch (err: unknown) {
      if (previous) {
        setCampaigns(prev => ({
          ...prev,
          [platform]: prev[platform].map(c => c.id === id ? { ...c, status: previous } : c),
        }));
      }
      const message = t('Kampanya durumu güncellenemedi.', "Couldn't update the campaign status.");
      setActionError(`${message} ${err instanceof Error ? err.message : String(err)}`);
    } finally { setUpdatingId(null); }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string, platform: AdPlatform) => {
    const snapshot = campaigns[platform];
    setUpdatingId(id);
    setActionError('');
    setCampaigns(prev => ({
      ...prev,
      [platform]: prev[platform].filter(c => c.id !== id),
    }));
    try {
      // Google'da kaldırma kalıcıdır → kullanıcı onayı (CampaignCard confirm) açık parametreyle iletilir
      const query = platform === 'google' ? '?confirm=remove' : '';
      const { ok, status, data } = await fetchJson<{ success?: boolean; error?: string }>(`/api/ads/${platform}/campaign/${encodeURIComponent(id)}${query}`, { method: 'DELETE' });
      if (!ok || data.success === false) throw new Error(data.error || `HTTP ${status}`);
    } catch (err: unknown) {
      setCampaigns(prev => ({ ...prev, [platform]: snapshot }));
      setActionError(`${t('Kampanya kaldırılamadı veya arşivlenemedi.', "Couldn't remove or archive the campaign.")} ${err instanceof Error ? err.message : String(err)}`);
    } finally { setUpdatingId(null); }
  };

  // ── Aggregated stats ──────────────────────────────────────────────────────────
  // Demo (yapılandırılmamış) platformların örnek kampanyaları toplamlara katılmaz
  const allCampaigns = PLATFORMS.filter(p => sources[p] === 'api').flatMap(p => campaigns[p]);
  const totalSpend   = allCampaigns.reduce((s, c) => s + (c.insights?.spend || 0), 0);
  const spendCurrencies = Array.from(new Set(allCampaigns.filter(c => c.insights).map(c => c.currency)));
  const totalSpendText  = spendCurrencies.length > 1
    ? `${totalSpend.toLocaleString(localeTag(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${t('karışık para birimi', 'mixed currencies')})`
    : money(totalSpend, lang, spendCurrencies[0] || defaultCurrency);
  const totalClicks  = allCampaigns.reduce((s, c) => s + (c.insights?.clicks || 0), 0);
  const totalImpr    = allCampaigns.reduce((s, c) => s + (c.insights?.impressions || 0), 0);
  const activeCamps  = allCampaigns.filter(c => c.status === 'ACTIVE').length;

  const activeTab = campaigns[activePlatform];
  const activeStatus = statuses.find(s => s.platform === activePlatform);
  const activeLive = isLive(activePlatform);

  return (
    <div className="flex flex-col gap-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span><span aria-hidden="true">📣</span> {t('Kampanya yöneticisi', 'Campaign manager')}</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('Meta · LinkedIn · Google Ads — gerçek zamanlı kampanya takibi', 'Meta · LinkedIn · Google Ads — real-time campaign tracking')}
          </p>
        </div>
      </div>

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: '📣', label: t('Aktif kampanya', 'Active campaigns'), value: String(activeCamps),               color: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-800 dark:text-green-300' },
          { icon: '💸', label: t('Toplam harcama',  'Total spend'),      value: totalSpendText,                    color: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700 text-red-800 dark:text-red-300' },
          { icon: '👁️', label: t('Gösterim',        'Impressions'),      value: fmt(totalImpr, lang),                 color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-300' },
          { icon: '🖱️', label: t('Tıklama',         'Clicks'),           value: fmt(totalClicks, lang),               color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700 text-purple-800 dark:text-purple-300' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-4 flex items-start gap-3 ${s.color}`}>
            <span className="text-2xl" aria-hidden="true">{s.icon}</span>
            <div>
              <div className="text-xl font-bold leading-tight">{loading ? '…' : s.value}</div>
              <div className="text-xs font-medium opacity-80">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Budget allocator ── */}
      <BudgetAllocator allocation={budget} onChange={setBudget} lang={lang} currency={defaultCurrency} />

      {/* ── Platform status bar ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PLATFORMS.map(p => {
          const st  = statuses.find(s => s.platform === p);
          const meta = PLATFORM_META[p];
          return (
            <div key={p} className={`rounded-xl border p-3 flex items-center gap-3 ${meta.bg}`}>
              <span className="text-xl" aria-hidden="true">{meta.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{meta.label}</p>
                <p className={`text-[10px] font-medium ${st?.configured ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {st?.configured
                    ? `✅ ${t('Bağlı', 'Connected')} · ${st.accountId}`
                    : `⚙️ ${t('.env.local dosyasında token gerekli', 'Token required in .env.local')}`}
                </p>
              </div>
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 shrink-0">
                {campaigns[p].length} {t('kampanya', 'campaigns')}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Platform tab selector ── */}
      <div role="tablist" aria-label={t('Reklam platformları', 'Ad platforms')} onKeyDown={onTabKeys} className="flex gap-1 bg-slate-100 dark:bg-slate-700/50 rounded-xl p-1">
        {PLATFORMS.map(p => {
          const meta = PLATFORM_META[p];
          const cnt  = campaigns[p].length;
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={activePlatform === p}
              tabIndex={activePlatform === p ? 0 : -1}
              onClick={() => { setActivePlatform(p); setShowForm(false); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                activePlatform === p
                  ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <span><span aria-hidden="true">{meta.icon}</span> {meta.label}</span>
              {cnt > 0 && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                  activePlatform === p ? 'bg-ocean text-white' : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300'
                }`}>{cnt}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Success toast ── */}
      {saveSuccess && (
        <div role="status" className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl px-4 py-3 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
          <span aria-hidden="true">✅</span> <Msg text={saveSuccess} />
        </div>
      )}

      {/* ── Action error (create / pause / delete) ── */}
      {actionError && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
          <span className="flex-1"><span aria-hidden="true">❌</span> <Msg text={actionError} /></span>
          <button type="button" onClick={() => setActionError('')} className="text-xs opacity-70 hover:opacity-100" aria-label={t('Kapat', 'Dismiss')}><span aria-hidden="true">✕</span></button>
        </div>
      )}

      {/* ── Error banner ── */}
      {errors[activePlatform] && (
        <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <span aria-hidden="true">❌</span> <Msg text={errors[activePlatform]} />
        </div>
      )}

      {/* ── Mock data notice ── */}
      {!activeLive && !errors[activePlatform] && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-xl px-4 py-3 text-xs text-amber-800 dark:text-amber-300 flex flex-col gap-1">
          <p className="font-semibold text-sm">
            <span aria-hidden="true">🧪</span> {t('DEMO MODU — platform yapılandırılmamış', 'DEMO MODE — platform not configured')}
          </p>
          <p>
            {t(
              `${PLATFORM_META[activePlatform].label} bağlı değil. Aşağıdaki kampanyalar örnek veridir; kampanya oluşturma, duraklatma ve silme devre dışı. Canlı veri için .env.local'a eksik değişkenleri ekleyin.`,
              `${PLATFORM_META[activePlatform].label} is not connected. The campaigns below are sample data; creating, pausing and deleting are disabled. Add the missing variables to .env.local for live data.`,
            )}
          </p>
          <p className="font-mono">{t('Eksik', 'Missing')}: {(activeStatus?.missingEnv?.length ? activeStatus.missingEnv : getEnvHint(activePlatform)).join(', ')}</p>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {loading && (
        <div className="flex flex-col gap-3">
          {[1, 2].map(i => (
            <div key={i} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 animate-pulse">
              <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-1/3 mb-2" />
              <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded w-1/4" />
            </div>
          ))}
        </div>
      )}

      {/* ── Campaign list + Create button ── */}
      {!loading && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              <span aria-hidden="true">{PLATFORM_META[activePlatform].icon}</span> {PLATFORM_META[activePlatform].label} — {t('Kampanyalar', 'Campaigns')}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(v => !v)}
              aria-expanded={showForm}
              disabled={!activeLive}
              title={activeLive ? undefined : t('Demo modunda kampanya oluşturulamaz', "Can't create campaigns in demo mode")}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                showForm
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  : 'bg-ocean hover:bg-ocean-dark text-white'
              }`}
            >
              {showForm ? `✕ ${t('İptal', 'Cancel')}` : `➕ ${t('Yeni kampanya', 'New campaign')}`}
            </button>
          </div>

          {showForm && activeLive && (
            <CreateCampaignForm
              platform={activePlatform}
              lang={lang}
              onSave={handleCreate}
              onCancel={() => setShowForm(false)}
              saving={saving}
              currency={currencyOf(activePlatform)}
            />
          )}

          {activeTab.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 gap-3 text-slate-600">
              <span className="text-4xl opacity-20" aria-hidden="true">📣</span>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('Bu platformda henüz kampanya yok.', 'No campaigns on this platform yet.')}
              </p>
              {activeLive && (
                <button
                  onClick={() => setShowForm(true)}
                  className="text-xs text-ocean hover:underline font-medium"
                >
                  ➕ {t('İlk kampanyayı oluştur →', 'Create the first campaign →')}
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {activeTab.map(camp => (
                <CampaignCard
                  key={camp.id}
                  campaign={camp}
                  lang={lang}
                  onPause={(id, plt)  => handleStatusChange(id, plt, 'PAUSED')}
                  onResume={(id, plt) => handleStatusChange(id, plt, 'ACTIVE')}
                  onDelete={handleDelete}
                  isUpdating={updatingId === camp.id}
                  readOnly={!activeLive}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── .env.local setup guide ── */}
      <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
          <span aria-hidden="true">⚙️</span> {t('API anahtarları (.env.local)', 'API keys (.env.local)')}
        </p>
        <div className="space-y-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 leading-relaxed">
          <p className="text-slate-600 dark:text-slate-400"># ── Meta Ads (Facebook + Instagram) ──────────────────</p>
          <p>META_ADS_ACCESS_TOKEN=<span className="text-amber-600 dark:text-amber-400">&lt;{t('System User Token veya User Token', 'System user token or user token')}&gt;</span></p>
          <p>META_ADS_ACCOUNT_ID=<span className="text-amber-600 dark:text-amber-400">act_&lt;Ad Account ID&gt;</span></p>
          <p>META_GRAPH_VERSION=<span className="text-amber-600 dark:text-amber-400">v25.0 ({t('opsiyonel', 'optional')})</span></p>
          <p>FACEBOOK_PAGE_ID=<span className="text-amber-600 dark:text-amber-400">&lt;{t('Lead Generation için sayfa ID', 'Page ID for lead generation')}&gt;</span></p>
          <p className="text-slate-600 dark:text-slate-400 mt-1"># ── LinkedIn Ads ──────────────────────────────────────</p>
          <p>LINKEDIN_ACCESS_TOKEN=<span className="text-amber-600 dark:text-amber-400">&lt;{t('rw_ads yetkili token', 'Token with rw_ads scope')}&gt;</span></p>
          <p>LINKEDIN_API_VERSION=<span className="text-amber-600 dark:text-amber-400">202608 ({t('opsiyonel', 'optional')})</span></p>
          <p>LINKEDIN_ADS_ACCOUNT_ID=<span className="text-amber-600 dark:text-amber-400">&lt;Sponsored Account ID&gt;</span></p>
          <p className="text-slate-600 dark:text-slate-400 mt-1"># ── Google Ads ────────────────────────────────────────</p>
          <p>GOOGLE_ADS_DEVELOPER_TOKEN=<span className="text-amber-600 dark:text-amber-400">&lt;Developer Token&gt;</span></p>
          <p>GOOGLE_ADS_CLIENT_ID=<span className="text-amber-600 dark:text-amber-400">&lt;OAuth Client ID&gt;</span></p>
          <p>GOOGLE_ADS_CLIENT_SECRET=<span className="text-amber-600 dark:text-amber-400">&lt;OAuth Client Secret&gt;</span></p>
          <p>GOOGLE_ADS_REFRESH_TOKEN=<span className="text-amber-600 dark:text-amber-400">&lt;Refresh Token&gt;</span></p>
          <p>GOOGLE_ADS_CUSTOMER_ID=<span className="text-amber-600 dark:text-amber-400">&lt;{t('Customer ID (tiresiz)', 'Customer ID (no dashes)')}&gt;</span></p>
          <p>GOOGLE_ADS_LOGIN_CUSTOMER_ID=<span className="text-amber-600 dark:text-amber-400">&lt;MCC ID ({t('varsa', 'if any')})&gt;</span></p>
          <p>GOOGLE_ADS_API_VERSION=<span className="text-amber-600 dark:text-amber-400">v25 ({t('opsiyonel', 'optional')})</span></p>
          <p className="text-slate-600 dark:text-slate-400 mt-1"># ── {t('Ortak', 'Common')} ─────────────────────────────────────────────</p>
          <p>ADS_CURRENCY=<span className="text-amber-600 dark:text-amber-400">USD ({t('hesap para birimi okunamazsa', 'fallback if account currency is unavailable')})</span></p>
        </div>
      </div>
    </div>
  );
}

// /api/ads/status yanıtı yoksa kullanılan yedek liste (status route'undaki zorunlu değişkenlerle aynı)
function getEnvHint(platform: AdPlatform): string[] {
  if (platform === 'meta')     return ['META_ADS_ACCESS_TOKEN', 'META_ADS_ACCOUNT_ID'];
  if (platform === 'linkedin') return ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_ADS_ACCOUNT_ID'];
  return ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'];
}
