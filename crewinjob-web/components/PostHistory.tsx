'use client';
import { useState, useEffect, useCallback } from 'react';
import { getHistory, updateMetrics, removePost, clearHistory, type PostHistoryItem, type PostMetrics } from '@/lib/post-history';

const PLATFORM_META: Record<string, { icon: string; label: string; color: string }> = {
  twitter:   { icon: '🐦', label: 'Twitter / X',   color: 'bg-slate-900 text-white'                },
  linkedin:  { icon: '💼', label: 'LinkedIn',      color: 'bg-blue-700 text-white'                  },
  facebook:  { icon: '👥', label: 'Facebook',      color: 'bg-blue-600 text-white'                  },
  instagram: { icon: '📸', label: 'Instagram',     color: 'bg-gradient-to-br from-purple-500 to-pink-500 text-white' },
};

interface Props {
  onClose: () => void;
}

export default function PostHistory({ onClose }: Props) {
  const [items,      setItems]      = useState<PostHistoryItem[]>([]);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [refreshAll, setRefreshAll] = useState(false);

  const reload = useCallback(() => setItems(getHistory()), []);
  useEffect(() => { reload(); }, [reload]);

  const fetchStats = useCallback(async (item: PostHistoryItem): Promise<PostMetrics | null> => {
    try {
      const url = `/api/social/post-stats?platform=${item.platform}&postId=${encodeURIComponent(item.postId)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) {
        console.warn(`[PostHistory] ${item.platform} hata:`, data.error);
        return null;
      }
      return {
        likes:     data.likes    || 0,
        comments:  data.comments || 0,
        shares:    data.shares   || 0,
        views:     data.views    || 0,
        fetchedAt: data.fetchedAt || Date.now(),
      };
    } catch {
      return null;
    }
  }, []);

  const refreshOne = async (item: PostHistoryItem) => {
    setRefreshing(item.id);
    const m = await fetchStats(item);
    if (m) updateMetrics(item.id, m);
    reload();
    setRefreshing(null);
  };

  const refreshAllItems = async () => {
    setRefreshAll(true);
    await Promise.all(items.map(async (item) => {
      const m = await fetchStats(item);
      if (m) updateMetrics(item.id, m);
    }));
    reload();
    setRefreshAll(false);
  };

  const handleRemove = (id: string) => {
    if (!confirm('Bu paylaşımı geçmişten kaldırmak istediğine emin misin?')) return;
    removePost(id);
    reload();
  };

  const handleClearAll = () => {
    if (!confirm('TÜM paylaşım geçmişini silmek istediğine emin misin? Bu işlem geri alınamaz.')) return;
    clearHistory();
    reload();
  };

  const formatRelative = (ts: number) => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(diff / 86400000);
    if (m < 1)  return 'az önce';
    if (m < 60) return `${m} dakika önce`;
    if (h < 24) return `${h} saat önce`;
    if (d < 30) return `${d} gün önce`;
    return new Date(ts).toLocaleDateString('tr-TR');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 z-10">
          <div className="flex items-center gap-3">
            <span className="text-xl">📊</span>
            <div>
              <h2 className="font-bold text-slate-800 dark:text-slate-100">Paylaşım Geçmişi & Metrikler</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">{items.length} paylaşım · Beğeni, yorum, görüntüleme takibi</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <>
                <button
                  onClick={refreshAllItems}
                  disabled={refreshAll}
                  className="text-xs bg-ocean hover:bg-ocean-dark text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {refreshAll ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Yenileniyor...</> : '🔄 Tümünü Yenile'}
                </button>
                <button
                  onClick={handleClearAll}
                  className="text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-lg font-medium transition-colors border border-red-200 dark:border-red-800"
                >
                  🗑️ Hepsini Sil
                </button>
              </>
            )}
            <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none">✕</button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-72 gap-3 text-slate-400 dark:text-slate-500">
              <span className="text-5xl opacity-30">📭</span>
              <p className="text-sm text-center">Henüz paylaşım yok.<br />İlk postunuzu paylaşın, metrikleri burada görün.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {items.map(item => {
                const meta    = PLATFORM_META[item.platform] || { icon: '📱', label: item.platform, color: 'bg-slate-500 text-white' };
                const m       = item.metrics;
                const stale   = m && Date.now() - (m.fetchedAt || 0) > 1800000; // 30 dk
                return (
                  <div key={item.id} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    {/* Üst bant */}
                    <div className="flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-slate-700">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.color}`}>
                          {meta.icon} {meta.label}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">{formatRelative(item.publishedAt)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {item.postUrl && (
                          <a
                            href={item.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-ocean hover:text-ocean-dark font-medium px-2 py-1 rounded hover:bg-ocean/10"
                          >
                            Görüntüle ↗
                          </a>
                        )}
                        <button
                          onClick={() => refreshOne(item)}
                          disabled={refreshing === item.id}
                          className="text-[11px] bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 hover:border-ocean hover:text-ocean text-slate-600 dark:text-slate-300 px-2 py-1 rounded font-medium transition-colors disabled:opacity-50"
                        >
                          {refreshing === item.id ? '⏳' : '🔄'} Yenile
                        </button>
                        <button
                          onClick={() => handleRemove(item.id)}
                          className="text-[11px] text-slate-400 hover:text-red-500 px-1"
                          title="Geçmişten kaldır"
                        >✕</button>
                      </div>
                    </div>

                    {/* İçerik bloğu */}
                    <div className="flex gap-3 p-3">
                      {item.thumbnail && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`data:image/jpeg;base64,${item.thumbnail}`} alt="" className="w-20 h-20 object-cover rounded-lg shrink-0" />
                      )}
                      <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed line-clamp-3 flex-1">{item.content}</p>
                    </div>

                    {/* Metrikler */}
                    <div className="grid grid-cols-4 gap-px bg-slate-200 dark:bg-slate-600 border-t border-slate-200 dark:border-slate-600">
                      <Stat label="❤️ Beğeni"     value={m?.likes}     loading={!m} />
                      <Stat label="💬 Yorum"      value={m?.comments}  loading={!m} />
                      <Stat label="🔁 Paylaşım"   value={m?.shares}    loading={!m} />
                      <Stat label="👁️ Görüntüleme" value={m?.views}     loading={!m} />
                    </div>

                    {m && (
                      <p className={`text-[10px] text-center py-1 ${stale ? 'text-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-700'}`}>
                        Son güncelleme: {formatRelative(m.fetchedAt)} {stale && '— güncel olmayabilir, yenileyin'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, loading }: { label: string; value?: number; loading: boolean }) {
  return (
    <div className="bg-white dark:bg-slate-800 px-3 py-2 flex flex-col items-center justify-center">
      <span className="text-[9px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wide">{label}</span>
      <span className="text-base font-bold text-slate-700 dark:text-slate-200">
        {loading ? <span className="text-slate-300">—</span> : (value ?? 0).toLocaleString('tr-TR')}
      </span>
    </div>
  );
}
