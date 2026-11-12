// Application-level backup of the platform database on SQL Server (PLATFORM_DATABASE_PROVIDER=mssql), next to the RDS
// automated snapshots that AWS keeps:
//   export   one consistent read (SNAPSHOT isolation when the database allows it, else SERIALIZABLE) of every table into
//            tables/<table>.ndjson — a header line with the column names and types, then one JSON array per row — and a
//            manifest (format 3) with each file's sha256 and bytes, each table's row count and value hash, the schema
//            version, the database id and an HMAC with the encryption key, as the SQLite backup has;
//   verify   offline, no server: the files against the manifest, then the rows are rebuilt into a temporary SQLite
//            platform database of the same schema version and checked exactly as a SQLite backup is (integrity, foreign
//            keys, project scope, every encrypted field opens with the key), and every table's value hash is compared;
//   restore  for a drill: into a new, empty SQL Server database (never an existing one), constraints re-validated
//            WITH CHECK, value hashes compared with the manifest.
import { createRequire } from 'node:module';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { checkedKey, fail, fileDigest, inspectSnapshot, MAX_RECOVERY_SCHEMA, readKeyFile, rejectLinks } from './platform-recovery.mjs';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { q, bind, tableHash } = require('./mssql-rows.cjs');
export const MSSQL_BACKUP_FORMAT = 3;
const MAX_TABLE_BYTES = 4 * 1024 ** 3;
const TABLE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const TYPES = new Set(['bigint', 'float', 'nvarchar', 'varbinary']);
// mssql-schema.cjs adds `rowid BIGINT IDENTITY` to tables without an INTEGER key; in SQLite that is the table's rowid.
const SYNTHETIC = 'rowid';
const hashColumns = columns => columns.filter(([name]) => name !== SYNTHETIC).map(([name]) => name);

// ---------- export ----------
function encode(value, type) {
  if (value === null || value === undefined) return null;
  if (type === 'varbinary') return Buffer.from(value).toString('base64');
  if (type === 'bigint') return String(value);
  if (type === 'float') return Number(value);
  return String(value);
}
function decode(value, type) {
  if (value === null) return null;
  if (type === 'varbinary') return Buffer.from(value, 'base64');
  if (type === 'bigint') { if (typeof value !== 'string' || !/^-?\d{1,20}$/.test(value)) fail('invalid_backup_row'); return BigInt(value); }
  if (type === 'float') { if (typeof value !== 'number') fail('invalid_backup_row'); return value; }
  if (typeof value !== 'string') fail('invalid_backup_row');
  return value;
}

/** Writes every table of the database `pool` is connected to into `folder` and returns the table entries. */
export async function exportTables(pool, folder) {
  const sql = require('mssql');
  const snapshot = (await pool.request().query('SELECT snapshot_isolation_state s FROM sys.databases WHERE name = DB_NAME()')).recordset[0]?.s === 1;
  const transaction = new sql.Transaction(pool);
  await transaction.begin(snapshot ? sql.ISOLATION_LEVEL.SNAPSHOT : sql.ISOLATION_LEVEL.SERIALIZABLE);
  const request = () => new sql.Request(transaction);
  const tables = [];
  try {
    await mkdir(join(folder, 'tables'), { mode: 0o700 });
    const names = (await request().query('SELECT name FROM sys.tables WHERE is_ms_shipped = 0 ORDER BY name')).recordset.map(row => row.name);
    for (const table of names) {
      if (!TABLE_NAME.test(table)) fail('unsupported_table');
      const columns = (await request().input('t', sql.NVarChar(256), table).query(
        'SELECT c.name, TYPE_NAME(c.user_type_id) type FROM sys.columns c WHERE c.object_id = OBJECT_ID(@t) ORDER BY c.column_id')).recordset.map(c => [c.name, c.type]);
      if (columns.some(([, type]) => !TYPES.has(type))) fail('unsupported_column_type');
      const order = columns.some(([name]) => name === SYNTHETIC) ? q(SYNTHETIC)
        : (await request().input('t', sql.NVarChar(256), table).query('SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID(@t) AND c.is_identity = 1')).recordset[0]?.name;
      const rows = (await request().query(`SELECT ${columns.map(([name]) => q(name)).join(', ')} FROM ${q(table)}${order ? ` ORDER BY ${order.startsWith('[') ? order : q(order)}` : ''}`)).recordset;
      const types = Object.fromEntries(columns);
      const lines = [JSON.stringify({ table, columns }), ...rows.map(row => JSON.stringify(columns.map(([name, type]) => encode(row[name], type))))];
      const file = join('tables', `${table}.ndjson`), body = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
      await writeFile(join(folder, file), body, { flag: 'wx', mode: 0o600 });
      tables.push({ name: table, file: file.replace(/\\/g, '/'), rows: rows.length, bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'), valueHash: tableHash(rows, hashColumns(columns), types) });
    }
    const schemaVersion = Number((await request().query('SELECT MAX(version) v FROM platform_migrations')).recordset[0].v);
    const databaseId = (await request().query("SELECT value FROM platform_operation_metadata WHERE [key] = 'database_id'").catch(() => ({ recordset: [] }))).recordset[0]?.value ?? null;
    await transaction.commit();
    return { tables, schemaVersion, databaseId, isolation: snapshot ? 'snapshot' : 'serializable' };
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
}

function proofPayload(manifest) {
  return JSON.stringify(['ryzevo-backup-v3', manifest.createdAt, manifest.provider, manifest.schemaVersion, manifest.keySource, manifest.databaseId,
    manifest.tables.map(t => [t.name, t.file, t.rows, t.bytes, t.sha256, t.valueHash])]);
}
export const mssqlKeyProof = (manifest, key) => createHmac('sha256', Buffer.from(checkedKey(key), 'hex')).update(proofPayload(manifest)).digest('hex');

/** The whole backup: tables, the key file (when the key lives in a file) and the manifest, in a new folder. */
export async function backupMssql({ connection, target, keyFile, environmentKey }) {
  const sql = require('mssql');
  const { describe } = require('../../lib/db/settings.cjs');
  await rejectLinks(target);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await mkdir(target, { mode: 0o700 });
  const config = sql.ConnectionPool.parseConnectionString(connection);
  config.requestTimeout = 600000;
  const pool = await new sql.ConnectionPool(config).connect();
  let exported;
  try { exported = await exportTables(pool, target); } finally { await pool.close(); }
  let key = environmentKey ? checkedKey(environmentKey) : null, keySource = environmentKey ? 'environment' : 'not_created';
  if (!environmentKey && keyFile) {
    try {
      key = await readKeyFile(keyFile);
      await writeFile(join(target, 'platform-credentials.key'), `${key}\n`, { flag: 'wx', mode: 0o600 });
      keySource = 'file';
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const info = describe(connection);
  const manifest = {
    formatVersion: MSSQL_BACKUP_FORMAT, provider: 'mssql', createdAt: new Date().toISOString(),
    source: { server: info.server, database: info.database }, isolation: exported.isolation,
    schemaVersion: exported.schemaVersion, databaseId: exported.databaseId, keySource, restoreRequiresAuthSecret: true,
    tables: exported.tables, keyProof: null,
  };
  if (key) manifest.keyProof = mssqlKeyProof(manifest, key);
  await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  await chmod(target, 0o700).catch(() => undefined);
  return manifest;
}

// ---------- verify ----------
async function* rowsOf(folder, entry) {
  const lines = createInterface({ input: createReadStream(join(folder, entry.file), { encoding: 'utf8' }), crlfDelay: Infinity });
  let header = null;
  for await (const line of lines) {
    if (!line) continue;
    if (!header) { header = JSON.parse(line); yield { header }; continue; }
    const values = JSON.parse(line);
    if (!Array.isArray(values) || values.length !== header.columns.length) fail('invalid_backup_row');
    yield { values };
  }
  if (!header) fail('invalid_backup_file');
}

export function validManifest(manifest) {
  if (manifest.formatVersion !== MSSQL_BACKUP_FORMAT || manifest.provider !== 'mssql' || !['file', 'environment', 'not_created'].includes(manifest.keySource) ||
      !Number.isFinite(Date.parse(manifest.createdAt)) || manifest.restoreRequiresAuthSecret !== true ||
      !Number.isSafeInteger(manifest.schemaVersion) || manifest.schemaVersion < 1 || manifest.schemaVersion > MAX_RECOVERY_SCHEMA ||
      !Array.isArray(manifest.tables) || !manifest.tables.length || manifest.tables.length > 1000) fail('invalid_manifest');
  const seen = new Set();
  for (const t of manifest.tables) {
    if (!t || !TABLE_NAME.test(t.name) || seen.has(t.name) || t.file !== `tables/${t.name}.ndjson` || !Number.isSafeInteger(t.rows) || t.rows < 0 ||
        !Number.isSafeInteger(t.bytes) || t.bytes < 1 || t.bytes > MAX_TABLE_BYTES || !/^[a-f0-9]{64}$/.test(t.sha256) || !/^[a-f0-9]{64}$/.test(t.valueHash)) fail('invalid_manifest');
    seen.add(t.name);
  }
}

/** Rebuilds the backup into a SQLite platform database at `file` and returns the value hash of each table. */
async function rebuildSqlite(folder, manifest, file) {
  const { load } = require('../../test/platform-loader.cjs');
  const handle = load('database.ts').openPlatformDatabase(file);
  try {
    handle.defaultSafeIntegers(true);
    const current = Number(handle.prepare('SELECT MAX(version) v FROM platform_migrations').get().v);
    if (manifest.schemaVersion > current) fail('schema_mismatch');
    const tables = handle.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    if (manifest.tables.some(t => !tables.includes(t.name))) fail('schema_mismatch');
    // A backup taken before an additive upgrade (the database at 78 while this code is at 79, as before db:upgrade):
    // the tables added since are dropped from the rebuild. A table that changed its columns still fails below.
    const added = tables.filter(name => !manifest.tables.some(t => t.name === name));
    if (added.length && manifest.schemaVersion === current) fail('schema_mismatch');
    handle.pragma('foreign_keys = OFF');
    for (const name of added) handle.exec(`DROP TABLE "${name}"`);
    const hashes = {};
    for (const entry of manifest.tables) {
      const sqliteColumns = handle.prepare(`PRAGMA table_info("${entry.name}")`).all().map(c => c.name);
      let header = null, insert = null, count = 0;
      handle.exec('BEGIN');
      try {
        handle.prepare(`DELETE FROM "${entry.name}"`).run();
        for await (const item of rowsOf(folder, entry)) {
          if (item.header) {
            header = item.header;
            const names = header.columns.map(([name]) => name);
            if (header.table !== entry.name || header.columns.some(([name, type]) => !TYPES.has(type) || (name !== SYNTHETIC && !sqliteColumns.includes(name))) ||
                sqliteColumns.some(name => !names.includes(name))) fail('schema_mismatch');
            insert = handle.prepare(`INSERT INTO "${entry.name}" (${names.map(n => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`);
            continue;
          }
          insert.run(...item.values.map((value, i) => decode(value, header.columns[i][1])));
          count++;
        }
        handle.exec('COMMIT');
      } catch (error) { handle.exec('ROLLBACK'); throw error; }
      if (count !== entry.rows) fail('row_count_mismatch');
      const columns = hashColumns(header.columns), types = Object.fromEntries(header.columns);
      hashes[entry.name] = tableHash(handle.prepare(`SELECT ${columns.map(n => `"${n}"`).join(', ')} FROM "${entry.name}"`).all(), columns, types);
    }
    handle.pragma('wal_checkpoint(TRUNCATE)');
    handle.pragma('journal_mode = DELETE');
    return hashes;
  } finally { handle.close(); }
}

/** Offline check of a format-3 (SQL Server) backup folder; the same result shape as verifyBackup's SQLite path. */
export async function verifyMssqlBackup(folder, manifest, environmentKey = process.env.PLATFORM_ENCRYPTION_KEY) {
  validManifest(manifest);
  for (const entry of manifest.tables) {
    const digest = await fileDigest(join(folder, entry.file), MAX_TABLE_BYTES);
    if (digest.sha256 !== entry.sha256 || digest.bytes !== entry.bytes) fail('database_hash_mismatch');
  }
  const key = manifest.keySource === 'environment' ? checkedKey(environmentKey) :
    manifest.keySource === 'file' ? await readKeyFile(join(folder, 'platform-credentials.key')) : null;
  if (key) {
    if (typeof manifest.keyProof !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.keyProof) ||
        !timingSafeEqual(Buffer.from(mssqlKeyProof(manifest, key), 'hex'), Buffer.from(manifest.keyProof, 'hex'))) fail('key_mismatch');
  } else if (manifest.keyProof !== null) fail('invalid_manifest');
  const work = await mkdtemp(join(tmpdir(), 'ryzevo-mssql-verify-'));
  try {
    const file = join(work, 'rebuilt.sqlite');
    const hashes = await rebuildSqlite(folder, manifest, file);
    for (const entry of manifest.tables) if (hashes[entry.name] !== entry.valueHash) fail('value_hash_mismatch');
    const checks = inspectSnapshot(file, key, manifest.schemaVersion);
    if ((manifest.databaseId ?? null) !== checks.databaseId) fail('database_identity_mismatch');
    return { ...checks, provider: 'mssql', tables: manifest.tables.length, rows: manifest.tables.reduce((n, t) => n + t.rows, 0) };
  } finally { await rm(work, { recursive: true, force: true }); }
}

// ---------- restore (drill) ----------
/** Loads a verified backup into a new database `database` on the server of `connection`; never into an existing one. */
export async function restoreMssql(folder, manifest, connection, database, { keep = false } = {}) {
  const sql = require('mssql');
  if (!/^\w{1,100}$/.test(database)) fail('invalid_database_name');
  const schemaText = (await readFile(join(ROOT, 'lib', 'db', 'mssql-schema.sql'), 'utf8')).replace(/\r\n/g, '\n');
  if (Number((schemaText.match(/schema version (\d+)/) || [])[1]) !== manifest.schemaVersion) fail('schema_mismatch');
  const base = sql.ConnectionPool.parseConnectionString(connection);
  base.requestTimeout = 600000;
  const master = await new sql.ConnectionPool({ ...base, database: 'master' }).connect();
  try {
    if ((await master.request().input('n', sql.NVarChar(128), database).query('SELECT DB_ID(@n) id')).recordset[0].id) fail('drill_database_exists');
    await master.request().batch(`CREATE DATABASE ${q(database)}`);
  } finally { await master.close(); }
  const pool = await new sql.ConnectionPool({ ...base, database }).connect();
  const result = { database, tables: 0, rows: 0, constraints: 'trusted', values: 'match', kept: keep };
  try {
    await pool.request().batch(schemaText);
    const names = manifest.tables.map(t => t.name);
    await pool.request().batch(names.map(t => `ALTER TABLE ${q(t)} NOCHECK CONSTRAINT ALL;`).join('\n'));
    for (const entry of manifest.tables) {
      const target = (await pool.request().input('t', sql.NVarChar(256), entry.name).query('SELECT c.name, TYPE_NAME(c.user_type_id) type, c.is_identity FROM sys.columns c WHERE c.object_id=OBJECT_ID(@t)')).recordset;
      let header = null, batch = [];
      const flush = async () => {
        if (!batch.length) return;
        const r = pool.request(), names = header.columns.map(([name]) => name);
        const values = batch.map((row, i) => '(' + names.map((name, j) => { const p = `p${i}_${j}`; bind(r, p, header.columns[j][1], decode(row[j], header.columns[j][1])); return '@' + p; }).join(',') + ')');
        const identity = target.some(c => c.is_identity && names.includes(c.name));
        const insert = `INSERT INTO ${q(entry.name)} (${names.map(q).join(',')}) VALUES ${values.join(',')};`;
        await r.query(identity ? `SET IDENTITY_INSERT ${q(entry.name)} ON; ${insert} SET IDENTITY_INSERT ${q(entry.name)} OFF;` : insert);
        batch = [];
      };
      let per = 1;
      for await (const item of rowsOf(folder, entry)) {
        if (item.header) {
          header = item.header;
          if (header.columns.some(([name, type]) => !target.some(c => c.name === name && c.type === type))) fail('schema_mismatch');
          per = Math.max(1, Math.min(500, Math.floor(2000 / header.columns.length)));
          continue;
        }
        batch.push(item.values);
        if (batch.length >= per) await flush();
      }
      await flush();
      const columns = hashColumns(header.columns), types = Object.fromEntries(header.columns);
      const rows = (await pool.request().query(`SELECT ${columns.map(q).join(',')} FROM ${q(entry.name)}`)).recordset;
      if (rows.length !== entry.rows) fail('row_count_mismatch');
      if (tableHash(rows, columns, types) !== entry.valueHash) fail('value_hash_mismatch');
      result.tables++; result.rows += rows.length;
    }
    await pool.request().batch(names.map(t => `ALTER TABLE ${q(t)} WITH CHECK CHECK CONSTRAINT ALL;`).join('\n'));
    const untrusted = (await pool.request().query('SELECT (SELECT COUNT(*) FROM sys.foreign_keys WHERE is_not_trusted=1 OR is_disabled=1) + (SELECT COUNT(*) FROM sys.check_constraints WHERE is_not_trusted=1 OR is_disabled=1) n')).recordset[0].n;
    if (untrusted) fail('constraint_check_failed');
  } finally {
    await pool.close();
    if (!keep) {
      const cleanup = await new sql.ConnectionPool({ ...base, database: 'master' }).connect();
      try { await cleanup.request().batch(`IF DB_ID('${database}') IS NOT NULL BEGIN ALTER DATABASE ${q(database)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${q(database)} END`); }
      finally { await cleanup.close(); }
    }
  }
  return result;
}

/** Reads a backup folder's manifest (format 2 or 3). */
export async function readManifest(folder) {
  const file = join(folder, 'manifest.json');
  await fileDigest(file, 1024 * 1024);
  const handle = await open(file, 'r');
  try { return JSON.parse((await handle.readFile('utf8'))); } finally { await handle.close(); }
}
