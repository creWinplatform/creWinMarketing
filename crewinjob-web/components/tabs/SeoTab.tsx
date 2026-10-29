'use client';
import { useState, useCallback, useEffect, useId, isValidElement, cloneElement } from 'react';
import OutputPanel from '../OutputPanel';
import { getTextModel } from '../ModelPicker';
import { useLang } from '@/lib/lang';
import { localeTag } from '@/lib/i18n/shared';
import { translateMessage } from '@/lib/i18n/messages';
import Msg from '@/components/Msg';
import SiteAuditPanel from '@/components/seo/SiteAuditPanel';
import { onTabKeys } from '@/components/platform/tab-keys';
import { urlView } from '@/lib/url-view';
import CrewinSeoViews, { CREWIN_SEO_VIEWS, crewinSeoLabels, type CrewinSeoView } from '@/components/platform/CrewinSeoViews';
import type { WorkspaceContext } from '@/lib/platform/catalog';

type SubTab = 'blog' | 'seo' | 'keyword' | 'competitor' | 'ctr_report' | 'site_audit' | CrewinSeoView;

interface RealJob {
  jobId:      number | null;
  title:      string;
  company:    string;
  vesselType: string;
  duration:   string;
  salary:     string;
  location:   string;
}

interface CtrRow {
  query: string; page: string; clicks: number; impressions: number;
  ctr: number; position: number; expectedCtr: number; lostClicks: number;
}
interface CtrSuggestion {
  page: string; suggestedTitle: string; suggestedDescription: string; reasoning: string;
}
interface CtrReportResponse {
  ok: boolean; notConfigured?: boolean; error?: string; aiError?: string;
  rows?: CtrRow[]; suggestions?: CtrSuggestion[]; totalAnalyzed?: number; fetchedAt?: string;
}

const VESSEL_TYPES = [
  'Bulk Carrier', 'Tanker', 'Container Ship', 'Offshore Vessel',
  'Passenger Ship', 'Chemical Tanker', 'LNG/LPG Carrier', 'General Cargo',
];

const RANKS = [
  'Master', 'Chief Officer', '2nd Officer', '3rd Officer',
  'Chief Engineer', '2nd Engineer', '3rd Engineer', '4th Engineer',
  'AB Seaman', 'OS Seaman', 'Bosun', 'Cook', 'Electrician',
];

const INTENT_TYPES = [
  { value: 'all',           label: '🎯 Tümü',                                labelEn: '🎯 All' },
  { value: 'commercial',    label: '💼 Commercial (Karşılaştırma, Best of)', labelEn: '💼 Commercial (Comparison, Best of)' },
  { value: 'transactional', label: '💰 Transactional (Apply, Hire, Buy)',    labelEn: '💰 Transactional (Apply, Hire, Buy)' },
  { value: 'informational', label: '📚 Informational (How to, What is)',     labelEn: '📚 Informational (How to, What is)' },
];

// ── Öneri havuzları ────────────────────────────────────────────────────────────
const BLOG_SUGGESTIONS: string[][] = [
  [
    'How to Write a Seafarer CV That Gets Hired',
    'STCW Certificate Requirements 2026',
    'Life on a Bulk Carrier: A Day in the Life',
    'Maritime Salary Guide: Rank by Rank',
  ],
  [
    'How to Pass a Ship Captain Interview',
    'Chief Officer vs Chief Engineer: Career Paths',
    'Top 10 Ports Seafarers Love Most',
    'MLC 2006: Seafarer Rights Explained',
  ],
  [
    'Digitalization in Maritime: What Seafarers Need to Know',
    'Green Shipping: How Seafarers Adapt to New Regulations',
    'Mental Health at Sea: Breaking the Stigma',
    'From Cadet to Captain: A Complete Career Guide',
  ],
  [
    'Best Countries to Work as a Seafarer in 2026',
    'How CrewinJob Matches Seafarers with Top Companies',
    'Crew Management Best Practices for Ship Operators',
    'ECDIS Training: Why It Matters for Your Career',
  ],
  [
    'Understanding Flag State Inspections',
    'Port State Control: What Every Seafarer Must Know',
    'LNG Carrier Jobs: High Pay, High Demand',
    'How to Negotiate Your Seafarer Contract',
  ],
  [
    'Top Maritime Certifications Beyond STCW',
    'Seafarer Recruitment Trends for 2026',
    'How AI is Changing Maritime Recruitment',
    'Why Filipino Seafarers Dominate the Global Fleet',
  ],
];

const KEYWORD_SUGGESTIONS: string[][] = [
  ['seafarer jobs', 'maritime recruitment', 'deck officer vacancy', 'ship captain salary'],
  ['STCW certification', 'crewing agency', 'AB seaman jobs', 'chief engineer salary'],
  ['bulk carrier jobs', 'tanker crew jobs', 'offshore vessel hiring', 'LNG carrier officer'],
  ['how to become a seafarer', 'seafarer CV template', 'maritime job board', 'crew management software'],
  ['marine jobs Philippines', 'Turkish seafarer jobs', 'gemi adamı iş ilanları', 'denizcilik kariyer'],
];

const SEO_TEMPLATES: { jobTitle: string; vesselType: string; label: string }[] = [
  { jobTitle: 'Master',         vesselType: 'Container Ship',   label: '🚢 Master / Container' },
  { jobTitle: 'Chief Engineer', vesselType: 'Tanker',           label: '⚙️ C/E / Tanker' },
  { jobTitle: 'Chief Officer',  vesselType: 'Bulk Carrier',     label: '⚓ C/O / Bulker' },
  { jobTitle: '2nd Officer',    vesselType: 'Offshore Vessel',  label: '🛢️ 2/O / Offshore' },
  { jobTitle: 'AB Seaman',      vesselType: 'General Cargo',    label: '👷 AB / General Cargo' },
  { jobTitle: 'Cook',           vesselType: 'Passenger Ship',   label: '🍳 Cook / Passenger' },
];

// focus: AI istemine giden düzenlenebilir değer (TR kalır); etiketler TR/EN
const COMPETITOR_TEMPLATES: { label: string; labelEn: string; focus: string; focusEn: string }[] = [
  { label: '🌍 Genel Karşılaştırma', labelEn: '🌍 General comparison',   focus: 'SEO, ürün, fiyatlama, pazar payı', focusEn: 'SEO, product, pricing, market share' },
  { label: '📣 İçerik & SEO Odaklı', labelEn: '📣 Content & SEO focus',  focus: 'Blog stratejisi, keyword boşlukları, backlink profili', focusEn: 'Blog strategy, keyword gaps, backlink profile' },
  { label: '💰 Reklam & Büyüme',     labelEn: '💰 Ads & growth',         focus: 'Google Ads, sosyal medya reklamları, kullanıcı edinme maliyeti', focusEn: 'Google Ads, social media ads, user acquisition cost' },
  { label: '🎯 Ürün & UX Odaklı',    labelEn: '🎯 Product & UX focus',   focus: 'Arayüz karşılaştırma, özellik eksiklikleri, kullanıcı deneyimi', focusEn: 'Interface comparison, feature gaps, user experience' },
];

// ── Rastgele set seç (tekrar etmeme için indeks sakla) ────────────────────────
function pickSet<T>(pool: T[][], currentIdx: number): [T[], number] {
  let next = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && next === currentIdx) next = (next + 1) % pool.length;
  return [pool[next], next];
}

// Keyword Araştırma çıktısındaki markdown tablosunun ilk sütunundan keyword'leri çıkarır.
// AI serbest formatta markdown üretiyor — başlık/ayraç satırlarını ve boş hücreleri eler.
function extractKeywordsFromMarkdown(md: string): string[] {
  if (!md) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of md.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed.split('|').map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 2) continue;
    const first = cells[0].replace(/^\*\*|\*\*$/g, '').trim();
    if (!first) continue;
    if (/^:?-+:?$/.test(first.replace(/\s/g, ''))) continue; // ayraç satırı (|---|:---|---:|)
    if (/^keyword$/i.test(first)) continue;               // başlık satırı
    if (first.length > 60) continue;                      // tablo dışı uzun metin kaçtıysa ele
    const key = first.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(first);
  }
  return out;
}

// workspace: given in the Crewin workspace, it adds Ryzevo's SEO automation views (scheduled scan, opportunities, AI
// visibility, SEO topics) next to the tools below.
export default function SeoTab({ workspace }: { workspace?: WorkspaceContext } = {}) {
  const { lang } = useLang();

  const SUB_TABS: { id: SubTab; label: string; icon: string }[] = [
    { id: 'blog',       label: lang === 'tr' ? 'Blog Makalesi'    : 'Blog article',        icon: '📝' },
    { id: 'seo',        label: lang === 'tr' ? 'İlan SEO'         : 'Job posting SEO',             icon: '🔍' },
    { id: 'keyword',    label: lang === 'tr' ? 'Keyword Araştır'  : 'Keyword research',    icon: '🎯' },
    { id: 'competitor', label: lang === 'tr' ? 'Rakip Analizi'    : 'Competitor analysis', icon: '⚔️' },
    { id: 'ctr_report', label: lang === 'tr' ? 'Düşük CTR Raporu' : 'Low CTR report',      icon: '📉' },
    { id: 'site_audit', label: lang === 'tr' ? 'Site Denetimi'    : 'Site audit',           icon: '🧭' },
    ...(workspace ? CREWIN_SEO_VIEWS.map(id => ({ id, label: crewinSeoLabels(lang === 'tr')[id], icon: ({ ops: '🔁', opportunities: '📈', visibility: '🤖', topics: '🗂️' } as const)[id] })) : []),
  ];

  const [subTab,     setSubTab]     = useState<SubTab>(() => urlView<SubTab>(['blog', 'seo', 'keyword', 'competitor', 'ctr_report', 'site_audit', ...(workspace ? CREWIN_SEO_VIEWS : [])], 'blog'));
  const [blogTopic,  setBlogTopic]  = useState('');
  const [jobTitle,   setJobTitle]   = useState('Chief Officer');
  const [vesselType, setVesselType] = useState('Bulk Carrier');
  const [language,   setLanguage]   = useState<'tr' | 'en'>('en');

  // Keyword Araştırma'dan İlan SEO'ya taşınan hedef keyword — sekme değişse de kalıcı
  const [targetKeyword, setTargetKeyword] = useState('');
  const [competitorFocus, setCompetitorFocus] = useState('SEO, ürün, fiyatlama, pazar payı');

  // ── İlan SEO: gerçek ilan mı, manuel şablon mu ────────────────────────────────
  const [jobSourceMode, setJobSourceMode] = useState<'real' | 'manual'>('real');
  const [realJobs,        setRealJobs]        = useState<RealJob[]>([]);
  const [realJobsLoading, setRealJobsLoading] = useState(false);
  const [realJobsError,   setRealJobsError]   = useState('');
  const [jobSearch,       setJobSearch]       = useState('');
  const [selectedJob,     setSelectedJob]     = useState<RealJob | null>(null);

  const loadRealJobs = useCallback(async () => {
    setRealJobsLoading(true);
    setRealJobsError('');
    try {
      const res  = await fetch('/api/activation/job-listings?limit=60');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRealJobs(data.jobs || []);
    } catch (e: unknown) {
      setRealJobsError(e instanceof Error ? e.message : lang === 'tr' ? 'İlanlar yüklenemedi' : "Couldn't load job postings");
    } finally {
      setRealJobsLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    if (subTab === 'seo' && jobSourceMode === 'real' && realJobs.length === 0 && !realJobsLoading) {
      loadRealJobs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, jobSourceMode]);

  const filteredRealJobs = realJobs.filter(j => {
    const q = jobSearch.trim().toLowerCase();
    if (!q) return true;
    return j.title.toLowerCase().includes(q)
        || j.company.toLowerCase().includes(q)
        || j.vesselType.toLowerCase().includes(q)
        || j.location.toLowerCase().includes(q);
  });

  // Keyword research
  const [seedKeyword, setSeedKeyword] = useState('seafarer jobs');
  const [intent,      setIntent]      = useState('all');

  // Öneri setleri
  const [blogSetIdx,    setBlogSetIdx]    = useState(0);
  const [keywordSetIdx, setKeywordSetIdx] = useState(0);
  const [blogChips,     setBlogChips]     = useState<string[]>(BLOG_SUGGESTIONS[0]);
  const [keywordChips,  setKeywordChips]  = useState<string[]>(KEYWORD_SUGGESTIONS[0]);

  const refreshBlogChips = useCallback(() => {
    const [set, idx] = pickSet(BLOG_SUGGESTIONS, blogSetIdx);
    setBlogChips(set);
    setBlogSetIdx(idx);
  }, [blogSetIdx]);

  const refreshKeywordChips = useCallback(() => {
    const [set, idx] = pickSet(KEYWORD_SUGGESTIONS, keywordSetIdx);
    setKeywordChips(set);
    setKeywordSetIdx(idx);
  }, [keywordSetIdx]);

  const [output,        setOutput]        = useState('');
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [publishing,    setPublishing]    = useState(false);
  const [publishResult, setPublishResult] = useState<{
    success?: boolean; blogId?: number; title?: string;
    imageFileName?: string; localImageUrl?: string; syncNote?: string; error?: string;
  } | null>(null);
  const [blogImageData, setBlogImageData] = useState('');
  const [blogImageMime, setBlogImageMime] = useState('image/png');

  // ── Düşük CTR Raporu ────────────────────────────────────────────────────────
  const [ctrRange,    setCtrRange]    = useState<'7' | '30' | '90'>('30');
  const [ctrData,     setCtrData]     = useState<CtrReportResponse | null>(null);
  const [ctrLoading,  setCtrLoading]  = useState(false);
  const [ctrError,    setCtrError]    = useState('');

  const loadCtrReport = useCallback(async () => {
    setCtrLoading(true);
    setCtrError('');
    setCtrData(null);
    try {
      const res  = await fetch(`/api/seo/ctr-report?range=${ctrRange}&lang=${language}`);
      const data: CtrReportResponse = await res.json();
      if (!data.ok) throw new Error(data.error || (lang === 'tr' ? 'GSC yapılandırılmamış' : 'GSC not configured'));
      setCtrData(data);
    } catch (e: unknown) {
      setCtrError(e instanceof Error ? e.message : lang === 'tr' ? 'Hata oluştu' : 'An error occurred');
    } finally {
      setCtrLoading(false);
    }
  }, [ctrRange, language, lang]);

  const publishBlog = async () => {
    if (!output) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      const res  = await fetch('/api/blog/publish', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          content:   output,
          ...(blogImageData ? { imageData: blogImageData, imageMime: blogImageMime } : {}),
        }),
      });
      const data = await res.json() as typeof publishResult;
      setPublishResult(data);
    } catch (e: unknown) {
      setPublishResult({ error: e instanceof Error ? e.message : (lang === 'tr' ? 'Bağlantı hatası' : 'Connection error') });
    } finally {
      setPublishing(false);
    }
  };

  const generate = async () => {
    setLoading(true);
    setError('');
    setOutput('');
    setPublishResult(null);
    try {
      let body: Record<string, unknown> = { language, textModel: getTextModel() };

      if (subTab === 'blog') {
        body = { ...body, type: 'blog', topic: blogTopic || undefined };
      } else if (subTab === 'seo') {
        if (jobSourceMode === 'real' && selectedJob) {
          body = {
            ...body,
            type: 'seo_job',
            job: {
              id:               selectedJob.jobId,
              title:            selectedJob.title,
              vesselType:       selectedJob.vesselType,
              company:          selectedJob.company,
              location:         selectedJob.location,
              salary:           selectedJob.salary,
              contractDuration: selectedJob.duration,
            },
            targetKeyword: targetKeyword || undefined,
          };
        } else {
          body = { ...body, type: 'seo_job', jobTitle, vesselType, targetKeyword: targetKeyword || undefined };
        }
      } else if (subTab === 'keyword') {
        body = { ...body, type: 'keyword_research', seedKeyword, intent };
      } else if (subTab === 'competitor') {
        body = { ...body, type: 'competitor_analysis', focus: competitorFocus };
      }

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOutput(data.content);
      if (subTab === 'blog') { setBlogImageData(''); setBlogImageMime('image/png'); setPublishResult(null); }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : (lang === 'tr' ? 'Hata oluştu' : 'An error occurred'));
    } finally {
      setLoading(false);
    }
  };

  const buttonLabel = () => {
    if (loading) return lang === 'tr' ? 'Üretiliyor…' : 'Generating…';
    const flag = language === 'tr' ? '🇹🇷' : '🇬🇧';
    if (subTab === 'blog')        return `${flag} ${lang === 'tr' ? 'Makale Üret'          : 'Generate article'}`;
    if (subTab === 'seo')         return `${flag} ${lang === 'tr' ? 'SEO Meta Üret'        : 'Generate SEO meta'}`;
    if (subTab === 'keyword')     return `${flag} ${lang === 'tr' ? 'Keyword Listesi Üret' : 'Generate keyword list'}`;
    if (subTab === 'competitor')  return `${flag} ${lang === 'tr' ? 'Rakip Analizi Üret'   : 'Generate competitor analysis'}`;
    return lang === 'tr' ? 'Üret' : 'Generate';
  };

  if (workspace && (CREWIN_SEO_VIEWS as readonly string[]).includes(subTab)) {
    return <CrewinSeoViews view={subTab as CrewinSeoView} workspace={workspace} lang={lang} onView={setSubTab} onExit={() => setSubTab('blog')} />;
  }

  if (subTab === 'site_audit') {
    return <SiteAuditPanel lang={lang} onExit={() => setSubTab('blog')} onOpenCtrReport={() => setSubTab('ctr_report')} />;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Sol panel */}
      <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col gap-5">
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1 flex items-center gap-2">
            <span aria-hidden="true">🔎</span> {lang === 'tr' ? 'SEO & İçerik Stratejisi' : 'SEO & content strategy'}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {lang === 'tr'
              ? 'Blog, SEO meta, keyword araştırması ve rakip analizi.'
              : 'Blog, SEO meta, keyword research and competitor analysis.'}
          </p>
        </div>

        {/* Sub-tabs grid */}
        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label={lang === 'tr' ? 'SEO araçları' : 'SEO tools'} onKeyDown={onTabKeys}>
          {SUB_TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={subTab === t.id}
              tabIndex={subTab === t.id ? 0 : -1}
              onClick={() => { setSubTab(t.id); setOutput(''); setError(''); }}
              className={`flex items-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                subTab === t.id
                  ? 'bg-ocean text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              <span aria-hidden="true">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* ── Blog form ── */}
        {subTab === 'blog' && (
          <div className="flex flex-col gap-3">
            <Field label={lang === 'tr' ? 'Blog Konusu' : 'Blog topic'}>
              <input
                type="text"
                value={blogTopic}
                onChange={e => setBlogTopic(e.target.value)}
                placeholder={lang === 'tr' ? 'Konu yaz veya aşağıdan seç' : 'Type a topic or pick below'}
                className={selectClass}
              />
            </Field>

            {/* Öneri çipleri */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  💡 {lang === 'tr' ? 'Konu Önerileri' : 'Topic suggestions'}
                </span>
                <button
                  onClick={refreshBlogChips}
                  className="flex items-center gap-1 text-[11px] text-ocean hover:text-ocean-dark font-medium transition-colors"
                  title={lang === 'tr' ? 'Yeni öneriler' : 'New suggestions'}
                >
                  🔄 {lang === 'tr' ? 'Yenile' : 'Refresh'}
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                {blogChips.map((chip, i) => (
                  <button
                    key={i}
                    onClick={() => setBlogTopic(chip)}
                    aria-pressed={blogTopic === chip}
                    className={`text-left text-xs px-3 py-2 rounded-lg border transition-all ${
                      blogTopic === chip
                        ? 'bg-ocean/10 border-ocean text-ocean dark:text-sky-300'
                        : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-ocean hover:bg-ocean/5 hover:text-ocean'
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                {lang === 'tr'
                  ? 'Boş bırakırsanız AI en öncelikli konuyu seçer.'
                  : 'Leave empty to let AI pick the highest-priority topic.'}
              </p>
            </div>
          </div>
        )}

        {/* ── SEO Job form ── */}
        {subTab === 'seo' && (
          <div className="flex flex-col gap-3">
            {/* Keyword Araştırma'dan taşınan hedef keyword */}
            {targetKeyword && (
              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg p-2.5 flex items-center justify-between gap-2">
                <p className="text-xs text-purple-700 dark:text-purple-300">
                  🎯 {lang === 'tr' ? 'Hedef keyword:' : 'Target keyword:'} <strong>&quot;{targetKeyword}&quot;</strong>
                </p>
                <button
                  onClick={() => setTargetKeyword('')}
                  className="text-[11px] text-purple-500 hover:text-purple-700 dark:hover:text-purple-200 flex-shrink-0"
                  title={lang === 'tr' ? 'Temizle' : 'Clear'}
                  aria-label={lang === 'tr' ? 'Hedef keyword\'ü temizle' : 'Clear target keyword'}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Kaynak modu: gerçek ilan mı, manuel şablon mu */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setJobSourceMode('real')}
                aria-pressed={jobSourceMode === 'real'}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors border-2 ${
                  jobSourceMode === 'real'
                    ? 'bg-ocean text-white border-ocean'
                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-ocean/50'
                }`}
              >
                📋 {lang === 'tr' ? 'Gerçek İlan Seç' : 'Pick a live job posting'}
              </button>
              <button
                onClick={() => setJobSourceMode('manual')}
                aria-pressed={jobSourceMode === 'manual'}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition-colors border-2 ${
                  jobSourceMode === 'manual'
                    ? 'bg-ocean text-white border-ocean'
                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-ocean/50'
                }`}
              >
                ✏️ {lang === 'tr' ? 'Manuel Şablon' : 'Manual template'}
              </button>
            </div>

            {jobSourceMode === 'real' ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-slate-600 dark:text-slate-400">
                  {lang === 'tr'
                    ? 'Platformda yayında olan gerçek bir ilan seçin — üretilen meta o ilanın çalışan URL\'ine bağlanır.'
                    : 'Pick a job posting that is live on the platform — the generated meta links to that posting\'s working URL.'}
                </p>
                <input
                  type="text"
                  value={jobSearch}
                  onChange={e => setJobSearch(e.target.value)}
                  placeholder={lang === 'tr' ? 'Pozisyon, şirket, gemi tipi ara…' : 'Search position, company, vessel type…'}
                  aria-label={lang === 'tr' ? 'İlan ara' : 'Search job postings'}
                  className={selectClass}
                />
                {realJobsLoading && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2 py-2">
                    <span className="w-3.5 h-3.5 border-2 border-ocean border-t-transparent rounded-full animate-spin" />
                    {lang === 'tr' ? 'İlanlar yükleniyor…' : 'Loading job postings…'}
                  </p>
                )}
                {realJobsError && (
                  <p role="alert" className="text-xs text-red-500">❌ <Msg text={realJobsError} /></p>
                )}
                {!realJobsLoading && !realJobsError && (
                  <div className="max-h-64 overflow-y-auto flex flex-col gap-1.5 border border-slate-200 dark:border-slate-600 rounded-lg p-2">
                    {filteredRealJobs.length === 0 && (
                      <p className="text-xs text-slate-600 dark:text-slate-400 text-center py-4">
                        {lang === 'tr' ? 'Sonuç bulunamadı.' : 'No results found.'}
                      </p>
                    )}
                    {filteredRealJobs.map((j, i) => (
                      <button
                        key={j.jobId ?? i}
                        onClick={() => setSelectedJob(j)}
                        aria-pressed={selectedJob?.jobId === j.jobId}
                        className={`text-left text-xs px-3 py-2 rounded-lg border transition-all ${
                          selectedJob?.jobId === j.jobId
                            ? 'bg-ocean/10 border-ocean text-ocean dark:text-sky-300'
                            : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-ocean hover:bg-ocean/5'
                        }`}
                      >
                        <p className="font-semibold">{j.title || '—'} <span className="font-normal opacity-70">· {j.vesselType}</span></p>
                        <p className="text-[10px] opacity-70 mt-0.5">{j.company} — {j.location}{j.salary ? ` — ${j.salary}` : ''}</p>
                      </button>
                    ))}
                  </div>
                )}
                {selectedJob && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-lg p-2.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                    ✅ {lang === 'tr' ? 'Seçili:' : 'Selected:'} <strong>{selectedJob.title}</strong> ({selectedJob.vesselType}) — ID {selectedJob.jobId}
                  </div>
                )}
              </div>
            ) : (
              <>
                <Field label={lang === 'tr' ? 'Pozisyon / Rütbe' : 'Position / rank'}>
                  <select value={jobTitle} onChange={e => setJobTitle(e.target.value)} className={selectClass}>
                    {RANKS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
                <Field label={lang === 'tr' ? 'Gemi Tipi' : 'Vessel type'}>
                  <select value={vesselType} onChange={e => setVesselType(e.target.value)} className={selectClass}>
                    {VESSEL_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>

                {/* Hızlı şablonlar */}
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    ⚡ {lang === 'tr' ? 'Hızlı Şablonlar' : 'Quick templates'}
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {SEO_TEMPLATES.map((t, i) => (
                      <button
                        key={i}
                        onClick={() => { setJobTitle(t.jobTitle); setVesselType(t.vesselType); }}
                        aria-pressed={jobTitle === t.jobTitle && vesselType === t.vesselType}
                        className={`text-left text-[11px] px-2.5 py-1.5 rounded-lg border transition-all ${
                          jobTitle === t.jobTitle && vesselType === t.vesselType
                            ? 'bg-ocean/10 border-ocean text-ocean dark:text-sky-300'
                            : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-ocean hover:bg-ocean/5'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Keyword Research form ── */}
        {subTab === 'keyword' && (
          <div className="flex flex-col gap-3">
            <Field label={lang === 'tr' ? 'Tohum Keyword' : 'Seed keyword'}>
              <input
                type="text"
                value={seedKeyword}
                onChange={e => setSeedKeyword(e.target.value)}
                placeholder={lang === 'tr' ? 'Örn: seafarer jobs, gemi adamı işleri' : 'e.g. seafarer jobs, maritime careers'}
                className={selectClass}
              />
            </Field>

            {/* Öneri çipleri */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  💡 {lang === 'tr' ? 'Keyword Önerileri' : 'Keyword ideas'}
                </span>
                <button
                  onClick={refreshKeywordChips}
                  title={lang === 'tr' ? 'Yeni öneriler' : 'New suggestions'}
                  className="flex items-center gap-1 text-[11px] text-ocean hover:text-ocean-dark font-medium transition-colors"
                >
                  🔄 {lang === 'tr' ? 'Yenile' : 'Refresh'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {keywordChips.map((chip, i) => (
                  <button
                    key={i}
                    onClick={() => setSeedKeyword(chip)}
                    aria-pressed={seedKeyword === chip}
                    className={`text-[11px] px-2.5 py-1.5 rounded-full border transition-all ${
                      seedKeyword === chip
                        ? 'bg-ocean text-white border-ocean'
                        : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-ocean hover:bg-ocean/5 hover:text-ocean'
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>

            <Field label={lang === 'tr' ? 'Arama Niyeti (Search Intent)' : 'Search intent'}>
              <select value={intent} onChange={e => setIntent(e.target.value)} className={selectClass}>
                {INTENT_TYPES.map(i => <option key={i.value} value={i.value}>{lang === 'tr' ? i.label : i.labelEn}</option>)}
              </select>
            </Field>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              {lang === 'tr'
                ? 'Bu keyword\'den 30+ uzun kuyruk + topic cluster üretilir.'
                : 'Generates 30+ long-tail keywords + topic clusters from this seed.'}
            </p>
          </div>
        )}

        {/* ── Competitor Analysis form ── */}
        {subTab === 'competitor' && (
          <div className="flex flex-col gap-3">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300 flex gap-2">
              <span className="text-base" aria-hidden="true">⚔️</span>
              <div>
                <p className="font-semibold mb-1">{lang === 'tr' ? 'Analiz edilecek rakipler:' : 'Competitors to analyze:'}</p>
                <p className="text-[11px] leading-relaxed">
                  Martide, Maritime Connector, MarineLink, SeafarerJobs, Crew24, Jobfish, Bureau Maritime
                </p>
              </div>
            </div>

            {/* Analiz odağı şablonları */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                🎯 {lang === 'tr' ? 'Analiz Odağı' : 'Analysis focus'}
              </span>
              <div className="flex flex-col gap-1.5">
                {COMPETITOR_TEMPLATES.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => setCompetitorFocus(t.focus)}
                    aria-pressed={competitorFocus === t.focus}
                    className={`text-left text-xs px-3 py-2.5 rounded-lg border transition-all ${
                      competitorFocus === t.focus
                        ? 'bg-ocean/10 border-ocean text-ocean dark:text-sky-300'
                        : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-ocean hover:bg-ocean/5'
                    }`}
                  >
                    <p className="font-medium">{lang === 'tr' ? t.label : t.labelEn}</p>
                    <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5">{lang === 'tr' ? t.focus : t.focusEn}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Düşük CTR Raporu form ── */}
        {subTab === 'ctr_report' && (
          <div className="flex flex-col gap-3">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-300 flex gap-2">
              <span className="text-base" aria-hidden="true">📉</span>
              <p className="leading-relaxed">
                {lang === 'tr'
                  ? 'Google\'da iyi pozisyonda gösterilen ama beklenenin çok altında tıklanan sayfaları bulur ve AI ile yeni başlık/açıklama önerir.'
                  : 'Finds pages ranking well on Google but clicked far less than expected, and suggests AI-generated title/description fixes.'}
              </p>
            </div>
            <Field group label={lang === 'tr' ? 'Zaman Aralığı' : 'Date range'}>
              <div className="grid grid-cols-3 gap-2">
                {(['7', '30', '90'] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setCtrRange(r)}
                    aria-pressed={ctrRange === r}
                    className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors border-2 ${
                      ctrRange === r
                        ? 'bg-ocean text-white border-ocean'
                        : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-ocean/50'
                    }`}
                  >
                    {r} {lang === 'tr' ? 'gün' : 'days'}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        )}

        {/* Dil */}
        {subTab !== 'ctr_report' && (
        <Field group label={lang === 'tr' ? 'İçerik Dili' : 'Content language'}>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'tr', flag: '🇹🇷', label: 'Türkçe' },
              { value: 'en', flag: '🇬🇧', label: 'English' },
            ] as { value: 'tr' | 'en'; flag: string; label: string }[]).map(l => (
              <button
                key={l.value}
                onClick={() => setLanguage(l.value)}
                aria-pressed={language === l.value}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors border-2 ${
                  language === l.value
                    ? 'bg-ocean text-white border-ocean'
                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-ocean/50 hover:bg-slate-50 dark:hover:bg-slate-600'
                }`}
              >
                <span className="text-base" aria-hidden="true">{l.flag}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
          {subTab === 'blog' && language === 'en' && (
            <p className="text-[11px] text-slate-600 dark:text-slate-400">💡 {lang === 'tr' ? 'SEO blog için İngilizce önerilir (global kitle).' : 'English is recommended for SEO blogs (global audience).'}</p>
          )}
          {subTab === 'keyword' && language === 'en' && (
            <p className="text-[11px] text-slate-600 dark:text-slate-400">💡 {lang === 'tr' ? 'Maritime sektörü çoğunlukla İngilizce arama yapar.' : 'The maritime industry mostly searches in English.'}</p>
          )}
        </Field>
        )}

        {subTab === 'ctr_report' ? (
          <button
            onClick={loadCtrReport}
            disabled={ctrLoading}
            className="w-full bg-ocean hover:bg-ocean-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-auto"
          >
            {ctrLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {ctrLoading
              ? (lang === 'tr' ? 'Analiz ediliyor…' : 'Analyzing…')
              : (lang === 'tr' ? '📉 Raporu Getir' : '📉 Fetch report')}
          </button>
        ) : (
          <button
            onClick={generate}
            disabled={loading || (subTab === 'seo' && jobSourceMode === 'real' && !selectedJob)}
            className="w-full bg-ocean hover:bg-ocean-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-auto"
          >
            {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {buttonLabel()}
          </button>
        )}

        {/* Blog yayınla */}
        {subTab === 'blog' && output && (
          <div className="flex flex-col gap-2">
            <button
              onClick={publishBlog}
              disabled={publishing}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              {publishing
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> {lang === 'tr' ? 'Yayınlanıyor…' : 'Publishing…'}</>
                : blogImageData
                  ? (lang === 'tr' ? '🚀 Görselli Yayınla' : '🚀 Publish with image')
                  : (lang === 'tr' ? '🚀 Blogu Yayınla (Görsel Otomatik)' : '🚀 Publish blog (automatic image)')}
            </button>
            {blogImageData && !publishing && (
              <p className="text-[11px] text-green-600 dark:text-green-400 text-center flex items-center justify-center gap-1">
                <span>✅</span> {lang === 'tr' ? 'Görsel hazır — yayınlamada kullanılacak' : 'Image ready — it will be used when publishing'}
              </p>
            )}
            {publishing && (
              <p className="text-[11px] text-slate-600 dark:text-slate-400 text-center">
                {blogImageData
                  ? (lang === 'tr' ? 'Görsel kaydediliyor ve blog yayınlanıyor…' : 'Saving the image and publishing the blog…')
                  : (lang === 'tr' ? 'Görsel üretiliyor ve blog yayınlanıyor…' : 'Generating the image and publishing the blog…')}
              </p>
            )}
            {publishResult && (
              <div className={`rounded-xl border p-3 text-xs ${
                publishResult.success
                  ? 'border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
                  : 'border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
              }`}>
                {publishResult.success ? (
                  <div role="status" className="flex flex-col gap-1.5">
                    <p className="font-semibold text-green-700 dark:text-green-300">
                      ✅ {lang === 'tr' ? 'Blog yayınlandı!' : 'Blog published!'}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300 line-clamp-2">📝 {publishResult.title}</p>
                    {publishResult.blogId ? (
                      <p className="text-slate-600 dark:text-slate-400 text-[11px]">Blog ID: {publishResult.blogId}</p>
                    ) : null}
                    {publishResult.localImageUrl && (
                      <a href={publishResult.localImageUrl} target="_blank" rel="noopener noreferrer"
                        className="text-ocean hover:underline text-[11px] truncate">
                        🖼️ {publishResult.imageFileName}
                      </a>
                    )}
                    {publishResult.syncNote && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-2 text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
                        ℹ️ <Msg text={publishResult.syncNote} />
                      </div>
                    )}
                  </div>
                ) : (
                  <p role="alert" className="text-red-600 dark:text-red-400">❌ <Msg text={publishResult.error || (lang === 'tr' ? 'Blog yayınlanamadı' : "Couldn't publish the blog")} /></p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sağ panel — output */}
      <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm mb-4 flex items-center gap-2">
          <span aria-hidden="true">📄</span>{' '}
          {subTab === 'blog'       && (lang === 'tr' ? 'Üretilen Blog Makalesi'   : 'Generated blog article')}
          {subTab === 'seo'        && (lang === 'tr' ? 'Üretilen SEO Meta'        : 'Generated SEO meta')}
          {subTab === 'keyword'    && (lang === 'tr' ? 'Keyword Araştırma Sonucu' : 'Keyword research result')}
          {subTab === 'competitor' && (lang === 'tr' ? 'Rakip Analizi Raporu'     : 'Competitor analysis report')}
          {subTab === 'ctr_report' && (lang === 'tr' ? 'Düşük CTR Raporu'         : 'Low CTR report')}
        </h3>
        {subTab === 'ctr_report' ? (
          <CtrReportPanel data={ctrData} loading={ctrLoading} error={ctrError} lang={lang} />
        ) : (
          <OutputPanel
            content={output}
            loading={loading}
            error={translateMessage(error, lang)}
            platform={subTab === 'blog' ? 'blog' : subTab === 'seo' ? 'seo_job' : subTab}
            contentType={subTab === 'blog' ? 'blog' : subTab === 'seo' ? 'seo_job' : subTab}
            autoSaveHistory={{ prompt: `SEO & Blog · ${subTab}`, language }}
            onImageReady={subTab === 'blog' ? (data, mime) => { setBlogImageData(data); setBlogImageMime(mime); } : undefined}
          />
        )}

        {/* Keyword Araştırma → İlan SEO köprüsü: tablodan çıkarılan keyword'ler tıklanabilir */}
        {subTab === 'keyword' && output && !loading && (() => {
          const extracted = extractKeywordsFromMarkdown(output);
          if (extracted.length === 0) return null;
          return (
            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                🔗 {lang === 'tr'
                  ? `${extracted.length} keyword bulundu — birini seçip İlan SEO'da hedefleyin:`
                  : `Found ${extracted.length} keywords — pick one to target in job posting SEO:`}
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {extracted.map((kw, i) => (
                  <button
                    key={i}
                    onClick={() => { setTargetKeyword(kw); setSubTab('seo'); }}
                    className="text-[11px] px-2.5 py-1.5 rounded-full border border-purple-200 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors"
                    title={lang === 'tr' ? "İlan SEO'da hedefle" : 'Target in job posting SEO'}
                  >
                    🎯 {kw}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function CtrReportPanel({
  data, loading, error, lang,
}: {
  data: CtrReportResponse | null; loading: boolean; error: string; lang: 'tr' | 'en';
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-600 dark:text-slate-400">
        <div className="w-8 h-8 border-3 border-ocean border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">{lang === 'tr' ? 'GSC verisi analiz ediliyor ve AI önerileri üretiliyor…' : 'Analyzing GSC data and generating AI suggestions…'}</p>
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-600 dark:text-red-400">
        ❌ <Msg text={error} />
      </div>
    );
  }
  if (data?.notConfigured) {
    return (
      <div className="rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-700 dark:text-amber-300">
        ⚠️ {lang === 'tr'
          ? 'Google Search Console yapılandırılmamış (GOOGLE_SERVICE_ACCOUNT_JSON / GSC_SITE_URL eksik).'
          : 'Google Search Console is not configured (GOOGLE_SERVICE_ACCOUNT_JSON / GSC_SITE_URL missing).'}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-slate-600 dark:text-slate-400 text-center">
        <span className="text-3xl" aria-hidden="true">📉</span>
        <p className="text-sm">
          {lang === 'tr' ? 'Zaman aralığını seçin ve ' : 'Pick a date range and click '}
          <strong>{lang === 'tr' ? 'Raporu Getir' : 'Fetch report'}</strong>
          {lang === 'tr' ? "'e tıklayın." : '.'}
        </p>
      </div>
    );
  }

  const rows        = data.rows || [];
  const suggestions = data.suggestions || [];
  const suggByPage  = new Map(suggestions.map(s => [s.page, s]));
  const totalLost   = Math.round(rows.reduce((sum, r) => sum + r.lostClicks, 0));
  const locale      = localeTag(lang);
  const pct         = (ratio: number) => {
    const value = (ratio * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return lang === 'tr' ? `%${value}` : `${value}%`;
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20 p-4 text-sm text-green-700 dark:text-green-300">
        ✅ {lang === 'tr'
          ? `Analiz edilen ${(data.totalAnalyzed ?? 0).toLocaleString(localeTag(lang))} sorgu/sayfa çiftinde önemli bir CTR sapması bulunamadı.`
          : `No significant CTR gap found among ${(data.totalAnalyzed ?? 0).toLocaleString(localeTag(lang))} analyzed query/page pairs.`}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label={lang === 'tr' ? 'Sorunlu Satır' : 'Flagged rows'} value={rows.length.toLocaleString(locale)} />
        <StatCard label={lang === 'tr' ? 'Analiz Edilen' : 'Total analyzed'} value={(data.totalAnalyzed ?? 0).toLocaleString(locale)} />
        <StatCard label={lang === 'tr' ? 'Tahmini Kayıp Tık.' : 'Est. lost clicks'} value={totalLost.toLocaleString(locale)} accent />
      </div>

      {data.aiError && (
        <div role="status" className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-300">
          ⚠️ {lang === 'tr' ? 'AI önerisi üretilemedi, ham veri aşağıda:' : "Couldn't generate AI suggestions, raw data below:"} <Msg text={data.aiError} />
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((r, i) => {
          const sugg = suggByPage.get(r.page);
          return (
            <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-700/50 px-4 py-2.5 flex items-center justify-between gap-2">
                <a href={r.page} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-ocean hover:underline truncate font-medium">{r.page}</a>
                <span className="text-[10px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  ~{Math.round(r.lostClicks).toLocaleString(locale)} {lang === 'tr' ? 'kayıp tık.' : 'lost clicks'}
                </span>
              </div>
              <div className="p-4 flex flex-col gap-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  <span>🔎 <strong className="text-slate-700 dark:text-slate-200">&quot;{r.query}&quot;</strong></span>
                  <span>📍 {lang === 'tr' ? 'poz.' : 'pos.'} {r.position.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                  <span title={lang === 'tr' ? 'Gösterim' : 'Impressions'}>👁️ {r.impressions.toLocaleString(locale)}</span>
                  <span title={lang === 'tr' ? 'Tıklama' : 'Clicks'}>🖱️ {r.clicks.toLocaleString(locale)}</span>
                  <span className="text-red-500 font-medium">
                    CTR {pct(r.ctr)} <span className="text-slate-600">({lang === 'tr' ? 'beklenen' : 'expected'} {pct(r.expectedCtr)})</span>
                  </span>
                </div>
                {sugg ? (
                  <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-lg p-3 flex flex-col gap-1.5">
                    <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">
                      {lang === 'tr' ? 'Önerilen Düzeltme' : 'Suggested fix'}
                    </p>
                    <p className="text-sm text-slate-800 dark:text-slate-100"><strong>{lang === 'tr' ? 'Başlık:' : 'Title:'}</strong> {sugg.suggestedTitle}</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300"><strong>{lang === 'tr' ? 'Açıklama:' : 'Description:'}</strong> {sugg.suggestedDescription}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 italic mt-1">💡 {sugg.reasoning}</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                    {lang === 'tr' ? 'Bu satır için AI önerisi yok (ilk 15 içinde değil).' : 'No AI suggestion for this row (not in the top 15).'}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-center">
      <p className={`text-xl font-bold ${accent ? 'text-red-500' : 'text-slate-800 dark:text-slate-100'}`}>{value}</p>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

const selectClass = 'w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean focus:border-ocean placeholder:text-slate-500 dark:placeholder:text-slate-500';

// Tek kontrol: <label htmlFor> ile bağlanır. group: buton grubu, role="group" + aria-labelledby ile adlandırılır.
function Field({ label, children, group }: { label: string; children: React.ReactNode; group?: boolean }) {
  const autoId = useId();
  if (group) {
    return (
      <div role="group" aria-labelledby={autoId} className="flex flex-col gap-1.5">
        <span id={autoId} className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
        {children}
      </div>
    );
  }
  const child = isValidElement<{ id?: string }>(children) ? children : null;
  const controlId = child?.props.id || autoId;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={controlId} className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>
      {child ? cloneElement(child, { id: controlId }) : children}
    </div>
  );
}
