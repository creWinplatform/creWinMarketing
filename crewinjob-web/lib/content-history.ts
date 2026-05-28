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
}

const BASE = '/api/data/content-history';

export async function saveToHistory(item: Omit<HistoryItem, 'id' | 'timestamp'>): Promise<HistoryItem[]> {
  await fetch(BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(item),
  });
  return getHistory();
}

export async function getHistory(): Promise<HistoryItem[]> {
  try {
    const res = await fetch(BASE, { cache: 'no-store' });
    return await res.json() as HistoryItem[];
  } catch { return []; }
}

export async function attachImageToLatest(imageData: string, imageMime: string): Promise<void> {
  const items = await getHistory();
  if (!items.length) return;
  await fetch(`${BASE}?id=${items[0].id}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ imageData, imageMime }),
  });
}

export async function attachImageToItem(id: string, imageData: string, imageMime: string): Promise<void> {
  await fetch(`${BASE}?id=${encodeURIComponent(id)}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ imageData, imageMime }),
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
