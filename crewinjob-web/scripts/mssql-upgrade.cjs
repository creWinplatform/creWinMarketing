// Brings an existing SQL Server platform database up to lib/db/mssql-schema.sql when the new schema versions only add
// tables, indexes and foreign keys (as migration 79 does). Columns added to an existing table are refused — those need
// their own script.
//   node scripts/mssql-upgrade.cjs            show the plan, change nothing
//   node scripts/mssql-upgrade.cjs --apply    apply it in one transaction and record the schema versions
// On a server that is not local, --apply needs a verified SQL Server backup of this database from the last 24 hours
// (PLATFORM_DATABASE_PROVIDER=mssql npm run backup:platform; --backup <folder> picks one). The connection string comes from
// appsettings.json (lib/db/settings.cjs) and is never printed.
const fs = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const { connectionString, describe } = require('../lib/db/settings.cjs');
const { isLocal, requireFreshBackup } = require('./lib/live-guard.cjs');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes('--apply');
const schemaText = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db', 'mssql-schema.sql'), 'utf8').replace(/\r\n/g, '\n');
const schemaVersion = Number((schemaText.match(/schema version (\d+)/) || [])[1]);
const statements = schemaText.split(/;\s*\n/).map(s => s.replace(/^--.*$/gm, '').trim()).filter(Boolean);

// Tables, their columns, indexes and foreign keys as the schema file defines them.
function schemaObjects() {
  const tables = new Map(), indexes = [], foreignKeys = [];
  for (const statement of statements) {
    let m;
    if ((m = /^CREATE TABLE \[(\w+)\] \(([\s\S]*)\)$/.exec(statement))) {
      const columns = m[2].split('\n').map(line => /^\s*\[(\w+)\] /.exec(line)?.[1]).filter(Boolean);
      tables.set(m[1], { statement, columns });
    } else if ((m = /^CREATE (?:UNIQUE )?NONCLUSTERED INDEX \[([^\]]+)\] ON \[(\w+)\]/.exec(statement))) indexes.push({ name: m[1], table: m[2], statement });
    else if ((m = /^ALTER TABLE \[(\w+)\] ADD CONSTRAINT \[(\w+)\] FOREIGN KEY/.exec(statement))) foreignKeys.push({ name: m[2], table: m[1], statement });
  }
  return { tables, indexes, foreignKeys };
}

(async () => {
  const connection = connectionString();
  if (!connection) throw new Error('No ConnectionStrings.Platform in appsettings.json (or PLATFORM_MSSQL_CONNECTION).');
  const target = describe(connection);
  console.log(`Target: ${target.server}, database ${target.database}`);
  const pool = await new sql.ConnectionPool(connection).connect();
  try {
    const query = async text => (await pool.request().query(text)).recordset;
    const existing = new Set((await query('SELECT name FROM sys.tables WHERE is_ms_shipped = 0')).map(r => r.name));
    if (!existing.has('platform_migrations')) throw new Error('This database has no platform tables; use npm run db:copy for a first copy.');
    const current = Number((await query('SELECT MAX(version) v FROM platform_migrations'))[0].v || 0);
    console.log(`Schema: database ${current}, code ${schemaVersion}`);
    if (current > schemaVersion) throw new Error('The database is newer than this code.');
    const want = schemaObjects();
    const columns = new Map();
    for (const r of await query('SELECT t.name t, c.name c FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id WHERE t.is_ms_shipped = 0'))
      (columns.get(r.t) || columns.set(r.t, new Set()).get(r.t)).add(r.c);
    const missingColumns = [];
    for (const [name, table] of want.tables) if (existing.has(name)) for (const column of table.columns) if (!columns.get(name)?.has(column)) missingColumns.push(`${name}.${column}`);
    if (missingColumns.length) throw new Error(`Columns missing on existing tables (not handled here): ${missingColumns.join(', ')}`);
    const indexNames = new Set((await query('SELECT name FROM sys.indexes WHERE name IS NOT NULL')).map(r => r.name));
    const fkNames = new Set((await query('SELECT name FROM sys.foreign_keys')).map(r => r.name));
    const plan = [
      ...[...want.tables].filter(([name]) => !existing.has(name)).map(([name, t]) => ({ what: `table ${name}`, statement: t.statement })),
      ...want.indexes.filter(i => !indexNames.has(i.name)).map(i => ({ what: `index ${i.name} on ${i.table}`, statement: i.statement })),
      ...want.foreignKeys.filter(k => !fkNames.has(k.name)).map(k => ({ what: `foreign key ${k.name}`, statement: k.statement })),
    ];
    const versions = Array.from({ length: schemaVersion - current }, (_, i) => current + i + 1);
    if (!plan.length && !versions.length) { console.log('Up to date; nothing to do.'); return; }
    for (const step of plan) console.log(`  + ${step.what}`);
    if (versions.length) console.log(`  + record schema version(s) ${versions.join(', ')}`);
    if (!apply) { console.log('Plan only. Run again with --apply to make these changes.'); return; }
    if (!isLocal(target.server)) {
      const backup = await requireFreshBackup({ connection, folder: option('--backup') });
      console.log(`Backup: ${path.basename(backup.folder)} (${backup.createdAt}, schema ${backup.schemaVersion}, ${backup.tables} tables, ${backup.rows} rows) verified.`);
    }
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      for (const step of plan) await new sql.Request(transaction).batch(step.statement);
      for (const version of versions) await new sql.Request(transaction).input('v', sql.BigInt, version)
        .query("SET IDENTITY_INSERT platform_migrations ON; INSERT INTO platform_migrations(version, applied_at) VALUES(@v, CONVERT(NVARCHAR(30), SYSUTCDATETIME(), 126)); SET IDENTITY_INSERT platform_migrations OFF;");
      await transaction.commit();
    } catch (error) { await transaction.rollback().catch(() => undefined); throw error; }
    const after = Number((await query('SELECT MAX(version) v FROM platform_migrations'))[0].v);
    console.log(`Applied ${plan.length} change(s); schema ${after}.`);
  } finally { await pool.close(); }
})().catch(error => { console.error(`Upgrade failed: ${error.message}`); process.exitCode = 1; });
