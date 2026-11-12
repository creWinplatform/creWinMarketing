// The Crewin JSON stores (lib/legacy-store.ts over lib/db/legacy-records.cjs): files as before in file mode, rows in
// legacy_records/legacy_stores in db mode — on SQLite here, and on SQL Server when appsettings.Test.json (or
// PLATFORM_MSSQL_TEST_CONNECTION) points at a local test server (127.0.0.1 or localhost).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('./platform-loader.cjs');
const records = require('../lib/db/legacy-records.cjs');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-store-'));
const withEnv = async (values, work) => {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return await work(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
};
// The platform schema in memory, behind the async Db the application uses.
const sqlite = () => load('../db/client.ts').sqliteDb(load('database.ts').openPlatformDatabase(':memory:'));
// Values made inside the module loader's context have its own prototypes; compare them as plain JSON.
const plain = value => JSON.parse(JSON.stringify(value));
const statements = db => {
  const seen = [];
  const wrap = name => (sql, ...params) => { if (!/^\s*SELECT/i.test(sql)) seen.push(sql.trim().split(/\s+/)[0].toUpperCase()); return db[name](sql, ...params); };
  return { db: { dialect: db.dialect, get: wrap('get'), all: wrap('all'), run: wrap('run'), transaction: work => db.transaction(work) }, seen };
};

// ---------- positions and the write plan ----------
test('only changed rows are planned: prepend, edit, delete keep the other rows where they are', () => {
  const old = new Map([['a', { position: 0, hash: records.hashOf('{"id":"a"}') }], ['b', { position: 1, hash: records.hashOf('{"id":"b"}') }], ['c', { position: 2, hash: records.hashOf('{"id":"c"}') }]]);
  const plan = records.plan([{ id: 'z' }, { id: 'a' }, { id: 'b', v: 2 }], 'array', old);
  assert.deepEqual(plan.inserts.map(row => [row.key, row.position]), [['z', -1]]);
  assert.deepEqual(plan.updates.map(row => row.key), ['b']);
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.deletes, ['c']);
});
test('new items go into the gaps; a reorder renumbers; duplicates and items without ids keep their own rows', () => {
  const old = new Map([['a', { position: 0, hash: 'x' }], ['b', { position: 1, hash: 'x' }]]);
  assert.deepEqual(records.positions([{ key: 'a' }, { key: 'm' }, { key: 'n' }, { key: 'b' }, { key: 'z' }], old), [0, 1 / 3, 2 / 3, 1, 2]);
  assert.deepEqual(records.positions([{ key: 'b' }, { key: 'a' }], old), [0, 1]);
  const plan = records.plan(['x', 'x', { name: 'no id' }, 7], 'array', new Map());
  assert.equal(new Set(plan.inserts.map(row => row.key)).size, 4);
  assert.deepEqual(plan.inserts.map(row => row.key).slice(0, 2), ['x', 'x~2']);
  assert.throws(() => records.plan({ ['k'.repeat(171)]: 1 }, 'object', new Map()), /longer than 170/);
});
test('the panel and the agent describe the shared stores the same way', () => {
  assert.equal(records.storeName('web', 'content-history.json'), 'web:content-history');
  assert.equal(records.storeName('agent', '.userbot-groups.json'), 'agent:userbot-groups');
  assert.equal(records.storeName('agent', 'data/failed-messages.jsonl'), 'agent:failed-messages');
  // The tables are used only when PLATFORM_LEGACY_STORE=mssql: live ryzevo.com already runs on SQL Server while the
  // Crewin stores are files, and the switch is turned on in phase 4 after the copy.
  assert.equal(records.legacyStoreMode({}), 'file');
  assert.equal(records.legacyStoreMode({ PLATFORM_DATABASE_PROVIDER: 'mssql' }), 'file');
  assert.equal(records.legacyStoreMode({ PLATFORM_DATABASE_PROVIDER: 'mssql', PLATFORM_LEGACY_STORE: 'file' }), 'file');
  assert.equal(records.legacyStoreMode({ PLATFORM_DATABASE_PROVIDER: 'mssql', PLATFORM_LEGACY_STORE: 'mssql' }), 'db');
});

test('switch off: with the platform on SQL Server the panel modules still read and write the files, not the tables', async () => {
  const dir = temp(), db = sqlite();
  fs.writeFileSync(path.join(dir, 'seo-work-items.json'), JSON.stringify([{ id: 'seo-1', url: 'https://example.com', title: 'From the file', status: 'proposed', updatedAt: '2026-11-01' }]));
  fs.writeFileSync(path.join(dir, 'calendar.json'), JSON.stringify([{ id: 'cal_1', date: '2026-11-12' }]));
  await withEnv({ CREWIN_WEB_DATA_DIR: dir, PLATFORM_DATABASE_PROVIDER: 'mssql', PLATFORM_LEGACY_STORE: '' }, async () => {
    const store = load('../legacy-store.ts');
    store.setLegacyStoreDb(db); // were the switch ignored, the empty tables would be read
    try {
      assert.equal(store.legacyStoreMode(), 'file');
      const seo = load('../seo-work-items.ts');
      assert.deepEqual(plain((await seo.listSeoWorkItems()).map(item => item.title)), ['From the file']);
      assert.deepEqual(plain(await store.readStore(store.webStore('calendar.json', 'array'))), [{ id: 'cal_1', date: '2026-11-12' }]);
      await seo.updateSeoWorkItem('seo-1', 'approved');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'seo-work-items.json'), 'utf8'))[0].status, 'approved', 'the write went to the file');
      assert.equal((await db.all('SELECT store FROM legacy_stores')).length, 0, 'the tables stay empty');
    } finally { store.setLegacyStoreDb(null); await db.close(); }
  });
});

// ---------- file mode: the files exactly as before ----------
test('file mode keeps the JSON files: atomic writes, compact where asked, jsonl appends, a summary per change', async () => {
  const dir = temp();
  await withEnv({ CREWIN_WEB_DATA_DIR: dir, PLATFORM_LEGACY_STORE: 'file' }, async () => {
    const store = load('../legacy-store.ts');
    const list = store.webStore('seo-work-items.json', 'array'), tokens = store.webStore('social-tokens.json', 'object'), history = store.webStore('content-history.json', 'array');
    assert.deepEqual(plain(await store.readStore(list)), []);
    await store.mutateStore(list, items => [{ id: 'a' }, ...items]);
    const result = await store.withStore(list, ({ load, save }) => { const items = load(); items.push({ id: 'b' }); save(items); return items.length; });
    assert.equal(result, 2);
    assert.equal(fs.readFileSync(path.join(dir, 'seo-work-items.json'), 'utf8'), JSON.stringify([{ id: 'a' }, { id: 'b' }], null, 2));
    await store.writeStore(history, [{ id: 'h' }]);
    assert.equal(fs.readFileSync(path.join(dir, 'content-history.json'), 'utf8'), '[{"id":"h"}]', 'content history stays compact');
    await store.mutateStore(tokens, data => ({ ...data, linkedin: { accessToken: 't' } }));
    assert.deepEqual(plain(await store.readStore(tokens)), { linkedin: { accessToken: 't' } });
    fs.writeFileSync(path.join(dir, 'calendar.json'), '{"not":"a list"}');
    assert.deepEqual(plain(await store.readStore(store.webStore('calendar.json', 'array'))), [], 'a file of the wrong shape reads as empty');
    const log = store.webStore('log.jsonl', 'array', { format: 'jsonl' });
    await store.appendStore(log, [{ n: 1 }]); await store.appendStore(log, [{ n: 2 }]);
    fs.appendFileSync(log.file, '{"torn');
    assert.deepEqual(plain(await store.readStore(log)), [{ n: 1 }, { n: 2 }]);
    // Concurrent writers in one process are serialised by the file lock.
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.mutateStore(list, items => [...items, { id: `c${i}` }])));
    assert.equal((await store.readStore(list)).length, 22);
    let reads = 0;
    const count = () => store.storeSummary(list, 0, data => { reads++; return data.length; }, 'test');
    assert.equal(await count(), 22); assert.equal(await count(), 22); assert.equal(reads, 1, 'unchanged → no re-read');
    await new Promise(resolve => setTimeout(resolve, 20));
    await store.mutateStore(list, items => items.slice(1));
    assert.equal(await count(), 21); assert.equal(reads, 2);
  });
});

// ---------- db mode: one suite, run on SQLite and (when configured) SQL Server ----------
function dbSuite(name, open) {
  test(`${name}: arrays and objects round-trip; only changed rows are written; a failed change writes nothing`, async () => {
    const { db, close } = await open();
    try {
      const base = records.recordStore(db), probe = statements(db), store = records.recordStore(probe.db), s = `t:${Date.now().toString(36)}`;
      assert.deepEqual(await store.read(`${s}:list`), []);
      assert.equal(await store.exists(`${s}:list`), false);
      const items = Array.from({ length: 30 }, (_, i) => ({ id: `item-${i}`, text: `Ä é 漢字 😀 ${i}`, image: 'x'.repeat(i === 5 ? 9000 : 10) }));
      await store.write(`${s}:list`, 'array', items);
      assert.deepEqual(await base.read(`${s}:list`), items, 'another reader sees the same list');
      probe.seen.length = 0;
      await store.mutate(`${s}:list`, 'array', list => { list[3].text = 'changed'; return [{ id: 'new' }, ...list.filter(item => item.id !== 'item-9')]; });
      assert.deepEqual(probe.seen.filter(word => word !== 'UPDATE').sort(), ['DELETE', 'INSERT'], 'one delete and one insert');
      assert.equal(probe.seen.filter(word => word === 'UPDATE').length, 2, 'the version bump and the one edited row');
      const after = await base.read(`${s}:list`);
      assert.deepEqual(after.map(item => item.id).slice(0, 3), ['new', 'item-0', 'item-1']);
      assert.equal(after.length, 30); assert.equal(after.find(item => item.id === 'item-3').text, 'changed');
      // A reorder renumbers, and the order holds.
      await store.mutate(`${s}:list`, 'array', list => list.reverse());
      assert.deepEqual((await base.read(`${s}:list`)).map(item => item.id), after.map(item => item.id).reverse());
      // Nothing changed → nothing written, version unchanged.
      const version = await base.version(`${s}:list`);
      assert.deepEqual(await store.mutate(`${s}:list`, 'array', list => list), { written: false });
      assert.equal(await base.version(`${s}:list`), version);
      await assert.rejects(store.mutate(`${s}:list`, 'array', () => { throw new Error('boom'); }), /boom/);
      assert.equal((await base.read(`${s}:list`)).length, 30);
      assert.equal(await base.version(`${s}:list`), version, 'a failed change leaves the store and its version');
      // Objects: one row per key.
      await store.write(`${s}:object`, 'object', { linkedin: { accessToken: 'a' }, twitter: null });
      await store.mutate(`${s}:object`, 'object', data => { delete data.twitter; data.facebook = { pageId: '1' }; return data; });
      assert.deepEqual(await base.read(`${s}:object`, 'object'), { linkedin: { accessToken: 'a' }, facebook: { pageId: '1' } });
      // Appends keep their order without reading the store.
      await store.append(`${s}:log`, [{ n: 1 }, { n: 2 }]); await base.append(`${s}:log`, [{ n: 3 }]);
      assert.deepEqual(await store.read(`${s}:log`), [{ n: 1 }, { n: 2 }, { n: 3 }]);
      // A cached copy is dropped when another writer changed the store.
      await base.mutate(`${s}:list`, 'array', list => list.slice(0, 2));
      assert.equal((await store.read(`${s}:list`)).length, 2);
      // A large batch (more rows than one statement can carry) round-trips.
      const many = Array.from({ length: 1200 }, (_, i) => ({ id: i, v: i % 7 }));
      await store.write(`${s}:many`, 'array', many);
      assert.deepEqual(await base.read(`${s}:many`), many);
      for (const suffix of ['list', 'object', 'log', 'many']) { await db.run('DELETE FROM legacy_records WHERE store = ?', `${s}:${suffix}`); await db.run('DELETE FROM legacy_stores WHERE store = ?', `${s}:${suffix}`); }
    } finally { await close(); }
  });
  test(`${name}: concurrent writers from separate stores (processes) lose no update`, async () => {
    const { db, close } = await open();
    try {
      const s = `c:${Date.now().toString(36)}`, writers = [records.recordStore(db), records.recordStore(db), records.recordStore(db)];
      await Promise.all(Array.from({ length: 24 }, (_, i) => writers[i % 3].mutate(s, 'array', list => [...list, { id: `w${i}` }])));
      const list = await records.recordStore(db).read(s);
      assert.equal(list.length, 24);
      assert.equal(new Set(list.map(item => item.id)).size, 24);
      await db.run('DELETE FROM legacy_records WHERE store = ?', s); await db.run('DELETE FROM legacy_stores WHERE store = ?', s);
    } finally { await close(); }
  });
}
dbSuite('sqlite', async () => { const db = sqlite(); return { db, close: async () => db.close() }; });

function testConnection() {
  if (process.env.PLATFORM_MSSQL_TEST_CONNECTION) return process.env.PLATFORM_MSSQL_TEST_CONNECTION;
  const file = path.join(__dirname, '..', 'appsettings.Test.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).ConnectionStrings.Platform : '';
}
// Only a local test server: the suite creates the two tables if they are missing.
const connection = (() => { const value = testConnection(); return value && /^(127\.0\.0\.1|localhost)(,\d+)?$/i.test(require('../lib/db/settings.cjs').describe(value).server) ? value : ''; })();
if (connection) dbSuite('mssql', async () => {
  const sql = require('mssql'), { describe } = require('../lib/db/settings.cjs'), target = describe(connection);
  // A local test server gets its database on first use; a remote one must already have it.
  if (/^(127\.0\.0\.1|localhost)(,\d+)?$/i.test(target.server) && target.database) {
    const master = await new sql.ConnectionPool(connection.replace(/Database=[^;]*/i, 'Database=master')).connect();
    const name = target.database.replace(/[^\w]/g, '');
    await master.request().batch(`IF DB_ID('${name}') IS NULL CREATE DATABASE [${name}]`);
    await master.close();
  }
  const pool = await new sql.ConnectionPool(connection).connect();
  const tableSql = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'mssql-schema.sql'), 'utf8').split(/;\s*\n/)
    .map(s => s.replace(/^--.*$/gm, '').trim()).filter(s => /\[legacy_(records|stores)\]/.test(s) && /^CREATE/.test(s));
  for (const statement of tableSql) {
    const table = /(?:TABLE|ON) \[(legacy_\w+)\]/.exec(statement)[1];
    const exists = /^CREATE TABLE/.test(statement) ? `OBJECT_ID('${table}') IS NULL` : `NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${/INDEX \[(\w+)\]/.exec(statement)[1]}')`;
    await pool.request().batch(`IF ${exists} EXEC('${statement.replace(/'/g, "''")}')`);
  }
  const { mssqlDb } = load('../db/client.ts');
  return { db: mssqlDb(pool, sql), close: () => pool.close() };
});

// ---------- the panel modules in db mode ----------
test('db mode: the panel modules read and write the tables, not the files', async () => {
  const dir = temp(), db = sqlite();
  await withEnv({ CREWIN_WEB_DATA_DIR: dir, PLATFORM_LEGACY_STORE: 'mssql', AUTH_SECRET: 'legacy-store-fixture-secret' }, async () => {
    const store = load('../legacy-store.ts');
    store.setLegacyStoreDb(db);
    try {
      const seo = load('../seo-work-items.ts'), campaigns = load('../campaigns.ts'), posts = load('../scheduled-posts.ts'), tokens = load('../social-tokens.ts');
      const created = await seo.createSeoWorkItem({ url: 'https://example.com', title: 'Title', recommendation: 'r', evidence: 'e', priority: 'high' });
      await seo.updateSeoWorkItem(created.id, 'approved');
      assert.deepEqual(plain((await seo.listSeoWorkItems()).map(item => item.status)), ['approved']);
      const post = await posts.createPost({ platforms: ['linkedin'], content: 'x', scheduledAt: new Date(Date.now() - 1000).toISOString() });
      const [first, second] = await Promise.all([posts.claimDuePosts(), posts.claimDuePosts()]);
      assert.equal(first.length + second.length, 1, 'a due post is claimed once');
      assert.equal((await posts.loadPosts())[0].id, post.id);
      const campaign = await campaigns.createCampaign({ name: 'Kış', objective: 'awareness', audience: {}, channels: { social: [], email: true }, content: {} });
      assert.equal((await campaigns.getCampaign(campaign.id)).name, 'Kış');
      await tokens.setToken('linkedin', { accessToken: 'tok' });
      await tokens.saveOAuthState('state-1', 'linkedin');
      assert.equal((await tokens.getToken('linkedin')).accessToken, 'tok');
      assert.equal((await tokens.consumeOAuthState('state-1')).platform, 'linkedin');
      assert.equal(await tokens.consumeOAuthState('state-1'), null, 'a state is used once');
      const names = (await db.all('SELECT store FROM legacy_stores ORDER BY store')).map(row => row.store);
      assert.deepEqual(names, ['web:campaigns', 'web:oauth-state', 'web:scheduled-posts', 'web:seo-work-items', 'web:social-tokens']);
      assert.deepEqual(fs.readdirSync(dir), [], 'no file was written');
    } finally { store.setLegacyStoreDb(null); await db.close(); }
  });
});
// The agent's own SQL Server adapter (no translator: the record statements are portable SQL).
if (connection) dbSuite('mssql (agent adapter)', async () => {
  const db = records.mssqlRecordsDb(connection);
  return { db, close: () => db.close() };
});

test('db:copy-legacy refuses a server that is not local without --live, and with the switch already on', () => {
  const { spawnSync } = require('node:child_process');
  const run = (args, extra = {}) => spawnSync(process.execPath, ['scripts/legacy-copy.cjs', ...args], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PLATFORM_MSSQL_CONNECTION: 'Server=rds.example.invalid,1433;Database=Ryzevo;User Id=u;Password=not-a-secret', PLATFORM_LEGACY_STORE: '', ...extra } });
  const plain = run([]);
  assert.equal(plain.status, 2); assert.match(plain.stderr, /needs --live/); assert.doesNotMatch(plain.stderr + plain.stdout, /not-a-secret/);
  const on = run(['--live'], { PLATFORM_LEGACY_STORE: 'mssql' });
  assert.equal(on.status, 2); assert.match(on.stderr, /already on/);
});

test('routes await the async Crewin store reads (an unawaited list was sent as {})', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'data', 'seo-work-items', 'route.ts'), 'utf8');
  assert.match(route, /NextResponse\.json\(await listSeoWorkItems\(\)\)/);
  assert.doesNotMatch(route, /NextResponse\.json\(listSeoWorkItems\(\)\)/);
});
