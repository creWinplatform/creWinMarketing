// Keeps the last good value of a slow read (the Crewin backend). A fresh value is returned as it is; a stale one is
// returned at once while a single refresh runs in the background; only a missing or too old value makes the caller
// wait. keep() decides whether a result may be reused (a partial or failed backend answer is passed on, not kept).
export type StaleRead<T> = () => Promise<T>;
export function staleCache<T>(load: () => Promise<T>, { freshMs, staleMs, keep = () => true, now = Date.now }: { freshMs: number; staleMs: number; keep?: (value: T) => boolean; now?: () => number }): StaleRead<T> {
  let value: T | undefined, at = 0, running: Promise<T> | null = null;
  const refresh = () => running ??= load().then(result => { if (keep(result)) { value = result; at = now(); } return result; }).finally(() => { running = null; });
  return async () => {
    const age = now() - at;
    if (value !== undefined && age < freshMs) return value;
    if (value !== undefined && age < staleMs) { refresh().catch(() => { /* the stale value stays until a refresh succeeds */ }); return value; }
    return refresh();
  };
}
// One cache per key for the whole server process (route bundles share globalThis, not module state).
const store = globalThis as typeof globalThis & { __ryzevoStaleReads?: Map<string, StaleRead<unknown>> };
export function sharedStaleCache<T>(key: string, load: () => Promise<T>, options: Parameters<typeof staleCache<T>>[1]): StaleRead<T> {
  const reads = store.__ryzevoStaleReads ??= new Map();
  if (!reads.has(key)) reads.set(key, staleCache(load, options) as StaleRead<unknown>);
  return reads.get(key) as StaleRead<T>;
}
