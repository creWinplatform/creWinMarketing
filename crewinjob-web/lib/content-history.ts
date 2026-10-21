/**
 * İçerik geçmişi — sunucu taraflı JSON (data/content-history.json)
 * Tüm fonksiyonlar async; /api/data/content-history ile iletişim kurar.
 */

export interface HistoryItem {
  id:        string;
  platform:  string;
  language:  string;
  content:   string;
  prompt:    string;
  timestamp: number;
  imageData?: string;
  imageMime?: string;
  images?: { data: string; mime: string }[];
  /**
   * Başlık/logo basılmamış HAM arka plan ve onu tamamlayan metinler.
   *
   * Bunlar olmadan geçmişten geri yüklenen bir post yalnızca seyredilebiliyor:
   * başlık düzenlenemiyor, alternatif başlık önerileri ve stil seçenekleri
   * görünmüyordu. Ham arka planla birlikte bu düzenlemeler API çağrısı
   * yapılmadan, tarayıcıda anında yeniden basılabiliyor.
   *
   * Ham JPEG (~300 KB) nihai PNG'nin (~2,5 MB) yanında küçük kalıyor.
   */
  rawBgData?:  string;
  rawBgMime?:  string;
  headline?:   string;
  suggestions?: string[];
  subline?:    string;
  metadata?: Record<string, unknown>;
  /** Growth coach suggestion this draft was opened from (plan action, content plan item or SEO topic). */
  coachRef?: string;
  /** A video the team hosts at its own https address (Instagram Reels/Story, Facebook Page video). Only the address is stored. */
  video?: { url: string; format: 'reel' | 'story' | 'feed' };
  /** Instagram only: publish the single image as a Story instead of a feed post (Stories carry no caption). */
  story?: boolean;
}

/** Görselle birlikte saklanan yeniden düzenleme verisi. */
export interface ImagePayload {
  imageData:    string;
  imageMime:    string;
  rawBgData?:   string;
  rawBgMime?:   string;
  headline?:    string;
  suggestions?: string[];
  subline?:     string;
}

const BASE = '/api/data/content-history';

/** Kaydı oluşturur ve oluşan kaydı döner — sonraki düzenlemeler bu id'ye yazılır. */
export async function createHistoryItem(item: Omit<HistoryItem, 'id' | 'timestamp'>): Promise<HistoryItem | null> {
  try {
    const res = await fetch(BASE, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(item),
    });
    return res.ok ? await res.json() as HistoryItem : null;
  } catch { return null; }
}

export async function saveToHistory(item: Omit<HistoryItem, 'id' | 'timestamp'>): Promise<HistoryItem[]> {
  await createHistoryItem(item);
  return getHistory();
}

export async function getHistory(): Promise<HistoryItem[]> {
  try {
    const res = await fetch(BASE, { cache: 'no-store' });
    return await res.json() as HistoryItem[];
  } catch { return []; }
}

export async function attachImageToLatest(payload: ImagePayload): Promise<void> {
  const items = await getHistory();
  if (!items.length) return;
  await fetch(`${BASE}?id=${items[0].id}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
}

export async function attachImageToItem(id: string, payload: ImagePayload): Promise<void> {
  await fetch(`${BASE}?id=${encodeURIComponent(id)}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
}

export async function updateHistoryContent(id: string, content: string): Promise<void> {
  await fetch(`${BASE}?id=${encodeURIComponent(id)}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ content }),
  });
}

export async function deleteFromHistory(id: string): Promise<HistoryItem[]> {
  await fetch(`${BASE}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return getHistory();
}

export async function clearHistory(): Promise<void> {
  await fetch(BASE, { method: 'DELETE' });
}
