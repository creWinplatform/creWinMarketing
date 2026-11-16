'use client';
import { useState, type FormEvent } from 'react';
import { ImagePlus, Loader2, Package, Search, Sparkles } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import type { DesignPicture, StockImage } from '@/lib/platform/design-assets';
import { loadImage } from './render';

type Source = 'upload' | 'stock' | 'ai' | 'product';
// A product photo is scaled to at most 1024 px and sent as JPEG, so the request stays small on a phone connection.
async function productPhoto(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url), scale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    return { data: dataUrl.split(',')[1], mime: 'image/jpeg', preview: dataUrl };
  } finally { URL.revokeObjectURL(url); }
}
// Where the design's photo comes from: the person's own file, an Openverse CC0/public-domain image, or an AI image.
export default function PictureSource({ lang, aspect, onPick, onError }: {
  lang: Locale; aspect: string; onPick: (image: HTMLImageElement, credit: string) => void; onError: (message: string) => void;
}) {
  const tr = lang === 'tr';
  const [source, setSource] = useState<Source>('upload'), [query, setQuery] = useState(''), [prompt, setPrompt] = useState('');
  const [items, setItems] = useState<StockImage[] | null>(null), [busy, setBusy] = useState(''), [product, setProduct] = useState<{ data: string; mime: string; preview: string } | null>(null);
  const use = async (picture: DesignPicture) => onPick(await loadImage(`data:${picture.mime};base64,${picture.data}`), picture.credit);
  const call = async (key: string, work: () => Promise<void>) => {
    if (busy) return; setBusy(key); onError('');
    try { await work(); } catch (reason) { onError(reason instanceof Error ? reason.message : tr ? 'İstek tamamlanamadı.' : 'Request failed.'); } finally { setBusy(''); }
  };
  const search = (event: FormEvent) => { event.preventDefault(); void call('search', async () => setItems((await projectRequest<{ items: StockImage[] }>('/api/platform/design/assets', { method: 'POST', body: JSON.stringify({ action: 'stock-search', query }), signal: AbortSignal.timeout(45000) })).items)); };
  const pickStock = (item: StockImage) => call(`stock-${item.id}`, async () => use(await projectRequest<DesignPicture>('/api/platform/design/assets', { method: 'POST', body: JSON.stringify({ action: 'stock-image', id: item.id }), signal: AbortSignal.timeout(45000) })));
  const generate = (event: FormEvent) => { event.preventDefault(); void call('ai', async () => use(await projectRequest<DesignPicture>('/api/platform/design/assets', { method: 'POST', body: JSON.stringify({ action: 'ai-image', prompt, aspect, ...(source === 'product' && product ? { source: { data: product.data, mime: product.mime } } : {}) }), signal: AbortSignal.timeout(90000) }))); };
  const pickProduct = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) { onError(tr ? 'En fazla 20 MB bir ürün fotoğrafı seçin.' : 'Choose a product photo of at most 20 MB.'); return; }
    void call('product', async () => setProduct(await productPhoto(file)));
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 12 * 1024 * 1024) { onError(tr ? 'En fazla 12 MB bir görsel seçin.' : 'Choose an image of at most 12 MB.'); return; }
    void call('upload', async () => { const url = URL.createObjectURL(file); try { onPick(await loadImage(url), tr ? 'Kendi fotoğrafınız' : 'Your photo'); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); } });
  };
  return (
    <div className="picture-source">
      <div className="design-chips" role="radiogroup" aria-label={tr ? 'Fotoğraf kaynağı' : 'Photo source'}>
        {([['upload', tr ? 'Kendi fotoğrafım' : 'My photo'], ['stock', tr ? 'Stok görsel' : 'Stock image'], ['ai', tr ? 'AI ile üret' : 'Generate with AI'], ['product', tr ? 'Ürün fotoğrafından' : 'From a product photo']] as const).map(([id, label]) =>
          <button key={id} type="button" role="radio" aria-checked={source === id} className="design-chip" aria-pressed={source === id} onClick={() => setSource(id)}>{label}</button>)}
      </div>
      {source === 'upload' && <label className="studio-secondary design-file">{busy === 'upload' ? <Loader2 size={15} className="animate-spin" /> : <ImagePlus size={15} />}{tr ? 'Fotoğraf seç' : 'Choose a photo'}<input type="file" accept="image/*" onChange={event => { upload(event.target.files?.[0]); event.target.value = ''; }} /></label>}
      {source === 'stock' && <form className="picture-form" onSubmit={search}>
        <input type="search" value={query} maxLength={80} placeholder={tr ? 'Ör. kahve, ofis, deniz' : 'E.g. coffee, office, sea'} aria-label={tr ? 'Stok görsel ara' : 'Search stock images'} onChange={event => setQuery(event.target.value)} />
        <button className="studio-secondary" disabled={Boolean(busy) || query.trim().length < 2}>{busy === 'search' ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}{tr ? 'Ara' : 'Search'}</button>
        <small className="studio-note">{tr ? 'Openverse’ten yalnız ticari kullanıma serbest, atıf gerektirmeyen (CC0 ve kamu malı) görseller gelir. Arama İngilizce kelimelerle daha iyi sonuç verir.' : 'Only images free for commercial use without attribution (CC0 and public domain) come from Openverse. English words give better results.'}</small>
      </form>}
      {source === 'stock' && items && (items.length ? <div className="picture-grid">{items.map(item => <button key={item.id} type="button" className="picture-thumb" disabled={Boolean(busy)} onClick={() => void pickStock(item)} aria-label={`${item.title || (tr ? 'Görsel' : 'Image')} ${tr ? 'seç' : 'choose'}`}>
        <img src={item.thumb} alt="" />{busy === `stock-${item.id}` && <span className="picture-busy"><Loader2 size={18} className="animate-spin" /></span>}
      </button>)}</div> : <p className="studio-note">{tr ? 'Sonuç yok; başka bir kelime deneyin.' : 'No results; try another word.'}</p>)}
      {source === 'product' && <div className="picture-product">
        <label className="studio-secondary design-file">{busy === 'product' ? <Loader2 size={15} className="animate-spin" /> : <Package size={15} />}{product ? (tr ? 'Ürün fotoğrafını değiştir' : 'Change the product photo') : (tr ? 'Ürün fotoğrafı seç' : 'Choose a product photo')}<input type="file" accept="image/*" onChange={event => { pickProduct(event.target.files?.[0]); event.target.value = ''; }} /></label>
        {product && <img src={product.preview} alt={tr ? 'Ürün fotoğrafı' : 'Product photo'} className="picture-product-preview" />}
        <small className="studio-note">{tr ? 'Telefonla düz bir zeminde çekilmiş, ürünün net göründüğü bir fotoğraf en iyi sonucu verir. AI ürünü korur, yalnız arka planı, zemini ve ışığı değiştirir; yine de etiket ve yazıları kontrol edin.' : 'A clear phone photo of the product on a plain surface works best. The AI keeps the product and changes only the background, surface and light; still check labels and text.'}</small>
      </div>}
      {(source === 'ai' || (source === 'product' && product)) && <form className="picture-form" onSubmit={generate}>
        <input value={prompt} maxLength={300} placeholder={source === 'product' ? (tr ? 'Ör. mermer tezgâhta, yanında taze limonlar, sabah ışığı' : 'E.g. on a marble counter with fresh lemons, morning light') : (tr ? 'Ör. sabah ışığında masada kahve ve dizüstü bilgisayar' : 'E.g. coffee and a laptop on a desk in morning light')} aria-label={source === 'product' ? (tr ? 'Ürün hangi sahnede olsun?' : 'Which scene for the product?') : (tr ? 'Görselde ne olsun?' : 'What should the image show?')} onChange={event => setPrompt(event.target.value)} />
        <button className="studio-secondary" disabled={Boolean(busy) || prompt.trim().length < 4}>{busy === 'ai' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}{busy === 'ai' ? (tr ? 'Üretiliyor…' : 'Generating…') : (tr ? 'Üret' : 'Generate')}</button>
        <small className="studio-note">{tr ? 'Her üretim AI kotanızdan 1 kullanım düşer (başarısızsa düşmez). Görsele yazı ve logo konmaz; başlığı stüdyo ekler.' : 'Each image uses 1 from your AI quota (refunded if it fails). No text or logos are drawn in; the studio adds the headline.'}</small>
      </form>}
    </div>
  );
}
