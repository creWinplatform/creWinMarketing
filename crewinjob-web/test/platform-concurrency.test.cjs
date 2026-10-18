const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Worker } = require('node:worker_threads');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('./platform-loader.cjs');
const { openPlatformDatabase } = load('database.ts');
const { PlatformRepository } = load('repository.ts');
const { ProjectUsage } = load('project-usage.ts');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ryzevo-concurrency-')), file = path.join(directory, 'platform.sqlite');
  const db = openPlatformDatabase(file), repo = new PlatformRepository(db);
  t.after(() => {
    if (db.open) db.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ryzevo-concurrency-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  repo.bootstrapLegacy('fixture-admin');
  const provision = name => repo.provision('legacy-admin', { organizationName: name, projectName: name, website: 'https://example.com', username: name, password: 'fixture-password-123' });
  const a = provision('alpha'), b = provision('beta'), scope = user => ({ subject: user.userId, organizationId: user.organizationId, projectId: user.projectId });
  return { db, file, a, b, scope, period: new Date().toISOString().slice(0, 7) };
}

async function race(file, inputs, helper = 'platform-quota-worker.cjs') {
  const signal = new SharedArrayBuffer(4), flag = new Int32Array(signal), workers = [];
  let ready = 0, timer;
  try {
    return await Promise.race([
      Promise.all(inputs.map(input => new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, 'helpers', helper), { workerData: { ...input, file, signal } });
        workers.push(worker);
        worker.on('message', message => {
          if (message.ready && ++ready === inputs.length) { Atomics.store(flag, 0, 1); Atomics.notify(flag, 0, inputs.length); }
          if (message.result) resolve(message.result);
        });
        worker.once('error', reject);
        worker.once('exit', code => { if (code) reject(new Error(`Concurrency worker exited ${code}`)); });
      }))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SQLite concurrency test timed out.')), 45000); }),
    ]);
  } finally {
    clearTimeout(timer);
    await Promise.all(workers.map(worker => worker.terminate()));
  }
}

test('six simultaneous SQLite clients cannot exceed either tenant quota at the last units', { timeout: 60000 }, async t => {
  const f = fixture(t);
  for (const [user, count] of [[f.a, 45], [f.b, 43]]) f.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'ai',?)").run(user.organizationId, user.projectId, f.period, count);
  const started = performance.now();
  const inputs = Array.from({ length: 6 }, (_, index) => ({ scope: f.scope(index < 3 ? f.a : f.b), attempts: 20, operation: 'reserve' }));
  const results = await race(f.file, inputs);
  for (const result of results) assert.deepEqual(result.errors, []);
  assert.equal(results.slice(0, 3).reduce((n, row) => n + row.accepted, 0), 5);
  assert.equal(results.slice(3).reduce((n, row) => n + row.accepted, 0), 7);
  assert.equal(results.reduce((n, row) => n + row.denied, 0), 108);
  for (const [user, committed] of [[f.a, 5], [f.b, 7]]) {
    assert.equal(f.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND resource='ai' AND period=?").get(user.organizationId, user.projectId, f.period).count, 50);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM platform_usage_reservations WHERE organization_id=? AND project_id=? AND status='committed'").get(user.organizationId, user.projectId).n, committed);
  }
  assert.equal(f.db.pragma('foreign_key_check').length, 0);
  assert.equal(f.db.pragma('integrity_check', { simple: true }), 'ok');
  t.diagnostic(`Local fixture only: 6 concurrent clients, 120 attempts, 12 accepted, 108 quota rejections, ${Math.round(performance.now() - started)}ms including worker startup. Not a production capacity claim.`);
});

test('parallel exact compensation happens once while another tenant cannot refund the reservation', { timeout: 60000 }, async t => {
  const f = fixture(t), usage = new ProjectUsage(f.db, f.scope(f.a)), reservation = usage.reserve();
  const inputs = Array.from({ length: 6 }, (_, index) => ({ scope: f.scope(index < 4 ? f.a : f.b), attempts: 10, operation: 'release', reservation }));
  const results = await race(f.file, inputs);
  for (const result of results) assert.deepEqual(result.errors, []);
  assert.equal(results.slice(0, 4).reduce((n, row) => n + row.released, 0), 40);
  assert.equal(results.slice(4).reduce((n, row) => n + row.denied, 0), 20);
  assert.equal(f.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND resource='ai'").get(f.a.organizationId, f.a.projectId).count, 0);
  assert.equal(f.db.prepare('SELECT status FROM platform_usage_reservations WHERE id=?').get(reservation.id).status, 'released');
  assert.equal(new ProjectUsage(f.db, f.scope(f.b)).read().recent.length, 0);
  assert.equal(f.db.pragma('integrity_check', { simple: true }), 'ok');
});

test('six SQLite clients enforce the shared normalized login identity limit without busy errors', { timeout: 60000 }, async t => {
  const f = fixture(t), clock = Date.now();
  const inputs = Array.from({ length: 6 }, (_, index) => ({ clock, attempts: 10, username: index % 2 ? ' Login-Fixture ' : 'login-fixture' }));
  const results = await race(f.file, inputs, 'platform-login-worker.cjs');
  for (const result of results) assert.deepEqual(result.errors, []);
  assert.equal(results.reduce((n, row) => n + row.accepted, 0), 20);
  assert.equal(results.reduce((n, row) => n + row.denied, 0), 40);
  const rows = f.db.prepare("SELECT key,count FROM platform_login_limits WHERE key NOT LIKE 'global:%'").all();
  assert.equal(rows.length, 1); assert.equal(rows[0].count, 20); assert.match(rows[0].key, /^[a-f0-9]{64}$/);
});

test('parallel different usernames cannot exceed the shared minute login ceiling', { timeout: 60000 }, async t => {
  const f = fixture(t), clock = Date.now(), bucket = 'global:' + Math.floor(clock / 60000);
  f.db.prepare('INSERT INTO platform_login_limits VALUES(?,?,?)').run(bucket, 298, clock + 60000);
  const results = await race(f.file, Array.from({ length: 6 }, (_, index) => ({ index, clock, attempts: 4, unique: true })), 'platform-login-worker.cjs');
  for (const result of results) assert.deepEqual(result.errors, []);
  assert.equal(results.reduce((n, row) => n + row.accepted, 0), 2);
  assert.equal(results.reduce((n, row) => n + row.denied, 0), 22);
  assert.equal(f.db.prepare('SELECT count FROM platform_login_limits WHERE key=?').get(bucket).count, 300);
  assert.equal(f.db.pragma('integrity_check', { simple: true }), 'ok');
});
