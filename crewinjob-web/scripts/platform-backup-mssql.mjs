// The SQL Server half of backup:platform (PLATFORM_DATABASE_PROVIDER=mssql): every table of the database named by
// ConnectionStrings.Platform (lib/db/settings.cjs) is exported in one consistent read and the copy is verified offline
// (scripts/lib/mssql-backup.mjs). Only reads the database. RDS keeps its own automated snapshots; this is the copy the
// application can verify, move off-host (offsite:platform) and drill without AWS.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { backupMssql } from './lib/mssql-backup.mjs';
import { recoveryErrorCode, verifyBackup } from './lib/platform-recovery.mjs';
const require = createRequire(import.meta.url);
const { connectionString, describe } = require('../lib/db/settings.cjs');
const target = join(resolve(process.env.PLATFORM_BACKUP_PATH || 'data/backups'), `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
try {
  const connection = connectionString();
  if (!connection) throw Object.assign(new Error('missing'), { code: 'connection_missing' });
  const keyFile = join(dirname(resolve(process.env.PLATFORM_DATABASE_PATH || 'data/platform.sqlite')), 'platform-credentials.key');
  const manifest = await backupMssql({ connection, target, keyFile, environmentKey: process.env.PLATFORM_ENCRYPTION_KEY });
  const { checks } = await verifyBackup(target);
  const info = describe(connection);
  console.log(`Platform backup completed: ${target} (SQL Server ${info.server} / ${info.database}, schema ${manifest.schemaVersion}, ${checks.tables} tables, ${checks.rows} rows, ${checks.credentialCheck})`);
  if (manifest.keySource === 'environment') console.log('Keep the configured encryption key in your secret vault; it is not included in this backup.');
} catch (error) {
  console.error(`Platform backup failed: ${error.code === 'connection_missing' ? 'connection_missing' : recoveryErrorCode(error)}${process.env.PLATFORM_BACKUP_DEBUG ? ` (${error.message})` : ''}`);
  process.exitCode = 1;
}
