import nextEnv from '@next/env';
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { RecoveryError, disjointOutputRoot, latestBackupFolder, recoveryErrorCode, verifyBackup } from './lib/platform-recovery.mjs';
nextEnv.loadEnvConfig(process.cwd());
// restore:drill -- <backup-directory|--latest> [output-root] [--server] [--keep]
// --latest is the scheduled form: the newest backup, the drill root next to the backups, and the copied
// database and key are removed afterwards so weekly drills do not pile up extra copies of secrets.
// A SQL Server backup (format 3) is drilled the same way, offline: its table files are copied and rebuilt into a
// temporary SQLite database for the checks. --server also loads it into a new SQL Server database named
// RyzevoDrill_<time> on the drill server (PLATFORM_DRILL_MSSQL_CONNECTION, or ConnectionStrings.Platform in the file
// PLATFORM_DRILL_APPSETTINGS_PATH names), compares every table and drops it again unless --keep. The live database's
// own settings are never used for this, so a drill cannot write to production by accident.
const flags = new Set(process.argv.slice(2).filter(arg => arg === '--server' || arg === '--keep'));
const positional = process.argv.slice(2).filter(arg => !flags.has(arg));
const usage = ![1, 2].includes(positional.length);
const latest = positional[0] === '--latest', backupRoot = resolve(process.env.PLATFORM_BACKUP_PATH || 'data/backups');
const defaultRoot = latest ? process.env.PLATFORM_DRILL_PATH || resolve(backupRoot, '..', 'recovery-drills') : 'data/recovery-drills';
let target, copied = [];
const scrub = async () => { if (latest && target) for (const file of copied.filter(name => name !== 'manifest.json')) await rm(join(target, file), { force: true }).catch(() => {}); };

function drillConnection() {
  if (process.env.PLATFORM_DRILL_MSSQL_CONNECTION) return process.env.PLATFORM_DRILL_MSSQL_CONNECTION;
  if (!process.env.PLATFORM_DRILL_APPSETTINGS_PATH) throw new RecoveryError('drill_server_not_configured');
  const require = createRequire(import.meta.url), saved = process.env.PLATFORM_APPSETTINGS_PATH, savedConnection = process.env.PLATFORM_MSSQL_CONNECTION;
  try {
    process.env.PLATFORM_APPSETTINGS_PATH = process.env.PLATFORM_DRILL_APPSETTINGS_PATH; delete process.env.PLATFORM_MSSQL_CONNECTION;
    const value = require('../lib/db/settings.cjs').connectionString();
    if (!value) throw new RecoveryError('drill_server_not_configured');
    return value;
  } finally {
    if (saved === undefined) delete process.env.PLATFORM_APPSETTINGS_PATH; else process.env.PLATFORM_APPSETTINGS_PATH = saved;
    if (savedConnection !== undefined) process.env.PLATFORM_MSSQL_CONNECTION = savedConnection;
  }
}

try {
  if (usage) throw new Error('arguments');
  const folder = latest ? await latestBackupFolder(backupRoot) : positional[0];
  if (!folder) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  const source = await verifyBackup(folder);
  const mssql = source.manifest.formatVersion === 3;
  if (flags.has('--server') && !mssql) throw new RecoveryError('server_drill_needs_mssql_backup');
  const root = await disjointOutputRoot(source.folder, positional[1] || defaultRoot);
  // Drill folders use the backup naming; inside the backup root they would pass for backups.
  const diff = relative(backupRoot, root);
  if (latest && (diff === '' || (!diff.startsWith('..') && !isAbsolute(diff)))) throw new RecoveryError('output_inside_backup');
  await mkdir(root, { recursive: true, mode: 0o700 });
  target = join(root, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
  await mkdir(target, { mode: 0o700 });
  await writeFile(join(target, 'DO_NOT_START.txt'),
    'OFFLINE RECOVERY DRILL ONLY. Do not start the app or worker against this copy.\n' +
    'Rotate AUTH_SECRET, review revoked sessions, consent, pending jobs and OAuth before any real recovery.\n', { flag: 'wx', mode: 0o600 });
  const data = mssql ? source.manifest.tables.map(table => table.file) : ['platform.sqlite'];
  const files = [...data, 'manifest.json', ...(source.manifest.keySource === 'file' ? ['platform-credentials.key'] : [])];
  for (const file of files) {
    copied.push(file);
    await mkdir(dirname(join(target, file)), { recursive: true, mode: 0o700 });
    await copyFile(join(source.folder, file), join(target, file), constants.COPYFILE_EXCL);
    await chmod(join(target, file), 0o600);
  }
  // Recheck the copied bytes and authentication, not only the source backup.
  const restored = await verifyBackup(target);
  let server = null;
  if (flags.has('--server')) {
    const { restoreMssql } = await import('./lib/mssql-backup.mjs');
    const database = `RyzevoDrill_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
    if (database.toLowerCase() === String(source.manifest.source?.database || '').toLowerCase()) throw new RecoveryError('drill_database_is_source');
    server = await restoreMssql(target, restored.manifest, drillConnection(), database, { keep: flags.has('--keep') });
  }
  const report = { ok: true, operation: 'offline_restore_drill', checkedAt: new Date().toISOString(),
    sourceCreatedAt: restored.manifest.createdAt, provider: mssql ? 'mssql' : 'sqlite', ...restored.checks, ...(server ? { serverRestore: server } : {}),
    authSecretRotationRequired: true, applicationStarted: false, workerStarted: false,
    providerRequestsMade: false, productionRestorePerformed: false, copiesRemoved: latest };
  await scrub();
  await writeFile(join(target, 'recovery-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...report, directory: resolve(target) }));
} catch (error) {
  const report = { ok: false, code: usage ? 'usage: restore:drill -- <backup-directory|--latest> [output-root] [--server] [--keep]' : recoveryErrorCode(error) };
  await scrub();
  if (target) await writeFile(join(target, 'FAILED.json'), JSON.stringify(report), { flag: 'wx', mode: 0o600 }).catch(() => {});
  console.error(JSON.stringify(report));
  process.exitCode = 1;
}
