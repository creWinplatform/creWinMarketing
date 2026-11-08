// The async Db interface behaves the same on SQLite and SQL Server: statements, upserts, transactions and savepoints.
// SQL Server runs only when appsettings.Test.json (or PLATFORM_MSSQL_TEST_CONNECTION) points at a test server.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./platform-loader.cjs');
const { sqliteDb, mssqlDb } = load('../db/client.ts');

const TABLE = 'CREATE TABLE zz_client (id TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, label TEXT, data BLOB)';
function testConnection() {
  if (process.env.PLATFORM_MSSQL_TEST_CONNECTION) return process.env.PLATFORM_MSSQL_TEST_CONNECTION;
  const file = path.join(__dirname, '..', 'appsettings.Test.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).ConnectionStrings.Platform : '';
}

const backends = [['sqlite', async () => {
  const handle = new (require('better-sqlite3'))(':memory:');
  handle.exec(TABLE);
  return sqliteDb(handle);
}]];
const connection = testConnection();
if (connection) backends.push(['mssql', async () => {
  const sql = require('mssql');
  const pool = await new sql.ConnectionPool(connection).connect();
  await (await pool.request()).batch("IF OBJECT_ID('zz_client') IS NOT NULL DROP TABLE zz_client; CREATE TABLE zz_client (id NVARCHAR(170) COLLATE Latin1_General_100_BIN2 PRIMARY KEY, n BIGINT NOT NULL DEFAULT 0, label NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2, data VARBINARY(MAX))");
  return mssqlDb(pool, sql);
}]);

for (const [name, open] of backends) {
  test(`${name}: statements, upsert, numbers and binary values`, async () => {
    const db = await open();
    try {
      assert.equal((await db.run('INSERT INTO zz_client(id,n,label) VALUES(?,?,?)', 'a', 1, 'Ä é 漢字 😀')).changes, 1);
      assert.deepEqual({ ...(await db.get('SELECT id,n,label FROM zz_client WHERE id=?', 'a')) }, { id: 'a', n: 1, label: 'Ä é 漢字 😀' });
      // Case-sensitive like SQLite's default BINARY collation.
      assert.equal(await db.get('SELECT id FROM zz_client WHERE id=?', 'A'), undefined);
      await db.run('INSERT INTO zz_client(id,n) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET n=n+1', 'a');
      await db.run('INSERT INTO zz_client(id,n) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET n=n+1', 'b');
      assert.deepEqual((await db.all('SELECT id,n FROM zz_client ORDER BY id')).map(r => [r.id, r.n]), [['a', 2], ['b', 1]]);
      assert.equal((await db.run('INSERT OR IGNORE INTO zz_client(id,n) VALUES(?,?)', 'a', 9)).changes, 0, 'a duplicate key is skipped');
      assert.equal((await db.get('SELECT n FROM zz_client WHERE id=?', 'a')).n, 2);
      await db.run('UPDATE zz_client SET data=? WHERE id=?', Buffer.from([0, 1, 2, 255]), 'b');
      assert.deepEqual([...(await db.get('SELECT data FROM zz_client WHERE id=?', 'b')).data], [0, 1, 2, 255]);
      assert.equal((await db.get('SELECT COUNT(*) AS c, SUM(n) AS s FROM zz_client')).s, 3, 'BIGINT sums come back as numbers');
      assert.deepEqual((await db.all('SELECT id FROM zz_client ORDER BY id DESC LIMIT ?', 1)).map(r => r.id), ['b']);
      const statement = db.prepare('SELECT n FROM zz_client WHERE id=?');
      assert.equal((await statement.get('b')).n, 1);
    } finally { await db.close(); }
  });

  test(`${name}: transactions commit, roll back, nest as savepoints and keep other statements out`, async () => {
    const db = await open();
    try {
      await db.transaction(async () => { await db.run('INSERT INTO zz_client(id) VALUES(?)', 't1'); await db.run('INSERT INTO zz_client(id) VALUES(?)', 't2'); });
      await assert.rejects(db.transaction(async () => { await db.run('INSERT INTO zz_client(id) VALUES(?)', 't3'); throw new Error('stop'); }), /stop/);
      assert.deepEqual((await db.all("SELECT id FROM zz_client WHERE id LIKE 't%' ORDER BY id")).map(r => r.id), ['t1', 't2']);
      await db.transaction(async () => {
        await db.run('INSERT INTO zz_client(id) VALUES(?)', 'n1');
        await assert.rejects(db.transaction(async () => { await db.run('INSERT INTO zz_client(id) VALUES(?)', 'n2'); throw new Error('inner'); }), /inner/);
        await db.transaction(async () => { await db.run('INSERT INTO zz_client(id) VALUES(?)', 'n3'); });
      });
      assert.deepEqual((await db.all("SELECT id FROM zz_client WHERE id LIKE 'n%' ORDER BY id")).map(r => r.id), ['n1', 'n3'], 'only the failed savepoint is undone');
      // Work started outside a transaction never sees or joins its uncommitted rows.
      let release; const gate = new Promise(resolve => { release = resolve; });
      const running = db.transaction(async () => { await db.run('INSERT INTO zz_client(id) VALUES(?)', 'x1'); await gate; await db.run("UPDATE zz_client SET label='done' WHERE id=?", 'x1'); });
      await new Promise(resolve => setTimeout(resolve, 50));
      const outside = name === 'sqlite' ? db.get('SELECT label FROM zz_client WHERE id=?', 'x1') : null;
      await release(); await running;
      if (outside) assert.equal((await outside).label, 'done', 'the SQLite statement waited for the transaction');
      assert.equal((await db.get('SELECT label FROM zz_client WHERE id=?', 'x1')).label, 'done');
    } finally { await db.close(); }
  });
}
