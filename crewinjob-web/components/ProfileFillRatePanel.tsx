'use client';
import type { FillRateBuckets } from '@/lib/types';
import { useLang } from '@/lib/lang';

interface Props {
  buckets: FillRateBuckets;
  average: number;
}

export default function ProfileFillRatePanel({ buckets, average }: Props) {
  const { lang } = useLang();
  const total = buckets.zero + buckets.low + buckets.mid + buckets.high;
  if (total === 0) return null;

  const pct = (n: number) => total > 0 ? (n / total) * 100 : 0;

  const SEGMENTS = [
    {
      key:   'zero' as const,
      label: lang === 'tr' ? '%0 (Boş Profil)' : '%0 (Empty Profile)',
      range: lang === 'tr' ? 'Hiç doldurmamış' : 'Never filled',
      color: 'bg-red-500',
      text:  'text-red-600 dark:text-red-400',
      icon:  '🚫',
    },
    {
      key:   'low' as const,
      label: '%0–30',
      range: lang === 'tr' ? 'Çok eksik' : 'Very incomplete',
      color: 'bg-orange-500',
      text:  'text-orange-600 dark:text-orange-400',
      icon:  '⚠️',
    },
    {
      key:   'mid' as const,
      label: '%30–60',
      range: lang === 'tr' ? 'Yarım dolu' : 'Half complete',
      color: 'bg-amber-400',
      text:  'text-amber-600 dark:text-amber-400',
      icon:  '🔶',
    },
    {
      key:   'high' as const,
      label: '%60+',
      range: lang === 'tr' ? 'Profili dolu' : 'Profile complete',
      color: 'bg-green-500',
      text:  'text-green-600 dark:text-green-400',
      icon:  '✅',
    },
  ];

  return (
    <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4">
      <div className="max-w-screen-xl mx-auto flex flex-col gap-3">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">📊</span>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {lang === 'tr' ? 'Profil Doluluk Dağılımı' : 'Profile Completion Distribution'}
            </h3>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              {total.toLocaleString('tr-TR')} {lang === 'tr' ? 'gemi adamı' : 'seafarers'}
            </span>
          </div>
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5">
            <span className="text-xs text-slate-500 dark:text-slate-400">{lang === 'tr' ? 'Ortalama doluluk' : 'Avg. completion'}</span>
            <span className={`text-base font-bold ${
              average >= 60 ? 'text-green-600' :
              average >= 30 ? 'text-amber-500' :
              average >= 15 ? 'text-orange-500' : 'text-red-500'
            }`}>
              %{average}
            </span>
          </div>
        </div>

        {/* Stacked horizontal bar */}
        <div className="flex h-7 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 shadow-sm">
          {SEGMENTS.map(seg => {
            const w = pct(buckets[seg.key]);
            if (w === 0) return null;
            return (
              <div
                key={seg.key}
                className={`${seg.color} flex items-center justify-center transition-all hover:opacity-90`}
                style={{ width: `${w}%` }}
                title={`${seg.label}: ${buckets[seg.key].toLocaleString('tr-TR')} ${lang === 'tr' ? 'kişi' : 'people'} (%${w.toFixed(1)})`}
              >
                {w > 8 && (
                  <span className="text-[10px] font-bold text-white drop-shadow">
                    %{w.toFixed(0)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* 4 detay kartı */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {SEGMENTS.map(seg => {
            const count = buckets[seg.key];
            const w = pct(count);
            return (
              <div
                key={seg.key}
                className="border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 bg-slate-50 dark:bg-slate-700/40 hover:border-slate-300 dark:hover:border-slate-500 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2.5 h-2.5 rounded-full ${seg.color} shrink-0`} />
                  <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{seg.label}</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">{seg.icon}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={`text-lg font-bold ${seg.text}`}>
                    {count.toLocaleString('tr-TR')}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    %{w.toFixed(1)}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{seg.range}</p>
              </div>
            );
          })}
        </div>

        {/* Aksiyon önerileri */}
        {(buckets.zero + buckets.low) / total > 0.5 && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <span>💡</span>
            <span>
              {lang === 'tr' ? (
                <>Kullanıcıların <strong>%{(((buckets.zero + buckets.low) / total) * 100).toFixed(0)}</strong>&apos;i profilini %30&apos;un altında doldurmuş.
                  {' '}<strong>Retention</strong> sekmesinden bu segmentlere yönelik kampanya başlat.</>
              ) : (
                <><strong>{(((buckets.zero + buckets.low) / total) * 100).toFixed(0)}%</strong> of users have filled their profile below 30%.
                  {' '}Launch a campaign for these segments from the <strong>Retention</strong> tab.</>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
