// Before a script writes to a database that is not a local test server (phase 4 on RDS), it needs a fresh, verified
// backup of exactly that database: the newest folder in PLATFORM_BACKUP_PATH (or the one given) must be a SQL Server
// backup (format 3) of the same server and database, carry the same database id, verify offline, and be at most
// `maxAgeHours` old. Take one with `PLATFORM_DATABASE_PROVIDER=mssql npm run backup:platform` right before.
const path = require('node:path');
const sql = require('mssql');
const { describe } = require('../../lib/db/settings.cjs');

const isLocal = server => /^(127\.0\.0\.1|localhost)(,\d+)?$/i.test(server);
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

async function requireFreshBackup({ connection, folder, maxAgeHours = 24, now = Date.now() }) {
  const { latestBackupFolder, verifyBackup } = await import('./platform-recovery.mjs');
  const target = describe(connection);
  const chosen = folder ? path.resolve(folder) : await latestBackupFolder(path.resolve(process.env.PLATFORM_BACKUP_PATH || 'data/backups'));
  if (!chosen) throw new Error('No backup found. Take one first: PLATFORM_DATABASE_PROVIDER=mssql npm run backup:platform');
  const { manifest, checks } = await verifyBackup(chosen);
  if (manifest.formatVersion !== 3 || manifest.provider !== 'mssql') throw new Error(`The newest backup (${path.basename(chosen)}) is not a SQL Server backup.`);
  if (!same(manifest.source?.server, target.server) || !same(manifest.source?.database, target.database))
    throw new Error(`The newest backup is of ${manifest.source?.server} / ${manifest.source?.database}, not ${target.server} / ${target.database}.`);
  const age = now - Date.parse(manifest.createdAt);
  if (!(age >= -300000 && age <= maxAgeHours * 3600000)) throw new Error(`The newest backup is older than ${maxAgeHours} hours (${manifest.createdAt}). Take a new one first.`);
  const pool = await new sql.ConnectionPool(connection).connect();
  try {
    const id = (await pool.request().query("IF OBJECT_ID('platform_operation_metadata') IS NOT NULL SELECT value FROM platform_operation_metadata WHERE [key] = 'database_id'")).recordset?.[0]?.value ?? null;
    if ((checks.databaseId ?? null) !== id) throw new Error('The newest backup belongs to another database (database id differs).');
  } finally { await pool.close(); }
  return { folder: chosen, createdAt: manifest.createdAt, schemaVersion: checks.schemaVersion, tables: checks.tables, rows: checks.rows };
}

module.exports = { isLocal, requireFreshBackup };
