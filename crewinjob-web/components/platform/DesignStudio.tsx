'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Film, ImagePlus, Layers, Loader2, Palette, Pause, Play, Plus, X } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { AD_SIZES, VIDEO_SIZES, postSizes, sizeName, type BrandKitInput, type DesignSize } from '@/lib/platform/brand-kit-types';
import { EMPTY_CONTENT, carouselSlides, type DesignContent, type DesignOptions, type DesignTemplate, type DesignTheme } from '@/lib/platform/design-layout';
import { zipStore } from '@/lib/platform/zip-store';
import { useDialog } from '@/components/a11y/useDialog';
import { drawDesign, exportDesign, loadImage, saveFile, slug, toBase64, type DesignAssets } from './design/render';
import { useBrandKit } from './design/useBrandKit';
import { StudioError, drawFrame, encodeVideo, uploadVideo, videoDuration, videoSupported } from './design/video';

type Mode = 'post' | 'ads' | 'video';
export type StudioImage = { data: string; mime: string };
const TEMPLATES: { id: DesignTemplate; tr: string; en: string; ads: boolean }[] = [
  { id: 'announce', tr: 'Duyuru', en: 'Announcement', ads: true },
  { id: 'photo', tr: 'Fotoğraf + başlık', en: 'Photo + headline', ads: true },
  { id: 'tips', tr: 'Liste / ipuçları', en: 'List / tips', ads: false },
  { id: 'stat', tr: 'Rakam / infografik', en: 'Number / infographic', ads: true },
  { id: 'quote', tr: 'Alıntı / yorum', en: 'Quote / review', ads: false },
  { id: 'event', tr: 'Etkinlik / özel gün', en: 'Event / special day', ads: true },
];
const THEMES: { id: DesignTheme; tr: string; en: string; color: (kit: BrandKitInput) => string }[] = [
  { id: 'primary', tr: 'Marka rengi', en: 'Brand colour', color: kit => kit.colors.primary },
  { id: 'light', tr: 'Açık', en: 'Light', color: kit => kit.colors.light },
  { id: 'dark', tr: 'Koyu', en: 'Dark', color: kit => kit.colors.dark },
  { id: 'accent', tr: 'Vurgu', en: 'Accent', color: kit => kit.colors.accent },
];
const MAX_DRAFT_BYTES = 5 * 1024 * 1024;

// The design studio: a template, the brand kit and the person's text become images. Post mode makes one image (or a
// carousel) for a draft; ad mode makes the same design in every ad size, downloaded as one ZIP; video mode turns the
// design (or one scene per point) into a short MP4 that Ryzevo hosts for the draft.
export default function DesignStudio({ lang, mode, channel = 'instagram', initial, maxImages = 1, onUse, onUseVideo }: {
  lang: Locale; mode: Mode; channel?: string; initial?: Partial<DesignContent>; maxImages?: number; onUse?: (images: StudioImage[]) => void; onUseVideo?: (video: { url: string }) => void;
}) {
  const tr = lang === 'tr', { kit, logo, error: kitError } = useBrandKit();
  const sizes = useMemo(() => mode === 'ads' ? AD_SIZES : mode === 'video' ? VIDEO_SIZES : postSizes(channel), [mode, channel]);
  const [template, setTemplate] = useState<DesignTemplate>('announce'), [theme, setTheme] = useState<DesignTheme>('primary');
  const [sizeId, setSizeId] = useState(sizes[0].id), [carousel, setCarousel] = useState(mode === 'video'), [slide, setSlide] = useState(0);
  const [content, setContent] = useState<DesignContent>({ ...EMPTY_CONTENT, ...initial, items: initial?.items || [] });
  const [itemsText, setItemsText] = useState((initial?.items || []).join('\n'));
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [sceneMs, setSceneMs] = useState(3000), [playing, setPlaying] = useState(true), [progress, setProgress] = useState('');
  const preview = useRef<HTMLCanvasElement>(null), thumbs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  useEffect(() => { if (!sizes.some(item => item.id === sizeId)) setSizeId(sizes[0].id); }, [sizes, sizeId]);
  const size = sizes.find(item => item.id === sizeId) || sizes[0], canCarousel = (mode === 'post' && maxImages > 1) || mode === 'video', scenes = carousel && canCarousel;
  const assets: DesignAssets = useMemo(() => ({ logo, photo }), [logo, photo]);
  const fullContent = useMemo(() => ({ ...content, items: itemsText.split('\n').map(item => item.trim()).filter(Boolean).slice(0, 6) }), [content, itemsText]);
  const slides = useMemo(() => scenes ? carouselSlides(fullContent, mode === 'video' ? 8 : maxImages) : [{ template, content: fullContent }], [scenes, fullContent, maxImages, template, mode]);
  const options = (s: DesignSize, t: DesignTemplate, index = 0): DesignOptions | null => kit ? ({ template: t, w: s.w, h: s.h, kit, hasLogo: Boolean(logo), hasPhoto: Boolean(photo), theme, slide: slides.length > 1 && mode !== 'video' ? { index, total: slides.length } : undefined }) : null;
  const current = slides[Math.min(slide, slides.length - 1)];

  // Redraw the preview (and, in ad mode, every thumbnail) a moment after the last change.
  useEffect(() => {
    if (!kit) return;
    const timer = setTimeout(() => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      if (mode === 'post' && preview.current) {
        const o = options(size, current.template, Math.min(slide, slides.length - 1));
        if (o) drawDesign(preview.current, current.content, o, assets, Math.min(1, (640 * ratio) / Math.max(size.w, size.h)));
      }
      if (mode === 'ads') for (const s of sizes) {
        const canvas = thumbs.current.get(s.id), o = options(s, template);
        if (canvas && o) drawDesign(canvas, fullContent, o, assets, Math.min(1, (200 * ratio) / Math.max(s.w, s.h)));
      }
    }, 180);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit, assets, template, theme, size, slides, slide, fullContent, mode, sizes]);
  // Video mode: the scenes are drawn once at preview size and played in a loop (paused for reduced motion).
  useEffect(() => { if (mode === 'video' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setPlaying(false); }, [mode]);
  useEffect(() => {
    if (!kit || mode !== 'video' || !preview.current) return;
    let frame = 0;
    const timer = setTimeout(() => {
      const canvas = preview.current, ratio = Math.min(2, window.devicePixelRatio || 1), scale = Math.min(1, (560 * ratio) / Math.max(size.w, size.h));
      if (!canvas) return;
      const images = slides.map((item, index) => { const c = document.createElement('canvas'), o = options(size, item.template, index); if (o) drawDesign(c, item.content, o, assets, scale); return c; });
      canvas.width = Math.round(size.w * scale); canvas.height = Math.round(size.h * scale);
      const ctx = canvas.getContext('2d'), plan = { images, w: size.w, h: size.h, sceneMs }, total = videoDuration(plan), start = performance.now();
      if (!ctx) return;
      const tick = (now: number) => { drawFrame(ctx, plan, playing ? (now - start) % total : 0, scale); if (playing) frame = requestAnimationFrame(tick); };
      frame = requestAnimationFrame(tick);
    }, 180);
    return () => { clearTimeout(timer); cancelAnimationFrame(frame); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit, assets, theme, size, slides, mode, sceneMs, playing]);

  const field = (key: keyof Omit<DesignContent, 'items'>, label: string, max: number, multiline = false, hint = '') => (
    <label className={multiline ? 'studio-form-full' : ''}>{label}{hint && <small className="studio-note">{hint}</small>}
      {multiline ? <textarea rows={3} maxLength={max} value={content[key]} onChange={event => setContent(old => ({ ...old, [key]: event.target.value }))} />
        : <input maxLength={max} value={content[key]} onChange={event => setContent(old => ({ ...old, [key]: event.target.value }))} />}
    </label>
  );
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) { setError(tr ? 'En fazla 12 MB bir görsel seçin.' : 'Choose an image of at most 12 MB.'); return; }
    const url = URL.createObjectURL(file);
    try { setPhoto(await loadImage(url)); setTemplate('photo'); setError(''); } catch { setError(tr ? 'Görsel okunamadı.' : 'Image could not be read.'); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  };
  const run = async (key: string, work: () => Promise<void>) => {
    if (busy) return; setBusy(key); setError(''); setNotice('');
    try { await work(); }
    catch (reason) {
      setProgress('');
      setError(reason instanceof StudioError ? reason.message : reason instanceof Error && reason.message === 'unsupported' ? (tr ? 'Bu tarayıcı video oluşturmayı desteklemiyor. Chrome, Edge veya güncel Safari kullanın.' : 'This browser cannot create videos. Use Chrome, Edge or a recent Safari.') : mode === 'video' ? (tr ? 'Video hazırlanamadı. Tekrar deneyin.' : 'The video could not be prepared. Try again.') : (tr ? 'Görsel hazırlanamadı. Tekrar deneyin.' : 'The image could not be prepared. Try again.'));
    } finally { setBusy(''); }
  };
  const renderSlides = async (type: 'image/png' | 'image/jpeg') => {
    const out: Uint8Array[] = [];
    for (const [index, item] of slides.entries()) { const o = options(size, item.template, index); if (o) out.push(await exportDesign(item.content, o, assets, type, 0.9)); }
    return out;
  };
  const name = slug(content.headline || content.stat || 'tasarim');
  const useInDraft = () => run('use', async () => {
    const images = await renderSlides('image/jpeg');
    if (images.reduce((sum, item) => sum + item.length, 0) > MAX_DRAFT_BYTES) { setError(tr ? 'Görseller 5 MB sınırını aşıyor; daha az slayt veya daha küçük bir boyut seçin.' : 'The images exceed 5 MB; choose fewer slides or a smaller size.'); return; }
    onUse?.(images.map(bytes => ({ data: toBase64(bytes), mime: 'image/jpeg' })));
  });
  const downloadPost = () => run('download', async () => {
    const type = photo ? 'image/jpeg' : 'image/png', ext = photo ? 'jpg' : 'png', images = await renderSlides(type);
    if (images.length === 1) saveFile(images[0], `${name}-${size.w}x${size.h}.${ext}`, type);
    else saveFile(zipStore(images.map((data, index) => ({ name: `${name}-${index + 1}.${ext}`, data }))), `${name}-carousel.zip`, 'application/zip');
  });
  // Video: every scene at full size, then the frames, the encoder and (for a draft) the upload.
  const buildVideo = async () => {
    const images = slides.map((item, index) => { const c = document.createElement('canvas'), o = options(size, item.template, index); if (o) drawDesign(c, item.content, o, assets, 1); return c; });
    return await encodeVideo({ images, w: size.w, h: size.h, sceneMs }, (done, total) => setProgress(tr ? `Video hazırlanıyor: %${Math.round((done / total) * 100)}` : `Making the video: ${Math.round((done / total) * 100)}%`));
  };
  const useVideo = () => run('video', async () => {
    const { bytes, durationMs } = await buildVideo();
    setProgress(tr ? 'Yükleniyor…' : 'Uploading…');
    const result = await uploadVideo(bytes, { width: size.w, height: size.h, durationMs }, (sent, total) => setProgress(tr ? `Yükleniyor: %${Math.round((sent / total) * 100)}` : `Uploading: ${Math.round((sent / total) * 100)}%`));
    setProgress(''); onUseVideo?.({ url: result.url });
  });
  const downloadVideo = () => run('mp4', async () => { const { bytes } = await buildVideo(); setProgress(''); saveFile(bytes, `${name}-${size.w}x${size.h}.mp4`, 'video/mp4'); });
  const downloadAds = (only?: DesignSize) => run(only ? `ad-${only.id}` : 'zip', async () => {
    const files: { name: string; data: Uint8Array }[] = [], type = photo ? 'image/jpeg' : 'image/png', ext = photo ? 'jpg' : 'png';
    for (const s of only ? [only] : sizes) { const o = options(s, template); if (o) files.push({ name: `${slug(s.group)}/${name}-${s.w}x${s.h}.${ext}`, data: await exportDesign(fullContent, o, assets, type, 0.88) }); }
    if (only) saveFile(files[0].data, files[0].name.split('/').pop()!, type);
    else { saveFile(zipStore(files), `${name}-reklam-boyutlari.zip`, 'application/zip'); setNotice(tr ? `${files.length} boyut indirildi.` : `${files.length} sizes downloaded.`); }
  });

  if (!kit) return kitError ? <p className="studio-error" role="alert">{kitError}</p> : <p className="studio-note" role="status"><Loader2 size={14} className="animate-spin inline" /> {tr ? 'Marka kiti yükleniyor…' : 'Loading the brand kit…'}</p>;
  const templates = TEMPLATES.filter(item => mode === 'post' || item.ads), show = (keys: DesignTemplate[]) => keys.includes(scenes ? 'tips' : template);
  return (
    <div className={`design-studio design-studio-${mode}`}>
      <div className="design-controls">
        {!kit.revision && <p className="studio-note design-kit-hint"><Palette size={14} /> {tr ? 'Logo ve renkleriniz için Proje ayarları → Marka kiti bölümünü doldurun; o zamana kadar varsayılan renkler kullanılır.' : 'Fill in Project settings → Brand kit for your logo and colours; until then the default colours are used.'}</p>}
        <fieldset className="design-fieldset"><legend>{tr ? 'Şablon' : 'Template'}</legend>
          <div className="design-chips">{templates.map(item => <button key={item.id} type="button" className="design-chip" aria-pressed={template === item.id && !scenes} disabled={scenes} onClick={() => setTemplate(item.id)}>{tr ? item.tr : item.en}</button>)}</div>
          {canCarousel && <label className="design-toggle"><input type="checkbox" checked={carousel} onChange={event => { setCarousel(event.target.checked); setSlide(0); }} /><Layers size={14} />{mode === 'video' ? (tr ? 'Maddeleri ayrı sahnelere böl (kapak + maddeler + kapanış, en çok 8 sahne)' : 'One scene per point (cover + points + closing, up to 8 scenes)') : tr ? `Carousel (kapak + maddeler + kapanış, en çok ${maxImages} görsel)` : `Carousel (cover + points + closing, up to ${maxImages} images)`}</label>}
        </fieldset>
        <fieldset className="design-fieldset"><legend>{tr ? 'Arka plan' : 'Background'}</legend>
          <div className="design-swatches">{THEMES.map(item => <button key={item.id} type="button" className="design-swatch" aria-pressed={theme === item.id} onClick={() => setTheme(item.id)}><span style={{ background: item.color(kit) }} aria-hidden="true" />{tr ? item.tr : item.en}</button>)}</div>
        </fieldset>
        {mode === 'video' && <label className="design-select">{tr ? 'Sahne süresi' : 'Scene length'}<select value={sceneMs} onChange={event => setSceneMs(Number(event.target.value))}>{[2000, 3000, 4000, 5000].map(ms => <option key={ms} value={ms}>{ms / 1000} {tr ? 'saniye' : 'seconds'}</option>)}</select></label>}
        {mode !== 'ads' && <label className="design-select">{tr ? 'Boyut' : 'Size'}<select value={size.id} onChange={event => setSizeId(event.target.value)}>{sizes.map(item => <option key={item.id} value={item.id}>{sizeName(item.label, lang)} · {item.w}×{item.h}</option>)}</select></label>}
        <div className="studio-form-grid design-fields">
          {field('headline', scenes ? (tr ? 'Kapak başlığı' : 'Cover headline') : template === 'quote' ? (tr ? 'Başlık (isteğe bağlı)' : 'Headline (optional)') : (tr ? 'Başlık' : 'Headline'), 120, true)}
          {(show(['announce', 'photo', 'stat', 'event', 'quote']) || carousel) && field('body', template === 'quote' && !carousel ? (tr ? 'Alıntı veya müşteri yorumu' : 'Quote or customer review') : (tr ? 'Kısa metin' : 'Short text'), 220, true)}
          {show(['tips']) && <label className="studio-form-full">{tr ? 'Maddeler (her satıra bir tane)' : 'Points (one per line)'}<textarea rows={4} maxLength={600} value={itemsText} onChange={event => setItemsText(event.target.value)} /></label>}
          {show(['stat']) && field('stat', tr ? 'Rakam' : 'Number', 12, false, tr ? 'Ör. %38, 2.400, 4,8★' : 'E.g. 38%, 2,400, 4.8★')}
          {show(['stat']) && field('statLabel', tr ? 'Rakamın açıklaması' : 'What the number means', 90)}
          {show(['event']) && field('date', tr ? 'Tarih' : 'Date', 40, false, tr ? 'Ör. 29 Ekim' : 'E.g. 29 October')}
          {show(['quote']) && field('author', tr ? 'Kimden' : 'From', 60)}
          {(show(['announce', 'photo', 'event']) || mode === 'ads' || carousel) && field('cta', tr ? 'Buton metni' : 'Button text', 28, false, tr ? 'Ör. Hemen inceleyin' : 'E.g. Take a look')}
        </div>
        {(template === 'photo' || photo) && <div className="design-photo">
          <label className="studio-secondary design-file"><ImagePlus size={15} />{photo ? (tr ? 'Fotoğrafı değiştir' : 'Change photo') : (tr ? 'Fotoğraf seç' : 'Choose a photo')}<input type="file" accept="image/*" onChange={event => { void pickPhoto(event.target.files?.[0]); event.target.value = ''; }} /></label>
          {photo && <button type="button" className="studio-secondary" onClick={() => setPhoto(null)}><X size={15} />{tr ? 'Fotoğrafı kaldır' : 'Remove photo'}</button>}
          <small className="studio-note">{tr ? 'Kendi çektiğiniz veya kullanım hakkına sahip olduğunuz bir fotoğraf kullanın.' : 'Use a photo you took or have the rights to use.'}</small>
        </div>}
      </div>
      <div className="design-preview">
        {mode === 'video' ? <>
          <canvas ref={preview} className="design-canvas" role="img" aria-label={`${tr ? 'Video önizlemesi' : 'Video preview'} ${size.w}×${size.h}`} />
          <div className="design-actions">
            <button type="button" className="studio-secondary" aria-pressed={playing} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? (tr ? 'Duraklat' : 'Pause') : (tr ? 'Oynat' : 'Play')}</button>
            <span className="studio-note">{tr ? `${slides.length} sahne · ${Math.round(videoDuration({ images: slides, sceneMs }) / 1000)} saniye · sessiz` : `${slides.length} scene(s) · ${Math.round(videoDuration({ images: slides, sceneMs }) / 1000)} seconds · no sound`}</span>
          </div>
          {!videoSupported() && <p className="studio-note">{tr ? 'Bu tarayıcı video oluşturmayı desteklemiyor. Chrome, Edge veya güncel Safari kullanın.' : 'This browser cannot create videos. Use Chrome, Edge or a recent Safari.'}</p>}
          <div className="design-actions">
            {onUseVideo && <button type="button" className="studio-primary" disabled={Boolean(busy) || !videoSupported() || !fullContent.headline.trim() && !fullContent.stat.trim()} onClick={useVideo}>{busy === 'video' ? <Loader2 size={15} className="animate-spin" /> : <Film size={15} />}{tr ? 'Videoyu oluştur ve taslağa ekle' : 'Create the video and add it to the draft'}</button>}
            <button type="button" className="studio-secondary" disabled={Boolean(busy) || !videoSupported()} onClick={downloadVideo}>{busy === 'mp4' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{tr ? 'MP4 indir' : 'Download MP4'}</button>
          </div>
          {progress && <p className="studio-note" role="status" aria-live="polite">{progress}</p>}
          <p className="studio-note">{tr ? 'Müzik eklenmez; Instagram ve TikTok uygulamasında paylaşmadan önce lisanslı müzik ekleyebilirsiniz. Taslağa eklenen videoyu Ryzevo barındırır ve ağlara imzalı bir bağlantıyla verir.' : 'No music is added; you can add licensed music in the Instagram or TikTok app before sharing. Ryzevo hosts a video added to a draft and gives the networks a signed link.'}</p>
        </> : mode === 'post' ? <>
          <canvas ref={preview} className="design-canvas" role="img" aria-label={`${tr ? 'Önizleme' : 'Preview'} ${size.w}×${size.h}`} />
          {slides.length > 1 && <div className="design-slides" role="tablist" aria-label={tr ? 'Slaytlar' : 'Slides'}>{slides.map((_, index) => <button key={index} type="button" role="tab" aria-selected={index === Math.min(slide, slides.length - 1)} onClick={() => setSlide(index)}>{index + 1}</button>)}</div>}
          <div className="design-actions">
            {onUse && <button type="button" className="studio-primary" disabled={Boolean(busy) || !fullContent.headline.trim() && !fullContent.stat.trim()} onClick={useInDraft}>{busy === 'use' ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}{slides.length > 1 ? (tr ? `${slides.length} görseli taslağa ekle` : `Add ${slides.length} images to the draft`) : (tr ? 'Taslağa ekle' : 'Add to the draft')}</button>}
            <button type="button" className="studio-secondary" disabled={Boolean(busy)} onClick={downloadPost}>{busy === 'download' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{tr ? 'İndir' : 'Download'}</button>
          </div>
        </> : <>
          <div className="design-actions design-actions-top">
            <button type="button" className="studio-primary" disabled={Boolean(busy) || !fullContent.headline.trim() && !fullContent.stat.trim()} onClick={() => downloadAds()}>{busy === 'zip' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{tr ? `${sizes.length} boyutu indir (ZIP)` : `Download ${sizes.length} sizes (ZIP)`}</button>
            <span className="studio-note">{tr ? 'Tek bir boyutu indirmek için üzerine dokunun.' : 'Tap a size to download it alone.'}</span>
          </div>
          <div className="design-grid">{sizes.map(item => <button key={item.id} type="button" className="design-thumb" disabled={Boolean(busy)} onClick={() => downloadAds(item)} aria-label={`${sizeName(item.label, lang)} ${item.w}×${item.h} ${tr ? 'indir' : 'download'}`}>
            <span className="design-thumb-frame"><canvas ref={node => { if (node) thumbs.current.set(item.id, node); else thumbs.current.delete(item.id); }} aria-hidden="true" /></span>
            <span className="design-thumb-label"><b>{item.w}×{item.h}</b>{sizeName(item.group, lang)}</span>
          </button>)}</div>
        </>}
        {error && <p className="studio-error" role="alert">{error}</p>}
        {notice && <p className="studio-success" role="status">{notice}</p>}
      </div>
    </div>
  );
}

// The studio in a modal (draft editor): full screen on phones, a wide panel on larger screens. It is rendered outside
// the draft's <form> (a portal into the workspace shell), so Enter in a studio field never submits the draft.
export function DesignStudioDialog({ open, onClose, lang, ...props }: { open: boolean; onClose: () => void; lang: Locale; mode: Mode; channel?: string; initial?: Partial<DesignContent>; maxImages?: number; onUse?: (images: StudioImage[]) => void; onUseVideo?: (video: { url: string }) => void }) {
  const { titleId, dialogProps } = useDialog(open, onClose), tr = lang === 'tr';
  useEffect(() => { if (!open) return; const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous; }; }, [open]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(<div className="design-dialog-layer">
    <button type="button" className="design-dialog-backdrop" aria-label={tr ? 'Kapat' : 'Close'} tabIndex={-1} onClick={onClose} />
    <div {...dialogProps} className="design-dialog">
      <header className="design-dialog-header"><h2 id={titleId}>{props.mode === 'video' ? (tr ? 'Şablonla video hazırla' : 'Create a video from a template') : tr ? 'Şablonla görsel hazırla' : 'Create an image from a template'}</h2><button type="button" className="icon-button" aria-label={tr ? 'Kapat' : 'Close'} onClick={onClose}><X size={18} /></button></header>
      <DesignStudio lang={lang} {...props} />
    </div>
  </div>, document.querySelector('.workspace-shell') || document.body);
}
