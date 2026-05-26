// Lokal paylaşım geçmişi — localStorage tabanlı, kullanıcı tarayıcısında saklanır

const STORAGE_KEY = 'crewinjob_post_history';

export interface PostMetrics {
  likes?:    number;
  comments?: number;
  shares?:   number;
  views?:    number;
  fetchedAt: number;
}

export interface PostHistoryItem {
  id:           string;          // benzersiz kayıt ID
  platform:     string;          // twitter / linkedin / facebook / instagram
  postId:       string;          // platform post ID
  postUrl?:     string;          // direkt link
  content:      string;          // paylaşılan metin
  thumbnail?:   string;          // küçük görsel (PNG base64) - opsiyonel
  publishedAt:  number;          // Date.now()
  metrics?:     PostMetrics;     // son alınan metrikler
}

export function getHistory(): PostHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PostHistoryItem[];
  } catch {
    return [];
  }
}

export function saveHistory(items: PostHistoryItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    // En fazla son 100 kayıt — localStorage sınırını aşmamak için
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 100)));
  } catch (e) {
    console.warn('[PostHistory] Kaydedilemedi:', e);
  }
}

export function addPost(item: Omit<PostHistoryItem, 'id'>): PostHistoryItem {
  const newItem: PostHistoryItem = {
    ...item,
    id: `${item.platform}_${item.postId}_${Date.now()}`,
  };
  const list = [newItem, ...getHistory()];
  saveHistory(list);
  return newItem;
}

export function updateMetrics(id: string, metrics: PostMetrics): void {
  const list = getHistory();
  const idx  = list.findIndex(p => p.id === id);
  if (idx >= 0) {
    list[idx].metrics = metrics;
    saveHistory(list);
  }
}

export function removePost(id: string): void {
  saveHistory(getHistory().filter(p => p.id !== id));
}

export function clearHistory(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

/** Görselin küçük thumbnail'ini üret (256px max kenar, JPEG) */
export async function makeThumbnail(imageData: string, imageMime: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 256;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', 0.7).split(',')[1]);
    };
    img.onerror = () => resolve('');
    img.src = `data:${imageMime};base64,${imageData}`;
  });
}
