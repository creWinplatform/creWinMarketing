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
const key = '12'.repeat(32), wrongKey = '34'.repeat(32);
const cwd = path.join(__dirname, '..');
const recovery = import('../scripts/lib/platform-recovery.mjs');

function fixture(t, { environment = false, noKey = false, encrypted = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ryzevo-recovery-'));
  t.after(() => {
    if (db.open) db.close();
    const absolute = path.resolve(directory), parent = path.resolve(os.tmpdir());
    assert.equal(path.dirname(absolute), parent);
    assert.ok(path.basename(absolute).startsWith('ryzevo-recovery-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  const source = path.join(directory, 'platform.sqlite'), backups = path.join(directory, 'backups');
  const db = openPlatformDatabase(source), repo = new PlatformRepository(db);
  repo.bootstrapLegacy('backup-admin');
  const a = repo.provision('legacy-admin', { organizationName: 'Alpha', projectName: 'Alpha', website: 'https://example.com', username: 'alpha', password: 'fixture-password-123' });
  const b = repo.provision('legacy-admin', { organizationName: 'Beta', projectName: 'Beta', website: 'https://example.org', username: 'beta', password: 'fixture-password-123' });
  if (encrypted) for (const [index, project] of [a, b].entries()) {
    const id = `connection-${index}`;
    db.prepare('INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(
      id, project.organizationId, project.projectId, 'custom', id, 'Private account',
      encryptCredentials({ accessToken: 'DO-NOT-PRINT-SECRET', refreshToken: '' }, key, project.organizationId, project.projectId, id), new Date().toISOString());
  }
  if (!environment && !noKey) fs.writeFileSync(path.join(directory, 'platform-credentials.key'), key);
  const env = { ...process.env, PLATFORM_DATABASE_PATH: source, PLATFORM_BACKUP_PATH: backups, PLATFORM_ENCRYPTION_KEY: environment ? key : '' };
  const run = (script, args = [], extra = {}) => spawnSync(process.execPath, [`scripts/${script}.mjs`, ...args], { cwd, windowsHide: true, encoding: 'utf8', timeout: 30000, env: { ...env, ...extra } });
  const backup = () => {
    const result = run('platform-backup');
    const folders = fs.existsSync(backups) ? fs.readdirSync(backups).sort() : [];
    return { result, folder: folders.length ? path.join(backups, folders.at(-1)) : null };
  };
  return { directory, source, backups, db, a, b, run, backup };
}
const manifestAt = folder => JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
const modifyManifest = (folder, edit) => {
  const manifest = manifestAt(folder); edit(manifest);
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest));
};

test('sealed online backup and offline drill verify scoped credentials without mutating the source', async t => {
  const f = fixture(t), { result, folder } = f.backup();
  assert.equal(result.status, 0, result.stderr);
  const { verifyBackup, fileDigest, MAX_RECOVERY_SCHEMA } = await recovery;
  const manifest = manifestAt(folder);
  assert.equal(manifest.formatVersion, 2);
  assert.equal(manifest.schemaVersion, MAX_RECOVERY_SCHEMA);
  assert.equal(manifest.schemaVersion, f.db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n);
  assert.equal(manifest.keySource, 'file');
  assert.match(manifest.databaseSha256, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(manifest).includes(key));
  const before = await fileDigest(path.join(folder, 'platform.sqlite'));
  const { checks } = await verifyBackup(folder);
  assert.equal(checks.encryptedRecords, 2);
  assert.equal(checks.credentialCheck, 'authenticated');
  assert.ok(checks.scopedTables > 20);
  assert.ok(checks.scopedReferences > 10);
  const root = path.join(f.directory, 'drills'), drill = f.run('platform-restore-drill', [folder, root]);
  assert.equal(drill.status, 0, drill.stderr);
  const restored = path.join(root, fs.readdirSync(root)[0]), reportText = fs.readFileSync(path.join(restored, 'recovery-report.json'), 'utf8'), report = JSON.parse(reportText);
  assert.equal(report.applicationStarted, false);
  assert.equal(report.workerStarted, false);
  assert.equal(report.productionRestorePerformed, false);
  assert.equal(report.providerRequestsMade, false);
  assert.equal(report.authSecretRotationRequired, true);
  assert.equal(report.integrity, 'ok');
  assert.equal(report.encryptedRecords, 2);
  assert.ok(!reportText.includes(key) && !drill.stdout.includes('DO-NOT-PRINT-SECRET') && !drill.stderr.includes('DO-NOT-PRINT-SECRET'));
  assert.ok(fs.existsSync(path.join(restored, 'DO_NOT_START.txt')));
  assert.equal((await fileDigest(path.join(restored, 'platform.sqlite'))).sha256, before.sha256);
  assert.equal((await fileDigest(path.join(folder, 'platform.sqlite'))).sha256, before.sha256);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_connections').get().n, 2);
  assert.equal(fs.existsSync(path.join(folder, 'platform.sqlite-wal')), false);
  assert.equal(fs.existsSync(path.join(folder, 'platform.sqlite-shm')), false);
});

test('environment key is never copied and a matching vaulted key is required even without credential rows', async t => {
  const f = fixture(t, { environment: true, encrypted: false }), { result, folder } = f.backup();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(manifestAt(folder).keySource, 'environment');
  assert.equal(fs.existsSync(path.join(folder, 'platform-credentials.key')), false);
  const { verifyBackup } = await recovery;
  await assert.rejects(verifyBackup(folder, wrongKey), { code: 'key_mismatch' });
  await assert.rejects(verifyBackup(folder, ''), { code: 'invalid_key' });
  assert.equal((await verifyBackup(folder, key)).checks.credentialCheck, 'no_encrypted_records');
  const rejected = f.run('platform-verify-backup', [folder], { PLATFORM_ENCRYPTION_KEY: wrongKey });
  assert.equal(rejected.status, 1);
  assert.ok(!rejected.stderr.includes(key) && !rejected.stderr.includes(wrongKey));
});

test('every current encrypted storage contract authenticates using the application AAD format', async t => {
  const f = fixture(t), { organizationId: organization_id, projectId: project_id, userId } = f.a;
  const now = new Date().toISOString(), scope = { organization_id, project_id };
  const encrypted = resource => encryptCredentials({ secret: 'DO-NOT-PRINT-SECRET' }, key, organization_id, project_id, resource);
  const insert = (table, values) => {
    const keys = Object.keys(values);
    f.db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(values));
  };
  for (const id of ['email-job', 'social-job']) insert('platform_jobs', {
    ...scope, id, actor_id: userId, connection_id: 'connection-0', revision: 'fixture', idempotency_key: id, status: 'queued', created_at: now, updated_at: now,
  });
  insert('platform_oauth_requests', { ...scope, state_hash: 'state', actor_id: userId, browser_hash: 'hash', provider: 'custom', resource: 'fixture', account_name: 'Private', encrypted_verifier: encrypted('state'), expires_at: now });
  insert('platform_product_sources', { ...scope, connection_id: 'connection-0', version: 1, config_json: '{}', encrypted_checkpoint: encrypted('connection-0:checkpoint') });
  insert('platform_email_consents', { ...scope, contact_key: 'contact', decision: 'reviewed', encrypted_evidence: encrypted('contact'), actor_id: userId, created_at: now });
  insert('platform_email_sender', { ...scope, connection_id: 'connection-0', connection_revision: 'fixture', domain: 'example.com', masked_sender: 'i***@example.com', max_recipients: 1, revision: 1, manager_id: userId, challenge_hash: 'hash', encrypted_challenge: encrypted('email-domain'), challenge_expires_at: now, updated_at: now });
  insert('platform_email_pilots', { ...scope, job_id: 'email-job', campaign_id: 'campaign', campaign_name: 'Private', review_id: 1, encrypted_snapshot: encrypted('email-job') });
  insert('platform_email_pilot_recipients', { ...scope, job_id: 'email-job', position: 1, email_key: 'hash', masked_email: 'i***@example.com', state: 'queued', updated_at: now, encrypted_message: encrypted('email-job:1') });
  insert('platform_email_ses', { ...scope, connection_id: 'connection-0', binding_revision: 'fixture', revision: 1, manager_id: userId, region: 'eu-west-1', configuration_set: 'fixture', topic_arn: 'fixture', encrypted_credentials: encrypted('ses-provider') });
  insert('platform_social_publications', { ...scope, job_id: 'social-job', source_kind: 'content', source_id: 'draft', source_digest: 'hash', body_digest: 'hash', encrypted_snapshot: encrypted('publication:social-job'), mode: 'rehearsal', scheduled_at: now, timezone: 'UTC', configuration_revision: 'fixture' });
  insert('platform_identity_challenges', { token_hash: 'challenge', kind: 'verify', user_id: userId, email: 'fixture@example.com', security_version: 0, configuration_revision: 'fixture', created_at: Date.now(), expires_at: Date.now() + 10000, encrypted_delivery: encryptCredentials({ secret: 'DO-NOT-PRINT-SECRET' }, key, 'platform-identity', 'system-email', 'challenge'), delivery_state: 'queued' });
  insert('platform_billing_orders', { ...scope, id: 'RZTESTfixture', actor_id: userId, idempotency_key: 'fixture', request_digest: 'hash', configuration_revision: 'fixture', merchant_revision: 'fixture', plan_id: 'launch', plan_name: 'Launch', cadence: 'monthly', amount_minor: 2900, currency: 'USD', test_mode: 1, state: 'pending', encrypted_token: encrypted('RZTESTfixture'), created_at: now, expires_at: now, updated_at: now });
  const { result, folder } = f.backup();
  assert.equal(result.status, 0, result.stderr);
  const { checks } = await (await recovery).verifyBackup(folder);
  assert.equal(checks.encryptedRecords, 12);
  assert.equal(checks.credentialCheck, 'authenticated');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM platform_jobs WHERE status='queued'").get().n, 2);
});

test('file-key backup ignores an unrelated active environment key but rejects a replaced key file', async t => {
  const f = fixture(t), { result, folder } = f.backup();
  assert.equal(result.status, 0, result.stderr);
  const { verifyBackup } = await recovery;
  await verifyBackup(folder, wrongKey);
  fs.writeFileSync(path.join(folder, 'platform-credentials.key'), wrongKey);
  await assert.rejects(verifyBackup(folder, key), { code: 'key_mismatch' });
});

test('pre-27 sealed backups still verify without a database binding, while a changed binding is rejected', async t => {
  const f = fixture(t), { verifyBackup, keyProof } = await recovery;
  require('./schema-fixture.cjs').removeWorkerObservationSchema(f.db);
  const { result, folder } = f.backup(); assert.equal(result.status, 0, result.stderr);
  modifyManifest(folder, manifest => { delete manifest.databaseId; manifest.keyProof = keyProof(manifest, key); });
  const verified = await verifyBackup(folder);
  assert.equal(verified.checks.schemaVersion, 26); assert.equal(verified.checks.databaseId, null);
  modifyManifest(folder, manifest => { manifest.databaseId = '11111111-1111-1111-1111-111111111111'; manifest.keyProof = keyProof(manifest, key); });
  await assert.rejects(verifyBackup(folder), { code: 'database_identity_mismatch' });
});

test('unmodified no-key databases can be checked, but encrypted records without their key fail closed', async t => {
  const f = fixture(t, { noKey: true, encrypted: false }), { result, folder } = f.backup();
  assert.equal(result.status, 0, result.stderr);
  const { verifyBackup } = await recovery;
  assert.equal((await verifyBackup(folder)).manifest.keySource, 'not_created');
  f.db.prepare('INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(
    'encrypted', f.a.organizationId, f.a.projectId, 'custom', 'encrypted', 'Private', encryptCredentials({}, key, f.a.organizationId, f.a.projectId, 'encrypted'), new Date().toISOString());
  const second = f.backup();
  assert.equal(second.result.status, 1);
  assert.match(second.result.stderr, /missing_key/);
});

test('modified snapshot bytes are rejected before SQLite is opened', async t => {
  const f = fixture(t), { folder, result } = f.backup();
  assert.equal(result.status, 0, result.stderr);
  fs.appendFileSync(path.join(folder, 'platform.sqlite'), Buffer.from('damaged'));
  await assert.rejects((await recovery).verifyBackup(folder), { code: 'database_hash_mismatch' });
  const rejected = f.run('platform-restore-drill', [folder, path.join(f.directory, 'drills')]);
  assert.equal(rejected.status, 1);
  assert.equal(fs.existsSync(path.join(f.directory, 'drills')), false);
});

test('unrecorded WAL and journal sidecars cannot be silently incorporated into a snapshot', async t => {
  const f = fixture(t), { folder, result } = f.backup();
  assert.equal(result.status, 0, result.stderr);
  fs.writeFileSync(path.join(folder, 'platform.sqlite-wal'), 'untracked');
  await assert.rejects((await recovery).verifyBackup(folder), { code: 'snapshot_sidecar_found' });
});

test('manifests cannot redirect the database path or downgrade to an unsealed legacy format', async t => {
  const f = fixture(t), { folder, result } = f.backup();
  assert.equal(result.status, 0, result.stderr);
  const { verifyBackup } = await recovery;
  modifyManifest(folder, value => { value.database = '../platform.sqlite'; });
  await assert.rejects(verifyBackup(folder), { code: 'invalid_manifest' });
  modifyManifest(folder, value => { value.database = 'platform.sqlite'; value.formatVersion = 1; });
  await assert.rejects(verifyBackup(folder), { code: 'unsupported_backup_format' });
});

test('backup fails if encrypted rows were copied across customer scopes', t => {
  const f = fixture(t);
  const row = f.db.prepare("SELECT encrypted_credentials FROM platform_connections WHERE id='connection-0'").get();
  f.db.prepare("UPDATE platform_connections SET encrypted_credentials=? WHERE id='connection-1'").run(row.encrypted_credentials);
  const { result } = f.backup();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /credential_authentication_failed/);
  assert.ok(!result.stderr.includes('DO-NOT-PRINT-SECRET'));
});

test('cross-project connection references fail even when ordinary foreign keys are valid', t => {
  const f = fixture(t);
  f.db.prepare('INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    'foreign-job', f.b.organizationId, f.b.projectId, f.b.userId, 'connection-0', 'revision', 'unique-key', 'queued', new Date().toISOString(), new Date().toISOString());
  assert.equal(f.db.pragma('foreign_key_check').length, 0);
  const { result } = f.backup();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /reference_scope_failed/);
  assert.equal(f.db.prepare("SELECT status FROM platform_jobs WHERE id='foreign-job'").get().status, 'queued');
});

test('orphaned project scopes and undeclared encrypted columns fail recovery checks', t => {
  const f = fixture(t);
  f.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run('legacy-admin', 'missing', 'missing', 'fixture', new Date().toISOString());
  const orphan = f.backup();
  assert.equal(orphan.result.status, 1);
  assert.match(orphan.result.stderr, /project_scope_failed/);
  f.db.prepare("DELETE FROM platform_audit WHERE organization_id='missing'").run();
  f.db.exec("ALTER TABLE platform_connections ADD COLUMN encrypted_unknown TEXT NOT NULL DEFAULT ''");
  const unknown = f.backup();
  assert.equal(unknown.result.status, 1);
  assert.match(unknown.result.stderr, /unsupported_encrypted_column/);
});

test('future and gapped migrations are rejected without running migrations', t => {
  const f = fixture(t);
  f.db.prepare("INSERT INTO platform_migrations VALUES(52,datetime('now'))").run();
  const future = f.backup();
  assert.equal(future.result.status, 1);
  assert.match(future.result.stderr, /unsupported_schema/);
  f.db.prepare('DELETE FROM platform_migrations WHERE version IN (12,52)').run();
  const gap = f.backup();
  assert.equal(gap.result.status, 1);
  assert.match(gap.result.stderr, /schema_mismatch/);
  assert.equal(f.db.prepare('SELECT version FROM platform_migrations WHERE version=12').get(), undefined);
});

test('drill rejects backup-nested targets and never overwrites an existing destination file', async t => {
  const f = fixture(t), { result, folder } = f.backup();
  assert.equal(result.status, 0, result.stderr);
  const nested = f.run('platform-restore-drill', [folder, path.join(folder, 'nested')]);
  assert.equal(nested.status, 1);
  assert.match(nested.stderr, /output_inside_backup/);
  assert.equal(fs.existsSync(path.join(folder, 'nested')), false);
  const sentinel = path.join(f.directory, 'sentinel'); fs.writeFileSync(sentinel, 'unchanged');
  assert.equal(f.run('platform-restore-drill', [folder, sentinel]).status, 1);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
});

test('backup symlinks are refused rather than followed', async t => {
  const f = fixture(t), { result, folder } = f.backup();
  assert.equal(result.status, 0, result.stderr);
  const link = path.join(f.directory, 'backup-link');
  try { fs.symlinkSync(folder, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('OS denies symlink creation'); return; } throw error; }
  await assert.rejects((await recovery).verifyBackup(link), { code: 'unsafe_link' });
});
