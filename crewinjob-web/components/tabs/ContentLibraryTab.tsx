'use client';
import { useState, useEffect } from 'react';
import { getHistory, deleteFromHistory, clearHistory, attachImageToItem, updateHistoryContent, type HistoryItem } from '@/lib/content-history';
import { compositePostImage } from '@/lib/image-composite';
import { getImageModel } from '@/components/ModelPicker';
import SharePanel from '@/components/SharePanel';

const LOGO_KEY = 'crewinjob_brand_logo';

const PLATFORM_META: Record<string, { icon: string; label: string; bg: string; text: string }> = {
  twitter:   { icon: '🐦', label: 'Twitter / X', bg: 'bg-slate-800',       text: 'text-white'  },
  linkedin:  { icon: '💼', label: 'LinkedIn',    bg: 'bg-blue-700',        text: 'text-white'  },
  facebook:  { icon: '👥', label: 'Facebook',    bg: 'bg-blue-500',        text: 'text-white'  },
  instagram: { icon: '📸', label: 'Instagram',   bg: 'bg-pink-500',        text: 'text-white'  },
  tiktok:    { icon: '🎵', label: 'TikTok',      bg: 'bg-slate-900',       text: 'text-white'  },
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'az önce';
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa önce`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} gün önce`;
  return new Date(ts).toLocaleDateString('tr-TR');
}

export default function ContentLibraryTab() {
  const [items,        setItems]        = useState<HistoryItem[]>([]);
  const [filter,       setFilter]       = useState<string>('all');
  const [shareItem,    setShareItem]    = useState<HistoryItem | null>(null);
  const [copiedId,     setCopiedId]     = useState<string | null>(null);
  const [search,       setSearch]       = useState('');
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [genError,     setGenError]     = useState<string | null>(null);
  const [logoBase64,   setLogoBase64]   = useState('');
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [editValue,    setEditValue]    = useState('');

  useEffect(() => {
    setItems(getHistory());
    try {
      const savedLogo = localStorage.getItem(LOGO_KEY);
      if (savedLogo) setLogoBase64(savedLogo);
    } catch { /* ignore */ }
  }, []);

  const reload = () => setItems(getHistory());

  const handleDelete = (id: string) => {
    setItems(deleteFromHistory(id));
  };

  const handleClearAll = () => {
    if (!confirm('Tüm içerik geçmişini silmek istiyor musun? Bu işlem geri alınamaz.')) return;
    clearHistory();
    setItems([]);
  };

  const handleCopy = async (item: HistoryItem) => {
    await navigator.clipboard.writeText(item.content);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const downloadImage = (item: HistoryItem) => {
    if (!item.imageData) return;
    const link = document.createElement('a');
    link.href = `data:${item.imageMime || 'image/png'};base64,${item.imageData}`;
    link.download = `crewinjob_${item.platform}_${item.id}.png`;
    link.click();
  };

  const startEdit = (item: HistoryItem) => {
    setEditingId(item.id);
    setEditValue(item.content);
  };

  const saveEdit = (id: string) => {
    updateHistoryContent(id, editValue);
    setEditingId(null);
    setItems(getHistory());
  };

  const handleGenerateImage = async (item: HistoryItem) => {
    setGeneratingId(item.id);
    setGenError(null);
    try {
      const res = await fetch('/api/generate-image', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          platform:     item.platform,
          contentType:  'ilan_ozeti',
          textContent:  item.content,
          imageModel:   getImageModel(),
          refImages:    [],
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const mime      = data.mimeType  || 'image/jpeg';
      const rawB64    = data.imageData as string;
      const headline  = (data.headline as string) || 'The Right Job\nThe Right Talent';
      const finalB64  = await compositePostImage(mime, rawB64, logoBase64, headline, item.platform);

      attachImageToItem(item.id, finalB64, 'image/png');
      setItems(getHistory());
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : 'Görsel oluşturulamadı');
      setTimeout(() => setGenError(null), 4000);
    } finally {
      setGeneratingId(null);
    }
  };

  const platforms = ['all', ...Array.from(new Set(items.map(i => i.platform)))];

  const filtered = items.filter(item => {
    const matchPlatform = filter === 'all' || item.platform === filter;
    const matchSearch   = !search.trim() ||
      item.content.toLowerCase().includes(search.toLowerCase()) ||
      item.prompt.toLowerCase().includes(search.toLowerCase());
    return matchPlatform && matchSearch;
  });

  const withImage    = filtered.filter(i => !!i.imageData).length;
  const withoutImage = filtered.filter(i => !i.imageData).length;

  return (
    <div className="flex flex-col gap-5">

      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-bold text-slate-800 dark:text-slate-100 text-lg flex items-center gap-2">
            <span>🗂️</span> İçerik Kütüphanesi
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {items.length} içerik · {withImage} görsel · Tekrar paylaş veya kopyala
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={reload}
            className="text-xs flex items-center gap-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 px-3 py-2 rounded-lg transition-colors font-medium"
          >
            🔄 Yenile
          </button>
          {items.length > 0 && (
            <button
              onClick={handleClearAll}
              className="text-xs flex items-center gap-1.5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 px-3 py-2 rounded-lg transition-colors font-medium"
            >
              🗑️ Tümünü Temizle
            </button>
          )}
        </div>
      </div>

      {/* ── Filtreler + Arama ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Platform filtresi */}
        <div className="flex flex-wrap gap-1.5">
          {platforms.map(p => {
            const meta = PLATFORM_META[p];
            const count = p === 'all' ? items.length : items.filter(i => i.platform === p).length;
            return (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-all border ${
                  filter === p
                    ? 'bg-ocean text-white border-ocean shadow-sm'
                    : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-ocean/50 hover:text-ocean'
                }`}
              >
                {meta ? meta.icon : '🌐'} {p === 'all' ? 'Tümü' : (meta?.label || p)}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${filter === p ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-600 text-slate-500 dark:text-slate-400'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Arama */}
        <div className="sm:ml-auto relative">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="İçerik veya prompt ara..."
            className="text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 pl-8 focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean bg-white dark:bg-slate-700 dark:text-slate-100 w-56 placeholder:text-slate-400"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
            >✕</button>
          )}
        </div>
      </div>

      {/* ── Hata bildirimi ── */}
      {genError && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 rounded-xl px-4 py-2.5 text-sm">
          <span>❌</span><span>{genError}</span>
        </div>
      )}

      {/* ── İçerik Kartları ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-72 gap-3 text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
          <span className="text-5xl opacity-20">🗂️</span>
          {items.length === 0 ? (
            <>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Henüz içerik üretilmedi</p>
              <p className="text-xs text-center text-slate-400 dark:text-slate-500">
                Sosyal Medya sekmesinden içerik üret,<br />otomatik olarak buraya kaydedilir.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">Bu filtreye uyan içerik bulunamadı</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(item => {
            const meta = PLATFORM_META[item.platform] || { icon: '📝', label: item.platform, bg: 'bg-slate-500', text: 'text-white' };
            return (
              <div
                key={item.id}
                className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow"
              >
                {/* Görsel veya placeholder */}
                {item.imageData ? (
                  <div className="relative h-40 bg-slate-900 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:${item.imageMime || 'image/png'};base64,${item.imageData}`}
                      alt="Post görseli"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <span className={`absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>
                      {meta.icon} {meta.label}
                    </span>
                    <span className="absolute top-2 right-2 text-[10px] bg-black/50 text-white px-2 py-0.5 rounded-full">
                      {item.language === 'tr' ? '🇹🇷' : '🇬🇧'}
                    </span>
                  </div>
                ) : (
                  <div className="h-16 bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-700/80 dark:to-slate-800 flex items-center px-3 gap-2 border-b border-slate-200 dark:border-slate-700">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.text}`}>
                      {meta.icon} {meta.label}
                    </span>
                    <span className="text-[10px] bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">
                      {item.language === 'tr' ? '🇹🇷' : '🇬🇧'}
                    </span>
                    <button
                      onClick={() => handleGenerateImage(item)}
                      disabled={generatingId === item.id}
                      className="ml-auto flex items-center gap-1.5 text-[11px] bg-ocean hover:bg-ocean-dark disabled:opacity-60 text-white px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                    >
                      {generatingId === item.id ? (
                        <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> Üretiliyor...</>
                      ) : (
                        <>✨ Görsel Oluştur</>
                      )}
                    </button>
                  </div>
                )}

                {/* İçerik */}
                <div className="p-3 flex-1 flex flex-col gap-2">
                  {/* Prompt özeti */}
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 italic line-clamp-1 leading-relaxed">
                    💬 {item.prompt.slice(0, 80)}{item.prompt.length > 80 ? '...' : ''}
                  </p>
                  {/* İçerik — düzenleme modu veya önizleme */}
                  {editingId === item.id ? (
                    <div className="flex flex-col gap-2 flex-1">
                      <textarea
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        rows={5}
                        className="w-full border border-ocean/50 rounded-lg px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ocean/50 bg-white dark:bg-slate-700 dark:text-slate-100 leading-relaxed"
                        autoFocus
                      />
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => saveEdit(item.id)}
                          className="flex-1 text-xs bg-ocean text-white py-1.5 rounded-lg font-medium hover:bg-ocean-dark transition-colors"
                        >
                          ✅ Kaydet
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-xs border border-slate-200 dark:border-slate-600 text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                        >
                          İptal
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed line-clamp-4 flex-1">
                      {item.content}
                    </p>
                  )}
                  {/* Meta */}
                  {editingId !== item.id && (
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">{timeAgo(item.timestamp)}</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">{item.content.length} kar.</span>
                    </div>
                  )}
                </div>

                {/* Aksiyonlar */}
                {editingId !== item.id && (
                <div className="flex border-t border-slate-100 dark:border-slate-700">
                  <button
                    onClick={() => handleCopy(item)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-medium"
                  >
                    {copiedId === item.id ? '✅' : '📋'}
                  </button>
                  <div className="w-px bg-slate-100 dark:bg-slate-700" />
                  <button
                    onClick={() => startEdit(item)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors font-medium"
                  >
                    ✏️
                  </button>
                  <div className="w-px bg-slate-100 dark:bg-slate-700" />
                  {item.imageData && (
                    <>
                      <button
                        onClick={() => downloadImage(item)}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 text-ocean dark:text-ocean hover:bg-ocean/5 transition-colors font-medium"
                        title="Görseli indir"
                      >
                        ⬇️
                      </button>
                      <div className="w-px bg-slate-100 dark:bg-slate-700" />
                    </>
                  )}
                  <button
                    onClick={() => setShareItem(item)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors font-medium"
                  >
                    📤 Paylaş
                  </button>
                  <div className="w-px bg-slate-100 dark:bg-slate-700" />
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="px-3 py-2 text-xs text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    🗑️
                  </button>
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── İstatistik özeti ── */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
          {[
            { label: 'Toplam İçerik', value: items.length,     icon: '📝' },
            { label: 'Görsel Var',    value: withImage,        icon: '🖼️' },
            { label: 'Görsel Yok',    value: withoutImage,     icon: '📄' },
            { label: 'Platform',      value: platforms.length - 1, icon: '📱' },
          ].map(stat => (
            <div key={stat.label} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex items-center gap-3">
              <span className="text-xl">{stat.icon}</span>
              <div>
                <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">{stat.value}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── SharePanel modal ── */}
      {shareItem && (
        <SharePanel
          content={shareItem.content}
          imageData={shareItem.imageData}
          imageMime={shareItem.imageMime || 'image/png'}
          onClose={() => setShareItem(null)}
        />
      )}
    </div>
  );
}
