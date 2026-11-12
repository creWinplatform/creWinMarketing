// Test/preview-only loader for server modules; never imported by application routes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  const full = path.resolve(__dirname, '../lib/platform', file);
  if (cache.has(full)) return cache.get(full);
  const exported = {};
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports: exported, process, Buffer, crypto: globalThis.crypto, Date, URL, URLSearchParams, Intl, TextDecoder, TextEncoder, structuredClone, AbortSignal, Response, Headers, FormData, Blob, ReadableStream, setTimeout, clearTimeout, fetch: (...args) => globalThis.fetch(...args), require: name => {
    if (name === 'server-only') return {};
    if (name.startsWith('.') && name.endsWith('.cjs')) return require(path.resolve(path.dirname(full), name));
    if (name.startsWith('.')) return load(path.resolve(path.dirname(full), `${name}.ts`));
    // The app's '@/…' alias (tsconfig paths) points at the web root.
    if (name.startsWith('@/')) return load(path.resolve(__dirname, '..', `${name.slice(2)}.ts`));
    return require(name);
  } });
  cache.set(full, exported);
  if (path.basename(full) === 'database.ts') {
    // Tests read and seed the database with the synchronous better-sqlite3 handle and hand that same handle to the
    // async platform code. Its transaction() becomes the async Db one; statements stay synchronous, which the
    // platform code awaits like any value.
    const open = exported.openPlatformDatabase;
    exported.openPlatformDatabase = (...args) => asDb(open(...args));
  }
  return exported;
}
// A better-sqlite3 handle that the async platform code (lib/db/client.ts) can use as its Db.
function asDb(handle) {
  if (handle.dialect) return handle;
  const db = load('../db/client.ts').sqliteDb(handle);
  Object.defineProperty(handle, 'transaction', { value: db.transaction, configurable: true, writable: true });
  Object.defineProperty(handle, 'dialect', { value: 'sqlite', configurable: true });
  return handle;
}
module.exports = { load, asDb };
