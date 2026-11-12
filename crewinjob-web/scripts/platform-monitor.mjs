import nextEnv from '@next/env';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { monitorConfiguration, monitorPlatform } from './lib/platform-monitor.mjs';
import { notifyMonitor } from './lib/platform-monitor-notify.mjs';
nextEnv.loadEnvConfig(process.cwd());
try {
  if (process.argv.length !== 2) throw new Error('invalid_arguments');
  const databasePath = process.env.PLATFORM_DATABASE_PATH || 'data/platform.sqlite', backupRoot = process.env.PLATFORM_BACKUP_PATH || 'data/backups';
  // With PLATFORM_DATABASE_PROVIDER=mssql the database checks run on SQL Server (ConnectionStrings.Platform); the backup,
  // drill, off-host and disk checks stay local.
  const mssql = process.env.PLATFORM_DATABASE_PROVIDER === 'mssql';
  const mssqlConnection = mssql ? createRequire(import.meta.url)('../lib/db/settings.cjs').connectionString() : null;
  if (mssql && !mssqlConnection) throw new Error('connection_missing');
  const report = await monitorPlatform({
    databasePath,
    mssqlConnection,
    backupRoot,
    drillRoot: process.env.PLATFORM_DRILL_PATH || resolve(backupRoot, '..', 'recovery-drills'),
    offsiteStatePath: process.env.PLATFORM_OFFSITE_STATE_PATH || join(dirname(resolve(databasePath)), 'offsite-state.json'),
    options: monitorConfiguration(),
  });
  // The operator email is optional and never changes the exit code.
  report.notification = await notifyMonitor({ report, statePath: process.env.PLATFORM_MONITOR_STATE_PATH || join(dirname(resolve(databasePath)), 'monitor-notify.json') });
  report.notificationsSent = report.notification === 'sent' || report.notification === 'sent_state_not_saved';
  console.log(JSON.stringify(report));
  process.exitCode = report.exitCode;
} catch {
  console.error(JSON.stringify({ status: 'critical', exitCode: 2, alerts: [{ code: 'monitor_configuration_invalid', severity: 'critical' }] }));
  process.exitCode = 2;
}
