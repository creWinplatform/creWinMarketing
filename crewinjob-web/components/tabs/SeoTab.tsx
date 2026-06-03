'use client';
import { useState } from 'react';
import OutputPanel from '../OutputPanel';
import { getTextModel } from '../ModelPicker';
import { useLang } from '@/lib/lang';

type SubTab = 'blog' | 'seo' | 'keyword' | 'competitor';

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
  { value: 'all',           label: '🎯 Tümü' },
  { value: 'commercial',    label: '💼 Commercial (Karşılaştırma, Best of)' },
  { value: 'transactional', label: '💰 Transactional (Apply, Hire, Buy)' },
  { value: 'informational', label: '📚 Informational (How to, What is)' },
];

export default function SeoTab() {
  const { lang } = useLang();

  const SUB_TABS: { id: SubTab; label: string; icon: string }[] = [
    { id: 'blog',       label: lang === 'tr' ? 'Blog Makalesi'   : 'Blog Article',        icon: '📝' },
    { id: 'seo',        label: lang === 'tr' ? 'İlan SEO'        : 'Job SEO',             icon: '🔍' },
    { id: 'keyword',    label: lang === 'tr' ? 'Keyword Araştır' : 'Keyword Research',    icon: '🎯' },
    { id: 'competitor', label: lang === 'tr' ? 'Rakip Analizi'   : 'Competitor Analysis', icon: '⚔️' },
  ];

  const [subTab,     setSubTab]     = useState<SubTab>('blog');
  const [blogTopic,  setBlogTopic]  = useState('');
  const [jobTitle,   setJobTitle]   = useState('Chief Officer');
  const [vesselType, setVesselType] = useState('Bulk Carrier');
  const [language,   setLanguage]   = useState<'tr' | 'en'>('en');

  // Keyword research
  const [seedKeyword, setSeedKeyword] = useState('seafarer jobs');
  const [intent,      setIntent]      = useState('all');

  const [output,        setOutput]        = useState('');
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [publishing,    setPublishing]    = useState(false);
  const [publishResult, setPublishResult] = useState<{
    success?: boolean; blogId?: number; title?: string;
    imageFileName?: string; localImageUrl?: string; syncNote?: string; error?: string;
  } | null>(null);
  // OutputPanel'den gelen görsel (üretilince otomatik yakalanır)
  const [blogImageData, setBlogImageData] = useState('');
  const [blogImageMime, setBlogImageMime] = useState('image/png');

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
          // OutputPanel'de üretilen görsel varsa gönder, yoksa sunucu otomatik üretir
          ...(blogImageData ? { imageData: blogImageData, imageMime: blogImageMime } : {}),
        }),
      });
      const data = await res.json() as typeof publishResult;
      setPublishResult(data);
    } catch (e: unknown) {
      setPublishResult({ error: e instanceof Error ? e.message : 'Bağlantı hatası' });
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
        body = { ...body, type: 'seo_job', jobTitle, vesselType };
      } else if (subTab === 'keyword') {
        body = { ...body, type: 'keyword_research', seedKeyword, intent };
      } else if (subTab === 'competitor') {
        body = { ...body, type: 'competitor_analysis' };
      }

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOutput(data.content);
      // Yeni içerik üretilince önceki görsel + sonucu sıfırla
      if (subTab === 'blog') { setBlogImageData(''); setBlogImageMime('image/png'); setPublishResult(null); }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  const buttonLabel = () => {
    if (loading) return lang === 'tr' ? 'Üretiliyor...' : 'Generating...';
    const flag = language === 'tr' ? '🇹🇷' : '🇬🇧';
    if (subTab === 'blog')        return `${flag} ${lang === 'tr' ? 'Makale Üret'         : 'Generate Article'}`;
    if (subTab === 'seo')         return `${flag} ${lang === 'tr' ? 'SEO Meta Üret'       : 'Generate SEO Meta'}`;
    if (subTab === 'keyword')     return `${flag} ${lang === 'tr' ? 'Keyword Listesi Üret': 'Generate Keyword List'}`;
    if (subTab === 'competitor')  return `${flag} ${lang === 'tr' ? 'Rakip Analizi Üret'  : 'Generate Competitor Analysis'}`;
    return lang === 'tr' ? 'Üret' : 'Generate';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Sol panel */}
      <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col gap-5">
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1 flex items-center gap-2">
            <span>🔎</span> {lang === 'tr' ? 'SEO & İçerik Stratejisi' : 'SEO & Content Strategy'}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {lang === 'tr'
              ? 'Blog, SEO meta, keyword araştırması ve rakip analizi.'
              : 'Blog, SEO meta, keyword research and competitor analysis.'}
          </p>
        </div>

        {/* Sub-tabs grid 2x2 */}
        <div className="grid grid-cols-2 gap-2">
          {SUB_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setSubTab(t.id); setOutput(''); setError(''); }}
              className={`flex items-center gap-1.5 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                subTab === t.id
                  ? 'bg-ocean text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Blog form */}
        {subTab === 'blog' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {lang === 'tr' ? 'Blog Konusu' : 'Blog Topic'}
            </label>
            <input
              type="text"
              value={blogTopic}
              onChange={e => setBlogTopic(e.target.value)}
              placeholder={lang === 'tr' ? 'Örn: Seafarer CV Tips 2026 (boş = AI önerir)' : 'e.g. Seafarer CV Tips 2026 (empty = AI suggests)'}
              className={selectClass}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {lang === 'tr'
                ? 'Boş bırakırsanız en öncelikli konu otomatik seçilir.'
                : 'Leave empty to auto-select the highest priority topic.'}
            </p>
          </div>
        )}

        {/* SEO Job form */}
        {subTab === 'seo' && (
          <>
            <Field label={lang === 'tr' ? 'Pozisyon / Rütbe' : 'Position / Rank'}>
              <select value={jobTitle} onChange={e => setJobTitle(e.target.value)} className={selectClass}>
                {RANKS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label={lang === 'tr' ? 'Gemi Tipi' : 'Vessel Type'}>
              <select value={vesselType} onChange={e => setVesselType(e.target.value)} className={selectClass}>
                {VESSEL_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
          </>
        )}

        {/* Keyword Research form */}
        {subTab === 'keyword' && (
          <>
            <Field label={lang === 'tr' ? 'Tohum Keyword' : 'Seed Keyword'}>
              <input
                type="text"
                value={seedKeyword}
                onChange={e => setSeedKeyword(e.target.value)}
                placeholder="Örn: seafarer jobs, gemi adamı işleri"
                className={selectClass}
              />
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Bu keyword&apos;den türetilen 30+ kelime + topic cluster + uzun kuyruk fırsatları üretilir.
              </p>
            </Field>
            <Field label="Search Intent">
              <select value={intent} onChange={e => setIntent(e.target.value)} className={selectClass}>
                {INTENT_TYPES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </Field>
          </>
        )}

        {/* Competitor analysis form */}
        {subTab === 'competitor' && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300 flex gap-2">
            <span className="text-base">⚔️</span>
            <div>
              <p className="font-semibold mb-1">Analiz edilecek rakipler:</p>
              <p className="text-[11px] leading-relaxed">
                Martide, Maritime Connector, MarineLink, SeafarerJobs, Crew24, Jobfish, Bureau Maritime
              </p>
              <p className="text-[11px] mt-2">
                AI bu 7 rakibi SEO, reklam, içerik, ürün açılarından Crewin ile karşılaştırır + 90 günlük strateji önerir.
              </p>
            </div>
          </div>
        )}

        {/* Dil */}
        <Field label={lang === 'tr' ? 'İçerik Dili' : 'Content Language'}>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'tr', flag: '🇹🇷', label: 'Türkçe' },
              { value: 'en', flag: '🇬🇧', label: 'English' },
            ] as { value: 'tr' | 'en'; flag: string; label: string }[]).map(l => (
              <button
                key={l.value}
                onClick={() => setLanguage(l.value)}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors border-2 ${
                  language === l.value
                    ? 'bg-ocean text-white border-ocean'
                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-ocean/50 hover:bg-slate-50 dark:hover:bg-slate-600'
                }`}
              >
                <span className="text-base">{l.flag}</span>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
          {subTab === 'blog' && language === 'en' && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">💡 SEO blog için İngilizce önerilir (global kitle).</p>
          )}
          {subTab === 'keyword' && language === 'en' && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">💡 Maritime sektörü çoğunlukla İngilizce arama yapar.</p>
          )}
        </Field>

        <button
          onClick={generate}
          disabled={loading}
          className="w-full bg-ocean hover:bg-ocean-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-auto"
        >
          {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {buttonLabel()}
        </button>

        {/* Blog yayınla butonu — yalnızca blog sekmesinde ve içerik üretilmişse */}
        {subTab === 'blog' && output && (
          <div className="flex flex-col gap-2">
            <button
              onClick={publishBlog}
              disabled={publishing}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              {publishing
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> {lang === 'tr' ? 'Yayınlanıyor...' : 'Publishing...'}</>
                : blogImageData
                  ? (lang === 'tr' ? '🚀 Görselli Yayınla' : '🚀 Publish with Image')
                  : (lang === 'tr' ? '🚀 Blogu Yayınla (Görsel Otomatik)' : '🚀 Publish Blog (Auto Image)')}
            </button>
            {/* Görsel durumu */}
            {blogImageData && !publishing && (
              <p className="text-[11px] text-green-600 dark:text-green-400 text-center flex items-center justify-center gap-1">
                <span>✅</span> {lang === 'tr' ? 'Görsel hazır — yayınlamada kullanılacak' : 'Image ready — will be used in publish'}
              </p>
            )}
            {publishing && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
                {blogImageData ? 'Görsel kaydediliyor ve blog yayınlanıyor...' : 'Görsel üretiliyor ve blog yayınlanıyor...'}
              </p>
            )}

            {/* Sonuç kartı */}
            {publishResult && (
              <div className={`rounded-xl border p-3 text-xs ${
                publishResult.success
                  ? 'border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
                  : 'border-red-200 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
              }`}>
                {publishResult.success ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="font-semibold text-green-700 dark:text-green-300">
                      ✅ {lang === 'tr' ? 'Blog yayınlandı!' : 'Blog published!'}
                    </p>
                    <p className="text-slate-600 dark:text-slate-300 line-clamp-2">📝 {publishResult.title}</p>
                    {publishResult.blogId ? (
                      <p className="text-slate-400 dark:text-slate-500 text-[11px]">Blog ID: {publishResult.blogId}</p>
                    ) : null}
                    {publishResult.localImageUrl && (
                      <a
                        href={publishResult.localImageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-ocean hover:underline text-[11px] truncate"
                      >
                        🖼️ {publishResult.imageFileName}
                      </a>
                    )}
                    {publishResult.syncNote && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-2 text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
                        ℹ️ {publishResult.syncNote}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-red-600 dark:text-red-400">❌ {publishResult.error}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sağ panel — output */}
      <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm mb-4 flex items-center gap-2">
          <span>📄</span>{' '}
          {subTab === 'blog'       && (lang === 'tr' ? 'Üretilen Blog Makalesi'    : 'Generated Blog Article')}
          {subTab === 'seo'        && (lang === 'tr' ? 'Üretilen SEO Meta'         : 'Generated SEO Meta')}
          {subTab === 'keyword'    && (lang === 'tr' ? 'Keyword Araştırma Sonucu'  : 'Keyword Research Result')}
          {subTab === 'competitor' && (lang === 'tr' ? 'Rakip Analizi Raporu'      : 'Competitor Analysis Report')}
        </h3>
        <OutputPanel
          content={output}
          loading={loading}
          error={error}
          platform={subTab === 'blog' ? 'blog' : subTab === 'seo' ? 'seo_job' : subTab}
          contentType={subTab === 'blog' ? 'blog' : subTab === 'seo' ? 'seo_job' : subTab}
          autoSaveHistory={{ prompt: `SEO & Blog · ${subTab}`, language }}
          onImageReady={subTab === 'blog' ? (data, mime) => { setBlogImageData(data); setBlogImageMime(mime); } : undefined}
        />
      </div>
    </div>
  );
}

const selectClass = 'w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean placeholder:text-slate-400 dark:placeholder:text-slate-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>
      {children}
    </div>
  );
}
