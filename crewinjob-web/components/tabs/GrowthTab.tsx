'use client';
import { useState } from 'react';
import OutputPanel from '../OutputPanel';
import { getTextModel } from '../ModelPicker';
import { useLang } from '@/lib/lang';

const TIKTOK_TYPES = [
  { value: 'problem_solution', labelTr: '⚡ Problem → Çözüm (en etkili)',             labelEn: '⚡ Problem → Solution (most effective)' },
  { value: 'day_in_life',      labelTr: '🌊 Denizci Günlüğü',                          labelEn: '🌊 Day in the Life of a Seafarer' },
  { value: 'reveal',           labelTr: '🎭 "Bunu bilmiyorsan kayıp ediyorsun"',        labelEn: '🎭 "If You Don\'t Know This, You\'re Missing Out"' },
  { value: 'stats_shock',      labelTr: '📊 İstatistik Şok',                            labelEn: '📊 Stats Shock' },
  { value: 'testimonial',      labelTr: '🌟 Başarı Hikayesi',                           labelEn: '🌟 Success Story' },
];

const PLATFORMS = ['instagram', 'facebook', 'twitter', 'linkedin'];

type SubTab = 'registration' | 'tiktok';

export default function GrowthTab() {
  const { lang } = useLang();
  const [subTab,     setSubTab]     = useState<SubTab>('registration');
  const [platform,   setPlatform]   = useState('instagram');
  const [tiktokType, setTiktokType] = useState('problem_solution');
  const [language,   setLanguage]   = useState<'tr' | 'en'>('en');
  const [output,     setOutput]     = useState('');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  const generate = async () => {
    setLoading(true);
    setError('');
    setOutput('');
    try {
      const body =
        subTab === 'registration'
          ? { type: 'registration', platform }
          : { type: 'tiktok_cta', scriptType: tiktokType };

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, language, textModel: getTextModel() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOutput(data.content);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : lang === 'tr' ? 'Hata oluştu' : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col gap-5">
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1">
            {lang === 'tr' ? 'Seafarer Büyüme İçerikleri' : 'Seafarer Growth Content'}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {lang === 'tr' ? 'Kayıt odaklı içerik ve TikTok scriptleri üretin.' : 'Generate registration-focused content and TikTok scripts.'}
          </p>
        </div>

        <div className="flex gap-2">
          {([
            { id: 'registration', label: lang === 'tr' ? '🎯 Kayıt İçerik' : '🎯 Registration Content' },
            { id: 'tiktok', label: '🎵 TikTok Script' },
          ] as { id: SubTab; label: string }[]).map(t => (
            <button
              key={t.id}
              onClick={() => { setSubTab(t.id); setOutput(''); setError(''); }}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                subTab === t.id
                  ? 'bg-ocean text-white'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {subTab === 'registration' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {lang === 'tr' ? 'Platform' : 'Platform'}
            </label>
            <select
              value={platform}
              onChange={e => setPlatform(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
            >
              {PLATFORMS.map(p => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {lang === 'tr' ? '3 farklı ton: acı noktası, fayda, sosyal kanıt' : '3 different tones: pain point, benefit, social proof'}
            </p>
          </div>
        )}

        {subTab === 'tiktok' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {lang === 'tr' ? 'Script Tipi' : 'Script Type'}
            </label>
            <select
              value={tiktokType}
              onChange={e => setTiktokType(e.target.value)}
              className="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean"
            >
              {TIKTOK_TYPES.map(t => (
                <option key={t.value} value={t.value}>{lang === 'tr' ? t.labelTr : t.labelEn}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {lang === 'tr' ? '60 sn + 15 sn kısa versiyon + müzik önerisi' : '60 sec + 15 sec short version + music suggestion'}
            </p>
          </div>
        )}

        {/* Content language */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {lang === 'tr' ? 'İçerik Dili' : 'Content Language'}
          </label>
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
        </div>

        <button
          onClick={generate}
          disabled={loading}
          className="w-full bg-ocean hover:bg-ocean-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-auto"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {lang === 'tr' ? 'Üretiliyor...' : 'Generating...'}
            </>
          ) : (
            <>{language === 'tr' ? '🇹🇷' : '🇬🇧'} {lang === 'tr' ? 'İçerik Üret' : 'Generate Content'}</>
          )}
        </button>
      </div>

      <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm mb-4 flex items-center gap-2">
          <span>📄</span> {lang === 'tr' ? 'Üretilen İçerik' : 'Generated Content'}
        </h3>
        <OutputPanel
          content={output}
          loading={loading}
          error={error}
          platform={subTab === 'tiktok' ? 'tiktok' : platform}
          contentType={subTab === 'tiktok' ? 'tiktok_cta' : 'registration'}
          autoSaveHistory={{ prompt: `Seafarer ${lang === 'tr' ? 'Büyüme' : 'Growth'} · ${subTab === 'tiktok' ? 'TikTok Script' : platform}`, language }}
        />
      </div>
    </div>
  );
}
