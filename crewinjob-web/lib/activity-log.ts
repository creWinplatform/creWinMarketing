/** Activity Log — localStorage tabanlı son 50 eylem kaydı */

export type ActivityType =
  | 'content_generated'
  | 'post_published'
  | 'scheduler_run'
  | 'image_generated'
  | 'wa_sent'
  | 'tg_sent'
  | 'calendar_added'
  | 'kpi_generated';

export interface ActivityEntry {
  id:        string;
  type:      ActivityType;
  label:     string;      // kısa açıklama (ör. "Instagram içeriği üretildi")
  detail?:   string;      // opsiyonel ek bilgi (platform, karakter sayısı, vb.)
  ts:        number;      // Date.now()
}

const STORAGE_KEY = 'crewinjob_activity_log';
const MAX_ENTRIES = 50;

export function logActivity(
  type: ActivityType,
  label: string,
  detail?: string,
): ActivityEntry[] {
  const entry: ActivityEntry = {
    id:     `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    label,
    detail,
    ts: Date.now(),
  };
  try {
    const raw     = localStorage.getItem(STORAGE_KEY);
    const current: ActivityEntry[] = raw ? JSON.parse(raw) : [];
    const updated = [entry, ...current].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [entry];
  }
}

export function getActivityLog(): ActivityEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function clearActivityLog(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** Eylem tipi → ikon + renk */
export const ACTIVITY_META: Record<ActivityType, { icon: string; color: string }> = {
  content_generated: { icon: '✨', color: 'text-blue-500'   },
  post_published:    { icon: '📤', color: 'text-green-500'  },
  scheduler_run:     { icon: '🚀', color: 'text-purple-500' },
  image_generated:   { icon: '🎨', color: 'text-pink-500'   },
  wa_sent:           { icon: '💬', color: 'text-green-600'  },
  tg_sent:           { icon: '✈️',  color: 'text-sky-500'    },
  calendar_added:    { icon: '📅', color: 'text-orange-500' },
  kpi_generated:     { icon: '📊', color: 'text-indigo-500' },
};
