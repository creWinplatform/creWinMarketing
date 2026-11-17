// Openverse straight from the browser, used when the server cannot reach it (Openverse limits some cloud server
// addresses; the person's own connection is not limited). Same rules as the server path: only CC0 and public-domain
// works, re-checked when one is chosen, at most 8 MB, and only JPEG, PNG or WebP bytes are used.
import type { DesignPicture, StockImage } from '@/lib/platform/design-assets';

const API = 'https://api.openverse.org/v1';
const FREE = ['cc0', 'pdm'];
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
function mimeOf(bytes: Uint8Array): DesignPicture['mime'] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}
function base64(bytes: Uint8Array) { let out = ''; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(out); }
async function image(url: string, limit: number) {
  const response = await fetch(url, { headers: { Accept: '*/*' }, cache: 'force-cache', signal: AbortSignal.timeout(20000) });
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer()), mime = mimeOf(bytes);
  return bytes.length <= limit && mime ? { bytes, mime } : null;
}

// One search request; the thumbnails load as ordinary images (lazily), so a search stays well inside Openverse's
// per-minute limit for anonymous use.
export async function browserStockSearch(query: string): Promise<StockImage[]> {
  const response = await fetch(`${API}/images/?${new URLSearchParams({ q: query.slice(0, 80), license: FREE.join(','), page_size: '12', mature: 'false' })}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('openverse');
  const results = ((await response.json()).results || []) as Record<string, unknown>[];
  return results.filter(item => typeof item.id === 'string' && /^[a-f0-9-]{36}$/.test(item.id) && FREE.includes(String(item.license))).slice(0, 12).map(item => ({
    id: item.id as string, title: clean(item.title, 120), creator: clean(item.creator, 80), license: clean(item.license, 20).toUpperCase(), source: clean(item.source, 40),
    landing: /^https:\/\//.test(String(item.foreign_landing_url)) ? String(item.foreign_landing_url).slice(0, 500) : '', width: Number(item.width) || 0, height: Number(item.height) || 0, thumb: `${API}/images/${item.id}/thumb/`,
  }));
}

export async function browserStockPicture(id: string): Promise<DesignPicture> {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Geçersiz stok görsel.');
  const meta = await fetch(`${API}/images/${id}/`, { signal: AbortSignal.timeout(20000) });
  if (!meta.ok) throw new Error('Stok görsel alınamadı. Başka bir görsel seçin.');
  const info = await meta.json() as Record<string, unknown>;
  if (!FREE.includes(String(info.license))) throw new Error('Bu görsel ticari kullanım için serbest değil.');
  const full = await image(`${API}/images/${id}/thumb/?full_size=true&compressed=false`, 8_000_000);
  if (!full) throw new Error('Stok görsel alınamadı. Başka bir görsel seçin.');
  return { data: base64(full.bytes), mime: full.mime, credit: `${clean(info.title, 80) || 'Openverse'}${info.creator ? ` · ${clean(info.creator, 60)}` : ''} · ${String(info.license).toUpperCase()} · Openverse` };
}
