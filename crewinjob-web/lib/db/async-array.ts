// Array helpers for callbacks that read the database. They run one item at a time, in order, exactly like the
// synchronous array methods they replace, so writes keep their order and a transaction never runs two statements
// at once.
export async function mapSeries<T, U>(items: readonly T[], fn: (item: T, index: number) => U | Promise<U>): Promise<U[]> {
  const out: U[] = [];
  for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i));
  return out;
}
export async function flatMapSeries<T, U>(items: readonly T[], fn: (item: T, index: number) => U | readonly U[] | Promise<U | readonly U[]>): Promise<U[]> {
  const out: U[] = [];
  for (let i = 0; i < items.length; i++) { const value = await fn(items[i], i); if (Array.isArray(value)) out.push(...value); else out.push(value as U); }
  return out;
}
export async function filterSeries<T>(items: readonly T[], fn: (item: T, index: number) => unknown): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) if (await fn(items[i], i)) out.push(items[i]);
  return out;
}
export async function someSeries<T>(items: readonly T[], fn: (item: T, index: number) => unknown): Promise<boolean> {
  for (let i = 0; i < items.length; i++) if (await fn(items[i], i)) return true;
  return false;
}
export async function everySeries<T>(items: readonly T[], fn: (item: T, index: number) => unknown): Promise<boolean> {
  for (let i = 0; i < items.length; i++) if (!(await fn(items[i], i))) return false;
  return true;
}
export async function findSeries<T>(items: readonly T[], fn: (item: T, index: number) => unknown): Promise<T | undefined> {
  for (let i = 0; i < items.length; i++) if (await fn(items[i], i)) return items[i];
  return undefined;
}
export async function forEachSeries<T>(items: readonly T[], fn: (item: T, index: number) => unknown): Promise<void> {
  for (let i = 0; i < items.length; i++) await fn(items[i], i);
}
