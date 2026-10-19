'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { getImageModel } from './ModelPicker';
import SharePanel from './SharePanel';
import PostHistory from './PostHistory';
import SchedulePanel from './SchedulePanel';
import { attachImageToLatest, attachImageToItem, createHistoryItem, updateHistoryContent } from '@/lib/content-history';
import { compositePostImage } from '@/lib/image-composite';
import { logActivity } from '@/lib/activity-log';
import { useLang } from '@/lib/lang';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';
import { loadPartnerLogo, savePartnerLogo, savePartnerUntil, clearPartnerLogo, daysLeft } from '@/lib/partner-logo';
import { ART_DIRECTIONS } from '@/lib/art-directions';

interface Props {
  content: string;
  loading: boolean;
  error?: string;
  platform?: string;
  contentType?: string;
  language?: string; // İçerik dili — görsel başlığı için
  /** Dolu olduğunda içerik değişince otomatik İçerik Kütüphanesi'ne kaydeder */
  autoSaveHistory?: { prompt: string; language?: string };
  /**
   * Geçmişten geri yüklenen kaydın görseli ve yeniden basım verisi. Verilirse
   * panel bu görseli gösterir; verilmezse içerik değişince görsel temizlenir
   * (yeni metnin yanında eski görselin kalması yanıltıcıydı).
   *
   * `rawBg` doluysa başlık/öneri/detay düzenlemeleri API çağrısı yapılmadan
   * yeniden basılabilir. Eski kayıtlarda ham arka plan yok — o durumda görsel
   * yalnızca görüntülenir.
   */
  restoredImage?: {
    data: string; mime: string;
    rawBg?: string; rawBgMime?: string;
    headline?: string; suggestions?: string[]; subline?: string;
  } | null;
  /**
   * Görsel üretilince hangi geçmiş kaydına iliştirileceği. Boşsa en yeni
   * kayda iliştirilir — normal akışta o zaten yeni üretilen içeriktir.
   * Geçmişten kayıt geri yüklendiğinde bu id verilmeli, aksi halde görsel
   * yanlış kayda yazılır.
   */
  historyId?: string;
  /** Görsel üretilince çağrılır — üst bileşen görseli kullanabilir (ör. blog yayınlama) */
  onImageReady?: (imageData: string, imageMime: string) => void;
}

const LOGO_KEY = 'crewinjob_brand_logo';
const REFS_KEY = 'crewinjob_ref_posts';   // referans post görselleri (max 4)

export default function OutputPanel({
  content,
  loading,
  error,
  platform = 'instagram',
  contentType = 'ilan_ozeti',
  language = 'en',
  autoSaveHistory,
  onImageReady,
  restoredImage,
  historyId,
}: Props) {
  const [copied,       setCopied]       = useState(false);
  const [imgCopied,    setImgCopied]    = useState(false);
  const [imageData,    setImageData]    = useState('');
  const [imageMime,    setImageMime]    = useState('image/jpeg');
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError,   setImageError]   = useState('');
  const [imagePrompt,  setImagePrompt]  = useState(''); // Kullanıcının görsel tarifi/talimatı
  // Görselin üstüne canvas ile çizilen detay satırı (yer / tarih / stant no).
  // Görsel modeline yazı çizdirilemediği için bu bilgiler buradan geçiyor.
  const [subline,      setSubline]      = useState('');
  // Ham arka plan + başlık — yeniden composite için saklanır
  const [rawBgData,     setRawBgData]     = useState('');
  const [rawBgMime,     setRawBgMime]     = useState('image/jpeg');
  const [headline,      setHeadline]      = useState('');
  const [suggestions,      setSuggestions]      = useState<string[]>([]);
  const [sceneSuggestions, setSceneSuggestions] = useState<string[]>([]);
  const [activeScene,      setActiveScene]      = useState('');
  const [artDirection,     setArtDirection]     = useState('');
  const [recompositing, setRecompositing] = useState(false);
  // Gösterilen görsele en son basılan başlık/detay — paylaşımda her platform için aynısı yeniden basılır
  const [composedWith,  setComposedWith]  = useState<{ headline: string; subline: string } | null>(null);
  // autoSaveHistory ile oluşturulan kaydın id'si (düzenlemeler/görseller bu kayda yazılır)
  const [autoHistoryId, setAutoHistoryId] = useState<string | undefined>(undefined);
  const [logoBase64,        setLogoBase64]        = useState('');
  const [partnerLogoBase64, setPartnerLogoBase64] = useState('');
  const [partnerUntil,      setPartnerUntil]      = useState('');
  const [refImages,    setRefImages]    = useState<string[]>([]);   // base64 listesi
  const [showRefPanel, setShowRefPanel] = useState(false);
  const [showShare,    setShowShare]    = useState(false);
  const [showHistory,  setShowHistory]  = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  // ── İçerik düzenleme ───────────────────────────────────────────────────────
  // `content` üst bileşenden gelir ve salt okunurdur. Kullanıcının AI talimatıyla
  // veya elle yaptığı değişiklikler burada tutulur; boşsa orijinal içerik geçerlidir.
  const [edited,       setEdited]       = useState('');
  const [undoStack,    setUndoStack]    = useState<string[]>([]);
  const [refineInput,  setRefineInput]  = useState('');
  const [refining,     setRefining]     = useState(false);
  const [refineError,  setRefineError]  = useState('');
  const [manualEdit,   setManualEdit]   = useState(false);
  // ── İçerik kalite değerlendirmesi ──────────────────────────────────────────
  const [reviewing,    setReviewing]    = useState(false);
  const [reviewResult, setReviewResult] = useState<{
    score: number; grade: string; summary: string;
    strengths: string[]; weaknesses: string[];
    hashtag_score: number; hook_score: number; cta_score: number;
    improved: string;
  } | null>(null);
  const logoInputRef        = useRef<HTMLInputElement>(null);
  const partnerLogoInputRef = useRef<HTMLInputElement>(null);
  const refInputRef     = useRef<HTMLInputElement>(null);
  const lastSavedRef    = useRef<string>('');   // autoSaveHistory: son kaydedilen içeriği takip et
  const persistedTextRef = useRef<string>('');  // İçerik Kütüphanesi'ne en son yazılan metin

  const { lang } = useLang();

  /** Aşağıdaki her yerde kullanılan güncel metin — düzenlenmişse o, değilse orijinal. */
  const text = edited || content;

  /** Düzenleme/görsel yazılacak İçerik Kütüphanesi kaydı: geri yüklenen/üst bileşenin verdiği ya da otomatik kaydedilen. */
  const targetHistoryId = historyId || autoHistoryId;

  // Yeni içerik üretilince düzenleme katmanını sıfırla — aksi halde eski
  // düzenleme yeni içeriğin üstünü örterdi.
  useEffect(() => {
    setEdited('');
    setUndoStack([]);
    setRefineInput('');
    setRefineError('');
    setManualEdit(false);
    persistedTextRef.current = content;   // yeni içerik zaten oluşturan tarafından kaydedildi
  }, [content]);

  // Elle/AI düzenlemeleri kütüphanedeki kayda yaz (debounce) — önceden yalnızca ekranda kalıyordu
  useEffect(() => {
    if (!targetHistoryId || !content || text === persistedTextRef.current) return;
    const timer = setTimeout(() => {
      persistedTextRef.current = text;
      void updateHistoryContent(targetHistoryId, text);
    }, 1200);
    return () => clearTimeout(timer);
  }, [text, content, targetHistoryId]);

  // İçerik değişince görseli senkronla:
  //  - Geçmişten geri yükleme ise o kaydın görselini göster
  //  - Yeni üretim ise görseli temizle (eski görsel yeni metinle kalıyordu)
  // Ham arka plan her iki durumda da geçersizdir; başlık düzenleme yeniden
  // üretim gerektirir.
  useEffect(() => {
    setImageError('');
    setSceneSuggestions([]);
    if (restoredImage?.data) {
      setImageData(restoredImage.data);
      setImageMime(restoredImage.mime || 'image/png');
      // Ham arka plan varsa düzenleme araçları da geri gelir
      setRawBgData(restoredImage.rawBg || '');
      setRawBgMime(restoredImage.rawBgMime || 'image/jpeg');
      setHeadline(restoredImage.headline || '');
      setSuggestions(restoredImage.suggestions || []);
      setSubline(restoredImage.subline || '');
      setComposedWith(restoredImage.headline ? { headline: restoredImage.headline, subline: restoredImage.subline || '' } : null);
    } else {
      setImageData('');
      setRawBgData('');
      setSuggestions([]);
      setComposedWith(null);
    }
  }, [content, restoredImage]);

  /** Değişikliği geri alınabilir şekilde uygular. */
  const applyEdit = useCallback((next: string) => {
    setUndoStack(s => [...s, text]);
    setEdited(next);
  }, [text]);

  const undoEdit = useCallback(() => {
    setUndoStack(s => {
      if (!s.length) return s;
      const prev = s[s.length - 1];
      setEdited(prev === content ? '' : prev);
      return s.slice(0, -1);
    });
  }, [content]);

  /** Kullanıcının serbest metin talimatını AI'ya gönderir. */
  const refine = useCallback(async (instruction: string) => {
    const cmd = instruction.trim();
    if (!cmd || refining) return;
    setRefining(true);
    setRefineError('');
    try {
      const res = await fetch('/api/content/refine', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: text, instruction: cmd, platform, language }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.content && data.content !== text) {
        applyEdit(data.content);
        setRefineInput('');
      } else {
        setRefineError(lang === 'tr' ? 'Değişiklik uygulanamadı — talimatı netleştirin' : 'No change applied — try a clearer instruction');
      }
    } catch (e) {
      setRefineError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefining(false);
    }
  }, [text, platform, language, refining, applyEdit, lang]);

  // autoSaveHistory: content değişince İçerik Kütüphanesi'ne otomatik kaydet
  useEffect(() => {
    if (!autoSaveHistory || !content || content === lastSavedRef.current) return;
    lastSavedRef.current = content;
    setAutoHistoryId(undefined);
    void createHistoryItem({
      platform,
      language: autoSaveHistory.language || 'en',
      content,
      prompt: autoSaveHistory.prompt,
    }).then(item => {
      // Arada içerik değiştiyse eski kaydın id'si yeni içeriğe bağlanmasın
      if (item?.id && lastSavedRef.current === content) setAutoHistoryId(item.id);
    });
  }, [content, platform, autoSaveHistory]);

  useEffect(() => {
    try {
      const savedLogo = localStorage.getItem(LOGO_KEY);
      if (savedLogo) setLogoBase64(savedLogo);
      // Süresi geçmiş etkinlik logosu burada otomatik temizlenir
      const partner = loadPartnerLogo();
      setPartnerLogoBase64(partner.data);
      setPartnerUntil(partner.until);
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

  const handlePartnerLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = (ev.target?.result as string).split(',')[1];
      setPartnerLogoBase64(b64);
      savePartnerLogo(b64);
    };
    reader.readAsDataURL(file);
  };

  const changePartnerUntil = (value: string) => {
    setPartnerUntil(value);
    savePartnerUntil(value);
  };

  const removePartnerLogo = () => {
    setPartnerLogoBase64('');
    setPartnerUntil('');
    clearPartnerLogo();
    if (partnerLogoInputRef.current) partnerLogoInputRef.current.value = '';
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
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // scene/direction override: alternatif konsept veya sanat yönü seçilince kullanılır.
  // Boş bırakılırsa sunucu içerikten konsept türetir ve sanat yönünü rastgele seçer —
  // böylece "Yeniden Üret" her seferinde farklı bir görsel getirir.
  const generateImage = useCallback(async (override?: { scene?: string; direction?: string }) => {
    setImageLoading(true);
    setImageError('');
    setImageData('');
    try {
      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          contentType,
          textContent: text,
          imageModel: getImageModel(),
          refImages,
          language,
          // Alternatif konsept seçildiyse o sahne doğrudan kullanılır.
          // Aksi halde kutudaki metin, mevcut sahneye uygulanacak TALİMAT sayılır —
          // "şunu ekle/değiştir" yazınca sahnenin yerine geçmesi yanlış sonuç veriyordu.
          userScene:        override?.scene ?? undefined,
          sceneInstruction: override?.scene ? undefined : (imagePrompt.trim() || undefined),
          baseScene:        override?.scene ? undefined : (activeScene || undefined),
          artDirection:     override?.direction ?? undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const mime        = data.mimeType  || 'image/jpeg';
      const rawB64      = data.imageData as string;
      const apiHeadline   = (data.headline    as string)   || 'The Right Job\nThe Right Talent';
      const apiSuggestions = (data.suggestions as string[]) || [];

      // Ham arka planı sakla — başlık düzenleme için yeniden composite yapılabilir
      setRawBgData(rawB64);
      setRawBgMime(mime);
      setHeadline(apiHeadline);
      setSuggestions(apiSuggestions);
      setArtDirection((data.artDirection as string) || '');
      // Kullanıcı bir alternatif konsept seçtiyse listeyi koru — yoksa yenisini al
      if (!override?.scene) {
        setActiveScene((data.scene as string) || '');
        setSceneSuggestions((data.sceneSuggestions as string[]) || []);
      } else {
        setActiveScene(override.scene);
      }

      // Canvas ile profesyonel brand overlay — platform boyutuna ölçekler, PNG döndürür
      const finalB64 = await compositePostImage(mime, rawB64, logoBase64, apiHeadline, platform, partnerLogoBase64, subline);

      setImageData(finalB64);
      setImageMime('image/png');
      setComposedWith({ headline: apiHeadline, subline });
      // Geçmişten kayıt geri yüklendiyse görsel O kayda gitmeli; aksi halde
      // en yeni kayda (normal akışta yeni üretilen içerik) iliştirilir.
      //
      // Ham arka plan ve başlık verisi de saklanıyor: kayıt geri yüklendiğinde
      // başlık/detay düzenlemesi API çağrısı olmadan yeniden basılabilsin.
      const payload = {
        imageData: finalB64, imageMime: 'image/png',
        rawBgData: rawB64,   rawBgMime: mime,
        headline:  apiHeadline, suggestions: apiSuggestions, subline,
      };
      void (targetHistoryId
        ? attachImageToItem(targetHistoryId, payload)
        : attachImageToLatest(payload));
      logActivity('image_generated', lang === 'tr' ? `${platform} için görsel üretildi` : `Image generated for ${platform}`, `${contentType} · PNG`);
      // Üst bileşene bildir (ör. blog yayınlama butonu)
      onImageReady?.(finalB64, 'image/png');
    } catch (e: unknown) {
      setImageError(e instanceof Error ? e.message : (lang === 'tr' ? 'Görsel oluşturulamadı' : "Couldn't create the image"));
    } finally {
      setImageLoading(false);
    }
  }, [platform, contentType, text, logoBase64, partnerLogoBase64, refImages, language, imagePrompt, activeScene, subline, targetHistoryId, onImageReady, lang]);

  // Başlık değişince arka planı yeniden composite et (ağ isteği yok)
  const recomposite = useCallback(async () => {
    if (!rawBgData) return;
    setRecompositing(true);
    try {
      const finalB64 = await compositePostImage(rawBgMime, rawBgData, logoBase64, headline, platform, partnerLogoBase64, subline);
      setImageData(finalB64);
      setImageMime('image/png');
      setComposedWith({ headline, subline });
      // Yeni görsel + başlık kütüphanedeki kayda da yazılır (önceden yalnızca ekranda kalıyordu;
      // görsel değişince route eski asset'i düşürüp yeniden yükler)
      const payload = {
        imageData: finalB64, imageMime: 'image/png',
        rawBgData, rawBgMime,
        headline, suggestions, subline,
      };
      void (targetHistoryId
        ? attachImageToItem(targetHistoryId, payload)
        : attachImageToLatest(payload));
      onImageReady?.(finalB64, 'image/png');
    } finally {
      setRecompositing(false);
    }
  }, [rawBgData, rawBgMime, logoBase64, partnerLogoBase64, headline, suggestions, platform, subline, targetHistoryId, onImageReady]);

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
        body:    JSON.stringify({ content: text, platform, language }),
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
      <p className="text-slate-500 text-sm animate-pulse">{lang === 'tr' ? 'Gemini AI içerik üretiyor…' : 'Gemini AI is generating content…'}</p>
    </div>
  );

  if (error) return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4 text-red-700 dark:text-red-300 text-sm flex gap-2">
      <span>❌</span><span><Msg text={error} /></span>
    </div>
  );

  if (!content) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400 dark:text-slate-500">
      <svg className="w-14 h-14 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      <p className="text-sm text-center">
        {lang === 'tr'
          ? <>{`Formu doldurun ve`}<br /><strong className="text-slate-500 dark:text-slate-400">İçerik Üret</strong>{` butonuna tıklayın.`}</>
          : <>{`Fill in the form and click the`}<br /><strong className="text-slate-500 dark:text-slate-400">Generate content</strong>{` button.`}</>}
      </p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {showShare && (
        <SharePanel
          content={text}
          imageData={imageData || undefined}
          imageMime={imageMime}
          // Ham arka plan + görsele basılmış başlık → her platform kendi boyutunda yeniden basılır
          rawBgData={rawBgData && composedWith ? rawBgData : undefined}
          rawBgMime={rawBgMime}
          headline={rawBgData && composedWith ? composedWith.headline : undefined}
          subline={composedWith?.subline}
          onClose={() => setShowShare(false)}
        />
      )}
      {showHistory && <PostHistory onClose={() => setShowHistory(false)} />}
      {showSchedule && (
        <SchedulePanel
          prefillContent={text}
          prefillImageData={imageData || undefined}
          prefillImageMime={imageData ? imageMime : undefined}
          onClose={() => setShowSchedule(false)}
        />
      )}

      {/* ── Metin çıktısı ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{text.length.toLocaleString(localeTag(lang))} {lang === 'tr' ? 'karakter' : 'characters'}</span>
            {edited && (
              <span className="text-[10px] font-semibold bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 px-2 py-0.5 rounded-full">
                ✏️ {lang === 'tr' ? 'düzenlendi' : 'edited'}
              </span>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={copy} className="flex items-center gap-1.5 text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg transition-colors font-medium">
              {copied ? (lang === 'tr' ? '✅ Kopyalandı!' : '✅ Copied!') : (lang === 'tr' ? '📋 Kopyala' : '📋 Copy')}
            </button>
            <button
              onClick={reviewContent}
              disabled={reviewing}
              className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
              title={lang === 'tr' ? 'AI ile içerik kalitesini değerlendir ve iyileştir' : 'Review and improve content quality with AI'}
            >
              {reviewing
                ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Değerlendiriliyor…' : 'Reviewing…'}</>
                : (lang === 'tr' ? '⭐ Değerlendir' : '⭐ Review')}
            </button>
            <button
              onClick={() => setShowSchedule(true)}
              className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
              title={lang === 'tr' ? 'İleride otomatik yayınlamak için zamanla' : 'Schedule for automatic publishing later'}
            >
              {lang === 'tr' ? '📅 Zamanla' : '📅 Schedule'}
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="flex items-center gap-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
              title={lang === 'tr' ? 'Paylaşım geçmişi ve metrikler' : 'Post history and metrics'}
            >
              {lang === 'tr' ? '📊 Geçmiş' : '📊 History'}
            </button>
            <button
              onClick={() => setShowShare(true)}
              className="flex items-center gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
            >
              {lang === 'tr' ? '📤 Paylaş' : '📤 Share'}
            </button>
          </div>
        </div>
        {manualEdit ? (
          <textarea
            value={text}
            onChange={e => setEdited(e.target.value)}
            onBlur={() => { if (text !== (undoStack[undoStack.length - 1] ?? content)) setUndoStack(s => [...s, content]); }}
            spellCheck={false}
            className="bg-slate-900 text-slate-100 rounded-xl p-5 text-sm h-64 w-full whitespace-pre-wrap font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-sky-500/60 border border-sky-500/40"
          />
        ) : (
          <pre className="bg-slate-900 text-slate-100 rounded-xl p-5 text-sm overflow-auto max-h-64 whitespace-pre-wrap font-mono leading-relaxed">
            {text}
          </pre>
        )}

        {/* ── AI ile içeriğe müdahale ── */}
        <div className="border border-sky-200 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-900/15 rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-sky-800 dark:text-sky-300 flex items-center gap-1.5">
              ✨ {lang === 'tr' ? 'İçeriği Düzenle' : 'Edit content'}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setManualEdit(v => !v)}
                className={`text-[10px] px-2 py-1 rounded-lg font-medium transition-colors border ${
                  manualEdit
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-sky-400'
                }`}
                title={lang === 'tr' ? 'Metni doğrudan elle düzenle' : 'Edit the text by hand'}
              >
                {manualEdit ? (lang === 'tr' ? '✓ Elle Düzenleme Açık' : '✓ Manual editing on') : (lang === 'tr' ? '⌨️ Elle Düzenle' : '⌨️ Edit by hand')}
              </button>
              {undoStack.length > 0 && (
                <button
                  onClick={undoEdit}
                  className="text-[10px] px-2 py-1 rounded-lg font-medium bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-amber-400 transition-colors"
                  title={lang === 'tr' ? 'Son değişikliği geri al' : 'Undo last change'}
                >
                  ↩️ {lang === 'tr' ? 'Geri Al' : 'Undo'} ({undoStack.length})
                </button>
              )}
              {edited && (
                <button
                  onClick={() => { setEdited(''); setUndoStack([]); }}
                  className="text-[10px] px-2 py-1 rounded-lg font-medium bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-red-400 hover:text-red-500 transition-colors"
                  title={lang === 'tr' ? 'Orijinal üretilen içeriğe dön' : 'Revert to the originally generated content'}
                >
                  ⟲ {lang === 'tr' ? 'Orijinale Dön' : 'Reset'}
                </button>
              )}
            </div>
          </div>

          {/* Serbest talimat */}
          <div className="flex gap-2">
            <input
              value={refineInput}
              onChange={e => setRefineInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void refine(refineInput); } }}
              disabled={refining}
              placeholder={lang === 'tr'
                ? 'Ne değişsin? Ör: "hashtag sayısını 5\'e düşür", "stand numarasını ekle"'
                : 'What should change? e.g. "cut hashtags down to 5", "mention our booth number"'}
              className="flex-1 min-w-0 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/50 bg-white dark:bg-slate-700 dark:text-slate-100 disabled:opacity-60"
            />
            <button
              onClick={() => void refine(refineInput)}
              disabled={refining || !refineInput.trim()}
              className="shrink-0 flex items-center gap-1.5 text-xs bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg font-medium transition-colors"
            >
              {refining
                ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Uygulanıyor' : 'Applying'}</>
                : (lang === 'tr' ? 'Uygula' : 'Apply')}
            </button>
          </div>

          {/* Sık kullanılan talimatlar */}
          <div className="flex gap-1.5 flex-wrap">
            {(lang === 'tr'
              ? [
                  ['✂️ Kısalt',        'Metni belirgin şekilde kısalt, ana mesajı ve CTA\'yı koru'],
                  ['➕ Uzat',          'Metni biraz genişlet, somut bir fayda cümlesi ekle'],
                  ['#️⃣ Hashtag Azalt', 'Hashtag sayısını en alakalı 5 tanesine düşür'],
                  ['😀 Emoji Azalt',   'Emoji kullanımını azalt, en fazla 2-3 emoji kalsın'],
                  ['📣 CTA Güçlendir', 'Sonundaki çağrıyı daha net ve eyleme yönlendiren hale getir'],
                  ['🎯 Daha Resmi',    'Tonu daha kurumsal ve resmi hale getir'],
                ]
              : [
                  ['✂️ Shorten',      'Make the post noticeably shorter while keeping the core message and CTA'],
                  ['➕ Expand',       'Expand slightly, adding one concrete benefit sentence'],
                  ['#️⃣ Fewer hashtags',  'Reduce hashtags to the 5 most relevant ones'],
                  ['😀 Fewer emoji',  'Reduce emoji usage to at most 2-3'],
                  ['📣 Stronger CTA', 'Make the closing call-to-action clearer and more actionable'],
                  ['🎯 More formal',  'Make the tone more corporate and formal'],
                ]
            ).map(([label, cmd]) => (
              <button
                key={label}
                onClick={() => void refine(cmd)}
                disabled={refining}
                className="text-[10px] px-2 py-1 rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-sky-400 hover:text-sky-600 dark:hover:text-sky-300 disabled:opacity-50 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>

          {refineError && (
            <p className="text-[11px] text-red-500 dark:text-red-400">⚠️ <Msg text={refineError} /></p>
          )}
        </div>

        {/* ── İçerik kalite değerlendirme paneli ── */}
        {reviewResult && (
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex flex-col gap-3">
            {/* Başlık + skor */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">⭐</span>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{lang === 'tr' ? 'İçerik Değerlendirmesi' : 'Content review'}</span>
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
                <p className="text-[10px] font-semibold text-green-600 dark:text-green-400 mb-1">✅ {lang === 'tr' ? 'Güçlü Yanlar' : 'Strengths'}</p>
                <ul className="flex flex-col gap-0.5">
                  {reviewResult.strengths.map((s, i) => (
                    <li key={i} className="text-[11px] text-slate-600 dark:text-slate-300">• {s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-semibold text-red-500 dark:text-red-400 mb-1">⚠️ {lang === 'tr' ? 'Geliştirilebilir' : 'Improvements'}</p>
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
                <p className="text-[10px] font-semibold text-ocean mb-1">✨ {lang === 'tr' ? 'AI ile İyileştirilmiş Versiyon' : 'AI-improved version'}</p>
                <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs overflow-auto max-h-40 whitespace-pre-wrap font-mono leading-relaxed">
                  {reviewResult.improved}
                </pre>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => { applyEdit(reviewResult.improved); setReviewResult(null); }}
                    className="flex-1 text-xs bg-ocean hover:bg-ocean-dark text-white px-3 py-2 rounded-lg font-medium transition-colors"
                  >
                    {lang === 'tr' ? '✅ Bu Versiyonu Kullan' : '✅ Use this version'}
                  </button>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(reviewResult.improved);
                      setReviewResult(null);
                    }}
                    className="text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 px-3 py-2 rounded-lg font-medium transition-colors"
                  >
                    {lang === 'tr' ? '📋 Kopyala' : '📋 Copy'}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={() => setReviewResult(null)}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-center"
            >
              {lang === 'tr' ? 'Kapat ✕' : 'Close ✕'}
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
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{lang === 'tr' ? '🎨 Post Görseli' : '🎨 Post image'}</span>
              <span className="text-xs text-slate-400 dark:text-slate-500 bg-white dark:bg-slate-600 border border-slate-200 dark:border-slate-500 px-2 py-0.5 rounded-full">
                {platform} · {contentType.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Logo */}
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              {logoBase64 ? (
                <div onClick={() => logoInputRef.current?.click()}
                  className="flex items-center gap-1.5 bg-white dark:bg-slate-600 border border-green-200 dark:border-green-700 rounded-lg px-2 py-1 cursor-pointer hover:border-ocean" title={lang === 'tr' ? 'Logo değiştir' : 'Change logo'}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/png;base64,${logoBase64}`} alt="Logo" className="h-6 w-auto max-w-[90px] object-contain" />
                  <span className="text-xs text-green-600">✓</span>
                  <button onClick={e => { e.stopPropagation(); removeLogo(); }} aria-label={lang === 'tr' ? 'Logoyu kaldır' : 'Remove logo'} title={lang === 'tr' ? 'Logoyu kaldır' : 'Remove logo'} className="text-slate-300 hover:text-red-500 text-xs">✕</button>
                </div>
              ) : (
                <button onClick={() => logoInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-xs bg-white dark:bg-slate-600 border border-dashed border-slate-300 dark:border-slate-500 hover:border-ocean hover:text-ocean text-slate-500 dark:text-slate-400 px-3 py-1.5 rounded-lg transition-colors">
                  {lang === 'tr' ? '🏷️ Logo Yükle' : '🏷️ Upload logo'}
                </button>
              )}

              {/* Etkinlik / işbirliği logosu — crewinjob logosunun soluna eklenir */}
              <input ref={partnerLogoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePartnerLogoUpload} />
              {partnerLogoBase64 ? (
                <div onClick={() => partnerLogoInputRef.current?.click()}
                  className="flex items-center gap-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-600 rounded-lg px-2 py-1 cursor-pointer hover:border-amber-500"
                  title={lang === 'tr' ? 'Etkinlik logosunu değiştir' : 'Change event logo'}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/png;base64,${partnerLogoBase64}`} alt={lang === 'tr' ? 'Etkinlik logosu' : 'Event logo'} className="h-6 w-auto max-w-[90px] object-contain" />
                  <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                    {lang === 'tr' ? 'Etkinlik' : 'Event'}
                  </span>
                  <button onClick={e => { e.stopPropagation(); removePartnerLogo(); }} aria-label={lang === 'tr' ? 'Etkinlik logosunu kaldır' : 'Remove event logo'} title={lang === 'tr' ? 'Etkinlik logosunu kaldır' : 'Remove event logo'} className="text-slate-300 hover:text-red-500 text-xs">✕</button>
                </div>
              ) : (
                <button onClick={() => partnerLogoInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-xs bg-white dark:bg-slate-600 border border-dashed border-slate-300 dark:border-slate-500 hover:border-amber-500 hover:text-amber-600 text-slate-500 dark:text-slate-400 px-3 py-1.5 rounded-lg transition-colors"
                  title={lang === 'tr' ? 'Fuar, etkinlik veya işbirliği logosu' : 'Fair, event or partnership logo'}>
                  {lang === 'tr' ? '🤝 Etkinlik Logosu' : '🤝 Event logo'}
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
                🖼️ {lang === 'tr' ? 'Referans' : 'Reference'} {refImages.length > 0 ? `(${refImages.length}/4)` : (lang === 'tr' ? 'Ekle' : 'Add')}
              </button>

              {/* Görsel üret */}
              {!imageLoading && (
                <button onClick={() => generateImage()}
                  className="flex items-center gap-1.5 text-xs bg-ocean hover:bg-ocean-dark text-white px-3 py-1.5 rounded-lg transition-colors font-medium">
                  {imageData ? (lang === 'tr' ? '🔄 Yeniden Üret' : '🔄 Regenerate') : (lang === 'tr' ? '✨ Görsel Oluştur' : '✨ Generate image')}
                </button>
              )}
            </div>
          </div>

          {/* Info satırı */}
          <p className="text-xs">
            {logoBase64
              ? <span className="text-green-600 dark:text-green-400">✅ {lang === 'tr' ? 'Logo yüklendi.' : 'Logo uploaded.'}</span>
              : <span className="text-slate-400 dark:text-slate-500">💡 <strong>{lang === 'tr' ? 'Logo Yükle' : 'Upload logo'}</strong> {lang === 'tr' ? '→ markanız her görsele eklenir.' : '→ your brand is added to every image.'}</span>}
            {refImages.length > 0 && (
              <span className="text-purple-600 dark:text-purple-400 ml-2">✅ {refImages.length} {lang === 'tr' ? 'referans post yüklendi — stil tutarlılığı için kullanılıyor.' : 'reference posts uploaded — used for style consistency.'}</span>
            )}
          </p>
          {/* Etkinlik logosu tüm görsellere işlenir — bitiş tarihiyle otomatik kapanır */}
          {partnerLogoBase64 && (
            <div className="flex items-center gap-2 flex-wrap text-xs text-amber-700 dark:text-amber-400">
              <span>🤝 {lang === 'tr' ? 'Etkinlik logosu aktif.' : 'Event logo active.'}</span>
              <label className="flex items-center gap-1.5">
                <span className="text-slate-500 dark:text-slate-400">{lang === 'tr' ? 'Bitiş:' : 'Ends:'}</span>
                <input
                  type="date"
                  value={partnerUntil}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={e => changePartnerUntil(e.target.value)}
                  className="px-2 py-0.5 rounded border border-amber-300 dark:border-amber-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </label>
              {partnerUntil ? (
                <span className={(daysLeft(partnerUntil) ?? 0) <= 3 ? 'text-red-500 font-medium' : 'text-slate-500 dark:text-slate-400'}>
                  {(() => {
                    const d = daysLeft(partnerUntil) ?? 0;
                    if (lang === 'tr') return d <= 0 ? 'bugün sona eriyor' : `${d} gün kaldı — sonra otomatik kalkar`;
                    return d <= 0 ? 'expires today' : `${d} days left — auto-removed after`;
                  })()}
                </span>
              ) : (
                <span className="text-slate-400 dark:text-slate-500">
                  {lang === 'tr' ? 'tarih girmezseniz siz kaldırana kadar kalır' : 'without a date it stays until you remove it'}
                </span>
              )}
            </div>
          )}

          {/* Sahne talimatı — mevcut sahneyi AI ile düzenler */}
          <div className="flex gap-1.5 items-start">
            <textarea
              value={imagePrompt}
              onChange={e => setImagePrompt(e.target.value)}
              rows={2}
              placeholder={lang === 'tr'
                ? 'Sahneyi düzenle… — ör: "gemiyi çıkar, fuar standı olsun", "gün batımı yerine sabah ışığı"'
                : 'Edit the scene… — e.g. "drop the ship, make it a trade-show booth", "morning light instead of sunset"'}
              className="flex-1 text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50 resize-none placeholder-slate-400 dark:placeholder-slate-500 leading-relaxed"
            />
            <div className="flex flex-col gap-1 shrink-0">
              <button
                onClick={() => generateImage()}
                disabled={imageLoading || !imagePrompt.trim()}
                title={lang === 'tr' ? 'Talimatı sahneye uygula ve görseli yeniden üret' : 'Apply to the scene and regenerate'}
                className="text-[11px] bg-ocean hover:bg-ocean-dark disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg font-medium transition-colors whitespace-nowrap"
              >
                {imageLoading
                  ? '…'
                  : (lang === 'tr' ? '✨ Uygula' : '✨ Apply')}
              </button>
              {imagePrompt.trim() && (
                <button
                  onClick={() => setImagePrompt('')}
                  title={lang === 'tr' ? 'Talimatı temizle' : 'Clear instruction'}
                  className="text-[10px] text-slate-400 hover:text-red-500 transition-colors"
                >✕ {lang === 'tr' ? 'temizle' : 'clear'}</button>
              )}
            </div>
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-1">
            {lang === 'tr'
              ? 'Ne değişsin yaz — mevcut sahne korunur, sadece söylediğin uygulanır. Görsel yeniden üretilir.'
              : 'Say what to change — the current scene is kept, only your change is applied. The image is regenerated.'}
          </p>

          {/* Detay satırı — canvas ile çizilir, AI görseline yazı yazdırılamaz */}
          <div className="flex gap-1.5 items-start">
            <input
              value={subline}
              onChange={e => setSubline(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && subline.trim() && !recompositing && !imageLoading) {
                  e.preventDefault();
                  if (rawBgData) void recomposite(); else void generateImage();
                }
              }}
              placeholder={lang === 'tr'
                ? 'Görselde yazacak detay — ör: "3-5 Eylül · ITU Denizcilik Fakültesi · Stant B-42"'
                : 'Detail line on the image — e.g. "3-5 September · ITU Maritime Faculty · Booth B-42"'}
              className="flex-1 text-xs border border-sky-200 dark:border-sky-700 rounded-lg px-2.5 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/50 placeholder-slate-400 dark:placeholder-slate-500"
            />
            <button
              onClick={() => { if (rawBgData) void recomposite(); else void generateImage(); }}
              disabled={recompositing || imageLoading || !subline.trim()}
              title={rawBgData
                ? (lang === 'tr' ? 'Görsele işle (yeniden üretmeden, anında)' : 'Draw onto the image (instant, no regeneration)')
                : (lang === 'tr' ? 'Görseli üret ve detayı işle' : 'Generate the image with this detail')}
              className="shrink-0 text-[11px] bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-2 rounded-lg font-medium transition-colors whitespace-nowrap"
            >
              {recompositing ? '…' : (lang === 'tr' ? '✍️ İşle' : '✍️ Draw')}
            </button>
            {subline.trim() && (
              <button
                onClick={() => setSubline('')}
                title={lang === 'tr' ? 'Detayı temizle' : 'Clear detail'}
                className="text-slate-400 hover:text-red-500 text-xs mt-2 px-1 transition-colors"
              >✕</button>
            )}
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 -mt-1">
            {lang === 'tr'
              ? 'ℹ️ Tarih, yer, stant no başlığın altına net biçimde yazılır — AI görsele yazı çizemez. Görsel hazırsa anında işlenir.'
              : "ℹ️ Dates, venues and booth numbers are drawn crisply under the headline — the AI can't render text. Instant if an image already exists."}
          </p>

          {/* Referans paneli */}
          {showRefPanel && (
            <div className="bg-white dark:bg-slate-600 border border-purple-200 dark:border-purple-700 rounded-xl p-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">📌 {lang === 'tr' ? 'Referans Postlar' : 'Reference posts'}</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-400 mt-0.5">{lang === 'tr' ? 'Daha önce paylaştığın postları yükle — AI aynı tarzda görsel üretir (maks. 4)' : 'Upload your previously shared posts — AI generates images in the same style (max 4)'}</p>
                </div>
                <input ref={refInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleRefUpload} />
                {refImages.length < 4 && (
                  <button
                    onClick={() => refInputRef.current?.click()}
                    className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg transition-colors font-medium flex items-center gap-1.5"
                  >
                    + {lang === 'tr' ? 'Görsel Ekle' : 'Add image'}
                  </button>
                )}
              </div>

              {refImages.length === 0 ? (
                <button
                  onClick={() => refInputRef.current?.click()}
                  className="border-2 border-dashed border-purple-200 dark:border-purple-700 hover:border-purple-400 dark:hover:border-purple-500 rounded-xl p-6 flex flex-col items-center gap-2 text-slate-400 dark:text-slate-500 hover:text-purple-600 transition-colors"
                >
                  <span className="text-3xl">📂</span>
                  <p className="text-xs text-center">{lang === 'tr' ? 'Tıkla veya sürükle-bırak' : 'Click or drag and drop'}<br /><span className="text-[10px]">{lang === 'tr' ? 'PNG, JPG, WEBP — maks. 4 görsel' : 'PNG, JPG, WEBP — max 4 images'}</span></p>
                </button>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {refImages.map((b64, idx) => (
                    <div key={idx} className="relative group rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 aspect-square">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`data:image/jpeg;base64,${b64}`} alt={lang === 'tr' ? `Referans ${idx + 1}` : `Reference ${idx + 1}`} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button
                          onClick={() => removeRef(idx)}
                          aria-label={lang === 'tr' ? 'Referansı kaldır' : 'Remove reference'}
                          title={lang === 'tr' ? 'Referansı kaldır' : 'Remove reference'}
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
                      aria-label={lang === 'tr' ? 'Görsel ekle' : 'Add image'}
                      title={lang === 'tr' ? 'Görsel ekle' : 'Add image'}
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
              <p className="text-slate-500 text-sm animate-pulse">{lang === 'tr' ? 'Görsel üretiliyor…' : 'Generating image…'}</p>
              <p className="text-slate-400 text-xs">{lang === 'tr' ? 'Gemini arka planı oluşturuyor, marka katmanları ekleniyor' : 'Gemini is creating the background and adding brand layers'}</p>
            </div>
          )}
          {imageError && !imageLoading && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3 text-red-700 dark:text-red-300 text-sm flex gap-2">
              <span>❌</span><span><Msg text={imageError} /></span>
            </div>
          )}
          {imageData && !imageLoading && (
            <div className="flex flex-col gap-3">
              <div className="relative rounded-xl overflow-hidden bg-slate-950 flex justify-center shadow-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:${imageMime};base64,${imageData}`} alt={lang === 'tr' ? 'Post görseli' : 'Post image'} className="max-h-[460px] object-contain" />
              </div>

              {/* Başlık düzenleme alanı */}
              {rawBgData && (
                <div className="bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl p-3 flex flex-col gap-2">
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {lang === 'tr' ? '✏️ Görseldeki Başlık' : '✏️ Image headline'}
                  </p>
                  <textarea
                    value={headline}
                    onChange={e => setHeadline(e.target.value)}
                    rows={2}
                    placeholder={lang === 'tr' ? 'Başlık metnini düzenle…' : 'Edit the headline text…'}
                    className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50 resize-none placeholder-slate-400 font-medium leading-snug"
                  />

                  {/* Öneri chipleri */}
                  {suggestions.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                        {lang === 'tr' ? '💡 Alternatif öneriler — tıkla, uygula:' : '💡 Alternative suggestions — click to pick:'}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestions.map((s, i) => (
                          <button
                            key={i}
                            onClick={async () => {
                              setHeadline(s);
                              // Seçince otomatik uygula
                              setRecompositing(true);
                              try {
                                const finalB64 = await compositePostImage(rawBgMime, rawBgData, logoBase64, s, platform, partnerLogoBase64, subline);
                                setImageData(finalB64);
                                setImageMime('image/png');
                              } finally {
                                setRecompositing(false);
                              }
                            }}
                            className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors text-left leading-snug whitespace-pre-wrap ${
                              headline === s
                                ? 'bg-ocean/10 border-ocean text-ocean dark:text-sky-300'
                                : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-ocean hover:text-ocean dark:hover:text-sky-300'
                            }`}
                          >
                            {s.replace(/\n/g, ' / ')}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-slate-400 dark:text-slate-500">
                    {lang === 'tr'
                      ? 'Satır arası için Enter kullan. Düzenlemeyi uygulamak için butona bas.'
                      : 'Use Enter for line breaks. Press the button to apply changes.'}
                  </p>
                  <button
                    onClick={recomposite}
                    disabled={recompositing || !headline.trim()}
                    className="flex items-center justify-center gap-2 text-sm bg-ocean hover:bg-ocean-dark disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
                  >
                    {recompositing
                      ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Uygulanıyor…' : 'Applying…'}</>
                      : (lang === 'tr' ? '🖊️ Başlığı Uygula' : '🖊️ Apply headline')}
                  </button>
                </div>
              )}

              {/* Görsel konsepti + sanat yönü — her ikisi de görseli yeniden üretir */}
              {rawBgData && (
                <div className="bg-slate-50 dark:bg-slate-700/60 border border-slate-200 dark:border-slate-600 rounded-xl p-3 flex flex-col gap-3">
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    {lang === 'tr' ? '🎬 Görsel Konsepti & Stil' : '🎬 Visual concept & style'}
                  </p>

                  {/* Sanat yönü */}
                  <div className="flex flex-col gap-1.5">
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                      {lang === 'tr' ? 'Stil — tıkla, o stilde yeniden üret:' : 'Style — click to regenerate in that style:'}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {ART_DIRECTIONS.map(d => (
                        <button
                          key={d.id}
                          onClick={() => generateImage({ scene: activeScene || undefined, direction: d.id })}
                          disabled={imageLoading}
                          className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-50 ${
                            artDirection === d.id
                              ? 'bg-ocean/10 border-ocean text-ocean dark:text-sky-300 font-medium'
                              : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-ocean hover:text-ocean dark:hover:text-sky-300'
                          }`}
                        >
                          {d.icon} {d.label[lang === 'tr' ? 'tr' : 'en']}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Alternatif sahne konseptleri */}
                  {sceneSuggestions.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                        {lang === 'tr'
                          ? 'Farklı konsept — aynı mesaj, başka bir görsel fikir:'
                          : 'Different concept — same message, another visual idea:'}
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {sceneSuggestions.map((s, i) => (
                          <button
                            key={i}
                            onClick={() => generateImage({ scene: s, direction: artDirection || undefined })}
                            disabled={imageLoading}
                            title={s}
                            className="text-[11px] px-2.5 py-1.5 rounded-lg border bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-ocean hover:text-ocean dark:hover:text-sky-300 transition-colors text-left leading-snug disabled:opacity-50"
                          >
                            {s.length > 150 ? `${s.slice(0, 150)}…` : s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-slate-400 dark:text-slate-500">
                    {lang === 'tr'
                      ? 'Stil seçmezsen "Yeniden Üret" her seferinde rastgele farklı bir stil dener.'
                      : 'Without picking a style, "Regenerate" tries a different random style each time.'}
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={downloadImage} className="flex-1 flex items-center justify-center gap-2 bg-navy hover:bg-navy-light text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
                  {lang === 'tr' ? '⬇️ Görseli İndir' : '⬇️ Download image'}
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
                  {imgCopied ? (lang === 'tr' ? '✅ Tamam!' : '✅ Done!') : (lang === 'tr' ? '📋 Kopyala' : '📋 Copy')}
                </button>
              </div>
            </div>
          )}
          {!imageData && !imageLoading && !imageError && (
            <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-400 dark:text-slate-500">
              <span className="text-3xl opacity-30">🖼️</span>
              <p className="text-xs text-center">
                {lang === 'tr'
                  ? <>{`İçerik üretildikten sonra`}<br /><strong className="text-slate-500 dark:text-slate-400">Görsel Oluştur</strong>{` butonuna tıklayın.`}</>
                  : <>{`After generating content, click the`}<br /><strong className="text-slate-500 dark:text-slate-400">Generate image</strong>{` button.`}</>}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
