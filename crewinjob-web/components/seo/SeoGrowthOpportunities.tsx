'use client';

import { useCallback, useEffect, useState } from 'react';
import { localeTag } from '@/lib/i18n/shared';
import { translateMessage } from '@/lib/i18n/messages';

type Lang = 'tr' | 'en';
type ActionSummary = { total: number; open: number; inProgress: number; blocked: number; completed: number; overdueCount: number };
type CtrRow = { query: string; page: string; clicks: number; impressions: number; ctr: number; position: number };
type CtrPeriod = { startDate?: string; endDate?: string; days?: number };
type Finding = { ruleCode?: string; category?: string; priority?: string; normalizedUrl?: string; recommendation?: string; status?: string };
type Recommendation = { findingGroupKey?: string; affectedUrlCount?: number; status?: string };
type Acquisition = { summary?: { registrations?: number; attributedRegistrations?: number; unattributedRegistrations?: number; activatedSeafarers?: number; activationRate?: number }; sourceBreakdown?: Record<string, unknown>[]; from?: string; to?: string; generatedAt?: string; dataNote?: string };

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const unwrap = (value: unknown): Record<string, unknown> => {
  let current = asRecord(value);
  for (let index = 0; index < 3 && current.result && typeof current.result === 'object'; index += 1) current = asRecord(current.result);
  return current;
};
const list = <T,>(value: unknown): T[] => {
  const data = unwrap(value);
  if (Array.isArray(data.items)) return data.items as T[];
  if (Array.isArray(data.records)) return data.records as T[];
  if (Array.isArray(value)) return value as T[];
  return [];
};
const n = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const pct = (value: number, locale: string) => `${(value * 100).toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
const PRIORITY_LABELS: Record<string, [string, string]> = { critical: ['Kritik', 'Critical'], high: ['Yüksek', 'High'], medium: ['Orta', 'Medium'], low: ['Düşük', 'Low'] };

export default function SeoGrowthOpportunities({ siteId, lang, actionSummary, onOpenRecommendations, onOpenCtrReport }: { siteId: string; lang: Lang; actionSummary: ActionSummary; onOpenRecommendations: () => void; onOpenCtrReport: () => void }) {
  const tr = lang === 'tr', locale = localeTag(lang);
  const [ctrRows, setCtrRows] = useState<CtrRow[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [acquisition, setAcquisition] = useState<Acquisition | null>(null);
  const [gscState, setGscState] = useState<'loading' | 'ready' | 'empty' | 'unavailable'>('loading');
  const [growthState, setGrowthState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [technicalState, setTechnicalState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [checkedAt, setCheckedAt] = useState('');
  const [gscPeriod, setGscPeriod] = useState<CtrPeriod | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setErrors([]);
    setGscState('loading'); setGrowthState('loading'); setTechnicalState('loading');
    const start = new Date(); start.setDate(start.getDate() - 30);
    const from = start.toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const calls = await Promise.allSettled([
      fetch('/api/seo/ctr-report?range=30&ai=0', { cache: 'no-store' }).then(response => response.json()),
      fetch(`/api/growth/acquisition?from=${from}&to=${to}&interval=month`, { cache: 'no-store' }).then(async response => ({ ok: response.ok, data: await response.json() })),
      siteId ? Promise.all([
        fetch(`/api/seo/site-health?action=findings&siteId=${encodeURIComponent(siteId)}&skipCount=0&maxResultCount=100`, { cache: 'no-store' }).then(async response => ({ ok: response.ok, data: await response.json() })),
        fetch(`/api/seo/site-health?action=recommendations&siteId=${encodeURIComponent(siteId)}&skipCount=0&maxResultCount=100`, { cache: 'no-store' }).then(async response => ({ ok: response.ok, data: await response.json() })),
      ]) : Promise.resolve([]),
    ]);
    const problems: string[] = [];

    const ctrResult = calls[0];
    if (ctrResult.status === 'fulfilled') {
      const data = unwrap(ctrResult.value);
      if (data.ok === true && Array.isArray(data.rows)) {
        setCtrRows(data.rows as CtrRow[]);
        setGscState(data.rows.length ? 'ready' : 'empty');
        setCheckedAt(typeof data.fetchedAt === 'string' ? data.fetchedAt : '');
        setGscPeriod(asRecord(data.period) as CtrPeriod);
      } else {
        setCtrRows([]); setGscState('unavailable');
        if (data.notConfigured) problems.push(tr ? 'Search Console bağlantısı yapılandırılmamış.' : 'Search Console is not configured.');
        else if (typeof data.error === 'string') problems.push(translateMessage(data.error, lang));
      }
    } else { setCtrRows([]); setGscState('unavailable'); problems.push(tr ? 'Search Console raporu alınamadı.' : 'Could not load Search Console report.'); }

    const growthResult = calls[1];
    if (growthResult.status === 'fulfilled') {
      const { ok, data: raw } = growthResult.value;
      const envelope = asRecord(raw);
      if (ok && envelope.available === true) { setAcquisition(unwrap(envelope.result) as Acquisition); setGrowthState('ready'); }
      else { setAcquisition(null); setGrowthState('unavailable'); problems.push(tr ? 'GrowthAnalytics dönüşüm raporu şu an erişilemiyor.' : 'GrowthAnalytics conversion report is unavailable.'); }
    } else { setAcquisition(null); setGrowthState('unavailable'); problems.push(tr ? 'Dönüşüm raporu alınamadı.' : 'Could not load the conversion report.'); }

    const technicalResult = calls[2];
    if (technicalResult.status === 'fulfilled' && technicalResult.value.length === 2 && technicalResult.value.every(item => item.ok)) {
      setFindings(list<Finding>(technicalResult.value[0].data));
      setRecommendations(list<Recommendation>(technicalResult.value[1].data));
      setTechnicalState('ready');
    } else { setFindings([]); setRecommendations([]); setTechnicalState('unavailable'); problems.push(tr ? 'SiteSeo bulgu ve önerileri alınamadı.' : 'Could not load SiteSeo findings and recommendations.'); }
    setErrors(problems);
  }, [siteId, tr, lang]);

  useEffect(() => { void load(); }, [load]);

  const summary = acquisition?.summary;
  const organicSources = acquisition?.sourceBreakdown?.filter(item => /organic/i.test(String(item.source ?? item.medium ?? item.name ?? ''))).slice(0, 4) || [];
  const counts = { high: findings.filter(item => item.priority?.toLowerCase() === 'high' && item.status?.toLowerCase() !== 'resolved').length, proposed: recommendations.filter(item => item.status?.toLowerCase() === 'proposed').length, approved: recommendations.filter(item => item.status?.toLowerCase() === 'approved').length };
  const audience = (url: string) => /maritime-business|crew-management|bullseye/i.test(url) ? (tr ? 'Denizcilik işletmesi · URL yoluna göre' : 'Maritime business · inferred from URL path') : /seafarer|\/jobs?(\/|$)/i.test(url) ? (tr ? 'Denizci · URL yoluna göre' : 'Seafarer · inferred from URL path') : (tr ? 'Kitle belirsiz' : 'Audience unknown');

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-100">{tr ? 'Veriye dayalı fırsatlar' : 'Data-backed opportunities'}</h3><p className="mt-1 text-xs text-slate-400">{tr ? 'Search Console sinyalleri, ürün dönüşüm raporu ve SiteSeo işleri. Kaynaklar birbirine bağlanmadıysa ilişki varsayılmaz.' : 'Search Console signals, product conversion reports, and SiteSeo work. No relationship is inferred where sources are not joined.'}</p></div><button type="button" onClick={() => void load()} className="border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:border-ocean">{tr ? 'Verileri yenile' : 'Refresh data'}</button></div>

    {errors.length > 0 && <div role="alert" className="border border-amber-700 bg-amber-950/20 p-3 text-xs text-amber-200">{errors.join(' ')}</div>}

    <section className="border border-slate-700 bg-slate-950/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="text-sm font-semibold text-slate-100">{tr ? 'Organik arama fırsatları' : 'Organic search opportunities'}</h4><p className="mt-1 text-xs text-slate-400">{tr ? `Google Search Console · ${gscPeriod?.startDate || 'son 30 gün'} – ${gscPeriod?.endDate || ''} · sayfa ve sorgu` : `Google Search Console · ${gscPeriod?.startDate || 'last 30 days'} – ${gscPeriod?.endDate || ''} · page and query`}</p></div><span className="text-[11px] text-slate-500">{checkedAt ? `${tr ? 'Alındı' : 'Fetched'}: ${new Date(checkedAt).toLocaleString(locale)}` : ''}</span></div>
      <p className="mt-3 border-l-2 border-amber-500 pl-2 text-xs text-amber-200">{tr ? 'Öncelik, mevcut düşük-CTR raporunun pozisyon referans eğrisine dayalı sezgisel filtresidir; kayıp tıklama veya gelir tahmini olarak yorumlanmamalıdır.' : 'Prioritization uses the existing low-CTR report’s position-based heuristic; it is not an estimate of lost clicks or revenue.'}</p>
      {gscState === 'loading' && <p className="mt-3 text-xs text-sky-300">{tr ? 'Search Console verisi yükleniyor…' : 'Loading Search Console data…'}</p>}
      {gscState === 'unavailable' && <p className="mt-3 text-xs text-slate-400">{tr ? 'Gerçek Search Console verisi olmadığı için fırsat listesi gösterilmiyor.' : 'No opportunity list is shown without real Search Console data.'}</p>}
      {gscState === 'empty' && <p className="mt-3 text-xs text-slate-400">{tr ? 'Bu dönemde eşik üstü düşük-CTR fırsatı bulunmadı.' : 'No low-CTR opportunities above the report threshold were found in this period.'}</p>}
      {gscState === 'ready' && <div className="mt-3 space-y-2">{ctrRows.map((row, index) => <article key={`${row.page}-${row.query}`} className="border border-slate-800 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-semibold text-amber-200">{tr ? `Fırsat ${index + 1}` : `Opportunity ${index + 1}`}</span><span className="text-[11px] text-slate-400">{audience(row.page)}</span></div><p className="mt-1 break-all text-xs text-sky-200">{row.page}</p><p className="mt-1 text-sm text-slate-100">{tr ? 'Sorgu:' : 'Query:'} {row.query}</p><div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><Metric label={tr ? 'Gösterim' : 'Impressions'} value={n(row.impressions).toLocaleString(locale)} /><Metric label={tr ? 'Tıklama' : 'Clicks'} value={n(row.clicks).toLocaleString(locale)} /><Metric label="CTR" value={pct(n(row.ctr), locale)} /><Metric label={tr ? 'Ort. konum' : 'Avg. position'} value={n(row.position).toFixed(1)} /></div><p className="mt-2 text-xs text-slate-400">{tr ? 'Önerilen inceleme: sorgunun arama niyetiyle sayfa başlığı, açıklaması ve ilk ekran içeriğini karşılaştırın. Değişiklik yayınlanmaz.' : 'Suggested review: compare the query intent with the page title, description, and above-the-fold content. No change is published.'}</p><button type="button" onClick={onOpenCtrReport} className="mt-3 border border-ocean px-2.5 py-1.5 text-xs font-medium text-ocean hover:bg-ocean/10">{tr ? 'Mevcut CTR öneri raporunu aç' : 'Open existing CTR recommendations'}</button></article>)}</div>}
    </section>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <section className="border border-slate-700 bg-slate-950/40 p-3 sm:p-4"><h4 className="text-sm font-semibold text-slate-100">{tr ? 'Ürün dönüşüm sinyali · denizci' : 'Product conversion signal · seafarer'}</h4><p className="mt-1 text-xs text-slate-400">{tr ? `GrowthAnalytics · ${acquisition?.from || 'son 30 gün'}${acquisition?.to ? ` – ${acquisition.to}` : ''}` : `GrowthAnalytics · ${acquisition?.from || 'last 30 days'}${acquisition?.to ? ` – ${acquisition.to}` : ''}`}</p>
        {growthState === 'loading' && <p className="mt-3 text-xs text-sky-300">{tr ? 'Dönüşüm verisi yükleniyor…' : 'Loading conversion data…'}</p>}
        {growthState === 'unavailable' && <p className="mt-3 text-xs text-slate-400">{tr ? 'Gerçek dönüşüm verisi alınamadı; tahmini değer gösterilmiyor.' : 'Real conversion data is unavailable; no estimated values are shown.'}</p>}
        {growthState === 'ready' && <><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label={tr ? 'Kayıt' : 'Registrations'} value={summary?.registrations === undefined ? '—' : n(summary.registrations).toLocaleString(locale)} /><Metric label={tr ? 'Profil aktivasyonu' : 'Profile activation'} value={summary?.activatedSeafarers === undefined ? '—' : n(summary.activatedSeafarers).toLocaleString(locale)} /><Metric label={tr ? 'Aktivasyon oranı' : 'Activation rate'} value={summary?.activationRate === undefined ? '—' : `${n(summary.activationRate).toFixed(1)}%`} /><Metric label={tr ? 'Kaynağı ilişkilendirilen kayıt' : 'Source-attributed registrations'} value={summary?.attributedRegistrations === undefined ? '—' : n(summary.attributedRegistrations).toLocaleString(locale)} /></div>{organicSources.length > 0 && <div className="mt-3 text-xs text-slate-300">{tr ? 'Organik kaynak kırılımı' : 'Organic source breakdown'}: {organicSources.map((item, i) => <span key={i} className="mr-2">{String(item.source ?? item.medium ?? item.name)} · {n(item.registrations ?? item.count ?? item.total).toLocaleString(locale)}</span>)}</div>}<p className="mt-3 text-xs text-amber-200">{tr ? 'Rapor GSC sorgu/sayfa satırlarıyla kullanıcı bazında birleştirilmiş değil. SEO fırsatına dönüşüm atfı yapılamaz.' : 'This report is not joined to Search Console query/page rows at user level. Conversions cannot be attributed to an SEO opportunity.'}</p>{acquisition?.dataNote && <p className="mt-1 text-[11px] text-slate-500">{translateMessage(acquisition.dataNote, lang)}</p>}</>}
      </section>

      <section className="border border-slate-700 bg-slate-950/40 p-3 sm:p-4"><div className="flex items-start justify-between gap-2"><div><h4 className="text-sm font-semibold text-slate-100">{tr ? 'Teknik SEO ve uygulama işleri' : 'Technical SEO and implementation work'}</h4><p className="mt-1 text-xs text-slate-400">{tr ? 'Mevcut SiteSeo / SiteSeoAction kayıtları' : 'Existing SiteSeo / SiteSeoAction records'}</p></div><button type="button" onClick={onOpenRecommendations} className="shrink-0 border border-ocean px-2 py-1.5 text-xs text-ocean">{tr ? 'Önerileri aç' : 'Open recommendations'}</button></div>
        {technicalState === 'loading' && <p className="mt-3 text-xs text-sky-300">{tr ? 'SiteSeo kayıtları yükleniyor…' : 'Loading SiteSeo records…'}</p>}
        {technicalState === 'unavailable' && <p className="mt-3 text-xs text-slate-400">{tr ? 'Seçili site için mevcut teknik bulgu/öneri verisi alınamadı.' : 'Could not load existing technical findings/recommendations for this site.'}</p>}
        {technicalState === 'ready' && <><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Metric label={tr ? 'Açık yüksek öncelik' : 'Open high priority'} value={counts.high} /><Metric label={tr ? 'Onay bekliyor' : 'Awaiting approval'} value={counts.proposed} /><Metric label={tr ? 'Onaylı' : 'Approved'} value={counts.approved} /><Metric label={tr ? 'Açık/ilerleyen işler' : 'Open/in-progress tasks'} value={actionSummary.open + actionSummary.inProgress} /></div>{findings.filter(item => item.status?.toLowerCase() !== 'resolved').slice(0, 3).map((item, i) => <div key={`${item.ruleCode}-${item.normalizedUrl}-${i}`} className="mt-2 border-t border-slate-800 pt-2"><p className="text-xs font-medium text-slate-200">{item.ruleCode || item.category || (tr ? 'Teknik bulgu' : 'Technical finding')} <span className="text-amber-300">· {item.priority ? PRIORITY_LABELS[item.priority.toLowerCase()]?.[tr ? 0 : 1] || item.priority : '—'}</span></p><p className="mt-1 break-all text-[11px] text-slate-400">{item.normalizedUrl}</p></div>)}{findings.length === 0 && recommendations.length === 0 && <p className="mt-3 text-xs text-slate-400">{tr ? 'Son taramada açık teknik bulgu veya öneri yok.' : 'No open technical findings or recommendations in the latest crawl.'}</p>}<p className="mt-3 text-[11px] text-slate-500">{tr ? 'SiteSeo bulguları burada ikinci kez iş kartına dönüştürülmez; onay ve görev akışı mevcut Öneriler sekmesindedir.' : 'SiteSeo findings are not duplicated as tasks here; approval and task flow remains in the existing Recommendations tab.'}</p></>}
      </section>
    </div>

    <section className="border border-amber-800/70 bg-amber-950/15 p-3 sm:p-4"><h4 className="text-sm font-semibold text-amber-100">{tr ? 'Veri kapsamı ve eksikler' : 'Data coverage and gaps'}</h4><div className="mt-2 grid grid-cols-1 gap-2 text-xs text-amber-100/80 md:grid-cols-2"><p>{tr ? 'Şirket dönüşüm yolu (şirket kaydı → ilan → aday arama → CV unlock) için bu projede doğrulanmış ayrı GrowthAnalytics metrikleri bulunamadı; bu yüzden sayı üretilmiyor.' : 'No verified, separate GrowthAnalytics metrics for the company funnel (registration → job post → candidate search → CV unlock) were found in this project; no values are fabricated.'}</p><p>{tr ? 'SEO sayfası → dönüşüm ilişkilendirmesi için landing-page bazlı izinli event/attribution sözleşmesi eksik. GSC ve dönüşüm raporları ayrı kaynaklar olarak kalır.' : 'A consented landing-page event/attribution contract is missing to connect SEO pages to conversions. GSC and conversion reports remain separate sources.'}</p></div></section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="border border-slate-800 bg-slate-900/60 p-2"><p className="text-[10px] text-slate-400">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-100">{value}</p></div>; }
