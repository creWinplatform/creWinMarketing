// Copies the platform SQLite database into an empty SQL Server database (MSSQL phase 4) and verifies the copy.
//   node scripts/mssql-copy.cjs [--source data/platform.sqlite] [--database Ryzevo_Trial --create]
//   node scripts/mssql-copy.cjs --verify-only [--database Ryzevo_Trial]
// Steps:
//   1. a consistent snapshot of the source (SQLite online backup), so a running panel cannot change it mid-copy;
//   2. refuses a source whose schema version differs from lib/db/mssql-schema.sql, and any target that has tables;
//   3. in one transaction: the schema, every row (in rowid order, explicit ids kept), identity seeds, then every
//      foreign key and CHECK constraint is re-validated (WITH CHECK) before commit; a failure leaves the target empty;
//   4. verification: per table, the row count and a hash of every value must match the snapshot.
// Encrypted columns are copied as stored; the key stays with the application. The connection string comes from
// appsettings.json (lib/db/settings.cjs) and is never printed; --database only swaps the database name.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const sql = require('mssql');
const { connectionString, describe } = require('../lib/db/settings.cjs');

const args = process.argv.slice(2);
const option = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const flag = name => args.includes(name);
const ROOT = path.resolve(__dirname, '..');
const sourcePath = path.resolve(ROOT, option('--source') || 'data/platform.sqlite');
const schemaText = fs.readFileSync(path.join(ROOT, 'lib/db/mssql-schema.sql'), 'utf8').replace(/\r\n/g, '\n');
const schemaVersion = Number((schemaText.match(/schema version (\d+)/) || [])[1]);

const q = name => `[${String(name).replace(/]/g, ']]')}]`;
const log = (...parts) => console.log(...parts);

function targetConnection() {
  let value = connectionString();
  if (!value) throw new Error('No ConnectionStrings.Platform in appsettings.json (or PLATFORM_MSSQL_CONNECTION).');
  const database = option('--database');
  if (database) {
    if (!/^\w{1,100}$/.test(database)) throw new Error('--database takes letters, digits and _ only.');
    value = /(^|;)\s*(Database|Initial Catalog)\s*=/i.test(value)
      ? value.replace(/((?:^|;)\s*(?:Database|Initial Catalog)\s*=)[^;]*/i, `$1${database}`)
      : `${value};Database=${database}`;
  }
  const config = sql.ConnectionPool.parseConnectionString(value);
  config.requestTimeout = 600000;
  config.pool = { max: 2, min: 0 };
  return { config, info: describe(value) };
}

async function snapshot() {
  if (!fs.existsSync(sourcePath)) throw new Error(`Source not found: ${sourcePath}`);
  const file = path.join(os.tmpdir(), `ryzevo-mssql-copy-${process.pid}-${Date.now()}.sqlite`);
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try { await source.backup(file); } finally { source.close(); }
  const db = new Database(file, { readonly: true });
  db.defaultSafeIntegers(true);
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`Source integrity check failed: ${integrity}`);
  const version = Number(db.prepare('SELECT MAX(version) v FROM platform_migrations').get().v);
  if (version !== schemaVersion) throw new Error(`Source schema version ${version} differs from lib/db/mssql-schema.sql (${schemaVersion}).`);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return { db, file, version, sha };
}

function sourceTables(db) {
  return db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
}
function sourceColumns(db, table) { return db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all().map(c => c.name); }

async function targetColumns(request, table) {
  const result = await request.input('t', sql.NVarChar(256), table).query(
    "SELECT c.name, TYPE_NAME(c.user_type_id) type, c.is_identity FROM sys.columns c WHERE c.object_id=OBJECT_ID(@t) ORDER BY c.column_id");
  return result.recordset;
}

// Value as SQL Server parameter, by the target column type.
function bind(request, name, type, value) {
  if (value === null || value === undefined) {
    request.input(name, type === 'varbinary' ? sql.VarBinary(sql.MAX) : type === 'bigint' ? sql.BigInt : type === 'float' ? sql.Float : sql.NVarChar(sql.MAX), null);
  } else if (type === 'bigint') {
    request.input(name, sql.BigInt, typeof value === 'bigint' ? value.toString() : value);
  } else if (type === 'float') {
    request.input(name, sql.Float, Number(value));
  } else if (type === 'varbinary') {
    request.input(name, sql.VarBinary(sql.MAX), Buffer.isBuffer(value) ? value : Buffer.from(String(value)));
  } else {
    request.input(name, sql.NVarChar(sql.MAX), Buffer.isBuffer(value) ? value.toString() : String(value));
  }
}

// One canonical text per value, the same for both databases.
function canonical(value, type) {
  if (value === null || value === undefined) return 'N';
  if (Buffer.isBuffer(value)) return 'B' + value.toString('hex');
  if (type === 'float') return 'F' + String(Number(value));
  if (type === 'bigint') return 'I' + String(value);
  return 'S' + String(value);
}
function tableHash(rows, columns, types) {
  const lines = rows.map(row => JSON.stringify(columns.map(c => canonical(row[c], types[c])))).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

async function copy(pool, source) {
  const tables = sourceTables(source.db);
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  const request = () => new sql.Request(transaction);
  const copied = [];
  try {
    log('Creating the schema…');
    await request().batch(schemaText);
    const created = (await request().query("SELECT COUNT(*) n FROM sys.tables WHERE is_ms_shipped=0")).recordset[0].n;
    if (created !== tables.length) throw new Error(`Schema created ${created} tables; the source has ${tables.length}.`);
    await request().batch(tables.map(t => `ALTER TABLE ${q(t)} NOCHECK CONSTRAINT ALL;`).join('\n'));

    const hasSequence = source.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sqlite_sequence'").get();
    const sequences = new Map(hasSequence ? source.db.prepare('SELECT name, seq FROM sqlite_sequence').all().map(r => [r.name, r.seq]) : []);
    for (const table of tables) {
      const rows = source.db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}" ORDER BY rowid`).all();
      if (!rows.length) continue;
      const columns = sourceColumns(source.db, table);
      const target = await targetColumns(request(), table);
      const types = Object.fromEntries(target.map(c => [c.name, c.type]));
      const missing = columns.filter(c => !types[c]);
      if (missing.length) throw new Error(`${table}: target has no column ${missing.join(', ')}`);
      const identity = target.some(c => c.is_identity && columns.includes(c.name));
      const perRow = columns.length, chunk = Math.max(1, Math.min(500, Math.floor(2000 / perRow)));
      for (let start = 0; start < rows.length; start += chunk) {
        const r = request(), values = [];
        rows.slice(start, start + chunk).forEach((row, i) => {
          values.push('(' + columns.map((c, j) => { const name = `p${i}_${j}`; bind(r, name, types[c], row[c]); return '@' + name; }).join(',') + ')');
        });
        const insert = `INSERT INTO ${q(table)} (${columns.map(q).join(',')}) VALUES ${values.join(',')};`;
        await r.query(identity ? `SET IDENTITY_INSERT ${q(table)} ON; ${insert} SET IDENTITY_INSERT ${q(table)} OFF;` : insert);
      }
      // SQLite AUTOINCREMENT never reuses an id; keep that by seeding past the highest id it ever handed out.
      const seq = sequences.get(table);
      if (identity && seq !== undefined) {
        const idColumn = target.find(c => c.is_identity).name;
        const max = (await request().query(`SELECT MAX(${q(idColumn)}) m FROM ${q(table)}`)).recordset[0].m;
        if (BigInt(seq) > BigInt(max ?? 0)) await request().batch(`DBCC CHECKIDENT ('${table.replace(/'/g, "''")}', RESEED, ${BigInt(seq).toString()}) WITH NO_INFOMSGS;`);
      }
      copied.push([table, rows.length]);
      log(`  ${table}: ${rows.length}`);
    }
    log('Re-validating every foreign key and CHECK constraint…');
    await request().batch(tables.map(t => `ALTER TABLE ${q(t)} WITH CHECK CHECK CONSTRAINT ALL;`).join('\n'));
    const untrusted = (await request().query("SELECT COUNT(*) n FROM sys.foreign_keys WHERE is_not_trusted=1 OR is_disabled=1")).recordset[0].n
      + (await request().query("SELECT COUNT(*) n FROM sys.check_constraints WHERE is_not_trusted=1 OR is_disabled=1")).recordset[0].n;
    if (untrusted) throw new Error(`${untrusted} constraint(s) are disabled or not trusted after the copy.`);
    await transaction.commit();
  } catch (error) {
    try { await transaction.rollback(); } catch { /* the error below is what matters */ }
    throw error;
  }
  return copied;
}

async function verify(pool, source) {
  const tables = sourceTables(source.db), problems = [];
  let rowsChecked = 0;
  for (const table of tables) {
    const columns = sourceColumns(source.db, table);
    const target = await targetColumns(pool.request(), table);
    if (!target.length) { problems.push(`${table}: missing on SQL Server`); continue; }
    const types = Object.fromEntries(target.map(c => [c.name, c.type]));
    const sourceRows = source.db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"`).all();
    const count = (await pool.request().query(`SELECT COUNT_BIG(*) n FROM ${q(table)}`)).recordset[0].n;
    if (Number(count) !== sourceRows.length) { problems.push(`${table}: ${sourceRows.length} rows in SQLite, ${count} on SQL Server`); continue; }
    if (!sourceRows.length) continue;
    const targetRows = (await pool.request().query(`SELECT ${columns.map(q).join(',')} FROM ${q(table)}`)).recordset;
    if (tableHash(sourceRows, columns, types) !== tableHash(targetRows, columns, types)) problems.push(`${table}: values differ`);
    rowsChecked += sourceRows.length;
  }
  return { tables: tables.length, rowsChecked, problems };
}

(async () => {
  const started = Date.now();
  const { config, info } = targetConnection();
  log(`Target: ${info.server}, database ${info.database}, user ${info.user}`);
  const source = await snapshot();
  log(`Source: ${sourcePath} (schema ${source.version}, snapshot sha256 ${source.sha.slice(0, 16)}…)`);
  try {
    if (flag('--create') && !flag('--verify-only')) {
      const master = await new sql.ConnectionPool({ ...config, database: 'master' }).connect();
      try {
        const exists = (await master.request().input('n', sql.NVarChar(128), info.database).query('SELECT DB_ID(@n) id')).recordset[0].id;
        if (!exists) { await master.request().batch(`CREATE DATABASE ${q(info.database)}`); log(`Created database ${info.database}.`); }
      } finally { await master.close(); }
    }
    const pool = await new sql.ConnectionPool(config).connect();
    try {
      if (!flag('--verify-only')) {
        const existing = (await pool.request().query('SELECT COUNT(*) n FROM sys.tables WHERE is_ms_shipped=0')).recordset[0].n;
        if (existing) throw new Error(`Database ${info.database} already has ${existing} table(s); the copy only goes into an empty database.`);
        const copied = await copy(pool, source);
        log(`Copied ${copied.reduce((n, [, c]) => n + c, 0)} rows in ${copied.length} non-empty tables.`);
      }
      const result = await verify(pool, source);
      if (result.problems.length) { log('VERIFY FAILED:'); for (const p of result.problems) log('  ' + p); process.exitCode = 1; }
      else log(`Verified: ${result.tables} tables, ${result.rowsChecked} rows; counts and every value match the snapshot.`);
    } finally { await pool.close(); }
  } finally {
    source.db.close();
    fs.rmSync(source.file, { force: true });
  }
  log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
})().catch(error => { console.error(`${error.name}: ${error.message}`); process.exit(1); });
