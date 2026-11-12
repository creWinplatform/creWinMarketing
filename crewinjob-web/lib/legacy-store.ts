// The Crewin workspace's JSON stores (data/*.json and the agent files the panel reads), behind one async interface:
// - file mode (the default, and with the SQLite platform database): the files, exactly as before — writeJsonAtomic
//   and withFileLock (one Node process);
// - db mode (PLATFORM_LEGACY_STORE=mssql; off by default, also when PLATFORM_DATABASE_PROVIDER=mssql): rows in legacy_records/legacy_stores of
//   the platform database (lib/db/legacy-records.cjs), locked per store across processes.
// mutate() is the only read-modify-write; its callback runs under the lock and should not wait on the network.
import fs from 'fs';
import path from 'path';
import { readJson, withFileLock, writeJsonAtomic } from './json-store';
import type { Db } from './db/client';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const records = require('./db/legacy-records.cjs') as {
  recordStore(db: () => Db | Promise<Db>): RecordStore;
  legacyStoreMode(env?: NodeJS.ProcessEnv): 'file' | 'db';
  storeName(owner: 'web' | 'agent', file: string): string;
  storeOptions(owner: 'web' | 'agent', file: string): Partial<StoreDef>;
};
interface RecordStore {
  read(store: string, shape: Shape): Promise<any>;
  version(store: string): Promise<number>;
  exists(store: string): Promise<boolean>;
  mutate(store: string, shape: Shape, change: (data: any) => unknown, options?: { key?: string }): Promise<{ written: boolean }>;
  append(store: string, items: unknown[]): Promise<void>;
  reset(): void;
}

export type Shape = 'array' | 'object';
export interface StoreDef {
  /** The table's store name ('web:calendar', 'agent:job-queue'). */
  name: string;
  /** The file in file mode. */
  file: string;
  shape: Shape;
  /** File format: one JSON document (default) or one JSON value per line (append-only logs). */
  format?: 'json' | 'jsonl';
  /** Indent the file (default true). */
  pretty?: boolean;
  /** The file lock key, when other code already locks the file under another key. */
  lock?: string;
  /** The item field used as the row key (default `id`). */
  key?: string;
}
type Data<S extends Shape> = S extends 'array' ? unknown[] : Record<string, unknown>;

/** The data/ folder of the panel (CREWIN_WEB_DATA_DIR overrides it in tests and previews). */
export const webDataDir = () => process.env.CREWIN_WEB_DATA_DIR || path.join(process.cwd(), 'data');
/** The agent's folder (CREWINJOB_AGENT_DIR overrides it, e.g. /crewinjob-agent in Docker). */
export const agentRoot = () => process.env.CREWINJOB_AGENT_DIR ? path.resolve(process.env.CREWINJOB_AGENT_DIR) : path.join(process.cwd(), '..', 'crewinjob-agent');

/** A store of the panel's data/ folder: webStore('calendar.json', 'array'). */
export function webStore<S extends Shape>(file: string, shape: S, options: Partial<Omit<StoreDef, 'shape'>> = {}): StoreDef & { shape: S } {
  return { name: records.storeName('web', file), file: path.join(webDataDir(), file), ...records.storeOptions('web', file), shape, ...options };
}
/** A store of the agent's folder: agentStore('data/posted-jobs.json', 'array'). */
export function agentStore<S extends Shape>(file: string, shape: S, options: Partial<Omit<StoreDef, 'shape'>> = {}): StoreDef & { shape: S } {
  return { name: records.storeName('agent', file), file: path.join(agentRoot(), file), ...records.storeOptions('agent', file), shape, ...options };
}

export const legacyStoreMode = (): 'file' | 'db' => records.legacyStoreMode(process.env);

type Holder = typeof globalThis & { __crewinLegacyRecords?: RecordStore; __crewinLegacyDb?: Db | null };
const g = globalThis as Holder;
/** Tests hand in their own Db; otherwise the platform database is used. */
export function setLegacyStoreDb(db: Db | null) { g.__crewinLegacyDb = db; g.__crewinLegacyRecords = undefined; }
function table(): RecordStore {
  return g.__crewinLegacyRecords ??= records.recordStore(() => {
    if (g.__crewinLegacyDb) return g.__crewinLegacyDb;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('./platform/database') as { platformDatabase(): Db }).platformDatabase();
  });
}

const empty = (shape: Shape) => (shape === 'array' ? [] : {});
const fits = (def: StoreDef, value: unknown) => def.shape === 'array' ? Array.isArray(value) : Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function readFile(def: StoreDef): any {
  if (def.format === 'jsonl') {
    let raw = ''; try { raw = fs.readFileSync(def.file, 'utf-8'); } catch { return []; }
    const out: unknown[] = [];
    for (const line of raw.split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* a torn last line */ } }
    return out;
  }
  const value = readJson<unknown>(def.file, empty(def.shape));
  return fits(def, value) ? value : empty(def.shape);
}
function writeFile(def: StoreDef, data: unknown) {
  if (def.format === 'jsonl') {
    const lines = (data as unknown[]).map(item => JSON.stringify(item)).join('\n');
    const tmp = `${def.file}.${process.pid}.${Date.now()}.tmp`;
    fs.mkdirSync(path.dirname(def.file), { recursive: true });
    fs.writeFileSync(tmp, lines ? `${lines}\n` : '', 'utf-8'); fs.renameSync(tmp, def.file);
    return;
  }
  writeJsonAtomic(def.file, data, def.pretty !== false);
}

/** The store's whole array or object; empty when it does not exist or is unreadable. */
export async function readStore<T = unknown>(def: StoreDef & { shape: 'array' }): Promise<T[]>;
export async function readStore<T = unknown>(def: StoreDef & { shape: 'object' }): Promise<Record<string, T>>;
export async function readStore(def: StoreDef): Promise<any>;
export async function readStore(def: StoreDef): Promise<any> {
  if (legacyStoreMode() === 'file') return readFile(def);
  return table().read(def.name, def.shape);
}

/**
 * Read-modify-write under the store's lock. `change` gets the current data and returns the new data, or undefined to
 * leave the store as it is. Not re-entrant: do not call another mutate of the same store from inside `change`.
 */
export async function mutateStore<S extends Shape, D = Data<S>>(def: StoreDef & { shape: S }, change: (data: D) => D | undefined | void | Promise<D | undefined | void>): Promise<void> {
  if (legacyStoreMode() === 'file') {
    await withFileLock(def.lock || def.file, async () => {
      const next = await change(readFile(def) as D);
      if (next !== undefined) writeFile(def, next);
    });
    return;
  }
  await table().mutate(def.name, def.shape, async data => { const next = await change(data as D); return next === undefined ? undefined : next; }, { key: def.key });
}

/**
 * The old `withFileLock(FILE, () => { const list = load(); …; save(list); return x; })` shape: `work` gets the store
 * read under the lock (`load()`), records the new contents with `save()`, and its return value is passed back.
 * The save is written when `work` returns, still under the lock.
 */
export interface LockedStore<D> { load(): D; save(data: D): void }
export async function withStore<D = any, R = void>(def: StoreDef, work: (store: LockedStore<D>) => R | Promise<R>): Promise<R> {
  let result!: R;
  await mutateStore(def as StoreDef & { shape: Shape }, async (data: any) => {
    let current = data as D, changed = false;
    result = await work({ load: () => current, save: next => { current = next; changed = true; } });
    return changed ? current as any : undefined;
  });
  return result;
}

/** Replaces the store's contents. */
export async function writeStore(def: StoreDef, data: unknown): Promise<void> {
  await mutateStore(def as StoreDef & { shape: Shape }, () => data as any);
}

/** Adds items at the end of an array store (logs). In file mode a .jsonl file gets one line per item. */
export async function appendStore(def: StoreDef, items: unknown[]): Promise<void> {
  if (!items.length) return;
  if (legacyStoreMode() === 'file') {
    if (def.format === 'jsonl') {
      fs.mkdirSync(path.dirname(def.file), { recursive: true });
      fs.appendFileSync(def.file, items.map(item => `${JSON.stringify(item)}\n`).join(''), 'utf-8');
      return;
    }
    await mutateStore(def as StoreDef & { shape: 'array' }, list => [...list, ...items]);
    return;
  }
  await table().append(def.name, items);
}

/** Changes whenever the store changes (file: modification time and size; db: the store version). '' when missing. */
export async function storeVersion(def: StoreDef): Promise<string> {
  if (legacyStoreMode() === 'file') { try { const stat = fs.statSync(def.file); return `${stat.mtimeMs}:${stat.size}`; } catch { return ''; } }
  const version = await table().version(def.name);
  return version ? `v${version}` : '';
}

// Summaries of large stores (content history ~20 MB, the agent's review queue several MB), recomputed only when the
// store changes, so reading them again costs one stat() or one small query.
type Summary = { key: string; value: unknown };
const gs = globalThis as typeof globalThis & { __crewinStoreSummaries?: Map<string, Summary> };
const summaries = gs.__crewinStoreSummaries ?? (gs.__crewinStoreSummaries = new Map());
export async function storeSummary<T>(def: StoreDef, emptyValue: T, reduce: (data: unknown) => T, kind = 'default'): Promise<T> {
  const key = await storeVersion(def);
  if (!key) return emptyValue;
  const slot = `${kind}\u0000${legacyStoreMode()}\u0000${def.name}\u0000${def.file}`, hit = summaries.get(slot);
  if (hit?.key === key) return hit.value as T;
  let value = emptyValue;
  try { const data = await readStore(def); value = reduce(data); } catch { value = emptyValue; }
  summaries.set(slot, { key, value }); return value;
}
export function resetStoreSummaries() { summaries.clear(); g.__crewinLegacyRecords?.reset(); }
