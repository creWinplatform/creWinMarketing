import nextEnv from '@next/env';
import { recoveryErrorCode, verifyBackup } from './lib/platform-recovery.mjs';
nextEnv.loadEnvConfig(process.cwd());
try {
  if (process.argv.length !== 3) throw new Error('arguments');
  const { manifest, checks } = await verifyBackup(process.argv[2]);
  console.log(JSON.stringify({ ok: true, operation: 'verify_backup', createdAt: manifest.createdAt, keySource: manifest.keySource, ...checks }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: process.argv.length !== 3 ? 'usage: verify:backup -- <backup-directory>' : recoveryErrorCode(error) }));
  process.exitCode = 1;
}
