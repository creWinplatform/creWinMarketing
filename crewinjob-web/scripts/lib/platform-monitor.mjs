import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { readdir, readFile, statfs } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { BACKUP_FOLDER, MAX_RECOVERY_SCHEMA, latestBackupFolder, rejectLinks, verifyBackup } from './platform-recovery.mjs';
import { offsiteChecks } from './platform-offsite.mjs';

const JOB_TYPES = ['connection.verify', 'product.sync', 'email.rehearsal', 'email.pilot_send', 'measurement.sync', 'social.publish','mobile.message'];
const option = (env, key, fallback, min, max) => {
  const value = env[key];
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error('invalid_monitor_configuration');
  return Number(value);
};
export function monitorConfiguration(env = process.env) {
  for (const key of ['PLATFORM_WORKER_EXPECTED', 'PLATFORM_DRILL_EXPECTED', 'PLATFORM_OFFSITE_EXPECTED']) if (!['', '0', '1', undefined].includes(env[key])) throw new Error('invalid_monitor_configuration');
  return {
    workerExpected: env.PLATFORM_WORKER_EXPECTED === '1',
    workerStaleSeconds: option(env, 'PLATFORM_MONITOR_WORKER_STALE_SECONDS', 180, 60, 3600),
    queueDelayMinutes: option(env, 'PLATFORM_MONITOR_QUEUE_DELAY_MINUTES', 15, 1, 1440),
    backupMaxAgeHours: option(env, 'PLATFORM_MONITOR_BACKUP_MAX_AGE_HOURS', 26, 1, 168),
    minFreeMb: option(env, 'PLATFORM_MONITOR_MIN_FREE_MB', 512, 16, 1048576),
    drillExpected: env.PLATFORM_DRILL_EXPECTED === '1',
    drillMaxAgeDays: option(env, 'PLATFORM_MONITOR_DRILL_MAX_AGE_DAYS', 8, 1, 60),
    offsiteExpected: env.PLATFORM_OFFSITE_EXPECTED === '1',
    offsiteMaxAgeHours: option(env, 'PLATFORM_MONITOR_OFFSITE_MAX_AGE_HOURS', 50, 2, 720),
  };
}

// The same read-only checks on SQLite (the database file) and SQL Server (PLATFORM_DATABASE_PROVIDER=mssql). The SQL is
// SQLite's; on SQL Server the platform's translator (lib/db/translate.cjs, through lib/db/client.ts) runs it. Named
// parameters (@at) become positional.
const positional = (sql, params) => {
  if (Array.isArray(params) || params === undefined) return [sql, params || []];
  const values = [];
  return [sql.replace(/@(\w+)/g, (_, name) => { values.push(params[name]); return '?'; }), values];
};
export function sqliteMonitorDb(file) {
  const handle = new Database(file, { readonly: true, fileMustExist: true, timeout: 5000 });
  handle.pragma('trusted_schema = OFF');
  handle.pragma('query_only = ON');
  const run = (sql, params, method) => Array.isArray(params) ? handle.prepare(sql)[method](...params) : params === undefined ? handle.prepare(sql)[method]() : handle.prepare(sql)[method](params);
  return {
    check: async () => handle.pragma('quick_check(1)', { simple: true }) === 'ok',
    get: async (sql, params) => run(sql, params, 'get'),
    all: async (sql, params) => run(sql, params, 'all'),
    tables: async () => new Set(handle.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name)),
    close: async () => handle.close(),
  };
}
export async function mssqlMonitorDb(connection) {
  const require = createRequire(import.meta.url), sql = require('mssql');
  const { load } = require('../../test/platform-loader.cjs');
  const config = sql.ConnectionPool.parseConnectionString(connection);
  config.requestTimeout = 30000; config.pool = { max: 2, min: 0 };
  const pool = await new sql.ConnectionPool(config).connect();
  const db = load('../db/client.ts').mssqlDb(pool, sql);
  return {
    // RDS keeps the storage healthy; the check is that the database answers and is writable state is not asked.
    check: async () => (await db.get('SELECT 1 AS ok'))?.ok === 1,
    get: async (text, params) => { const [s, v] = positional(text, params); return db.get(s, ...v); },
    all: async (text, params) => { const [s, v] = positional(text, params); return db.all(s, ...v); },
    tables: async () => new Set((await pool.request().query('SELECT name FROM sys.tables WHERE is_ms_shipped = 0')).recordset.map(row => row.name)),
    close: () => pool.close(),
  };
}

async function databaseChecks(open, options, now, alert) {
  let db;
  const report = { database: { status: 'unavailable', schemaVersion: null }, databaseId: null, worker: { status: 'not_observed', expected: options.workerExpected }, queue: { status: 'not_checked' } };
  try {
    db = await open();
    if (!(await db.check())) throw new Error('database_check_failed');
    const versions = (await db.all('SELECT version FROM platform_migrations ORDER BY version')).map(row => row.version);
    const version = versions.at(-1);
    if (!Number.isSafeInteger(version) || version < 1 || version > MAX_RECOVERY_SCHEMA || versions.some((value, index) => value !== index + 1)) {
      alert('database_schema_unsupported', 'critical'); return report;
    }
    report.database = { status: 'readable', schemaVersion: version };
    if (version >= 27) {
      report.databaseId = (await db.get("SELECT value FROM platform_operation_metadata WHERE key='database_id'"))?.value;
      if (typeof report.databaseId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(report.databaseId)) throw new Error('invalid_database_id');
    }
    if (version < MAX_RECOVERY_SCHEMA) alert('database_schema_upgrade_pending', 'warning');
    const tables = await db.tables(), has = table => tables.has(table);
    if (has('platform_worker_observations')) {
      const row = await db.get("SELECT first_observed_at,started_at,finished_at,outcome,last_success_at,checked,failed,consecutive_failures FROM platform_worker_observations WHERE component='platform-worker'");
      if (row) {
        const times = [row.first_observed_at, row.started_at, row.finished_at, row.last_success_at].filter(value => value !== null).map(value => Date.parse(value));
        const invalid = times.some(value => !Number.isFinite(value) || value > now + 30000) ||
          Date.parse(row.first_observed_at) > Date.parse(row.started_at) ||
          (row.finished_at !== null && Date.parse(row.finished_at) < Date.parse(row.started_at));
        if (invalid) {
          report.worker.status = 'invalid_observation'; alert('worker_observation_invalid', 'critical');
        } else {
          report.worker = { expected: options.workerExpected, status: row.outcome, startedAt: row.started_at, finishedAt: row.finished_at,
            lastSuccessAt: row.last_success_at, checked: row.checked, handlerFailures: row.failed, consecutiveFailures: row.consecutive_failures };
          if (options.workerExpected) {
            if (now - Date.parse(row.finished_at || row.started_at) > options.workerStaleSeconds * 1000) alert(row.outcome === 'running' ? 'worker_stalled' : 'worker_stale', 'critical');
            if (now - Date.parse(row.last_success_at || row.first_observed_at) > options.workerStaleSeconds * 1000) alert('worker_no_recent_success', 'critical');
            if (row.outcome === 'failed') alert('worker_tick_failed', 'critical');
            if (row.outcome === 'partial') alert('worker_tick_partial', 'warning', row.failed);
          }
        }
      }
    }
    if (options.workerExpected && report.worker.status === 'not_observed') alert('worker_not_observed', 'critical');
    if (version < 24 || !has('platform_jobs')) return report;
    const at = new Date(now).toISOString(), cutoff = new Date(now - options.queueDelayMinutes * 60000).toISOString();
    const recent = new Date(now - 86400000).toISOString();
    const social = has('platform_social_publications');
    const mobile=has('platform_mobile_messages');
    const from = 'platform_jobs j'+(social?' LEFT JOIN platform_social_publications p ON p.job_id=j.id':'')+(mobile?' LEFT JOIN platform_mobile_messages m ON m.job_id=j.id':'');
    const due = (social ? "(j.job_type<>'social.publish' OR (p.scheduled_at<=@at AND (p.next_check_at IS NULL OR p.next_check_at<=@at)))" : "j.job_type<>'social.publish'")+(mobile?" AND (j.job_type<>'mobile.message' OR m.scheduled_at<=@at)":" AND j.job_type<>'mobile.message'");
    const readyAt = "CASE "+(social?"WHEN j.job_type='social.publish' THEN MAX(j.created_at,p.scheduled_at,COALESCE(p.next_check_at,p.scheduled_at)) ":'')+(mobile?"WHEN j.job_type='mobile.message' THEN MAX(j.created_at,m.scheduled_at) ":'')+"ELSE j.created_at END";
    const known = JOB_TYPES.map(() => '?').join(',');
    const supported = `j.job_type IN (${JOB_TYPES.map(type => `'${type}'`).join(',')})`;
    const queued = (await db.get(`SELECT COUNT(*) AS n FROM platform_jobs WHERE status='queued'`)).n;
    const running = (await db.get("SELECT COUNT(*) AS n FROM platform_jobs WHERE status='running'")).n;
    const ready = await db.get(`SELECT COUNT(*) AS n,MIN(${readyAt}) AS oldest FROM ${from} WHERE j.status='queued' AND ${supported} AND ${due}`, { at });
    const delayed = (await db.get(`SELECT COUNT(*) AS n FROM ${from} WHERE j.status='queued' AND ${supported} AND ${due} AND ${readyAt}<@cutoff`, { at, cutoff })).n;
    const expiredLeases = (await db.get("SELECT COUNT(*) AS n FROM platform_jobs WHERE status='running' AND (lease_until IS NULL OR lease_until<?)", [at])).n;
    const failedRecent = (await db.get("SELECT COUNT(*) AS n FROM platform_jobs WHERE status='failed' AND updated_at>=? AND updated_at<=?", [recent, at])).n;
    const unsupported = (await db.get(`SELECT COUNT(*) AS n FROM platform_jobs WHERE status IN ('queued','running') AND job_type NOT IN (${known})`, JOB_TYPES)).n;
    const missingPayload = (social ? (await db.get("SELECT COUNT(*) AS n FROM platform_jobs j LEFT JOIN platform_social_publications p ON p.job_id=j.id WHERE j.job_type='social.publish' AND j.status IN ('queued','running') AND p.job_id IS NULL")).n : 0)+(mobile?(await db.get("SELECT COUNT(*) n FROM platform_jobs j LEFT JOIN platform_mobile_messages m ON m.job_id=j.id WHERE j.job_type='mobile.message' AND j.status IN ('queued','running') AND m.job_id IS NULL")).n:0);
    report.queue = { status: 'checked', queued, running, ready: ready.n, oldestReadyAt: ready.oldest, delayed, expiredLeases, failedRecent, unsupported };
    if (delayed) alert('queue_delayed', 'warning', delayed);
    if (expiredLeases) alert('queue_expired_leases', 'warning', expiredLeases);
    if (failedRecent) alert('queue_recent_failures', 'warning', failedRecent);
    if (unsupported) alert('queue_unsupported_jobs', 'warning', unsupported);
    if (missingPayload) alert('queue_missing_payload', 'critical', missingPayload);
    if (!options.workerExpected && ready.n) alert('worker_not_expected_with_ready_jobs', 'warning', ready.n);
    const countIf = async (table, where, args = []) => has(table) ? (await db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, args)).n : 0;
    for (const [code, severity, count] of [
      ['email_delivery_uncertain', 'critical', await countIf('platform_email_pilot_recipients', "state='uncertain'")],
      ['social_publication_uncertain', 'critical', await countIf('platform_social_publications', "state='uncertain'")],
      ['mobile_delivery_uncertain','critical',await countIf('platform_mobile_deliveries',"state='uncertain'")],
      ['identity_delivery_uncertain', 'warning', await countIf('platform_identity_challenges', "delivery_state IN ('submitted','uncertain')")],
      ['billing_requires_review', 'warning', await countIf('platform_billing_orders', "state IN ('review','uncertain')")],
      ['billing_inquiry_interrupted', 'warning', await countIf('platform_billing_checks', "outcome='checking' AND created_at<?", [new Date(now - 60000).toISOString()])],
    ]) if (count) alert(code, severity, count);
  } catch {
    report.database.status = 'unavailable';
    alert('database_unavailable', 'critical');
  } finally { await db?.close().catch(() => undefined); }
  return report;
}

async function backupChecks(root, options, now, environmentKey, databaseId, alert) {
  try {
    const latest = await latestBackupFolder(root);
    if (!latest) { alert('backup_missing', 'critical'); return { status: 'missing' }; }
    const backup = await verifyBackup(latest, environmentKey);
    if (!databaseId || !backup.checks.databaseId) alert('backup_database_binding_unknown', 'warning');
    else if (backup.checks.databaseId !== databaseId) {
      alert('backup_database_mismatch', 'critical'); return { status: 'wrong_database' };
    }
    const age = now - Date.parse(backup.manifest.createdAt);
    if (age < -300000) { alert('backup_timestamp_invalid', 'critical'); return { status: 'invalid_timestamp' }; }
    const stale = age > options.backupMaxAgeHours * 3600000;
    if (stale) alert('backup_stale', 'critical');
    return { status: stale ? 'stale' : 'verified', createdAt: backup.manifest.createdAt, ageHours: Math.max(0, Math.floor(age / 3600000)), schemaVersion: backup.checks.schemaVersion };
  } catch (error) {
    const missing = error?.code === 'ENOENT';
    alert(missing ? 'backup_missing_or_incomplete' : 'backup_verification_failed', 'critical');
    return { status: 'unverified' };
  }
}

// Scheduled drills leave a recovery-report.json (or FAILED.json) per folder; only the newest one counts.
async function drillChecks(root, options, now, alert) {
  if (!options.drillExpected) return { status: 'not_expected' };
  try {
    await rejectLinks(root);
    const folders = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && BACKUP_FOLDER.test(entry.name)).map(entry => entry.name).sort().reverse();
    for (const name of folders) {
      let report;
      try { report = JSON.parse(await readFile(join(root, name, 'recovery-report.json'), 'utf8')); }
      catch {
        try { await readFile(join(root, name, 'FAILED.json'), 'utf8'); } catch { continue; }
        alert('restore_drill_failed', 'warning'); return { status: 'failed' };
      }
      const age = now - Date.parse(report.checkedAt);
      if (report.ok !== true || !Number.isFinite(age)) { alert('restore_drill_failed', 'warning'); return { status: 'failed' }; }
      const stale = age > options.drillMaxAgeDays * 86400000;
      if (stale) alert('restore_drill_stale', 'warning');
      return { status: stale ? 'stale' : 'passed', checkedAt: report.checkedAt };
    }
  } catch {}
  alert('restore_drill_stale', 'warning');
  return { status: 'missing' };
}

export async function monitorPlatform({ databasePath, backupRoot, mssqlConnection = null, drillRoot = resolve(backupRoot, '..', 'recovery-drills'), offsiteStatePath = join(dirname(resolve(databasePath)), 'offsite-state.json'), environmentKey = process.env.PLATFORM_ENCRYPTION_KEY,
  options = monitorConfiguration(), now = Date.now(), diskStats = statfs }) {
  const alerts = [];
  const alert = (code, severity, count) => alerts.push({ code, severity, ...(count === undefined ? {} : { count }) });
  const file = resolve(databasePath);
  let checks;
  // With PLATFORM_DATABASE_PROVIDER=mssql the caller passes the SQL Server connection string; the disk check then covers
  // the folder that holds the backups.
  try {
    if (mssqlConnection) checks = await databaseChecks(() => mssqlMonitorDb(mssqlConnection), options, now, alert);
    else { await rejectLinks(file); checks = await databaseChecks(() => sqliteMonitorDb(file), options, now, alert); }
  }
  catch { checks = { database: { status: 'unavailable' }, worker: { status: 'not_checked' }, queue: { status: 'not_checked' } }; alert('database_unavailable', 'critical'); }
  const { databaseId, ...publicChecks } = checks;
  const backup = await backupChecks(resolve(backupRoot), options, now, environmentKey, databaseId, alert);
  const drill = await drillChecks(resolve(drillRoot), options, now, alert);
  const offsite = await offsiteChecks(offsiteStatePath, { expected: options.offsiteExpected, maxAgeHours: options.offsiteMaxAgeHours }, now, alert);
  let disk = { status: 'unavailable' };
  try {
    const stat = await diskStats(mssqlConnection ? resolve(backupRoot, '..') : dirname(file));
    const bytes = Number(stat.bavail) * Number(stat.bsize);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('invalid_disk_stats');
    const freeMb = Math.floor(bytes / 1024 ** 2), low = freeMb < options.minFreeMb;
    disk = { status: low ? 'low' : 'checked', freeMb };
    if (low) alert('disk_space_low', 'critical');
  } catch { alert('disk_check_unavailable', 'warning'); }
  alerts.sort((a, b) => a.code.localeCompare(b.code));
  const severity = alerts.some(item => item.severity === 'critical') ? 'critical' : alerts.length ? 'warning' : 'ok';
  return { checkedAt: new Date(now).toISOString(), status: severity, exitCode: severity === 'critical' ? 2 : severity === 'warning' ? 1 : 0,
    provider: mssqlConnection ? 'mssql' : 'sqlite', ...publicChecks, backup, drill, offsite, disk, alerts, http: 'not_checked', notificationsSent: false, productionReadinessAssessed: false };
}
