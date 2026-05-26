'use client';
import { useState, useEffect, useCallback } from 'react';
import type { ScheduledPost } from '@/lib/scheduled-posts';

const PLATFORM_ICONS: Record<string, string> = {
  twitter: '🐦', linkedin: '💼', facebook: '👥', instagram: '📸', tiktok: '🎵',
};

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  published: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  failed:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '⏰ Bekliyor', published: '✅ Yayınlandı', failed: '❌ Başarısız', cancelled: '🚫 İptal',
};

interface Props {
  /** Hızlı planlama: dışarıdan içerik ve görsel geçilebilir */
  prefillContent?: string;
  prefillImageData?: string;
  prefillImageMime?: string;
  onClose?: () => void;
}

export default function SchedulePanel({ prefillContent, prefillImageData, prefillImageMime, onClose }: Props) {
  const [posts,       setPosts]       = useState<ScheduledPost[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [publishing,  setPublishing]  = useState(false);
  const [publishResult, setPublishResult] = useState<{ published: number; failed: number } | null>(null);

  // Yeni post formu
  const [showForm,      setShowForm]      = useState(!!prefillContent);
  const [formContent,   setFormContent]   = useState(prefillContent || '');
  const [formPlatforms, setFormPlatforms] = useState<string[]>([]);
  const [formSchedule,  setFormSchedule]  = useState('');  // datetime-local value
  const [formNote,      setFormNote]      = useState('');
  const [saving,        setSaving]        = useState(false);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/schedule');
      const data = await res.json() as ScheduledPost[];
      setPosts(data);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  const handleDelete = async (id: string) => {
    if (!confirm('Bu zamanlanmış postu silmek istediğinizden emin misiniz?')) return;
    await fetch(`/api/schedule/${id}`, { method: 'DELETE' });
    setPosts(prev => prev.filter(p => p.id !== id));
  };

  const handleCancel = async (id: string) => {
    const res  = await fetch(`/api/schedule/${id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: 'cancelled' }),
    });
    const updated = await res.json() as ScheduledPost;
    setPosts(prev => prev.map(p => p.id === id ? updated : p));
  };

  const handlePublishNow = async () => {
    setPublishing(true);
    setPublishResult(null);
    try {
      const res  = await fetch('/api/schedule/publish', { method: 'POST' });
      const data = await res.json() as { published: number; failed: number };
      setPublishResult(data);
      await fetchPosts();
    } catch { /* ignore */ } finally { setPublishing(false); }
  };

  const handleSavePost = async () => {
    if (!formContent.trim())    return alert('İçerik boş olamaz');
    if (!formPlatforms.length)  return alert('En az bir platform seçin');
    if (!formSchedule)          return alert('Zamanlama tarihi seçin');

    setSaving(true);
    try {
      const scheduledAt = new Date(formSchedule).toISOString();
      const res = await fetch('/api/schedule', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          platforms:   formPlatforms,
          content:     formContent,
          imageData:   prefillImageData,
          imageMime:   prefillImageMime,
          scheduledAt,
          note:        formNote || undefined,
        }),
      });
      const newPost = await res.json() as ScheduledPost;
      setPosts(prev => [...prev, newPost].sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
      ));
      setShowForm(false);
      setFormContent('');
      setFormPlatforms([]);
      setFormSchedule('');
      setFormNote('');
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const togglePlatform = (p: string) =>
    setFormPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  // datetime-local minimum değeri: şu andan 5 dakika sonra
  const minDateTime = new Date(Date.now() + 5 * 60 * 1000)
    .toISOString().slice(0, 16);

  const pendingCount    = posts.filter(p => p.status === 'pending').length;
  const publishedCount  = posts.filter(p => p.status === 'published').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <span className="text-xl">📅</span>
            <div>
              <h2 className="font-bold text-slate-800 dark:text-slate-100">İçerik Takvimi</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {pendingCount} bekliyor · {publishedCount} yayınlandı
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePublishNow}
              disabled={publishing || pendingCount === 0}
              className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5"
              title="Zamanı gelmiş postları hemen yayınla"
            >
              {publishing
                ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin inline-block" /> Yayınlanıyor...</>
                : <>▶ Şimdi Yayınla</>}
            </button>
            <button
              onClick={() => setShowForm(v => !v)}
              className="text-xs bg-ocean hover:bg-ocean-dark text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
            >
              {showForm ? '✕ İptal' : '+ Yeni Post'}
            </button>
            {onClose && (
              <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none ml-1">✕</button>
            )}
          </div>
        </div>

        {/* Publish result toast */}
        {publishResult && (
          <div className={`mx-6 mt-4 px-4 py-3 rounded-xl text-sm flex items-center gap-2 ${
            publishResult.published > 0 ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
          }`}>
            {publishResult.published > 0 ? '✅' : '⚠️'}
            <span>{publishResult.published} post yayınlandı{publishResult.failed > 0 ? `, ${publishResult.failed} başarısız` : ''}</span>
            <button onClick={() => setPublishResult(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* Yeni post formu */}
        {showForm && (
          <div className="mx-6 mt-4 p-4 bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-600 flex flex-col gap-3">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">📝 Yeni Zamanlanmış Post</p>

            {/* Platform seçimi */}
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">Platform</p>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(PLATFORM_ICONS).map(([p, icon]) => (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                      formPlatforms.includes(p)
                        ? 'bg-ocean border-ocean text-white'
                        : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-ocean'
                    }`}
                  >
                    {icon} {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* İçerik */}
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">İçerik</p>
              <textarea
                value={formContent}
                onChange={e => setFormContent(e.target.value)}
                rows={4}
                placeholder="Paylaşılacak içeriği buraya yazın..."
                className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg p-3 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-ocean resize-none"
              />
              <p className="text-[10px] text-slate-400 mt-0.5">{formContent.length} karakter</p>
            </div>

            {/* Tarih + Saat */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">Zamanlama (Tarih & Saat)</p>
                <input
                  type="datetime-local"
                  min={minDateTime}
                  value={formSchedule}
                  onChange={e => setFormSchedule(e.target.value)}
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-ocean"
                />
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">Not (isteğe bağlı)</p>
                <input
                  type="text"
                  value={formNote}
                  onChange={e => setFormNote(e.target.value)}
                  placeholder="Kısa açıklama..."
                  className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-ocean"
                />
              </div>
            </div>

            {prefillImageData && (
              <p className="text-xs text-green-600 dark:text-green-400">✅ Görsel eklenecek ({prefillImageMime || 'image/jpeg'})</p>
            )}

            <button
              onClick={handleSavePost}
              disabled={saving}
              className="w-full text-sm bg-ocean hover:bg-ocean-dark disabled:opacity-60 text-white py-2.5 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {saving
                ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Kaydediliyor...</>
                : '📅 Zamanlamayı Kaydet'}
            </button>
          </div>
        )}

        {/* Post listesi */}
        <div className="p-6 flex flex-col gap-3">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400 text-sm gap-2">
              <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
              Yükleniyor...
            </div>
          ) : posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-3">
              <span className="text-4xl">📅</span>
              <p className="text-sm text-center">Henüz zamanlanmış post yok.<br />Yukarıdaki <strong>+ Yeni Post</strong> butonunu kullanarak başlayın.</p>
            </div>
          ) : (
            posts.map(post => (
              <div key={post.id} className="bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-600 p-4 flex flex-col gap-2">
                {/* Başlık satırı */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex gap-1">
                      {post.platforms.map(p => (
                        <span key={p} title={p} className="text-base">{PLATFORM_ICONS[p] || '📱'}</span>
                      ))}
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[post.status]}`}>
                      {STATUS_LABEL[post.status]}
                    </span>
                    {post.imageData && <span className="text-[10px] text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded">🖼️ Görsel</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {new Date(post.scheduledAt).toLocaleString('tr-TR', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    {post.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleCancel(post.id)}
                          className="text-[10px] text-amber-600 hover:text-amber-800 dark:hover:text-amber-400 font-medium px-1.5 py-0.5 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                        >İptal</button>
                        <button
                          onClick={() => handleDelete(post.id)}
                          className="text-[10px] text-red-500 hover:text-red-700 font-medium px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >Sil</button>
                      </>
                    )}
                    {(post.status === 'cancelled' || post.status === 'failed') && (
                      <button
                        onClick={() => handleDelete(post.id)}
                        className="text-[10px] text-slate-400 hover:text-red-500 font-medium px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      >Sil</button>
                    )}
                  </div>
                </div>

                {/* İçerik önizleme */}
                <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 leading-relaxed">
                  {post.content}
                </p>

                {/* Not */}
                {post.note && (
                  <p className="text-[10px] text-slate-400 italic">📌 {post.note}</p>
                )}

                {/* Sonuçlar (yayınlandıktan sonra) */}
                {post.results && post.results.length > 0 && (
                  <div className="flex gap-2 flex-wrap mt-1">
                    {post.results.map((r, i) => (
                      <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${r.success ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'}`}>
                        {PLATFORM_ICONS[r.platform] || '📱'} {r.success ? '✅' : '❌'}
                        {r.url && <> · <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline">Görüntüle</a></>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Cron Setup Note */}
        <div className="mx-6 mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-700">
          <p className="text-[10px] text-blue-700 dark:text-blue-300 font-semibold mb-1">⚙️ Otomatik Yayınlama (Cron)</p>
          <p className="text-[10px] text-blue-600 dark:text-blue-400 leading-relaxed">
            Zamanlanmış postları otomatik yayınlamak için VPS&apos;e cron job ekleyin:<br />
            <code className="bg-blue-100 dark:bg-blue-800/40 px-1 rounded font-mono">
              0 * * * * curl -X POST {typeof window !== 'undefined' ? window.location.origin : 'https://marketing.crewin.org'}/api/schedule/publish
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}
