'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import SeoGrowthOpportunities from './SeoGrowthOpportunities';
import { localeTag } from '@/lib/i18n/shared';
import { translateMessage } from '@/lib/i18n/messages';
import Msg from '@/components/Msg';
import { useDialog } from '@/components/a11y/useDialog';
import { onTabKeys } from '@/components/platform/tab-keys';

type Lang = 'tr' | 'en';
type Site = { id: string; name: string; baseUrl: string; sitemapUrl: string; timezone: string; isActive: boolean; scheduleEnabled?: boolean; schedule?: string; nextScheduledAt?: string | null };
type Crawl = { jobId: string; status: string; discoveredUrlCount: number; checkedUrlCount: number; error?: string | null };
type PageResult = { id: string; normalizedUrl: string; pageType: string; discoverySource: string; canonicalUrl: string; httpStatus: number | null; isIndexable: boolean | null; lastCheckedAt?: string | null; lastError?: string | null };
type Finding = { id: string; normalizedUrl: string; ruleCode: string; category: string; priority: string; evidence: string; recommendation: string; status: string; lastDetectedAt?: string | null };
type Recommendation = { id: string; findingGroupKey: string; affectedUrlCount: number; affectedUrls: string[]; status: string; implementationNote?: string | null; approvedAt?: string | null; appliedAt?: string | null };
type Owner = 'marketing' | 'frontend' | 'backend';
type ActionCard = { id: string; siteId: string; findingGroupKey: string; owner: Owner; status: 'open' | 'in_progress' | 'blocked' | 'completed' | 'cancelled'; brief: string; affectedUrls: string[]; priority?: 'low' | 'medium' | 'high'; implementationNote?: string | null; blockedReason?: string | null; createdAt: string; updatedAt: string };
type ActionSummary = { total: number; open: number; inProgress: number; blocked: number; completed: number; overdueCount: number };
type Tab = 'opportunities' | 'inventory' | 'findings' | 'recommendations' | 'schedule';

const pageSize = 25;
const local = (date?: string | null, lang: Lang = 'tr') => date ? new Date(date).toLocaleString(localeTag(lang)) : '—';
const pickLabel = (labels: Record<string, [string, string]>, value: string | undefined, lang: Lang) => value ? labels[value.toLowerCase()]?.[lang === 'tr' ? 0 : 1] || value : '—';
const priorityLabels: Record<string, [string, string]> = { critical: ['Kritik', 'Critical'], high: ['Yüksek', 'High'], medium: ['Orta', 'Medium'], warning: ['Uyarı', 'Warning'], low: ['Düşük', 'Low'], info: ['Bilgi', 'Info'] };
const crawlStatusLabels: Record<string, [string, string]> = { queued: ['Sırada', 'Queued'], pending: ['Sırada', 'Queued'], running: ['Taranıyor', 'Running'], completed: ['Tamamlandı', 'Completed'], partial: ['Kısmi', 'Partial'], failed: ['Başarısız', 'Failed'], cancelled: ['İptal edildi', 'Cancelled'] };
const actionStatusLabels: Record<string, [string, string]> = { open: ['Açık', 'Open'], in_progress: ['Devam ediyor', 'In progress'], blocked: ['Bloke', 'Blocked'], completed: ['Tamamlandı', 'Completed'], cancelled: ['İptal edildi', 'Cancelled'] };
const count = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = (value: unknown, fallback = '') => value === undefined || value === null ? fallback : String(value);
const recommendationStatus = (value: string, lang: Lang) => {
  const status = value.toLowerCase();
  const labels: Record<string, { tr: string; en: string; className: string }> = {
    proposed: { tr: 'Onay bekliyor', en: 'Proposed', className: 'border-sky-700 text-sky-300' },
    approved: { tr: 'Onaylandı', en: 'Approved', className: 'border-emerald-700 text-emerald-300' },
    rejected: { tr: 'Reddedildi', en: 'Rejected', className: 'border-slate-600 text-slate-300' },
    applied: { tr: 'Uygulandı', en: 'Applied', className: 'border-violet-700 text-violet-300' },
    resolved: { tr: 'Çözüldü', en: 'Resolved', className: 'border-emerald-700 text-emerald-300' },
  };
  return labels[status] || { tr: value, en: value, className: 'border-slate-600 text-slate-300' };
};
const itemList = (value: unknown) => {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Array.isArray(source.items) ? source.items as Record<string, unknown>[] : Array.isArray(value) ? value as Record<string, unknown>[] : [];
};

export default function SiteSeoOperations({ lang, onOpenCtrReport }: { lang: Lang; onOpenCtrReport: () => void }) {
  const tr = lang === 'tr';
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [form, setForm] = useState({ id: '', name: '', baseUrl: 'https://www.crewinjob.com', sitemapUrl: '', timezone: 'Europe/Istanbul', isActive: true });
  const [tab, setTab] = useState<Tab>('opportunities');
  const [records, setRecords] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [crawl, setCrawl] = useState<Crawl | null>(null);
  const [maxUrls, setMaxUrls] = useState(25);
  const [urlSearch, setUrlSearch] = useState('');
  const [httpFilter, setHttpFilter] = useState('all');
  const [indexFilter, setIndexFilter] = useState('all');
  const [schedule, setSchedule] = useState('interval:1440');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [actions, setActions] = useState<ActionCard[]>([]);
  const [actionSummary, setActionSummary] = useState<ActionSummary>({ total: 0, open: 0, inProgress: 0, blocked: 0, completed: 0, overdueCount: 0 });
  const [actionPlan, setActionPlan] = useState<Recommendation | null>(null);
  const [owner, setOwner] = useState<Owner>('frontend');
  const [brief, setBrief] = useState('');
  const selected = sites.find(site => site.id === selectedId) || null;
  const { titleId: planTitleId, dialogProps: planDialogProps } = useDialog(Boolean(actionPlan), () => setActionPlan(null));
  const ownerGroupId = useId();

  const request = useCallback(async (path: string, options?: RequestInit) => {
    const response = await fetch(path, { cache: 'no-store', ...options });
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok || data.error) throw new Error(translateMessage(text(data.error, tr ? 'SiteSeo isteği tamamlanamadı.' : 'The SiteSeo request could not be completed.'), lang));
    return data;
  }, [tr, lang]);

  const loadSites = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await request('/api/seo/site-health?action=sites');
      const next = itemList(data).map(item => ({ id: text(item.id), name: text(item.name), baseUrl: text(item.baseUrl), sitemapUrl: text(item.sitemapUrl), timezone: text(item.timezone, 'Europe/Istanbul'), isActive: item.isActive !== false, scheduleEnabled: Boolean(item.scheduleEnabled), schedule: text(item.schedule), nextScheduledAt: text(item.nextScheduledAt) || null })).filter(site => site.id);
      setSites(next);
      setSelectedId(current => next.some(site => site.id === current) ? current : next[0]?.id || '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : (tr ? 'SiteSeo servis hatası.' : 'SiteSeo service error.')); }
    finally { setLoading(false); }
  }, [request, tr]);

  const loadTab = useCallback(async () => {
    if (!selectedId || tab === 'schedule' || tab === 'opportunities') return;
    setLoading(true); setError('');
    const endpoint = tab === 'inventory' ? 'inventory' : tab === 'findings' ? 'findings' : 'recommendations';
    try {
      const data = await request(`/api/seo/site-health?action=${endpoint}&siteId=${encodeURIComponent(selectedId)}&skipCount=${offset}&maxResultCount=${pageSize}`);
      setRecords(itemList(data));
      setTotal(count(data.totalCount));
    } catch (reason) { setError(reason instanceof Error ? reason.message : (tr ? 'SiteSeo verisi alınamadı.' : 'SiteSeo data could not be loaded.')); }
    finally { setLoading(false); }
  }, [offset, request, selectedId, tab, tr]);

  const loadSchedule = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true); setError('');
    try {
      const data = await request(`/api/seo/site-health?action=schedule&siteId=${encodeURIComponent(selectedId)}`);
      setSchedule(text(data.schedule, 'interval:1440'));
      setScheduleEnabled(Boolean(data.enabled));
    } catch (reason) { setError(reason instanceof Error ? reason.message : (tr ? 'Zamanlama alınamadı.' : 'Schedule could not be loaded.')); }
    finally { setLoading(false); }
  }, [request, selectedId, tr]);

  const loadActions = useCallback(async () => {
    if (!selectedId) { setActions([]); setActionSummary({ total: 0, open: 0, inProgress: 0, blocked: 0, completed: 0, overdueCount: 0 }); return; }
    try {
      const [listResponse, summaryResponse] = await Promise.all([
        fetch(`/api/seo/actions?siteId=${encodeURIComponent(selectedId)}&skipCount=0&maxResultCount=100`, { cache: 'no-store' }),
        fetch(`/api/seo/actions?view=summary&siteId=${encodeURIComponent(selectedId)}`, { cache: 'no-store' }),
      ]);
      const listData = await listResponse.json() as Record<string, unknown>;
      const summaryData = await summaryResponse.json() as Record<string, unknown>;
      if (!listResponse.ok || listData.error) throw new Error(translateMessage(text(listData.error, tr ? 'SiteSeoAction listesi alınamadı.' : 'SiteSeoAction list could not be loaded.'), lang));
      if (!summaryResponse.ok || summaryData.error) throw new Error(translateMessage(text(summaryData.error, tr ? 'SiteSeoAction özeti alınamadı.' : 'SiteSeoAction summary could not be loaded.'), lang));
      setActions(itemList(listData).map(item => ({ id: text(item.id), siteId: text(item.siteId), findingGroupKey: text(item.findingGroupKey), owner: text(item.owner) as Owner, status: text(item.status, 'open') as ActionCard['status'], brief: text(item.brief), affectedUrls: Array.isArray(item.affectedUrls) ? item.affectedUrls.map(String) : [], priority: text(item.priority) as ActionCard['priority'], implementationNote: text(item.implementationNote) || null, blockedReason: text(item.blockedReason) || null, createdAt: text(item.creationTime), updatedAt: text(item.lastModificationTime) })));
      setActionSummary({ total: count(summaryData.total), open: count(summaryData.open), inProgress: count(summaryData.inProgress), blocked: count(summaryData.blocked), completed: count(summaryData.completed), overdueCount: count(summaryData.overdueCount) });
    } catch (reason) {
      setActions([]);
      setError(reason instanceof Error ? reason.message : (tr ? 'SiteSeoAction servisi erişilemedi.' : 'SiteSeoAction service is unreachable.'));
    }
  }, [selectedId, tr, lang]);

  useEffect(() => { void loadSites(); }, [loadSites]);
  useEffect(() => { setOffset(0); }, [selectedId, tab]);
  useEffect(() => { if (tab === 'schedule') void loadSchedule(); else if (tab !== 'opportunities') void loadTab(); }, [loadSchedule, loadTab, tab]);
  useEffect(() => { void loadActions(); }, [loadActions]);

  const saveSite = async () => {
    setSaving(true); setError('');
    try {
      await request('/api/seo/site-health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saveSite', ...form }) });
      setShowEditor(false); await loadSites();
    } catch (reason) { setError(reason instanceof Error ? reason.message : (tr ? 'Site kaydedilemedi.' : 'Site could not be saved.')); }
    finally { setSaving(false); }
  };

  const pollCrawl = async (jobId: string) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 2500));
      const data = await request(`/api/seo/site-health?action=crawlStatus&jobId=${encodeURIComponent(jobId)}`);
      const next = { jobId, status: text(data.status, 'running').toLowerCase(), discoveredUrlCount: count(data.discoveredUrlCount), checkedUrlCount: count(data.checkedUrlCount), error: text(data.error) || null };
      setCrawl(next);
      if (['completed', 'partial', 'failed', 'cancelled'].includes(next.status)) { if (['completed', 'partial'].includes(next.status)) await loadTab(); return; }
    }
    setError(tr ? 'Tarama durumu zaman aşımına uğradı; sayfayı yenileyerek tekrar kontrol edin.' : 'Crawl polling timed out; refresh to check again.');
  };

  const startCrawl = async () => {
    if (!selected) return;
    setSaving(true); setError('');
    try {
      const data = await request('/api/seo/site-health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'startCrawl', siteId: selected.id, maxUrls }) });
      const jobId = text(data.jobId || data.id || data.crawlJobId);
      if (!jobId) throw new Error(tr ? 'Backend tarama iş kimliği döndürmedi.' : 'The backend did not return a crawl job ID.');
      setCrawl({ jobId, status: 'queued', discoveredUrlCount: 0, checkedUrlCount: 0 });
      void pollCrawl(jobId);
    } catch (reason) { setError(reason instanceof Error ? reason.message : (tr ? 'Tarama başlatılamadı.' : 'Crawl could not be started.')); }
    finally { setSaving(false); }
  };

  const updateRecommendation = async (item: Recommendation, status: string) => {
    const implementationNote = status === 'applied' ? window.prompt(tr ? 'Uygulama notu' : 'Implementation note', item.implementationNote || '') : item.implementationNote || '';
    if (status === 'applied' && !implementationNote?.trim()) return;
    setSaving(true); setError('');
    try {
      await request('/api/seo/site-health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recommendation', siteId: selectedId, findingGroupKey: item.findingGroupKey, status, implementationNote }) });
      await Promise.all([loadTab(), loadActions()]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : (tr ? 'Öneri durumu güncellenemedi.' : 'Recommendation status could not be updated.')); }
    finally { setSaving(false); }
  };

  const openActionPlan = (item: Recommendation) => {
    const urls = item.affectedUrls.length ? item.affectedUrls.slice(0, 3).join(', ') : selected?.baseUrl || '';
    setOwner('frontend');
    setBrief(tr
      ? `${selected?.name || 'Site'} için “${item.findingGroupKey}” önerisini uygula. Etkilenen URL sayısı: ${item.affectedUrlCount}. Öncelikli URL’ler: ${urls}. Uygulama sonrası Site Denetimi üzerinden yeniden doğrula.`
      : `Apply the “${item.findingGroupKey}” recommendation for ${selected?.name || 'the site'}. Affected URLs: ${item.affectedUrlCount}. Priority URLs: ${urls}. Re-verify with Site Audit after implementation.`);
    setActionPlan(item);
  };

  const approveWithPlan = async () => {
    if (!actionPlan || !brief.trim()) return;
    setSaving(true); setError('');
    try {
      if (actionPlan.status !== 'approved') await request('/api/seo/site-health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recommendation', siteId: selectedId, findingGroupKey: actionPlan.findingGroupKey, status: 'approved', implementationNote: '' }) });
      const payload = { siteId: selectedId, findingGroupKey: actionPlan.findingGroupKey, owner, status: 'open', brief, affectedUrls: actionPlan.affectedUrls, priority: 'medium' };
      const response = await fetch('/api/seo/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(translateMessage(data.error, lang) || (tr ? 'İş kartı kaydedilemedi.' : 'Work card could not be saved.'));
      setActionPlan(null);
      await Promise.all([loadTab(), loadActions()]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : (tr ? 'Öneri onaylanamadı.' : 'Recommendation could not be approved.')); }
    finally { setSaving(false); }
  };

  const updateActionStatus = async (item: ActionCard, status: ActionCard['status']) => {
    const implementationNote = status === 'completed' ? window.prompt(tr ? 'Tamamlama notu' : 'Completion note', item.implementationNote || '') : item.implementationNote || '';
    const blockedReason = status === 'blocked' ? window.prompt(tr ? 'Blokaj nedeni' : 'Blocker reason', item.blockedReason || '') : item.blockedReason || '';
    if ((status === 'completed' && !implementationNote?.trim()) || (status === 'blocked' && !blockedReason?.trim())) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/seo/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', id: item.id, status, implementationNote, blockedReason }) });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(translateMessage(data.error, lang) || (tr ? 'İş kartı durumu güncellenemedi.' : 'Work card status could not be updated.'));
      await loadActions();
    } catch (reason) { setError(reason instanceof Error ? reason.message : (tr ? 'İş kartı durumu güncellenemedi.' : 'Work card status could not be updated.')); }
    finally { setSaving(false); }
  };

  const assignAction = async (item: ActionCard, nextOwner: Owner) => {
    if (item.owner === nextOwner) return;
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/seo/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'assign', id: item.id, owner: nextOwner }) });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(translateMessage(data.error, lang) || (tr ? 'Çözüm sahibi değiştirilemedi.' : 'Owner could not be changed.'));
      await loadActions();
    } catch (reason) { setError(reason instanceof Error ? reason.message : (tr ? 'Çözüm sahibi değiştirilemedi.' : 'Owner could not be changed.')); }
    finally { setSaving(false); }
  };

  const saveSchedule = async () => {
    if (!selectedId) return;
    setSaving(true); setError('');
    try {
      await request('/api/seo/site-health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'schedule', schedule: { siteId: selectedId, enabled: scheduleEnabled, schedule } }) });
      await loadSchedule(); await loadSites();
    } catch (reason) { setError(reason instanceof Error ? reason.message : (tr ? 'Zamanlama kaydedilemedi.' : 'Schedule could not be saved.')); }
    finally { setSaving(false); }
  };

  const filteredInventory = useMemo(() => records.filter(item => {
    const url = text(item.normalizedUrl).toLowerCase();
    const http = count(item.httpStatus);
    const indexable = item.isIndexable;
    return (!urlSearch || url.includes(urlSearch.toLowerCase())) && (httpFilter === 'all' || String(http) === httpFilter) && (indexFilter === 'all' || String(indexable) === indexFilter);
  }), [httpFilter, indexFilter, records, urlSearch]);
  const inventoryFiltersActive = Boolean(urlSearch.trim()) || httpFilter !== 'all' || indexFilter !== 'all';
  const pagerSummary = tab === 'inventory' && inventoryFiltersActive
    ? (tr
      ? `${filteredInventory.length} eşleşme (bu sayfada) · ${total} toplam kayıt`
      : `${filteredInventory.length} matches on this page · ${total} total records`)
    : undefined;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const activeCrawl = crawl && ['queued', 'running'].includes(crawl.status);

  return <section className="space-y-4 border border-slate-700 bg-slate-900/40 p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3 flex-wrap"><div><h2 className="text-base font-semibold text-slate-100">{tr ? 'SiteSeo operasyon merkezi' : 'SiteSeo operations hub'}</h2><p className="mt-1 text-xs text-slate-400">{tr ? 'Site, tarama, bulgu, öneri ve zamanlamayı aynı çalışma alanında yönetin.' : 'Manage sites, crawling, findings, recommendations, and scheduling in one workspace.'}</p></div><button type="button" onClick={() => { setForm({ id: '', name: '', baseUrl: 'https://www.crewinjob.com', sitemapUrl: '', timezone: 'Europe/Istanbul', isActive: true }); setShowEditor(true); }} className="border border-ocean px-3 py-2 text-xs font-semibold text-ocean hover:bg-ocean hover:text-white">{tr ? 'Site ekle' : 'Add site'}</button></div>

    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-3"><label className="text-xs text-slate-300"><span className="mb-1 block">{tr ? 'Aktif site' : 'Active site'}</span><select value={selectedId} onChange={event => setSelectedId(event.target.value)} className="w-full border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"><option value="">{tr ? 'Site seçin' : 'Select a site'}</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name} · {site.baseUrl}</option>)}</select></label>{selected && <div className="flex items-end gap-2"><button type="button" onClick={() => { setForm({ id: selected.id, name: selected.name, baseUrl: selected.baseUrl, sitemapUrl: selected.sitemapUrl, timezone: selected.timezone, isActive: selected.isActive }); setShowEditor(true); }} className="border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:border-ocean">{tr ? 'Düzenle' : 'Edit'}</button></div>}</div>

    {showEditor && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border border-slate-700 bg-slate-950/70 p-4"><Field label={tr ? 'Site adı' : 'Site name'} value={form.name} onChange={value => setForm(current => ({ ...current, name: value }))} /><Field label={tr ? 'Temel URL' : 'Base URL'} value={form.baseUrl} onChange={value => setForm(current => ({ ...current, baseUrl: value }))} /><Field label="Sitemap URL" value={form.sitemapUrl} onChange={value => setForm(current => ({ ...current, sitemapUrl: value }))} /><Field label={tr ? 'Saat dilimi' : 'Timezone'} value={form.timezone} onChange={value => setForm(current => ({ ...current, timezone: value }))} /><label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} />{tr ? 'Site aktif' : 'Site active'}</label><div className="flex items-end justify-end gap-2"><button type="button" onClick={() => setShowEditor(false)} className="border border-slate-600 px-3 py-2 text-sm text-slate-200">{tr ? 'Vazgeç' : 'Cancel'}</button><button type="button" disabled={saving || !form.baseUrl.trim()} onClick={() => void saveSite()} className="bg-ocean px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? '…' : (tr ? 'Kaydet' : 'Save')}</button></div></div>}

    {selected && <><div className="border border-sky-900 bg-sky-950/20 p-3"><div className="flex items-end justify-between gap-3 flex-wrap"><label className="text-xs text-slate-300"><span className="mb-1 block">{tr ? 'Tarama limiti' : 'Crawl limit'}</span><input type="number" min="1" max="500" value={maxUrls} onChange={event => setMaxUrls(Math.max(1, Math.min(500, Number(event.target.value) || 1)))} className="w-24 border border-slate-600 bg-slate-950 px-2 py-2 text-sm text-slate-100" /></label><button type="button" disabled={saving || Boolean(activeCrawl)} onClick={() => void startCrawl()} className="bg-ocean px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{activeCrawl ? (tr ? 'Tarama sürüyor' : 'Crawl running') : (tr ? 'Backend taramasını başlat' : 'Start backend crawl')}</button></div>{crawl && <div role="status" className="mt-3 text-xs text-slate-300"><span className="font-semibold text-ocean">{pickLabel(crawlStatusLabels, crawl.status, lang)}</span> · {crawl.checkedUrlCount}/{crawl.discoveredUrlCount || maxUrls} {tr ? 'URL kontrol edildi' : 'URLs checked'} · {crawl.jobId}{crawl.error ? ` · ${translateMessage(crawl.error, lang)}` : ''}</div>}</div>

      <div className="flex overflow-x-auto border-b border-slate-700" role="tablist" aria-label={tr ? 'SiteSeo bölümleri' : 'SiteSeo sections'} onKeyDown={onTabKeys}>{([{ id: 'opportunities', label: tr ? 'SEO fırsatları' : 'SEO opportunities' }, { id: 'inventory', label: tr ? 'URL envanteri' : 'URL inventory' }, { id: 'findings', label: tr ? 'Bulgular' : 'Findings' }, { id: 'recommendations', label: tr ? 'Öneriler ve işler' : 'Recommendations & tasks' }, { id: 'schedule', label: tr ? 'Otomatik tarama' : 'Scheduled crawling' }] as { id: Tab; label: string }[]).map(entry => <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} tabIndex={tab === entry.id ? 0 : -1} onClick={() => setTab(entry.id)} className={`shrink-0 border-b-2 px-3 py-2 text-sm ${tab === entry.id ? 'border-ocean text-ocean' : 'border-transparent text-slate-400 hover:text-slate-100'}`}>{entry.label}</button>)}</div>

      {tab === 'opportunities' && <SeoGrowthOpportunities siteId={selectedId} lang={lang} actionSummary={actionSummary} onOpenRecommendations={() => setTab('recommendations')} onOpenCtrReport={onOpenCtrReport} />}
      {tab === 'inventory' && <><div className="grid grid-cols-1 sm:grid-cols-3 gap-2"><input value={urlSearch} onChange={event => setUrlSearch(event.target.value)} placeholder={tr ? 'URL ara' : 'Search URL'} aria-label={tr ? 'URL ara' : 'Search URL'} className="border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100" /><select value={httpFilter} onChange={event => setHttpFilter(event.target.value)} aria-label={tr ? 'HTTP durum filtresi' : 'HTTP status filter'} className="border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"><option value="all">HTTP: {tr ? 'Tümü' : 'All'}</option><option value="200">200</option><option value="301">301</option><option value="404">404</option><option value="500">500</option></select><select value={indexFilter} onChange={event => setIndexFilter(event.target.value)} aria-label={tr ? 'İndeks filtresi' : 'Indexability filter'} className="border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100"><option value="all">{tr ? 'İndeks: Tümü' : 'Indexable: All'}</option><option value="true">{tr ? 'İndekslenebilir' : 'Indexable'}</option><option value="false">{tr ? 'İndeks dışı' : 'Not indexable'}</option></select></div><InventoryTable rows={filteredInventory.map(item => item as unknown as PageResult)} lang={lang} /></>}
      {tab === 'findings' && <FindingsList rows={records.map(item => item as unknown as Finding)} lang={lang} />}
      {tab === 'recommendations' && <><ActionSummaryBar summary={actionSummary} lang={lang} /><RecommendationsList rows={records.map(item => item as unknown as Recommendation)} actions={actions} lang={lang} saving={saving} onApprove={openActionPlan} onUpdate={updateRecommendation} onActionStatus={updateActionStatus} onAssign={assignAction} /></>}
      {tab === 'schedule' && <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 border border-slate-700 bg-slate-950/60 p-4"><label className="text-sm text-slate-200"><span className="mb-1 block">{tr ? 'Tarama aralığı' : 'Crawl schedule'}</span><input value={schedule} onChange={event => setSchedule(event.target.value)} placeholder="interval:1440" className="w-full border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100" /><span className="mt-1 block text-xs text-slate-400">{tr ? 'Dakika cinsinden örnek: interval:1440' : 'Example in minutes: interval:1440'}</span></label><div className="flex items-end gap-3"><label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={scheduleEnabled} onChange={event => setScheduleEnabled(event.target.checked)} />{tr ? 'Etkin' : 'Enabled'}</label><button type="button" disabled={saving} onClick={() => void saveSchedule()} className="bg-ocean px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{tr ? 'Zamanlamayı kaydet' : 'Save schedule'}</button></div><p className="sm:col-span-2 text-xs text-slate-400">{tr ? 'Sonraki çalışma:' : 'Next run:'} {local(selected.nextScheduledAt, lang)}</p></div>}
      {['inventory', 'findings', 'recommendations'].includes(tab) && <Pager offset={offset} total={total} onChange={setOffset} disabled={loading} lang={lang} totalPages={totalPages} summary={pagerSummary} />}</>}
    {loading && <p role="status" className="text-xs text-sky-300">{tr ? 'Backend verisi yükleniyor…' : 'Loading backend data…'}</p>}
    {error && <div role="alert" className="border border-red-800 bg-red-950/20 p-3 text-sm text-red-300"><Msg text={error}/></div>}
    {actionPlan && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"><div {...planDialogProps} className="w-full max-w-2xl border border-slate-600 bg-slate-900 p-5 shadow-xl"><div className="flex items-start justify-between gap-3"><div><h3 id={planTitleId} className="text-base font-semibold text-slate-100">{tr ? 'Çözüm işini planla' : 'Plan the resolution work'}</h3><p className="mt-1 text-xs text-slate-400">{actionPlan.affectedUrlCount} {tr ? 'URL etkileniyor' : 'URLs affected'} · {actionPlan.findingGroupKey}</p></div><button type="button" onClick={() => setActionPlan(null)} className="text-sm text-slate-400 hover:text-white" title={tr ? 'Kapat' : 'Close'} aria-label={tr ? 'Kapat' : 'Close'}><span aria-hidden="true">×</span></button></div><div className="mt-4"><p id={ownerGroupId} className="text-xs font-medium text-slate-300">{tr ? 'Çözüm sahibi' : 'Resolution owner'}</p><div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-labelledby={ownerGroupId}>{([{ id: 'marketing', label: tr ? 'Pazarlama' : 'Marketing' }, { id: 'frontend', label: 'Frontend' }, { id: 'backend', label: 'Backend' }] as { id: Owner; label: string }[]).map(choice => <button key={choice.id} type="button" aria-pressed={owner === choice.id} onClick={() => setOwner(choice.id)} className={`border px-3 py-2 text-sm font-semibold ${owner === choice.id ? 'border-ocean bg-ocean/20 text-sky-200' : 'border-slate-600 text-slate-300 hover:border-slate-400'}`}>{choice.label}</button>)}</div></div><label className="mt-4 block text-sm text-slate-200"><span className="mb-1 block">{tr ? 'Uygulanacak iş özeti' : 'Implementation brief'}</span><textarea value={brief} onChange={event => setBrief(event.target.value)} className="min-h-36 w-full border border-slate-600 bg-slate-950 p-3 text-sm text-slate-100" /></label><p className="mt-2 text-xs text-slate-400">{tr ? 'Onaydan sonra bu kart panelde çözüm sahibiyle görünür. Hedef sitede otomatik değişiklik yapılmaz.' : 'After approval, this card remains in the panel with its owner. No automatic site change is made.'}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setActionPlan(null)} className="border border-slate-600 px-3 py-2 text-sm text-slate-200">{tr ? 'Vazgeç' : 'Cancel'}</button><button type="button" disabled={saving || !brief.trim()} onClick={() => void approveWithPlan()} className="bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{tr ? 'Onayla ve iş kartı oluştur' : 'Approve and create work card'}</button></div></div></div>}
  </section>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="text-xs text-slate-300"><span className="mb-1 block">{label}</span><input value={value} onChange={event => onChange(event.target.value)} className="w-full border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100" /></label>; }
function Pager({ offset, total, totalPages, onChange, disabled, lang, summary }: { offset: number; total: number; totalPages: number; onChange: (value: number) => void; disabled: boolean; lang: Lang; summary?: string }) { const page = Math.floor(offset / pageSize) + 1; return <div className="flex items-center justify-between gap-3 text-xs text-slate-400"><span>{summary || `${total} ${lang === 'tr' ? 'kayıt' : 'records'}`} · {page}/{totalPages}</span><div className="flex gap-2"><button type="button" disabled={disabled || offset === 0} onClick={() => onChange(Math.max(0, offset - pageSize))} className="border border-slate-600 px-2 py-1 disabled:opacity-40">{lang === 'tr' ? 'Önceki' : 'Previous'}</button><button type="button" disabled={disabled || offset + pageSize >= total} onClick={() => onChange(offset + pageSize)} className="border border-slate-600 px-2 py-1 disabled:opacity-40">{lang === 'tr' ? 'Sonraki' : 'Next'}</button></div></div>; }
function InventoryTable({ rows, lang }: { rows: PageResult[]; lang: Lang }) { return <DataTable headers={['URL', 'HTTP', lang === 'tr' ? 'Tür' : 'Type', 'Canonical', lang === 'tr' ? 'İndeks' : 'Indexable', lang === 'tr' ? 'Son kontrol' : 'Last checked']} rows={rows.map(row => [row.normalizedUrl, row.httpStatus ?? '—', row.pageType || '—', row.canonicalUrl || '—', row.isIndexable === null ? '—' : row.isIndexable ? '✓' : '—', local(row.lastCheckedAt, lang)])} empty={lang === 'tr' ? 'URL envanteri henüz yok.' : 'No URL inventory yet.'} />; }
function FindingsList({ rows, lang }: { rows: Finding[]; lang: Lang }) { return <div className="space-y-2">{rows.length === 0 ? <Empty text={lang === 'tr' ? 'Bulgu yok.' : 'No findings.'} /> : rows.map(row => { const status = recommendationStatus(row.status, lang); return <article key={row.id} className="border border-slate-700 bg-slate-950/50 p-3"><div className="flex justify-between gap-3"><div><div className="flex flex-wrap gap-2"><span className="text-xs font-semibold text-amber-300">{pickLabel(priorityLabels, row.priority, lang)}</span><span className={`border px-2 py-0.5 text-[11px] ${status.className}`}>{lang === 'tr' ? status.tr : status.en}</span></div><h3 className="mt-1 text-sm font-semibold text-slate-100">{row.ruleCode} · {translateMessage(row.category, lang)}</h3></div><span className="text-xs text-slate-400">{local(row.lastDetectedAt, lang)}</span></div><p className="mt-2 break-words text-xs text-slate-300">{row.normalizedUrl}</p><p className="mt-2 text-sm text-slate-200">{translateMessage(row.recommendation, lang)}</p><p className="mt-2 border-l-2 border-slate-600 pl-2 text-xs text-slate-400">{translateMessage(row.evidence, lang)}</p></article>; })}</div>; }
function ActionSummaryBar({ summary, lang }: { summary: ActionSummary; lang: Lang }) {
  const values = [
    { label: lang === 'tr' ? 'Toplam iş' : 'Total tasks', value: summary.total },
    { label: lang === 'tr' ? 'Açık' : 'Open', value: summary.open },
    { label: lang === 'tr' ? 'Devam ediyor' : 'In progress', value: summary.inProgress },
    { label: lang === 'tr' ? 'Bloke' : 'Blocked', value: summary.blocked },
    { label: lang === 'tr' ? 'Tamamlandı' : 'Completed', value: summary.completed },
    { label: lang === 'tr' ? 'Geciken' : 'Overdue', value: summary.overdueCount },
  ];
  return <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{values.map(item => <div key={item.label} className="border border-slate-700 bg-slate-950/50 p-2"><p className="text-[11px] text-slate-400">{item.label}</p><p className="mt-1 text-base font-semibold text-slate-100">{item.value}</p></div>)}</div>;
}

function RecommendationsList({ rows, actions, lang, saving, onApprove, onUpdate, onActionStatus, onAssign }: { rows: Recommendation[]; actions: ActionCard[]; lang: Lang; saving: boolean; onApprove: (item: Recommendation) => void; onUpdate: (item: Recommendation, status: string) => void; onActionStatus: (item: ActionCard, status: ActionCard['status']) => void; onAssign: (item: ActionCard, owner: Owner) => void }) {
  const ownerLabel: Record<Owner, string> = { marketing: lang === 'tr' ? 'Pazarlama' : 'Marketing', frontend: 'Frontend', backend: 'Backend' };
  if (rows.length === 0) return <Empty text={lang === 'tr' ? 'Öneri grubu yok.' : 'No recommendation groups.'} />;
  return <div className="space-y-2">{rows.map(row => {
    const action = actions.find(item => item.findingGroupKey === row.findingGroupKey);
    const status = recommendationStatus(row.status, lang);
    return (
      <article key={row.id || row.findingGroupKey} className="border border-slate-700 bg-slate-950/50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className={`border px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>{lang === 'tr' ? status.tr : status.en}</span>
            <p className="mt-1 text-sm text-slate-100">{row.affectedUrlCount} {lang === 'tr' ? 'etkilenen URL' : 'affected URLs'}</p>
            <p className="mt-1 text-xs text-slate-400">{row.findingGroupKey}</p>
          </div>
          <div className="flex gap-2">
            {row.status === 'proposed' && <>
              <button type="button" disabled={saving} onClick={() => onApprove(row)} className="border border-emerald-600 px-2 py-1 text-xs text-emerald-300">{lang === 'tr' ? 'Çözümü planla' : 'Plan resolution'}</button>
              <button type="button" disabled={saving} onClick={() => onUpdate(row, 'rejected')} className="border border-slate-600 px-2 py-1 text-xs text-slate-300">{lang === 'tr' ? 'Reddet' : 'Reject'}</button>
            </>}
            {row.status === 'approved' && !action && <button type="button" disabled={saving} onClick={() => onApprove(row)} className="border border-emerald-600 px-2 py-1 text-xs text-emerald-300">{lang === 'tr' ? 'İş kartı oluştur' : 'Create work card'}</button>}
            {row.status === 'approved' && action?.status === 'completed' && <button type="button" disabled={saving} onClick={() => onUpdate(row, 'applied')} className="border border-violet-500 px-2 py-1 text-xs text-violet-300">{lang === 'tr' ? 'Uygulandı kaydı' : 'Record applied'}</button>}
          </div>
        </div>

        {action && <div className="mt-3 border-l-2 border-ocean bg-slate-900 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-sky-200">{lang === 'tr' ? 'Çözüm sahibi' : 'Resolution owner'}</p>
                <select value={action.owner} disabled={saving || ['completed', 'cancelled'].includes(action.status)} onChange={event => onAssign(action, event.target.value as Owner)} aria-label={lang === 'tr' ? 'Çözüm sahibi' : 'Resolution owner'} className="border border-slate-600 bg-slate-950 px-2 py-1 text-xs text-slate-200">
                  <option value="marketing">{ownerLabel.marketing}</option>
                  <option value="frontend">{ownerLabel.frontend}</option>
                  <option value="backend">{ownerLabel.backend}</option>
                </select>
                <span className="border border-slate-700 px-2 py-1 text-[11px] text-slate-300">{pickLabel(actionStatusLabels, action.status, lang)}</span>
              </div>
              <p className="mt-2 text-xs text-slate-300">{action.brief}</p>
              {action.blockedReason && <p className="mt-1 text-xs text-amber-300">{lang === 'tr' ? 'Blokaj:' : 'Blocked:'} {action.blockedReason}</p>}
              {action.implementationNote && <p className="mt-1 text-xs text-violet-300">{action.implementationNote}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {action.status === 'open' && <>
                <button type="button" disabled={saving} onClick={() => onActionStatus(action, 'in_progress')} className="border border-ocean px-2 py-1 text-xs text-sky-200">{lang === 'tr' ? 'Başlat' : 'Start'}</button>
                <button type="button" disabled={saving} onClick={() => onActionStatus(action, 'cancelled')} className="border border-slate-600 px-2 py-1 text-xs text-slate-300">{lang === 'tr' ? 'İptal et' : 'Cancel'}</button>
              </>}
              {action.status === 'in_progress' && <>
                <button type="button" disabled={saving} onClick={() => onActionStatus(action, 'blocked')} className="border border-amber-600 px-2 py-1 text-xs text-amber-200">{lang === 'tr' ? 'Bloke' : 'Block'}</button>
                <button type="button" disabled={saving} onClick={() => onActionStatus(action, 'completed')} className="border border-emerald-600 px-2 py-1 text-xs text-emerald-200">{lang === 'tr' ? 'Tamamla' : 'Complete'}</button>
              </>}
              {action.status === 'blocked' && <button type="button" disabled={saving} onClick={() => onActionStatus(action, 'in_progress')} className="border border-ocean px-2 py-1 text-xs text-sky-200">{lang === 'tr' ? 'Devam et' : 'Resume'}</button>}
            </div>
          </div>
        </div>}
        {row.implementationNote && <p className="mt-2 text-xs text-violet-300">{row.implementationNote}</p>}
      </article>
    );
  })}</div>;
}
function DataTable({ headers, rows, empty }: { headers: string[]; rows: Array<Array<string | number>>; empty: string }) { return <div className="overflow-x-auto border border-slate-700"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-950 text-slate-400"><tr>{headers.map(header => <th key={header} className="p-2 font-medium">{header}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={headers.length} className="p-5 text-center text-slate-400">{empty}</td></tr> : rows.map((row, index) => <tr key={index} className="border-t border-slate-800 text-slate-200">{row.map((cell, cellIndex) => <td key={cellIndex} className="max-w-80 truncate p-2" title={String(cell)}>{cell}</td>)}</tr>)}</tbody></table></div>; }
function Empty({ text }: { text: string }) { return <p className="border border-slate-700 p-4 text-center text-sm text-slate-400">{text}</p>; }
