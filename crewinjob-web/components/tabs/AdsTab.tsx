'use client';
import { useState } from 'react';
import OutputPanel from '../OutputPanel';
import { getTextModel } from '../ModelPicker';
import { useLang } from '@/lib/lang';

type SubTab = 'facebook' | 'google' | 'instagram' | 'linkedin';

const FB_OBJECTIVES = [
  { value: 'lead_generation', labelTr: '🎯 Lead Generation (Form Doldurtma)',  labelEn: '🎯 Lead Generation (Form Fill)' },
  { value: 'traffic',         labelTr: '🌐 Traffic (Site Trafiği)',             labelEn: '🌐 Traffic (Website)' },
  { value: 'conversions',     labelTr: '💰 Conversions (Satış/Kayıt)',          labelEn: '💰 Conversions (Sales/Signup)' },
  { value: 'engagement',      labelTr: '❤️ Engagement (Etkileşim)',             labelEn: '❤️ Engagement' },
  { value: 'awareness',       labelTr: '👁️ Awareness (Marka Bilinirliği)',      labelEn: '👁️ Awareness (Brand)' },
];

const FB_AUDIENCES = [
  { value: 'seafarer_global', labelTr: '🌍 Global Seafarers (Filipinler, Hindistan, vb.)', labelEn: '🌍 Global Seafarers (Philippines, India, etc.)' },
  { value: 'seafarer_tr',     labelTr: '🇹🇷 Türk Gemi Adamları',                           labelEn: '🇹🇷 Turkish Seafarers' },
  { value: 'shipowner',       labelTr: '🚢 Armatörler & Crew Manager (B2B)',               labelEn: '🚢 Shipowners & Crew Manager (B2B)' },
  { value: 'retention',       labelTr: '🔄 Retention (Yarım Profil Kullanıcıları)',        labelEn: '🔄 Retention (Incomplete Profiles)' },
];

const GOOGLE_TYPES = [
  { value: 'search',          labelTr: '🔍 Search (Arama Reklamı)',    labelEn: '🔍 Search Ad' },
  { value: 'display',         labelTr: '🖼️ Display (Banner)',          labelEn: '🖼️ Display (Banner)' },
  { value: 'youtube',         labelTr: '▶️ YouTube Video',             labelEn: '▶️ YouTube Video' },
  { value: 'performance_max', labelTr: '⚡ Performance Max (Otomatik)', labelEn: '⚡ Performance Max (Auto)' },
];

const GOOGLE_COUNTRIES = [
  { value: 'all',         labelTr: '🌍 Global (Top Seafarer Ülkeleri)', labelEn: '🌍 Global (Top Seafarer Countries)' },
  { value: 'Turkey',      labelTr: '🇹🇷 Türkiye',                       labelEn: '🇹🇷 Turkey' },
  { value: 'Philippines', labelTr: '🇵🇭 Filipinler',                    labelEn: '🇵🇭 Philippines' },
  { value: 'India',       labelTr: '🇮🇳 Hindistan',                     labelEn: '🇮🇳 India' },
  { value: 'Indonesia',   labelTr: '🇮🇩 Endonezya',                     labelEn: '🇮🇩 Indonesia' },
  { value: 'Pakistan',    labelTr: '🇵🇰 Pakistan',                      labelEn: '🇵🇰 Pakistan' },
];

const IG_OBJECTIVES = [
  { value: 'lead_generation', labelTr: '🎯 Lead Generation',                  labelEn: '🎯 Lead Generation' },
  { value: 'traffic',         labelTr: '🌐 Traffic (Profil / Site)',           labelEn: '🌐 Traffic (Profile / Site)' },
  { value: 'conversions',     labelTr: '💰 Conversions (Kayıt)',               labelEn: '💰 Conversions (Signup)' },
  { value: 'engagement',      labelTr: '❤️ Engagement (Beğeni, Yorum)',        labelEn: '❤️ Engagement (Likes, Comments)' },
  { value: 'awareness',       labelTr: '👁️ Awareness (Erişim)',               labelEn: '👁️ Awareness (Reach)' },
  { value: 'video_views',     labelTr: '▶️ Video Views (Reels İzlenme)',       labelEn: '▶️ Video Views (Reels)' },
];

const IG_FORMATS = [
  { value: 'reels',    labelTr: '🎬 Reels (15–30 sn video)',       labelEn: '🎬 Reels (15–30 sec video)' },
  { value: 'stories',  labelTr: '📱 Stories (9:16 tam ekran)',      labelEn: '📱 Stories (9:16 full screen)' },
  { value: 'feed',     labelTr: '🖼️ Feed (Kare / Dikey görsel)',    labelEn: '🖼️ Feed (Square / Vertical)' },
  { value: 'carousel', labelTr: '🃏 Carousel (4–10 kart)',          labelEn: '🃏 Carousel (4–10 cards)' },
];

const IG_AUDIENCES = [
  { value: 'seafarer_global', labelTr: '🌍 Global Seafarers',              labelEn: '🌍 Global Seafarers' },
  { value: 'seafarer_tr',     labelTr: '🇹🇷 Türk Gemi Adamları',            labelEn: '🇹🇷 Turkish Seafarers' },
  { value: 'shipowner',       labelTr: '🚢 Armatörler & Crew Manager',      labelEn: '🚢 Shipowners & Crew Manager' },
  { value: 'retention',       labelTr: '🔄 Retention (Yarım Profil)',       labelEn: '🔄 Retention (Incomplete Profile)' },
];

const LI_OBJECTIVES = [
  { value: 'lead_gen',            labelTr: '📋 Lead Gen Form (InMail/Feed)',   labelEn: '📋 Lead Gen Form (InMail/Feed)' },
  { value: 'website_visits',      labelTr: '🌐 Website Visits',               labelEn: '🌐 Website Visits' },
  { value: 'brand_awareness',     labelTr: '👁️ Brand Awareness',              labelEn: '👁️ Brand Awareness' },
  { value: 'engagement',          labelTr: '❤️ Engagement',                   labelEn: '❤️ Engagement' },
  { value: 'website_conversions', labelTr: '💰 Website Conversions',          labelEn: '💰 Website Conversions' },
  { value: 'job_applicants',      labelTr: '👔 Job Applicants',               labelEn: '👔 Job Applicants' },
];

const LI_AD_FORMATS = [
  { value: 'single_image',  labelTr: '🖼️ Single Image Ad',        labelEn: '🖼️ Single Image Ad' },
  { value: 'carousel',      labelTr: '🃏 Carousel Ad',             labelEn: '🃏 Carousel Ad' },
  { value: 'video',         labelTr: '▶️ Video Ad',                labelEn: '▶️ Video Ad' },
  { value: 'message',       labelTr: '💬 Message Ad (InMail)',     labelEn: '💬 Message Ad (InMail)' },
  { value: 'conversation',  labelTr: '🔀 Conversation Ad',         labelEn: '🔀 Conversation Ad' },
  { value: 'document',      labelTr: '📄 Document Ad (PDF/PPT)',   labelEn: '📄 Document Ad (PDF/PPT)' },
  { value: 'spotlight',     labelTr: '✨ Spotlight Ad (Dynamic)',  labelEn: '✨ Spotlight Ad (Dynamic)' },
  { value: 'text',          labelTr: '📝 Text Ad',                 labelEn: '📝 Text Ad' },
];

const LI_TARGETING = [
  { value: 'shipowner',       labelTr: '🚢 Armatörler & Crew Managers (B2B)',   labelEn: '🚢 Shipowners & Crew Managers (B2B)' },
  { value: 'seafarer_senior', labelTr: '⚓ Kıdemli Deniz Subayları',            labelEn: '⚓ Senior Naval Officers' },
  { value: 'seafarer_cadet',  labelTr: '🎓 Genç Denizci & Cadetler',            labelEn: '🎓 Junior Seafarers & Cadets' },
  { value: 'hr_maritime',     labelTr: '🤝 Denizcilik İK & Manning Ajansları',  labelEn: '🤝 Maritime HR & Manning Agencies' },
];

const PLATFORM_TABS: { id: SubTab; label: string; color: string }[] = [
  { id: 'facebook',  label: '📘 Facebook',  color: 'bg-blue-600' },
  { id: 'google',    label: '🔍 Google',    color: 'bg-red-500' },
  { id: 'instagram', label: '📸 Instagram', color: 'bg-gradient-to-r from-purple-500 to-pink-500' },
  { id: 'linkedin',  label: '💼 LinkedIn',  color: 'bg-sky-700' },
];

export default function AdsTab() {
  const { lang } = useLang();
  const [subTab,    setSubTab]    = useState<SubTab>('facebook');
  const [language,  setLanguage]  = useState<'tr' | 'en'>('en');
  const [output,    setOutput]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  const [fbObjective,  setFbObjective]  = useState('lead_generation');
  const [fbAudience,   setFbAudience]   = useState('seafarer_global');
  const [fbBudget,     setFbBudget]     = useState(500);
  const [fbCustomGoal, setFbCustomGoal] = useState('');

  const [gType,     setGType]     = useState('search');
  const [gKeywords, setGKeywords] = useState('');
  const [gBudget,   setGBudget]   = useState(500);
  const [gCountry,  setGCountry]  = useState('all');

  const [igObjective,  setIgObjective]  = useState('lead_generation');
  const [igFormat,     setIgFormat]     = useState('reels');
  const [igAudience,   setIgAudience]   = useState('seafarer_global');
  const [igBudget,     setIgBudget]     = useState(500);
  const [igCustomGoal, setIgCustomGoal] = useState('');

  const [liObjective,  setLiObjective]  = useState('lead_gen');
  const [liAdFormat,   setLiAdFormat]   = useState('single_image');
  const [liTargeting,  setLiTargeting]  = useState('shipowner');
  const [liBudget,     setLiBudget]     = useState(500);
  const [liCustomGoal, setLiCustomGoal] = useState('');

  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;

  const generate = async () => {
    setLoading(true);
    setError('');
    setOutput('');
    try {
      let body: Record<string, unknown>;

      if (subTab === 'facebook') {
        body = { type: 'facebook_ads', objective: fbObjective, audience: fbAudience, budget: fbBudget, customGoal: fbCustomGoal, language };
      } else if (subTab === 'google') {
        body = { type: 'google_ads', campaignType: gType, keywords: gKeywords, budget: gBudget, targetCountry: gCountry, language };
      } else if (subTab === 'instagram') {
        body = { type: 'instagram_ads', objective: igObjective, format: igFormat, audience: igAudience, budget: igBudget, customGoal: igCustomGoal, language };
      } else {
        body = { type: 'linkedin_ads', objective: liObjective, adFormat: liAdFormat, targeting: liTargeting, budget: liBudget, customGoal: liCustomGoal, language };
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
      setError(e instanceof Error ? e.message : t('Hata oluştu', 'An error occurred'));
    } finally {
      setLoading(false);
    }
  };

  const generateLabel = () => {
    if (loading) return t('Kampanya planı hazırlanıyor...', 'Preparing campaign plan...');
    const labels: Record<SubTab, string> = {
      facebook:  `📘 ${t('Facebook Kampanyası Üret', 'Generate Facebook Campaign')}`,
      google:    `🔍 ${t('Google Kampanyası Üret',   'Generate Google Campaign')}`,
      instagram: `📸 ${t('Instagram Kampanyası Üret','Generate Instagram Campaign')}`,
      linkedin:  `💼 ${t('LinkedIn Kampanyası Üret', 'Generate LinkedIn Campaign')}`,
    };
    return labels[subTab];
  };

  const campaignPlanLabel: Record<SubTab, string> = {
    facebook:  t('Facebook Kampanya Planı',  'Facebook Campaign Plan'),
    google:    t('Google Kampanya Planı',    'Google Campaign Plan'),
    instagram: t('Instagram Kampanya Planı', 'Instagram Campaign Plan'),
    linkedin:  t('LinkedIn Kampanya Planı',  'LinkedIn Campaign Plan'),
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col gap-5">

        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1 flex items-center gap-2">
            <span>📣</span> {t('Reklam Kampanyası', 'Ad Campaign')}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {t(
              'Facebook, Google, Instagram & LinkedIn kampanya planı + reklam metinleri otomatik üretir.',
              'Automatically generates Facebook, Google, Instagram & LinkedIn campaign plans + ad copy.',
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {PLATFORM_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setSubTab(tab.id); setOutput(''); setError(''); }}
              className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                subTab === tab.id
                  ? `${tab.color} text-white shadow-sm`
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Facebook form ── */}
        {subTab === 'facebook' && (
          <>
            <Field label={t('Kampanya Amacı', 'Campaign Objective')}>
              <select value={fbObjective} onChange={e => setFbObjective(e.target.value)} className={selectClass}>
                {FB_OBJECTIVES.map(o => <option key={o.value} value={o.value}>{lang === 'tr' ? o.labelTr : o.labelEn}</option>)}
              </select>
            </Field>
            <Field label={t('Hedef Kitle', 'Target Audience')}>
              <select value={fbAudience} onChange={e => setFbAudience(e.target.value)} className={selectClass}>
                {FB_AUDIENCES.map(a => <option key={a.value} value={a.value}>{lang === 'tr' ? a.labelTr : a.labelEn}</option>)}
              </select>
            </Field>
            <BudgetField budget={fbBudget} onChange={setFbBudget} lang={lang} />
            <Field label={t('Özel Hedef (opsiyonel)', 'Custom Goal (optional)')}>
              <textarea value={fbCustomGoal} onChange={e => setFbCustomGoal(e.target.value)}
                placeholder={t('Örn: 2 ay içinde 1000 yeni gemi adamı kaydı, CPL <$2', 'e.g. 1000 new seafarer signups in 2 months, CPL <$2')}
                rows={2} className={`${selectClass} resize-none`} />
            </Field>
          </>
        )}

        {/* ── Google form ── */}
        {subTab === 'google' && (
          <>
            <Field label={t('Kampanya Tipi', 'Campaign Type')}>
              <select value={gType} onChange={e => setGType(e.target.value)} className={selectClass}>
                {GOOGLE_TYPES.map(gt => <option key={gt.value} value={gt.value}>{lang === 'tr' ? gt.labelTr : gt.labelEn}</option>)}
              </select>
            </Field>
            <Field label={t('Hedef Ülke', 'Target Country')}>
              <select value={gCountry} onChange={e => setGCountry(e.target.value)} className={selectClass}>
                {GOOGLE_COUNTRIES.map(c => <option key={c.value} value={c.value}>{lang === 'tr' ? c.labelTr : c.labelEn}</option>)}
              </select>
            </Field>
            <Field label={t('Tohum Keyword\'ler (opsiyonel)', 'Seed Keywords (optional)')}>
              <input type="text" value={gKeywords} onChange={e => setGKeywords(e.target.value)}
                placeholder={t('Örn: chief officer jobs, bulk carrier', 'e.g. chief officer jobs, bulk carrier')}
                className={selectClass} />
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {t('Boş bırakırsanız maritime sektörü için akıllı öneri yapılır.', 'Leave empty for smart maritime keyword suggestions.')}
              </p>
            </Field>
            <BudgetField budget={gBudget} onChange={setGBudget} lang={lang} />
          </>
        )}

        {/* ── Instagram form ── */}
        {subTab === 'instagram' && (
          <>
            <Field label={t('Kampanya Amacı', 'Campaign Objective')}>
              <select value={igObjective} onChange={e => setIgObjective(e.target.value)} className={selectClass}>
                {IG_OBJECTIVES.map(o => <option key={o.value} value={o.value}>{lang === 'tr' ? o.labelTr : o.labelEn}</option>)}
              </select>
            </Field>
            <Field label={t('Reklam Formatı', 'Ad Format')}>
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
                    {lang === 'tr' ? f.labelTr : f.labelEn}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t('Hedef Kitle', 'Target Audience')}>
              <select value={igAudience} onChange={e => setIgAudience(e.target.value)} className={selectClass}>
                {IG_AUDIENCES.map(a => <option key={a.value} value={a.value}>{lang === 'tr' ? a.labelTr : a.labelEn}</option>)}
              </select>
            </Field>
            <BudgetField budget={igBudget} onChange={setIgBudget} lang={lang} />
            <Field label={t('Özel Hedef (opsiyonel)', 'Custom Goal (optional)')}>
              <textarea value={igCustomGoal} onChange={e => setIgCustomGoal(e.target.value)}
                placeholder={t('Örn: 10K Reels görüntüleme, CPV < $0.02', 'e.g. 10K Reels views, CPV < $0.02')}
                rows={2} className={`${selectClass} resize-none`} />
            </Field>
          </>
        )}

        {/* ── LinkedIn form ── */}
        {subTab === 'linkedin' && (
          <>
            <Field label={t('Kampanya Objective', 'Campaign Objective')}>
              <select value={liObjective} onChange={e => setLiObjective(e.target.value)} className={selectClass}>
                {LI_OBJECTIVES.map(o => <option key={o.value} value={o.value}>{lang === 'tr' ? o.labelTr : o.labelEn}</option>)}
              </select>
            </Field>
            <Field label="Ad Format">
              <select value={liAdFormat} onChange={e => setLiAdFormat(e.target.value)} className={selectClass}>
                {LI_AD_FORMATS.map(f => <option key={f.value} value={f.value}>{lang === 'tr' ? f.labelTr : f.labelEn}</option>)}
              </select>
            </Field>
            <Field label={t('Hedef Profil', 'Target Profile')}>
              <div className="flex flex-col gap-1.5">
                {LI_TARGETING.map(lt => (
                  <button
                    key={lt.value}
                    onClick={() => setLiTargeting(lt.value)}
                    className={`text-xs py-2 px-3 rounded-lg font-medium transition-colors text-left ${
                      liTargeting === lt.value
                        ? 'bg-sky-700 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {lang === 'tr' ? lt.labelTr : lt.labelEn}
                  </button>
                ))}
              </div>
            </Field>
            <BudgetField budget={liBudget} onChange={setLiBudget} lang={lang} />
            <Field label={t('Özel Hedef (opsiyonel)', 'Custom Goal (optional)')}>
              <textarea value={liCustomGoal} onChange={e => setLiCustomGoal(e.target.value)}
                placeholder={t('Örn: 50 qualified B2B lead, CPL <$30', 'e.g. 50 qualified B2B leads, CPL <$30')}
                rows={2} className={`${selectClass} resize-none`} />
            </Field>
          </>
        )}

        {/* Content language */}
        <Field label={t('İçerik Dili', 'Content Language')}>
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
            <p className="text-[10px] text-slate-400 dark:text-slate-500">
              💡 {t('LinkedIn B2B için İngilizce genellikle daha geniş erişim sağlar.', 'English generally reaches a wider audience for LinkedIn B2B.')}
            </p>
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
          💡 {t('Reklam metinleri, hedef kitle, bütçe dağılımı ve A/B test stratejisi içerir.', 'Includes ad copy, target audience, budget breakdown and A/B test strategy.')}
        </p>
      </div>

      <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm mb-4 flex items-center gap-2">
          <span>📋</span> {campaignPlanLabel[subTab]}
        </h3>
        <OutputPanel
          content={output}
          loading={loading}
          error={error}
          platform={subTab}
          contentType={`${subTab}_ads`}
          autoSaveHistory={{ prompt: `${t('Reklam Kampanyası', 'Ad Campaign')} · ${subTab}`, language }}
        />
      </div>
    </div>
  );
}

function BudgetField({ budget, onChange, lang }: { budget: number; onChange: (v: number) => void; lang: 'tr' | 'en' }) {
  return (
    <Field label={lang === 'tr' ? 'Aylık Bütçe (USD)' : 'Monthly Budget (USD)'}>
      <div className="flex gap-2 items-center">
        <input
          type="range" min={100} max={5000} step={100} value={budget}
          onChange={e => onChange(Number(e.target.value))}
          className="flex-1 accent-ocean"
        />
        <span className="text-sm font-bold text-ocean min-w-[70px] text-right">${budget}</span>
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        ≈ ${(budget / 30).toFixed(0)}/{lang === 'tr' ? 'gün' : 'day'}
      </p>
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
