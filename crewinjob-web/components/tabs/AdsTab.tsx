'use client';
import { useState } from 'react';
import OutputPanel from '../OutputPanel';
import { getTextModel } from '../ModelPicker';

type SubTab = 'facebook' | 'google' | 'instagram' | 'linkedin';

const FB_OBJECTIVES = [
  { value: 'lead_generation', label: '🎯 Lead Generation (Form Doldurtma)' },
  { value: 'traffic',         label: '🌐 Traffic (Site Trafiği)' },
  { value: 'conversions',     label: '💰 Conversions (Satış/Kayıt)' },
  { value: 'engagement',      label: '❤️ Engagement (Etkileşim)' },
  { value: 'awareness',       label: '👁️ Awareness (Marka Bilinirliği)' },
];

const FB_AUDIENCES = [
  { value: 'seafarer_global', label: '🌍 Global Seafarers (Filipinler, Hindistan, vb.)' },
  { value: 'seafarer_tr',     label: '🇹🇷 Türk Gemi Adamları' },
  { value: 'shipowner',       label: '🚢 Armatörler & Crew Manager (B2B)' },
  { value: 'retention',       label: '🔄 Retention (Yarım Profil Kullanıcıları)' },
];

const GOOGLE_TYPES = [
  { value: 'search',          label: '🔍 Search (Arama Reklamı)' },
  { value: 'display',         label: '🖼️ Display (Banner)' },
  { value: 'youtube',         label: '▶️ YouTube Video' },
  { value: 'performance_max', label: '⚡ Performance Max (Otomatik)' },
];

const GOOGLE_COUNTRIES = [
  { value: 'all',           label: '🌍 Global (Top Seafarer Ülkeleri)' },
  { value: 'Turkey',        label: '🇹🇷 Türkiye' },
  { value: 'Philippines',   label: '🇵🇭 Filipinler' },
  { value: 'India',         label: '🇮🇳 Hindistan' },
  { value: 'Indonesia',     label: '🇮🇩 Endonezya' },
  { value: 'Pakistan',      label: '🇵🇰 Pakistan' },
];

const IG_OBJECTIVES = [
  { value: 'lead_generation', label: '🎯 Lead Generation' },
  { value: 'traffic',         label: '🌐 Traffic (Profil / Site)' },
  { value: 'conversions',     label: '💰 Conversions (Kayıt)' },
  { value: 'engagement',      label: '❤️ Engagement (Beğeni, Yorum)' },
  { value: 'awareness',       label: '👁️ Awareness (Erişim)' },
  { value: 'video_views',     label: '▶️ Video Views (Reels İzlenme)' },
];

const IG_FORMATS = [
  { value: 'reels',    label: '🎬 Reels (15–30 sn video)' },
  { value: 'stories',  label: '📱 Stories (9:16 tam ekran)' },
  { value: 'feed',     label: '🖼️ Feed (Kare / Dikey görsel)' },
  { value: 'carousel', label: '🃏 Carousel (4–10 kart)' },
];

const IG_AUDIENCES = [
  { value: 'seafarer_global', label: '🌍 Global Seafarers' },
  { value: 'seafarer_tr',     label: '🇹🇷 Türk Gemi Adamları' },
  { value: 'shipowner',       label: '🚢 Armatörler & Crew Manager' },
  { value: 'retention',       label: '🔄 Retention (Yarım Profil)' },
];

const LI_OBJECTIVES = [
  { value: 'lead_gen',           label: '📋 Lead Gen Form (InMail/Feed)' },
  { value: 'website_visits',     label: '🌐 Website Visits' },
  { value: 'brand_awareness',    label: '👁️ Brand Awareness' },
  { value: 'engagement',         label: '❤️ Engagement' },
  { value: 'website_conversions',label: '💰 Website Conversions' },
  { value: 'job_applicants',     label: '👔 Job Applicants' },
];

const LI_AD_FORMATS = [
  { value: 'single_image',  label: '🖼️ Single Image Ad' },
  { value: 'carousel',      label: '🃏 Carousel Ad' },
  { value: 'video',         label: '▶️ Video Ad' },
  { value: 'message',       label: '💬 Message Ad (InMail)' },
  { value: 'conversation',  label: '🔀 Conversation Ad' },
  { value: 'document',      label: '📄 Document Ad (PDF/PPT)' },
  { value: 'spotlight',     label: '✨ Spotlight Ad (Dynamic)' },
  { value: 'text',          label: '📝 Text Ad' },
];

const LI_TARGETING = [
  { value: 'shipowner',       label: '🚢 Armatörler & Crew Managers (B2B)' },
  { value: 'seafarer_senior', label: '⚓ Kıdemli Deniz Subayları' },
  { value: 'seafarer_cadet',  label: '🎓 Genç Denizci & Cadetler' },
  { value: 'hr_maritime',     label: '🤝 Denizcilik İK & Manning Ajansları' },
];

const PLATFORM_TABS: { id: SubTab; label: string; color: string; bg: string }[] = [
  { id: 'facebook',  label: '📘 Facebook',  color: 'bg-blue-600',   bg: '' },
  { id: 'google',    label: '🔍 Google',    color: 'bg-red-500',    bg: '' },
  { id: 'instagram', label: '📸 Instagram', color: 'bg-gradient-to-r from-purple-500 to-pink-500', bg: '' },
  { id: 'linkedin',  label: '💼 LinkedIn',  color: 'bg-sky-700',    bg: '' },
];

export default function AdsTab() {
  const [subTab,    setSubTab]    = useState<SubTab>('facebook');
  const [language,  setLanguage]  = useState<'tr' | 'en'>('en');
  const [output,    setOutput]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  // Facebook params
  const [fbObjective,  setFbObjective]  = useState('lead_generation');
  const [fbAudience,   setFbAudience]   = useState('seafarer_global');
  const [fbBudget,     setFbBudget]     = useState(500);
  const [fbCustomGoal, setFbCustomGoal] = useState('');

  // Google params
  const [gType,     setGType]     = useState('search');
  const [gKeywords, setGKeywords] = useState('');
  const [gBudget,   setGBudget]   = useState(500);
  const [gCountry,  setGCountry]  = useState('all');

  // Instagram params
  const [igObjective, setIgObjective] = useState('lead_generation');
  const [igFormat,    setIgFormat]    = useState('reels');
  const [igAudience,  setIgAudience]  = useState('seafarer_global');
  const [igBudget,    setIgBudget]    = useState(500);
  const [igCustomGoal,setIgCustomGoal]= useState('');

  // LinkedIn params
  const [liObjective, setLiObjective] = useState('lead_gen');
  const [liAdFormat,  setLiAdFormat]  = useState('single_image');
  const [liTargeting, setLiTargeting] = useState('shipowner');
  const [liBudget,    setLiBudget]    = useState(500);
  const [liCustomGoal,setLiCustomGoal]= useState('');

  const generate = async () => {
    setLoading(true);
    setError('');
    setOutput('');
    try {
      let body: Record<string, unknown>;

      if (subTab === 'facebook') {
        body = {
          type:       'facebook_ads',
          objective:  fbObjective,
          audience:   fbAudience,
          budget:     fbBudget,
          customGoal: fbCustomGoal,
          language,
        };
      } else if (subTab === 'google') {
        body = {
          type:          'google_ads',
          campaignType:  gType,
          keywords:      gKeywords,
          budget:        gBudget,
          targetCountry: gCountry,
          language,
        };
      } else if (subTab === 'instagram') {
        body = {
          type:       'instagram_ads',
          objective:  igObjective,
          format:     igFormat,
          audience:   igAudience,
          budget:     igBudget,
          customGoal: igCustomGoal,
          language,
        };
      } else {
        // linkedin
        body = {
          type:       'linkedin_ads',
          objective:  liObjective,
          adFormat:   liAdFormat,
          targeting:  liTargeting,
          budget:     liBudget,
          customGoal: liCustomGoal,
          language,
        };
      }

      const res = await fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...body, textModel: getTextModel() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOutput(data.content);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  const generateLabel = () => {
    if (loading) return 'Kampanya planı hazırlanıyor...';
    const labels: Record<SubTab, string> = {
      facebook:  '📘 Facebook Kampanyası Üret',
      google:    '🔍 Google Kampanyası Üret',
      instagram: '📸 Instagram Kampanyası Üret',
      linkedin:  '💼 LinkedIn Kampanyası Üret',
    };
    return labels[subTab];
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Sol panel — kontroller */}
      <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col gap-5">

        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1 flex items-center gap-2">
            <span>📣</span> Reklam Kampanyası
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Facebook, Google, Instagram & LinkedIn kampanya planı + reklam metinleri otomatik üretir.
          </p>
        </div>

        {/* Platform tabs — 2×2 grid */}
        <div className="grid grid-cols-2 gap-2">
          {PLATFORM_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => { setSubTab(t.id); setOutput(''); setError(''); }}
              className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                subTab === t.id
                  ? `${t.color} text-white shadow-sm`
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Facebook form ── */}
        {subTab === 'facebook' && (
          <>
            <Field label="Kampanya Amacı">
              <select value={fbObjective} onChange={e => setFbObjective(e.target.value)} className={selectClass}>
                {FB_OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Hedef Kitle">
              <select value={fbAudience} onChange={e => setFbAudience(e.target.value)} className={selectClass}>
                {FB_AUDIENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </Field>
            <BudgetField budget={fbBudget} onChange={setFbBudget} />
            <Field label="Özel Hedef (opsiyonel)">
              <textarea value={fbCustomGoal} onChange={e => setFbCustomGoal(e.target.value)}
                placeholder="Örn: 2 ay içinde 1000 yeni gemi adamı kaydı, CPL <$2"
                rows={2} className={`${selectClass} resize-none`} />
            </Field>
          </>
        )}

        {/* ── Google form ── */}
        {subTab === 'google' && (
          <>
            <Field label="Kampanya Tipi">
              <select value={gType} onChange={e => setGType(e.target.value)} className={selectClass}>
                {GOOGLE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Hedef Ülke">
              <select value={gCountry} onChange={e => setGCountry(e.target.value)} className={selectClass}>
                {GOOGLE_COUNTRIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Tohum Keyword'ler (opsiyonel)">
              <input type="text" value={gKeywords} onChange={e => setGKeywords(e.target.value)}
                placeholder="Örn: chief officer jobs, bulk carrier"
                className={selectClass} />
              <p className="text-[10px] text-slate-400 dark:text-slate-500">Boş bırakırsanız maritime sektörü için akıllı öneri yapılır.</p>
            </Field>
            <BudgetField budget={gBudget} onChange={setGBudget} />
          </>
        )}

        {/* ── Instagram form ── */}
        {subTab === 'instagram' && (
          <>
            <Field label="Kampanya Amacı">
              <select value={igObjective} onChange={e => setIgObjective(e.target.value)} className={selectClass}>
                {IG_OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Reklam Formatı">
              <div className="grid grid-cols-2 gap-1.5">
                {IG_FORMATS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => setIgFormat(f.value)}
                    className={`text-xs py-2 px-2.5 rounded-lg font-medium transition-colors text-left ${
                      igFormat === f.value
                        ? 'bg-pink-500 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Hedef Kitle">
              <select value={igAudience} onChange={e => setIgAudience(e.target.value)} className={selectClass}>
                {IG_AUDIENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </Field>
            <BudgetField budget={igBudget} onChange={setIgBudget} />
            <Field label="Özel Hedef (opsiyonel)">
              <textarea value={igCustomGoal} onChange={e => setIgCustomGoal(e.target.value)}
                placeholder="Örn: 10K Reels görüntüleme, CPV < $0.02"
                rows={2} className={`${selectClass} resize-none`} />
            </Field>
          </>
        )}

        {/* ── LinkedIn form ── */}
        {subTab === 'linkedin' && (
          <>
            <Field label="Kampanya Objective">
              <select value={liObjective} onChange={e => setLiObjective(e.target.value)} className={selectClass}>
                {LI_OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Ad Format">
              <select value={liAdFormat} onChange={e => setLiAdFormat(e.target.value)} className={selectClass}>
                {LI_AD_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </Field>
            <Field label="Hedef Profil">
              <div className="flex flex-col gap-1.5">
                {LI_TARGETING.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setLiTargeting(t.value)}
                    className={`text-xs py-2 px-3 rounded-lg font-medium transition-colors text-left ${
                      liTargeting === t.value
                        ? 'bg-sky-700 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </Field>
            <BudgetField budget={liBudget} onChange={setLiBudget} />
            <Field label="Özel Hedef (opsiyonel)">
              <textarea value={liCustomGoal} onChange={e => setLiCustomGoal(e.target.value)}
                placeholder="Örn: 50 qualified B2B lead, CPL <$30"
                rows={2} className={`${selectClass} resize-none`} />
            </Field>
          </>
        )}

        {/* Dil */}
        <Field label="İçerik Dili">
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
          {subTab === 'linkedin' && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500">💡 LinkedIn B2B için İngilizce genellikle daha geniş erişim sağlar.</p>
          )}
        </Field>

        <button
          onClick={generate}
          disabled={loading}
          className="w-full bg-ocean hover:bg-ocean-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-auto"
        >
          {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {generateLabel()}
        </button>

        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
          💡 Reklam metinleri, hedef kitle, bütçe dağılımı ve A/B test stratejisi içerir.
        </p>
      </div>

      {/* Sağ panel — output */}
      <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm mb-4 flex items-center gap-2">
          <span>📋</span>{' '}
          {subTab === 'facebook'  && 'Facebook Kampanya Planı'}
          {subTab === 'google'    && 'Google Kampanya Planı'}
          {subTab === 'instagram' && 'Instagram Kampanya Planı'}
          {subTab === 'linkedin'  && 'LinkedIn Kampanya Planı'}
        </h3>
        <OutputPanel
          content={output}
          loading={loading}
          error={error}
          platform={subTab}
          contentType={`${subTab}_ads`}
          autoSaveHistory={{ prompt: `Reklam Kampanyası · ${subTab}`, language }}
        />
      </div>
    </div>
  );
}

/* ── Budget slider (paylaşılan component) ── */
function BudgetField({ budget, onChange }: { budget: number; onChange: (v: number) => void }) {
  return (
    <Field label="Aylık Bütçe (USD)">
      <div className="flex gap-2 items-center">
        <input
          type="range" min={100} max={5000} step={100} value={budget}
          onChange={e => onChange(Number(e.target.value))}
          className="flex-1 accent-ocean"
        />
        <span className="text-sm font-bold text-ocean min-w-[70px] text-right">${budget}</span>
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">≈ ${(budget / 30).toFixed(0)}/gün</p>
    </Field>
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
