import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { MarketingStoreError } from './marketing-store';

export type PublicationImage = { data: string; digest: string; width: number; height: number; bytes: number };
// Pinterest's tall pins (2:3, ratio 0.5 and up) are allowed only for Pinterest; every other channel keeps 0.8-1.91.
// Ad images (platform 'ad') also allow vertical 9:16 formats.
const ratioRange = (platform?: string) => platform === 'pinterest' || platform === 'ad' ? [0.5, 1.91] : [0.8, 1.91];
export async function normalizePublicationImages(raw: unknown, platform?: string): Promise<PublicationImage[]> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 5) throw new MarketingStoreError('1-5 gorsel secin.');
  const images: PublicationImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') throw new MarketingStoreError('Gecersiz gorsel.');
    images.push(await normalizePublicationImage(item.data, item.mime, platform));
  }
  if (images.reduce((sum, image) => sum + image.bytes, 0) > 3 * 1024 * 1024) throw new MarketingStoreError('Islenmis gorsellerin toplami en fazla 3 MB olabilir.');
  return images;
}
export async function normalizePublicationImage(data: unknown, mime: unknown, platform?: string): Promise<PublicationImage> {
  const [low, high] = ratioRange(platform);
  try {
    if (typeof data !== 'string' || data.length > 7 * 1024 * 1024 || !data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || !['image/jpeg','image/png','image/webp'].includes(String(mime))) throw new Error();
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length > 5 * 1024 * 1024 || buffer.toString('base64') !== data) throw new Error();
    const input = sharp(buffer, { limitInputPixels: 16000000, animated: false, failOn: 'warning' }), meta = await input.metadata();
    if (!['jpeg','png','webp'].includes(meta.format || '') || (meta.pages || 1) !== 1 || `image/${meta.format === 'jpeg' ? 'jpeg' : meta.format}` !== mime) throw new Error();
    const swapped = [5,6,7,8].includes(meta.orientation || 1), width = (swapped ? meta.height : meta.width) || 0, height = (swapped ? meta.width : meta.height) || 0;
    if (width < 320 || !height || width / height < low || width / height > high) throw new Error();
    const result = await input.rotate().resize({ width:1080, height:platform === 'pinterest' || platform === 'ad' ? 2160 : 1350, fit:'inside', withoutEnlargement:true }).flatten({ background:'#ffffff' }).jpeg({ quality:85, progressive:false }).toBuffer({ resolveWithObject:true });
    if (result.data.length > 1024 * 1024 || result.info.width < 320) throw new Error();
    return { data:result.data.toString('base64'), digest:createHash('sha256').update(result.data).digest('hex'), width:result.info.width, height:result.info.height, bytes:result.data.length };
  } catch { throw new MarketingStoreError(platform === 'ad' ? 'Tek kare JPEG, PNG veya WebP seçin: en fazla 5 MB, en az 320 px genişlik, en/boy oranı 0,5–1,91 (9:16 dikey uygundur).' : platform === 'pinterest' ? 'Tek kare JPEG, PNG veya WebP seçin: en fazla 5 MB, en az 320 px genişlik, en/boy oranı 0,5–1,91 (2:3 pin uygundur).' : 'Tek kare JPEG, PNG veya WebP seçin: en fazla 5 MB, en az 320 px genişlik, en/boy oranı 0,8–1,91.'); }
}
