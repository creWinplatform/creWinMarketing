import nextEnv from '@next/env';
import { dirname, join, resolve } from 'node:path';
import { copyLatestBackup } from './lib/platform-offsite.mjs';
nextEnv.loadEnvConfig(process.cwd());
// Copies the newest verified backup to the private S3 bucket (off unless PLATFORM_OFFSITE_ENABLED=1). Prints codes only.
try {
  if (process.argv.length !== 2) throw new Error('invalid_arguments');
  const databasePath = resolve(process.env.PLATFORM_DATABASE_PATH || 'data/platform.sqlite');
  const result = await copyLatestBackup({ backupRoot: resolve(process.env.PLATFORM_BACKUP_PATH || 'data/backups'), statePath: process.env.PLATFORM_OFFSITE_STATE_PATH || join(dirname(databasePath), 'offsite-state.json') });
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'failed' ? 1 : 0;
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', code: error?.code === 'invalid_offsite_configuration' ? 'invalid_offsite_configuration' : 'offsite_start_failed' }));
  process.exitCode = 1;
}
