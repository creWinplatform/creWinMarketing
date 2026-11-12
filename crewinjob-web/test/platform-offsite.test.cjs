const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { load } = require('./platform-loader.cjs');
const { openPlatformDatabase } = load('database.ts');
const { PlatformRepository } = load('repository.ts');
const offsite = import('../scripts/lib/platform-offsite.mjs');
const monitoring = import('../scripts/lib/platform-monitor.mjs');
const cwd = path.join(__dirname, '..');
// Fake AWS values are made at run time. No request leaves the machine: the transport is a recorder.
const fakeKeys = (prefix = 'AKIA') => ({ accessKeyId: prefix + crypto.randomBytes(16).toString('hex').toUpperCase().slice(0, 16), secretAccessKey: crypto.randomBytes(30).toString('base64') });
const env = (keys = fakeKeys()) => ({ PLATFORM_OFFSITE_ENABLED: '1', PLATFORM_OFFSITE_S3_BUCKET: 'ryzevo-qa-backups', PLATFORM_OFFSITE_S3_REGION: 'eu-central-1', PLATFORM_OFFSITE_S3_PREFIX: 'qa/platform', PLATFORM_OFFSITE_AWS_ACCESS_KEY_ID: keys.accessKeyId, PLATFORM_OFFSITE_AWS_SECRET_ACCESS_KEY: keys.secretAccessKey });

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ryzevo-offsite-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'platform.sqlite'), backups = path.join(directory, 'backups'), key = crypto.randomBytes(32).toString('hex');
  const db = openPlatformDatabase(file); await new PlatformRepository(db).bootstrapLegacy('offsite-admin'); db.close();
  fs.writeFileSync(path.join(directory, 'platform-credentials.key'), key);
  const backup = () => { const result = spawnSync(process.execPath, ['scripts/platform-backup.mjs'], { cwd, windowsHide: true, encoding: 'utf8', timeout: 30000, env: { ...process.env, PLATFORM_DATABASE_PROVIDER: 'sqlite', PLATFORM_DATABASE_PATH: file, PLATFORM_BACKUP_PATH: backups, PLATFORM_ENCRYPTION_KEY: '' } }); assert.equal(result.status, 0, result.stderr); return path.join(backups, fs.readdirSync(backups).sort().at(-1)); };
  return { directory, file, backups, backup, statePath: path.join(directory, 'offsite-state.json') };
}
// A small S3 stand-in: stores what was put (once), answers HEAD with the stored size and checksum.
function fakeS3({ deny = false, corrupt = false } = {}) {
  const objects = new Map(), calls = [];
  const transport = async ({ method, host, path: objectPath, headers, file }) => {
    calls.push({ method, host, path: objectPath, headers });
    if (deny) return { status: 403, headers: {} };
    if (method === 'PUT') {
      if (await objects.has(objectPath)) return { status: 412, headers: {} };
      const body = fs.readFileSync(file);
      if (crypto.createHash('sha256').update(body).digest('base64') !== headers['x-amz-checksum-sha256']) return { status: 400, headers: {} };
      objects.set(objectPath, { bytes: body.length, checksum: corrupt ? 'AAAA' : headers['x-amz-checksum-sha256'] }); return { status: 200, headers: {} };
    }
    const item = await objects.get(objectPath);
    return item ? { status: 200, headers: { 'content-length': String(item.bytes), 'x-amz-checksum-sha256': item.checksum } } : { status: 404, headers: {} };
  };
  return { objects, calls, transport };
}

test('the request signature matches the AWS reference signer', async () => {
  const { signS3, s3Path } = await offsite, { SignatureV4 } = require('@smithy/signature-v4');
  class Sha256 { constructor(secret) { this.hash = secret ? crypto.createHmac('sha256', secret) : crypto.createHash('sha256'); } update(data) { this.hash.update(data); } async digest() { return new Uint8Array(this.hash.digest()); } }
  for (const sessionToken of ['', 'fake-session-' + crypto.randomBytes(8).toString('hex')]) {
    const credentials = { ...fakeKeys(sessionToken ? 'ASIA' : 'AKIA'), ...(sessionToken ? { sessionToken } : {}) }, now = new Date('2026-11-06T03:30:00Z');
    const host = 'ryzevo-qa-backups.s3.eu-central-1.amazonaws.com', objectPath = s3Path('qa/platform/db id/2026-11-06T03-00-00-000Z-x/platform.sqlite'), payloadHash = crypto.randomBytes(32).toString('hex');
    const headers = { 'content-type': 'application/octet-stream', 'content-length': '1851392', 'if-none-match': '*', 'x-amz-checksum-sha256': 'abc=', 'x-amz-server-side-encryption': 'AES256' };
    const ours = signS3({ method: 'PUT', host, path: objectPath, headers, payloadHash, region: 'eu-central-1', credentials, now });
    const reference = await new SignatureV4({ credentials, region: 'eu-central-1', service: 's3', sha256: Sha256, uriEscapePath: false, applyChecksum: false })
      .sign({ method: 'PUT', protocol: 'https:', hostname: host, path: objectPath, query: {}, headers: { ...headers, host, 'x-amz-content-sha256': payloadHash } }, { signingDate: now });
    assert.equal(ours.authorization, reference.headers.authorization, sessionToken ? 'with a session token' : 'with long-term keys');
  }
  assert.equal(s3Path('a b/c(d)'), '/a%20b/c%28d%29');
});

test('the off-host copy is off by default and refuses unsafe settings', async () => {
  const { offsiteConfiguration: config } = await offsite;
  assert.equal(config({}), null);
  assert.equal(config(env()).credentials.secretAccessKey.length, 40);
  for (const extra of [{ PLATFORM_OFFSITE_S3_BUCKET: 'Bad_Bucket' }, { PLATFORM_OFFSITE_S3_BUCKET: 'dotted.bucket' }, { PLATFORM_OFFSITE_S3_REGION: 'europe' }, { PLATFORM_OFFSITE_S3_PREFIX: '../escape' }, { PLATFORM_OFFSITE_AWS_ACCESS_KEY_ID: 'short' }, { PLATFORM_OFFSITE_KMS_KEY_ID: 'bad key' }])
    assert.throws(() => config({ ...env(), ...extra }), /invalid_offsite_configuration/, JSON.stringify(Object.keys(extra)));
  const role = config({ ...env(), PLATFORM_OFFSITE_AWS_ACCESS_KEY_ID: '', PLATFORM_OFFSITE_AWS_SECRET_ACCESS_KEY: '', PLATFORM_OFFSITE_USE_INSTANCE_ROLE: '1' });
  assert.equal(role.instanceRole, true); assert.equal(role.credentials, null);
});

test('the newest backup is copied once, encrypted, checksummed and read back; the key file never leaves', async t => {
  const { copyLatestBackup } = await offsite, f = await fixture(t), folder = f.backup(), s3 = fakeS3(), keys = fakeKeys();
  assert.ok(fs.readdirSync(folder).includes('platform-credentials.key'), 'this backup carries a key file');
  assert.deepEqual(await copyLatestBackup({ backupRoot: f.backups, statePath: f.statePath, env: {}, transport: s3.transport }), { status: 'disabled' });
  const result = await copyLatestBackup({ backupRoot: f.backups, statePath: f.statePath, env: env(keys), transport: s3.transport });
  assert.equal(result.status, 'copied'); assert.equal(result.objects, 2); assert.equal(result.keyFileCopied, false); assert.equal(result.keyFileKeptLocal, true);
  const puts = s3.calls.filter(call => call.method === 'PUT');
  assert.deepEqual(puts.map(call => path.posix.basename(call.path)), ['platform.sqlite', 'manifest.json'], 'the manifest goes last');
  assert.ok(puts.every(call => call.path.startsWith('/qa/platform/') && call.path.includes(path.basename(folder))));
  assert.ok(puts.every(call => call.headers['if-none-match'] === '*' && call.headers['x-amz-server-side-encryption'] === 'AES256' && call.headers.authorization.startsWith('AWS4-HMAC-SHA256 ')));
  assert.equal(s3.calls.filter(call => call.method === 'HEAD').length, 2);
  assert.ok(!JSON.stringify(s3.calls).includes(keys.secretAccessKey), 'the secret is never sent');
  const state = fs.readFileSync(f.statePath, 'utf8'); assert.ok(!state.includes(keys.accessKeyId)); assert.equal(JSON.parse(state).folder, path.basename(folder));
  assert.equal((await copyLatestBackup({ backupRoot: f.backups, statePath: f.statePath, env: env(keys), transport: s3.transport })).status, 'up_to_date');
  // A retry after a lost state file finds the objects already there and accepts them only when they match.
  fs.rmSync(f.statePath);
  assert.equal((await copyLatestBackup({ backupRoot: f.backups, statePath: f.statePath, env: env(keys), transport: s3.transport })).status, 'copied');
  const kms = await copyLatestBackup({ backupRoot: f.backups, statePath: path.join(f.directory, 'kms.json'), env: { ...env(keys), PLATFORM_OFFSITE_KMS_KEY_ID: 'alias/ryzevo-backups' }, transport: fakeS3().transport });
  assert.equal(kms.status, 'copied');
});

test('failures are recorded as codes and the monitor reports missing, stale and failing copies', async t => {
  const { copyLatestBackup } = await offsite, { monitorConfiguration, monitorPlatform } = await monitoring, f = await fixture(t);
  assert.deepEqual(await copyLatestBackup({ backupRoot: f.backups, statePath: f.statePath, env: env(), transport: fakeS3().transport }), { status: 'failed', code: 'backup_missing_or_incomplete' });
  f.backup();
  assert.deepEqual(await copyLatestBackup({ backupRoot: f.backups, statePath: f.statePath, env: env(), transport: fakeS3({ deny: true }).transport }), { status: 'failed', code: 'offsite_access_denied' });
  assert.deepEqual(await copyLatestBackup({ backupRoot: f.backups, statePath: f.statePath, env: env(), transport: fakeS3({ corrupt: true }).transport }), { status: 'failed', code: 'offsite_verify_failed' });
  const options = monitorConfiguration({ PLATFORM_OFFSITE_EXPECTED: '1' }), diskStats = async () => ({ bavail: 4096, bsize: 1024 ** 2 });
  const report = now => monitorPlatform({ databasePath: f.file, backupRoot: f.backups, offsiteStatePath: f.statePath, options, now, diskStats });
  assert.ok((await report(Date.now())).alerts.some(item => item.code === 'offsite_copy_missing'));
  assert.equal((await monitorPlatform({ databasePath: f.file, backupRoot: f.backups, offsiteStatePath: f.statePath, options: monitorConfiguration({}), diskStats })).offsite.status, 'not_expected');
  assert.equal((await copyLatestBackup({ backupRoot: f.backups, statePath: f.statePath, env: env(), transport: fakeS3().transport })).status, 'copied');
  let checked = await report(Date.now());assert.equal(checked.offsite.status, 'copied');assert.ok(!checked.alerts.some(item => item.code.startsWith('offsite_')));
  assert.ok((await report(Date.now() + 51 * 3600000)).alerts.some(item => item.code === 'offsite_copy_stale'));
  f.backup();await copyLatestBackup({ backupRoot: f.backups, statePath: f.statePath, env: env(), transport: fakeS3({ deny: true }).transport });
  checked = await report(Date.now());assert.equal(checked.offsite.status, 'failing');assert.ok(checked.alerts.some(item => item.code === 'offsite_copy_failed'));
  assert.throws(() => monitorConfiguration({ PLATFORM_MONITOR_OFFSITE_MAX_AGE_HOURS: '1' }));
});

test('instance role credentials come from IMDSv2 with a session token', async () => {
  const { instanceCredentials } = await offsite, keys = fakeKeys('ASIA'), seen = [];
  const fetchImpl = async (url, init = {}) => { seen.push({ url, method: init.method || 'GET', token: init.headers?.['x-aws-ec2-metadata-token'] || null });
    if (url.endsWith('/api/token')) return new Response('imds-token');
    if (url.endsWith('/security-credentials/')) return new Response('ryzevo-backup-role\n');
    return Response.json({ AccessKeyId: keys.accessKeyId, SecretAccessKey: keys.secretAccessKey, Token: 'session' }); };
  assert.deepEqual(await instanceCredentials(fetchImpl), { ...keys, sessionToken: 'session' });
  assert.equal(seen[0].method, 'PUT'); assert.ok(seen.slice(1).every(call => call.token === 'imds-token'));
  await assert.rejects(instanceCredentials(async url => url.endsWith('/api/token') ? new Response('t') : new Response('../evil')), /instance_role_unavailable/);
});

test('the CLI is off without settings and reports a bad configuration as a code', () => {
  const run = extra => spawnSync(process.execPath, ['scripts/platform-offsite.mjs'], { cwd, windowsHide: true, encoding: 'utf8', timeout: 30000, env: { ...process.env, PLATFORM_OFFSITE_ENABLED: '0', ...extra } });
  const off = run({}); assert.equal(off.status, 0); assert.deepEqual(JSON.parse(off.stdout.trim()), { status: 'disabled' });
  const bad = run({ PLATFORM_OFFSITE_ENABLED: '1', PLATFORM_OFFSITE_S3_BUCKET: 'Bad_Bucket' }); assert.equal(bad.status, 1); assert.match(bad.stderr, /invalid_offsite_configuration/);
});
