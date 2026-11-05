import nextEnv from '@next/env';
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { RecoveryError, disjointOutputRoot, latestBackupFolder, recoveryErrorCode, verifyBackup } from './lib/platform-recovery.mjs';
nextEnv.loadEnvConfig(process.cwd());
// --latest is the scheduled form: the newest backup, the drill root next to the backups, and the copied
// database and key are removed afterwards so weekly drills do not pile up extra copies of secrets.
const latest = process.argv[2] === '--latest', backupRoot = resolve(process.env.PLATFORM_BACKUP_PATH || 'data/backups');
const defaultRoot = latest ? process.env.PLATFORM_DRILL_PATH || resolve(backupRoot, '..', 'recovery-drills') : 'data/recovery-drills';
let target, copied = [];
const scrub = async () => { if (latest && target) for (const file of copied.filter(name => name !== 'manifest.json')) await rm(join(target, file), { force: true }).catch(() => {}); };
try {
  if (![3, 4].includes(process.argv.length)) throw new Error('arguments');
  const folder = latest ? await latestBackupFolder(backupRoot) : process.argv[2];
  if (!folder) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  const source = await verifyBackup(folder);
  const root = await disjointOutputRoot(source.folder, process.argv[3] || defaultRoot);
  // Drill folders use the backup naming; inside the backup root they would pass for backups.
  const diff = relative(backupRoot, root);
  if (latest && (diff === '' || (!diff.startsWith('..') && !isAbsolute(diff)))) throw new RecoveryError('output_inside_backup');
  await mkdir(root, { recursive: true, mode: 0o700 });
  target = join(root, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
  await mkdir(target, { mode: 0o700 });
  await writeFile(join(target, 'DO_NOT_START.txt'),
    'OFFLINE RECOVERY DRILL ONLY. Do not start the app or worker against this copy.\n' +
    'Rotate AUTH_SECRET, review revoked sessions, consent, pending jobs and OAuth before any real recovery.\n', { flag: 'wx', mode: 0o600 });
  const files = ['platform.sqlite', 'manifest.json', ...(source.manifest.keySource === 'file' ? ['platform-credentials.key'] : [])];
  for (const file of files) {
    copied.push(file);
    await copyFile(join(source.folder, file), join(target, file), constants.COPYFILE_EXCL);
    await chmod(join(target, file), 0o600);
  }
  // Recheck the copied bytes and authentication, not only the source backup.
  const restored = await verifyBackup(target);
  const report = { ok: true, operation: 'offline_restore_drill', checkedAt: new Date().toISOString(),
    sourceCreatedAt: restored.manifest.createdAt, ...restored.checks,
    authSecretRotationRequired: true, applicationStarted: false, workerStarted: false,
    providerRequestsMade: false, productionRestorePerformed: false, copiesRemoved: latest };
  await scrub();
  await writeFile(join(target, 'recovery-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...report, directory: resolve(target) }));
} catch (error) {
  const report = { ok: false, code: ![3, 4].includes(process.argv.length) ? 'usage: restore:drill -- <backup-directory|--latest> [output-root]' : recoveryErrorCode(error) };
  await scrub();
  if (target) await writeFile(join(target, 'FAILED.json'), JSON.stringify(report), { flag: 'wx', mode: 0o600 }).catch(() => {});
  console.error(JSON.stringify(report));
  process.exitCode = 1;
}
