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
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ryzevo-monitor-'));
  const file = path.join(directory, 'platform.sqlite'), backups = path.join(directory, 'backups');
  const db = openPlatformDatabase(file), repo = new PlatformRepository(db);
  t.after(() => {
    if (db.open) db.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ryzevo-monitor-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await repo.bootstrapLegacy('monitor-admin');
  const a = await repo.provision('legacy-admin', { organizationName: 'Private Alpha', projectName: 'Private Product', website: 'https://example.com', username: 'private-owner', password: 'fixture-password-123' });
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
  const success = async (offset = 0) => { const id = await startWorkerObservation(db, new Date(now + offset)); await finishWorkerObservation(db, id, 'completed', 0, 0, new Date(now + offset + 1)); return id; };
  const monitor = async (extra = {}) => {
    const { monitorConfiguration, monitorPlatform } = await monitoring;
    return monitorPlatform({ databasePath: file, backupRoot: backups, options: monitorConfiguration(env), now: now + 1000, diskStats, ...extra });
  };
  const job = (id, values = {}) => insert('platform_jobs', { ...scope, id, actor_id: a.userId, connection_id: 'private-connection', revision: 'fixture', idempotency_key: id, status: 'queued', created_at: at(-7200000), updated_at: at(0), job_type: 'connection.verify', ...values });
  return { directory, file, backups, db, a, scope, insert, now, at, run, backup, success, monitor, job };
}
const codes = report => report.alerts.map(item => item.code);

test('worker observation is bounded, persistent, counts handler checks and never contains payloads', async t => {
  const f = await fixture(t);
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
  const f = await fixture(t), error = new Error('DO-NOT-PRINT-MONITOR-SECRET');
  await assert.rejects(observeWorkerTick(f.db, async () => { throw error; }), value => value === error);
  const row = f.db.prepare('SELECT * FROM platform_worker_observations').get();
  assert.equal(row.outcome, 'failed'); assert.equal(row.consecutive_failures, 1); assert.equal(row.last_success_at, null);
  assert.ok(!JSON.stringify(row).includes(error.message));
  f.backup();
  assert.ok(codes(await f.monitor()).includes('worker_tick_failed'));
});

test('superseded and repeated worker completions cannot overwrite the latest observation', async t => {
  const f = await fixture(t), first = await startWorkerObservation(f.db, new Date(f.now)), second = await startWorkerObservation(f.db, new Date(f.now + 10));
  assert.equal(await finishWorkerObservation(f.db, first, 'failed'), false);
  assert.equal(await finishWorkerObservation(f.db, second, 'completed', 3, 0, new Date(f.now + 20)), true);
  assert.equal(await finishWorkerObservation(f.db, second, 'failed'), false);
  const row = f.db.prepare('SELECT * FROM platform_worker_observations').get();
  assert.equal(row.run_id, second); assert.equal(row.checked, 3); assert.equal(row.first_observed_at, f.at(0));
  await assert.rejects(async () => await finishWorkerObservation(f.db, second, 'completed', 4));
});

test('handler-level partial results stay distinct from a failed worker tick', async t => {
  const f = await fixture(t); await observeWorkerTick(f.db, async () => ({ checked: 1, failed: 1 })); f.backup();
  const report = await f.monitor();
  assert.ok(codes(report).includes('worker_tick_partial')); assert.ok(!codes(report).includes('worker_tick_failed'));
  assert.equal(report.worker.handlerFailures, 1); assert.equal(report.status, 'warning');
});

test('fresh empty worker tick, valid backup and enough disk produce no fabricated production readiness', async t => {
  const f = await fixture(t); await f.success(); f.backup();
  const report = await f.monitor();
  assert.equal(report.status, 'ok'); assert.equal(report.exitCode, 0); assert.equal(report.worker.status, 'completed');
  assert.equal(report.backup.status, 'verified'); assert.equal(report.queue.ready, 0);
  assert.equal(report.http, 'not_checked'); assert.equal(report.notificationsSent, false); assert.equal(report.productionReadinessAssessed, false);
  const text = JSON.stringify(report);
  for (const value of [key, 'DO-NOT-PRINT-MONITOR-SECRET', f.directory, f.a.organizationId, f.a.projectId, 'private-owner', 'Private Account']) assert.ok(!text.includes(value));
});

test('expected worker distinguishes never observed, stale, stalled and repeated unfinished starts', async t => {
  const f = await fixture(t); f.backup();
  assert.ok(codes(await f.monitor()).includes('worker_not_observed'));
  await f.success(-600000);
  assert.ok(codes(await f.monitor()).includes('worker_stale'));
  await startWorkerObservation(f.db, new Date(f.now - 300000));
  assert.ok(codes(await f.monitor()).includes('worker_stalled'));
  // A fresh overlapping start is not proof that any tick successfully completed.
  await startWorkerObservation(f.db, new Date(f.now));
  assert.ok(codes(await f.monitor()).includes('worker_no_recent_success'));
});

test('missing worker is not falsely called healthy or failed when operator has not enabled supervision', async t => {
  const f = await fixture(t); f.backup();
  const { monitorConfiguration } = await monitoring;
  const options = monitorConfiguration({ PLATFORM_WORKER_EXPECTED: '0' });
  const report = await f.monitor({ options });
  assert.equal(report.worker.expected, false); assert.equal(report.worker.status, 'not_observed');
  assert.ok(!codes(report).includes('worker_not_observed'));
  await f.job('waiting');
  assert.ok(codes(await f.monitor({ options })).includes('worker_not_expected_with_ready_jobs'));
});

test('future social schedules and container checks do not trigger false overdue alerts', async t => {
  const f = await fixture(t); await f.success(); f.backup();
  await f.job('future', { job_type: 'social.publish', created_at: f.at(-3 * 86400000) });
  await f.insert('platform_social_publications', { ...f.scope, job_id: 'future', source_kind: 'content', source_id: 'private-content', source_digest: 'hash', body_digest: 'hash',
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
  const f = await fixture(t); await f.success(); f.backup();
  await f.job('expired', { status: 'running', lease_until: f.at(-10000) });
  await f.job('unsupported', { job_type: 'unknown-private-provider' });
  await f.job('failed', { status: 'failed', message: 'DO-NOT-PRINT-MONITOR-SECRET' });
  const before = JSON.stringify(f.db.prepare('SELECT * FROM platform_jobs ORDER BY id').all()), report = await f.monitor();
  assert.equal(report.queue.expiredLeases, 1); assert.equal(report.queue.unsupported, 1); assert.equal(report.queue.failedRecent, 1);
  assert.ok(codes(report).includes('queue_expired_leases')); assert.ok(codes(report).includes('queue_unsupported_jobs'));
  assert.ok(!JSON.stringify(report).includes('unknown-private-provider'));
  assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM platform_jobs ORDER BY id').all()), before);
});

test('uncertain email/social/identity and interrupted billing checks require review, never retry', async t => {
  const f = await fixture(t); await f.success(); f.backup();
  await f.job('email', { job_type: 'email.pilot_send', status: 'failed' });
  await f.insert('platform_email_pilots', { ...f.scope, job_id: 'email', campaign_id: 'private-campaign', campaign_name: 'Private', review_id: 1, encrypted_snapshot: 'unused' });
  await f.insert('platform_email_pilot_recipients', { ...f.scope, job_id: 'email', position: 1, email_key: 'private-address-hash', masked_email: 'i***@example.com', state: 'uncertain', updated_at: f.at(0) });
  await f.job('social', { job_type: 'social.publish', status: 'failed' });
  await f.insert('platform_social_publications', { ...f.scope, job_id: 'social', source_kind: 'content', source_id: 'private-content', source_digest: 'hash', body_digest: 'hash', encrypted_snapshot: 'unused', mode: 'publish', state: 'uncertain', scheduled_at: f.at(0), timezone: 'UTC', configuration_revision: 'fixture' });
  await f.insert('platform_identity_challenges', { token_hash: 'private-token', kind: 'verify', user_id: f.a.userId, email: 'private@example.com', security_version: 0,
    configuration_revision: 'fixture', created_at: f.now, expires_at: f.now + 10000, encrypted_delivery: 'unused', delivery_state: 'uncertain' });
  await f.insert('platform_billing_orders', { ...f.scope, id: 'RZTESTprivate', actor_id: f.a.userId, idempotency_key: 'private', request_digest: 'hash', configuration_revision: 'fixture', merchant_revision: 'fixture', plan_id: 'launch', plan_name: 'Launch', cadence: 'monthly', amount_minor: 2900, currency: 'USD', test_mode: 1, state: 'review', created_at: f.at(0), expires_at: f.at(0), updated_at: f.at(0) });
  await f.insert('platform_billing_checks', { ...f.scope, id: 'private-check', order_id: 'RZTESTprivate', actor_id: f.a.userId, idempotency_key: 'private', request_digest: 'hash', expected_revision: 0, merchant_revision: 'fixture', outcome: 'checking', created_at: f.at(-120000) });
  const report = await f.monitor();
  for (const code of ['email_delivery_uncertain', 'social_publication_uncertain', 'identity_delivery_uncertain', 'billing_requires_review', 'billing_inquiry_interrupted']) assert.ok(codes(report).includes(code));
  assert.equal(report.status, 'critical');
  assert.ok(!JSON.stringify(report).includes('private@example.com'));
  assert.equal(f.db.prepare('SELECT state FROM platform_billing_orders').get().state, 'review');
  assert.equal(f.db.prepare('SELECT state FROM platform_email_pilot_recipients').get().state, 'uncertain');
});

test('a valid backup from another database cannot satisfy this deployment backup check', async t => {
  const f = await fixture(t), other = await fixture(t); await f.success(); await other.success(); other.backup();
  const report = await f.monitor({ backupRoot: other.backups });
  assert.equal(report.backup.status, 'wrong_database'); assert.ok(codes(report).includes('backup_database_mismatch'));
  const id = other.db.prepare("SELECT value FROM platform_operation_metadata WHERE key='database_id'").get().value;
  assert.ok(!JSON.stringify(report).includes(id));
});

test('missing social payload raises an alert rather than pretending that queued work can complete', async t => {
  const f = await fixture(t); await f.success(); f.backup(); await f.job('missing-social', { job_type: 'social.publish' });
  const report = await f.monitor();
  assert.ok(codes(report).includes('queue_missing_payload')); assert.equal(report.status, 'critical');
});

test('a broken newest backup cannot be hidden by an older valid one; stale backups alert separately', async t => {
  const f = await fixture(t); await f.success(); f.backup();
  let report = await f.monitor({ now: f.now + 27 * 3600000 });
  assert.equal(report.backup.status, 'stale'); assert.ok(codes(report).includes('backup_stale'));
  const latest = f.backup(); fs.appendFileSync(path.join(latest, 'platform.sqlite'), 'damaged');
  report = await f.monitor();
  assert.equal(report.backup.status, 'unverified'); assert.ok(codes(report).includes('backup_verification_failed'));
});

test('low disk, missing database and unavailable disk checks have distinct nonzero outcomes', async t => {
  const f = await fixture(t); await f.success(); f.backup();
  let report = await f.monitor({ diskStats: async () => ({ bavail: 1, bsize: 1024 ** 2 }) });
  assert.equal(report.disk.status, 'low'); assert.equal(report.exitCode, 2); assert.ok(codes(report).includes('disk_space_low'));
  report = await f.monitor({ diskStats: async () => { throw new Error('DO-NOT-PRINT-MONITOR-SECRET'); } });
  assert.equal(report.disk.status, 'unavailable'); assert.equal(report.exitCode, 1);
  const missing = path.join(f.directory, 'absent.sqlite'); report = await f.monitor({ databasePath: missing });
  assert.equal(report.exitCode, 2); assert.equal(fs.existsSync(missing), false); assert.ok(codes(report).includes('database_unavailable'));
});

test('invalid clocks, future schema and missing backups fail closed without migrations', async t => {
  const f = await fixture(t); await f.success(60000);
  let report = await f.monitor();
  assert.ok(codes(report).includes('worker_observation_invalid')); assert.ok(codes(report).includes('backup_missing_or_incomplete'));
  f.db.prepare("INSERT INTO platform_migrations VALUES(80,datetime('now'))").run();
  report = await f.monitor(); assert.ok(codes(report).includes('database_schema_unsupported'));
  assert.equal(f.db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n, 80);
});

test('monitor options are bounded and the CLI returns safe machine-readable nonzero results', async t => {
  const f = await fixture(t); await f.success(); f.backup();
  const { monitorConfiguration } = await monitoring;
  for (const env of [{ PLATFORM_WORKER_EXPECTED: 'yes' }, { PLATFORM_MONITOR_MIN_FREE_MB: '-1' }, { PLATFORM_MONITOR_QUEUE_DELAY_MINUTES: '0' }, { PLATFORM_MONITOR_BACKUP_MAX_AGE_HOURS: '1000' }]) assert.throws(() => monitorConfiguration(env));
  const result = await f.run('platform-monitor', [], { PLATFORM_DATABASE_PATH: path.join(f.directory, 'absent.sqlite') });
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.ok(codes(report).includes('database_unavailable'));
  assert.ok(!result.stdout.includes('DO-NOT-PRINT-MONITOR-SECRET') && !result.stderr.includes(key));
  const invalid = await f.run('platform-monitor', ['not-an-option']); assert.equal(invalid.status, 2); assert.match(invalid.stderr, /monitor_configuration_invalid/);
});

test('schema27 migration is additive and repeatable, observations survive a restart', async t => {
  const f = await fixture(t), legacy = path.join(f.directory, 'schema26.sqlite');
  require('./schema-fixture.cjs').removeWorkerObservationSchema(f.db);
  assert.equal(f.db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n, 26);
  await f.db.backup(legacy);
  let db = openPlatformDatabase(legacy);
  try { await startWorkerObservation(db); } finally { db.close(); }
  db = openPlatformDatabase(legacy);
  try {
    assert.equal(db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n, 79);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_worker_observations').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_connections').get().n, 1);
    assert.match(db.prepare("SELECT value FROM platform_operation_metadata WHERE key='database_id'").get().value, /^[a-f0-9-]{36}$/);
    assert.equal(db.pragma('foreign_key_check').length, 0);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  } finally { db.close(); }
});

const notifying = import('../scripts/lib/platform-monitor-notify.mjs');
const crypto = require('node:crypto');
// Fake SES values are made at run time; nothing is ever sent (the delivery is a recorder).
const sesEnv = () => ({ PLATFORM_MONITOR_EMAIL_ENABLED: '1', PLATFORM_MONITOR_EMAIL_TO: 'ops@example.com, Second@Example.com', PLATFORM_AUTH_FROM_EMAIL: 'alerts@example.com', PLATFORM_AUTH_SES_REGION: 'eu-central-1',
  PLATFORM_AUTH_SES_ACCESS_KEY_ID: 'AKIA' + crypto.randomBytes(16).toString('hex').toUpperCase().slice(0, 16), PLATFORM_AUTH_SES_SECRET_ACCESS_KEY: crypto.randomBytes(30).toString('base64'), PLATFORM_MONITOR_HOST_LABEL: 'QA host' });

test('weekly restore drills: --latest verifies the newest backup, removes the copies and the monitor tracks the result', async t => {
  const f = await fixture(t); await f.success(); f.backup();
  const { monitorConfiguration } = await monitoring, options = monitorConfiguration({ PLATFORM_WORKER_EXPECTED: '1', PLATFORM_DRILL_EXPECTED: '1' });
  assert.ok(codes(await f.monitor({ options })).includes('restore_drill_stale'), 'no drill yet');
  assert.equal((await f.monitor()).drill.status, 'not_expected');
  const drills = path.join(f.directory, 'recovery-drills'), result = await f.run('platform-restore-drill', ['--latest'], { PLATFORM_DRILL_PATH: '' });
  assert.equal(result.status, 0, result.stderr);
  const folder = path.join(drills, fs.readdirSync(drills).sort().at(-1));
  assert.deepEqual(fs.readdirSync(folder).sort(), ['DO_NOT_START.txt', 'manifest.json', 'recovery-report.json'], 'database and key copies removed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'recovery-report.json'), 'utf8')).copiesRemoved, true);
  const report = await f.monitor({ options });
  assert.equal(report.drill.status, 'passed'); assert.ok(!codes(report).some(code => code.startsWith('restore_drill')));
  assert.equal((await f.monitor({ options, now: f.now + 9 * 86400000 })).drill.status, 'stale');
  const failed = path.join(drills, '2999-01-01T00-00-00-000Z-' + crypto.randomUUID());
  fs.mkdirSync(failed); fs.writeFileSync(path.join(failed, 'FAILED.json'), '{"ok":false}');
  assert.ok(codes(await f.monitor({ options })).includes('restore_drill_failed'));
  const inside = await f.run('platform-restore-drill', ['--latest', path.join(f.backups, 'drills')]);
  assert.equal(inside.status, 1); assert.match(inside.stderr, /output_inside_backup/);
  const manual = await f.run('platform-restore-drill', [path.join(f.backups, fs.readdirSync(f.backups).sort().at(-1)), path.join(f.directory, 'manual-drills')]);
  assert.equal(manual.status, 0, manual.stderr);
  const kept = path.join(f.directory, 'manual-drills', fs.readdirSync(path.join(f.directory, 'manual-drills'))[0]);
  assert.ok(fs.readdirSync(kept).includes('platform.sqlite'), 'a manual drill keeps its copy for inspection');
});

test('operator email: off by default, codes only, once per change, reminders and one all-clear', async t => {
  const { monitorNotifyConfiguration: config, monitorNotifyDecision: decide, monitorMessage, notifyMonitor } = await notifying;
  assert.equal(config({}), null); assert.equal(config({ ...sesEnv(), PLATFORM_MONITOR_EMAIL_ENABLED: '0' }), null);
  for (const extra of [{ PLATFORM_MONITOR_EMAIL_TO: '' }, { PLATFORM_MONITOR_EMAIL_TO: 'not-an-email' }, { PLATFORM_MONITOR_EMAIL_TO: Array.from({ length: 6 }, (_, i) => `o${i}@example.com`).join(',') }, { PLATFORM_AUTH_SES_ACCESS_KEY_ID: 'short' }, { PLATFORM_AUTH_SES_REGION: 'nowhere' }]) assert.equal(config({ ...sesEnv(), ...extra }), null, JSON.stringify(Object.keys(extra)));
  assert.deepEqual(config(sesEnv()).to, ['ops@example.com', 'second@example.com']);
  const critical = { status: 'critical', checkedAt: '2026-11-05T10:00:00.000Z', alerts: [{ code: 'worker_stale', severity: 'critical' }, { code: 'queue_delayed', severity: 'warning', count: 3 }] };
  const ok = { status: 'ok', checkedAt: '2026-11-05T12:00:00.000Z', alerts: [] }, at = Date.parse('2026-11-05T10:00:00Z');
  assert.deepEqual(await decide(critical, null, at), { send: true, kind: 'problem' });
  const sent = { status: 'critical', codes: 'queue_delayed,worker_stale', notifiedAt: new Date(at).toISOString() };
  assert.deepEqual(await decide(critical, sent, at + 3600000), { send: false });
  assert.deepEqual(await decide(critical, sent, at + 6 * 3600000), { send: true, kind: 'reminder' });
  assert.deepEqual(await decide({ ...critical, alerts: [critical.alerts[0]] }, sent, at + 60000), { send: true, kind: 'problem' }, 'a changed set is news');
  assert.deepEqual(await decide(ok, sent, at), { send: true, kind: 'resolved' });
  assert.deepEqual(await decide(ok, { status: 'ok' }, at), { send: false }); assert.deepEqual(await decide(ok, null, at), { send: false });
  const warning = { status: 'warning', checkedAt: critical.checkedAt, alerts: [critical.alerts[1]] }, warned = { status: 'warning', codes: 'queue_delayed', notifiedAt: sent.notifiedAt };
  assert.deepEqual(await decide(warning, warned, at + 7 * 3600000), { send: false }); assert.equal((await decide(warning, warned, at + 24 * 3600000)).kind, 'reminder');
  const mail = monitorMessage(critical, 'problem', 'QA host');
  assert.match(mail.subject, /QA host: acil sorun/); assert.match(mail.text, /bir süredir çalışmıyor/); assert.match(mail.text, /gecikti\. \(3\) \[queue_delayed\]/);
  assert.match(monitorMessage(ok, 'resolved').subject, /giderildi/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ryzevo-notify-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'state', 'monitor-notify.json'), mails = [], env = sesEnv();
  const deliver = async (message, configuration) => { mails.push({ message, to: configuration.to }); };
  assert.equal(await notifyMonitor({ report: critical, statePath, env: {}, deliver }), 'disabled');
  assert.equal(await notifyMonitor({ report: critical, statePath, env, now: at, deliver }), 'sent');
  assert.equal(await notifyMonitor({ report: critical, statePath, env, now: at + 60000, deliver }), 'not_needed');
  assert.equal(await notifyMonitor({ report: ok, statePath, env, now: at + 120000, deliver: async () => { throw new Error('ses down'); } }), 'failed');
  assert.equal(await notifyMonitor({ report: ok, statePath, env, now: at + 180000, deliver }), 'sent', 'a failed all-clear is retried');
  assert.equal(await notifyMonitor({ report: ok, statePath, env, now: at + 240000, deliver }), 'not_needed');
  assert.equal(mails.length, 2); assert.deepEqual(mails[0].to, ['ops@example.com', 'second@example.com']);
  const state = fs.readFileSync(statePath, 'utf8');
  for (const value of [env.PLATFORM_AUTH_SES_SECRET_ACCESS_KEY, env.PLATFORM_AUTH_SES_ACCESS_KEY_ID, 'ops@example.com']) { assert.ok(!state.includes(value)); assert.ok(!JSON.stringify(mails.map(item => item.message)).includes(value)); }
});

test('the monitor CLI reports the notification outcome without changing its exit code', async t => {
  const f = await fixture(t); await f.success(); f.backup();
  const result = await f.run('platform-monitor', [], { PLATFORM_MONITOR_EMAIL_ENABLED: '0' });
  const report = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(report.notification, 'disabled'); assert.equal(report.notificationsSent, false); assert.equal(result.status, report.exitCode);
  assert.ok(!fs.existsSync(path.join(f.directory, 'monitor-notify.json')));
});
