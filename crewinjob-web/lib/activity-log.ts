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
  | 'email_sent'
  | 'calendar_added'
  | 'kpi_generated'
  | 'kpi_action'
  | 'seo_crawl_started'
  | 'seo_crawl_completed'
  | 'seo_proposed'
  | 'seo_approved'
  | 'seo_rejected'
  | 'seo_applied'
  | 'email_complaint'
  | 'test';

export interface ActivityEntry {
  id:      string;
  /** Backend/yerel kayıtlar bilinmeyen tip içerebilir → activityMeta() ile güvenli eriş */
  type:    ActivityType | (string & {});
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
  email_sent:        { icon: '📧', color: 'text-amber-600'  },
  calendar_added:    { icon: '📅', color: 'text-orange-500' },
  kpi_generated:     { icon: '📊', color: 'text-indigo-500' },
  kpi_action:        { icon: '⚡', color: 'text-amber-500'  },
  seo_crawl_started:   { icon: '🕷️', color: 'text-slate-500'   },
  seo_crawl_completed: { icon: '🔎', color: 'text-teal-500'    },
  seo_proposed:        { icon: '📝', color: 'text-blue-500'    },
  seo_approved:        { icon: '✅', color: 'text-green-500'   },
  seo_rejected:        { icon: '🚫', color: 'text-red-500'     },
  seo_applied:         { icon: '🛠️', color: 'text-emerald-600' },
  email_complaint:     { icon: '⚠️', color: 'text-red-500'     },
  test:                { icon: '🧪', color: 'text-slate-400'   },
};

/** Bilinmeyen tipler için yedek (panel çökmesin) */
export const ACTIVITY_FALLBACK_META = { icon: '•', color: 'text-slate-400' };

export function activityMeta(type: string): { icon: string; color: string } {
  return (ACTIVITY_META as Record<string, { icon: string; color: string }>)[type] ?? ACTIVITY_FALLBACK_META;
}
