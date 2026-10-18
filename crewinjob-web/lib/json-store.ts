// ─── Yerel JSON dosyaları için ortak yardımcılar ─────────────────────────────
// - writeJsonAtomic: tmp dosya + rename (yarım yazılmış dosya kalmaz)
// - withFileLock:    aynı anahtar için süreç içi sıralı çalıştırma (read-modify-write yarışını önler)
//   Not: tek Node süreci varsayılır; birden fazla instance için backend kaynak olmalıdır.
import 'server-only';
import fs from 'fs';
import path from 'path';

type LockMap = Map<string, Promise<unknown>>;
const g = globalThis as typeof globalThis & { __crewinFileLocks?: LockMap };
const locks: LockMap = g.__crewinFileLocks ?? (g.__crewinFileLocks = new Map());

export async function withFileLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = prev.then(() => current, () => current);
  locks.set(key, tail);
  try {
    await prev.catch(() => undefined);
    return await fn();
  } finally {
    release();
    if (locks.get(key) === tail) locks.delete(key);
  }
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf-8');
    return raw.trim() ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file: string, data: unknown, pretty = true): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), 'utf-8');
  fs.renameSync(tmp, file);
}

export function writeTextAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, 'utf-8');
  fs.renameSync(tmp, file);
}
