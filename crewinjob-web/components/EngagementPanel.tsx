'use client';
import { useState, useEffect, useCallback } from 'react';
import { getHistory, updateMetrics, removePost, addPost, fetchPostMetrics, refreshMetrics, parsePostUrl, type PostHistoryItem } from '@/lib/post-history';
import { useLang } from '@/lib/lang';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';

const PLATFORM_META: Record<string, { icon: string; label: string; color: string }> = {
  twitter:   { icon: '🐦', label: 'Twitter / X', color: 'bg-slate-900 text-white' },
  linkedin:  { icon: '💼', label: 'LinkedIn',     color: 'bg-blue-700 text-white' },
  facebook:  { icon: '👥', label: 'Facebook',     color: 'bg-blue-600 text-white' },
  instagram: { icon: '📸', label: 'Instagram',    color: 'bg-gradient-to-br from-purple-500 to-pink-500 text-white' },
};

// Post URL'inden platform + postId çıkarma: lib/post-history → parsePostUrl
// (FB: {pageId}_{postId} ID'leri ve /posts/, permalink.php, photo?fbid= bağlantıları; pfbid sunucuda açık hata verir)

interface Props {
  /** Compact mod: daha az yükseklik, başlık yok */
  compact?: boolean;
}

export default function EngagementPanel({ compact = false }: Props) {
  const { lang } = useLang();
  const [items,       setItems]       = useState<PostHistoryItem[]>([]);
  const [refreshing,  setRefreshing]  = useState<string | null>(null);
  const [refreshAll,  setRefreshAll]  = useState(false);
  const [trackUrl,    setTrackUrl]    = useState('');
  const [trackError,  setTrackError]  = useState('');
  const [trackErrorSource, setTrackErrorSource] = useState('');
  const [tracking,    setTracking]    = useState(false);
  const [trackOk,     setTrackOk]     = useState(false);

  const reload = useCallback(() => {
    getHistory().then(setItems).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // Toplam metrikler
  const totals = items.reduce(
    (acc, item) => {
      if (item.metrics) {
        acc.likes    += item.metrics.likes    || 0;
        acc.comments += item.metrics.comments || 0;
        acc.shares   += item.metrics.shares   || 0;
        acc.views    += item.metrics.views    || 0;
      }
      return acc;
    },
    { likes: 0, comments: 0, shares: 0, views: 0 },
  );

  // Metrik çekme PostHistory ile ortak (lib/post-history)
  const refreshOne = async (item: PostHistoryItem) => {
    setRefreshing(item.id);
    setTrackError(''); setTrackErrorSource('');
    const m = await fetchPostMetrics(item);
    if ('error' in m) { setTrackErrorSource(PLATFORM_META[item.platform]?.label || item.platform); setTrackError(m.error); }
    else await updateMetrics(item.id, m);
    reload();
    setRefreshing(null);
  };

  const refreshAllItems = async () => {
    setRefreshAll(true);
    await refreshMetrics(items);
    reload();
    setRefreshAll(false);
  };

  const handleRemove = async (id: string) => {
    if (!confirm(lang === 'tr' ? 'Bu kaydı kaldırmak istediğine emin misin?' : 'Remove this entry?')) return;
    await removePost(id);
    reload();
  };

  // Manuel URL ile post ekle
  const handleTrack = async () => {
    setTrackError(''); setTrackErrorSource('');
    const url = trackUrl.trim();
    if (!url) { setTrackError(lang === 'tr' ? 'URL girin' : 'Enter a URL'); return; }
    const parsed = parsePostUrl(url);
    if (!parsed) {
      setTrackError(lang === 'tr'
        ? 'Tanınan bir gönderi URL\'si değil (Twitter, LinkedIn, Facebook, Instagram — FB için {sayfaId}_{gönderiId} de olur)'
        : 'Not a recognized post URL (Twitter, LinkedIn, Facebook, Instagram — FB {pageId}_{postId} ids work too)');
      return;
    }
    setTracking(true);
    await addPost({ platform: parsed.platform, postId: parsed.postId, postUrl: url, content: url, publishedAt: Date.now() });
    setTrackUrl('');
    setTrackOk(true);
    setTimeout(() => setTrackOk(false), 3000);
    reload();
    setTracking(false);
  };

  const formatRelative = (ts: number) => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1)  return lang === 'tr' ? 'az önce' : 'just now';
    if (m < 60) return lang === 'tr' ? `${m} dk önce` : `${m}m ago`;
    if (h < 24) return lang === 'tr' ? `${h} sa önce` : `${h}h ago`;
    if (d < 30) return lang === 'tr' ? `${d} gün önce` : `${d}d ago`;
    return new Date(ts).toLocaleDateString(localeTag(lang));
  };

  return (
    <div className="flex flex-col gap-4">

      {/* ── Başlık + aksiyonlar ── */}
      {!compact && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              📊 {lang === 'tr' ? 'Etkileşim Takibi' : 'Engagement tracking'}
            </h3>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
              {items.length} {lang === 'tr' ? 'paylaşım izleniyor' : 'posts tracked'}
            </p>
          </div>
          {items.length > 0 && (
            <button
              onClick={refreshAllItems}
              disabled={refreshAll}
              className="text-xs bg-ocean hover:bg-ocean-dark disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-colors"
            >
              {refreshAll
                ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> {lang === 'tr' ? 'Yenileniyor…' : 'Refreshing…'}</>
                : `🔄 ${lang === 'tr' ? 'Tümünü Yenile' : 'Refresh all'}`}
            </button>
          )}
        </div>
      )}

      {/* ── Toplam özet bar ── */}
      {items.length > 0 && items.some(i => i.metrics) && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { icon: '❤️', label: lang === 'tr' ? 'Beğeni' : 'Likes',    val: totals.likes    },
            { icon: '💬', label: lang === 'tr' ? 'Yorum' : 'Comments',  val: totals.comments },
            { icon: '🔁', label: lang === 'tr' ? 'Paylaşım' : 'Shares', val: totals.shares   },
            { icon: '👁️', label: lang === 'tr' ? 'Görüntüleme' : 'Views', val: totals.views },
          ].map(s => (
            <div key={s.label} className="bg-slate-50 dark:bg-slate-700/60 rounded-xl p-3 flex flex-col items-center gap-0.5 border border-slate-100 dark:border-slate-600">
              <span className="text-base">{s.icon}</span>
              <span className="text-lg font-bold text-slate-700 dark:text-slate-200">{s.val.toLocaleString(localeTag(lang))}</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Manuel URL ile post ekle ── */}
      <div className="bg-white dark:bg-slate-700/40 border border-dashed border-slate-200 dark:border-slate-600 rounded-xl p-3 flex flex-col gap-2">
        <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          🔗 {lang === 'tr' ? 'Post URL\'si ile Takip Et' : 'Track by post URL'}
        </p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500">
          {lang === 'tr'
            ? 'Twitter, LinkedIn, Facebook veya Instagram post URL\'sini yapıştır — beğeni, yorum ve görüntülemeler izlenir.'
            : 'Paste a Twitter, LinkedIn, Facebook or Instagram post URL — likes, comments and views will be tracked.'}
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={trackUrl}
            onChange={e => { setTrackUrl(e.target.value); setTrackError(''); setTrackErrorSource(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleTrack(); }}
            placeholder={lang === 'tr' ? 'https://twitter.com/... veya linkedin.com/...' : 'https://twitter.com/... or linkedin.com/...'}
            className="flex-1 text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50 placeholder-slate-400"
          />
          <button
            onClick={handleTrack}
            disabled={tracking || !trackUrl.trim()}
            className="text-xs bg-ocean hover:bg-ocean-dark disabled:opacity-50 text-white px-3 py-2 rounded-lg font-medium transition-colors whitespace-nowrap flex items-center gap-1"
          >
            {tracking
              ? <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
              : trackOk ? '✅' : (lang === 'tr' ? '+ Ekle' : '+ Add')}
          </button>
        </div>
        {trackError && <p className="text-[10px] text-red-500">{trackErrorSource ? `${trackErrorSource}: ` : ''}<Msg text={trackError} /></p>}
      </div>

      {/* ── Post listesi ── */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400 dark:text-slate-500">
          <span className="text-4xl opacity-30">📭</span>
          <p className="text-xs text-center">
            {lang === 'tr'
              ? <>Henüz izlenen paylaşım yok.<br />Paylaşım yaptıktan sonra URL&apos;yi buraya ekle veya API ile paylaş.</>
              : <>No tracked posts yet.<br />Add a post URL above or share via API to start tracking.</>}
          </p>
        </div>
      ) : (
        <div className={`flex flex-col gap-2.5 overflow-y-auto ${compact ? '' : 'max-h-[520px]'}`}>
          {items.map(item => {
            const meta  = PLATFORM_META[item.platform] || { icon: '📱', label: item.platform, color: 'bg-slate-500 text-white' };
            const m     = item.metrics;
            const stale = m && Date.now() - (m.fetchedAt || 0) > 1800000; // 30dk
            return (
              <div key={item.id} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                {/* Üst bant */}
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-700 flex-wrap gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.color}`}>
                      {meta.icon} {meta.label}
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">{formatRelative(item.publishedAt)}</span>
                    {stale && <span className="text-[10px] text-orange-500">⚠️ {lang === 'tr' ? 'Güncelle' : 'Stale'}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {item.postUrl && (
                      <a
                        href={item.postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-ocean hover:text-ocean-dark font-medium px-2 py-0.5 rounded hover:bg-ocean/10 transition-colors"
                      >
                        {lang === 'tr' ? 'Görüntüle ↗' : 'View ↗'}
                      </a>
                    )}
                    <button
                      onClick={() => refreshOne(item)}
                      disabled={refreshing === item.id}
                      title={lang === 'tr' ? 'Metrikleri yenile' : 'Refresh metrics'}
                      aria-label={lang === 'tr' ? 'Metrikleri yenile' : 'Refresh metrics'}
                      className="text-[11px] bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 hover:border-ocean hover:text-ocean text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded font-medium transition-colors disabled:opacity-50"
                    >
                      {refreshing === item.id
                        ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" />
                        : '🔄'}
                    </button>
                    <button
                      onClick={() => handleRemove(item.id)}
                      title={lang === 'tr' ? 'Kaydı kaldır' : 'Remove entry'}
                      aria-label={lang === 'tr' ? 'Kaydı kaldır' : 'Remove entry'}
                      className="text-[11px] text-slate-400 hover:text-red-500 px-1 transition-colors"
                    >✕</button>
                  </div>
                </div>

                {/* İçerik + thumbnail */}
                <div className="flex gap-3 px-3 py-2.5 bg-white dark:bg-slate-800">
                  {item.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`data:image/jpeg;base64,${item.thumbnail}`} alt="" className="w-14 h-14 object-cover rounded-lg shrink-0" />
                  )}
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2 flex-1 my-auto">
                    {item.content.length > 120 ? item.content.slice(0, 120) + '…' : item.content}
                  </p>
                </div>

                {/* Metrik bar */}
                <div className="grid grid-cols-4 gap-px bg-slate-100 dark:bg-slate-700 border-t border-slate-200 dark:border-slate-700">
                  {[
                    { icon: '❤️', label: lang === 'tr' ? 'Beğeni' : 'Likes',    val: m?.likes    },
                    { icon: '💬', label: lang === 'tr' ? 'Yorum' : 'Comments',  val: m?.comments },
                    { icon: '🔁', label: lang === 'tr' ? 'Paylaşım' : 'Shares', val: m?.shares   },
                    { icon: '👁️', label: lang === 'tr' ? 'Görüntüleme' : 'Views', val: m?.views },
                  ].map(s => (
                    <div key={s.label} className="bg-white dark:bg-slate-800 py-2 flex flex-col items-center justify-center">
                      <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wide">{s.icon} {s.label}</span>
                      <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                        {!m ? <span className="text-slate-300 dark:text-slate-600">—</span> : (s.val ?? 0).toLocaleString(localeTag(lang))}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Güncelleme zamanı */}
                {m && (
                  <p className={`text-[10px] text-center py-1 ${stale ? 'text-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800'}`}>
                    {lang === 'tr' ? 'Son güncelleme:' : 'Updated:'} {formatRelative(m.fetchedAt)}
                    {stale && (lang === 'tr' ? ' — güncel olmayabilir' : ' — may be outdated')}
                  </p>
                )}
                {!m && (
                  <button
                    onClick={() => refreshOne(item)}
                    disabled={refreshing === item.id}
                    className="w-full text-[11px] py-1.5 text-ocean hover:bg-ocean/5 bg-slate-50 dark:bg-slate-800 font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {refreshing === item.id
                      ? <><span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> {lang === 'tr' ? 'Yükleniyor…' : 'Loading…'}</>
                      : (lang === 'tr' ? '🔄 Metrikleri getir' : '🔄 Fetch metrics')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
