'use client';
import { useState, useEffect } from 'react';
import { getHistory as getContentHistory } from '@/lib/content-history';
import { getHistory as getPostHistory }    from '@/lib/post-history';
import type { BreakdownItem, FillRateBuckets, SeafarerStats, JobStats } from '@/lib/types';
import { useLang } from '@/lib/lang';

// ─── API response type ────────────────────────────────────────────────────────
interface DashboardData {
  seafarers?:          SeafarerStats;
  jobs?:               JobStats;
  fillRateBuckets?:    FillRateBuckets;
  dailyRegistrations?: number[];
  topCountries?:       BreakdownItem[];
  topPositions?:       BreakdownItem[];
  isRealData?:         boolean;
  fetchedAt?:          string;
  error?:              string;
}

// ─── Yardımcı: ISO-2 → emoji bayrak ──────────────────────────────────────────
function flag(iso2?: string) {
  if (!iso2 || iso2.length !== 2) return '';
  const b = 0x1F1E6 - 65;
  return String.fromCodePoint(b + iso2.toUpperCase().charCodeAt(0)) +
         String.fromCodePoint(b + iso2.toUpperCase().charCodeAt(1));
}

// ─── Mini bar (yatay) ─────────────────────────────────────────────────────────
function HBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

// ─── Stat kart ────────────────────────────────────────────────────────────────
function Kart({ icon, value, label, sub, color }: {
  icon: string; value: string; label: string; sub?: string; color: string;
}) {
  return (
    <div className={`rounded-xl border p-4 flex items-start gap-3 ${color}`}>
      <span className="text-2xl">{icon}</span>
      <div>
        <div className="text-xl font-bold leading-tight">{value}</div>
        <div className="text-xs font-medium opacity-80">{label}</div>
        {sub && <div className="text-[10px] opacity-60 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ─── PLATFORM renk map ────────────────────────────────────────────────────────
const PLATFORM_COLOR: Record<string, string> = {
  instagram: 'bg-pink-500',
  facebook:  'bg-blue-600',
  twitter:   'bg-sky-500',
  linkedin:  'bg-blue-800',
  tiktok:    'bg-slate-900',
  telegram:  'bg-cyan-500',
  whatsapp:  'bg-green-500',
};
const PLATFORM_ICON: Record<string, string> = {
  instagram: '📸', facebook: '👥', twitter: '🐦',
  linkedin: '💼', tiktok: '🎵', telegram: '✈️', whatsapp: '📩',
};

// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardTab() {
  const { lang } = useLang();

  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;

  const [data,    setData]    = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  // Sunucu taraflı geçmişler
  const [contentCount, setContentCount] = useState(0);
  const [postCount,    setPostCount]    = useState(0);
  const [recentPosts,  setRecentPosts]  = useState<Awaited<ReturnType<typeof getPostHistory>>>([]);
  const [platformDist, setPlatformDist] = useState<Record<string, number>>({});

  useEffect(() => {
    // API verisi
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ error: t('Veri alınamadı', 'Could not load data') }))
      .finally(() => setLoading(false));

    // Sunucu taraflı geçmişler
    Promise.all([getContentHistory(), getPostHistory()]).then(([ch, ph]) => {
      setContentCount(ch.length);
      setPostCount(ph.length);
      setRecentPosts(ph.slice(0, 5));

      // Platform dağılımı
      const dist: Record<string, number> = {};
      ph.forEach(p => { dist[p.platform] = (dist[p.platform] || 0) + 1; });
      ch.forEach(p => { dist[p.platform] = (dist[p.platform] || 0) + 1; });
      setPlatformDist(dist);
    }).catch(() => {});
  }, []);

  const refresh = () => {
    setLoading(true);
    setData(null);
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ error: t('Veri alınamadı', 'Could not load data') }))
      .finally(() => setLoading(false));
  };

  // ── Hesaplamalar ─────────────────────────────────────────────────────────────
  const buckets    = data?.fillRateBuckets;
  const totalUsers = buckets ? buckets.zero + buckets.low + buckets.mid + buckets.high : 0;

  const dailyReg  = data?.dailyRegistrations ?? [];
  const maxDaily  = Math.max(...dailyReg, 1);
  const DAY_LABEL = lang === 'tr'
    ? ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const topCountries = data?.topCountries ?? [];
  const maxCountry   = topCountries[0]?.count || 1;
  const topPositions = data?.topPositions ?? [];
  const maxPosition  = topPositions[0]?.count || 1;

  const maxPlatformCount = Math.max(...Object.values(platformDist), 1);

  return (
    <div className="flex flex-col gap-6">

      {/* ── Başlık satırı ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span>📈</span> {lang === 'tr' ? 'Genel Bakış' : 'Overview'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {data?.isRealData ? (
              <>{lang === 'tr' ? '● Gerçek API' : '● Real API'} · {data.fetchedAt ? new Date(data.fetchedAt).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US') : ''}</>
            ) : (lang === 'tr' ? '◐ Mock veri' : '◐ Mock data')}
          </p>
        </div>
        <button onClick={refresh}
          className="text-xs text-ocean hover:text-ocean-dark font-medium flex items-center gap-1 transition-colors">
          🔄 {lang === 'tr' ? 'Yenile' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-3 py-12 text-slate-400 text-sm">
          <div className="w-5 h-5 border-2 border-ocean border-t-transparent rounded-full animate-spin" />
          {lang === 'tr' ? 'Dashboard verileri yükleniyor...' : 'Loading dashboard data...'}
        </div>
      )}

      {data?.error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4 text-red-700 dark:text-red-300 text-sm">
          ❌ {data.error}
        </div>
      )}

      {!loading && data && !data.error && (
        <>
          {/* ── Üst stat kartları ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kart
              icon="👥" value={data.seafarers?.total?.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US') ?? '–'}
              label={t('Toplam Seafarer', 'Total Seafarers')}
              sub={`+${data.seafarers?.newThisWeek ?? 0} ${t('bu hafta', 'this week')}`}
              color="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-800 dark:text-blue-300"
            />
            <Kart
              icon="📋" value={data.jobs?.total?.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US') ?? '–'}
              label={t('Toplam İlan', 'Total Jobs')}
              sub={`${data.jobs?.companies ?? 0} ${t('firma', 'companies')}`}
              color="bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700 text-purple-800 dark:text-purple-300"
            />
            <Kart
              icon="✍️" value={contentCount.toString()}
              label={lang === 'tr' ? 'Üretilen İçerik' : 'Generated Content'}
              sub={lang === 'tr' ? 'Bu tarayıcıda' : 'This browser'}
              color="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300"
            />
            <Kart
              icon="📤" value={postCount.toString()}
              label={lang === 'tr' ? 'Yayınlanan Post' : 'Shared Posts'}
              sub={lang === 'tr' ? 'Toplam platform' : 'Total platforms'}
              color="bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-700 text-orange-800 dark:text-orange-300"
            />
          </div>

          {/* ── İkili grid: sol = grafikler, sağ = listeler ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

            {/* ── Sol 2/3 ── */}
            <div className="xl:col-span-2 flex flex-col gap-5">

              {/* Son 7 gün kayıt trend */}
              {dailyReg.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
                    <span>📅</span> {lang === 'tr' ? 'Son 7 Gün — Günlük Kayıt' : 'Last 7 Days — Daily Registrations'}
                  </h3>
                  <div className="flex items-end gap-2 h-28">
                    {dailyReg.map((v, i) => {
                      const pct  = maxDaily > 0 ? (v / maxDaily) * 100 : 0;
                      const label= DAY_LABEL[i % 7];
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[10px] font-bold text-ocean">{v > 0 ? v : ''}</span>
                          <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-t-sm flex flex-col justify-end" style={{ height: '72px' }}>
                            <div
                              className="w-full rounded-t-sm bg-ocean transition-all duration-700"
                              style={{ height: `${Math.max(pct, v > 0 ? 4 : 0)}%` }}
                            />
                          </div>
                          <span className="text-[9px] text-slate-400">{label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Profil doluluk dağılımı */}
              {buckets && totalUsers > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
                    <span>📊</span> {lang === 'tr' ? 'Profil Doluluk Dağılımı' : 'Profile Fill Rate Distribution'}
                    <span className="ml-auto text-xs text-slate-400 font-normal">{totalUsers.toLocaleString('tr-TR')} seafarer</span>
                  </h3>

                  {/* Stacked bar */}
                  <div className="h-6 flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 mb-4">
                    {[
                      { key: 'zero' as const, color: 'bg-red-500',    label: '%0' },
                      { key: 'low'  as const, color: 'bg-orange-400', label: '%0–30' },
                      { key: 'mid'  as const, color: 'bg-amber-400',  label: '%30–60' },
                      { key: 'high' as const, color: 'bg-green-500',  label: '%60+' },
                    ].map(seg => {
                      const pct = totalUsers > 0 ? (buckets[seg.key] / totalUsers) * 100 : 0;
                      if (pct === 0) return null;
                      return (
                        <div key={seg.key} className={`${seg.color} flex items-center justify-center`} style={{ width: `${pct}%` }}
                          title={`${seg.label}: ${buckets[seg.key].toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US')} ${t('kişi', 'people')}`}>
                          {pct > 10 && <span className="text-[10px] font-bold text-white">%{pct.toFixed(0)}</span>}
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { key: 'zero' as const, icon: '🚫', labelTr: '%0 Boş',   labelEn: '%0 Empty', color: 'text-red-600 dark:text-red-400' },
                      { key: 'low'  as const, icon: '⚠️', labelTr: '%0–30',    labelEn: '%0–30',    color: 'text-orange-500' },
                      { key: 'mid'  as const, icon: '🔶', labelTr: '%30–60',   labelEn: '%30–60',   color: 'text-amber-500' },
                      { key: 'high' as const, icon: '✅', labelTr: '%60+ Dolu', labelEn: '%60+ Full', color: 'text-green-600 dark:text-green-400' },
                    ].map(seg => (
                      <div key={seg.key} className="text-center">
                        <div className={`text-base font-bold ${seg.color}`}>{buckets[seg.key].toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US')}</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">{seg.icon} {lang === 'tr' ? seg.labelTr : seg.labelEn}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Platform aktivite dağılımı */}
              {Object.keys(platformDist).length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-4 flex items-center gap-2">
                    <span>📱</span> {lang === 'tr' ? 'Platform Aktivite Dağılımı' : 'Platform Activity Distribution'}
                    <span className="ml-auto text-xs text-slate-400 font-normal">
                      {lang === 'tr' ? 'İçerik + Yayın' : 'Content + Posts'}
                    </span>
                  </h3>
                  <div className="flex flex-col gap-2.5">
                    {Object.entries(platformDist)
                      .sort((a, b) => b[1] - a[1])
                      .map(([plat, count]) => (
                        <div key={plat} className="flex items-center gap-3">
                          <span className="text-base w-6 shrink-0">{PLATFORM_ICON[plat] ?? '📌'}</span>
                          <span className="text-xs text-slate-700 dark:text-slate-200 w-20 shrink-0 capitalize">{plat}</span>
                          <HBar pct={(count / maxPlatformCount) * 100} color={PLATFORM_COLOR[plat] ?? 'bg-slate-400'} />
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 w-8 text-right shrink-0">{count}</span>
                        </div>
                      ))}
                  </div>
                  {Object.keys(platformDist).length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-4">
                      {lang === 'tr' ? 'Henüz içerik üretilmedi' : 'No content generated yet'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ── Sağ 1/3 ── */}
            <div className="flex flex-col gap-5">

              {/* Top ülkeler */}
              {topCountries.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                    <span>🌍</span> {lang === 'tr' ? 'En Çok Seafarer — Ülke' : 'Top Seafarers — Country'}
                  </h3>
                  <div className="flex flex-col gap-2">
                    {topCountries.map((c, i) => (
                      <div key={c.id} className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400 w-4 text-right shrink-0">{i + 1}</span>
                        <span className="text-sm shrink-0">{flag(c.code)}</span>
                        <span className="text-xs text-slate-700 dark:text-slate-200 truncate flex-1 min-w-0" title={c.name}>{c.name}</span>
                        <HBar pct={(c.count / maxCountry) * 100} color="bg-emerald-500" />
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 w-12 text-right shrink-0 tabular-nums">
                          {c.count > 0 ? c.count.toLocaleString('tr-TR') : '–'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top pozisyonlar */}
              {topPositions.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                    <span>⚓</span> {lang === 'tr' ? 'En Çok Seafarer — Pozisyon' : 'Top Seafarers — Position'}
                  </h3>
                  <div className="flex flex-col gap-2">
                    {topPositions.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-400 w-4 text-right shrink-0">{i + 1}</span>
                        <span className="text-xs text-slate-700 dark:text-slate-200 truncate flex-1 min-w-0" title={p.name}>{p.name}</span>
                        <HBar pct={(p.count / maxPosition) * 100} color="bg-ocean" />
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 w-12 text-right shrink-0 tabular-nums">
                          {p.count > 0 ? p.count.toLocaleString('tr-TR') : '–'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Son yayınlanan postlar */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
                  <span>📤</span> {lang === 'tr' ? 'Son Yayınlanan' : 'Recent Posts'}
                </h3>
                {recentPosts.length === 0 ? (
                  <div className="text-xs text-slate-400 dark:text-slate-500 text-center py-4">
                    {lang === 'tr' ? 'Henüz yayınlanmış post yok' : 'No posts yet'}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {recentPosts.map(p => (
                      <div key={p.id} className="flex items-start gap-2 p-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                        <span className="text-base shrink-0">{PLATFORM_ICON[p.platform] ?? '📌'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-700 dark:text-slate-200 line-clamp-2 leading-relaxed">{p.content}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-slate-400 dark:text-slate-500">
                              {new Date(p.publishedAt).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' })}
                            </span>
                            {p.postUrl && (
                              <a href={p.postUrl} target="_blank" rel="noopener noreferrer"
                                className="text-[10px] text-ocean hover:underline">
                                {lang === 'tr' ? 'Görüntüle →' : 'View →'}
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
