// Browser renderer for the design studio: measures text with canvas, draws the layout engine's operations and exports
// PNG/JPEG bytes. Nothing leaves the browser until the person adds an image to a draft or downloads it.
import { FONT_STACKS, type BrandFont } from '@/lib/platform/brand-kit-types';
import { layoutDesign, rgba, type DesignContent, type DesignOptions, type DrawOp, type Measure } from '@/lib/platform/design-layout';

export type DesignAssets = { logo: HTMLImageElement | null; photo: HTMLImageElement | null };
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('image')); image.src = src; });
}
// Waits for the kit's web font (Manrope is bundled; the other choices are system faces and resolve at once).
export async function fontsReady(font: BrandFont) {
  try { await Promise.all([800, 700, 600, 500].map(weight => document.fonts.load(`${weight} 40px ${FONT_STACKS[font]}`))); } catch { /* draw with the fallback face */ }
}
function measureWith(ctx: CanvasRenderingContext2D): Measure {
  const cache = new Map<string, number>();
  return (text, font) => { const key = font + '\u0000' + text; let width = cache.get(key); if (width === undefined) { ctx.font = font; width = ctx.measureText(text).width; cache.set(key, width); } return width; };
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.arcTo(x + w, y, x + w, y + h, radius); ctx.arcTo(x + w, y + h, x, y + h, radius); ctx.arcTo(x, y + h, x, y, radius); ctx.arcTo(x, y, x + w, y, radius); ctx.closePath();
}
function drawImageFit(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number, mode: 'cover' | 'contain', align: 'left' | 'center' | 'right' = 'center') {
  const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
  if (!iw || !ih) return;
  if (mode === 'cover') { const s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s; ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h); return; }
  const s = Math.min(w / iw, h / ih), dw = iw * s, dh = ih * s, dx = align === 'left' ? x : align === 'right' ? x + w - dw : x + (w - dw) / 2;
  ctx.drawImage(image, dx, y + (h - dh) / 2, dw, dh);
}
function draw(ctx: CanvasRenderingContext2D, ops: DrawOp[], assets: DesignAssets) {
  for (const op of ops) {
    if (op.kind === 'rect') { ctx.fillStyle = op.color; if (op.radius) { roundRect(ctx, op.x, op.y, op.w, op.h, op.radius); ctx.fill(); } else ctx.fillRect(op.x, op.y, op.w, op.h); }
    else if (op.kind === 'circle') { ctx.fillStyle = op.color; ctx.beginPath(); ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2); ctx.fill(); }
    else if (op.kind === 'photo') { if (assets.photo) drawImageFit(ctx, assets.photo, op.x, op.y, op.w, op.h, 'cover'); }
    else if (op.kind === 'shade') { const g = ctx.createLinearGradient(0, op.y, 0, op.y + op.h); g.addColorStop(0, rgba(op.color, op.from)); g.addColorStop(1, rgba(op.color, op.to)); ctx.fillStyle = g; ctx.fillRect(op.x, op.y, op.w, op.h); }
    else if (op.kind === 'logo') { if (assets.logo) drawImageFit(ctx, assets.logo, op.x, op.y, op.w, op.h, 'contain', op.align); }
    else {
      ctx.font = `${op.weight} ${op.size}px ${op.font}`; ctx.fillStyle = op.color; ctx.textBaseline = 'top'; ctx.textAlign = op.align;
      const x = op.align === 'center' ? op.x + op.w / 2 : op.align === 'right' ? op.x + op.w : op.x;
      // Line boxes are lineHeight tall; the glyphs sit centred in them, as in CSS.
      op.lines.forEach((line, index) => ctx.fillText(line, x, op.y + index * op.lineHeight + (op.lineHeight - op.size) / 2));
    }
  }
}
// Draws one design. `scale` < 1 renders a lighter preview with the same layout (text is measured at full size).
export function drawDesign(canvas: HTMLCanvasElement, content: DesignContent, options: DesignOptions, assets: DesignAssets, scale = 1) {
  canvas.width = Math.max(1, Math.round(options.w * scale)); canvas.height = Math.max(1, Math.round(options.h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  draw(ctx, layoutDesign(content, options, measureWith(ctx)), assets);
}
export function canvasBytes(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality = 0.9): Promise<Uint8Array> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => { if (!blob) { reject(new Error('export')); return; } blob.arrayBuffer().then(buffer => resolve(new Uint8Array(buffer)), reject); }, type, quality));
}
export function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
// Renders a design at full size off-screen and returns its bytes.
export async function exportDesign(content: DesignContent, options: DesignOptions, assets: DesignAssets, type: 'image/png' | 'image/jpeg', quality = 0.9) {
  const canvas = document.createElement('canvas');
  drawDesign(canvas, content, options, assets);
  const bytes = await canvasBytes(canvas, type, quality);
  canvas.width = canvas.height = 1;
  return bytes;
}
export function saveFile(bytes: Uint8Array | Blob, name: string, type: string) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type }), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const slug = (value: string) => value.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tasarim';
