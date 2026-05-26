const HISTORY_KEY = 'crewinjob_history';
const MAX_HISTORY = 30;

export interface HistoryItem {
  id:        string;
  platform:  string;
  language:  string;
  content:   string;
  prompt:    string;
  timestamp: number;
  // Görsel (opsiyonel — OutputPanel'de üretilince eklenir)
  imageData?: string;   // base64, PNG
  imageMime?: string;
}

export function saveToHistory(item: Omit<HistoryItem, 'id' | 'timestamp'>): HistoryItem[] {
  const existing = getHistory();
  const newItem: HistoryItem = {
    ...item,
    id:        `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
  };
  const updated = [newItem, ...existing].slice(0, MAX_HISTORY);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
  return updated;
}

export function getHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryItem[];
  } catch { return []; }
}

/** Üretilen görseli en son history kaydına ekler */
export function attachImageToLatest(imageData: string, imageMime: string): void {
  const items = getHistory();
  if (!items.length) return;
  items[0] = { ...items[0], imageData, imageMime };
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch { /* ignore */ }
}

/** Belirli bir ID'li kayda görsel ekler */
export function attachImageToItem(id: string, imageData: string, imageMime: string): void {
  const items = getHistory();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return;
  items[idx] = { ...items[idx], imageData, imageMime };
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch { /* ignore */ }
}

/** Belirli bir ID'li kaydın içeriğini günceller */
export function updateHistoryContent(id: string, content: string): void {
  const items = getHistory();
  const idx = items.findIndex(i => i.id === id);
  if (idx === -1) return;
  items[idx] = { ...items[idx], content };
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items)); } catch { /* ignore */ }
}

export function deleteFromHistory(id: string): HistoryItem[] {
  const updated = getHistory().filter(item => item.id !== id);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
  return updated;
}

export function clearHistory(): void {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}
