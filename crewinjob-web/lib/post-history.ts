/**
 * Paylaşım geçmişi — sunucu taraflı JSON (data/post-history.json)
 * Tüm fonksiyonlar async; /api/data/post-history ile iletişim kurar.
 */

export interface PostMetrics {
  likes?:    number;
  comments?: number;
  shares?:   number;
  views?:    number;
  fetchedAt: number;
}

export interface PostHistoryItem {
  id:          string;
  platform:    string;
  postId:      string;
  postUrl?:    string;
  content:     string;
  thumbnail?:  string;
  publishedAt: number;
  metrics?:    PostMetrics;
}

const BASE = '/api/data/post-history';

export async function getHistory(): Promise<PostHistoryItem[]> {
  try {
    const res = await fetch(BASE, { cache: 'no-store' });
    return await res.json() as PostHistoryItem[];
  } catch { return []; }
}

export async function addPost(item: Omit<PostHistoryItem, 'id'>): Promise<PostHistoryItem> {
  const res = await fetch(BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(item),
  });
  return await res.json() as PostHistoryItem;
}

export async function updateMetrics(id: string, metrics: PostMetrics): Promise<void> {
  await fetch(`${BASE}?id=${encodeURIComponent(id)}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ metrics }),
  });
}

export async function removePost(id: string): Promise<void> {
  await fetch(`${BASE}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function clearHistory(): Promise<void> {
  await fetch(BASE, { method: 'DELETE' });
}

/** Görselin küçük thumbnail'ini üret (256px max kenar, JPEG) */
export async function makeThumbnail(imageData: string, imageMime: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX   = 256;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w     = Math.round(img.width  * scale);
      const h     = Math.round(img.height * scale);
      const cv    = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', 0.7).split(',')[1]);
    };
    img.onerror = () => resolve('');
    img.src = `data:${imageMime};base64,${imageData}`;
  });
}
