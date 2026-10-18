import nextEnv from '@next/env';
import { constants } from 'node:fs';
import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { disjointOutputRoot, recoveryErrorCode, verifyBackup } from './lib/platform-recovery.mjs';
nextEnv.loadEnvConfig(process.cwd());
let target;
try {
  if (![3, 4].includes(process.argv.length)) throw new Error('arguments');
  const source = await verifyBackup(process.argv[2]);
  const root = await disjointOutputRoot(source.folder, process.argv[3] || 'data/recovery-drills');
  await mkdir(root, { recursive: true, mode: 0o700 });
  target = join(root, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
  await mkdir(target, { mode: 0o700 });
  await writeFile(join(target, 'DO_NOT_START.txt'),
    'OFFLINE RECOVERY DRILL ONLY. Do not start the app or worker against this copy.\n' +
    'Rotate AUTH_SECRET, review revoked sessions, consent, pending jobs and OAuth before any real recovery.\n', { flag: 'wx', mode: 0o600 });
  const files = ['platform.sqlite', 'manifest.json', ...(source.manifest.keySource === 'file' ? ['platform-credentials.key'] : [])];
  for (const file of files) {
    await copyFile(join(source.folder, file), join(target, file), constants.COPYFILE_EXCL);
    await chmod(join(target, file), 0o600);
  }
  // Recheck the copied bytes and authentication, not only the source backup.
  const restored = await verifyBackup(target);
  const report = { ok: true, operation: 'offline_restore_drill', checkedAt: new Date().toISOString(),
    sourceCreatedAt: restored.manifest.createdAt, ...restored.checks,
    authSecretRotationRequired: true, applicationStarted: false, workerStarted: false,
    providerRequestsMade: false, productionRestorePerformed: false };
  await writeFile(join(target, 'recovery-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...report, directory: resolve(target) }));
} catch (error) {
  const report = { ok: false, code: ![3, 4].includes(process.argv.length) ? 'usage: restore:drill -- <backup-directory> [output-root]' : recoveryErrorCode(error) };
  if (target) await writeFile(join(target, 'FAILED.json'), JSON.stringify(report), { flag: 'wx', mode: 0o600 }).catch(() => {});
  console.error(JSON.stringify(report));
  process.exitCode = 1;
}
