// The Crewin workspace's JSON stores (the panel's data/*.json and the agent's files) as rows in two tables, shared by
// the panel (lib/legacy-store.ts) and the agent (crewinjob-agent/modules/store.js):
//
//   legacy_records(store, record_key, position, body, body_hash, updated_at)   one row per array item or object key
//   legacy_stores(store, version, updated_at)                                  one row per store
//
// A store keeps the shape its file had: an array (rows ordered by position) or an object (rows keyed by property).
// The code that used the file keeps working on the whole array or object; only the changed rows are written, so
// editing one item of the ~20 MB content history sends that item, not the file.
//
// Writers serialise on the store's legacy_stores row: mutate() bumps its version first, in the same transaction as the
// writes, and the row lock is held until the commit — across processes and machines, not only within one Node process
// as the file lock was. The version also tells readers whether their cached copy is still current.
//
// Only portable SQL is used here (it runs unchanged on SQLite and, after ? → @pN, on SQL Server), so the agent can use
// a small adapter without the panel's translator.
const crypto = require('node:crypto');

const MAX_KEY = 170;           // NVARCHAR(170) on SQL Server
const MAX_PARAMS = 2000;       // SQL Server allows 2,100 parameters per request
const MAX_BATCH_CHARS = 4_000_000;

const hashOf = body => crypto.createHash('sha256').update(body).digest('hex');
const bodyOf = value => JSON.stringify(value === undefined ? null : value);
const now = () => new Date().toISOString();

// A row's key: the item's id (or the field the store names) when it is a short string or number, else a hash of the
// item. Repeated keys get a ~n suffix, so a list with duplicates keeps all of them.
function keyed(entries, shape, keyField) {
  const seen = new Map();
  return entries.map(([objectKey, value]) => {
    const body = bodyOf(value), hash = hashOf(body);
    let key;
    if (shape === 'object') {
      key = String(objectKey);
      if (key.length > MAX_KEY) throw new Error(`legacy_records: a key of store is longer than ${MAX_KEY} characters.`);
    } else {
      const id = value && typeof value === 'object' ? value[keyField || 'id'] : value;
      key = (typeof id === 'string' && id && id.length <= 150) || (typeof id === 'number' && Number.isFinite(id)) ? String(id) : `h:${hash.slice(0, 40)}`;
      const count = seen.get(key) || 0;
      seen.set(key, count + 1);
      if (count) key = `${key}~${count + 1}`;
    }
    return { key, body, hash };
  });
}

// New positions for the items in their new order. Existing rows keep their position while their relative order is
// unchanged (the usual case: items added at the front or back, removed, or edited in place); new items go into the
// gaps. Otherwise every row is renumbered.
function positions(items, old) {
  let last = -Infinity, ordered = true;
  for (const item of items) { const row = old.get(item.key); if (!row) continue; if (row.position <= last) { ordered = false; break; } last = row.position; }
  const out = new Array(items.length);
  if (ordered) {
    let i = 0;
    while (i < items.length) {
      const row = old.get(items[i].key);
      if (row) { out[i] = row.position; i++; continue; }
      let j = i; while (j < items.length && !old.get(items[j].key)) j++;
      const left = i > 0 ? out[i - 1] : null, right = j < items.length ? old.get(items[j].key).position : null, n = j - i;
      if (left === null && right === null) for (let k = 0; k < n; k++) out[i + k] = k;
      else if (right === null) for (let k = 0; k < n; k++) out[i + k] = left + k + 1;
      else if (left === null) for (let k = 0; k < n; k++) out[i + k] = right - (n - k);
      else {
        const step = (right - left) / (n + 1);
        if (!(step > Math.max(Math.abs(left), Math.abs(right), 1) * 1e-9)) { ordered = false; break; }
        for (let k = 0; k < n; k++) out[i + k] = left + step * (k + 1);
      }
      i = j;
    }
  }
  if (!ordered) for (let i = 0; i < items.length; i++) out[i] = i;
  return out;
}

/** The writes that turn the stored rows (`old`, key → {position, hash}) into `data`. */
function plan(data, shape, old, keyField) {
  const entries = shape === 'object' ? Object.entries(data && typeof data === 'object' && !Array.isArray(data) ? data : {}) : (Array.isArray(data) ? data : []).map(value => [null, value]);
  const items = keyed(entries, shape, keyField), at = positions(items, old), keep = new Set();
  const inserts = [], updates = [], moves = [], rows = new Map();
  items.forEach((item, i) => {
    const position = at[i], row = old.get(item.key);
    keep.add(item.key);
    rows.set(item.key, { position, body: item.body, hash: item.hash });
    if (!row) inserts.push({ ...item, position });
    else if (row.hash !== item.hash) updates.push({ ...item, position });
    else if (row.position !== position) moves.push({ key: item.key, position });
  });
  const deletes = [...old.keys()].filter(key => !keep.has(key));
  return { inserts, updates, moves, deletes, rows };
}

function chunks(list, size, weight = () => 0, limit = Infinity) {
  const out = []; let current = [], total = 0;
  for (const item of list) {
    const w = weight(item);
    if (current.length && (current.length >= size || total + w > limit)) { out.push(current); current = []; total = 0; }
    current.push(item); total += w;
  }
  if (current.length) out.push(current);
  return out;
}

async function apply(db, store, changes, stamp) {
  for (const group of chunks(changes.deletes, 500))
    await db.run(`DELETE FROM legacy_records WHERE store = ? AND record_key IN (${group.map(() => '?').join(',')})`, store, ...group);
  for (const item of changes.updates)
    await db.run('UPDATE legacy_records SET position = ?, body = ?, body_hash = ?, updated_at = ? WHERE store = ? AND record_key = ?', item.position, item.body, item.hash, stamp, store, item.key);
  for (const group of chunks(changes.moves, Math.floor((MAX_PARAMS - 2) / 3)))
    await db.run(`UPDATE legacy_records SET position = CASE ${group.map(() => 'WHEN record_key = ? THEN ?').join(' ')} END WHERE store = ? AND record_key IN (${group.map(() => '?').join(',')})`,
      ...group.flatMap(item => [item.key, item.position]), store, ...group.map(item => item.key));
  for (const group of chunks(changes.inserts, Math.floor(MAX_PARAMS / 6), item => item.body.length, MAX_BATCH_CHARS))
    await db.run(`INSERT INTO legacy_records(store, record_key, position, body, body_hash, updated_at) VALUES ${group.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
      ...group.flatMap(item => [store, item.key, item.position, item.body, item.hash, stamp]));
}

const isDuplicate = error => /UNIQUE constraint|PRIMARY KEY|duplicate key|2627|2601/i.test(String(error && (error.message || error.number)));

// Takes the store's lock for the current transaction and returns the new version.
async function bump(db, store, stamp) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await db.run('UPDATE legacy_stores SET version = version + 1, updated_at = ? WHERE store = ?', stamp, store)).changes)
      return Number((await db.get('SELECT version FROM legacy_stores WHERE store = ?', store)).version);
    try { await db.run('INSERT INTO legacy_stores(store, version, updated_at) VALUES(?, 1, ?)', store, stamp); return 1; }
    catch (error) { if (!isDuplicate(error)) throw error; }
  }
  throw new Error(`legacy_stores: could not lock store ${store}.`);
}

class Rollback extends Error {}

/**
 * A record store over a Db ({ get, all, run, transaction } with ? parameters, as lib/db/client.ts).
 * `db` may be a function returning the Db (or a promise of it), so callers can open it lazily.
 */
function recordStore(db) {
  const open = async () => (typeof db === 'function' ? await db() : db);
  const cache = new Map(); // store → { version, rows: Map<key, { position, body, hash }> }

  async function load(handle, store, version) {
    const rows = new Map();
    for (const row of await handle.all('SELECT record_key, position, body, body_hash FROM legacy_records WHERE store = ? ORDER BY position, record_key', store))
      rows.set(row.record_key, { position: Number(row.position), body: row.body, hash: row.body_hash });
    return { version, rows };
  }
  const versionOf = async (handle, store) => Number((await handle.get('SELECT version FROM legacy_stores WHERE store = ?', store))?.version || 0);
  async function current(handle, store) {
    const version = await versionOf(handle, store);
    let hit = cache.get(store);
    if (!hit || hit.version !== version) { hit = await load(handle, store, version); cache.set(store, hit); }
    return hit;
  }
  function materialize(entry, shape) {
    const rows = [...entry.rows.entries()].sort((a, b) => a[1].position - b[1].position || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (shape === 'object') { const out = {}; for (const [key, row] of rows) out[key] = JSON.parse(row.body); return out; }
    return rows.map(([, row]) => JSON.parse(row.body));
  }

  return {
    /** The store's whole array or object (a fresh copy the caller may change). An unknown store reads as empty. */
    async read(store, shape = 'array') { return materialize(await current(await open(), store), shape); },
    /** A number that changes with every write; 0 for a store never written. */
    async version(store) { return versionOf(await open(), store); },
    /** Whether the store has ever been written (copied or used). */
    async exists(store) { return (await versionOf(await open(), store)) > 0; },
    /**
     * Read-modify-write under the store's lock. `change(data)` gets the current array or object and returns the new
     * one, or undefined to write nothing. It should not wait on the network: the lock is held while it runs.
     */
    async mutate(store, shape, change, { key } = {}) {
      const handle = await open();
      let saved = null, result;
      try {
        await handle.transaction(async () => {
          const stamp = now(), version = await bump(handle, store, stamp);
          let entry = cache.get(store);
          if (!entry || entry.version !== version - 1) entry = await load(handle, store, version - 1);
          const next = await change(materialize(entry, shape));
          if (next === undefined) throw new Rollback();
          const old = new Map([...entry.rows].map(([k, row]) => [k, { position: row.position, hash: row.hash }]));
          const changes = plan(next, shape, old, key);
          if (!changes.inserts.length && !changes.updates.length && !changes.moves.length && !changes.deletes.length) throw new Rollback();
          await apply(handle, store, changes, stamp);
          saved = { version, rows: changes.rows };
          result = changes;
        });
      } catch (error) {
        if (!(error instanceof Rollback)) { cache.delete(store); throw error; }
        return { written: false };
      }
      cache.set(store, saved);
      return { written: true, inserted: result.inserts.length, updated: result.updates.length + result.moves.length, deleted: result.deletes.length };
    },
    /** Replaces the store's contents. */
    async write(store, shape, data, options) { return this.mutate(store, shape, () => data, options); },
    /** Adds items at the end of an array store without reading it (logs such as failed-messages.jsonl). */
    async append(store, items) {
      if (!items.length) return;
      const handle = await open();
      let saved = null;
      await handle.transaction(async () => {
        const stamp = now(), version = await bump(handle, store, stamp);
        const start = Number((await handle.get('SELECT MAX(position) AS p FROM legacy_records WHERE store = ?', store))?.p ?? -1) + 1;
        const rows = items.map((value, i) => { const body = bodyOf(value); return { key: `a:${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}-${i}`, body, hash: hashOf(body), position: start + i }; });
        await apply(handle, store, { deletes: [], updates: [], moves: [], inserts: rows }, stamp);
        const before = cache.get(store);
        if (before && before.version === version - 1) { const next = new Map(before.rows); for (const row of rows) next.set(row.key, { position: row.position, body: row.body, hash: row.hash }); saved = { version, rows: next }; }
      });
      if (saved) cache.set(store, saved); else cache.delete(store);
    },
    /** Forgets cached rows (tests). */
    reset() { cache.clear(); },
  };
}

// ---------- A minimal SQL Server Db for processes without the panel's client (the agent) ----------
// Only what recordStore needs: ? → @pN, typed parameters, and transactions that the calls inside join.
function mssqlRecordsDb(connection, sql = require('mssql')) {
  const { AsyncLocalStorage } = require('node:async_hooks');
  const scope = new AsyncLocalStorage();
  const pool = new sql.ConnectionPool(connection);
  let connecting = null;
  const connected = () => (pool.connected ? Promise.resolve() : (connecting ??= pool.connect().catch(error => { connecting = null; throw error; })));
  const execute = async (text, params) => {
    await connected();
    let i = 0;
    const statement = text.replace(/\?/g, () => `@p${++i}`);
    if (i !== params.length) throw new Error(`The statement has ${i} parameter(s) but ${params.length} value(s) were given.`);
    const tx = scope.getStore();
    const run = () => {
      const request = tx ? new sql.Request(tx.transaction) : pool.request();
      params.forEach((value, n) => {
        const name = `p${n + 1}`;
        if (value === null || value === undefined) request.input(name, sql.NVarChar(4000), null);
        else if (typeof value === 'number') request.input(name, Number.isInteger(value) ? sql.BigInt : sql.Float, value);
        else { const s = String(value); request.input(name, s.length > 4000 ? sql.NVarChar(sql.MAX) : sql.NVarChar(4000), s); }
      });
      return request.query(statement);
    };
    if (!tx) return run();
    const result = tx.queue.then(run, run);
    tx.queue = result.catch(() => undefined);
    return result;
  };
  const rows = result => (result.recordset || []).map(row => ({ ...row }));
  return {
    dialect: 'mssql',
    async get(text, ...params) { return rows(await execute(text, params))[0]; },
    async all(text, ...params) { return rows(await execute(text, params)); },
    async run(text, ...params) { const result = await execute(text, params); return { changes: (result.rowsAffected || []).reduce((a, b) => a + b, 0) }; },
    async transaction(work) {
      if (scope.getStore()) return work();
      await connected();
      const transaction = new sql.Transaction(pool);
      await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
      try { const result = await scope.run({ transaction, queue: Promise.resolve() }, work); await transaction.commit(); return result; }
      catch (error) { await transaction.rollback().catch(() => undefined); throw error; }
    },
    async close() { await pool.close(); },
  };
}

// ---------- The store names ----------
// Every file that moved, by owner (path relative to the panel's data/ folder or the agent's folder). The panel and the
// agent name their stores the same way and use the same row key, so either can write a store the other reads.
//   shape: array (rows in order) or object (rows by property); key: the item field used as the row key (default id);
//   format: jsonl for append-only logs (one JSON value per line in file mode); pretty: false for compact files.
const WEB_STORES = {
  'activity-log.json': { shape: 'array' }, 'calendar.json': { shape: 'array' }, 'campaigns.json': { shape: 'array' },
  'campaign-audiences.json': { shape: 'array' }, 'content-history.json': { shape: 'array', pretty: false },
  'post-history.json': { shape: 'array' }, 'post-history-hidden.json': { shape: 'array' }, 'scheduled-posts.json': { shape: 'array' },
  'seo-work-items.json': { shape: 'array' }, 'social-tokens.json': { shape: 'object' }, 'oauth-state.json': { shape: 'object' },
  'email-suppressions.json': { shape: 'object' }, 'whatsapp-consents.json': { shape: 'object' }, 'crewin-iys-email.json': { shape: 'object' },
  'crewin-iys-email-pending.json': { shape: 'object' }, 'crewin-link-tags.json': { shape: 'array', key: 'tag', pretty: false },
  // data/activity-log-cleared-at.txt (a number) in file mode; { at } as a store.
  'activity-log-cleared-at.json': { shape: 'object' },
};
const AGENT_STORES = {
  'job-queue.json': { shape: 'array' }, '.userbot-groups.json': { shape: 'array' },
  'data/posted-jobs.json': { shape: 'array', key: 'ilanId' }, 'data/review-queue.json': { shape: 'array' },
  'data/group-stats.json': { shape: 'object' }, 'data/pipeline-state.json': { shape: 'object', pretty: false }, 'data/agent-config.json': { shape: 'object' },
  'data/failed-messages.jsonl': { shape: 'array', format: 'jsonl' }, 'data/discovered-groups.json': { shape: 'array' },
  'data/processed-messages.json': { shape: 'array', pretty: false }, 'data/readonly-groups.json': { shape: 'array', pretty: false },
  'data/broadcast-log.json': { shape: 'object' }, 'data/api-usage.json': { shape: 'object' }, 'data/link-tags.jsonl': { shape: 'array', format: 'jsonl' },
};
const storeName = (owner, file) => `${owner}:${file.replace(/^data\//, '').replace(/^\./, '').replace(/\.jsonl?$/, '')}`;
/** The shared options of a known store ({} for one not listed). */
const storeOptions = (owner, file) => ({ ...((owner === 'web' ? WEB_STORES : AGENT_STORES)[file] || {}) });

/** 'db' when the stores live in the database (PLATFORM_DATABASE_PROVIDER=mssql, or CREWIN_LEGACY_STORE=db), else 'file'. */
function legacyStoreMode(env = process.env) {
  if (env.CREWIN_LEGACY_STORE === 'db' || env.CREWIN_LEGACY_STORE === 'file') return env.CREWIN_LEGACY_STORE;
  return env.PLATFORM_DATABASE_PROVIDER === 'mssql' ? 'db' : 'file';
}

module.exports = { recordStore, mssqlRecordsDb, plan, positions, legacyStoreMode, storeName, storeOptions, WEB_STORES, AGENT_STORES, hashOf };
