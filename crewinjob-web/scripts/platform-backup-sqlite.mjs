import nextEnv from '@next/env';
import Database from 'better-sqlite3';
import { mkdir, copyFile, access, writeFile, chmod } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkedKey, fileDigest, inspectSnapshot, keyProof, readKeyFile, recoveryErrorCode, rejectLinks, verifyBackup } from './lib/platform-recovery.mjs';
nextEnv.loadEnvConfig(process.cwd());
const source = resolve(
  process.env.PLATFORM_DATABASE_PATH || 'data/platform.sqlite',
);
await access(source);
await rejectLinks(source);
const target = join(
  resolve(process.env.PLATFORM_BACKUP_PATH || 'data/backups'),
  `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
);
await rejectLinks(target);
await mkdir(dirname(target), { recursive: true, mode: 0o700 });
await mkdir(target, { mode: 0o700 });
const db = new Database(source, { readonly: true, fileMustExist: true });
let keySource = process.env.PLATFORM_ENCRYPTION_KEY
  ? 'environment'
  : 'not_created';
try {
  const snapshot = join(target, 'platform.sqlite');
  await db.backup(snapshot);
  await chmod(snapshot, 0o600);
  // Only the newly created copy is sealed; leave the live database in WAL mode.
  const copy = new Database(snapshot, { fileMustExist: true });
  try {
    copy.pragma('trusted_schema = OFF');
    copy.pragma('wal_checkpoint(TRUNCATE)');
    if (copy.pragma('journal_mode = DELETE', { simple: true }) !== 'delete') throw new Error('snapshot_not_sealed');
  } finally { copy.close(); }
  let key = process.env.PLATFORM_ENCRYPTION_KEY ? checkedKey(process.env.PLATFORM_ENCRYPTION_KEY) : null;
  if (!process.env.PLATFORM_ENCRYPTION_KEY) {
    const keyFile = join(dirname(source), 'platform-credentials.key');
    try {
      key = await readKeyFile(keyFile);
      await copyFile(
        keyFile,
        join(target, 'platform-credentials.key'),
        constants.COPYFILE_EXCL,
      );
      await chmod(join(target, 'platform-credentials.key'), 0o600);
      keySource = 'file';
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const checks = inspectSnapshot(snapshot, key);
  const digest = await fileDigest(snapshot);
  const manifest = {
    formatVersion: 2,
    createdAt: new Date().toISOString(),
    database: 'platform.sqlite', keySource, restoreRequiresAuthSecret: true,
    schemaVersion: checks.schemaVersion, databaseId: checks.databaseId, databaseSha256: digest.sha256, databaseBytes: digest.bytes,
    keyProof: null,
  };
  if (key) manifest.keyProof = keyProof(manifest, key);
  await writeFile(
    join(target, 'manifest.json'),
    JSON.stringify(
      manifest,
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  await verifyBackup(target);
  console.log(`Platform backup completed: ${target}`);
  if (keySource === 'environment')
    console.log(
      'Keep the configured encryption key in your secret vault; it is not included in this backup.',
    );
} catch (error) {
  console.error(`Platform backup failed: ${recoveryErrorCode(error)}`);
  process.exitCode = 1;
} finally {
  db.close();
}
