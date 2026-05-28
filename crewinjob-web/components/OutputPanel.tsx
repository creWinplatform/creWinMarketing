'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { getImageModel } from './ModelPicker';
import SharePanel from './SharePanel';
import PostHistory from './PostHistory';
import SchedulePanel from './SchedulePanel';
import { attachImageToLatest, saveToHistory } from '@/lib/content-history';
import { compositePostImage } from '@/lib/image-composite';
import { logActivity } from '@/lib/activity-log';

interface Props {
  content: string;
  loading: boolean;
  error?: string;
  platform?: string;
  contentType?: string;
  /** Dolu olduğunda içerik değişince otomatik İçerik Kütüphanesi'ne kaydeder */
  autoSaveHistory?: { prompt: string; language?: string };
}

const LOGO_KEY = 'crewinjob_brand_logo';
const REFS_KEY = 'crewinjob_ref_posts';   // referans post görselleri (max 4)

export default function OutputPanel({
  content,
  loading,
  error,
  platform = 'instagram',
  contentType = 'ilan_ozeti',
  autoSaveHistory,
}: Props) {
  const [copied,       setCopied]       = useState(false);
  const [imgCopied,    setImgCopied]    = useState(false);
  const [imageData,    setImageData]    = useState('');
  const [imageMime,    setImageMime]    = useState('image/jpeg');
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError,   setImageError]   = useState('');
  const [logoBase64,   setLogoBase64]   = useState('');
  const [refImages,    setRefImages]    = useState<string[]>([]);   // base64 listesi
  const [showRefPanel, setShowRefPanel] = useState(false);
  const [showShare,    setShowShare]    = useState(false);
  const [showHistory,  setShowHistory]  = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  // ── İçerik kalite değerlendirmesi ──────────────────────────────────────────
  const [reviewing,    setReviewing]    = useState(false);
  const [reviewResult, setReviewResult] = useState<{
    score: number; grade: string; summary: string;
    strengths: string[]; weaknesses: string[];
    hashtag_score: number; hook_score: number; cta_score: number;
    improved: string;
  } | null>(null);
  const logoInputRef    = useRef<HTMLInputElement>(null);
  const refInputRef     = useRef<HTMLInputElement>(null);
  const lastSavedRef    = useRef<string>('');   // autoSaveHistory: son kaydedilen içeriği takip et

  // autoSaveHistory: content değişince İçerik Kütüphanesi'ne otomatik kaydet
  useEffect(() => {
    if (!autoSaveHistory || !content || content === lastSavedRef.current) return;
    lastSavedRef.current = content;
    void saveToHistory({
      platform,
      language: autoSaveHistory.language || 'en',
      content,
      prompt: autoSaveHistory.prompt,
    });
  }, [content, platform, autoSaveHistory]);

  useEffect(() => {
    try {
      const savedLogo = localStorage.getItem(LOGO_KEY);
      if (savedLogo) setLogoBase64(savedLogo);
      const savedRefs = localStorage.getItem(REFS_KEY);
      if (savedRefs) setRefImages(JSON.parse(savedRefs));
    } catch { /* ignore */ }
  }, []);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = (ev.target?.result as string).split(',')[1];
      setLogoBase64(b64);
      try { localStorage.setItem(LOGO_KEY, b64); } catch { /* ignore */ }
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setLogoBase64('');
    try { localStorage.removeItem(LOGO_KEY); } catch { /* ignore */ }
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const handleRefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = 4 - refImages.length;
    const toLoad = files.slice(0, remaining);
    let loaded = 0;
    const newRefs: string[] = [];
    toLoad.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const b64 = (ev.target?.result as string).split(',')[1];
        newRefs.push(b64);
        loaded++;
        if (loaded === toLoad.length) {
          const updated = [...refImages, ...newRefs];
          setRefImages(updated);
          try { localStorage.setItem(REFS_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
        }
      };
      reader.readAsDataURL(file);
    });
    if (refInputRef.current) refInputRef.current.value = '';
  };

  const removeRef = (idx: number) => {
    const updated = refImages.filter((_, i) => i !== idx);
    setRefImages(updated);
    try { localStorage.setItem(REFS_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const generateImage = useCallback(async () => {
    setImageLoading(true);
    setImageError('');
    setImageData('');
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, contentType, textContent: content, imageModel: getImageModel(), refImages }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const mime     = data.mimeType  || 'image/jpeg';
      const rawB64   = data.imageData as string;
      const headline = (data.headline as string) || 'The Right Job\nThe Right Talent';

      // Canvas ile profesyonel brand overlay — platform boyutuna ölçekler, PNG döndürür
      const finalB64 = await compositePostImage(mime, rawB64, logoBase64, headline, platform);

      setImageData(finalB64);
      setImageMime('image/png');
      void attachImageToLatest(finalB64, 'image/png');
      logActivity('image_generated', `${platform} için görsel üretildi`, `${contentType} · PNG`);
    } catch (e: unknown) {
      setImageError(e instanceof Error ? e.message : 'Görsel oluşturulamadı');
    } finally {
      setImageLoading(false);
    }
  }, [platform, contentType, content, logoBase64, refImages]);

  const downloadImage = () => {
    const link = document.createElement('a');
    link.href = `data:${imageMime};base64,${imageData}`;
    link.download = `crewinjob_${platform}_${contentType}_${Date.now()}.png`;
    link.click();
  };

  const reviewContent = async () => {
    setReviewing(true);
    setReviewResult(null);
    try {
      const res = await fetch('/api/content/review', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content, platform }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setReviewResult(data);
    } catch (e) {
      console.error('Review hatası:', e);
    } finally {
      setReviewing(false);
    }
  };

  /* ── States ── */
  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="w-10 h-10 border-4 border-ocean border-t-transparent rounded-full animate-spin" />
      <p className="text-slate-500 text-sm animate-pulse">Gemini AI içerik üretiyor...</p>
    </div>
  );

  if (error) return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4 text-red-700 dark:text-red-300 text-sm flex gap-2">
      <span>❌</span><span>{error}</span>
    </div>
  );

  if (!content) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400 dark:text-slate-500">
      <svg className="w-14 h-14 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <p className="text-sm text-center">Formu doldurun ve<br /><strong className="text-slate-500 dark:text-slate-400">İçerik Üret</strong> butonuna tıklayın.</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {showShare && (
        <SharePanel
          content={content}
          imageData={imageData || undefined}
          imageMime={imageMime}
          onClose={() => setShowShare(false)}
        />
      )}
      {showHistory && <PostHistory onClose={() => setShowHistory(false)} />}
      {showSchedule && (
        <SchedulePanel
          prefillContent={content}
          prefillImageData={imageData || undefined}
          prefillImageMime={imageData ? imageMime : undefined}
          onClose={() => setShowSchedule(false)}
        />
      )}

      {/* ── Metin çıktısı ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{content.length.toLocaleString('tr-TR')} karakter</span>
          <div className="flex gap-2 flex-wrap">
            <button onClick={copy} className="flex items-center gap-1.5 text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg transition-colors font-medium">
              {copied ? '✅ Kopyalandı!' : '📋 Kopyala'}
            </button>
            <button
              onClick={reviewContent}
              disabled={reviewing}
              className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
              title="AI ile içerik kalitesini değerlendir ve iyileştir"
            >
              {reviewing
                ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin inline-block" /> Değerlendiriliyor...</>
                : '⭐ Değerlendir'}
            </button>
            <button
              onClick={() => setShowSchedule(true)}
              className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
              title="İleride otomatik yayınlamak için zamanla"
            >
              📅 Zamanla
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
              title="Paylaşım geçmişi ve metrikler"
            >
              📊 Geçmiş
            </button>
            <button
              onClick={() => setShowShare(true)}
              className="flex items-center gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
            >
              📤 Paylaş
            </button>
          </div>
        </div>
        <pre className="bg-slate-900 text-slate-100 rounded-xl p-5 text-sm overflow-auto max-h-64 whitespace-pre-wrap font-mono leading-relaxed">
          {content}
        </pre>

        {/* ── İçerik kalite değerlendirme paneli ── */}
        {reviewResult && (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex flex-col gap-3">
            {/* Başlık + skor */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">⭐</span>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">İçerik Değerlendirmesi</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-2xl font-black ${reviewResult.score >= 80 ? 'text-green-500' : reviewResult.score >= 60 ? 'text-amber-500' : 'text-red-500'}`}>
                  {reviewResult.score}/100
                </span>
                <span className={`text-sm font-bold px-2 py-0.5 rounded-lg ${
                  reviewResult.grade === 'A+' || reviewResult.grade === 'A' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                  reviewResult.grade === 'B' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                }`}>{reviewResult.grade}</span>
              </div>
            </div>

            {/* Özet */}
            <p className="text-xs text-slate-600 dark:text-slate-300 italic">{reviewResult.summary}</p>

            {/* Alt skorlar */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Hook', score: reviewResult.hook_score, icon: '🎯' },
                { label: 'CTA', score: reviewResult.cta_score, icon: '📢' },
                { label: 'Hashtag', score: reviewResult.hashtag_score, icon: '#️⃣' },
              ].map(({ label, score, icon }) => (
                <div key={label} className="bg-slate-50 dark:bg-slate-700 rounded-lg p-2 text-center">
                  <div className="text-base">{icon}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
                  <div className={`text-sm font-bold ${score >= 7 ? 'text-green-600' : score >= 5 ? 'text-amber-600' : 'text-red-600'}`}>{score}/10</div>
                </div>
              ))}
            </div>

            {/* Güçlü / zayıf yanlar */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] font-semibold text-green-600 dark:text-green-400 mb-1">✅ Güçlü Yanlar</p>
                <ul className="flex flex-col gap-0.5">
                  {reviewResult.strengths.map((s, i) => (
                    <li key={i} className="text-[11px] text-slate-600 dark:text-slate-300">• {s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-red-500 dark:text-red-400 mb-1">⚠️ Geliştirilebilir</p>
                <ul className="flex flex-col gap-0.5">
                  {reviewResult.weaknesses.map((w, i) => (
                    <li key={i} className="text-[11px] text-slate-600 dark:text-slate-300">• {w}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* İyileştirilmiş versiyon */}
            {reviewResult.improved && (
              <div>
                <p className="text-[10px] font-semibold text-ocean mb-1">✨ AI ile İyileştirilmiş Versiyon</p>
                <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs overflow-auto max-h-40 whitespace-pre-wrap font-mono leading-relaxed">
                  {reviewResult.improved}
                </pre>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(reviewResult.improved);
                    setReviewResult(null);
                  }}
                  className="mt-2 w-full text-xs bg-ocean hover:bg-ocean-dark text-white px-3 py-2 rounded-lg font-medium transition-colors"
                >
                  📋 İyileştirilmiş Versiyonu Kopyala
                </button>
              </div>
            )}

            <button
              onClick={() => setReviewResult(null)}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-center"
            >
              Kapat ✕
            </button>
          </div>
        )}
      </div>

      {/* ── Görsel bölümü ── */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">

        {/* Header */}
        <div className="bg-slate-50 dark:bg-slate-700 px-4 py-3 border-b border-slate-200 dark:border-slate-600 flex flex-col gap-2">
          {/* Üst satır: başlık + butonlar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-base">🎨</span>
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Post Görseli</span>
              <span className="text-xs text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 px-2 py-0.5 rounded-full">
                {platform} · {contentType.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Logo */}
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              {logoBase64 ? (
                <div onClick={() => logoInputRef.current?.click()}
                  className="flex items-center gap-1.5 bg-white dark:bg-slate-600 border border-green-200 dark:border-green-700 rounded-lg px-2 py-1 cursor-pointer hover:border-ocean" title="Logo değiştir">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/png;base64,${logoBase64}`} alt="Logo" className="h-6 w-auto max-w-[90px] object-contain" />
                  <span className="text-xs text-green-600">✓</span>
                  <button onClick={e => { e.stopPropagation(); removeLogo(); }} className="text-slate-300 hover:text-red-500 text-xs">✕</button>
                </div>
              ) : (
                <button onClick={() => logoInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-xs bg-white dark:bg-slate-600 border border-dashed border-slate-300 dark:border-slate-500 hover:border-ocean hover:text-ocean text-slate-500 dark:text-slate-400 px-3 py-1.5 rounded-lg transition-colors">
                  🏷️ Logo Yükle
                </button>
              )}

              {/* Referans postlar butonu */}
              <button
                onClick={() => setShowRefPanel(v => !v)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                  showRefPanel
                    ? 'bg-ocean/10 border-ocean text-ocean'
                    : refImages.length > 0
                      ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40'
                      : 'bg-white dark:bg-slate-600 border-dashed border-slate-300 dark:border-slate-500 text-slate-500 dark:text-slate-400 hover:border-ocean hover:text-ocean'
                }`}
              >
                🖼️ Referans {refImages.length > 0 ? `(${refImages.length}/4)` : 'Ekle'}
              </button>

              {/* Görsel üret */}
              {!imageLoading && (
                <button onClick={generateImage}
                  className="flex items-center gap-1.5 text-xs bg-ocean hover:bg-ocean-dark text-white px-3 py-1.5 rounded-lg transition-colors font-medium">
                  {imageData ? '🔄 Yeniden Üret' : '✨ Görsel Oluştur'}
                </button>
              )}
            </div>
          </div>

          {/* Info satırı */}
          <p className="text-xs">
            {logoBase64
              ? <span className="text-green-600 dark:text-green-400">✅ Logo yüklendi.</span>
              : <span className="text-slate-400 dark:text-slate-500">💡 <strong>Logo Yükle</strong> → markanız her görsele eklenir.</span>}
            {refImages.length > 0 && (
              <span className="text-purple-600 dark:text-purple-400 ml-2">✅ {refImages.length} referans post yüklendi — stil tutarlılığı için kullanılıyor.</span>
            )}
          </p>

          {/* Referans paneli */}
          {showRefPanel && (
            <div className="bg-white dark:bg-slate-600 border border-purple-200 dark:border-purple-700 rounded-xl p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">📌 Referans Postlar</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-400 mt-0.5">Daha önce paylaştığın postları yükle — AI aynı tarzda görsel üretir (maks. 4)</p>
                </div>
                <input ref={refInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleRefUpload} />
                {refImages.length < 4 && (
                  <button
                    onClick={() => refInputRef.current?.click()}
                    className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium flex items-center gap-1.5"
                  >
                    + Görsel Ekle
                  </button>
                )}
              </div>

              {refImages.length === 0 ? (
                <button
                  onClick={() => refInputRef.current?.click()}
                  className="border-2 border-dashed border-purple-200 dark:border-purple-700 hover:border-purple-400 dark:hover:border-purple-500 rounded-xl p-6 flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500 hover:text-purple-600 transition-colors"
                >
                  <span className="text-3xl">📂</span>
                  <p className="text-xs text-center">Tıkla veya sürükle-bırak<br /><span className="text-[10px]">PNG, JPG, WEBP — maks. 4 görsel</span></p>
                </button>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {refImages.map((b64, idx) => (
                    <div key={idx} className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 aspect-square">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`data:image/jpeg;base64,${b64}`} alt={`Ref ${idx + 1}`} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button
                          onClick={() => removeRef(idx)}
                          className="bg-red-500 hover:bg-red-600 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-[9px] text-white text-center py-0.5">
                        Ref {idx + 1}
                      </div>
                    </div>
                  ))}
                  {refImages.length < 4 && (
                    <button
                      onClick={() => refInputRef.current?.click()}
                      className="border-2 border-dashed border-purple-200 dark:border-purple-700 hover:border-purple-400 dark:hover:border-purple-500 rounded-lg aspect-square flex items-center justify-center text-purple-400 hover:text-purple-600 transition-colors text-2xl"
                    >
                      +
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-4">
          {imageLoading && (
            <div className="flex flex-col items-center justify-center h-52 gap-3">
              <div className="w-10 h-10 border-4 border-ocean border-t-transparent rounded-full animate-spin" />
              <p className="text-slate-500 text-sm animate-pulse">Görsel üretiliyor...</p>
              <p className="text-slate-400 text-xs">Gemini arka planı oluşturuyor, brand katmanları ekleniyor</p>
            </div>
          )}
          {imageError && !imageLoading && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3 text-red-700 dark:text-red-300 text-sm flex gap-2">
              <span>❌</span><span>{imageError}</span>
            </div>
          )}
          {imageData && !imageLoading && (
            <div className="flex flex-col gap-3">
              <div className="relative rounded-xl overflow-hidden bg-slate-950 flex justify-center shadow-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:${imageMime};base64,${imageData}`} alt="Post görseli" className="max-h-[460px] object-contain" />
              </div>
              <div className="flex gap-2">
                <button onClick={downloadImage} className="flex-1 flex items-center justify-center gap-2 bg-navy hover:bg-navy-light text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
                  ⬇️ Görseli İndir
                </button>
                <button
                  onClick={async () => {
                    // HTTPS bağlamında Clipboard API dene; HTTP'de (üretim sunucu)
                    // otomatik olarak indirme yoluna geç
                    const isSecure = typeof window !== 'undefined' &&
                      (window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost');

                    if (isSecure && navigator.clipboard?.write) {
                      try {
                        const img = new Image();
                        img.src = `data:${imageMime};base64,${imageData}`;
                        await new Promise(r => { img.onload = r; });
                        const cv = document.createElement('canvas');
                        cv.width = img.width; cv.height = img.height;
                        cv.getContext('2d')!.drawImage(img, 0, 0);
                        await new Promise<void>((res, rej) => {
                          cv.toBlob(async (blob) => {
                            if (!blob) { rej(new Error('blob null')); return; }
                            try {
                              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                              res();
                            } catch (e) { rej(e); }
                          }, 'image/png');
                        });
                        setImgCopied(true);
                        setTimeout(() => setImgCopied(false), 2500);
                        return;
                      } catch { /* güvenli bağlam ama izin yok → indir */ }
                    }

                    // HTTP veya izin yoksa: otomatik indir
                    const link = document.createElement('a');
                    link.href     = `data:image/png;base64,${imageData}`;
                    link.download = `crewinjob_${platform}_${Date.now()}.png`;
                    link.click();
                    setImgCopied(true);
                    setTimeout(() => setImgCopied(false), 2500);
                  }}
                  className="flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
                >
                  {imgCopied ? '✅ Tamam!' : '📋 Kopyala'}
                </button>
              </div>
            </div>
          )}
          {!imageData && !imageLoading && !imageError && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-400 dark:text-slate-500">
              <span className="text-3xl opacity-30">🖼️</span>
              <p className="text-xs text-center">İçerik üretildikten sonra<br /><strong className="text-slate-500 dark:text-slate-400">Görsel Oluştur</strong> butonuna tıklayın.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
