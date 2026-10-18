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
  vm.runInNewContext(code, { exports: exported, process, Buffer, Date, URL, URLSearchParams, Intl, TextDecoder, TextEncoder, structuredClone, AbortSignal, Response, Headers, FormData, Blob, setTimeout, clearTimeout, fetch: (...args) => globalThis.fetch(...args), require: name => {
    if (name === 'server-only') return {};
    if (name.startsWith('.')) return load(path.resolve(path.dirname(full), `${name}.ts`));
    return require(name);
  } });
  cache.set(full, exported);
  return exported;
}
module.exports = { load };
