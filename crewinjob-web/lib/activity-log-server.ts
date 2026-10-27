import 'server-only';
import path from 'path';
import { isRecord, marketingBackend, stringValue, timestampValue } from '@/lib/marketing-backend';
import { readJson, withFileLock, writeJsonAtomic } from '@/lib/json-store';

// Server side of the activity log (data/activity-log.json, mirrored to the backend when it is reachable).
export const ACTIVITY_FILE = path.join(process.cwd(), 'data', 'activity-log.json');
export interface ActivityEntry { id: string; type: string; label: string; detail?: string; ts: number }

export function loadActivity(): ActivityEntry[] {
  const list = readJson<ActivityEntry[]>(ACTIVITY_FILE, []);
  return Array.isArray(list) ? list : [];
}
export function saveActivity(entries: ActivityEntry[]) { writeJsonAtomic(ACTIVITY_FILE, entries.slice(0, 200)); }
export function normalizeActivity(raw: Record<string, unknown>): ActivityEntry {
  return { id: stringValue(raw.id), type: stringValue(raw.activityType, 'content_generated'), label: stringValue(raw.label), detail: stringValue(raw.detail) || undefined, ts: timestampValue(raw.occurredAt, raw.creationTime) };
}

export async function recordActivity(input: { type: string; label: string; detail?: string; campaignId?: string; entityType?: string; entityId?: string; metadata?: Record<string, unknown> }): Promise<ActivityEntry> {
  let entry: ActivityEntry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: input.type, label: input.label, detail: input.detail, ts: Date.now() };
  try {
    const result = await marketingBackend().marketingActivityPost('Add', {
      activityType: input.type, label: input.label, detail: input.detail || null, campaignId: input.campaignId || null,
      entityType: input.entityType || null, entityId: input.entityId || null, metadata: input.metadata || {}, occurredAt: new Date(entry.ts).toISOString(),
    });
    if (isRecord(result)) entry = normalizeActivity(result);
  } catch { /* aktivite yerel mirror'da kaybolmaz */ }
  await withFileLock(ACTIVITY_FILE, () => saveActivity([entry, ...loadActivity().filter(item => item.id !== entry.id)]));
  return entry;
}
