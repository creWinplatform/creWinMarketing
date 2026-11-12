// npm run backup:platform — a verified backup of the platform database into PLATFORM_BACKUP_PATH (data/backups):
// the SQLite file (platform-backup-sqlite.mjs) or, with PLATFORM_DATABASE_PROVIDER=mssql, an export of every SQL Server
// table (platform-backup-mssql.mjs). verify:backup and restore:drill read both.
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
if (process.env.PLATFORM_DATABASE_PROVIDER === 'mssql') await import('./platform-backup-mssql.mjs');
else await import('./platform-backup-sqlite.mjs');
