/**
 * Aktivite günlüğü — sunucu taraflı JSON (data/activity-log.json)
 * logActivity fire-and-forget çağrılabilir (await gerekmez).
 */

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
  id:      string;
  type:    ActivityType;
  label:   string;
  detail?: string;
  ts:      number;
}

const BASE = '/api/data/activity-log';

/** Fire-and-forget — await gerekmiyor */
export function logActivity(type: ActivityType, label: string, detail?: string): void {
  fetch(BASE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ type, label, detail }),
  }).catch(() => { /* ignore */ });
}

export async function getActivityLog(): Promise<ActivityEntry[]> {
  try {
    const res = await fetch(BASE, { cache: 'no-store' });
    return await res.json() as ActivityEntry[];
  } catch { return []; }
}

export async function clearActivityLog(): Promise<void> {
  await fetch(BASE, { method: 'DELETE' });
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
