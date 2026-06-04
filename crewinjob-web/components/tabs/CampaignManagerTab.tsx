'use client';
import { useState, useEffect, useCallback } from 'react';
import { useLang } from '@/lib/lang';
import type {
  AdPlatform, AdPlatformStatus, AdCampaign, CampaignsResponse,
  BudgetAllocation, CreateCampaignRequest,
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
  UNKNOWN:   'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500',
};

const PLATFORM_META: Record<AdPlatform, { icon: string; label: string; color: string; bg: string }> = {
  meta:     { icon: '📘', label: 'Meta (FB + IG)',  color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700' },
  linkedin: { icon: '💼', label: 'LinkedIn Ads',    color: 'text-sky-700',    bg: 'bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-700' },
  google:   { icon: '🔍', label: 'Google Ads',      color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700' },
};

function fmt(n: number | null | undefined) {
  if (n == null) return '–';
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}
function usd(n: number | null | undefined) {
  if (n == null) return '–';
  return `$${n.toFixed(2)}`;
}
function pct(n: number | null | undefined) {
  if (n == null) return '–';
  return `${n.toFixed(2)}%`;
}

// ─── Sub-component: Campaign card ─────────────────────────────────────────────
function CampaignCard({
  campaign, lang,
  onPause, onResume, onDelete, isUpdating,
}: {
  campaign:   AdCampaign;
  lang:       'tr' | 'en';
  onPause:    (id: string, platform: AdPlatform) => void;
  onResume:   (id: string, platform: AdPlatform) => void;
  onDelete:   (id: string, platform: AdPlatform) => void;
  isUpdating: boolean;
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
              {campaign.status}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">{campaign.objective}</span>
            {campaign.budgetDaily && (
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                {usd(campaign.budgetDaily)}/{t('gün', 'day')}
              </span>
            )}
            {campaign.startDate && (
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {t('Başlangıç', 'Start')}: {campaign.startDate}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
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
                if (confirm(t('Kampanya silinecek. Emin misiniz?', 'Delete campaign? Are you sure?')))
                  onDelete(campaign.id, campaign.platform);
              }}
              disabled={isUpdating}
              className="text-[11px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
            >
              🗑️
            </button>
          )}
        </div>
      </div>

      {/* Metrics */}
      {ins && (
        <div className="grid grid-cols-4 gap-0 divide-x divide-slate-100 dark:divide-slate-700">
          {[
            { label: t('Gösterim', 'Impressions'), value: fmt(ins.impressions) },
            { label: t('Tıklama',  'Clicks'),      value: fmt(ins.clicks) },
            { label: t('Harcama',  'Spend'),        value: usd(ins.spend) },
            { label: 'CTR',                         value: pct(ins.ctr) },
          ].map(m => (
            <div key={m.label} className="px-3 py-2.5 text-center">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{m.value}</p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">{m.label}</p>
            </div>
          ))}
        </div>
      )}
      {!ins && (
        <div className="px-4 py-2.5 text-[11px] text-slate-400 dark:text-slate-500">
          {t('Performans verisi yok (kampanya henüz yayınlanmadı)', 'No performance data yet')}
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: Create campaign form ──────────────────────────────────────
function CreateCampaignForm({
  platform, lang, onSave, onCancel, saving,
}: {
  platform: AdPlatform;
  lang:     'tr' | 'en';
  onSave:   (req: CreateCampaignRequest) => void;
  onCancel: () => void;
  saving:   boolean;
}) {
  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;

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
        ➕ {t('Yeni Kampanya', 'New Campaign')} — {PLATFORM_META[platform].label}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('Kampanya Adı', 'Campaign Name')} *</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder={t('Örn: Seafarer Registration Q3 2026', 'e.g. Seafarer Registration Q3 2026')}
            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('Hedef / Tür', 'Objective / Type')} *</label>
          <select
            value={objective} onChange={e => setObjective(e.target.value)}
            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50"
          >
            {objectives.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('Günlük Bütçe (USD)', 'Daily Budget (USD)')} *</label>
          <div className="flex items-center gap-2">
            <input
              type="range" min={1} max={500} step={1} value={budgetDaily}
              onChange={e => setBudgetDaily(Number(e.target.value))}
              className="flex-1 accent-ocean"
            />
            <span className="text-sm font-bold text-ocean w-16 text-right">${budgetDaily}</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5">≈ ${(budgetDaily * 30).toFixed(0)}/{t('ay', 'mo')}</p>
        </div>

        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('Başlangıç Tarihi', 'Start Date')} *</label>
          <input
            type="date" value={startDate} min={today}
            onChange={e => setStartDate(e.target.value)}
            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('Bitiş Tarihi (opsiyonel)', 'End Date (optional)')}</label>
          <input
            type="date" value={endDate} min={startDate || today}
            onChange={e => setEndDate(e.target.value)}
            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 dark:text-slate-400 block mb-1">{t('Hedef Ülkeler (virgülle)', 'Target Countries (comma-separated)')}</label>
          <input
            type="text" value={countries} onChange={e => setCountries(e.target.value)}
            placeholder="TR, PH, IN, ID"
            className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50"
          />
          <p className="text-[10px] text-slate-400 mt-0.5">{t('ISO ülke kodları: TR, PH, IN...', 'ISO country codes: TR, PH, IN...')}</p>
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
          📅 {saving ? t('Oluşturuluyor...', 'Creating...') : t('Kampanya Oluştur', 'Create Campaign')}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
        >
          {t('İptal', 'Cancel')}
        </button>
      </div>

      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        💡 {t(
          'Kampanya başlangıçta DURAKLATILMIŞ olarak oluşturulur — inceledikten sonra platformdan veya buradan aktifleştirin.',
          'Campaign is created as PAUSED — review it then activate from here or the platform dashboard.',
        )}
      </p>
    </div>
  );
}

// ─── Budget allocation widget ─────────────────────────────────────────────────
function BudgetAllocator({
  allocation, onChange, lang,
}: {
  allocation: BudgetAllocation;
  onChange:   (a: BudgetAllocation) => void;
  lang:       'tr' | 'en';
}) {
  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;
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
        💰 {t('Aylık Bütçe & Dağılım', 'Monthly Budget & Allocation')}
      </h3>

      <div className="flex flex-col gap-4">
        {/* Total */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-slate-600 dark:text-slate-300 font-medium">{t('Toplam Aylık Bütçe', 'Total Monthly Budget')}</label>
            <span className="text-base font-bold text-ocean">${total.toLocaleString()}</span>
          </div>
          <input
            type="range" min={50} max={10000} step={50} value={total}
            onChange={e => setTotal(Number(e.target.value))}
            className="w-full accent-ocean"
          />
          <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
            <span>$50</span><span>$10,000</span>
          </div>
        </div>

        {/* Stacked bar */}
        <div className="h-6 flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600">
          {[
            { pct: p.meta,     color: 'bg-blue-500' },
            { pct: p.linkedin, color: 'bg-sky-600' },
            { pct: p.google,   color: 'bg-red-500' },
          ].map((seg, i) => (
            <div key={i} className={`${seg.color} flex items-center justify-center transition-all duration-300`} style={{ width: `${seg.pct}%` }}>
              {seg.pct > 12 && <span className="text-[10px] font-bold text-white">%{seg.pct}</span>}
            </div>
          ))}
        </div>

        {/* Platform sliders */}
        {[
          { key: 'meta'     as const, label: '📘 Meta',     val: p.meta,     usd: metaUSD,     fn: setMeta },
          { key: 'linkedin' as const, label: '💼 LinkedIn', val: p.linkedin, usd: linkedinUSD, fn: setLI },
          { key: 'google'   as const, label: '🔍 Google',   val: p.google,   usd: googleUSD,   fn: setGoogle },
        ].map(s => (
          <div key={s.key}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">{s.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">${s.usd}/{t('ay', 'mo')}</span>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200">%{s.val}</span>
              </div>
            </div>
            <input
              type="range" min={0} max={100} step={5} value={s.val}
              onChange={e => s.fn(Number(e.target.value))}
              className="w-full accent-ocean"
            />
          </div>
        ))}

        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          ≈ ${(total / 30).toFixed(0)}/{t('gün toplam', 'day total')} ·
          Meta ${(metaUSD / 30).toFixed(0)} · LI ${(linkedinUSD / 30).toFixed(0)} · Google ${(googleUSD / 30).toFixed(0)}
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

  const [budget, setBudget] = useState<BudgetAllocation>({
    totalMonthlyUSD: 500,
    platforms: { meta: 50, linkedin: 20, google: 30 },
  });

  // ── Load platform statuses + campaigns ───────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/ads/status').then(r => r.json() as Promise<AdPlatformStatus[]>),
      fetch('/api/ads/meta/campaigns').then(r => r.json() as Promise<CampaignsResponse>),
      fetch('/api/ads/linkedin/campaigns').then(r => r.json() as Promise<CampaignsResponse>),
      fetch('/api/ads/google/campaigns').then(r => r.json() as Promise<CampaignsResponse>),
    ]).then(([sts, meta, li, google]) => {
      setStatuses(sts);
      setCampaigns({ meta: meta.campaigns, linkedin: li.campaigns, google: google.campaigns });
      setSources({ meta: meta.source, linkedin: li.source, google: google.source });
      setErrors({ meta: meta.error || '', linkedin: li.error || '', google: google.error || '' });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // ── Create campaign ───────────────────────────────────────────────────────────
  const handleCreate = async (req: CreateCampaignRequest) => {
    setSaving(true);
    try {
      const res  = await fetch(`/api/ads/${req.platform}/campaigns`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(req),
      });
      const data = await res.json() as { success: boolean; campaignId: string; error?: string };
      if (!data.success) throw new Error(data.error || 'Failed');

      // Refresh campaigns for this platform
      const fresh = await fetch(`/api/ads/${req.platform}/campaigns`).then(r => r.json() as Promise<CampaignsResponse>);
      setCampaigns(prev => ({ ...prev, [req.platform]: fresh.campaigns }));
      setShowForm(false);
      setSaveSuccess(t('Kampanya oluşturuldu! DURAKLATILMIŞ olarak başlatıldı.', 'Campaign created! Started as PAUSED.'));
      setTimeout(() => setSaveSuccess(''), 4000);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t('Hata oluştu', 'An error occurred'));
    } finally {
      setSaving(false);
    }
  };

  // ── Pause / Resume ────────────────────────────────────────────────────────────
  const handleStatusChange = async (id: string, platform: AdPlatform, newStatus: 'ACTIVE' | 'PAUSED') => {
    setUpdatingId(id);
    try {
      await fetch(`/api/ads/${platform}/campaign/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: newStatus }),
      });
      setCampaigns(prev => ({
        ...prev,
        [platform]: prev[platform].map(c => c.id === id ? { ...c, status: newStatus } : c),
      }));
    } catch { /* ignore */ } finally { setUpdatingId(null); }
  };

  // ── Delete ────────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string, platform: AdPlatform) => {
    setUpdatingId(id);
    try {
      await fetch(`/api/ads/${platform}/campaign/${id}`, { method: 'DELETE' });
      setCampaigns(prev => ({
        ...prev,
        [platform]: prev[platform].filter(c => c.id !== id),
      }));
    } catch { /* ignore */ } finally { setUpdatingId(null); }
  };

  // ── Aggregated stats ──────────────────────────────────────────────────────────
  const allCampaigns = Object.values(campaigns).flat();
  const totalSpend   = allCampaigns.reduce((s, c) => s + (c.insights?.spend || 0), 0);
  const totalClicks  = allCampaigns.reduce((s, c) => s + (c.insights?.clicks || 0), 0);
  const totalImpr    = allCampaigns.reduce((s, c) => s + (c.insights?.impressions || 0), 0);
  const activeCamps  = allCampaigns.filter(c => c.status === 'ACTIVE').length;

  const activeTab = campaigns[activePlatform];
  const activeStatus = statuses.find(s => s.platform === activePlatform);

  return (
    <div className="flex flex-col gap-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            📣 {t('Kampanya Yöneticisi', 'Campaign Manager')}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('Meta · LinkedIn · Google Ads — gerçek zamanlı kampanya takibi', 'Meta · LinkedIn · Google Ads — real-time campaign management')}
          </p>
        </div>
      </div>

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: '📣', label: t('Aktif Kampanya', 'Active Campaigns'), value: String(activeCamps),               color: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700 text-green-800 dark:text-green-300' },
          { icon: '💸', label: t('Toplam Harcama',  'Total Spend'),      value: usd(totalSpend),                   color: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700 text-red-800 dark:text-red-300' },
          { icon: '👁️', label: t('Gösterim',        'Impressions'),      value: fmt(totalImpr),                    color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-300' },
          { icon: '🖱️', label: t('Tıklama',         'Clicks'),           value: fmt(totalClicks),                  color: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700 text-purple-800 dark:text-purple-300' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-4 flex items-start gap-3 ${s.color}`}>
            <span className="text-2xl">{s.icon}</span>
            <div>
              <div className="text-xl font-bold leading-tight">{loading ? '…' : s.value}</div>
              <div className="text-xs font-medium opacity-80">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Budget allocator ── */}
      <BudgetAllocator allocation={budget} onChange={setBudget} lang={lang} />

      {/* ── Platform status bar ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PLATFORMS.map(p => {
          const st  = statuses.find(s => s.platform === p);
          const meta = PLATFORM_META[p];
          return (
            <div key={p} className={`rounded-xl border p-3 flex items-center gap-3 ${meta.bg}`}>
              <span className="text-xl">{meta.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{meta.label}</p>
                <p className={`text-[10px] font-medium ${st?.configured ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {st?.configured
                    ? `✅ ${t('Bağlı', 'Connected')} · ${st.accountId}`
                    : `⚙️ ${t('.env.local\'da token gerekli', 'Token required in .env.local')}`}
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
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-700/50 rounded-xl p-1">
        {PLATFORMS.map(p => {
          const meta = PLATFORM_META[p];
          const cnt  = campaigns[p].length;
          return (
            <button
              key={p}
              onClick={() => { setActivePlatform(p); setShowForm(false); }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                activePlatform === p
                  ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-800 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {meta.icon} {meta.label}
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
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl px-4 py-3 text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
          ✅ {saveSuccess}
        </div>
      )}

      {/* ── Error banner ── */}
      {errors[activePlatform] && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-300">
          ❌ {errors[activePlatform]}
        </div>
      )}

      {/* ── Mock data notice ── */}
      {sources[activePlatform] === 'mock' && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-2.5 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
          ◐ {t(
            'Demo verisi gösteriliyor. Gerçek veri için .env.local\'a aşağıdaki API anahtarlarını ekleyin.',
            'Showing demo data. Add the API keys below to .env.local for live data.',
          )}
          <span className="ml-auto font-mono">{activeStatus?.configured ? '' : getEnvHint(activePlatform)}</span>
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
              {PLATFORM_META[activePlatform].icon} {PLATFORM_META[activePlatform].label} — {t('Kampanyalar', 'Campaigns')}
            </h3>
            <button
              onClick={() => setShowForm(v => !v)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                showForm
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  : 'bg-ocean hover:bg-ocean-dark text-white'
              }`}
            >
              {showForm ? `✕ ${t('İptal', 'Cancel')}` : `➕ ${t('Yeni Kampanya', 'New Campaign')}`}
            </button>
          </div>

          {showForm && (
            <CreateCampaignForm
              platform={activePlatform}
              lang={lang}
              onSave={handleCreate}
              onCancel={() => setShowForm(false)}
              saving={saving}
            />
          )}

          {activeTab.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 gap-3 text-slate-400">
              <span className="text-4xl opacity-20">📣</span>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('Bu platformda henüz kampanya yok.', 'No campaigns on this platform yet.')}
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="text-xs text-ocean hover:underline font-medium"
              >
                ➕ {t('İlk kampanyayı oluştur →', 'Create first campaign →')}
              </button>
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
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── .env.local setup guide ── */}
      <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
          ⚙️ {t('API Anahtarları (.env.local)', 'API Keys (.env.local)')}
        </p>
        <div className="space-y-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 leading-relaxed">
          <p className="text-slate-400 dark:text-slate-500"># ── Meta Ads (Facebook + Instagram) ──────────────────</p>
          <p>META_ADS_ACCESS_TOKEN=<span className="text-amber-600 dark:text-amber-400">&lt;System User Token veya User Token&gt;</span></p>
          <p>META_ADS_ACCOUNT_ID=<span className="text-amber-600 dark:text-amber-400">act_&lt;Ad Account ID&gt;</span></p>
          <p className="text-slate-400 dark:text-slate-500 mt-1"># ── LinkedIn Ads ──────────────────────────────────────</p>
          <p>LINKEDIN_ADS_ACCOUNT_ID=<span className="text-amber-600 dark:text-amber-400">&lt;Sponsored Account ID&gt;</span></p>
          <p className="text-slate-400 dark:text-slate-500 mt-1"># ── Google Ads ────────────────────────────────────────</p>
          <p>GOOGLE_ADS_DEVELOPER_TOKEN=<span className="text-amber-600 dark:text-amber-400">&lt;Developer Token&gt;</span></p>
          <p>GOOGLE_ADS_CLIENT_ID=<span className="text-amber-600 dark:text-amber-400">&lt;OAuth Client ID&gt;</span></p>
          <p>GOOGLE_ADS_CLIENT_SECRET=<span className="text-amber-600 dark:text-amber-400">&lt;OAuth Client Secret&gt;</span></p>
          <p>GOOGLE_ADS_REFRESH_TOKEN=<span className="text-amber-600 dark:text-amber-400">&lt;Refresh Token&gt;</span></p>
          <p>GOOGLE_ADS_CUSTOMER_ID=<span className="text-amber-600 dark:text-amber-400">&lt;Customer ID (no dashes)&gt;</span></p>
          <p>GOOGLE_ADS_LOGIN_CUSTOMER_ID=<span className="text-amber-600 dark:text-amber-400">&lt;MCC ID (varsa)&gt;</span></p>
        </div>
      </div>
    </div>
  );
}

function getEnvHint(platform: AdPlatform): string {
  if (platform === 'meta')     return 'META_ADS_ACCESS_TOKEN + META_ADS_ACCOUNT_ID';
  if (platform === 'linkedin') return 'LINKEDIN_ADS_ACCOUNT_ID';
  return 'GOOGLE_ADS_DEVELOPER_TOKEN + GOOGLE_ADS_CUSTOMER_ID + GOOGLE_ADS_REFRESH_TOKEN';
}
