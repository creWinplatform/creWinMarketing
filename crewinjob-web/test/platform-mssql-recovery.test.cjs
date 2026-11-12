// Backup, verification and restore drill with PLATFORM_DATABASE_PROVIDER=mssql (scripts/lib/mssql-backup.mjs). Runs
// only against a local test server (appsettings.Test.json or PLATFORM_MSSQL_TEST_CONNECTION on 127.0.0.1/localhost);
// each run copies a fixture into its own new database and drops it afterwards.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { load } = require('./platform-loader.cjs');
const { describe } = require('../lib/db/settings.cjs');

function testConnection() {
  if (process.env.PLATFORM_MSSQL_TEST_CONNECTION) return process.env.PLATFORM_MSSQL_TEST_CONNECTION;
  const file = path.join(__dirname, '..', 'appsettings.Test.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).ConnectionStrings.Platform : '';
}
const connection = testConnection();
const local = connection && /^(127\.0\.0\.1|localhost)(,\d+)?$/i.test(describe(connection).server);
const withDatabase = (value, name) => /Database=/i.test(value) ? value.replace(/Database=[^;]*/i, `Database=${name}`) : `${value};Database=${name}`;
const key = '12'.repeat(32), wrongKey = '34'.repeat(32), cwd = path.join(__dirname, '..');

async function fixture(t) {
  const { openPlatformDatabase } = load('database.ts'), { PlatformRepository } = load('repository.ts'), { encryptCredentials } = load('credential-envelope.ts');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ryzevo-mssql-recovery-')), database = `RyzevoRecoveryTest_${process.pid}_${Date.now()}`;
  const source = path.join(directory, 'platform.sqlite'), backups = path.join(directory, 'backups');
  const db = openPlatformDatabase(source), repo = new PlatformRepository(db);
  await repo.bootstrapLegacy('backup-admin');
  for (const [index, name] of ['Alpha', 'Beta'].entries()) {
    const p = await repo.provision('legacy-admin', { organizationName: name, projectName: name, website: `https://${name.toLowerCase()}.example.com`, username: name.toLowerCase(), password: 'fixture-password-123' });
    const id = `connection-${index}`;
    db.prepare('INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(
      id, p.organizationId, p.projectId, 'custom', id, 'Private account', encryptCredentials({ accessToken: 'DO-NOT-PRINT-SECRET', refreshToken: '' }, key, p.organizationId, p.projectId, id), new Date().toISOString());
  }
  db.prepare("INSERT INTO legacy_stores(store,version,updated_at) VALUES('web:calendar',1,'2026-11-12T00:00:00Z')").run();
  db.prepare("INSERT INTO legacy_records(store,record_key,position,body,body_hash,updated_at) VALUES('web:calendar','cal_1',0,?,?,'2026-11-12T00:00:00Z')").run('{"id":"cal_1","content":"Ä 😀"}', 'a'.repeat(64));
  db.close();
  fs.writeFileSync(path.join(directory, 'platform-credentials.key'), key);
  const target = withDatabase(connection, database);
  const env = { ...process.env, PLATFORM_DATABASE_PROVIDER: 'mssql', PLATFORM_MSSQL_CONNECTION: target, PLATFORM_DATABASE_PATH: source, PLATFORM_BACKUP_PATH: backups, PLATFORM_ENCRYPTION_KEY: '' };
  delete env.PLATFORM_APPSETTINGS_PATH;
  const run = (script, args = [], extra = {}) => spawnSync(process.execPath, [script, ...args], { cwd, windowsHide: true, encoding: 'utf8', timeout: 300000, env: { ...env, ...extra } });
  const copy = run('scripts/mssql-copy.cjs', ['--source', source, '--create']);
  assert.equal(copy.status, 0, copy.stderr + copy.stdout);
  t.after(async () => {
    const sql = require('mssql'), master = await new sql.ConnectionPool(withDatabase(connection, 'master')).connect();
    try { await master.request().batch(`IF DB_ID('${database}') IS NOT NULL BEGIN ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}] END`); } finally { await master.close(); }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const backup = () => { const result = run('scripts/platform-backup.mjs'); const folders = fs.existsSync(backups) ? fs.readdirSync(backups).sort() : []; return { result, folder: folders.length ? path.join(backups, folders.at(-1)) : null }; };
  return { directory, backups, run, backup };
}
const manifestAt = folder => JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
const allFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? allFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);

test('SQL Server backup: one file per table, verified offline with the encrypted fields authenticated; tampering fails closed', { skip: !local && 'no local SQL Server test connection' }, async t => {
  const f = await fixture(t);
  const { result, folder } = f.backup();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SQL Server .*schema 79, 154 tables, .*authenticated/);
  const manifest = manifestAt(folder);
  assert.equal(manifest.formatVersion, 3); assert.equal(manifest.provider, 'mssql'); assert.equal(manifest.keySource, 'file');
  assert.match(manifest.keyProof, /^[a-f0-9]{64}$/);
  assert.equal(manifest.tables.find(table => table.name === 'platform_connections').rows, 2);
  assert.equal(manifest.tables.find(table => table.name === 'legacy_records').rows, 1);
  for (const file of allFiles(folder)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /DO-NOT-PRINT-SECRET/, 'only ciphertext is exported');
  assert.doesNotMatch(result.stdout + result.stderr, /Password|DO-NOT-PRINT/i);

  const verified = f.run('scripts/platform-verify-backup.mjs', [folder]);
  assert.equal(verified.status, 0, verified.stderr);
  const report = JSON.parse(verified.stdout);
  assert.equal(report.provider, 'mssql'); assert.equal(report.encryptedRecords, 2); assert.equal(report.credentialCheck, 'authenticated'); assert.equal(report.integrity, 'ok');

  // A changed table file, a changed manifest and a wrong key each fail with a code, never with data.
  const copyOf = name => { const to = path.join(f.directory, name); fs.cpSync(folder, to, { recursive: true }); return to; };
  const changed = copyOf('changed-file'), file = path.join(changed, 'tables', 'platform_connections.ndjson');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Private account', 'Private accounT'));
  assert.match(f.run('scripts/platform-verify-backup.mjs', [changed]).stderr, /database_hash_mismatch/);
  const recount = copyOf('changed-manifest'), m = manifestAt(recount);
  m.tables.find(table => table.name === 'platform_connections').rows = 1;
  fs.writeFileSync(path.join(recount, 'manifest.json'), JSON.stringify(m));
  assert.match(f.run('scripts/platform-verify-backup.mjs', [recount]).stderr, /key_mismatch/);
  const wrong = copyOf('wrong-key');
  fs.writeFileSync(path.join(wrong, 'platform-credentials.key'), wrongKey);
  assert.match(f.run('scripts/platform-verify-backup.mjs', [wrong]).stderr, /key_mismatch/);
});

test('SQL Server restore drill: offline by default, into a new drill database with --server, never without a drill server', { skip: !local && 'no local SQL Server test connection' }, async t => {
  const f = await fixture(t);
  const { result } = f.backup();
  assert.equal(result.status, 0, result.stderr);
  const drills = path.join(f.directory, 'drills');
  const offline = f.run('scripts/platform-restore-drill.mjs', ['--latest'], { PLATFORM_DRILL_PATH: drills });
  assert.equal(offline.status, 0, offline.stderr);
  const report = JSON.parse(offline.stdout);
  assert.equal(report.provider, 'mssql'); assert.equal(report.credentialCheck, 'authenticated'); assert.equal(report.copiesRemoved, true);
  assert.deepEqual(fs.readdirSync(path.join(report.directory, 'tables')), [], 'the copied table files are removed after a scheduled drill');

  const refused = f.run('scripts/platform-restore-drill.mjs', ['--latest', '--server'], { PLATFORM_DRILL_PATH: drills });
  assert.equal(refused.status, 1); assert.match(refused.stderr, /drill_server_not_configured/);

  const server = f.run('scripts/platform-restore-drill.mjs', ['--latest', '--server'], { PLATFORM_DRILL_PATH: drills, PLATFORM_DRILL_MSSQL_CONNECTION: withDatabase(connection, 'master') });
  assert.equal(server.status, 0, server.stderr);
  const restored = JSON.parse(server.stdout).serverRestore;
  assert.match(restored.database, /^RyzevoDrill_\d{14}$/);
  assert.equal(restored.tables, 154); assert.equal(restored.constraints, 'trusted'); assert.equal(restored.values, 'match'); assert.equal(restored.kept, false);
  const sql = require('mssql'), master = await new sql.ConnectionPool(withDatabase(connection, 'master')).connect();
  try { assert.equal((await master.request().query(`SELECT DB_ID('${restored.database}') id`)).recordset[0].id, null, 'the drill database is dropped'); } finally { await master.close(); }
});
