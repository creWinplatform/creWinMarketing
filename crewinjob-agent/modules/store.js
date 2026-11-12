'use strict';
// The agent's JSON data (job-queue.json, .userbot-groups.json, data/*.json, data/*.jsonl) behind one async interface:
// - file mode (default): the files, exactly as before (json-file.js atomic writes); writes to one file are queued in
//   this process.
// - db mode (PLATFORM_LEGACY_STORE=mssql — off by default, also when PLATFORM_DATABASE_PROVIDER=mssql): rows in the
//   platform database's
//   legacy_records / legacy_stores tables, shared with the panel and locked per store across processes. The code that
//   does this lives in the panel (crewinjob-web/lib/db/legacy-records.cjs), and so does the SQL Server driver; the
//   connection string is the panel's (PLATFORM_MSSQL_CONNECTION, PLATFORM_APPSETTINGS_PATH, or
//   crewinjob-web/appsettings.json).
//
//   const { stores, read, mutate, write, append } = require('./store');
//   const queue = await read(stores.jobQueue);
//   await mutate(stores.jobQueue, items => [...items, item]);   // return undefined to write nothing
const fs   = require('fs');
const path = require('path');
const { readJson, writeJsonAtomic } = require('./json-file');

const AGENT_DIR = path.join(__dirname, '..');
const webDir = () => process.env.CREWIN_WEB_DIR ? path.resolve(process.env.CREWIN_WEB_DIR) : path.join(AGENT_DIR, '..', 'crewinjob-web');
let core = null;
function records() {
  if (!core) core = require(path.join(webDir(), 'lib', 'db', 'legacy-records.cjs'));
  return core;
}

function mode(env = process.env) {
  return env.PLATFORM_LEGACY_STORE === 'mssql' ? 'db' : 'file';
}

// ---------- store definitions ----------
// Same names and options as the panel (WEB_STORES / AGENT_STORES in legacy-records.cjs).
const SHARED = {
  'job-queue.json': { shape: 'array' }, '.userbot-groups.json': { shape: 'array' },
  'data/posted-jobs.json': { shape: 'array', key: 'ilanId' }, 'data/review-queue.json': { shape: 'array' },
  'data/group-stats.json': { shape: 'object' }, 'data/pipeline-state.json': { shape: 'object', pretty: false }, 'data/agent-config.json': { shape: 'object' },
  'data/failed-messages.jsonl': { shape: 'array', format: 'jsonl' }, 'data/discovered-groups.json': { shape: 'array' },
  'data/processed-messages.json': { shape: 'array', pretty: false }, 'data/readonly-groups.json': { shape: 'array', pretty: false },
  'data/broadcast-log.json': { shape: 'object' }, 'data/api-usage.json': { shape: 'object' }, 'data/link-tags.jsonl': { shape: 'array', format: 'jsonl' },
};
const storeName = file => `agent:${file.replace(/^data\//, '').replace(/^\./, '').replace(/\.jsonl?$/, '')}`;
/** A store of the agent folder. `file` is relative to it; options override the shared ones (e.g. another file in tests). */
function store(file, options = {}) {
  return { name: storeName(file), file: path.join(AGENT_DIR, file), shape: 'array', ...(SHARED[file] || {}), ...options };
}
const stores = {
  jobQueue:          store('job-queue.json'),
  userbotGroups:     store('.userbot-groups.json'),
  postedJobs:        store('data/posted-jobs.json'),
  reviewQueue:       store('data/review-queue.json'),
  groupStats:        store('data/group-stats.json'),
  pipelineState:     store('data/pipeline-state.json'),
  agentConfig:       store('data/agent-config.json'),
  failedMessages:    store('data/failed-messages.jsonl'),
  discoveredGroups:  store('data/discovered-groups.json'),
  processedMessages: store('data/processed-messages.json'),
  readonlyGroups:    store('data/readonly-groups.json'),
  broadcastLog:      store('data/broadcast-log.json'),
  apiUsage:          store('data/api-usage.json'),
  linkTags:          store('data/link-tags.jsonl', process.env.CREWIN_LINK_TAGS_FILE ? { file: process.env.CREWIN_LINK_TAGS_FILE } : {}),
};

// ---------- file mode ----------
const empty = shape => (shape === 'object' ? {} : []);
const fits = (def, value) => def.shape === 'object' ? Boolean(value) && typeof value === 'object' && !Array.isArray(value) : Array.isArray(value);
function readFile(def) {
  if (def.format === 'jsonl') {
    let raw = ''; try { raw = fs.readFileSync(def.file, 'utf-8'); } catch { return []; }
    const out = [];
    for (const line of raw.split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* a torn line */ } }
    return out;
  }
  const value = readJson(def.file, empty(def.shape));
  return fits(def, value) ? value : empty(def.shape);
}
function writeFile(def, data) {
  if (def.format === 'jsonl') {
    const text = data.map(item => JSON.stringify(item)).join('\n');
    const dir = path.dirname(def.file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${def.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, text ? `${text}\n` : '', 'utf-8'); fs.renameSync(tmp, def.file);
    return;
  }
  writeJsonAtomic(def.file, data, def.pretty !== false);
}
const queues = new Map();
function serial(key, work) {
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(work, work);
  const tail = next.catch(() => undefined);
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return next;
}

// ---------- db mode ----------
let table = null, injected = null, opened = null;
/** Tests hand in their own Db ({ get, all, run, transaction } with ? parameters); null goes back to SQL Server. */
function setStoreDb(db) { injected = db; table = null; }
function db() {
  if (injected) return injected;
  if (!opened) {
    if (!process.env.PLATFORM_MSSQL_CONNECTION && !process.env.PLATFORM_APPSETTINGS_PATH) process.env.PLATFORM_APPSETTINGS_PATH = path.join(webDir(), 'appsettings.json');
    const { connectionString } = require(path.join(webDir(), 'lib', 'db', 'settings.cjs'));
    const value = connectionString();
    if (!value) throw new Error('PLATFORM_LEGACY_STORE=mssql needs ConnectionStrings.Platform in crewinjob-web/appsettings.json.');
    opened = records().mssqlRecordsDb(value);
  }
  return opened;
}
function tables() { if (!table) table = records().recordStore(() => db()); return table; }

// ---------- the interface ----------
/** The store's whole array or object (a fresh copy). Empty when missing or unreadable. */
async function read(def) {
  if (mode() === 'file') return readFile(def);
  return tables().read(def.name, def.shape);
}
/** Read-modify-write; `change(data)` returns the new data or undefined. Do not nest a mutate of the same store. */
async function mutate(def, change) {
  if (mode() === 'file') {
    return serial(def.file, async () => {
      const next = await change(readFile(def));
      if (next !== undefined) writeFile(def, next);
    });
  }
  await tables().mutate(def.name, def.shape, change, { key: def.key });
}
/** Replaces the store's contents. */
function write(def, data) { return mutate(def, () => data); }
/** Adds items at the end of an array store; a .jsonl file gets one line per item. */
async function append(def, items) {
  if (!items.length) return;
  if (mode() === 'file') {
    if (def.format === 'jsonl') {
      const dir = path.dirname(def.file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(def.file, items.map(item => `${JSON.stringify(item)}\n`).join(''), 'utf-8');
      return;
    }
    return mutate(def, list => [...list, ...items]);
  }
  await tables().append(def.name, items);
}
/** Closes the database connection (CLI processes exit faster). */
async function close() { if (opened) { const handle = opened; opened = null; table = null; await handle.close(); } }

module.exports = { stores, store, storeName, mode, read, mutate, write, append, close, setStoreDb, SHARED };
