// Injected through stdin into an isolated QA container; never copied into runner.
import assert from 'node:assert/strict';
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { checkRuntimePackage } from './scripts/platform-runtime-check.mjs';

const base = 'http://127.0.0.1:3033', timings = [];
const request = async (url, cookie = '', method = 'GET', body, origin = base) => {
  const start = performance.now();
  const response = await fetch(base + url, { method, redirect: 'manual', signal: AbortSignal.timeout(15000),
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  timings.push(performance.now() - start);
  return response;
};
const json = async (response, status = 200) => { assert.equal(response.status, status); return response.json(); };
const login = async (username, password) => {
  const response = await request('/api/auth/login', '', 'POST', { username, password });
  assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
};
const operator = (script, args = []) => {
  const result = spawnSync(process.execPath, ['scripts/' + script + '.mjs', ...args], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `${script} failed with exit ${result.status}`);
  return result.stdout;
};
const lastJson = output => JSON.parse(output.trim().split(/\r?\n/).filter(line => line.startsWith('{')).at(-1));

assert.equal(process.getuid(), 1001);
for (const name of ['PLATFORM_EMAIL_PILOT_SEND_ENABLED', 'PLATFORM_SOCIAL_PUBLISH_ENABLED', 'PLATFORM_AUTH_EMAIL_ENABLED', 'PLATFORM_PUBLIC_SIGNUP_ENABLED', 'PLATFORM_PAYTR_SANDBOX_ENABLED']) assert.equal(process.env[name], '0');
await assert.rejects(writeFile('/app/qa-must-be-read-only', 'not permitted'), error => ['EROFS', 'EACCES'].includes(error.code));
for (const file of ['/app/.env.local', '/crewinjob-agent/.env', '/crewinjob-agent/.userbot-config.json', '/app/scripts/preview-design.cjs', '/app/test/platform-loader.cjs']) await assert.rejects(access(file), { code: 'ENOENT' });
const runtime = await checkRuntimePackage(); assert.equal(runtime.ok, true);
await mkdir('/tmp/ryzevo-incomplete-package');
assert.equal((await checkRuntimePackage('/tmp/ryzevo-incomplete-package')).ok, false);
const legacy = spawnSync(process.execPath, ['--test', 'test/ai-client.test.js', 'test/api-fixes.test.js', 'test/marketing-api-contract.test.js', 'test/pipeline-fixes.test.js'], { cwd: '/crewinjob-agent', encoding: 'utf8', timeout: 30000 });
assert.equal(legacy.status, 0, 'Offline agent regressions failed: ' + legacy.stdout.slice(-1800));
let ready = false;
for (let i = 0; i < 100; i++) {
  try { if ((await request('/api/health')).status === 200) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 100));
}
assert.ok(ready, 'Container server started');
assert.deepEqual(Object.keys(await json(await request('/api/health'))).sort(), ['ok', 'ts']);
assert.equal((await request('/welcome')).status, 200);
const logo = await request('/brand/ryzevo-brand-board.png'); assert.equal(logo.status, 200); assert.ok((await logo.arrayBuffer()).byteLength > 10000);
assert.equal((await request('/api/workspace')).status, 401);
const admin = await login(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD), password = randomBytes(24).toString('hex');
const create = async name => {
  const profile = await json(await request('/api/platform/organizations', admin, 'POST', {
    organizationName: `Container QA ${name}`, projectName: `Container QA ${name}`, website: 'https://example.com', username: `container-${name}`, password,
  }), 201);
  return { ...profile, cookie: await login(`container-${name}`, password) };
};
const a = await create('alpha'), b = await create('beta');
for (const user of [a, b]) assert.equal((await json(await request('/api/campaigns', user.cookie))).items.length, 0);
const drafts = await Promise.all(Array.from({ length: 16 }, (_, index) => jsonDraft(index < 8 ? a : b, index)));
async function jsonDraft(user, index) {
  return json(await request('/api/campaigns', user.cookie, 'POST', { name: `Container QA draft ${index}`, objective: 'awareness', status: 'draft', channels: { email: true }, content: { text: 'Disposable fixture. Never sent.', subject: 'QA fixture only' } }), 201);
}
const aIds = new Set(drafts.slice(0, 8).map(item => item.id)), bIds = new Set(drafts.slice(8).map(item => item.id));
for (const id of aIds) assert.ok(!bIds.has(id));
const parallelStart = performance.now();
await Promise.all(Array.from({ length: 64 }, async (_, index) => {
  const own = index % 2 ? a : b, other = index % 2 ? b : a;
  assert.equal((await json(await request(`/api/platform/plan?organizationId=${other.organizationId}&projectId=${other.projectId}`, own.cookie))).projectId, own.projectId);
  const items = (await json(await request('/api/campaigns', own.cookie))).items, allowed = own === a ? aIds : bIds;
  assert.equal(items.length, 8); for (const item of items) assert.ok(allowed.has(item.id));
}));
const parallelMs = Math.round(performance.now() - parallelStart), foreignId = drafts[8].id, ownId = drafts[0].id;
for (const method of ['GET', 'DELETE', 'PATCH']) assert.equal((await request('/api/campaigns/' + foreignId, a.cookie, method, method === 'PATCH' ? { name: 'Denied' } : undefined)).status, 404);
assert.equal((await request('/api/campaigns', a.cookie, 'POST', { name: 'Denied' }, 'https://evil.example')).status, 403);
assert.equal((await request('/api/stats', a.cookie)).status, 403);
await json(await request('/api/campaigns/' + ownId, a.cookie, 'PATCH', { name: 'Container QA edited' }));
await json(await request('/api/campaigns/' + ownId, a.cookie, 'DELETE'));
assert.equal((await json(await request('/api/campaigns', a.cookie))).items.length, 7);
assert.equal((await json(await request('/api/campaigns', b.cookie))).items.length, 8);
const viewer = await json(await request('/api/platform/members', a.cookie, 'POST', { username: 'container-viewer', password, role: 'viewer' }), 201), viewerCookie = await login('container-viewer', password);
assert.equal((await request('/api/campaigns', viewerCookie, 'POST', { name: 'Denied', objective: 'awareness', channels: { email: true }, content: { text: 'Denied' } })).status, 403);
assert.equal((await request('/api/platform/worker', viewerCookie, 'POST')).status, 401);
await json(await request('/api/platform/members', a.cookie, 'PATCH', { userId: viewer.userId, role: 'viewer', active: false }));
assert.equal((await request('/api/workspace', viewerCookie)).status, 401);

// Longer opt-in checks retain strict duration/request bounds and no external network.
const soakSeconds = Number(process.env.PLATFORM_TEST_SOAK_SECONDS || 30);
assert.ok(Number.isInteger(soakSeconds) && soakSeconds >= 30 && soakSeconds <= 1800);
const perClientMax = soakSeconds * 4, memorySamples = [];
async function sampleMemory() {
  const status = await readFile('/proc/1/status', 'utf8'), match = status.match(/^VmRSS:\s+(\d+) kB$/m);
  assert.ok(match, 'Application RSS must be observed, not inferred from the driver.');
  memorySamples.push({ elapsedMs: Math.round(performance.now() - soakStart), appRssKiB: Number(match[1]) });
}
const soakStart = performance.now(), soakTimings = [], soakDeadline = soakStart + soakSeconds * 1000;
await sampleMemory();
const soakCounts = await Promise.all(Array.from({ length: 4 }, async (_, client) => {
  const own = client % 2 ? a : b, other = client % 2 ? b : a;
  const allowed = own === a ? new Set([...aIds].filter(id => id !== ownId)) : bIds, editable = own === a ? drafts[1].id : drafts[8].id;
  let count = 0;
  while (count < perClientMax && performance.now() < soakDeadline) {
    const started = performance.now();
    if (count % 4 === 0) assert.equal((await json(await request('/api/campaigns/' + editable, own.cookie, 'PATCH', { name: `QA bounded ${client}-${count}` }))).id, editable);
    else if (count % 4 === 1) assert.equal((await json(await request(`/api/platform/plan?projectId=${other.projectId}`, own.cookie))).projectId, own.projectId);
    else {
      const items = (await json(await request('/api/campaigns', own.cookie))).items;
      assert.equal(items.length, allowed.size); for (const item of items) assert.ok(allowed.has(item.id));
    }
    soakTimings.push(performance.now() - started); count++;
    if (client === 0 && count % 40 === 0) await sampleMemory();
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return count;
}));
const soakMs = Math.round(performance.now() - soakStart), soakRequests = soakCounts.reduce((n, count) => n + count, 0);
await sampleMemory();
assert.ok(soakCounts.every(count => count >= 10 && count <= perClientMax)); assert.ok(soakRequests <= perClientMax * 4); assert.ok(soakMs < soakSeconds * 1000 + 20000);
assert.deepEqual(Object.keys(await json(await request('/api/health'))).sort(), ['ok', 'ts']);

const rawAuth = async (body, type = 'application/json', cookie = '', route = '/api/auth/login') => {
  const response = await fetch(base + route, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { Origin: base, 'Content-Type': type, ...(cookie ? { Cookie: cookie } : {}) }, body });
  assert.equal(response.status, 400); if (!cookie) assert.ok(!response.headers.has('set-cookie'));
  assert.equal(typeof (await response.json()).error, 'string');
};
await Promise.all(['null', '[]', 'true', '{', '"text"', JSON.stringify({ username: 'qa', password: 'x', extra: 'x'.repeat(20000) })].map(body => rawAuth(body)));
await rawAuth('{}', 'application/jsonp');
await rawAuth(JSON.stringify({ action: 'password', extra: 'x'.repeat(20000) }), 'application/json', a.cookie, '/api/platform/account');
for (const name of ['login', 'enroll', 'identity']) {
  for (const origin of [null, 'https://evil.example']) {
    const response = await fetch(base + '/api/auth/' + name, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: '{}' });
    // Login/enroll retain existing non-browser compatibility (no Origin);
    // identity requires Origin. A foreign Origin must be denied on all three.
    assert.equal(response.status, origin || name === 'identity' ? 403 : 400);
    assert.ok(!response.headers.has('set-cookie')); await response.arrayBuffer();
  }
  assert.equal((await request('/api/auth/' + name + '-other')).status, 401);
}

// Deliberately unfinished HTTP uploads must be rejected without client cooperation.
const upload = chunks => new Promise((resolve, reject) => {
  const started = performance.now();
  const req = httpRequest(base + '/api/auth/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' } }, res => {
    let data = ''; res.setEncoding('utf8'); res.on('data', chunk => { data += chunk; });
    res.once('error', error => { clearTimeout(timer); req.destroy(); reject(error); });
    res.once('end', () => {
      try { assert.equal(res.statusCode, 400); assert.ok(!res.headers['set-cookie']); assert.equal(typeof JSON.parse(data).error, 'string'); resolve(Math.round(performance.now() - started)); }
      catch (error) { reject(error); } finally { clearTimeout(timer); req.destroy(); }
    });
  });
  const timer = setTimeout(() => { req.destroy(); reject(new Error('Bounded HTTP upload did not settle.')); }, 9000);
  req.once('error', error => { clearTimeout(timer); reject(error); });
  for (const chunk of chunks) req.write(chunk);
});
await upload([Buffer.alloc(9000, 'x'), Buffer.alloc(9000, 'x')]);
const stalledUploadMs = await upload(['{"username":']); assert.ok(stalledUploadMs < 8500);
const loginStatuses = [];
for (let batch = 0; batch < 6; batch++) await Promise.all(Array.from({ length: 4 }, async (_, index) => {
  const response = await request('/api/auth/login', '', 'POST', { username: index % 2 ? ' BLOCKED-QA-FIXTURE ' : 'blocked-qa-fixture', password: 'never-valid-fixture' });
  assert.ok(!response.headers.has('set-cookie')); assert.equal(typeof (await response.json()).error, 'string'); loginStatuses.push(response.status);
}));
assert.equal(loginStatuses.filter(status => status === 401).length, 20); assert.equal(loginStatuses.filter(status => status === 429).length, 4);
assert.equal((await request('/api/workspace', b.cookie)).status, 200);
const previousCookie = a.cookie, nextPassword = randomBytes(24).toString('hex');
await json(await request('/api/platform/account', a.cookie, 'POST', { action: 'password', currentPassword: password, nextPassword }));
await Promise.all(Array.from({ length: 16 }, async (_, index) => {
  const response = await request(index % 2 ? '/api/workspace' : '/api/campaigns', previousCookie);
  assert.equal(response.status, index % 2 ? 401 : 403); await response.arrayBuffer();
}));
assert.equal((await request('/api/campaigns/' + drafts[1].id, previousCookie, 'PATCH', { name: 'Must remain denied' })).status, 403);
const deniedRefresh = await request('/api/workspace', previousCookie); assert.equal(deniedRefresh.status, 401);
const refreshedOldCookie = deniedRefresh.headers.get('set-cookie')?.split(';')[0];
if (refreshedOldCookie) assert.equal((await request('/api/workspace', refreshedOldCookie)).status, 401);
a.cookie = await login('container-alpha', nextPassword);
assert.equal((await json(await request('/api/workspace', a.cookie))).project.id, a.projectId);
assert.equal((await json(await request('/api/campaigns', b.cookie))).items.length, 8);

// Store a fixture credential only; never verify it or connect to its provider.
await json(await request('/api/marketing/connections', a.cookie, 'POST', { provider: 'email', integrationId: 'container-fixture', accountName: 'QA fixture only', accessToken: 'fixture-only-unused-password', smtp: { host: 'email-smtp.eu-west-1.amazonaws.com', port: 587, user: 'fixture-user', fromEmail: 'qa@example.com', fromName: 'QA only' } }));
const tick = await json(await fetch(base + '/api/platform/worker', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.CRON_SECRET } }));
assert.equal(tick.checked, 0); assert.equal(tick.failed, 0);
operator('platform-backup');
const folders = await readdir('/app/data/backups'); assert.equal(folders.length, 1);
const backup = '/app/data/backups/' + folders[0], verified = lastJson(operator('platform-verify-backup', [backup]));
assert.equal(verified.ok, true); assert.equal(verified.encryptedRecords, 1); assert.equal(verified.credentialCheck, 'authenticated');
const drill = lastJson(operator('platform-restore-drill', [backup]));
assert.equal(drill.ok, true); assert.equal(drill.productionRestorePerformed, false); assert.equal(drill.encryptedRecords, 1);
assert.ok((await stat(drill.directory + '/DO_NOT_START.txt')).isFile());
const monitor = lastJson(operator('platform-monitor'));
assert.equal(monitor.status, 'ok'); assert.equal(monitor.worker.status, 'completed'); assert.equal(monitor.backup.status, 'verified');
assert.equal(monitor.queue.ready, 0); assert.equal(monitor.notificationsSent, false);
timings.sort((x, y) => x - y); soakTimings.sort((x, y) => x - y);
console.log(JSON.stringify({ ok: true, nodeMajor: runtime.nodeMajor, uid: process.getuid(), rootReadOnly: true, tenants: 2, createdDrafts: 16,
  concurrentReadFlows: 64, concurrentReadRequests: 128, parallelReadMs: parallelMs, requestP95Ms: Math.round(timings[Math.floor(timings.length * 0.95)]), requestCount: timings.length,
  boundedSoak: { clients: 4, targetMs: soakSeconds * 1000, elapsedMs: soakMs, maxRequests: perClientMax * 4, requests: soakRequests, requestP95Ms: Math.round(soakTimings[Math.floor(soakTimings.length * 0.95)]), unexpectedFailures: 0,
    memorySamples: memorySamples.length, initialAppRssKiB: memorySamples[0].appRssKiB, finalAppRssKiB: memorySamples.at(-1).appRssKiB, peakAppRssKiB: Math.max(...memorySamples.map(sample => sample.appRssKiB)), leakFreedomAssessed: false },
  abuseChecks: { invalidBodies: 8, authOriginRejections: 4, adjacentProtectedPaths: 3, chunkedOversize: 'denied', stalledUploadMs, loginAttempts: 24, rateLimited: 4, revokedReads: 16 },
  quotaRaceCoveredSeparately: true, nativeSqlite: true, encryptedBackupRecords: verified.encryptedRecords, schemaVersion: verified.schemaVersion,
  restoreDrill: true, operatorProbe: 'ok', legacyAgentTests: 'passed', providerFlagsOff: true, productionCapacityAssessed: false, productionReadinessAssessed: false }));
