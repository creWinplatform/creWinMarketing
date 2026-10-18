/**
 * Paylaşım geçmişi — sunucu taraflı JSON (data/post-history.json)
 * Tüm fonksiyonlar async; /api/data/post-history ile iletişim kurar.
 *
 * extractPostId / parsePostUrl saf fonksiyonlardır — hem tarayıcıda hem sunucuda
 * (schedule/publish, scheduler/run) aynı ID kuralları kullanılsın diye burada.
 */

export interface PostMetrics {
  likes?:       number;
  comments?:    number;
  shares?:      number;
  views?:       number;
  impressions?: number;
  clicks?:      number;
  reach?:       number;
  fetchedAt:    number;
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
  campaignId?: string;
  deliveryId?: string;
  status?:     string;
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

// ── Metrikler (PostHistory + EngagementPanel ortak) ──────────────────────────

/** Tek gönderinin metriklerini çeker; hata durumunda { error } döner. */
export async function fetchPostMetrics(item: Pick<PostHistoryItem, 'platform' | 'postId'>): Promise<PostMetrics | { error: string }> {
  try {
    const url  = `/api/social/post-stats?platform=${encodeURIComponent(item.platform)}&postId=${encodeURIComponent(item.postId)}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (data.error) return { error: String(data.error) };
    return {
      likes:     data.likes    || 0,
      comments:  data.comments || 0,
      shares:    data.shares   || 0,
      views:     data.views    || 0,
      fetchedAt: data.fetchedAt || Date.now(),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Bağlantı hatası' };
  }
}

/** Metrikleri çekip kaydeder. Platform rate-limit'lerine takılmamak için sınırlı eşzamanlılık. */
export async function refreshMetrics(items: PostHistoryItem[], concurrency = 3): Promise<{ updated: number; errors: string[] }> {
  let updated = 0;
  const errors: string[] = [];
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const m = await fetchPostMetrics(item);
      if ('error' in m) { errors.push(`${item.platform}: ${m.error}`); continue; }
      await updateMetrics(item.id, m);
      updated++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
  return { updated, errors };
}

// ── Gönderi ID'si çözümleme ───────────────────────────────────────────────────

/** Facebook bağlantısı / ID'sinden Graph API'nin kabul ettiği gönderi ID'si. */
function parseFacebookId(input: string): string {
  const s = input.trim();
  if (/^\d+_\d+$/.test(s) || /^\d+$/.test(s)) return s;              // {pageId}_{postId} veya çıplak ID
  let m = s.match(/facebook\.com\/(\d+_\d+)/);                          // API'nin döndürdüğü biçim
  if (m) return m[1];
  m = s.match(/story_fbid=(\d+)/);                                      // permalink.php?story_fbid=…&id=…
  const owner = s.match(/[?&]id=(\d+)/);
  if (m) return owner ? `${owner[1]}_${m[1]}` : m[1];
  m = s.match(/facebook\.com\/(\d+)\/posts\/(\d+)/);                    // /{pageId}/posts/{postId}
  if (m) return `${m[1]}_${m[2]}`;
  m = s.match(/\/posts\/(\d+)/);                                        // /{slug}/posts/{postId} → sunucu sayfa ID'siyle tamamlar
  if (m) return m[1];
  m = s.match(/[?&]fbid=(\d+)/);                                        // photo.php?fbid=… (fotoğraf nesnesi)
  if (m) return m[1];
  m = s.match(/(pfbid[A-Za-z0-9]+)/);                                   // pfbid… — Graph API çözemez, sunucu açık hata verir
  if (m) return m[1];
  return '';
}

/** Post URL'inden platform-spesifik post ID çıkarır (SharePanel, zamanlanmış yayın, manuel takip). */
export function extractPostId(platform: string, url: string): string {
  try {
    if (platform === 'twitter') {
      // https://twitter.com/i/web/status/123456 veya .../status/123456
      const m = url.match(/status\/(\d+)/);
      return m?.[1] || '';
    }
    if (platform === 'linkedin') {
      // https://www.linkedin.com/feed/update/urn:li:share:123 veya urn:li:ugcPost:123
      const m = url.match(/urn:li:[a-zA-Z]+:[\d_-]+/);
      if (m) return m[0];
      const m2 = url.match(/activity-(\d+)/);
      return m2 ? `urn:li:activity:${m2[1]}` : '';
    }
    if (platform === 'facebook') return parseFacebookId(url);
    if (platform === 'instagram') {
      // https://www.instagram.com/p/{shortcode}/ (veya /reel/) — sunucu kısa kodu medya ID'sine çevirir
      const m = url.match(/\/(?:p|reel)\/([^/?]+)/);
      return m?.[1] || '';
    }
  } catch { /* ignore */ }
  return '';
}

/** Manuel takip: URL'den (veya FB {pageId}_{postId} ID'sinden) platform + postId. */
export function parsePostUrl(input: string): { platform: string; postId: string } | null {
  const url = input.trim();
  let platform = '';
  if (/twitter\.com|x\.com/.test(url))              platform = 'twitter';
  else if (/linkedin\.com/.test(url))               platform = 'linkedin';
  else if (/facebook\.com|fb\.com/.test(url) || /^\d+_\d+$/.test(url)) platform = 'facebook';
  else if (/instagram\.com/.test(url))              platform = 'instagram';
  if (!platform) return null;
  const postId = extractPostId(platform, url);
  return postId ? { platform, postId } : null;
}

/** Görselin küçük thumbnail'ini üret (256px max kenar, JPEG) — yalnızca tarayıcıda */
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
