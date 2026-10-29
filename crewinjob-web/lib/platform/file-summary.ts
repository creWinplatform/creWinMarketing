import fs from 'fs';
import path from 'path';
// Summaries of the Crewin workspace's JSON stores, kept until the file changes (content-history.json is ~20 MB of base64
// images, the agent's review queue several MB), so reading them again costs one stat() per file.
type Entry = { key: string; value: unknown };
const g = globalThis as typeof globalThis & { __crewinFileSummaries?: Map<string, Entry> };
const files = g.__crewinFileSummaries ?? (g.__crewinFileSummaries = new Map());
export function fileSummary<T>(file: string, empty: T, reduce: (data: unknown) => T, kind = 'default'): T {
  let stat: fs.Stats; try { stat = fs.statSync(file); } catch { return empty; }
  const key = `${stat.mtimeMs}:${stat.size}`, slot = `${kind}\u0000${file}`, hit = files.get(slot);
  if (hit?.key === key) return hit.value as T;
  let value = empty; try { const raw = fs.readFileSync(file, 'utf8'); value = raw.trim() ? reduce(JSON.parse(raw)) : empty; } catch { value = empty; }
  files.set(slot, { key, value }); return value;
}
export function resetFileSummaries() { files.clear(); }
// The web app's data/ folder (CREWIN_WEB_DATA_DIR overrides it, e.g. in tests and the isolated preview).
export const crewinDataDir = () => process.env.CREWIN_WEB_DATA_DIR || path.join(process.cwd(), 'data');
export const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') as Record<string, unknown>[] : [];
export const timeOf = (value: unknown) => { const n = typeof value === 'number' ? value : Date.parse(String(value || '')); return Number.isFinite(n) ? n : 0; };
