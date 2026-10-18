import Database from 'better-sqlite3';
import { readdir, statfs } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { MAX_RECOVERY_SCHEMA, rejectLinks, verifyBackup } from './platform-recovery.mjs';

const JOB_TYPES = ['connection.verify', 'product.sync', 'email.rehearsal', 'email.pilot_send', 'measurement.sync', 'social.publish','mobile.message'];
const option = (env, key, fallback, min, max) => {
  const value = env[key];
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error('invalid_monitor_configuration');
  return Number(value);
};
export function monitorConfiguration(env = process.env) {
  if (!['', '0', '1', undefined].includes(env.PLATFORM_WORKER_EXPECTED)) throw new Error('invalid_monitor_configuration');
  return {
    workerExpected: env.PLATFORM_WORKER_EXPECTED === '1',
    workerStaleSeconds: option(env, 'PLATFORM_MONITOR_WORKER_STALE_SECONDS', 180, 60, 3600),
    queueDelayMinutes: option(env, 'PLATFORM_MONITOR_QUEUE_DELAY_MINUTES', 15, 1, 1440),
    backupMaxAgeHours: option(env, 'PLATFORM_MONITOR_BACKUP_MAX_AGE_HOURS', 26, 1, 168),
    minFreeMb: option(env, 'PLATFORM_MONITOR_MIN_FREE_MB', 512, 16, 1048576),
  };
}

function databaseChecks(file, options, now, alert) {
  let db;
  const report = { database: { status: 'unavailable', schemaVersion: null }, databaseId: null, worker: { status: 'not_observed', expected: options.workerExpected }, queue: { status: 'not_checked' } };
  try {
    db = new Database(file, { readonly: true, fileMustExist: true, timeout: 5000 });
    db.pragma('trusted_schema = OFF');
    db.pragma('query_only = ON');
    if (db.pragma('quick_check(1)', { simple: true }) !== 'ok') throw new Error('database_check_failed');
    const versions = db.prepare('SELECT version FROM platform_migrations ORDER BY version').all().map(row => row.version);
    const version = versions.at(-1);
    if (!Number.isSafeInteger(version) || version < 1 || version > MAX_RECOVERY_SCHEMA || versions.some((value, index) => value !== index + 1)) {
      alert('database_schema_unsupported', 'critical'); return report;
    }
    report.database = { status: 'readable', schemaVersion: version };
    if (version >= 27) {
      report.databaseId = db.prepare("SELECT value FROM platform_operation_metadata WHERE key='database_id'").get()?.value;
      if (typeof report.databaseId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(report.databaseId)) throw new Error('invalid_database_id');
    }
    if (version < MAX_RECOVERY_SCHEMA) alert('database_schema_upgrade_pending', 'warning');
    const has = table => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table));
    if (has('platform_worker_observations')) {
      const row = db.prepare("SELECT first_observed_at,started_at,finished_at,outcome,last_success_at,checked,failed,consecutive_failures FROM platform_worker_observations WHERE component='platform-worker'").get();
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
    const queued = db.prepare(`SELECT COUNT(*) AS n FROM platform_jobs WHERE status='queued'`).get().n;
    const running = db.prepare("SELECT COUNT(*) AS n FROM platform_jobs WHERE status='running'").get().n;
    const ready = db.prepare(`SELECT COUNT(*) AS n,MIN(${readyAt}) AS oldest FROM ${from} WHERE j.status='queued' AND ${supported} AND ${due}`).get({ at });
    const delayed = db.prepare(`SELECT COUNT(*) AS n FROM ${from} WHERE j.status='queued' AND ${supported} AND ${due} AND ${readyAt}<@cutoff`).get({ at, cutoff }).n;
    const expiredLeases = db.prepare("SELECT COUNT(*) AS n FROM platform_jobs WHERE status='running' AND (lease_until IS NULL OR lease_until<?)").get(at).n;
    const failedRecent = db.prepare("SELECT COUNT(*) AS n FROM platform_jobs WHERE status='failed' AND updated_at>=? AND updated_at<=?").get(recent, at).n;
    const unsupported = db.prepare(`SELECT COUNT(*) AS n FROM platform_jobs WHERE status IN ('queued','running') AND job_type NOT IN (${known})`).get(...JOB_TYPES).n;
    const missingPayload = (social ? db.prepare("SELECT COUNT(*) AS n FROM platform_jobs j LEFT JOIN platform_social_publications p ON p.job_id=j.id WHERE j.job_type='social.publish' AND j.status IN ('queued','running') AND p.job_id IS NULL").get().n : 0)+(mobile?db.prepare("SELECT COUNT(*) n FROM platform_jobs j LEFT JOIN platform_mobile_messages m ON m.job_id=j.id WHERE j.job_type='mobile.message' AND j.status IN ('queued','running') AND m.job_id IS NULL").get().n:0);
    report.queue = { status: 'checked', queued, running, ready: ready.n, oldestReadyAt: ready.oldest, delayed, expiredLeases, failedRecent, unsupported };
    if (delayed) alert('queue_delayed', 'warning', delayed);
    if (expiredLeases) alert('queue_expired_leases', 'warning', expiredLeases);
    if (failedRecent) alert('queue_recent_failures', 'warning', failedRecent);
    if (unsupported) alert('queue_unsupported_jobs', 'warning', unsupported);
    if (missingPayload) alert('queue_missing_payload', 'critical', missingPayload);
    if (!options.workerExpected && ready.n) alert('worker_not_expected_with_ready_jobs', 'warning', ready.n);
    const countIf = (table, where, args = []) => has(table) ? db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args).n : 0;
    for (const [code, severity, count] of [
      ['email_delivery_uncertain', 'critical', countIf('platform_email_pilot_recipients', "state='uncertain'")],
      ['social_publication_uncertain', 'critical', countIf('platform_social_publications', "state='uncertain'")],
      ['mobile_delivery_uncertain','critical',countIf('platform_mobile_deliveries',"state='uncertain'")],
      ['identity_delivery_uncertain', 'warning', countIf('platform_identity_challenges', "delivery_state IN ('submitted','uncertain')")],
      ['billing_requires_review', 'warning', countIf('platform_billing_orders', "state IN ('review','uncertain')")],
      ['billing_inquiry_interrupted', 'warning', countIf('platform_billing_checks', "outcome='checking' AND created_at<?", [new Date(now - 60000).toISOString()])],
    ]) if (count) alert(code, severity, count);
  } catch {
    report.database.status = 'unavailable';
    alert('database_unavailable', 'critical');
  } finally { db?.close(); }
  return report;
}

async function backupChecks(root, options, now, environmentKey, databaseId, alert) {
  try {
    await rejectLinks(root);
    const folders = (await readdir(root, { withFileTypes: true }))
      .filter(entry => /^\d{4}-\d{2}-\d{2}T[\dTZ-]+-[a-f0-9-]+$/.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name));
    if (!folders.length) { alert('backup_missing', 'critical'); return { status: 'missing' }; }
    const latest = folders[0];
    if (!latest.isDirectory() || latest.isSymbolicLink()) throw new Error('invalid_backup');
    const backup = await verifyBackup(join(root, latest.name), environmentKey);
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

export async function monitorPlatform({ databasePath, backupRoot, environmentKey = process.env.PLATFORM_ENCRYPTION_KEY,
  options = monitorConfiguration(), now = Date.now(), diskStats = statfs }) {
  const alerts = [];
  const alert = (code, severity, count) => alerts.push({ code, severity, ...(count === undefined ? {} : { count }) });
  const file = resolve(databasePath);
  let checks;
  try { await rejectLinks(file); checks = databaseChecks(file, options, now, alert); }
  catch { checks = { database: { status: 'unavailable' }, worker: { status: 'not_checked' }, queue: { status: 'not_checked' } }; alert('database_unavailable', 'critical'); }
  const { databaseId, ...publicChecks } = checks;
  const backup = await backupChecks(resolve(backupRoot), options, now, environmentKey, databaseId, alert);
  let disk = { status: 'unavailable' };
  try {
    const stat = await diskStats(dirname(file));
    const bytes = Number(stat.bavail) * Number(stat.bsize);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('invalid_disk_stats');
    const freeMb = Math.floor(bytes / 1024 ** 2), low = freeMb < options.minFreeMb;
    disk = { status: low ? 'low' : 'checked', freeMb };
    if (low) alert('disk_space_low', 'critical');
  } catch { alert('disk_check_unavailable', 'warning'); }
  alerts.sort((a, b) => a.code.localeCompare(b.code));
  const severity = alerts.some(item => item.severity === 'critical') ? 'critical' : alerts.length ? 'warning' : 'ok';
  return { checkedAt: new Date(now).toISOString(), status: severity, exitCode: severity === 'critical' ? 2 : severity === 'warning' ? 1 : 0,
    ...publicChecks, backup, disk, alerts, http: 'not_checked', notificationsSent: false, productionReadinessAssessed: false };
}
