import 'server-only';
import fs from 'fs';
import path from 'path';
import { isRecord, marketingBackend, stringValue, timestampValue } from '@/lib/marketing-backend';
import { writeTextAtomic } from '@/lib/json-store';
import { legacyStoreMode, mutateStore, readStore, webDataDir, webStore, withStore } from '@/lib/legacy-store';

// Server side of the activity log (data/activity-log.json, or legacy_records 'web:activity-log' with
// PLATFORM_DATABASE_PROVIDER=mssql; mirrored to the backend when it is reachable). The newest 200 entries are kept.
export const activityStore = () => webStore('activity-log.json', 'array');
export interface ActivityEntry { id: string; type: string; label: string; detail?: string; ts: number }

export const loadActivity = () => readStore<ActivityEntry>(activityStore());
/** Read-modify-write of the log under its lock; `save` keeps the newest 200. */
export const withActivity = <R,>(work: (store: { load(): ActivityEntry[]; save(entries: ActivityEntry[]): void }) => R | Promise<R>) =>
  withStore<ActivityEntry[], R>(activityStore(), store => work({ load: store.load, save: entries => store.save(entries.slice(0, 200)) }));
export function normalizeActivity(raw: Record<string, unknown>): ActivityEntry {
  return { id: stringValue(raw.id), type: stringValue(raw.activityType, 'content_generated'), label: stringValue(raw.label), detail: stringValue(raw.detail) || undefined, ts: timestampValue(raw.occurredAt, raw.creationTime) };
}

// When the log was last cleared: backend entries older than that stay hidden. A text file in file mode
// (data/activity-log-cleared-at.txt), the store 'web:activity-log-cleared-at' ({ at }) in db mode.
const clearedFile = () => path.join(webDataDir(), 'activity-log-cleared-at.txt');
const clearedStore = () => webStore('activity-log-cleared-at.json', 'object');
export async function activityClearedAt(): Promise<number> {
  if (legacyStoreMode() === 'file') { try { return Number(fs.readFileSync(clearedFile(), 'utf-8')) || 0; } catch { return 0; } }
  return Number((await readStore<number>(clearedStore())).at) || 0;
}
/** Empties the log and records the time, so backend entries from before it stay hidden. */
export async function clearActivity(): Promise<void> {
  const at = Date.now();
  await withActivity(async ({ save }) => {
    if (legacyStoreMode() === 'file') writeTextAtomic(clearedFile(), String(at));
    else await mutateStore(clearedStore(), () => ({ at }));
    save([]);
  });
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
  await withActivity(({ load, save }) => save([entry, ...load().filter(item => item.id !== entry.id)]));
  return entry;
}
