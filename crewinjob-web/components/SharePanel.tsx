'use client';
import { useState, useEffect, useCallback } from 'react';
import PlatformPreview from './PlatformPreview';
import { addPost, makeThumbnail } from '@/lib/post-history';
import { logActivity } from '@/lib/activity-log';
import { useLang } from '@/lib/lang';

interface PlatformStatus {
  configured: boolean;
  connected:  boolean;
  expired:    boolean;
  username:   string | null;
}

type StatusMap = Record<string, PlatformStatus>;

const PLATFORMS = [
  {
    id: 'instagram', icon: '📸', label: 'Instagram',
    color: 'bg-gradient-to-br from-purple-500 to-pink-500',
    charLimit: 2200,
    charLabel: '2.200 karakter',
    imageRatio: '1:1 · 4:5 · 9:16',
    imageRes: '1080×1080 önerilen',
    note: 'Caption tam gönderilir. Görsel zorunlu.',
  },
  {
    id: 'facebook', icon: '👥', label: 'Facebook',
    color: 'bg-blue-600',
    charLimit: 63206,
    charLabel: 'Sınırsız',
    imageRatio: '1.91:1 · 1:1',
    imageRes: '1200×630 önerilen',
    note: 'İçerik tam gönderilir.',
  },
  {
    id: 'twitter', icon: '🐦', label: 'Twitter / X',
    color: 'bg-slate-900',
    charLimit: 280,
    charLabel: '280 karakter',
    imageRatio: '16:9 · 1:1',
    imageRes: '1600×900 önerilen',
    note: 'Yalnızca ilk 280 karakter paylaşılır.',
  },
  {
    id: 'linkedin', icon: '💼', label: 'LinkedIn',
    color: 'bg-blue-700',
    charLimit: 3000,
    charLabel: '3.000 karakter',
    imageRatio: '1.91:1 · 1:1',
    imageRes: '1200×627 önerilen',
    note: 'İçerik tam gönderilir.',
  },
  {
    id: 'tiktok', icon: '🎵', label: 'TikTok',
    color: 'bg-gradient-to-br from-slate-900 to-pink-500',
    charLimit: 2200,
    charLabel: '2.200 karakter',
    imageRatio: '9:16',
    imageRes: '1080×1920 önerilen',
    note: 'Metin post (API) veya Script Modu.',
  },
];


function getAdaptedContent(platformId: string, content: string): string {
  return content;
}

// Platform görsel boyutları (center-crop hedefleri)
const PLATFORM_IMAGE_DIMS: Record<string, [number, number]> = {
  instagram: [1080, 1080],  // 1:1
  facebook:  [1200,  630],  // 1.91:1
  twitter:   [1200,  675],  // 16:9
  linkedin:  [1200,  627],  // 1.91:1
};

/** Görseli platforma özgü boyuta center-crop ile uyarlar, PNG base64 döndürür */
async function cropImageForPlatform(
  imageData: string,
  imageMime: string,
  platformId: string,
): Promise<string> {
  const [targetW, targetH] = PLATFORM_IMAGE_DIMS[platformId] || [1200, 630];
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d')!;
      const srcAspect = img.width / img.height;
      const dstAspect = targetW / targetH;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (srcAspect > dstAspect) {
        sw = Math.round(img.height * dstAspect);
        sx = Math.round((img.width - sw) / 2);
      } else {
        sh = Math.round(img.width / dstAspect);
        sy = Math.round((img.height - sh) / 2);
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => resolve(imageData);
    img.src = `data:${imageMime};base64,${imageData}`;
  });
}

// Post URL'inden platform-spesifik post ID çıkarır
function extractPostId(platform: string, url: string): string {
  try {
    if (platform === 'twitter') {
      // https://twitter.com/i/web/status/123456 veya .../status/123456
      const m = url.match(/status\/(\d+)/);
      return m?.[1] || '';
    }
    if (platform === 'linkedin') {
      // https://www.linkedin.com/feed/update/urn:li:share:123 veya urn:li:ugcPost:123
      const m = url.match(/urn:li:[a-zA-Z]+:[\d_-]+/);
      return m?.[0] || '';
    }
    if (platform === 'facebook') {
      // https://www.facebook.com/{pageId}_{postId} veya ...{postId}
      const m = url.match(/facebook\.com\/(.+?)$/);
      return m?.[1]?.split('?')[0] || '';
    }
    if (platform === 'instagram') {
      // https://www.instagram.com/p/{shortcode}/
      const m = url.match(/\/p\/([^/?]+)/);
      return m?.[1] || '';
    }
  } catch { /* ignore */ }
  return '';
}

// Twitter Web Intent — API gerektirmez, ücretsiz, limit yok
function twitterWebIntentUrl(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text.slice(0, 280))}`;
}

// LinkedIn — feed share modal'ı (metin panoda, görsel İndirilenler'de, kullanıcı manuel yapıştırır)
function linkedinShareUrl(_text: string): string {
  return `https://www.linkedin.com/feed/?shareActive=true`;
}

/**
 * LinkedIn Web Intent:
 * 1) Tam metni panoya kopyala (URL parametresi LinkedIn tarafından kesiliyor)
 * 2) Görsel varsa otomatik indir (.jpg) — LinkedIn compose box paste kabul etmiyor, file upload gerekiyor
 * 3) LinkedIn share dialog'unu yeni sekmede aç
 * 4) Kullanıcı: Ctrl+V metin yapıştırır, 🖼️ butonuyla görseli yükler, şirket sayfasını seçer, Post'a basar
 */
async function shareToLinkedIn(
  text: string,
  imageData?: string,
  imageMime?: string,
): Promise<{ imageCopied: boolean; textCopied: boolean }> {
  // 1. Tam metni panoya kopyala
  let textCopied = false;
  try {
    await navigator.clipboard.writeText(text.slice(0, 3000));
    textCopied = true;
  } catch (err) {
    console.warn('[LinkedIn Share] Metin panoya kopyalanamadı:', err);
  }

  // 2. Görseli otomatik indir
  let imageCopied = false;
  if (imageData) {
    try {
      const mime     = imageMime || 'image/jpeg';
      const ext      = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
      const dataUrl  = `data:${mime};base64,${imageData}`;
      const link     = document.createElement('a');
      link.href      = dataUrl;
      link.download  = `crewin-linkedin.${ext}`;
      link.click();
      imageCopied = true;
    } catch (err) {
      console.warn('[LinkedIn Share] Görsel indirilemedi:', err);
    }
  }

  // 3. LinkedIn'i aç
  window.open(linkedinShareUrl(''), '_blank', 'noopener,noreferrer');
  return { imageCopied, textCopied };
}

/**
 * Twitter Web Intent + görsel desteği (Twitter URL'ye image kabul etmiyor):
 * 1) Görseli panoya PNG olarak kopyala (clipboard.write)
 * 2) Twitter Web Intent'i yeni sekmede aç
 * 3) Kullanıcı Twitter'da Ctrl+V ile görseli yapıştırır
 * Returns: { textShared: true, imageCopied: boolean }
 */
async function shareToTwitter(
  text: string,
  imageData?: string,
  imageMime?: string,
): Promise<{ imageCopied: boolean }> {
  let imageCopied = false;

  if (imageData) {
    try {
      // JPEG → PNG dönüştür (clipboard sadece PNG kabul ediyor)
      const img = new Image();
      img.src = `data:${imageMime || 'image/jpeg'};base64,${imageData}`;
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); });
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      cv.getContext('2d')!.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/png'));
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        imageCopied = true;
      }
    } catch (err) {
      console.warn('[Twitter Share] Görsel panoya kopyalanamadı:', err);
    }
  }

  // Twitter Web Intent'i aç
  window.open(twitterWebIntentUrl(text), '_blank', 'noopener,noreferrer');
  return { imageCopied };
}

interface ErrorInfo {
  message:       string;
  canCopy:       boolean;
  showWebIntent: boolean;   // Twitter Web Intent butonu göster
  link?:         { url: string; label: string };
  fixHint?:      string;    // Ücretsiz düzeltme ipucu
}

function getErrorInfo(platform: string, error: string): ErrorInfo {
  if (platform === 'twitter') {
    const webIntentBase: Partial<ErrorInfo> = { canCopy: true, showWebIntent: true };

    if (error === 'TWITTER_MONTHLY_LIMIT') return {
      ...webIntentBase,
      message:  '⚠️ Twitter Free tier aylık 1.500 tweet kotası dolmuş (ay başında yenilenir).',
      fixHint:  'Şu an için "Web\'de Paylaş" butonunu kullan — Twitter\'ı doğrudan açar. Kota bir sonraki ayın 1\'inde yenilenir. Alternatif: twitter.com/i/developer-platform → Basic plan ($100/ay, 50.000 tweet/ay).',
      link:     { url: 'https://twitter.com/intent/tweet', label: 'Twitter\'da Manuel Paylaş' },
    } as ErrorInfo;

    if (error === 'TWITTER_NO_CREDITS') return {
      ...webIntentBase,
      message:  'Twitter API Free tier write kotası dolmuş veya app izinleri eksik.',
      fixHint:  '✅ Ücretsiz düzeltme: developer.twitter.com → Apps → App Settings → "App permissions" → "Read and Write" seç → Access Token\'ı yeniden oluştur.',
      link:     { url: 'https://developer.twitter.com/en/portal/projects-and-apps', label: 'Developer Portal\'ı Aç' },
    } as ErrorInfo;

    if (error === 'TWITTER_NO_WRITE') return {
      ...webIntentBase,
      message:  'Uygulama yalnızca "Read" iznine sahip, "Write" izni eksik.',
      fixHint:  '✅ Ücretsiz düzeltme: Developer Portal → App Settings → Permissions → "Read and Write" → Kaydet → Access Token\'ı yeniden oluştur.',
      link:     { url: 'https://developer.twitter.com/en/portal/projects-and-apps', label: 'İzinleri Düzenle' },
    } as ErrorInfo;

    if (error === 'TWITTER_FORBIDDEN') return {
      ...webIntentBase,
      message:  'Erişim reddedildi (403). API key veya app izni sorunu.',
      fixHint:  '✅ Ücretsiz düzeltme: App permissions "Read and Write" olduğundan emin olun, ardından Access Token\'ı yeniden oluşturun.',
      link:     { url: 'https://developer.twitter.com/en/portal/projects-and-apps', label: 'Developer Portal' },
    } as ErrorInfo;

    if (error === 'TWITTER_AUTH_ERROR') return {
      ...webIntentBase,
      message:  'Yetkilendirme hatası (401). API key/secret veya access token hatalı.',
      fixHint:  '.env.local dosyasındaki TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET değerlerini kontrol edin.',
      link:     { url: 'https://developer.twitter.com/en/portal/projects-and-apps', label: 'API Anahtarları' },
    } as ErrorInfo;

    if (error === 'TWITTER_RATE_LIMIT') return {
      ...webIntentBase,
      message:  'Hız limiti aşıldı (429). 15 dakika bekleyin.',
    } as ErrorInfo;

    if (error === 'TWITTER_DUPLICATE') return {
      canCopy: false, showWebIntent: false,
      message: 'Bu tweet daha önce paylaşıldı. Twitter aynı içeriği iki kez kabul etmiyor.',
    };
  }
  return { message: error || 'Bilinmeyen hata.', canCopy: true, showWebIntent: false };
}

interface Props {
  content:    string;
  imageData?: string;
  imageMime?: string;
  onClose:    () => void;
}

export default function SharePanel({ content, imageData, imageMime, onClose }: Props) {
  const { lang } = useLang();
  const [status,    setStatus]   = useState<StatusMap>({});
  const [loading,   setLoading]  = useState(true);
  const [selected,  setSelected] = useState<string[]>([]);
  const [editText,  setEditText] = useState(content);
  const [posting,   setPosting]  = useState(false);
  const [results,   setResults]  = useState<{ platform: string; success: boolean; url?: string; error?: string }[]>([]);
  const [step,      setStep]     = useState<'select' | 'confirm' | 'done'>('select');
  const [preview,   setPreview]  = useState<string | null>(null);
  const [confirmPreview, setConfirmPreview] = useState<string | null>(null);
  const [adapting,  setAdapting] = useState<string | null>(null);   // hangi platform uyarlanıyor
  // platform → uyarlanmış metin
  const [adapted,        setAdapted]        = useState<Record<string, string>>({});
  // platform → uyarlanmış görsel (center-crop)
  const [adaptedImages,  setAdaptedImages]  = useState<Record<string, string>>({});
  const [adaptingImg,    setAdaptingImg]    = useState<string | null>(null);
  // Web Intent toast bildirimi (Twitter + LinkedIn)
  const [twToast,   setTwToast]  = useState<{ show: boolean; imageCopied: boolean; textCopied?: boolean; platform: 'twitter' | 'linkedin' }>({ show: false, imageCopied: false, platform: 'twitter' });
  // TikTok script kopyalama durumu
  const [tiktokCopied, setTiktokCopied] = useState(false);
  // Facebook / Instagram / TikTok hızlı paylaşım durumu
  const [quickPosting, setQuickPosting] = useState<string | null>(null);
  const [quickToast,   setQuickToast]   = useState<{ show: boolean; platform: string; success: boolean; message: string; url?: string } | null>(null);

  const adaptImageForPlatform = async (platformId: string) => {
    if (!imageData) return;
    setAdaptingImg(platformId);
    try {
      const cropped = await cropImageForPlatform(imageData, imageMime || 'image/png', platformId);
      setAdaptedImages(prev => ({ ...prev, [platformId]: cropped }));
    } finally {
      setAdaptingImg(null);
    }
  };

  const handleTwitterQuickShare = async (text: string) => {
    const { imageCopied } = await shareToTwitter(text, imageData, imageMime);
    setTwToast({ show: true, imageCopied, platform: 'twitter' });
    setTimeout(() => setTwToast({ show: false, imageCopied: false, platform: 'twitter' }), 10000);
  };

  const handleLinkedInQuickShare = async (text: string) => {
    const { imageCopied, textCopied } = await shareToLinkedIn(text, imageData, imageMime);
    setTwToast({ show: true, imageCopied, textCopied, platform: 'linkedin' });
    setTimeout(() => setTwToast({ show: false, imageCopied: false, platform: 'linkedin' }), 15000);
  };

  /** Facebook / Instagram / TikTok — direkt API üzerinden hızlı paylaşım */
  const handleQuickPost = async (platform: string, text: string, imgData?: string, imgMime?: string) => {
    setQuickPosting(platform);
    setQuickToast(null);
    try {
      const res = await fetch('/api/social/post', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ platforms: [platform], content: text, imageData: imgData, imageMime: imgMime }),
      });
      const data = await res.json();
      const result = (data.results as Array<{ success: boolean; url?: string; error?: string }>)?.[0];
      if (result?.success) {
        setQuickToast({ show: true, platform, success: true,  message: lang === 'tr' ? 'Başarıyla yayınlandı!' : 'Successfully published!', url: result.url });
      } else {
        setQuickToast({ show: true, platform, success: false, message: result?.error || (lang === 'tr' ? 'Paylaşım başarısız' : 'Share failed') });
      }
    } catch {
      setQuickToast({ show: true, platform, success: false, message: lang === 'tr' ? 'Sunucu hatası' : 'Server error' });
    } finally {
      setQuickPosting(null);
      setTimeout(() => setQuickToast(prev => prev ? { ...prev, show: false } : null), 8000);
    }
  };

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/social/status');
      setStatus(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const connected = p.get('social_connected');
    const error     = p.get('social_error');
    if (connected || error) {
      window.history.replaceState({}, '', window.location.pathname);
      fetchStatus();
    }
  }, [fetchStatus]);

  const connectedPlatforms = PLATFORMS.filter(p => status[p.id]?.connected);
  const connectedSelected  = selected.filter(p => status[p]?.connected);

  const togglePlatform = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  };

  const selectAll = () => {
    const allConnected = connectedPlatforms.map(p => p.id);
    const allSelected  = allConnected.every(id => selected.includes(id));
    setSelected(allSelected ? [] : allConnected);
  };

  const connect = (platformId: string) => {
    window.open(`/api/social/connect/${platformId}`, '_self');
  };

  const adaptForPlatform = async (platformId: string, textToAdapt?: string) => {
    setAdapting(platformId);
    try {
      const res  = await fetch('/api/social/adapt', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: textToAdapt ?? editText, platform: platformId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAdapted(prev => ({ ...prev, [platformId]: data.adapted }));
      return data.adapted as string;
    } catch (e) {
      console.error('Adapt error:', e);
      return null;
    } finally {
      setAdapting(null);
    }
  };

  // Confirm'e geçmeden önce limit aşan tüm platformları otomatik uyarla
  const goToConfirm = async () => {
    const platformsNeedingAdapt = connectedSelected.filter(id => {
      const p = PLATFORMS.find(x => x.id === id);
      return p && editText.length > p.charLimit && !adapted[id];
    });

    if (platformsNeedingAdapt.length === 0) {
      setStep('confirm');
      return;
    }

    // Paralel uyarlama
    setAdapting('auto');
    await Promise.all(platformsNeedingAdapt.map(id => adaptForPlatform(id, editText)));
    setAdapting(null);
    setStep('confirm');
  };

  const handlePost = async () => {
    setPosting(true);
    try {
      // Her platform için uyarlanmış metin
      const perPlatformContent = Object.fromEntries(
        selected.map(p => [p, adapted[p] || editText])
      );
      // Her platform için uyarlanmış görsel — yoksa otomatik crop yap
      const perPlatformImageData: Record<string, string> = {};
      if (imageData) {
        await Promise.all(selected.map(async (p) => {
          if (adaptedImages[p]) {
            perPlatformImageData[p] = adaptedImages[p];
          } else {
            perPlatformImageData[p] = await cropImageForPlatform(imageData, imageMime || 'image/png', p);
          }
        }));
      }
      const res = await fetch('/api/social/post', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ platforms: selected, content: editText, perPlatformContent, imageData, imageMime, perPlatformImageData }),
      });
      const data = await res.json();
      setResults(data.results || []);

      // Başarılı paylaşımları geçmişe kaydet
      const thumbnail = imageData ? await makeThumbnail(imageData, imageMime || 'image/png') : '';
      for (const r of (data.results || []) as { platform: string; success: boolean; url?: string }[]) {
        if (r.success && r.url) {
          // URL'den postId çıkar
          const postId = extractPostId(r.platform, r.url) || r.url;
          void addPost({
            platform:    r.platform,
            postId,
            postUrl:     r.url,
            content:     perPlatformContent[r.platform] || editText,
            thumbnail:   thumbnail || undefined,
            publishedAt: Date.now(),
          });
          logActivity('post_published', `${r.platform.charAt(0).toUpperCase() + r.platform.slice(1)}'a post yayınlandı`, r.url);
        }
      }

      setStep('done');
    } catch {
      setResults([{ platform: 'system', success: false, error: lang === 'tr' ? 'Sunucu hatası' : 'Server error' }]);
      setStep('done');
    } finally {
      setPosting(false);
    }
  };

  const allConnectedSelected = connectedPlatforms.length > 0 &&
    connectedPlatforms.every(p => selected.includes(p.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      {/* Web Intent Toast (Twitter + LinkedIn) */}
      {twToast.show && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 dark:bg-slate-700 border border-ocean shadow-2xl rounded-xl px-5 py-4 max-w-md flex items-start gap-3 animate-in fade-in slide-in-from-top duration-300">
          <span className="text-2xl shrink-0">{twToast.platform === 'linkedin' ? '💼' : '🐦'}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white mb-1">
              {twToast.platform === 'linkedin'
                ? (lang === 'tr' ? 'LinkedIn açıldı!' : 'LinkedIn opened!')
                : (lang === 'tr' ? 'Twitter açıldı!' : 'Twitter opened!')}
            </p>
            {twToast.platform === 'linkedin' ? (
              <p className="text-xs text-slate-200 leading-relaxed">
                {twToast.textCopied && (
                  <><span className="text-green-300">
                    {lang === 'tr' ? '✅ Metin panoya kopyalandı' : '✅ Text copied to clipboard'}
                  </span><br /></>
                )}
                {twToast.imageCopied && (
                  <><span className="text-green-300">
                    {lang === 'tr' ? '✅ Görsel indirildi' : '✅ Image downloaded'}
                  </span> {lang === 'tr' ? '(İndirilenler klasörüne bak)' : '(Check your Downloads folder)'}<br /></>
                )}
                <br />
                <strong>{lang === 'tr' ? 'LinkedIn share modal açıldı:' : 'LinkedIn share modal opened:'}</strong><br />
                1️⃣ <strong>"Anyone"</strong> dropdown → <strong>creWin</strong> {lang === 'tr' ? 'şirket sayfasını seç' : 'select company page'}<br />
                2️⃣ {lang === 'tr'
                  ? <>Metin kutusuna <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Ctrl+V</kbd> → tam metin yapışır</>
                  : <>Paste in text box <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Ctrl+V</kbd> → full text pastes</>}<br />
                {twToast.imageCopied && (
                  <>3️⃣ 🖼️ {lang === 'tr' ? 'fotoğraf butonuna tıkla → indirilen görseli seç' : 'click photo button → select downloaded image'}<br />4️⃣ </>
                )}
                {!twToast.imageCopied && <>3️⃣ </>}<strong>Post</strong>{lang === 'tr' ? "'a bas ✅" : ' ✅'}
              </p>
            ) : (
              twToast.imageCopied ? (
                <p className="text-xs text-slate-200 leading-relaxed">
                  {lang === 'tr' ? (
                    <>✅ <strong>Görsel panoya kopyalandı.</strong><br />
                    Twitter'da metin alanına tıkla → <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Ctrl+V</kbd> (Mac: <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">⌘+V</kbd>) → Görsel yapışır → <strong>Post</strong>'a tıkla.</>
                  ) : (
                    <>✅ <strong>Image copied to clipboard.</strong><br />
                    Click in Twitter text area → <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Ctrl+V</kbd> (Mac: <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">⌘+V</kbd>) → Image pastes → click <strong>Post</strong>.</>
                  )}
                </p>
              ) : imageData ? (
                <p className="text-xs text-amber-300 leading-relaxed">
                  {lang === 'tr'
                    ? '⚠️ Görsel panoya kopyalanamadı (tarayıcı izni). Görseli manuel olarak indirip Twitter\'a yükleyebilirsin.'
                    : '⚠️ Image could not be copied to clipboard (browser permission). You can manually download the image and upload it to Twitter.'}
                </p>
              ) : (
                <p className="text-xs text-slate-200 leading-relaxed">
                  {lang === 'tr'
                    ? <>Metin Twitter'a otomatik dolduruldu. Sadece <strong>Post</strong>'a tıkla.</>
                    : <>Text was auto-filled into Twitter. Just click <strong>Post</strong>.</>}
                </p>
              )
            )}
          </div>
          <button
            onClick={() => setTwToast({ show: false, imageCopied: false, platform: 'twitter' })}
            className="text-slate-400 hover:text-white text-sm shrink-0"
          >✕</button>
        </div>
      )}

      {/* Quick Post Toast — Facebook / Instagram / TikTok */}
      {quickToast?.show && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[60] bg-slate-900 dark:bg-slate-700 border border-ocean shadow-2xl rounded-xl px-5 py-4 max-w-md flex items-start gap-3 animate-in fade-in slide-in-from-top duration-300"
          style={{ top: twToast.show ? '6rem' : '1.5rem' }}
        >
          <span className="text-2xl shrink-0">
            {quickToast.platform === 'facebook' ? '👥' : quickToast.platform === 'instagram' ? '📸' : '🎵'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white mb-1">
              {quickToast.platform === 'facebook' ? 'Facebook' : quickToast.platform === 'instagram' ? 'Instagram' : 'TikTok'}
              {' '}{quickToast.success
                ? (lang === 'tr' ? '— Yayınlandı! 🎉' : '— Published! 🎉')
                : (lang === 'tr' ? '— Paylaşım Başarısız' : '— Share Failed')}
            </p>
            {quickToast.success ? (
              quickToast.url ? (
                <p className="text-xs text-green-300 leading-relaxed">
                  {lang === 'tr' ? '✅ İçerik başarıyla yayınlandı.' : '✅ Content successfully published.'}{' '}
                  <a href={quickToast.url} target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-green-200">
                    {lang === 'tr' ? 'Gönderiyi görüntüle →' : 'View post →'}
                  </a>
                </p>
              ) : (
                <p className="text-xs text-green-300">
                  {lang === 'tr' ? '✅ İçerik başarıyla yayınlandı.' : '✅ Content successfully published.'}
                </p>
              )
            ) : (
              <p className="text-xs text-red-300 leading-relaxed">{quickToast.message}</p>
            )}
          </div>
          <button
            onClick={() => setQuickToast(prev => prev ? { ...prev, show: false } : null)}
            className="text-slate-400 hover:text-white text-sm shrink-0"
          >✕</button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <span className="text-xl">📤</span>
            <div>
              <h2 className="font-bold text-slate-800 dark:text-slate-100">
                {lang === 'tr' ? 'Paylaşım Onayı' : 'Share Settings'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'tr' ? 'Platform seç, içeriği gözden geçir, onayla' : 'Select platform, review content, confirm'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none">✕</button>
        </div>

        {/* ── STEP: select ── */}
        {step === 'select' && (
          <div className="p-6 flex flex-col gap-6">

            {/* Platform listesi */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  📱 {lang === 'tr' ? 'Platform Seç' : 'Select Platform'}
                </h3>
                {connectedPlatforms.length > 0 && !loading && (
                  <button
                    onClick={selectAll}
                    className="text-xs font-medium text-ocean hover:text-ocean-dark border border-ocean/30 hover:border-ocean/60 rounded-lg px-3 py-1 transition-colors"
                  >
                    {allConnectedSelected
                      ? (lang === 'tr' ? '☐ Tümünü Kaldır' : '☐ Deselect All')
                      : (lang === 'tr' ? '☑ Tümünü Seç' : '☑ Select All')}
                  </button>
                )}
              </div>

              {loading ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <div className="w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                  {lang === 'tr' ? 'Bağlantı durumları kontrol ediliyor...' : 'Checking connection statuses...'}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {PLATFORMS.map(p => {
                    const s             = status[p.id];
                    const isConnected   = s?.connected;
                    const isSelected    = selected.includes(p.id);
                    // TikTok'un Script Modu her zaman kullanılabilir — configure edilmemiş görünmez
                    const notConfigured = p.id !== 'tiktok' && s && !s.configured;
                    const isPreview     = preview === p.id;

                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl border-2 p-3 transition-all ${
                          isSelected
                            ? 'border-ocean bg-ocean/5'
                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                        } ${notConfigured ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          {isConnected && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => togglePlatform(p.id)}
                              className="w-4 h-4 accent-ocean cursor-pointer shrink-0"
                            />
                          )}
                          <span className="text-xl shrink-0">{p.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{p.label}</p>
                            {isConnected ? (
                              <p className="text-xs text-green-600 truncate">
                                ✅ {s.username || (lang === 'tr' ? 'Bağlı' : 'Connected')}
                              </p>
                            ) : s?.expired ? (
                              <p className="text-xs text-orange-500">⚠️ {lang === 'tr' ? 'Token süresi doldu' : 'Token expired'}</p>
                            ) : notConfigured ? (
                              <p className="text-xs text-slate-400 dark:text-slate-500">
                                {lang === 'tr' ? 'API key eksik' : 'API key missing'}
                              </p>
                            ) : p.id === 'tiktok' ? (
                              <p className="text-xs text-pink-500 dark:text-pink-400">🎵 Script Modu</p>
                            ) : (
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                {lang === 'tr' ? 'Bağlı değil' : 'Not connected'}
                              </p>
                            )}
                          </div>
                          {/* TikTok'ta "Bağlan" butonu yok — Script Modu veya statik token */}
                          {!isConnected && !notConfigured && p.id !== 'tiktok' && (
                            <button onClick={() => connect(p.id)} className="text-xs bg-ocean text-white px-2 py-1 rounded-lg hover:bg-ocean-dark shrink-0">
                              {lang === 'tr' ? 'Bağlan' : 'Connect'}
                            </button>
                          )}
                          {s?.expired && (
                            <button onClick={() => connect(p.id)} className="text-xs bg-orange-500 text-white px-2 py-1 rounded-lg hover:bg-orange-600 shrink-0">
                              {lang === 'tr' ? 'Yenile' : 'Refresh'}
                            </button>
                          )}
                          {isConnected && isSelected && (
                            <button
                              onClick={() => setPreview(isPreview ? null : p.id)}
                              className="text-xs text-slate-400 hover:text-ocean shrink-0 transition-colors"
                              title={lang === 'tr' ? 'Bu platformda nasıl görünür?' : 'How will it look on this platform?'}
                            >
                              {isPreview ? '▲' : '👁'}
                            </button>
                          )}
                        </div>

                        {/* ── Instagram no-image warning ── */}
                        {p.id === 'instagram' && isSelected && !imageData && (
                          <div className="mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-2.5 flex items-start gap-2">
                            <span className="text-sm shrink-0">⚠️</span>
                            <div>
                              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                                {lang === 'tr' ? 'Görsel zorunlu!' : 'Image required!'}
                              </p>
                              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 leading-relaxed">
                                {lang === 'tr'
                                  ? <>Instagram API'si görsel olmadan post kabul etmez — paylaşım başarısız olur.
                                    OutputPanel'den <strong>✨ Görsel Oluştur</strong>'u kullanın veya İçerik Kütüphanesi'nden görsellendirilmiş bir içerik seçin.</>
                                  : <>Instagram API does not accept posts without an image — share will fail.
                                    Use <strong>✨ Generate Image</strong> from OutputPanel or select visualized content from the Content Library.</>}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* ── Hızlı paylaşım / platform aksiyon butonları ── */}
                        {(p.id === 'twitter' || p.id === 'linkedin' || p.id === 'facebook' || p.id === 'instagram' || p.id === 'tiktok') && (
                          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 flex flex-col gap-1.5">

                            {/* Twitter — Web Intent */}
                            {p.id === 'twitter' && (
                              <button
                                onClick={() => handleTwitterQuickShare(adapted[p.id] || editText)}
                                title={imageData
                                  ? (lang === 'tr' ? 'Görsel panoya kopyalanır + Twitter açılır → Ctrl+V yapıştır → Post' : 'Image copied to clipboard + Twitter opens → Ctrl+V paste → Post')
                                  : (lang === 'tr' ? 'Twitter\'ı açar, metin hazır gelir' : 'Opens Twitter with text pre-filled')}
                                className="w-full text-xs bg-slate-800 hover:bg-black text-white px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5"
                              >
                                {lang === 'tr'
                                  ? `🐦 Twitter'da Hızlı Paylaş${imageData ? ' +🖼️' : ''}`
                                  : `🐦 Share on Twitter${imageData ? ' +🖼️' : ''}`}
                              </button>
                            )}

                            {/* LinkedIn — Web Intent (metin hazır gelir, şirket sayfasını kullanıcı seçer) */}
                            {p.id === 'linkedin' && (
                              <button
                                onClick={() => handleLinkedInQuickShare(adapted[p.id] || editText)}
                                title={imageData
                                  ? (lang === 'tr' ? 'Görsel panoya kopyalanır + LinkedIn açılır → şirket sayfasını seç → Ctrl+V görsel → Paylaş' : 'Image copied + LinkedIn opens → select company page → Ctrl+V image → Share')
                                  : (lang === 'tr' ? 'LinkedIn açılır, metin hazır gelir → şirket sayfasını seç → Paylaş' : 'LinkedIn opens with text → select company page → Share')}
                                className="w-full text-xs bg-blue-700 hover:bg-blue-800 text-white px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5"
                              >
                                {lang === 'tr'
                                  ? `💼 Şirket Sayfasında Paylaş${imageData ? ' +🖼️' : ''}`
                                  : `💼 Share on Company Page${imageData ? ' +🖼️' : ''}`}
                              </button>
                            )}

                            {/* Facebook — API Quick Post (statik token) */}
                            {p.id === 'facebook' && status[p.id]?.configured && (
                              <button
                                onClick={() => handleQuickPost('facebook', adapted['facebook'] || editText, imageData, imageMime)}
                                disabled={quickPosting === 'facebook'}
                                className="w-full text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5"
                              >
                                {quickPosting === 'facebook'
                                  ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Yayınlanıyor...' : 'Publishing...'}</>
                                  : <>👥 {lang === 'tr' ? `Sayfada Hızlı Yayınla${imageData ? ' +🖼️' : ''}` : `Quick Publish to Page${imageData ? ' +🖼️' : ''}`}</>}
                              </button>
                            )}

                            {/* Instagram — API Quick Post (statik token, görsel zorunlu) */}
                            {p.id === 'instagram' && status[p.id]?.configured && (
                              <button
                                onClick={() => imageData ? handleQuickPost('instagram', adapted['instagram'] || editText, imageData, imageMime) : undefined}
                                disabled={!imageData || quickPosting === 'instagram'}
                                title={!imageData ? (lang === 'tr' ? 'Instagram paylaşımı için görsel zorunlu' : 'Image required for Instagram share') : undefined}
                                className={`w-full text-xs px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 ${
                                  imageData
                                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white disabled:opacity-50'
                                    : 'bg-slate-200 dark:bg-slate-600 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                                }`}
                              >
                                {quickPosting === 'instagram'
                                  ? <><span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Yayınlanıyor...' : 'Publishing...'}</>
                                  : imageData
                                    ? <>📸 {lang === 'tr' ? 'Instagram\'da Yayınla +🖼️' : 'Publish on Instagram +🖼️'}</>
                                    : <>📸 {lang === 'tr' ? 'Instagram\'da Yayınla (Görsel Gerekli)' : 'Publish on Instagram (Image Required)'}</>}
                              </button>
                            )}

                            {/* TikTok — Script Modu (her zaman) + API (token varsa) */}
                            {p.id === 'tiktok' && (
                              <>
                                <div className="flex gap-1.5">
                                  <button
                                    onClick={async () => {
                                      await navigator.clipboard.writeText(adapted['tiktok'] || editText);
                                      setTiktokCopied(true);
                                      setTimeout(() => setTiktokCopied(false), 3000);
                                    }}
                                    className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-1 ${
                                      tiktokCopied ? 'bg-green-500 text-white' : 'bg-pink-500 hover:bg-pink-600 text-white'
                                    }`}
                                  >
                                    {tiktokCopied
                                      ? (lang === 'tr' ? '✅ Kopyalandı!' : '✅ Copied!')
                                      : (lang === 'tr' ? '📋 Scripti Kopyala' : '📋 Copy Script')}
                                  </button>
                                  <a
                                    href="https://www.tiktok.com/upload"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs font-semibold px-3 py-2 bg-slate-900 hover:bg-black text-white rounded-lg transition-colors whitespace-nowrap"
                                  >
                                    🎵 {lang === 'tr' ? 'TikTok Aç' : 'Open TikTok'}
                                  </a>
                                </div>
                                {status['tiktok']?.connected && (
                                  <button
                                    onClick={() => handleQuickPost('tiktok', adapted['tiktok'] || editText)}
                                    disabled={quickPosting === 'tiktok'}
                                    className="w-full text-xs bg-slate-900 hover:bg-black disabled:opacity-50 text-white px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5"
                                  >
                                    {quickPosting === 'tiktok'
                                      ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Yayınlanıyor...' : 'Publishing...'}</>
                                      : <>🎵 {lang === 'tr' ? 'TikTok\'ta Otomatik Yayınla' : 'Auto-Publish on TikTok'}</>}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {/* Platform özellikleri + önizleme (TikTok'ta da göster) */}
                        {(isConnected || p.id === 'tiktok') && (
                          <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700 flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex gap-3 flex-wrap">
                                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                  📐 <span className="font-medium text-slate-500 dark:text-slate-400">{p.imageRatio}</span>
                                </span>
                                <span className={`text-[10px] font-medium ${editText.length > p.charLimit ? 'text-orange-500' : 'text-slate-400 dark:text-slate-500'}`}>
                                  ✏️ {p.charLabel}
                                  {editText.length > p.charLimit && ` (${editText.length - p.charLimit} ${lang === 'tr' ? 'fazla' : 'over'})`}
                                </span>
                              </div>
                              <div className="flex gap-1.5 flex-wrap">
                                {/* AI ile Uyarla — her platform için göster */}
                                <button
                                  onClick={() => adaptForPlatform(p.id)}
                                  disabled={adapting === p.id}
                                  className={`text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors flex items-center gap-1 ${
                                    adapted[p.id]
                                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-200'
                                      : editText.length > p.charLimit
                                        ? 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                                        : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300 hover:bg-sky-200'
                                  } disabled:opacity-50`}
                                >
                                  {adapting === p.id
                                    ? <><span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Uyarlanıyor...' : 'Adapting...'}</>
                                    : adapted[p.id]
                                      ? (lang === 'tr' ? '✅ Yeniden Uyarla' : '✅ Re-Adapt')
                                      : (lang === 'tr' ? '🤖 AI ile Uyarla' : '🤖 Adapt with AI')}
                                </button>
                                {/* Görsel Uyarla — görsel varsa göster */}
                                {imageData && (
                                  <button
                                    onClick={() => adaptImageForPlatform(p.id)}
                                    disabled={adaptingImg === p.id}
                                    className={`text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors flex items-center gap-1 ${
                                      adaptedImages[p.id]
                                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 hover:bg-purple-200'
                                        : 'bg-slate-100 text-slate-600 dark:bg-slate-600 dark:text-slate-300 hover:bg-slate-200'
                                    } disabled:opacity-50`}
                                  >
                                    {adaptingImg === p.id
                                      ? <><span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Kırpılıyor...' : 'Cropping...'}</>
                                      : adaptedImages[p.id]
                                        ? (lang === 'tr' ? '🖼️ Görsel Uyarlandı' : '🖼️ Image Adapted')
                                        : (lang === 'tr' ? '🖼️ Görseli Uyarla' : '🖼️ Adapt Image')}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Uyarlanmış metin önizlemesi */}
                            {adapted[p.id] && (
                              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-2">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[10px] font-semibold text-green-700 dark:text-green-300">
                                    ✅ {lang === 'tr'
                                      ? `${p.label} için uyarlandı (${adapted[p.id].length} karakter)`
                                      : `Adapted for ${p.label} (${adapted[p.id].length} characters)`}
                                  </span>
                                  <button
                                    onClick={() => setAdapted(prev => { const n = {...prev}; delete n[p.id]; return n; })}
                                    className="text-[10px] text-green-500 hover:text-red-500"
                                  >{lang === 'tr' ? '✕ Kaldır' : '✕ Remove'}</button>
                                </div>
                                <p className="text-[10px] text-green-800 dark:text-green-200 leading-relaxed line-clamp-3">{adapted[p.id]}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Açılır önizleme */}
                        {isPreview && (
                          <div className="mt-2 bg-slate-50 dark:bg-slate-700 rounded-lg p-2.5 border border-slate-200 dark:border-slate-600">
                            <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
                              {lang === 'tr' ? `${p.label}'da görünecek içerik:` : `Content as seen on ${p.label}:`}
                            </p>
                            <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap max-h-24 overflow-y-auto">
                              {getAdaptedContent(p.id, editText)}
                            </p>
                            {editText.length > p.charLimit && (
                              <p className="text-[10px] text-orange-500 mt-1">⚠️ {p.note}</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!loading && Object.values(status).every(s => !s.configured) && (
                <div className="mt-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300">
                  <strong>⚙️ API Key {lang === 'tr' ? 'Gerekli' : 'Required'}:</strong> {lang === 'tr' ? '.env.local dosyasına platform API anahtarlarını ekleyin.' : 'Add platform API keys to your .env.local file.'}{' '}
                  <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">TWITTER_CLIENT_ID</code>,{' '}
                  <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">LINKEDIN_CLIENT_ID</code>,{' '}
                  <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">FACEBOOK_APP_ID</code>
                </div>
              )}

            </div>

            {/* İçerik düzenleme */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  ✏️ {lang === 'tr' ? 'İçerik (Düzenleyebilirsiniz)' : 'Edit Content'}
                </h3>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  editText.length > 280
                    ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-600 dark:text-orange-300'
                    : 'bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-300'
                }`}>
                  {editText.length.toLocaleString('tr-TR')} {lang === 'tr' ? 'karakter' : 'characters'}
                </span>
              </div>
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={8}
                className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3 text-sm text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-ocean/50 resize-none leading-relaxed"
              />
              <div className="flex gap-4 mt-1.5 flex-wrap">
                {PLATFORMS.map(p => (
                  <span key={p.id} className={`text-[11px] ${editText.length > p.charLimit ? 'text-orange-500 font-medium' : 'text-slate-400 dark:text-slate-500'}`}>
                    {p.icon} {editText.length > p.charLimit
                      ? `${p.label}: ${p.charLimit} ${lang === 'tr' ? 'sınırı aşıldı' : 'limit exceeded'}`
                      : `${p.label}: ✓`}
                  </span>
                ))}
              </div>
            </div>

            {/* Görsel önizleme */}
            {imageData && (
              <div>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
                  🖼️ {lang === 'tr' ? 'Görsel' : 'Image'}
                </h3>
                <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-700 rounded-xl p-3 border border-slate-200 dark:border-slate-600">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${imageMime || 'image/jpeg'};base64,${imageData}`}
                    alt={lang === 'tr' ? 'Post görseli' : 'Post image'}
                    className="h-20 w-auto rounded-lg object-cover"
                  />
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-col gap-1">
                    <p>{lang === 'tr' ? '✅ Görsel hazır' : '✅ Image ready'}</p>
                    {PLATFORMS.map(p => (
                      <p key={p.id} className="text-slate-400 dark:text-slate-500">{p.icon} {p.label}: {p.imageRes}</p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex gap-3 pt-2 border-t border-slate-100 dark:border-slate-700">
              <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                {lang === 'tr' ? 'İptal' : 'Cancel'}
              </button>
              <button
                disabled={connectedSelected.length === 0 || adapting === 'auto'}
                onClick={goToConfirm}
                className="flex-1 py-2.5 bg-ocean hover:bg-ocean-dark disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {adapting === 'auto' ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> {lang === 'tr' ? 'İçerik uyarlanıyor...' : 'Adapting content...'}</>
                ) : connectedSelected.length > 0
                  ? (lang === 'tr' ? `${connectedSelected.length} Platformda Önizle →` : `Preview on ${connectedSelected.length} Platform${connectedSelected.length > 1 ? 's' : ''} →`)
                  : (lang === 'tr' ? 'Platform Seç' : 'Select Platform')}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: confirm ── */}
        {step === 'confirm' && (
          <div className="p-6 flex flex-col gap-5">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  {lang === 'tr' ? 'Paylaşım Onayı' : 'Share Confirmation'}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  {lang === 'tr' ? (
                    <>Aşağıdaki içerik <strong>{connectedSelected.map(id => PLATFORMS.find(x => x.id === id)?.label).join(', ')}</strong> hesaplarınızda yayınlanacak.
                    Bu işlem geri alınamaz.</>
                  ) : (
                    <>The content below will be published on your <strong>{connectedSelected.map(id => PLATFORMS.find(x => x.id === id)?.label).join(', ')}</strong> accounts.
                    This action cannot be undone.</>
                  )}
                </p>
              </div>
            </div>

            {/* Per-platform preview */}
            <div className="flex flex-col gap-3">
              {connectedSelected.map(id => {
                const p            = PLATFORMS.find(x => x.id === id)!;
                const finalContent = adapted[id] || getAdaptedContent(id, editText);
                const isAIAdapted  = !!adapted[id];
                const isHardCut    = !isAIAdapted && finalContent.length < editText.length;
                return (
                  <div key={id} className="bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-600 border-b border-slate-200 dark:border-slate-500 flex-wrap">
                      <span>{p.icon}</span>
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{p.label}</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-400 ml-1">
                        {finalContent.length} {lang === 'tr' ? 'karakter' : 'characters'}
                      </span>
                      {isAIAdapted  && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">🤖 {lang === 'tr' ? 'AI Uyarlandı' : 'AI Adapted'}</span>}
                      {isHardCut    && <span className="text-[10px] text-orange-500 font-medium">✂️ {p.charLimit} {lang === 'tr' ? 'karaktere kısaltıldı' : 'characters truncated'}</span>}
                      {!isAIAdapted && !isHardCut && <span className="text-[10px] text-green-600 font-medium">✓ {lang === 'tr' ? 'Tam içerik' : 'Full content'}</span>}
                      <span className="text-[10px] text-slate-400">📐 {p.imageRatio}</span>
                      <button
                        onClick={() => setConfirmPreview(confirmPreview === id ? null : id)}
                        className={`ml-auto text-[10px] px-2 py-0.5 rounded-lg font-medium transition-colors ${
                          confirmPreview === id
                            ? 'bg-ocean text-white'
                            : 'bg-white border border-slate-300 text-slate-600 hover:border-ocean hover:text-ocean'
                        }`}
                      >
                        {confirmPreview === id
                          ? (lang === 'tr' ? '▲ Kapat' : '▲ Close')
                          : (lang === 'tr' ? '👁️ Önizle' : '👁️ Preview')}
                      </button>
                    </div>
                    <div className="px-4 py-3 max-h-32 overflow-y-auto">
                      <p className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">{finalContent}</p>
                    </div>
                    {confirmPreview === id && (
                      <div className="px-4 pb-4 border-t border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 flex justify-center pt-3">
                        <PlatformPreview platform={id} content={finalContent} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Instagram no-image warning in confirm step */}
            {connectedSelected.includes('instagram') && !imageData && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-xl p-3 flex items-start gap-2.5">
                <span className="text-xl shrink-0">⚠️</span>
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    {lang === 'tr' ? 'Instagram — Görsel eksik!' : 'Instagram — Image missing!'}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">
                    {lang === 'tr'
                      ? 'Instagram API\'si görsel olmadan post göndermeyi reddeder — Instagram paylaşımı başarısız olacaktır. Devam etmek için geri dönüp Instagram\'ı kaldırın ya da önce bir görsel oluşturun.'
                      : 'Instagram API rejects posts without an image — the Instagram share will fail. Go back and remove Instagram, or generate an image first.'}
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep('select')} className="flex-1 py-2.5 border border-slate-200 dark:border-slate-600 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                ← {lang === 'tr' ? 'Geri' : 'Back'}
              </button>
              <button
                onClick={handlePost}
                disabled={posting}
                className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {posting
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> {lang === 'tr' ? 'Paylaşılıyor...' : 'Sharing...'}</>
                  : (lang === 'tr'
                      ? `✅ Onayla ve ${connectedSelected.length} Platformda Paylaş`
                      : `✅ Confirm and Share on ${connectedSelected.length} Platform${connectedSelected.length > 1 ? 's' : ''}`)}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: done ── */}
        {step === 'done' && (
          <div className="p-6 flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              📊 {lang === 'tr' ? 'Paylaşım Sonuçları' : 'Share Complete'}
            </h3>
            <div className="flex flex-col gap-3">
              {results.map((r, i) => {
                const p = PLATFORMS.find(x => x.id === r.platform);
                const errorInfo = getErrorInfo(r.platform, r.error || '');
                const platformContent = adapted[r.platform] || editText;
                return (
                  <div
                    key={i}
                    className={`rounded-xl border overflow-hidden ${
                      r.success
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700'
                        : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
                    }`}
                  >
                    <div className="flex items-start gap-3 p-3">
                      <span className="text-xl shrink-0">{r.success ? '✅' : '❌'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{p?.label || r.platform}</p>
                        {r.success ? (
                          <p className="text-xs text-green-700 dark:text-green-300">
                            {lang === 'tr' ? 'Başarıyla paylaşıldı!' : 'Successfully shared!'}
                            {r.url && <> · <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline font-medium">{lang === 'tr' ? 'Görüntüle →' : 'View →'}</a></>}
                          </p>
                        ) : (
                          <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">{errorInfo.message}</p>
                        )}
                      </div>
                    </div>
                    {/* Hata için yardım bloğu */}
                    {!r.success && (errorInfo.link || errorInfo.canCopy || errorInfo.showWebIntent || errorInfo.fixHint) && (
                      <div className="px-3 pb-3 flex flex-col gap-2 border-t border-red-200 dark:border-red-800 pt-2.5">
                        {/* Ücretsiz düzeltme ipucu */}
                        {errorInfo.fixHint && (
                          <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-2 leading-relaxed">
                            💡 {errorInfo.fixHint}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {/* ★ Web Intent — en iyi ücretsiz yol (görsel panoya kopyalanır) */}
                          {errorInfo.showWebIntent && r.platform === 'twitter' && (
                            <button
                              onClick={() => handleTwitterQuickShare(platformContent)}
                              className="flex items-center gap-1.5 text-xs bg-slate-900 hover:bg-black text-white px-3 py-1.5 rounded-lg font-semibold transition-colors"
                            >
                              🐦 {lang === 'tr'
                                ? `Twitter'da Aç${imageData ? ' + Görsel Kopyala' : ''} (Ücretsiz)`
                                : `Share on Web${imageData ? ' + Copy Image' : ''} (Free)`}
                            </button>
                          )}
                          {/* Kopyala butonu */}
                          {errorInfo.canCopy && (
                            <button
                              onClick={async () => {
                                await navigator.clipboard.writeText(platformContent);
                              }}
                              className="flex items-center gap-1.5 text-xs bg-white dark:bg-slate-700 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 px-3 py-1.5 rounded-lg font-medium transition-colors"
                            >
                              📋 {lang === 'tr' ? 'Metni Kopyala' : 'Copy Text'}
                            </button>
                          )}
                          {/* Düzeltme linki */}
                          {errorInfo.link && (
                            <a
                              href={errorInfo.link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-xs bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-ocean hover:text-ocean px-3 py-1.5 rounded-lg font-medium transition-colors"
                            >
                              🔗 {errorInfo.link.label}
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button onClick={onClose} className="w-full py-2.5 bg-ocean hover:bg-ocean-dark text-white rounded-xl text-sm font-semibold transition-colors mt-2">
              {lang === 'tr' ? 'Kapat' : 'Close'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
