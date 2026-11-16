'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Download, ImagePlus, Loader2, Save, Trash2 } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { BRAND_FONTS, FONT_LABELS, HIGHLIGHT_SIZE, LOGO_MAX_BYTES, PROFILE_SIZES, contrast, sizeName, type BrandKit, type BrandKitInput, type BrandLogo, type DesignSize } from '@/lib/platform/brand-kit-types';
import { EMPTY_CONTENT, type DesignOptions, type DesignTemplate } from '@/lib/platform/design-layout';
import { zipStore } from '@/lib/platform/zip-store';
import { canvasBytes, drawDesign, exportDesign, fontsReady, loadImage, saveFile, slug, toBase64 } from './design/render';
import { useBrandKit } from './design/useBrandKit';

type Item = { key: string; size: DesignSize; template: DesignTemplate; label?: string };
// YouTube shows only the centre 1546×423 of the 2560×1440 banner on every device; Facebook crops the cover's sides on phones.
const SAFE: Record<string, DesignOptions['safe']> = {
  'yt-banner': { x: 507, y: 508, w: 1546, h: 423 },
  'fb-cover': { x: 220, y: 90, w: 1200, h: 444 },
  'li-cover': { x: 420, y: 30, w: 650, h: 131 },
  'x-header': { x: 120, y: 90, w: 1260, h: 320 },
};

// Project settings → Brand kit: logo, colours, font, handle and tagline used by every design, plus profile pictures,
// page covers and Instagram highlight covers made from them.
export default function BrandKitPanel({ lang, projectName }: { lang: Locale; projectName: string }) {
  const tr = lang === 'tr', { kit, logo, error: loadError, setKit } = useBrandKit();
  const [form, setForm] = useState<BrandKitInput | null>(null), [newLogo, setNewLogo] = useState<BrandLogo | null | undefined>(undefined), [logoImage, setLogoImage] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [labels, setLabels] = useState(tr ? 'Hakkımızda, Ürünler, Yorumlar, Kampanyalar' : 'About, Products, Reviews, Offers');
  const thumbs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  useEffect(() => { if (kit) { setForm({ colors: kit.colors, font: kit.font, handle: kit.handle, tagline: kit.tagline }); setNewLogo(undefined); setLogoImage(logo); } }, [kit, logo]);
  const draftKit = form, canEdit = Boolean(kit?.canEdit);
  const items: Item[] = useMemo(() => [
    ...PROFILE_SIZES.map(size => ({ key: size.id, size, template: (size.id === 'avatar' ? 'avatar' : 'cover') as DesignTemplate })),
    ...labels.split(',').map(label => label.trim()).filter(Boolean).slice(0, 8).map((label, index) => ({ key: `highlight-${index}`, size: HIGHLIGHT_SIZE, template: 'highlight' as DesignTemplate, label })),
  ], [labels]);
  const optionsFor = (item: Item): DesignOptions | null => draftKit ? { template: item.template, w: item.size.w, h: item.size.h, kit: draftKit, hasLogo: Boolean(logoImage), hasPhoto: false, theme: item.template === 'highlight' ? 'light' : 'primary', safe: SAFE[item.size.id] } : null;
  const contentFor = (item: Item) => ({ ...EMPTY_CONTENT, headline: item.template === 'highlight' ? item.label || '' : item.template === 'avatar' ? draftKit?.handle || projectName : draftKit?.tagline || projectName, body: item.template === 'cover' && draftKit?.handle ? draftKit.handle : '' });

  useEffect(() => {
    if (!draftKit || !Object.values(draftKit.colors).every(value => /^#[0-9a-f]{6}$/i.test(value))) return;
    const timer = setTimeout(async () => {
      await fontsReady(draftKit.font);
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      for (const item of items) { const canvas = thumbs.current.get(item.key), o = optionsFor(item); if (canvas && o) drawDesign(canvas, contentFor(item), o, { logo: logoImage, photo: null }, Math.min(1, (240 * ratio) / Math.max(item.size.w, item.size.h))); }
    }, 150);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKit, logoImage, items]);

  // A logo is scaled down to at most 800 px and stored as PNG (WebP if PNG is still too large), keeping transparency.
  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) { setError(tr ? 'En fazla 10 MB bir görsel seçin.' : 'Choose an image of at most 10 MB.'); return; }
    const url = URL.createObjectURL(file);
    try {
      const image = await loadImage(url), iw = image.naturalWidth || 800, ih = image.naturalHeight || 800, scale = Math.min(1, 800 / Math.max(iw, ih)), canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(iw * scale)); canvas.height = Math.max(1, Math.round(ih * scale));
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      let bytes = await canvasBytes(canvas, 'image/png'), mime: BrandLogo['mime'] = 'image/png';
      if (bytes.length > LOGO_MAX_BYTES) { const webp = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.9)); if (webp?.type === 'image/webp') { bytes = new Uint8Array(await webp.arrayBuffer()); mime = 'image/webp'; } }
      if (bytes.length > LOGO_MAX_BYTES) { setError(tr ? 'Logo küçültüldükten sonra da 400 KB’ı aşıyor. Daha sade bir dosya seçin.' : 'The logo is still over 400 KB after resizing. Choose a simpler file.'); return; }
      const value = { data: toBase64(bytes), mime };
      setNewLogo(value); setLogoImage(await loadImage(`data:${mime};base64,${value.data}`)); setError('');
    } catch { setError(tr ? 'Logo okunamadı.' : 'The logo could not be read.'); } finally { URL.revokeObjectURL(url); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!form || !kit || busy) return;
    setBusy('save'); setError(''); setNotice('');
    try {
      const saved = await projectRequest<BrandKit>('/api/platform/brand-kit', { method: 'PUT', body: JSON.stringify({ ...form, ...(newLogo !== undefined ? { logo: newLogo } : {}), expectedRevision: kit.revision }) });
      await setKit(saved); setNotice(tr ? 'Marka kiti kaydedildi. Yeni tasarımlar bu ayarları kullanır.' : 'Brand kit saved. New designs use these settings.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : tr ? 'Kaydedilemedi.' : 'Could not save.'); } finally { setBusy(''); }
  };
  const download = async (only?: Item) => {
    if (!draftKit || busy) return;
    setBusy(only ? only.key : 'zip'); setError('');
    try {
      const files: { name: string; data: Uint8Array }[] = [];
      for (const item of only ? [only] : items) { const o = optionsFor(item); if (o) files.push({ name: `${item.template === 'highlight' ? `one-cikan-${slug(item.label || '')}` : item.size.id}-${item.size.w}x${item.size.h}.png`, data: await exportDesign(contentFor(item), o, { logo: logoImage, photo: null }, 'image/png') }); }
      if (only) saveFile(files[0].data, files[0].name, 'image/png'); else saveFile(zipStore(files), `${slug(projectName)}-profil-kapak.zip`, 'application/zip');
    } catch { setError(tr ? 'Görseller hazırlanamadı.' : 'The images could not be prepared.'); } finally { setBusy(''); }
  };

  if (!kit || !form) return loadError ? <p className="studio-error" role="alert">{loadError}</p> : <p className="studio-note" role="status">{tr ? 'Marka kiti yükleniyor…' : 'Loading the brand kit…'}</p>;
  const color = (key: keyof BrandKitInput['colors'], label: string, hint: string) => <label className="brand-color">
    <span>{label}<small>{hint}</small></span>
    <span className="brand-color-input"><input type="color" value={form.colors[key]} disabled={!canEdit} aria-label={`${label} ${tr ? 'renk seçici' : 'colour picker'}`} onChange={event => setForm({ ...form, colors: { ...form.colors, [key]: event.target.value } })} />
      <input value={form.colors[key]} disabled={!canEdit} maxLength={7} pattern="#[0-9a-fA-F]{6}" aria-label={`${label} hex`} onChange={event => setForm({ ...form, colors: { ...form.colors, [key]: event.target.value } })} /></span>
  </label>;
  const validHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value), allValid = Object.values(form.colors).every(validHex);
  const weakAccent = allValid && contrast(form.colors.accent, form.colors.primary) < 1.8, weakText = allValid && contrast(form.colors.dark, form.colors.light) < 4.5;
  return (
    <section className="brand-kit" aria-labelledby="brand-kit-title">
      <div className="studio-section-title"><h2 id="brand-kit-title">{tr ? 'Marka kiti' : 'Brand kit'}</h2>
        <p className="studio-note">{tr ? 'Tasarım stüdyosu (taslaklarda “Şablonla görsel”, Reklamlar’da banner seti) bu logo, renk ve yazı tipiyle çizer. Profil ve kapak görsellerini de buradan indirebilirsiniz.' : 'The design studio (“Template image” in drafts, the banner set in Ads) draws with this logo, colours and font. Profile and cover images can be downloaded here too.'}</p>
      </div>
      {loadError && <p className="studio-error" role="alert">{loadError}</p>}
      {!canEdit && !loadError && <p className="studio-note">{tr ? 'Marka kitini proje ayarlarını yöneten ekip üyeleri değiştirebilir; siz görüntüleyebilirsiniz.' : 'Team members who manage the project settings can change the brand kit; you can view it.'}</p>}
      <form className="brand-kit-form" onSubmit={save}>
        <div className="brand-logo">
          <span className="brand-logo-frame" style={{ background: form.colors.primary }}>{logoImage ? <img src={logoImage.src} alt={tr ? 'Logo' : 'Logo'} /> : <span>{tr ? 'Logo yok' : 'No logo'}</span>}</span>
          {canEdit && <div className="brand-logo-actions">
            <label className="studio-secondary design-file"><ImagePlus size={15} />{logoImage ? (tr ? 'Logoyu değiştir' : 'Change logo') : (tr ? 'Logo yükle' : 'Upload logo')}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={event => { void pickLogo(event.target.files?.[0]); event.target.value = ''; }} /></label>
            {logoImage && <button type="button" className="studio-secondary" onClick={() => { setNewLogo(null); setLogoImage(null); }}><Trash2 size={15} />{tr ? 'Logoyu kaldır' : 'Remove logo'}</button>}
            <small className="studio-note">{tr ? 'Şeffaf arka planlı PNG en iyi sonucu verir. Otomatik olarak 800 px’e küçültülür.' : 'A PNG with a transparent background works best. It is scaled to 800 px automatically.'}</small>
          </div>}
        </div>
        <div className="brand-colors">
          {color('primary', tr ? 'Marka rengi' : 'Brand colour', tr ? 'Ana arka plan' : 'Main background')}
          {color('accent', tr ? 'Vurgu rengi' : 'Accent colour', tr ? 'Buton, rakam, işaret' : 'Buttons, numbers, marks')}
          {color('dark', tr ? 'Koyu renk' : 'Dark colour', tr ? 'Açık zeminde yazı' : 'Text on light')}
          {color('light', tr ? 'Açık renk' : 'Light colour', tr ? 'Koyu zeminde yazı' : 'Text on dark')}
        </div>
        {!allValid && <p className="studio-error" role="alert">{tr ? 'Renkleri #RRGGBB biçiminde yazın (ör. #1a2b3c).' : 'Write colours as #RRGGBB (e.g. #1a2b3c).'}</p>}
        {weakAccent && <p className="studio-note">{tr ? 'Vurgu rengi marka renginden zor ayırt ediliyor; tasarımlarda işaretler yazı rengiyle çizilir.' : 'The accent is hard to tell from the brand colour; designs will draw marks in the text colour.'}</p>}
        {weakText && <p className="studio-note">{tr ? 'Koyu ve açık renk arasındaki kontrast düşük; yazılar zor okunabilir.' : 'The dark and light colours have low contrast; text may be hard to read.'}</p>}
        <div className="studio-form-grid">
          <label>{tr ? 'Yazı tipi' : 'Font'}<select value={form.font} disabled={!canEdit} onChange={event => setForm({ ...form, font: event.target.value as BrandKitInput['font'] })}>{BRAND_FONTS.map(font => <option key={font} value={font}>{FONT_LABELS[font][lang]}</option>)}</select></label>
          <label>{tr ? 'Hesap adı veya site' : 'Handle or site'}<input value={form.handle} maxLength={40} disabled={!canEdit} placeholder="@markaniz" onChange={event => setForm({ ...form, handle: event.target.value })} /></label>
          <label className="studio-form-full">{tr ? 'Kısa slogan (kapaklarda kullanılır)' : 'Short tagline (used on covers)'}<input value={form.tagline} maxLength={80} disabled={!canEdit} onChange={event => setForm({ ...form, tagline: event.target.value })} /></label>
        </div>
        {canEdit && <div className="studio-form-actions"><button className="studio-primary" disabled={Boolean(busy) || !allValid}>{busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{tr ? 'Marka kitini kaydet' : 'Save the brand kit'}</button></div>}
      </form>
      {error && <p className="studio-error" role="alert">{error}</p>}
      {notice && <p className="studio-success" role="status">{notice}</p>}

      <div className="studio-section-title brand-assets-title"><h3>{tr ? 'Profil, kapak ve öne çıkanlar' : 'Profile, covers and highlights'}</h3>
        <p className="studio-note">{tr ? 'Yukarıdaki ayarlarla hazırlanır (kaydetmeden de önizlenir). Instagram, profil fotoğrafı ve öne çıkanları API ile değiştirmeye izin vermediği için dosyaları indirip uygulamadan siz yüklersiniz.' : 'Made with the settings above (previewed before saving too). Instagram does not allow profile pictures or highlights to be changed through its API, so you download the files and upload them in the app.'}</p>
      </div>
      <label className="brand-highlights">{tr ? 'Öne çıkan başlıkları (virgülle, en çok 8)' : 'Highlight titles (comma separated, up to 8)'}<input value={labels} maxLength={200} onChange={event => setLabels(event.target.value)} /></label>
      <div className="design-actions"><button type="button" className="studio-primary" disabled={Boolean(busy) || !allValid} onClick={() => void download()}>{busy === 'zip' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}{tr ? `Hepsini indir (${items.length} görsel, ZIP)` : `Download all (${items.length} images, ZIP)`}</button></div>
      <div className="design-grid">{items.map(item => <button key={item.key} type="button" className="design-thumb" disabled={Boolean(busy) || !allValid} onClick={() => void download(item)} aria-label={`${item.label || sizeName(item.size.label, lang)} ${tr ? 'indir' : 'download'}`}>
        <span className="design-thumb-frame"><canvas ref={node => { if (node) thumbs.current.set(item.key, node); else thumbs.current.delete(item.key); }} aria-hidden="true" /></span>
        <span className="design-thumb-label"><b>{item.label || sizeName(item.size.label, lang)}</b>{item.size.w}×{item.size.h}</span>
      </button>)}</div>
    </section>
  );
}
