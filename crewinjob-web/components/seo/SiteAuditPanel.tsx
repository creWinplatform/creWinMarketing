'use client';

import { useCallback, useEffect, useState } from 'react';
import SiteSeoOperations from './SiteSeoOperations';
import { localeTag } from '@/lib/i18n/shared';
import { translateMessage } from '@/lib/i18n/messages';
import Msg from '@/components/Msg';

type Priority = 'high' | 'medium' | 'low';
type WorkStatus = 'proposed' | 'approved' | 'rejected' | 'applied';
type Finding = { id: string; priority: Priority; category: string; title: string; detail: string; recommendation: string; evidence: string };
type AuditResult = {
  ok: boolean;
  source: string;
  checkedAt: string;
  requestedUrl: string;
  finalUrl: string;
  httpStatus: number;
  redirects: string[];
  summary: { title: string; description: string; h1Count: number; imageCount: number; imagesMissingAlt: number; canonical: string; robots: string | null; indexStatus: 'unknown'; robotsStatus: number | null; sitemapStatus: number | null };
  findings: Finding[];
  limitations: string[];
};
type CrawlResult = { ok: boolean; checkedAt: string; baseUrl: string; discoverySource: 'sitemap' | 'homepage_links'; discoveredCount: number; scannedCount: number; completedCount: number; failedCount: number; findingCount: number; groupedFindingCount: number; taskCount: number; pages: Array<{ url: string; httpStatus: number | null; findingCount: number; highCount: number; error: string | null }>; limitations: string[] };
type WorkItem = { id: string; url: string; title: string; recommendation: string; evidence: string; priority: Priority; status: WorkStatus; createdAt: string; updatedAt: string; appliedAt?: string; implementationNote?: string; affectedUrls?: string[]; source?: 'manual' | 'site_crawl'; backend?: boolean };
type CrawlProgress = { jobId: string; status: string; scanned: number; total: number };

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const recordList = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value.map(record).filter(item => Object.keys(item).length > 0);
  const source = record(value);
  return [source.items, source.results, source.data, source.records].find(Array.isArray)?.map(record).filter(item => Object.keys(item).length > 0) || [];
};
const text = (value: unknown, fallback = '') => value === undefined || value === null ? fallback : String(value);
const count = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const backendPriority = (value: unknown): Priority => {
  const priority = text(value).toLowerCase();
  return priority === 'high' || priority === 'critical' ? 'high' : priority === 'medium' || priority === 'warning' ? 'medium' : 'low';
};
const backendStatus = (value: unknown): WorkStatus => {
  const status = text(value).toLowerCase();
  return status === 'approved' || status === 'rejected' || status === 'applied' ? status : 'proposed';
};

// Rozet etiketleri [TR, EN]
const priorityMeta: Record<Priority, { label: [string, string]; className: string }> = {
  high: { label: ['Yüksek', 'High'], className: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' },
  medium: { label: ['Orta', 'Medium'], className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  low: { label: ['Düşük', 'Low'], className: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
};

const crawlStatusLabels: Record<string, [string, string]> = { queued: ['Sırada', 'Queued'], pending: ['Sırada', 'Queued'], running: ['Taranıyor', 'Running'], inprogress: ['Taranıyor', 'Running'], in_progress: ['Taranıyor', 'Running'], completed: ['Tamamlandı', 'Completed'], partial: ['Kısmi', 'Partial'], failed: ['Başarısız', 'Failed'], cancelled: ['İptal edildi', 'Cancelled'] };

const statusMeta: Record<WorkStatus, { label: [string, string]; className: string }> = {
  proposed: { label: ['Onay bekliyor', 'Awaiting approval'], className: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  approved: { label: ['Onaylandı', 'Approved'], className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  rejected: { label: ['Reddedildi', 'Rejected'], className: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  applied: { label: ['Uygulama kaydedildi', 'Implementation recorded'], className: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' },
};

export default function SiteAuditPanel({ lang, onExit, onOpenCtrReport }: { lang: 'tr' | 'en'; onExit: () => void; onOpenCtrReport: () => void }) {
  const tr = lang === 'tr', locale = localeTag(lang), tm = (value: string) => translateMessage(value, lang);
  const [url, setUrl] = useState('https://www.crewinjob.com');
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [crawl, setCrawl] = useState<CrawlResult | null>(null);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [crawlLoading, setCrawlLoading] = useState(false);
  const [crawlLimit, setCrawlLimit] = useState(25);
  const [crawlProgress, setCrawlProgress] = useState<CrawlProgress | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [applyItem, setApplyItem] = useState<WorkItem | null>(null);
  const [implementationNote, setImplementationNote] = useState('');

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch('/api/data/seo-work-items', { cache: 'no-store' });
      if (res.ok) setWorkItems(await res.json() as WorkItem[]);
    } catch { /* Uzak/local kayıt listesi erişilemezse denetim yine kullanılabilir. */ }
  }, []);

  useEffect(() => { void loadItems(); }, [loadItems]);

  const runAudit = async () => {
    setLoading(true); setError(''); setAudit(null);
    try {
      const res = await fetch('/api/seo/site-audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
      const data = await res.json() as AuditResult & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error || (tr ? 'Denetim tamamlanamadı.' : 'Audit could not be completed.'));
      setAudit(data);
      setUrl(data.finalUrl);
    } catch (err) { setError(err instanceof Error ? tm(err.message) : (tr ? 'Denetim tamamlanamadı.' : 'Audit could not be completed.')); }
    finally { setLoading(false); }
  };

  const runCrawl = async () => {
    setCrawlLoading(true); setError(''); setCrawl(null);
    try {
      let backendStarted = false;
      try {
        const start = await fetch('/api/seo/site-health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'startCrawl', baseUrl: url, maxUrls: crawlLimit }) });
        const startData = await start.json() as Record<string, unknown> & { error?: string };
        const jobId = text(startData.jobId || startData.id || startData.crawlJobId);
        if (!start.ok || startData.error || !jobId) throw new Error(startData.error || (tr ? 'Backend tarama işi başlatılamadı.' : 'The backend crawl job could not be started.'));
        backendStarted = true;
        const siteId = text(startData.siteId);
        setCrawlProgress({ jobId, status: 'queued', scanned: 0, total: crawlLimit });
        const startedAt = Date.now();
        let finalStatus: Record<string, unknown> = {};
        while (Date.now() - startedAt < 15 * 60 * 1000) {
          await new Promise(resolve => window.setTimeout(resolve, 1800));
          const statusResponse = await fetch(`/api/seo/site-health?action=crawlStatus&id=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
          const statusData = await statusResponse.json() as Record<string, unknown> & { error?: string };
          if (!statusResponse.ok || statusData.error) throw new Error(statusData.error || (tr ? 'Tarama durumu alınamadı.' : 'Crawl status could not be retrieved.'));
          const status = text(statusData.status, 'running').toLowerCase();
          const scanned = count(statusData.checkedUrlCount ?? statusData.scannedCount ?? statusData.completedCount ?? statusData.urlsScanned);
          const total = count(statusData.discoveredUrlCount ?? statusData.totalCount ?? statusData.totalUrls ?? statusData.urlCount, crawlLimit);
          setCrawlProgress({ jobId, status, scanned, total });
          finalStatus = statusData;
          if (['completed', 'partial', 'failed', 'cancelled'].includes(status)) break;
        }
        const terminal = text(finalStatus.status).toLowerCase();
        if (!['completed', 'partial'].includes(terminal)) throw new Error(terminal === 'cancelled' ? (tr ? 'Tarama iptal edildi.' : 'The crawl was cancelled.') : (tr ? 'Tarama tamamlanamadı.' : 'The crawl did not complete.'));
        const resultResponse = await fetch(`/api/seo/site-health?action=crawlResults&jobId=${encodeURIComponent(jobId)}&siteId=${encodeURIComponent(siteId)}&skipCount=0&maxResultCount=${encodeURIComponent(String(crawlLimit))}`, { cache: 'no-store' });
        const resultData = await resultResponse.json() as Record<string, unknown>;
        const pages = recordList(resultData).map(page => ({ url: text(page.url || page.finalUrl || page.address), httpStatus: count(page.httpStatus || page.statusCode) || null, findingCount: count(page.findingCount || page.findings), highCount: count(page.highCount || page.criticalCount), error: text(page.error || page.errorMessage) || null }));
        const totalFindings = count(finalStatus.findingCount ?? finalStatus.totalFindings, pages.reduce((sum, page) => sum + page.findingCount, 0));
        setCrawl({ ok: terminal === 'completed', checkedAt: new Date().toISOString(), baseUrl: url, discoverySource: 'sitemap', discoveredCount: count(finalStatus.discoveredUrlCount ?? finalStatus.discoveredCount ?? finalStatus.totalUrls, pages.length), scannedCount: count(finalStatus.checkedUrlCount ?? finalStatus.scannedCount ?? finalStatus.completedCount, pages.length), completedCount: count(finalStatus.checkedUrlCount ?? finalStatus.completedCount ?? finalStatus.scannedCount, pages.length), failedCount: count(finalStatus.failedCount), findingCount: totalFindings, groupedFindingCount: count(finalStatus.recommendationGroupCount), taskCount: count(finalStatus.recommendationCount), pages, limitations: [] });
        setUrl(url);
        void loadItems();
      } catch (backendError) {
        if (backendStarted) throw backendError;
        const res = await fetch('/api/seo/site-crawl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: url, maxPages: crawlLimit, autoCreateTasks: true }) });
        const data = await res.json() as CrawlResult & { error?: string };
        if (!res.ok || data.error) throw new Error(data.error || (backendError instanceof Error ? backendError.message : (tr ? 'Site taraması tamamlanamadı.' : 'Site crawl could not be completed.')));
        setCrawl(data); setUrl(data.baseUrl); void loadItems();
      }
    } catch (err) { setError(err instanceof Error ? tm(err.message) : (tr ? 'Site taraması tamamlanamadı.' : 'Site crawl could not be completed.')); }
    finally { setCrawlLoading(false); setCrawlProgress(null); }
  };

  const createRecommendation = async (finding: Finding) => {
    setSaving(finding.id);
    try {
      const res = await fetch('/api/data/seo-work-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: audit?.finalUrl, title: finding.title, recommendation: finding.recommendation, evidence: finding.evidence, priority: finding.priority }) });
      if (!res.ok) throw new Error();
      const item = await res.json() as WorkItem;
      setWorkItems(current => [item, ...current]);
    } catch { setError(tr ? 'Öneri kaydedilemedi.' : 'Recommendation could not be saved.'); }
    finally { setSaving(null); }
  };

  const updateStatus = async (item: WorkItem, status: WorkStatus, note?: string) => {
    setSaving(item.id);
    try {
      const res = await fetch(`/api/data/seo-work-items?id=${encodeURIComponent(item.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, implementationNote: note }) });
      if (!res.ok) throw new Error();
      const updated = await res.json() as WorkItem;
      setWorkItems(current => current.map(entry => entry.id === updated.id ? updated : entry));
      setApplyItem(null); setImplementationNote('');
    } catch { setError(tr ? 'Durum güncellenemedi.' : 'Status could not be updated.'); }
    finally { setSaving(null); }
  };

  const existingFor = (finding: Finding) => workItems.find(item => item.title === finding.title && item.url === audit?.finalUrl);

  return (
    <section className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-lg font-semibold text-slate-800 dark:text-slate-100">{tr ? 'Site denetimi' : 'Site audit'}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{tr ? 'Herkese açık bir sayfayı teknik, içerik ve dönüşüm sinyalleriyle inceleyin; önerileri onay akışına alın.' : 'Audit a public page for technical, content, and conversion signals, then move findings into approval.'}</p>
        </div>
        <button type="button" onClick={onExit} className="border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:border-ocean hover:text-ocean">{tr ? 'SEO araçlarına dön' : 'Back to SEO tools'}</button>
      </div>

      <SiteSeoOperations lang={lang} onOpenCtrReport={onOpenCtrReport} />

      <div className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 sm:p-5">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-end">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">{tr ? 'Herkese açık sayfa URL’si' : 'Public page URL'}</span>
            <input value={url} onChange={event => setUrl(event.target.value)} inputMode="url" placeholder="https://www.crewinjob.com" className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 outline-none focus:border-ocean focus:ring-2 focus:ring-ocean/20" />
          </label>
          <button type="button" onClick={() => void runAudit()} disabled={loading || !url.trim()} className="bg-ocean px-4 py-2.5 text-sm font-semibold text-white hover:bg-ocean-dark disabled:opacity-50">
            {loading ? (tr ? 'Denetleniyor…' : 'Auditing…') : (tr ? 'Denetimi başlat' : 'Run audit')}
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{tr ? 'Özel ağlar, yerel adresler ve özel portlar engellenir. En fazla 3 yönlendirme, 1.5 MB HTML ve 8 iç bağlantı kontrol edilir.' : 'Private networks, local addresses, and custom ports are blocked. The audit limits redirects, HTML size, and internal link checks.'}</p>
      </div>

      <div className="border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/20">
          <div className="flex items-start justify-between gap-3 flex-wrap"><div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{tr ? 'Tüm siteyi tara' : 'Scan the whole site'}</p><p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{tr ? 'Sitemap öncelikli URL envanteri çıkarır; tekrar eden yüksek ve orta öncelikli bulguları otomatik öneri kaydına dönüştürür.' : 'Builds a sitemap-first URL inventory and turns repeated high/medium findings into recommendations.'}</p></div><div className="flex items-end gap-2"><label className="text-xs text-slate-600 dark:text-slate-300"><span className="mb-1 block">{tr ? 'Maksimum sayfa' : 'Maximum pages'}</span><input type="number" min="1" max="500" value={crawlLimit} onChange={event => setCrawlLimit(Math.max(1, Math.min(500, Number(event.target.value) || 1)))} className="w-24 border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /></label><button type="button" onClick={() => void runCrawl()} disabled={crawlLoading || !url.trim()} className="bg-ocean px-4 py-2 text-sm font-semibold text-white hover:bg-ocean-dark disabled:opacity-50">{crawlLoading ? (tr ? 'Taranıyor…' : 'Scanning…') : (tr ? 'Site taramasını başlat' : 'Start site scan')}</button></div></div>
      </div>

      {crawlProgress && <div className="border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/20"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{tr ? 'Backend taraması sürüyor' : 'Backend crawl is in progress'}</p><p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{tr ? 'İş kimliği' : 'Job ID'}: {crawlProgress.jobId}</p></div><span className="text-sm font-semibold text-ocean">{crawlStatusLabels[crawlProgress.status]?.[tr ? 0 : 1] || crawlProgress.status}</span></div><div className="mt-3 h-2 overflow-hidden bg-sky-100 dark:bg-slate-700"><div className="h-full bg-ocean transition-all" style={{ width: `${Math.min(100, Math.round((crawlProgress.scanned / Math.max(1, crawlProgress.total)) * 100))}%` }} /></div><p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{crawlProgress.scanned}/{crawlProgress.total} {tr ? 'URL işlendi. Tarama arka planda devam eder; bu ekran düzenli durum güncellemesi alır.' : 'URLs processed. The crawl continues in the background while this screen polls for status.'}</p></div>}

      {error && <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/20 dark:text-red-300"><Msg text={error}/></div>}

      {crawl && <div className="border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"><div className="flex items-start justify-between gap-3 flex-wrap"><div><p className="text-base font-semibold text-slate-800 dark:text-slate-100">{tr ? 'Site taraması tamamlandı' : 'Site crawl completed'}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{crawl.discoverySource === 'sitemap' ? (tr ? 'Kaynak: sitemap' : 'Source: sitemap') : (tr ? 'Kaynak: ana sayfa bağlantıları' : 'Source: homepage links')} · {new Date(crawl.checkedAt).toLocaleString(locale)}</p></div><span className="text-xs text-slate-500 dark:text-slate-400">{crawl.baseUrl}</span></div><div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3"><Metric label={tr ? 'Keşfedilen' : 'Discovered'} value={String(crawl.discoveredCount)} /><Metric label={tr ? 'Taranan' : 'Scanned'} value={String(crawl.scannedCount)} /><Metric label={tr ? 'Bulgu' : 'Findings'} value={String(crawl.findingCount)} /><Metric label={tr ? 'Gruplanan' : 'Grouped'} value={String(crawl.groupedFindingCount)} /><Metric label={tr ? 'Öneri aksiyonu' : 'Recommendation actions'} value={String(crawl.taskCount)} /></div><div className="mt-4 max-h-64 overflow-auto border border-slate-200 dark:border-slate-700"><table className="w-full min-w-[640px] text-left text-xs"><thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/50 dark:text-slate-400"><tr><th className="p-2 font-medium">URL</th><th className="p-2 font-medium">HTTP</th><th className="p-2 font-medium">{tr ? 'Bulgu' : 'Findings'}</th><th className="p-2 font-medium">{tr ? 'Yüksek' : 'High'}</th></tr></thead><tbody>{crawl.pages.map(page => <tr key={page.url} className="border-t border-slate-200 dark:border-slate-700"><td className="max-w-96 truncate p-2 text-slate-700 dark:text-slate-200" title={page.url}>{page.error ? tm(page.error) : page.url}</td><td className="p-2 text-slate-500 dark:text-slate-400">{page.httpStatus ?? '—'}</td><td className="p-2 text-slate-700 dark:text-slate-200">{page.findingCount}</td><td className="p-2 font-semibold text-red-600 dark:text-red-300">{page.highCount}</td></tr>)}</tbody></table></div><p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{crawl.completedCount}/{crawl.scannedCount} {tr ? 'sayfa denetlendi' : 'pages audited'}{crawl.failedCount ? ` · ${crawl.failedCount} ${tr ? 'sayfa tamamlanamadı' : 'pages failed'}` : ''}. {tr ? 'Mevcut öneriler güncellenebilir; mükerrer kayıt oluşturulmaz.' : 'Existing recommendations may be updated; duplicates are not created.'}</p></div>}

      {audit && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric label={tr ? 'HTTP yanıtı' : 'HTTP response'} value={String(audit.httpStatus)} tone={audit.httpStatus < 400 ? 'good' : 'bad'} />
          <Metric label={tr ? 'Bulgular' : 'Findings'} value={String(audit.findings.length)} />
          <Metric label={tr ? 'H1 sayısı' : 'H1 count'} value={String(audit.summary.h1Count)} tone={audit.summary.h1Count === 1 ? 'good' : 'bad'} />
          <Metric label={tr ? 'İndeks durumu' : 'Index status'} value={tr ? 'Doğrulanmadı' : 'Not verified'} />
        </div>

        <div className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap"><div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{tr ? 'Denetim özeti' : 'Audit summary'}</p><a href={audit.finalUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-ocean hover:underline">{audit.finalUrl}</a></div><span className="text-xs text-slate-500 dark:text-slate-400">{new Date(audit.checkedAt).toLocaleString(locale)}</span></div>
          <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Detail label="Title" value={audit.summary.title || '—'} />
            <Detail label="Canonical" value={audit.summary.canonical || (tr ? 'Yok' : 'Missing')} />
            <Detail label={tr ? 'Meta description' : 'Meta description'} value={audit.summary.description || (tr ? 'Yok' : 'Missing')} />
            <Detail label={tr ? 'Robots / sitemap' : 'Robots / sitemap'} value={`${audit.summary.robotsStatus ?? '—'} / ${audit.summary.sitemapStatus ?? '—'}`} />
          </dl>
          {audit.redirects.length > 0 && <p className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">{tr ? 'Yönlendirmeler:' : 'Redirects:'} {audit.redirects.join(' → ')}</p>}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{tr ? 'Kanıtlı bulgular' : 'Evidence-based findings'}</h2><span className="text-xs text-slate-500 dark:text-slate-400">{audit.source === 'public_html' ? (tr ? 'Kaynak: herkese açık HTML' : 'Source: public HTML') : audit.source}</span></div>
          {audit.findings.length === 0 ? <div className="border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300">{tr ? 'Bu sınırlar içindeki kontrollerde sorun bulunmadı. Bu sonuç performans veya indeksleme ölçümü değildir.' : 'No issues were found within these checks. This is not a performance or indexation measurement.'}</div> : audit.findings.map(finding => {
            const item = existingFor(finding);
            return <article key={finding.id} className="border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap gap-2"><span className={`px-2 py-0.5 text-[11px] font-semibold ${priorityMeta[finding.priority].className}`}>{priorityMeta[finding.priority].label[tr ? 0 : 1]}</span><span className="text-xs text-slate-500 dark:text-slate-400">{tm(finding.category)}</span></div><h3 className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{tm(finding.title)}</h3></div>{item ? <span className={`px-2 py-1 text-[11px] font-medium ${statusMeta[item.status].className}`}>{statusMeta[item.status].label[tr ? 0 : 1]}</span> : <button type="button" disabled={saving === finding.id} onClick={() => void createRecommendation(finding)} className="border border-ocean px-3 py-1.5 text-xs font-semibold text-ocean hover:bg-ocean hover:text-white disabled:opacity-50">{saving === finding.id ? '…' : (tr ? 'Öneriye ekle' : 'Add to recommendations')}</button>}</div><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{tm(finding.detail)}</p><div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs"><div className="border-l-2 border-ocean bg-slate-50 p-3 text-slate-600 dark:border-sky-400 dark:bg-slate-900/40 dark:text-slate-300"><b className="block text-slate-800 dark:text-slate-100">{tr ? 'Önerilen düzeltme' : 'Suggested change'}</b><span className="mt-1 block">{tm(finding.recommendation)}</span></div><div className="border-l-2 border-slate-300 bg-slate-50 p-3 text-slate-500 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-400"><b className="block text-slate-700 dark:text-slate-200">{tr ? 'Kanıt' : 'Evidence'}</b><span className="mt-1 block break-words">{tm(finding.evidence)}</span></div></div></article>;
          })}
        </div>

        <div className="border-t border-slate-200 pt-5 dark:border-slate-700"><h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{tr ? 'Hızlı denetim kayıtları (yerel)' : 'Quick audit records (local)'}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{tr ? 'Bu kayıtlar panel sunucusunda tutulur ve üstteki ekip atamalı SiteSeo iş kartlarından ayrıdır. “Uygulandı” durumu hedef sitede otomatik yayın yapmaz.' : 'These records are stored on the panel server and are separate from the assigned SiteSeo work cards above. “Applied” does not publish changes to the target site.'}</p><div className="mt-3 space-y-2">{workItems.length === 0 ? <p className="py-4 text-sm text-slate-500 dark:text-slate-400">{tr ? 'Henüz kaydedilmiş yerel öneri yok.' : 'No local recommendations have been saved yet.'}</p> : workItems.map(item => <div key={item.id} className="border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"><div className="flex items-start justify-between gap-3 flex-wrap"><div><div className="flex gap-2"><span className={`px-2 py-0.5 text-[11px] font-semibold ${priorityMeta[item.priority].className}`}>{priorityMeta[item.priority].label[tr ? 0 : 1]}</span><span className={`px-2 py-0.5 text-[11px] font-semibold ${statusMeta[item.status].className}`}>{statusMeta[item.status].label[tr ? 0 : 1]}</span></div><p className="mt-2 text-sm font-semibold text-slate-800 dark:text-slate-100">{tm(item.title)}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{tm(item.recommendation)}</p>{item.affectedUrls && item.affectedUrls.length > 1 && <p className="mt-1 text-xs text-sky-700 dark:text-sky-300">{item.affectedUrls.length} {tr ? 'sayfada tespit edildi' : 'pages affected'}</p>}{item.implementationNote && <p className="mt-2 text-xs text-violet-700 dark:text-violet-300">{tr ? 'Uygulama notu:' : 'Implementation note:'} {item.implementationNote}</p>}</div><div className="flex gap-2">{item.status === 'proposed' && <><button type="button" disabled={saving === item.id} onClick={() => void updateStatus(item, 'approved')} className="border border-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-600 hover:text-white dark:text-emerald-300">{tr ? 'Onayla' : 'Approve'}</button><button type="button" disabled={saving === item.id} onClick={() => void updateStatus(item, 'rejected')} className="border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300">{tr ? 'Reddet' : 'Reject'}</button></>}{item.status === 'approved' && <button type="button" disabled={saving === item.id} onClick={() => { setApplyItem(item); setImplementationNote(item.implementationNote || ''); }} className="bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700">{tr ? 'Manuel uygulamayı kaydet' : 'Record manual implementation'}</button>}</div></div></div>)}</div></div>

        <div className="border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300"><b>{tr ? 'Sınırlar:' : 'Limits:'}</b><ul className="mt-1 list-disc pl-5 space-y-1">{audit.limitations.map(item => <li key={item}>{tm(item)}</li>)}</ul></div>
      </>}

      {applyItem && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg border border-slate-300 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"><h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{tr ? 'Manuel uygulamayı kaydet' : 'Record manual implementation'}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{tm(applyItem.title)}</p><label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">{tr ? 'Ne değişti?' : 'What changed?'}</label><textarea value={implementationNote} onChange={event => setImplementationNote(event.target.value)} className="mt-1 min-h-28 w-full border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" placeholder={tr ? 'Örn. Title ve meta description CMS üzerinden güncellendi.' : 'Example: Updated title and meta description in the CMS.'} /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setApplyItem(null)} className="border border-slate-300 px-3 py-2 text-sm dark:border-slate-600">{tr ? 'Vazgeç' : 'Cancel'}</button><button type="button" disabled={!implementationNote.trim() || saving === applyItem.id} onClick={() => void updateStatus(applyItem, 'applied', implementationNote)} className="bg-violet-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{tr ? 'Kaydı tamamla' : 'Save record'}</button></div></div></div>}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) { return <div className="border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"><p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p><p className={`mt-1 text-lg font-semibold ${tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-slate-800 dark:text-slate-100'}`}>{value}</p></div>; }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt><dd className="mt-0.5 break-words text-sm text-slate-800 dark:text-slate-100">{value}</dd></div>; }
