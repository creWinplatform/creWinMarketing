const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// store.js: dosya modu (geçici dosyalar) ve db modu (bellekte SQLite; panelin legacy_records/legacy_stores tabloları).
const storeModule = require('../modules/store');
const { store, read, mutate, write, append, setStoreDb, SHARED } = storeModule;
const webDir = path.join(__dirname, '..', '..', 'crewinjob-web');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-store-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function withMode(value, work) {
  return async () => {
    const prev = process.env.PLATFORM_LEGACY_STORE;
    process.env.PLATFORM_LEGACY_STORE = value;
    try { await work(); } finally {
      if (prev === undefined) delete process.env.PLATFORM_LEGACY_STORE; else process.env.PLATFORM_LEGACY_STORE = prev;
    }
  };
}

test('file mode: array store round trip, pretty JSON as before, undefined writes nothing', withMode('file', async () => {
  const def = store('data/posted-jobs.json', { file: path.join(dir, 'nested', 'posted-jobs.json') });
  assert.deepEqual(await read(def), [], 'a missing file reads as empty');
  await mutate(def, () => undefined);
  assert.equal(fs.existsSync(def.file), false, 'undefined writes nothing');
  await write(def, [{ ilanId: 1, a: 'x' }]);
  await mutate(def, list => [...list, { ilanId: 2 }]);
  const expected = [{ ilanId: 1, a: 'x' }, { ilanId: 2 }];
  assert.deepEqual(await read(def), expected);
  assert.equal(fs.readFileSync(def.file, 'utf8'), JSON.stringify(expected, null, 2));
  assert.deepEqual(fs.readdirSync(path.dirname(def.file)), ['posted-jobs.json'], 'no temp files left');
  // Aynı süreçte eşzamanlı yazımlar sıraya girer; hiçbiri kaybolmaz
  await Promise.all(Array.from({ length: 10 }, (_, i) => mutate(def, list => [...list, { ilanId: 100 + i }])));
  assert.equal((await read(def)).length, 12);
  // Hata veren değişiklik yazmaz ve hatayı iletir
  await assert.rejects(mutate(def, () => { throw new Error('boom'); }), /boom/);
  assert.equal((await read(def)).length, 12);
}));

test('file mode: compact store and object store keep the old formats', withMode('file', async () => {
  const compact = store('data/processed-messages.json', { file: path.join(dir, 'processed-messages.json') });
  assert.equal(compact.pretty, false);
  await write(compact, ['a', 'b']);
  assert.equal(fs.readFileSync(compact.file, 'utf8'), '["a","b"]');

  const state = store('data/pipeline-state.json', { file: path.join(dir, 'pipeline-state.json') });
  await write(state, { running: 'x', pid: 1 });
  assert.equal(fs.readFileSync(state.file, 'utf8'), '{"running":"x","pid":1}', 'pipeline-state.json was written compact');

  const stats = store('data/group-stats.json', { file: path.join(dir, 'group-stats.json') });
  assert.deepEqual(await read(stats), {});
  await mutate(stats, s => ({ ...s, '-100': { posted: 1 } }));
  await mutate(stats, s => { s['-100'].posted++; s['-200'] = { posted: 0 }; return s; });
  const expected = { '-100': { posted: 2 }, '-200': { posted: 0 } };
  assert.deepEqual(await read(stats), expected);
  assert.equal(fs.readFileSync(stats.file, 'utf8'), JSON.stringify(expected, null, 2));
  // Biçimi tutmayan dosya boş okunur (dizi beklenirken nesne gibi)
  fs.writeFileSync(path.join(dir, 'wrong.json'), '{"a":1}');
  assert.deepEqual(await read(store('job-queue.json', { file: path.join(dir, 'wrong.json') })), []);
}));

test('file mode: jsonl append adds one line per item', withMode('file', async () => {
  const def = store('data/failed-messages.jsonl', { file: path.join(dir, 'logs', 'failed-messages.jsonl') });
  await append(def, []);
  assert.equal(fs.existsSync(def.file), false);
  await append(def, [{ a: 1 }]);
  await append(def, [{ b: 2 }, { c: 'ç' }]);
  assert.equal(fs.readFileSync(def.file, 'utf8'), '{"a":1}\n{"b":2}\n{"c":"ç"}\n');
  fs.appendFileSync(def.file, '{"torn":\n');
  assert.deepEqual(await read(def), [{ a: 1 }, { b: 2 }, { c: 'ç' }], 'a torn line is skipped');
}));

function sqliteDb() {
  const Database = require(path.join(webDir, 'node_modules', 'better-sqlite3'));
  const h = new Database(':memory:');
  h.exec('CREATE TABLE legacy_stores (store TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version >= 0), updated_at TEXT NOT NULL); CREATE TABLE legacy_records (store TEXT NOT NULL, record_key TEXT NOT NULL, position REAL NOT NULL, body TEXT NOT NULL, body_hash TEXT NOT NULL CHECK(length(body_hash) = 64), updated_at TEXT NOT NULL, PRIMARY KEY(store,record_key));');
  return {
    handle: h,
    dialect: 'sqlite',
    get: (s, ...p) => Promise.resolve(h.prepare(s).get(...p)),
    all: (s, ...p) => Promise.resolve(h.prepare(s).all(...p)),
    run: (s, ...p) => Promise.resolve({ changes: h.prepare(s).run(...p).changes }),
    transaction: async work => { h.exec('BEGIN IMMEDIATE'); try { const r = await work(); h.exec('COMMIT'); return r; } catch (e) { h.exec('ROLLBACK'); throw e; } },
  };
}

test('db mode: the same calls read and write legacy_records rows', withMode('mssql', async () => {
  const db = sqliteDb();
  setStoreDb(db);
  try {
    const posted = store('data/posted-jobs.json', { file: path.join(dir, 'never-written.json') });
    assert.equal(posted.name, 'agent:posted-jobs');
    assert.deepEqual(await read(posted), []);
    await write(posted, [{ ilanId: 7, t: 'a' }, { ilanId: 8, t: 'b' }]);
    await mutate(posted, list => { list.find(p => p.ilanId === 8).t = 'B'; return [...list, { ilanId: 9 }]; });
    assert.deepEqual(await read(posted), [{ ilanId: 7, t: 'a' }, { ilanId: 8, t: 'B' }, { ilanId: 9 }]);
    const keys = db.handle.prepare("SELECT record_key FROM legacy_records WHERE store = 'agent:posted-jobs' ORDER BY position").all().map(r => r.record_key);
    assert.deepEqual(keys, ['7', '8', '9'], 'posted jobs are keyed by ilanId');
    assert.equal(fs.existsSync(posted.file), false, 'db mode touches no file');

    await mutate(posted, () => undefined);
    for (let i = 0; i < 5; i++) await mutate(posted, list => [...list, { ilanId: 20 + i }]);
    assert.equal((await read(posted)).length, 8);
    await assert.rejects(mutate(posted, () => { throw new Error('boom'); }), /boom/);
    assert.equal((await read(posted)).length, 8);

    const stats = store('data/group-stats.json');
    await mutate(stats, s => ({ ...s, '-100': { posted: 1 } }));
    await mutate(stats, s => { s['-100'].posted++; return s; });
    assert.deepEqual(await read(stats), { '-100': { posted: 2 } });

    const failed = store('data/failed-messages.jsonl');
    await append(failed, [{ a: 1 }]);
    await append(failed, [{ b: 2 }, { c: 3 }]);
    assert.deepEqual(await read(failed), [{ a: 1 }, { b: 2 }, { c: 3 }]);
  } finally {
    setStoreDb(null);
  }
}));

test('the agent store options match the panel (AGENT_STORES in legacy-records.cjs)', () => {
  const { AGENT_STORES, storeName } = require(path.join(webDir, 'lib', 'db', 'legacy-records.cjs'));
  assert.deepEqual(SHARED, AGENT_STORES);
  for (const file of Object.keys(SHARED)) assert.equal(storeModule.storeName(file), storeName('agent', file));
  for (const def of Object.values(storeModule.stores)) assert.ok(SHARED[path.relative(path.join(__dirname, '..'), def.file).replace(/\\/g, '/')] || process.env.CREWIN_LINK_TAGS_FILE, def.file);
});

test('the tables are used only with PLATFORM_LEGACY_STORE=mssql, not because the platform runs on SQL Server', () => {
  const { mode } = require('../modules/store');
  assert.equal(mode({}), 'file');
  assert.equal(mode({ PLATFORM_DATABASE_PROVIDER: 'mssql' }), 'file');
  assert.equal(mode({ PLATFORM_DATABASE_PROVIDER: 'mssql', PLATFORM_LEGACY_STORE: 'mssql' }), 'db');
});
