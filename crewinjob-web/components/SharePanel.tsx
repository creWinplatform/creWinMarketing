'use client';
import { useState, useEffect, useCallback, useId } from 'react';
import PlatformPreview from './PlatformPreview';
import { addPost, extractPostId, makeThumbnail } from '@/lib/post-history';
import { logActivity } from '@/lib/activity-log';
import { useLang } from '@/lib/lang';
import { useDialog } from '@/components/a11y/useDialog';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';
import { compositePostImage, PLATFORM_TARGET } from '@/lib/image-composite';
import { loadPartnerLogo } from '@/lib/partner-logo';

const LOGO_KEY = 'crewinjob_brand_logo';

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
    charLabel: { tr: '2.200 karakter', en: '2,200 characters' },
    imageRatio: '1:1 · 4:5 · 9:16',
    imageRes: { tr: '1080×1080 önerilen', en: '1080×1080 recommended' },
    note: { tr: 'Caption tam gönderilir. Görsel zorunlu.', en: 'The full caption is sent. Image required.' },
  },
  {
    id: 'facebook', icon: '👥', label: 'Facebook',
    color: 'bg-blue-600',
    charLimit: 63206,
    charLabel: { tr: 'Sınırsız', en: 'Unlimited' },
    imageRatio: '1.91:1 · 1:1',
    imageRes: { tr: '1200×630 önerilen', en: '1200×630 recommended' },
    note: { tr: 'İçerik tam gönderilir.', en: 'The full content is sent.' },
  },
  {
    id: 'twitter', icon: '🐦', label: 'Twitter / X',
    color: 'bg-slate-900',
    charLimit: 280,
    charLabel: { tr: '280 karakter', en: '280 characters' },
    imageRatio: '16:9 · 1:1',
    imageRes: { tr: '1600×900 önerilen', en: '1600×900 recommended' },
    note: { tr: 'Yalnızca ilk 280 karakter paylaşılır.', en: 'Only the first 280 characters are shared.' },
  },
  {
    id: 'linkedin', icon: '💼', label: 'LinkedIn',
    color: 'bg-blue-700',
    charLimit: 3000,
    charLabel: { tr: '3.000 karakter', en: '3,000 characters' },
    imageRatio: '1.91:1 · 1:1',
    imageRes: { tr: '1200×627 önerilen', en: '1200×627 recommended' },
    note: { tr: 'İçerik tam gönderilir.', en: 'The full content is sent.' },
  },
  {
    id: 'tiktok', icon: '🎵', label: 'TikTok',
    color: 'bg-gradient-to-br from-slate-900 to-pink-500',
    charLimit: 2200,
    charLabel: { tr: '2.200 karakter', en: '2,200 characters' },
    imageRatio: '9:16',
    imageRes: { tr: '1080×1920 önerilen', en: '1080×1920 recommended' },
    note: { tr: 'Metin post (API) veya Script Modu.', en: 'Text post (API) or script mode.' },
  },
];

/**
 * Hazır (başlık/logo basılmış) görseli platform boyutuna KIRPMADAN sığdırır (letterbox).
 * Kare görseli 1.91:1'e kırpmak alt çubuğu (logo/URL) ve başlığın bir kısmını kesiyordu.
 * Boşluklar görselin bulanık/karartılmış hâliyle doldurulur. PNG base64 döndürür.
 */
async function letterboxImageForPlatform(
  imageData: string,
  imageMime: string,
  platformId: string,
): Promise<string> {
  const [targetW, targetH] = PLATFORM_TARGET[platformId] || [1200, 630];
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(imageData);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Zemin: görselin kaplayan (cover), bulanık ve koyulaştırılmış kopyası
      ctx.fillStyle = '#050b19';
      ctx.fillRect(0, 0, targetW, targetH);
      const cover = Math.max(targetW / img.width, targetH / img.height);
      const cw = img.width * cover, ch = img.height * cover;
      ctx.save();
      ctx.filter = 'blur(28px) brightness(0.45)';   // desteklenmeyen tarayıcıda yalnızca koyu kaplama kalır
      ctx.drawImage(img, (targetW - cw) / 2, (targetH - ch) / 2, cw, ch);
      ctx.restore();
      ctx.fillStyle = 'rgba(5,11,25,0.35)';
      ctx.fillRect(0, 0, targetW, targetH);

      // Görselin tamamı (contain) ortada
      const fit = Math.min(targetW / img.width, targetH / img.height);
      const fw = Math.round(img.width * fit), fh = Math.round(img.height * fit);
      ctx.drawImage(img, Math.round((targetW - fw) / 2), Math.round((targetH - fh) / 2), fw, fh);
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => resolve(imageData);
    img.src = `data:${imageMime};base64,${imageData}`;
  });
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

function getErrorInfo(platform: string, error: string, lang: 'tr' | 'en'): ErrorInfo {
  const tr = lang === 'tr';
  if (platform === 'twitter') {
    const webIntentBase: Partial<ErrorInfo> = { canCopy: true, showWebIntent: true };

    if (error === 'TWITTER_MONTHLY_LIMIT') return {
      ...webIntentBase,
      message:  tr ? '⚠️ Twitter Free tier aylık 1.500 tweet kotası dolmuş (ay başında yenilenir).' : '⚠️ The Twitter Free tier monthly quota of 1,500 tweets is used up (it resets at the start of the month).',
      fixHint:  tr ? 'Şu an için "Web\'de Paylaş" butonunu kullan — Twitter\'ı doğrudan açar. Kota bir sonraki ayın 1\'inde yenilenir. Alternatif: twitter.com/i/developer-platform → Basic plan ($100/ay, 50.000 tweet/ay).' : 'For now, use the "Open on Twitter" button — it opens Twitter directly. The quota resets on the 1st of next month. Alternative: twitter.com/i/developer-platform → Basic plan ($100/month, 50,000 tweets/month).',
      link:     { url: 'https://twitter.com/intent/tweet', label: tr ? 'Twitter\'da Manuel Paylaş' : 'Share manually on Twitter' },
    } as ErrorInfo;

    if (error === 'TWITTER_NO_CREDITS') return {
      ...webIntentBase,
      message:  tr ? 'Twitter API Free tier write kotası dolmuş veya app izinleri eksik.' : 'The Twitter API Free tier write quota is used up or the app permissions are missing.',
      fixHint:  tr ? '✅ Ücretsiz düzeltme: developer.twitter.com → Apps → App Settings → "App permissions" → "Read and Write" seç → Access Token\'ı yeniden oluştur.' : '✅ Free fix: developer.twitter.com → Apps → App Settings → "App permissions" → choose "Read and Write" → regenerate the Access Token.',
      link:     { url: 'https://developer.twitter.com/en/portal/projects-and-apps', label: tr ? 'Developer Portal\'ı Aç' : 'Open Developer Portal' },
    } as ErrorInfo;

    if (error === 'TWITTER_NO_WRITE') return {
      ...webIntentBase,
      message:  tr ? 'Uygulama yalnızca "Read" iznine sahip, "Write" izni eksik.' : 'The app only has "Read" permission; "Write" permission is missing.',
      fixHint:  tr ? '✅ Ücretsiz düzeltme: Developer Portal → App Settings → Permissions → "Read and Write" → Kaydet → Access Token\'ı yeniden oluştur.' : '✅ Free fix: Developer Portal → App Settings → Permissions → "Read and Write" → Save → regenerate the Access Token.',
      link:     { url: 'https://developer.twitter.com/en/portal/projects-and-apps', label: tr ? 'İzinleri Düzenle' : 'Edit permissions' },
    } as ErrorInfo;

    if (error === 'TWITTER_FORBIDDEN') return {
      ...webIntentBase,
      message:  tr ? 'Erişim reddedildi (403). API key veya app izni sorunu.' : 'Access denied (403). API key or app permission issue.',
      fixHint:  tr ? '✅ Ücretsiz düzeltme: App permissions "Read and Write" olduğundan emin olun, ardından Access Token\'ı yeniden oluşturun.' : '✅ Free fix: make sure App permissions is set to "Read and Write", then regenerate the Access Token.',
      link:     { url: 'https://developer.twitter.com/en/portal/projects-and-apps', label: 'Developer Portal' },
    } as ErrorInfo;

    if (error === 'TWITTER_AUTH_ERROR') return {
      ...webIntentBase,
      message:  tr ? 'Yetkilendirme hatası (401). API key/secret veya access token hatalı.' : 'Authorization error (401). The API key/secret or access token is wrong.',
      fixHint:  tr ? '.env.local dosyasındaki TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET değerlerini kontrol edin.' : 'Check the TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN and TWITTER_ACCESS_TOKEN_SECRET values in .env.local.',
      link:     { url: 'https://developer.twitter.com/en/portal/projects-and-apps', label: tr ? 'API Anahtarları' : 'API keys' },
    } as ErrorInfo;

    if (error === 'TWITTER_RATE_LIMIT') return {
      ...webIntentBase,
      message:  tr ? 'Hız limiti aşıldı (429). 15 dakika bekleyin.' : 'Rate limit exceeded (429). Wait 15 minutes.',
    } as ErrorInfo;

    if (error === 'TWITTER_DUPLICATE') return {
      canCopy: false, showWebIntent: false,
      message: tr ? 'Bu tweet daha önce paylaşıldı. Twitter aynı içeriği iki kez kabul etmiyor.' : "This tweet was already shared. Twitter doesn't accept the same content twice.",
    };
  }
  return { message: error || (tr ? 'Bilinmeyen hata.' : 'Unknown error.'), canCopy: true, showWebIntent: false };
}

interface Props {
  content:    string;
  imageData?: string;
  imageMime?: string;
  /**
   * Başlık/logo basılmamış HAM arka plan + başlık. Verilirse her platform için görsel
   * bu arka plandan, o platformun boyutunda YENİDEN basılır (kırpma yok).
   * Verilmezse hazır görsel platform boyutuna sığdırılır (letterbox).
   */
  rawBgData?: string;
  rawBgMime?: string;
  headline?:  string;
  subline?:   string;
  onClose:    () => void;
}

export default function SharePanel({ content, imageData, imageMime, rawBgData, rawBgMime, headline, subline, onClose }: Props) {
  const { lang } = useLang();
  const { titleId, dialogProps } = useDialog(true, onClose);
  const uid = useId();
  // Yeniden basım için marka/etkinlik logoları (diğer panellerle aynı localStorage kaynağı)
  const [brandLogo,   setBrandLogo]   = useState('');
  const [partnerLogo, setPartnerLogo] = useState('');
  useEffect(() => {
    try { setBrandLogo(localStorage.getItem(LOGO_KEY) || ''); } catch { /* ignore */ }
    setPartnerLogo(loadPartnerLogo().data);
  }, []);
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
  // Web Intent sonrası post URL takibi
  const [trackUrl,  setTrackUrl]  = useState('');
  const [trackSaved, setTrackSaved] = useState(false);
  // TikTok script kopyalama durumu
  const [tiktokCopied, setTiktokCopied] = useState(false);
  // Manuel kopyalama durumu (içerik + görsel)
  const [copiedText,          setCopiedText]          = useState(false);
  const [copiedImage,         setCopiedImage]         = useState(false);
  const [downloadingPlatform, setDownloadingPlatform] = useState<string | null>(null);
  // Facebook / Instagram / TikTok hızlı paylaşım durumu
  const [quickPosting, setQuickPosting] = useState<string | null>(null);
  const [quickToast,   setQuickToast]   = useState<{ show: boolean; platform: string; success: boolean; message: string; url?: string } | null>(null);

  /** Platform boyutunda görsel: ham arka plan varsa yeniden bas, yoksa sığdır (letterbox). */
  const imageForPlatform = useCallback(async (platformId: string): Promise<string> => {
    if (!imageData) return '';
    if (rawBgData && headline?.trim()) {
      try {
        return await compositePostImage(rawBgMime || 'image/jpeg', rawBgData, brandLogo, headline, platformId, partnerLogo, subline || '');
      } catch { /* sığdırmaya düş */ }
    }
    return letterboxImageForPlatform(imageData, imageMime || 'image/png', platformId);
  }, [imageData, imageMime, rawBgData, rawBgMime, headline, subline, brandLogo, partnerLogo]);

  const adaptImageForPlatform = async (platformId: string) => {
    if (!imageData) return;
    setAdaptingImg(platformId);
    try {
      const adaptedImg = await imageForPlatform(platformId);
      setAdaptedImages(prev => ({ ...prev, [platformId]: adaptedImg }));
    } finally {
      setAdaptingImg(null);
    }
  };

  /** Görseli PNG olarak panoya kopyalar; başarısız olursa indirir */
  const handleCopyImage = async () => {
    if (!imageData) return;
    try {
      const mime = imageMime || 'image/jpeg';
      const img = new Image();
      img.src = `data:${mime};base64,${imageData}`;
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('load')); });
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      cv.getContext('2d')!.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/png'));
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setCopiedImage(true);
        setTimeout(() => setCopiedImage(false), 3000);
        return;
      }
    } catch { /* clipboard API başarısız — indir */ }
    handleDownloadImage();
  };

  /** Görseli dosya olarak indirir */
  const handleDownloadImage = () => {
    if (!imageData) return;
    const mime = imageMime || 'image/jpeg';
    const ext  = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
    const link = document.createElement('a');
    link.href     = `data:${mime};base64,${imageData}`;
    link.download = `crewin-post.${ext}`;
    link.click();
  };

  /** Görseli platforma özgü boyutta (yeniden basarak / sığdırarak) indirir */
  const downloadForPlatform = async (platformId: string) => {
    if (!imageData) return;
    setDownloadingPlatform(platformId);
    try {
      const sized = adaptedImages[platformId] || await imageForPlatform(platformId);
      const link = document.createElement('a');
      link.href     = `data:image/png;base64,${sized}`;
      link.download = `crewin-${platformId}.png`;
      link.click();
    } catch {
      handleDownloadImage();
    } finally {
      setDownloadingPlatform(null);
    }
  };

  /** Başarılı API paylaşımlarını paylaşım geçmişine yazar (gerçek postId varsa onu kullanır) */
  const recordResults = async (
    rs: { platform: string; success: boolean; url?: string; postId?: string }[],
    contentFor: (platform: string) => string,
  ) => {
    const ok = rs.filter(r => r.success && (r.url || r.postId));
    if (!ok.length) return;
    const thumbnail = imageData ? await makeThumbnail(imageData, imageMime || 'image/png') : '';
    for (const r of ok) {
      const postId = r.postId || (r.url ? extractPostId(r.platform, r.url) : '') || r.url || '';
      void addPost({
        platform:    r.platform,
        postId,
        postUrl:     r.url,
        content:     contentFor(r.platform),
        thumbnail:   thumbnail || undefined,
        publishedAt: Date.now(),
      });
      const platformName = r.platform.charAt(0).toUpperCase() + r.platform.slice(1);
      logActivity('post_published', lang === 'tr' ? `${platformName}'a post yayınlandı` : `Post published on ${platformName}`, r.url);
    }
  };

  // Web Intent sonrası post URL'sini post-history'e kaydet
  const handleTrackUrl = async (platformId: string) => {
    const url = trackUrl.trim();
    if (!url) return;
    const postId = extractPostId(platformId, url) || url;
    const thumbnail = imageData ? await makeThumbnail(imageData, imageMime || 'image/png') : '';
    await addPost({ platform: platformId, postId, postUrl: url, content: editText, thumbnail: thumbnail || undefined, publishedAt: Date.now() });
    setTrackSaved(true);
    setTrackUrl('');
    setTimeout(() => setTrackSaved(false), 4000);
  };

  const handleTwitterQuickShare = async (text: string) => {
    const { imageCopied } = await shareToTwitter(text, imageData, imageMime);
    setTwToast({ show: true, imageCopied, platform: 'twitter' });
    setTrackUrl('');
    setTrackSaved(false);
  };

  const handleLinkedInQuickShare = async (text: string) => {
    const { imageCopied, textCopied } = await shareToLinkedIn(text, imageData, imageMime);
    setTwToast({ show: true, imageCopied, textCopied, platform: 'linkedin' });
    setTrackUrl('');
    setTrackSaved(false);
  };

  /** Facebook / Instagram / TikTok — direkt API üzerinden hızlı paylaşım */
  const handleQuickPost = async (platform: string, text: string, imgData?: string, imgMime?: string) => {
    setQuickPosting(platform);
    setQuickToast(null);
    try {
      // Görsel platform boyutunda gider (uyarlanmışsa o, değilse yeniden bas / sığdır)
      const platformImg = imgData ? (adaptedImages[platform] || await imageForPlatform(platform)) : undefined;
      const res = await fetch('/api/social/post', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          platforms: [platform], content: text,
          imageData: platformImg || imgData,
          imageMime: platformImg ? 'image/png' : imgMime,
        }),
      });
      const data = await res.json();
      const result = (data.results as Array<{ platform: string; success: boolean; url?: string; postId?: string; error?: string }>)?.[0];
      if (result?.success) {
        void recordResults([{ ...result, platform }], () => text);
        setQuickToast({ show: true, platform, success: true,  message: lang === 'tr' ? 'Başarıyla yayınlandı!' : 'Published successfully!', url: result.url });
      } else {
        setQuickToast({ show: true, platform, success: false, message: result?.error || (lang === 'tr' ? 'Paylaşım başarısız' : "Couldn't share the post") });
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
      // Her platform için uyarlanmış görsel — yoksa platform boyutunda yeniden bas / sığdır
      const perPlatformImageData: Record<string, string> = {};
      if (imageData) {
        await Promise.all(selected.map(async (p) => {
          perPlatformImageData[p] = adaptedImages[p] || await imageForPlatform(p);
        }));
      }
      const res = await fetch('/api/social/post', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ platforms: selected, content: editText, perPlatformContent, imageData, imageMime, perPlatformImageData }),
      });
      const data = await res.json();
      setResults(data.results || []);

      // Başarılı paylaşımları geçmişe kaydet (API'nin döndürdüğü gerçek postId öncelikli)
      await recordResults(
        (data.results || []) as { platform: string; success: boolean; url?: string; postId?: string }[],
        p => perPlatformContent[p] || editText,
      );

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
      {/* Toast'lar panelin içinde: fixed konumlu oldukları için görünüm değişmez, odak tuzağı onlara da ulaşır */}
      <div {...dialogProps} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
      {/* Web Intent Toast (Twitter + LinkedIn) */}
      {twToast.show && (
        <div role="status" className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 dark:bg-slate-700 border border-ocean shadow-2xl rounded-xl px-5 py-4 max-w-md flex items-start gap-3 animate-in fade-in slide-in-from-top duration-300">
          <span className="text-2xl shrink-0" aria-hidden="true">{twToast.platform === 'linkedin' ? '💼' : '🐦'}</span>
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
                <strong>{lang === 'tr' ? 'LinkedIn share modal açıldı:' : 'The LinkedIn share window is open:'}</strong><br />
                1️⃣ <strong>"Anyone"</strong> dropdown → <strong>creWin</strong> {lang === 'tr' ? 'şirket sayfasını seç' : 'select the company page'}<br />
                2️⃣ {lang === 'tr'
                  ? <>Metin kutusuna <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Ctrl+V</kbd> → tam metin yapışır</>
                  : <>Paste into the text box <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Ctrl+V</kbd> → the full text is pasted</>}<br />
                {twToast.imageCopied && (
                  <>3️⃣ 🖼️ {lang === 'tr' ? 'fotoğraf butonuna tıkla → indirilen görseli seç' : 'click the photo button → select the downloaded image'}<br />4️⃣ </>
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
                    Click the Twitter text area → <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Ctrl+V</kbd> (Mac: <kbd className="bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">⌘+V</kbd>) → the image is pasted → click <strong>Post</strong>.</>
                  )}
                </p>
              ) : imageData ? (
                <p className="text-xs text-amber-300 leading-relaxed">
                  {lang === 'tr'
                    ? '⚠️ Görsel panoya kopyalanamadı (tarayıcı izni). Görseli manuel olarak indirip Twitter\'a yükleyebilirsin.'
                    : "⚠️ Couldn't copy the image to the clipboard (browser permission). You can download the image and upload it to Twitter manually."}
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
          {/* Post URL takip alanı */}
          <div className="mt-3 pt-3 border-t border-slate-700 w-full">
            {trackSaved ? (
              <p className="text-xs text-green-400 font-medium">✅ {lang === 'tr' ? 'Post eklendi — Etkileşim sekmesinde takip edebilirsin.' : 'Post added — track it in the Engagement tab.'}</p>
            ) : (
              <>
                <p id={`${uid}-track`} className="text-[11px] text-slate-400 mb-1.5">
                  📊 {lang === 'tr' ? 'Paylaştıktan sonra post URL\'sini buraya yapıştır:' : 'After posting, paste the post URL here to track engagement:'}
                </p>
                <div className="flex gap-1.5">
                  <input
                    type="url"
                    value={trackUrl}
                    onChange={e => setTrackUrl(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleTrackUrl(twToast.platform); }}
                    aria-labelledby={`${uid}-track`}
                    placeholder={twToast.platform === 'twitter' ? 'https://twitter.com/.../status/...' : 'https://linkedin.com/feed/update/...'}
                    className="flex-1 text-xs bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-ocean"
                  />
                  <button
                    onClick={() => handleTrackUrl(twToast.platform)}
                    disabled={!trackUrl.trim()}
                    className="text-xs bg-ocean hover:bg-ocean-dark disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors"
                  >
                    {lang === 'tr' ? '+ Takip Et' : '+ Track'}
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => setTwToast({ show: false, imageCopied: false, platform: 'twitter' })}
            aria-label={lang === 'tr' ? 'Kapat' : 'Close'}
            className="text-slate-400 hover:text-white text-sm shrink-0 self-start"
          >✕</button>
        </div>
      )}

      {/* Quick Post Toast — Facebook / Instagram / TikTok */}
      {quickToast?.show && (
        <div
          role={quickToast.success ? 'status' : 'alert'}
          className="fixed left-1/2 -translate-x-1/2 z-[60] bg-slate-900 dark:bg-slate-700 border border-ocean shadow-2xl rounded-xl px-5 py-4 max-w-md flex items-start gap-3 animate-in fade-in slide-in-from-top duration-300"
          style={{ top: twToast.show ? '6rem' : '1.5rem' }}
        >
          <span className="text-2xl shrink-0" aria-hidden="true">
            {quickToast.platform === 'facebook' ? '👥' : quickToast.platform === 'instagram' ? '📸' : '🎵'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white mb-1">
              {quickToast.platform === 'facebook' ? 'Facebook' : quickToast.platform === 'instagram' ? 'Instagram' : 'TikTok'}
              {' '}{quickToast.success
                ? (lang === 'tr' ? '— Yayınlandı! 🎉' : '— Published! 🎉')
                : (lang === 'tr' ? '— Paylaşım Başarısız' : "— Couldn't share")}
            </p>
            {quickToast.success ? (
              quickToast.url ? (
                <p className="text-xs text-green-300 leading-relaxed">
                  {lang === 'tr' ? '✅ İçerik başarıyla yayınlandı.' : '✅ Content published successfully.'}{' '}
                  <a href={quickToast.url} target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-green-200">
                    {lang === 'tr' ? 'Gönderiyi görüntüle →' : 'View post →'}
                  </a>
                </p>
              ) : (
                <p className="text-xs text-green-300">
                  {lang === 'tr' ? '✅ İçerik başarıyla yayınlandı.' : '✅ Content published successfully.'}
                </p>
              )
            ) : (
              <p className="text-xs text-red-300 leading-relaxed"><Msg text={quickToast.message} /></p>
            )}
          </div>
          <button
            onClick={() => setQuickToast(prev => prev ? { ...prev, show: false } : null)}
            aria-label={lang === 'tr' ? 'Kapat' : 'Close'}
            className="text-slate-600 hover:text-white text-sm shrink-0"
          >✕</button>
        </div>
      )}

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-3">
            <span className="text-xl" aria-hidden="true">📤</span>
            <div>
              <h2 id={titleId} className="font-bold text-slate-800 dark:text-slate-100">
                {lang === 'tr' ? 'Paylaşım Onayı' : 'Share approval'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === 'tr' ? 'Platform seç, içeriği gözden geçir, onayla' : 'Select platforms, review the content, confirm'}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label={lang === 'tr' ? 'Kapat' : 'Close'} title={lang === 'tr' ? 'Kapat' : 'Close'} className="text-slate-600 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none">✕</button>
        </div>

        {/* ── STEP: select ── */}
        {step === 'select' && (
          <div className="p-6 flex flex-col gap-6">

            {/* ── Manuel Kopyala — Her zaman görünür, platform bağlantısı gerekmez ── */}
            <div className="bg-gradient-to-br from-slate-50 to-blue-50/40 dark:from-slate-700/60 dark:to-blue-900/20 border border-slate-200 dark:border-slate-600 rounded-xl p-4 flex flex-col gap-3">

              {/* Başlık */}
              <div className="flex items-center gap-2">
                <span className="text-base" aria-hidden="true">📋</span>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {lang === 'tr' ? 'İçeriği & Görseli Kopyala' : 'Copy content & image'}
                </h3>
                <span className="ml-auto text-[10px] text-slate-600 dark:text-slate-400">
                  {lang === 'tr' ? 'Platform bağlantısı gerekmez' : 'No platform connection needed'}
                </span>
              </div>

              {/* Ana aksiyonlar — her zaman görünür */}
              <div className="flex gap-2 flex-wrap">
                {/* İçeriği Kopyala */}
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(editText);
                      setCopiedText(true);
                      setTimeout(() => setCopiedText(false), 3000);
                    } catch { /* ignore */ }
                  }}
                  className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl transition-all ${
                    copiedText
                      ? 'bg-green-500 text-white'
                      : 'bg-ocean hover:bg-ocean-dark text-white'
                  }`}
                >
                  {copiedText
                    ? (lang === 'tr' ? '✅ Kopyalandı!' : '✅ Copied!')
                    : (lang === 'tr' ? '📋 İçeriği Kopyala' : '📋 Copy content')}
                </button>

                {/* Görseli Kopyala — her zaman göster, görsel yoksa devre dışı */}
                <button
                  onClick={imageData ? handleCopyImage : undefined}
                  disabled={!imageData}
                  title={!imageData
                    ? (lang === 'tr' ? 'Görsel bulunamadı — önce görsel oluşturun' : 'No image found — generate an image first')
                    : (lang === 'tr' ? 'Görseli PNG olarak panoya kopyalar (desteklenmiyorsa indirir)' : 'Copies the image to the clipboard as PNG (downloads it if not supported)')}
                  className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl transition-all ${
                    !imageData
                      ? 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-400 cursor-not-allowed'
                      : copiedImage
                        ? 'bg-green-500 text-white'
                        : 'bg-purple-600 hover:bg-purple-700 text-white'
                  }`}
                >
                  {copiedImage
                    ? (lang === 'tr' ? '✅ Kopyalandı!' : '✅ Copied!')
                    : (lang === 'tr' ? '🖼️ Görseli Kopyala' : '🖼️ Copy image')}
                </button>

                {/* Görseli İndir — her zaman göster */}
                <button
                  onClick={imageData ? handleDownloadImage : undefined}
                  disabled={!imageData}
                  title={!imageData
                    ? (lang === 'tr' ? 'Görsel bulunamadı — önce görsel oluşturun' : 'No image found — generate an image first')
                    : (lang === 'tr' ? 'Orijinal görseli indir' : 'Download the original image')}
                  className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl transition-all ${
                    !imageData
                      ? 'border border-slate-200 dark:border-slate-600 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                      : 'border border-slate-300 dark:border-slate-500 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600'
                  }`}
                >
                  ⬇️ {lang === 'tr' ? 'Görseli İndir' : 'Download image'}
                </button>
              </div>

              {/* Platform boyutlarında indirme — görsel varsa göster */}
              {imageData && (
                <div className="border-t border-slate-200 dark:border-slate-600 pt-3 flex flex-col gap-2">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    📐 {lang === 'tr' ? 'Platform Boyutunda İndir' : 'Download in platform size'}
                  </p>
                  <div className="flex gap-1.5 flex-wrap">
                    {([
                      { id: 'instagram', icon: '📸', label: 'Instagram',  dim: '1080×1080', ratio: '1:1'    },
                      { id: 'facebook',  icon: '👥', label: 'Facebook',   dim: '1200×630',  ratio: '1.91:1' },
                      { id: 'linkedin',  icon: '💼', label: 'LinkedIn',   dim: '1200×627',  ratio: '1.91:1' },
                      { id: 'twitter',   icon: '🐦', label: 'Twitter/X',  dim: '1200×675',  ratio: '16:9'   },
                      { id: 'tiktok',    icon: '🎵', label: 'TikTok',     dim: '1080×1920', ratio: '9:16'   },
                    ] as const).map(p => (
                      <button
                        key={p.id}
                        onClick={() => downloadForPlatform(p.id)}
                        disabled={downloadingPlatform === p.id}
                        title={`${p.label} — ${p.dim} (${p.ratio})`}
                        className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-ocean hover:text-ocean dark:hover:border-ocean dark:hover:text-ocean bg-white dark:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-wait"
                      >
                        {downloadingPlatform === p.id
                          ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" />
                          : <span>{p.icon}</span>}
                        <span>{p.label}</span>
                        <span className="text-slate-600 dark:text-slate-400 font-normal">{p.dim}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-600 dark:text-slate-400">
                    {rawBgData && headline
                      ? (lang === 'tr'
                          ? 'Görsel her platform için aynı arka plan ve başlıkla, o platformun boyutunda yeniden basılır.'
                          : 'The image is re-rendered at each platform\'s size with the same background and headline.')
                      : (lang === 'tr'
                          ? 'Görsel kırpılmadan platform boyutuna sığdırılır (kenarlar bulanık zeminle doldurulur).'
                          : 'The image is fitted to each platform size without cropping (edges filled with a blurred backdrop).')}
                  </p>
                </div>
              )}

              {/* LinkedIn adım adım kılavuz */}
              {imageData && (
                <div className="border-t border-slate-200 dark:border-slate-600 pt-2.5">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    💼 <strong className="text-slate-600 dark:text-slate-300">LinkedIn:</strong>{' '}
                    {lang === 'tr' ? (
                      <>1️⃣ <em>İçeriği Kopyala</em> → 2️⃣ LinkedIn&apos;i aç → <kbd className="bg-slate-200 dark:bg-slate-600 px-1 py-0.5 rounded text-[10px] font-mono">Ctrl+V</kbd> → 3️⃣ <strong>LinkedIn 1200×627</strong> indir → 🖼️ yükle → 4️⃣ <strong>Paylaş</strong></>
                    ) : (
                      <>1️⃣ <em>Copy content</em> → 2️⃣ Open LinkedIn → <kbd className="bg-slate-200 dark:bg-slate-600 px-1 py-0.5 rounded text-[10px] font-mono">Ctrl+V</kbd> → 3️⃣ Download <strong>LinkedIn 1200×627</strong> → upload 🖼️ → 4️⃣ <strong>Post</strong></>
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* Platform listesi */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  📱 {lang === 'tr' ? 'Platform Seç' : 'Select platforms'}
                </h3>
                {connectedPlatforms.length > 0 && !loading && (
                  <button
                    onClick={selectAll}
                    className="text-xs font-medium text-ocean hover:text-ocean-dark border border-ocean/30 hover:border-ocean/60 rounded-lg px-3 py-1 transition-colors"
                  >
                    {allConnectedSelected
                      ? (lang === 'tr' ? '☐ Tümünü Kaldır' : '☐ Deselect all')
                      : (lang === 'tr' ? '☑ Tümünü Seç' : '☑ Select all')}
                  </button>
                )}
              </div>

              {loading ? (
                <div className="flex items-center gap-2 text-slate-600 text-sm">
                  <div className="w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                  {lang === 'tr' ? 'Bağlantı durumları kontrol ediliyor…' : 'Checking connection status…'}
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
                              aria-labelledby={`${uid}-${p.id}`}
                              className="w-4 h-4 accent-ocean cursor-pointer shrink-0"
                            />
                          )}
                          <span className="text-xl shrink-0" aria-hidden="true">{p.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p id={`${uid}-${p.id}`} className="text-sm font-medium text-slate-800 dark:text-slate-100">{p.label}</p>
                            {isConnected ? (
                              <p className="text-xs text-green-600 truncate">
                                ✅ {s.username || (lang === 'tr' ? 'Bağlı' : 'Connected')}
                              </p>
                            ) : s?.expired ? (
                              <p className="text-xs text-orange-500">⚠️ {lang === 'tr' ? 'Token süresi doldu' : 'Token expired'}</p>
                            ) : notConfigured ? (
                              <p className="text-xs text-slate-600 dark:text-slate-400">
                                {lang === 'tr' ? 'API key eksik' : 'API key missing'}
                              </p>
                            ) : p.id === 'tiktok' ? (
                              <p className="text-xs text-pink-500 dark:text-pink-400">🎵 {lang === 'tr' ? 'Script Modu' : 'Script mode'}</p>
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
                              className="text-xs text-slate-600 hover:text-ocean shrink-0 transition-colors"
                              title={lang === 'tr' ? 'Bu platformda nasıl görünür?' : 'How will it look on this platform?'}
                              aria-label={lang === 'tr' ? `${p.label}: bu platformda nasıl görünür?` : `${p.label}: how will it look on this platform?`}
                              aria-expanded={isPreview}
                            >
                              <span aria-hidden="true">{isPreview ? '▲' : '👁'}</span>
                            </button>
                          )}
                        </div>

                        {/* ── Instagram no-image warning ── */}
                        {p.id === 'instagram' && isSelected && !imageData && (
                          <div className="mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg p-2.5 flex items-start gap-2">
                            <span className="text-sm shrink-0" aria-hidden="true">⚠️</span>
                            <div>
                              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                                {lang === 'tr' ? 'Görsel zorunlu!' : 'Image required'}
                              </p>
                              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 leading-relaxed">
                                {lang === 'tr'
                                  ? <>Instagram API'si görsel olmadan post kabul etmez — paylaşım başarısız olur.
                                    OutputPanel'den <strong>✨ Görsel Oluştur</strong>'u kullanın veya İçerik Kütüphanesi'nden görsellendirilmiş bir içerik seçin.</>
                                  : <>The Instagram API doesn't accept posts without an image — the share will fail.
                                    Use <strong>✨ Generate image</strong> in the output panel or pick content with an image from the content library.</>}
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
                                  ? (lang === 'tr' ? 'Görsel panoya kopyalanır + Twitter açılır → Ctrl+V yapıştır → Post' : 'The image is copied to the clipboard and Twitter opens → paste with Ctrl+V → Post')
                                  : (lang === 'tr' ? 'Twitter\'ı açar, metin hazır gelir' : 'Opens Twitter with the text pre-filled')}
                                className="w-full text-xs bg-slate-800 hover:bg-black text-white px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5"
                              >
                                {lang === 'tr'
                                  ? `🐦 Twitter'da Hızlı Paylaş${imageData ? ' +🖼️' : ''}`
                                  : `🐦 Quick share on Twitter${imageData ? ' +🖼️' : ''}`}
                              </button>
                            )}

                            {/* LinkedIn — Web Intent (metin hazır gelir, şirket sayfasını kullanıcı seçer) */}
                            {p.id === 'linkedin' && (
                              <button
                                onClick={() => handleLinkedInQuickShare(adapted[p.id] || editText)}
                                title={imageData
                                  ? (lang === 'tr' ? 'Görsel panoya kopyalanır + LinkedIn açılır → şirket sayfasını seç → Ctrl+V görsel → Paylaş' : 'The image is copied and LinkedIn opens → select the company page → Ctrl+V the image → Share')
                                  : (lang === 'tr' ? 'LinkedIn açılır, metin hazır gelir → şirket sayfasını seç → Paylaş' : 'LinkedIn opens with the text ready → select the company page → Share')}
                                className="w-full text-xs bg-blue-700 hover:bg-blue-800 text-white px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5"
                              >
                                {lang === 'tr'
                                  ? `💼 Şirket Sayfasında Paylaş${imageData ? ' +🖼️' : ''}`
                                  : `💼 Share on company page${imageData ? ' +🖼️' : ''}`}
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
                                  ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Yayınlanıyor…' : 'Publishing…'}</>
                                  : <>👥 {lang === 'tr' ? `Sayfada Hızlı Yayınla${imageData ? ' +🖼️' : ''}` : `Quick publish to page${imageData ? ' +🖼️' : ''}`}</>}
                              </button>
                            )}

                            {/* Instagram — API Quick Post (statik token, görsel zorunlu) */}
                            {p.id === 'instagram' && status[p.id]?.configured && (
                              <button
                                onClick={() => imageData ? handleQuickPost('instagram', adapted['instagram'] || editText, imageData, imageMime) : undefined}
                                disabled={!imageData || quickPosting === 'instagram'}
                                title={!imageData ? (lang === 'tr' ? 'Instagram paylaşımı için görsel zorunlu' : 'An image is required to share on Instagram') : undefined}
                                className={`w-full text-xs px-3 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 ${
                                  imageData
                                    ? 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white disabled:opacity-50'
                                    : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-400 cursor-not-allowed'
                                }`}
                              >
                                {quickPosting === 'instagram'
                                  ? <><span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Yayınlanıyor…' : 'Publishing…'}</>
                                  : imageData
                                    ? <>📸 {lang === 'tr' ? 'Instagram\'da Yayınla +🖼️' : 'Publish on Instagram +🖼️'}</>
                                    : <>📸 {lang === 'tr' ? 'Instagram\'da Yayınla (Görsel Gerekli)' : 'Publish on Instagram (image required)'}</>}
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
                                      : (lang === 'tr' ? '📋 Scripti Kopyala' : '📋 Copy script')}
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
                                      ? <><span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Yayınlanıyor…' : 'Publishing…'}</>
                                      : <>🎵 {lang === 'tr' ? 'TikTok\'ta Otomatik Yayınla' : 'Auto-publish on TikTok'}</>}
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
                                <span className="text-[10px] text-slate-600 dark:text-slate-400">
                                  📐 <span className="font-medium text-slate-500 dark:text-slate-400">{p.imageRatio}</span>
                                </span>
                                <span className={`text-[10px] font-medium ${(adapted[p.id] ?? editText).length > p.charLimit ? 'text-orange-500' : 'text-slate-600 dark:text-slate-400'}`}>
                                  ✏️ {p.charLabel[lang]}
                                  {(adapted[p.id] ?? editText).length > p.charLimit && ` (${(adapted[p.id] ?? editText).length - p.charLimit} ${lang === 'tr' ? 'fazla' : 'over'})`}
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
                                    ? <><span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Uyarlanıyor…' : 'Adapting…'}</>
                                    : adapted[p.id]
                                      ? (lang === 'tr' ? '✅ Yeniden Uyarla' : '✅ Adapt again')
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
                                      ? <><span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" /> {lang === 'tr' ? 'Uyarlanıyor…' : 'Adapting…'}</>
                                      : adaptedImages[p.id]
                                        ? (lang === 'tr' ? '🖼️ Görsel Uyarlandı' : '🖼️ Image adapted')
                                        : (lang === 'tr' ? '🖼️ Görseli Uyarla' : '🖼️ Adapt image')}
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
                              {adapted[p.id] || editText}
                            </p>
                            {editText.length > p.charLimit && (
                              <p className="text-[10px] text-orange-500 mt-1">⚠️ {p.note[lang]}</p>
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
                  <strong>⚙️ {lang === 'tr' ? 'API Key Gerekli' : 'API key required'}:</strong> {lang === 'tr' ? '.env.local dosyasına platform API anahtarlarını ekleyin.' : 'Add platform API keys to your .env.local file.'}{' '}
                  <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">TWITTER_CLIENT_ID</code>,{' '}
                  <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">LINKEDIN_CLIENT_ID</code>,{' '}
                  <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">FACEBOOK_APP_ID</code>
                </div>
              )}

            </div>

            {/* İçerik düzenleme */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 id={`${uid}-content`} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  ✏️ {lang === 'tr' ? 'İçerik (Düzenleyebilirsiniz)' : 'Content (editable)'}
                </h3>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  editText.length > 280
                    ? 'bg-orange-100 dark:bg-orange-900/20 text-orange-600 dark:text-orange-300'
                    : 'bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-300'
                }`}>
                  {editText.length.toLocaleString(localeTag(lang))} {lang === 'tr' ? 'karakter' : 'characters'}
                </span>
              </div>
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={8}
                aria-labelledby={`${uid}-content`}
                className="w-full border border-slate-200 dark:border-slate-600 rounded-xl px-4 py-3 text-sm text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-ocean/50 resize-none leading-relaxed"
              />
              <div className="flex gap-4 mt-1.5 flex-wrap">
                {PLATFORMS.map(p => (
                  <span key={p.id} className={`text-[11px] ${editText.length > p.charLimit ? 'text-orange-500 font-medium' : 'text-slate-600 dark:text-slate-400'}`}>
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
                      <p key={p.id} className="text-slate-600 dark:text-slate-400">{p.icon} {p.label}: {p.imageRes[lang]}</p>
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
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> {lang === 'tr' ? 'İçerik uyarlanıyor…' : 'Adapting content…'}</>
                ) : connectedSelected.length > 0
                  ? (lang === 'tr' ? `${connectedSelected.length} Platformda Önizle →` : `Preview on ${connectedSelected.length} platform${connectedSelected.length > 1 ? 's' : ''} →`)
                  : (lang === 'tr' ? 'Platform Seç' : 'Select platforms')}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: confirm ── */}
        {step === 'confirm' && (
          <div className="p-6 flex flex-col gap-5">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 flex gap-3">
              <span className="text-2xl" aria-hidden="true">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  {lang === 'tr' ? 'Paylaşım Onayı' : 'Share confirmation'}
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  {lang === 'tr' ? (
                    <>Aşağıdaki içerik <strong>{connectedSelected.map(id => PLATFORMS.find(x => x.id === id)?.label).join(', ')}</strong> hesaplarınızda yayınlanacak.
                    Bu işlem geri alınamaz.</>
                  ) : (
                    <>The content below will be published on your <strong>{connectedSelected.map(id => PLATFORMS.find(x => x.id === id)?.label).join(', ')}</strong> accounts.
                    This can't be undone.</>
                  )}
                </p>
              </div>
            </div>

            {/* Per-platform preview */}
            <div className="flex flex-col gap-3">
              {connectedSelected.map(id => {
                const p            = PLATFORMS.find(x => x.id === id)!;
                const finalContent = adapted[id] || editText;
                const isAIAdapted  = !!adapted[id];
                return (
                  <div key={id} className="bg-slate-50 dark:bg-slate-700 rounded-xl border border-slate-200 dark:border-slate-600 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-600 border-b border-slate-200 dark:border-slate-500 flex-wrap">
                      <span aria-hidden="true">{p.icon}</span>
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{p.label}</span>
                      <span className="text-[10px] text-slate-600 dark:text-slate-400 ml-1">
                        {finalContent.length} {lang === 'tr' ? 'karakter' : 'characters'}
                      </span>
                      {isAIAdapted  && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">🤖 {lang === 'tr' ? 'AI Uyarlandı' : 'AI adapted'}</span>}
                      {!isAIAdapted && <span className="text-[10px] text-green-600 font-medium">✓ {lang === 'tr' ? 'Tam içerik' : 'Full content'}</span>}
                      <span className="text-[10px] text-slate-600">📐 {p.imageRatio}</span>
                      <button
                        onClick={() => setConfirmPreview(confirmPreview === id ? null : id)}
                        aria-expanded={confirmPreview === id}
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
                <span className="text-xl shrink-0" aria-hidden="true">⚠️</span>
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    {lang === 'tr' ? 'Instagram — Görsel eksik!' : 'Instagram — image missing'}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">
                    {lang === 'tr'
                      ? 'Instagram API\'si görsel olmadan post göndermeyi reddeder — Instagram paylaşımı başarısız olacaktır. Devam etmek için geri dönüp Instagram\'ı kaldırın ya da önce bir görsel oluşturun.'
                      : 'The Instagram API rejects posts without an image — the Instagram share will fail. Go back and remove Instagram, or generate an image first.'}
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
                  ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> {lang === 'tr' ? 'Paylaşılıyor…' : 'Sharing…'}</>
                  : (lang === 'tr'
                      ? `✅ Onayla ve ${connectedSelected.length} Platformda Paylaş`
                      : `✅ Confirm and share on ${connectedSelected.length} platform${connectedSelected.length > 1 ? 's' : ''}`)}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: done ── */}
        {step === 'done' && (
          <div className="p-6 flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              📊 {lang === 'tr' ? 'Paylaşım Sonuçları' : 'Share results'}
            </h3>
            <div className="flex flex-col gap-3">
              {results.map((r, i) => {
                const p = PLATFORMS.find(x => x.id === r.platform);
                const errorInfo = getErrorInfo(r.platform, r.error || '', lang);
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
                      <span className="text-xl shrink-0" aria-hidden="true">{r.success ? '✅' : '❌'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{p?.label || r.platform}</p>
                        {r.success ? (
                          <p className="text-xs text-green-700 dark:text-green-300">
                            {lang === 'tr' ? 'Başarıyla paylaşıldı!' : 'Shared successfully!'}
                            {r.url && <> · <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline font-medium">{lang === 'tr' ? 'Görüntüle →' : 'View →'}</a></>}
                          </p>
                        ) : (
                          <p role="alert" className="text-xs text-red-700 dark:text-red-300 mt-0.5"><Msg text={errorInfo.message} /></p>
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
                                : `Open on Twitter${imageData ? ' + copy image' : ''} (free)`}
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
                              📋 {lang === 'tr' ? 'Metni Kopyala' : 'Copy text'}
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
