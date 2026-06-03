'use client';
import { useState } from 'react';
import OutputPanel from '../OutputPanel';
import { getTextModel } from '../ModelPicker';
import type { IncompleteSegment } from '@/lib/types';
import { useLang } from '@/lib/lang';

const FIELD_LABELS: Record<string, { label: string; urgency_tr: string; urgency_en: string; why_tr: string; why_en: string; color: string }> = {
  seaService:     { label: '⚓ Deniz Hizmetleri', urgency_tr: 'YÜKSEK', urgency_en: 'HIGH',   why_tr: 'İşverenler en çok buna bakar',              why_en: 'Employers look at this the most',           color: 'red' },
  certificates:   { label: '📜 Sertifikalar',      urgency_tr: 'YÜKSEK', urgency_en: 'HIGH',   why_tr: 'Yasal zorunluluk + işe alım kriteri',       why_en: 'Legal requirement + hiring criterion',      color: 'red' },
  photo:          { label: '🖼️ Profil Fotoğrafı',  urgency_tr: 'ORTA',   urgency_en: 'MEDIUM', why_tr: 'Güven oranını artırır',                     why_en: 'Increases trust rate',                      color: 'yellow' },
  documents:      { label: '📁 Belgeler',           urgency_tr: 'ORTA',   urgency_en: 'MEDIUM', why_tr: 'Hızlı işe alım için şart',                  why_en: 'Required for fast hiring',                  color: 'yellow' },
  references:     { label: '🌟 Referanslar',        urgency_tr: 'DÜŞÜK',  urgency_en: 'LOW',    why_tr: 'Rekabette öne geçirir',                     why_en: 'Gives competitive edge',                    color: 'slate' },
  profile_empty:  { label: '🚫 Boş Profil (%0)',    urgency_tr: 'YÜKSEK', urgency_en: 'HIGH',   why_tr: 'Hiç doldurmamış — en büyük kayıp segment',  why_en: 'Never filled — biggest loss segment',       color: 'red' },
  profile_low:    { label: '⚠️ Profil %0–30',       urgency_tr: 'YÜKSEK', urgency_en: 'HIGH',   why_tr: 'Çok eksik — iş bulması çok zor',            why_en: 'Very incomplete — very hard to find a job', color: 'red' },
  profile_mid:    { label: '🔶 Profil %30–60',      urgency_tr: 'ORTA',   urgency_en: 'MEDIUM', why_tr: 'Biraz daha doldurursa işe alınabilir',      why_en: 'A bit more and can be hired',               color: 'yellow' },
};

interface Props {
  segments?: IncompleteSegment[];
}

export default function RetentionTab({ segments }: Props) {
  const { lang } = useLang();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [language,      setLanguage]      = useState<'tr' | 'en'>('en');
  const [output,        setOutput]        = useState('');
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');

  const segs = segments || [];

  const generate = async () => {
    setLoading(true);
    setError('');
    setOutput('');
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'retention', segmentIndex: selectedIndex, language, textModel: getTextModel() }),
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

  const urgencyBadge = (field: string) => {
    const info = FIELD_LABELS[field];
    if (!info) return null;
    const colors: Record<string, string> = {
      red:    'bg-red-100 text-red-700',
      yellow: 'bg-yellow-100 text-yellow-700',
      slate:  'bg-slate-100 text-slate-600',
    };
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[info.color] || colors.slate}`}>
        {lang === 'tr' ? info.urgency_tr : info.urgency_en}
      </span>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col gap-5">
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1">
            {lang === 'tr' ? 'Retention İçerikleri' : 'Retention Content'}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {lang === 'tr' ? 'Profili yarım bırakanlar için geri kazanma içerikleri.' : 'Win-back content for users who left their profile incomplete.'}
          </p>
        </div>

        {segs.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-700 rounded-lg p-3">
            {lang === 'tr' ? 'Segment verileri yükleniyor...' : 'Loading segment data...'}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {lang === 'tr' ? 'Segment Seç' : 'Select Segment'}
            </label>
            {segs.map((seg, i) => {
              const info = FIELD_LABELS[seg.missingField];
              return (
                <button
                  key={i}
                  onClick={() => { setSelectedIndex(i); setOutput(''); setError(''); }}
                  className={`flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                    selectedIndex === i
                      ? 'border-ocean bg-ocean/5'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {info?.label || seg.missingField}
                    </span>
                    {info && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {lang === 'tr' ? info.why_tr : info.why_en}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{seg.count.toLocaleString('tr-TR')}</span>
                    {urgencyBadge(seg.missingField)}
                  </div>
                </button>
              );
            })}
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
          disabled={loading || segs.length === 0}
          className="w-full bg-ocean hover:bg-ocean-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-auto"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              {lang === 'tr' ? 'Üretiliyor...' : 'Generating...'}
            </>
          ) : (
            <>{language === 'tr' ? '🇹🇷' : '🇬🇧'} {lang === 'tr' ? 'Retention İçeriği Üret' : 'Generate Retention Content'}</>
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
          platform="instagram"
          contentType="retention"
          autoSaveHistory={{ prompt: `Retention · ${segs[selectedIndex]?.missingField || segs[selectedIndex]?.label || 'segment'}`, language }}
        />
      </div>
    </div>
  );
}
