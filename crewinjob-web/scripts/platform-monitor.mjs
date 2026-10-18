import nextEnv from '@next/env';
import { monitorConfiguration, monitorPlatform } from './lib/platform-monitor.mjs';
nextEnv.loadEnvConfig(process.cwd());
try {
  if (process.argv.length !== 2) throw new Error('invalid_arguments');
  const report = await monitorPlatform({
    databasePath: process.env.PLATFORM_DATABASE_PATH || 'data/platform.sqlite',
    backupRoot: process.env.PLATFORM_BACKUP_PATH || 'data/backups',
    options: monitorConfiguration(),
  });
  console.log(JSON.stringify(report));
  process.exitCode = report.exitCode;
} catch {
  console.error(JSON.stringify({ status: 'critical', exitCode: 2, alerts: [{ code: 'monitor_configuration_invalid', severity: 'critical' }] }));
  process.exitCode = 2;
}
