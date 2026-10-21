const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { load } = require('./platform-loader.cjs');
const { openPlatformDatabase } = load('database.ts');
const { PlatformRepository } = load('repository.ts');
const { encryptCredentials } = load('credential-envelope.ts');
const { startWorkerObservation, finishWorkerObservation, observeWorkerTick } = load('worker-health.ts');
const monitoring = import('../scripts/lib/platform-monitor.mjs');
const key = '12'.repeat(32), cwd = path.join(__dirname, '..');
const diskStats = async () => ({ bavail: 2048, bsize: 1024 ** 2 });
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ryzevo-monitor-'));
  const file = path.join(directory, 'platform.sqlite'), backups = path.join(directory, 'backups');
  const db = openPlatformDatabase(file), repo = new PlatformRepository(db);
  t.after(() => {
    if (db.open) db.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ryzevo-monitor-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  repo.bootstrapLegacy('monitor-admin');
  const a = repo.provision('legacy-admin', { organizationName: 'Private Alpha', projectName: 'Private Product', website: 'https://example.com', username: 'private-owner', password: 'fixture-password-123' });
  const scope = { organization_id: a.organizationId, project_id: a.projectId }, now = Date.now(), at = offset => new Date(now + offset).toISOString();
  const insert = (table, values) => {
    const keys = Object.keys(values);
    db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(values));
  };
  insert('platform_connections', { ...scope, id: 'private-connection', provider: 'custom', integration_id: 'fixture', account_name: 'Private Account',
    encrypted_credentials: encryptCredentials({ accessToken: 'DO-NOT-PRINT-MONITOR-SECRET' }, key, a.organizationId, a.projectId, 'private-connection'), updated_at: at(0) });
  fs.writeFileSync(path.join(directory, 'platform-credentials.key'), key);
  const env = { ...process.env, PLATFORM_DATABASE_PATH: file, PLATFORM_BACKUP_PATH: backups, PLATFORM_ENCRYPTION_KEY: '', PLATFORM_WORKER_EXPECTED: '1' };
  const run = (script, args = [], extra = {}) => spawnSync(process.execPath, [`scripts/${script}.mjs`, ...args], { cwd, windowsHide: true, encoding: 'utf8', timeout: 30000, env: { ...env, ...extra } });
  const backup = () => { const result = run('platform-backup'); assert.equal(result.status, 0, result.stderr); return path.join(backups, fs.readdirSync(backups).sort().at(-1)); };
  const success = (offset = 0) => { const id = startWorkerObservation(db, new Date(now + offset)); finishWorkerObservation(db, id, 'completed', 0, 0, new Date(now + offset + 1)); return id; };
  const monitor = async (extra = {}) => {
    const { monitorConfiguration, monitorPlatform } = await monitoring;
    return monitorPlatform({ databasePath: file, backupRoot: backups, options: monitorConfiguration(env), now: now + 1000, diskStats, ...extra });
  };
  const job = (id, values = {}) => insert('platform_jobs', { ...scope, id, actor_id: a.userId, connection_id: 'private-connection', revision: 'fixture', idempotency_key: id, status: 'queued', created_at: at(-7200000), updated_at: at(0), job_type: 'connection.verify', ...values });
  return { directory, file, backups, db, a, scope, insert, now, at, run, backup, success, monitor, job };
}
const codes = report => report.alerts.map(item => item.code);

test('worker observation is bounded, persistent, counts handler checks and never contains payloads', async t => {
  const f = fixture(t);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_worker_observations').get().n, 0);
  const result = await observeWorkerTick(f.db, async () => ({ checked: 2, failed: 1, pruned: 0 }));
  assert.equal(result.checked, 2);
  let row = f.db.prepare('SELECT * FROM platform_worker_observations').get();
  assert.equal(row.outcome, 'partial'); assert.equal(row.last_success_at, null); assert.equal(row.consecutive_failures, 1);
  await observeWorkerTick(f.db, async () => ({ checked: 0, failed: 0 }));
  row = f.db.prepare('SELECT * FROM platform_worker_observations').get();
  assert.equal(row.outcome, 'completed'); assert.ok(row.last_success_at); assert.equal(row.consecutive_failures, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_worker_observations').get().n, 1);
  assert.ok(!JSON.stringify(row).includes(f.a.projectId));
});

test('worker exceptions are rethrown but only a sanitized failure observation is persisted', async t => {
  const f = fixture(t), error = new Error('DO-NOT-PRINT-MONITOR-SECRET');
  await assert.rejects(observeWorkerTick(f.db, async () => { throw error; }), value => value === error);
  const row = f.db.prepare('SELECT * FROM platform_worker_observations').get();
  assert.equal(row.outcome, 'failed'); assert.equal(row.consecutive_failures, 1); assert.equal(row.last_success_at, null);
  assert.ok(!JSON.stringify(row).includes(error.message));
  f.backup();
  assert.ok(codes(await f.monitor()).includes('worker_tick_failed'));
});

test('superseded and repeated worker completions cannot overwrite the latest observation', t => {
  const f = fixture(t), first = startWorkerObservation(f.db, new Date(f.now)), second = startWorkerObservation(f.db, new Date(f.now + 10));
  assert.equal(finishWorkerObservation(f.db, first, 'failed'), false);
  assert.equal(finishWorkerObservation(f.db, second, 'completed', 3, 0, new Date(f.now + 20)), true);
  assert.equal(finishWorkerObservation(f.db, second, 'failed'), false);
  const row = f.db.prepare('SELECT * FROM platform_worker_observations').get();
  assert.equal(row.run_id, second); assert.equal(row.checked, 3); assert.equal(row.first_observed_at, f.at(0));
  assert.throws(() => finishWorkerObservation(f.db, second, 'completed', 4));
});

test('handler-level partial results stay distinct from a failed worker tick', async t => {
  const f = fixture(t); await observeWorkerTick(f.db, async () => ({ checked: 1, failed: 1 })); f.backup();
  const report = await f.monitor();
  assert.ok(codes(report).includes('worker_tick_partial')); assert.ok(!codes(report).includes('worker_tick_failed'));
  assert.equal(report.worker.handlerFailures, 1); assert.equal(report.status, 'warning');
});

test('fresh empty worker tick, valid backup and enough disk produce no fabricated production readiness', async t => {
  const f = fixture(t); f.success(); f.backup();
  const report = await f.monitor();
  assert.equal(report.status, 'ok'); assert.equal(report.exitCode, 0); assert.equal(report.worker.status, 'completed');
  assert.equal(report.backup.status, 'verified'); assert.equal(report.queue.ready, 0);
  assert.equal(report.http, 'not_checked'); assert.equal(report.notificationsSent, false); assert.equal(report.productionReadinessAssessed, false);
  const text = JSON.stringify(report);
  for (const value of [key, 'DO-NOT-PRINT-MONITOR-SECRET', f.directory, f.a.organizationId, f.a.projectId, 'private-owner', 'Private Account']) assert.ok(!text.includes(value));
});

test('expected worker distinguishes never observed, stale, stalled and repeated unfinished starts', async t => {
  const f = fixture(t); f.backup();
  assert.ok(codes(await f.monitor()).includes('worker_not_observed'));
  f.success(-600000);
  assert.ok(codes(await f.monitor()).includes('worker_stale'));
  startWorkerObservation(f.db, new Date(f.now - 300000));
  assert.ok(codes(await f.monitor()).includes('worker_stalled'));
  // A fresh overlapping start is not proof that any tick successfully completed.
  startWorkerObservation(f.db, new Date(f.now));
  assert.ok(codes(await f.monitor()).includes('worker_no_recent_success'));
});

test('missing worker is not falsely called healthy or failed when operator has not enabled supervision', async t => {
  const f = fixture(t); f.backup();
  const { monitorConfiguration } = await monitoring;
  const options = monitorConfiguration({ PLATFORM_WORKER_EXPECTED: '0' });
  const report = await f.monitor({ options });
  assert.equal(report.worker.expected, false); assert.equal(report.worker.status, 'not_observed');
  assert.ok(!codes(report).includes('worker_not_observed'));
  f.job('waiting');
  assert.ok(codes(await f.monitor({ options })).includes('worker_not_expected_with_ready_jobs'));
});

test('future social schedules and container checks do not trigger false overdue alerts', async t => {
  const f = fixture(t); f.success(); f.backup();
  f.job('future', { job_type: 'social.publish', created_at: f.at(-3 * 86400000) });
  f.insert('platform_social_publications', { ...f.scope, job_id: 'future', source_kind: 'content', source_id: 'private-content', source_digest: 'hash', body_digest: 'hash',
    encrypted_snapshot: encryptCredentials({}, key, f.a.organizationId, f.a.projectId, 'publication:future'), mode: 'rehearsal', scheduled_at: f.at(86400000), timezone: 'UTC', configuration_revision: 'fixture' });
  let report = await f.monitor(); assert.equal(report.queue.queued, 1); assert.equal(report.queue.ready, 0); assert.equal(report.queue.delayed, 0);
  f.db.prepare('UPDATE platform_social_publications SET scheduled_at=?,next_check_at=?').run(f.at(-3600000), f.at(60000));
  report = await f.monitor(); assert.equal(report.queue.ready, 0); assert.equal(report.queue.delayed, 0);
  f.db.prepare('UPDATE platform_social_publications SET next_check_at=?').run(f.at(-1000));
  report = await f.monitor(); assert.equal(report.queue.ready, 1); assert.equal(report.queue.delayed, 0);
  f.db.prepare('UPDATE platform_social_publications SET next_check_at=NULL').run();
  report = await f.monitor(); assert.equal(report.queue.delayed, 1); assert.ok(codes(report).includes('queue_delayed'));
  assert.equal(f.db.prepare('SELECT status FROM platform_jobs').get().status, 'queued');
});

test('expired leases, unsupported jobs and failures are reported without running or resetting anything', async t => {
  const f = fixture(t); f.success(); f.backup();
  f.job('expired', { status: 'running', lease_until: f.at(-10000) });
  f.job('unsupported', { job_type: 'unknown-private-provider' });
  f.job('failed', { status: 'failed', message: 'DO-NOT-PRINT-MONITOR-SECRET' });
  const before = JSON.stringify(f.db.prepare('SELECT * FROM platform_jobs ORDER BY id').all()), report = await f.monitor();
  assert.equal(report.queue.expiredLeases, 1); assert.equal(report.queue.unsupported, 1); assert.equal(report.queue.failedRecent, 1);
  assert.ok(codes(report).includes('queue_expired_leases')); assert.ok(codes(report).includes('queue_unsupported_jobs'));
  assert.ok(!JSON.stringify(report).includes('unknown-private-provider'));
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM platform_jobs ORDER BY id').all()), before);
});

test('uncertain email/social/identity and interrupted billing checks require review, never retry', async t => {
  const f = fixture(t); f.success(); f.backup();
  f.job('email', { job_type: 'email.pilot_send', status: 'failed' });
  f.insert('platform_email_pilots', { ...f.scope, job_id: 'email', campaign_id: 'private-campaign', campaign_name: 'Private', review_id: 1, encrypted_snapshot: 'unused' });
  f.insert('platform_email_pilot_recipients', { ...f.scope, job_id: 'email', position: 1, email_key: 'private-address-hash', masked_email: 'i***@example.com', state: 'uncertain', updated_at: f.at(0) });
  f.job('social', { job_type: 'social.publish', status: 'failed' });
  f.insert('platform_social_publications', { ...f.scope, job_id: 'social', source_kind: 'content', source_id: 'private-content', source_digest: 'hash', body_digest: 'hash', encrypted_snapshot: 'unused', mode: 'publish', state: 'uncertain', scheduled_at: f.at(0), timezone: 'UTC', configuration_revision: 'fixture' });
  f.insert('platform_identity_challenges', { token_hash: 'private-token', kind: 'verify', user_id: f.a.userId, email: 'private@example.com', security_version: 0,
    configuration_revision: 'fixture', created_at: f.now, expires_at: f.now + 10000, encrypted_delivery: 'unused', delivery_state: 'uncertain' });
  f.insert('platform_billing_orders', { ...f.scope, id: 'RZTESTprivate', actor_id: f.a.userId, idempotency_key: 'private', request_digest: 'hash', configuration_revision: 'fixture', merchant_revision: 'fixture', plan_id: 'launch', plan_name: 'Launch', cadence: 'monthly', amount_minor: 2900, currency: 'USD', test_mode: 1, state: 'review', created_at: f.at(0), expires_at: f.at(0), updated_at: f.at(0) });
  f.insert('platform_billing_checks', { ...f.scope, id: 'private-check', order_id: 'RZTESTprivate', actor_id: f.a.userId, idempotency_key: 'private', request_digest: 'hash', expected_revision: 0, merchant_revision: 'fixture', outcome: 'checking', created_at: f.at(-120000) });
  const report = await f.monitor();
  for (const code of ['email_delivery_uncertain', 'social_publication_uncertain', 'identity_delivery_uncertain', 'billing_requires_review', 'billing_inquiry_interrupted']) assert.ok(codes(report).includes(code));
  assert.equal(report.status, 'critical');
  assert.ok(!JSON.stringify(report).includes('private@example.com'));
  assert.equal(f.db.prepare('SELECT state FROM platform_billing_orders').get().state, 'review');
  assert.equal(f.db.prepare('SELECT state FROM platform_email_pilot_recipients').get().state, 'uncertain');
});

test('a valid backup from another database cannot satisfy this deployment backup check', async t => {
  const f = fixture(t), other = fixture(t); f.success(); other.success(); other.backup();
  const report = await f.monitor({ backupRoot: other.backups });
  assert.equal(report.backup.status, 'wrong_database'); assert.ok(codes(report).includes('backup_database_mismatch'));
  const id = other.db.prepare("SELECT value FROM platform_operation_metadata WHERE key='database_id'").get().value;
  assert.ok(!JSON.stringify(report).includes(id));
});

test('missing social payload raises an alert rather than pretending that queued work can complete', async t => {
  const f = fixture(t); f.success(); f.backup(); f.job('missing-social', { job_type: 'social.publish' });
  const report = await f.monitor();
  assert.ok(codes(report).includes('queue_missing_payload')); assert.equal(report.status, 'critical');
});

test('a broken newest backup cannot be hidden by an older valid one; stale backups alert separately', async t => {
  const f = fixture(t); f.success(); f.backup();
  let report = await f.monitor({ now: f.now + 27 * 3600000 });
  assert.equal(report.backup.status, 'stale'); assert.ok(codes(report).includes('backup_stale'));
  const latest = f.backup(); fs.appendFileSync(path.join(latest, 'platform.sqlite'), 'damaged');
  report = await f.monitor();
  assert.equal(report.backup.status, 'unverified'); assert.ok(codes(report).includes('backup_verification_failed'));
});

test('low disk, missing database and unavailable disk checks have distinct nonzero outcomes', async t => {
  const f = fixture(t); f.success(); f.backup();
  let report = await f.monitor({ diskStats: async () => ({ bavail: 1, bsize: 1024 ** 2 }) });
  assert.equal(report.disk.status, 'low'); assert.equal(report.exitCode, 2); assert.ok(codes(report).includes('disk_space_low'));
  report = await f.monitor({ diskStats: async () => { throw new Error('DO-NOT-PRINT-MONITOR-SECRET'); } });
  assert.equal(report.disk.status, 'unavailable'); assert.equal(report.exitCode, 1);
  const missing = path.join(f.directory, 'absent.sqlite'); report = await f.monitor({ databasePath: missing });
  assert.equal(report.exitCode, 2); assert.equal(fs.existsSync(missing), false); assert.ok(codes(report).includes('database_unavailable'));
});

test('invalid clocks, future schema and missing backups fail closed without migrations', async t => {
  const f = fixture(t); f.success(60000);
  let report = await f.monitor();
  assert.ok(codes(report).includes('worker_observation_invalid')); assert.ok(codes(report).includes('backup_missing_or_incomplete'));
  f.db.prepare("INSERT INTO platform_migrations VALUES(47,datetime('now'))").run();
  report = await f.monitor(); assert.ok(codes(report).includes('database_schema_unsupported'));
  assert.equal(f.db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n, 47);
});

test('monitor options are bounded and the CLI returns safe machine-readable nonzero results', async t => {
  const f = fixture(t); f.success(); f.backup();
  const { monitorConfiguration } = await monitoring;
  for (const env of [{ PLATFORM_WORKER_EXPECTED: 'yes' }, { PLATFORM_MONITOR_MIN_FREE_MB: '-1' }, { PLATFORM_MONITOR_QUEUE_DELAY_MINUTES: '0' }, { PLATFORM_MONITOR_BACKUP_MAX_AGE_HOURS: '1000' }]) assert.throws(() => monitorConfiguration(env));
  const result = f.run('platform-monitor', [], { PLATFORM_DATABASE_PATH: path.join(f.directory, 'absent.sqlite') });
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.ok(codes(report).includes('database_unavailable'));
  assert.ok(!result.stdout.includes('DO-NOT-PRINT-MONITOR-SECRET') && !result.stderr.includes(key));
  const invalid = f.run('platform-monitor', ['not-an-option']); assert.equal(invalid.status, 2); assert.match(invalid.stderr, /monitor_configuration_invalid/);
});

test('schema27 migration is additive and repeatable, observations survive a restart', async t => {
  const f = fixture(t), legacy = path.join(f.directory, 'schema26.sqlite');
  require('./schema-fixture.cjs').removeWorkerObservationSchema(f.db);
  assert.equal(f.db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n, 26);
  await f.db.backup(legacy);
  let db = openPlatformDatabase(legacy);
  try { startWorkerObservation(db); } finally { db.close(); }
  db = openPlatformDatabase(legacy);
  try {
    assert.equal(db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n, 46);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_worker_observations').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_connections').get().n, 1);
    assert.match(db.prepare("SELECT value FROM platform_operation_metadata WHERE key='database_id'").get().value, /^[a-f0-9-]{36}$/);
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});
