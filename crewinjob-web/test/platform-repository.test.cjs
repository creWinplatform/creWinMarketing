const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { load } = require('./platform-loader.cjs');
const { openPlatformDatabase } = load('database.ts');
const { PlatformRepository } = load('repository.ts');
const { ProjectMarketingStore } = load('marketing-store.ts');
const { ConnectionJobs, verifyGoogleConnection } = load('connection-jobs.ts');
const { ProjectGoogleOAuth } = load('google-oauth.ts');
const { decryptCredentials } = load('credential-envelope.ts');
const { refreshGoogleCredentials, googleConfiguration } = load('google-client.ts');
const { verifySmtpConnection } = load('email-connection.ts');
const { normalizeSmtpConfiguration } = load('email-configuration.ts');
const { resolvePublicAddress } = load('../site-audit.ts');
const { ProjectLinkedInOAuth } = load('linkedin-oauth.ts');
const { OAuthRequests } = load('oauth-requests.ts');
const { verifySocialConnection, readSocialJson } = load('social-connection.ts');
const { ProjectMetaOAuth } = load('meta-oauth.ts');
const fixture = () => {
  const db = openPlatformDatabase(':memory:');
  const repository = new PlatformRepository(db);
  repository.bootstrapLegacy('fixture-admin');
  const provision = name => repository.provision('legacy-admin', { organizationName: name, projectName: name, website: `https://${name.toLowerCase()}.example`, username: `${name}-owner`, password: 'test-password-with-12-chars' });
  return { db, repository, a: provision('Alpha'), b: provision('Beta') };
};

test('two persisted organizations have isolated project and member reads/writes', () => {
  const { db, repository, a, b } = fixture();
  try {
    assert.equal(repository.workspaces(a.userId).length, 1);
    assert.equal(repository.workspace(a.userId, b.organizationId, b.projectId), null);
    assert.equal(repository.can(a.userId, a.organizationId, b.projectId, 'read'), false);
    assert.throws(() => repository.members(a.userId, b.organizationId, b.projectId));
    assert.throws(() => repository.updateMember(a.userId, b.organizationId, b.projectId, b.userId, 'viewer', false));
    assert.equal(repository.workspace(b.userId, b.organizationId, b.projectId).project.productPack, 'standard');
    assert.deepEqual(Array.from(repository.workspace(a.userId, a.organizationId, a.projectId).modules, item => item.id), ['dashboard', 'mobile', 'library', 'seo', 'campaigns', 'analytics', 'calendar', 'project']);
  } finally { db.close(); }
});

const draft = id => ({ id, name: 'Same campaign name', status: 'draft', content: { text: 'Draft text' }, updatedAt: new Date().toISOString() });
const scopedStore = (db, tenant) => new ProjectMarketingStore(db, { subject: tenant.userId, organizationId: tenant.organizationId, projectId: tenant.projectId });
const scopedJobs = (db, tenant) => new ConnectionJobs(db, { subject: tenant.userId, organizationId: tenant.organizationId, projectId: tenant.projectId });

const googleFixtureClient = (getToken = async () => ({ tokens: { access_token: 'oauth-access-secret', refresh_token: 'oauth-refresh-secret', expiry_date: Date.now() + 3600000, scope: 'https://www.googleapis.com/auth/analytics.readonly' } })) => ({
  generateCodeVerifierAsync: async () => ({ codeVerifier: 'private-code-verifier', codeChallenge: 'public-challenge' }),
  generateAuthUrl: input => { const url = new URL('https://accounts.google.com/o/oauth2/v2/auth'); for (const [key, value] of Object.entries(input)) url.searchParams.set(key, String(value)); return url.href; },
  getToken,
});
const scopedOAuth = (db, tenant, client) => new ProjectGoogleOAuth(db, { subject: tenant.userId, organizationId: tenant.organizationId, projectId: tenant.projectId }, '12'.repeat(32), () => client);
const smtpSettings = { host: 'smtp.sendgrid.net', port: 587, user: 'apikey', fromEmail: 'sender@example.com', fromName: 'Example' };
const linkedinFixtureClient = {
  authorizationUrl: state => `https://www.linkedin.com/oauth/v2/authorization?state=${state}&scope=openid%20profile`,
  exchange: async () => ({ accessToken: 'linkedin-private-token', expiresAt: Date.now() + 3600000 }),
};
const scopedLinkedin = (db, tenant) => new ProjectLinkedInOAuth(db, { subject: tenant.userId, organizationId: tenant.organizationId, projectId: tenant.projectId }, '12'.repeat(32), () => linkedinFixtureClient);
const metaFixtureClient = { graphVersion: 'v25.0', authorizationUrl: (state, target) => `https://www.facebook.com/v25.0/dialog/oauth?state=${state}&target=${target}`, exchange: async () => ({ accessToken: 'private-meta-user-token', expiresAt: Date.now() + 3600000 }) };
const metaPages = () => ({ data: [{ id: '100', name: 'First page', access_token: 'private-page-token-100' }, { id: '200', name: 'Second page', access_token: 'private-page-token-200', instagram_business_account: { id: '300', username: 'second_business' } }] });
const scopedMeta = (db, tenant, read = async () => metaPages()) => new ProjectMetaOAuth(db, { subject: tenant.userId, organizationId: tenant.organizationId, projectId: tenant.projectId }, '12'.repeat(32), () => metaFixtureClient, read);
const startMeta = async (oauth, target = 'facebook') => { const start = oauth.start(target); return oauth.complete(new URL(start.authorizationUrl).searchParams.get('state'), start.browser, 'fixture-code'); };

test('Meta schema migration preserves existing LinkedIn/X connections and account metadata', () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'platform-migration-'));
  const file = path.join(directory, 'fixture.sqlite');
  let db = openPlatformDatabase(file);
  try {
    const repository = new PlatformRepository(db); repository.bootstrapLegacy('fixture-admin');
    const a = repository.provision('legacy-admin', { organizationName: 'Migration', projectName: 'Migration', website: 'https://example.com', username: 'migration-owner', password: 'fixture-password-123' });
    const connection = scopedStore(db, a).saveConnection({ provider: 'social', integrationId: 'old', accountName: 'Existing LinkedIn', accessToken: 'secret', social: { platform: 'linkedin', accountId: 'ExistingSubject' } }, '12'.repeat(32));
    db.exec(`CREATE TABLE old_social (connection_id TEXT PRIMARY KEY REFERENCES platform_connections(id), platform TEXT NOT NULL CHECK(platform IN ('linkedin','twitter')), account_id TEXT NOT NULL, expires_at INTEGER);
      INSERT INTO old_social SELECT connection_id,platform,account_id,expires_at FROM platform_social_accounts;
      DROP TABLE platform_social_accounts; ALTER TABLE old_social RENAME TO platform_social_accounts;
      DELETE FROM platform_migrations WHERE version=7;`);
    db.close(); db = openPlatformDatabase(file);
    const restored = scopedStore(db, a).connections()[0];
    assert.equal(restored.id, connection.id); assert.equal(restored.socialAccountId, 'ExistingSubject');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.ok(db.prepare('SELECT version FROM platform_migrations WHERE version=7').get());
  } finally { db.close(); }
});

test('Meta requires explicit page selection, keeps tokens private and upserts the selected page', async () => {
  const { db, a, b } = fixture();
  try {
    const oauth = scopedMeta(db, a), selection = await startMeta(oauth);
    assert.equal(scopedStore(db, a).connections().length, 0);
    const pages = await oauth.list(selection);
    assert.equal(pages.items.length, 2);
    assert.doesNotMatch(JSON.stringify(pages), /private-meta|private-page|access_token/);
    await assert.rejects(scopedMeta(db, b).list(selection));
    const saved = await oauth.select(selection, '200');
    assert.equal(saved.socialAccountId, '200'); assert.equal(saved.socialPlatform, 'facebook');
    assert.equal(scopedStore(db, a).connections().length, 1);
    assert.doesNotMatch(JSON.stringify(saved), /private-page/);
    await assert.rejects(oauth.select(selection, '100'));
    const reconnect = await startMeta(oauth);
    await oauth.list(reconnect);
    assert.equal((await oauth.select(reconnect, '200')).id, saved.id);
    assert.equal(scopedStore(db, a).connections().length, 1);
  } finally { db.close(); }
});

test('Meta refuses unlisted pages, missing Instagram accounts and changed permissions', async () => {
  const { db, a } = fixture();
  try {
    const oauth = scopedMeta(db, a);
    const forged = await startMeta(oauth); await oauth.list(forged);
    await assert.rejects(oauth.select(forged, '999'));
    const noInstagram = await startMeta(oauth, 'instagram'); await oauth.list(noInstagram);
    await assert.rejects(oauth.select(noInstagram, '100'));
    let removed = false;
    const changing = scopedMeta(db, a, async () => removed ? { data: [] } : metaPages());
    const stale = await startMeta(changing); await changing.list(stale); removed = true;
    await assert.rejects(changing.select(stale, '200'));
    assert.equal(scopedStore(db, a).connections().length, 0);
    let changed = false;
    const instagram = scopedMeta(db, a, async () => { const response = metaPages(); if (changed) response.data[1].instagram_business_account.id = '999'; return response; });
    const igStale = await startMeta(instagram, 'instagram'); await instagram.list(igStale); changed = true;
    await assert.rejects(instagram.select(igStale, '200'));
    assert.equal(scopedStore(db, a).connections().length, 0);
  } finally { db.close(); }
});

test('Meta selection can be cancelled and pagination never follows provider token URLs', async () => {
  const { db, a } = fixture();
  try {
    const urls = [];
    const oauth = scopedMeta(db, a, async url => {
      urls.push(url);
      return new URL(url).searchParams.has('after') ? { data: [metaPages().data[1]] }
        : { data: [metaPages().data[0]], paging: { next: 'https://attacker.example/?access_token=secret', cursors: { after: 'safe-cursor' } } };
    });
    const selection = await startMeta(oauth);
    assert.equal((await oauth.list(selection)).hasMore, true);
    assert.equal((await oauth.list(selection, true)).items.length, 2);
    assert.ok(urls.every(url => new URL(url).hostname === 'graph.facebook.com' && !url.includes('access_token=')));
    oauth.cancel(selection); await assert.rejects(oauth.list(selection));
    assert.equal(scopedStore(db, a).connections().length, 0);
  } finally { db.close(); }
});

test('Instagram is saved alone with its parent page; concurrent revoke invalidates Meta selection', async () => {
  const { db, a } = fixture();
  try {
    const store = scopedStore(db, a), oauth = scopedMeta(db, a);
    const ig = await startMeta(oauth, 'instagram'); await oauth.list(ig);
    const saved = await oauth.select(ig, '200');
    assert.equal(saved.socialPlatform, 'instagram'); assert.equal(saved.socialAccountId, '300'); assert.equal(saved.socialPageId, '200');
    assert.equal(store.connections().length, 1);
    const racing = scopedMeta(db, a, async () => { store.revokeConnection(saved.id); return metaPages(); });
    const selection = await startMeta(racing, 'instagram');
    await assert.rejects(racing.list(selection));
    assert.equal(store.connections()[0].status, 'revoked');
  } finally { db.close(); }
});

test('Meta access checks use page tokens and verify the Instagram parent association', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async url => { assert.equal(new URL(url).hostname, 'graph.facebook.com'); return new Response(JSON.stringify({ id: '200', name: 'Page', instagram_business_account: { id: '300', username: 'business' } })); };
    assert.equal((await verifySocialConnection({ platform: 'facebook', accountId: '200', graphVersion: 'v25.0' }, 'page-token')).status, 'verified');
    assert.equal((await verifySocialConnection({ platform: 'instagram', accountId: '300', pageId: '200', graphVersion: 'v25.0' }, 'page-token')).status, 'verified');
    assert.equal((await verifySocialConnection({ platform: 'instagram', accountId: '300', pageId: '999', graphVersion: 'v25.0' }, 'page-token')).status, 'failed');
  } finally { globalThis.fetch = original; }
});

test('LinkedIn OAuth preserves provider, project, browser and single-use state boundaries', async () => {
  const { db, a, b } = fixture();
  try {
    const oauth = scopedLinkedin(db, a), other = scopedLinkedin(db, b);
    const start = oauth.start({ accountName: 'Alpha LinkedIn' }), state = new URL(start.authorizationUrl).searchParams.get('state');
    await assert.rejects(other.complete(state, start.browser, 'code'));
    await assert.rejects(oauth.complete(state, 'a'.repeat(43), 'code'));
    const google = new OAuthRequests(db, { subject: a.userId, organizationId: a.organizationId, projectId: a.projectId }, '12'.repeat(32));
    assert.throws(() => google.claim(state, start.browser, ['ga4']));
    const saved = await oauth.complete(state, start.browser, 'code', async () => ({ sub: 'AlphaSubject', email: 'must-not-store@example.com' }));
    assert.equal(saved.socialPlatform, 'linkedin'); assert.equal(saved.socialAccountId, 'AlphaSubject');
    assert.doesNotMatch(JSON.stringify(saved), /linkedin-private-token|must-not-store/);
    assert.equal(scopedStore(db, b).connections().length, 0);
    await assert.rejects(oauth.complete(state, start.browser, 'code'));
    const reconnect = oauth.start({ accountName: 'Updated LinkedIn' });
    const repeated = await oauth.complete(new URL(reconnect.authorizationUrl).searchParams.get('state'), reconnect.browser, 'code', async () => ({ sub: 'AlphaSubject' }));
    assert.equal(repeated.id, saved.id); assert.equal(scopedStore(db, a).connections().length, 1);
  } finally { db.close(); }
});

test('LinkedIn completion cannot overwrite revoked connections or accept a different account', async () => {
  const { db, a } = fixture();
  try {
    const store = scopedStore(db, a), oauth = scopedLinkedin(db, a);
    const saved = store.saveConnection({ provider: 'social', integrationId: 'old', accountName: 'LinkedIn', accessToken: 'old-token', social: { platform: 'linkedin', accountId: 'AlphaSubject' } }, '12'.repeat(32));
    const start = oauth.start({ accountName: 'Reconnected', accountId: 'AlphaSubject' });
    await assert.rejects(oauth.complete(new URL(start.authorizationUrl).searchParams.get('state'), start.browser, 'code', async () => { store.revokeConnection(saved.id); return { sub: 'AlphaSubject' }; }));
    assert.equal(store.connections()[0].status, 'revoked');
    const next = oauth.start({ accountName: 'Another', accountId: 'AlphaSubject' });
    await assert.rejects(oauth.complete(new URL(next.authorizationUrl).searchParams.get('state'), next.browser, 'code', async () => ({ sub: 'DifferentSubject' })));
    assert.equal(store.connections()[0].status, 'revoked');
  } finally { db.close(); }
});

test('social checks require matching identity, do not follow redirects and redact provider data', async () => {
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async (url, options) => { calls++; assert.equal(options.redirect, 'error'); assert.ok(!url.includes('secret')); return new Response(JSON.stringify({ sub: 'Expected', email: 'private@example.com' })); };
    assert.equal((await verifySocialConnection({ platform: 'linkedin', accountId: 'Expected' }, 'secret')).status, 'verified');
    assert.equal((await verifySocialConnection({ platform: 'linkedin', accountId: 'Other' }, 'secret')).status, 'failed');
    assert.equal((await verifySocialConnection({ platform: 'linkedin', accountId: 'Expected' }, 'secret', 1)).status, 'failed');
    assert.equal(calls, 2);
    globalThis.fetch = async () => new Response(JSON.stringify({ data: { id: '123' } }));
    assert.equal((await verifySocialConnection({ platform: 'twitter', accountId: '123' }, 'secret')).status, 'verified');
    globalThis.fetch = async () => new Response('token secret and private@example.com', { status: 403 });
    assert.doesNotMatch(JSON.stringify(await verifySocialConnection({ platform: 'twitter', accountId: '123' }, 'secret')), /private@example|token secret/);
    globalThis.fetch = async () => new Response('x'.repeat(65537));
    await assert.rejects(readSocialJson('https://api.x.com/2/users/me', 'secret'));
    await assert.rejects(readSocialJson('http://127.0.0.1/', 'secret'));
  } finally { globalThis.fetch = original; }
});

test('social registry canonicalizes account IDs and jobs stay scoped and fail closed on revoke', async () => {
  const { db, a, b } = fixture();
  try {
    const store = scopedStore(db, a), jobs = scopedJobs(db, a);
    const input = { provider: 'social', integrationId: 'any-name', accountName: 'X account', accessToken: 'social-secret', social: { platform: 'twitter', accountId: '123' } };
    const saved = store.saveConnection(input, '12'.repeat(32));
    assert.equal(saved.integrationId, 'twitter:123');
    assert.equal(store.saveConnection({ ...input, integrationId: 'other-name' }, '12'.repeat(32)).id, saved.id);
    const job = jobs.enqueue(saved.id, 'social-test');
    const result = await jobs.run(job.id, '12'.repeat(32), undefined, undefined, undefined, async (settings, token) => { assert.equal(settings.accountId, '123'); assert.equal(token, 'social-secret'); return { status: 'verified', message: 'test' }; });
    assert.equal(result.status, 'completed'); assert.equal(store.connections()[0].isConnected, true);
    assert.equal(scopedStore(db, b).connections().length, 0);
    const next = jobs.enqueue(saved.id, 'social-revoke');
    await jobs.run(next.id, '12'.repeat(32), undefined, undefined, undefined, async () => { store.revokeConnection(saved.id); return { status: 'verified', message: 'test' }; });
    assert.equal(jobs.list(next.id).status, 'failed');
    assert.equal(store.connections()[0].status, 'revoked');
  } finally { db.close(); }
});

test('SMTP configuration rejects unsafe hosts, ports, header injection and private networks', async () => {
  assert.equal(normalizeSmtpConfiguration(smtpSettings).port, 587);
  assert.throws(() => normalizeSmtpConfiguration({ ...smtpSettings, host: 'localhost' }));
  assert.throws(() => normalizeSmtpConfiguration({ ...smtpSettings, host: 'smtp.attacker.example' }));
  assert.throws(() => normalizeSmtpConfiguration({ ...smtpSettings, port: 25 }));
  assert.throws(() => normalizeSmtpConfiguration({ ...smtpSettings, fromEmail: 'a@example.com\r\nBcc: b@example.com' }));
  for (const host of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '[::1]', '[::ffff:127.0.0.1]', '[fc00::1]']) await assert.rejects(resolvePublicAddress(new URL(`https://${host}/`)));
});

test('SMTP verification pins IP, enforces TLS/auth and closes without sending a message', async () => {
  let closed = 0, destroyed = 0, verifies = 0;
  const socket = { destroy: () => destroyed++ };
  const result = await verifySmtpConnection(smtpSettings, 'smtp-secret', async url => { assert.equal(url.hostname, smtpSettings.host); return { address: '8.8.8.8', family: 4 }; }, options => {
    assert.equal(options.host, '8.8.8.8'); assert.equal(options.connection, socket);
    assert.equal(options.tls.servername, smtpSettings.host); assert.equal(options.tls.rejectUnauthorized, true);
    assert.equal(options.requireTLS, true); assert.equal(options.forceAuth, true);
    assert.equal(options.secure, false); assert.equal(options.debug, false); assert.equal(options.auth.pass, 'smtp-secret');
    return { verify: async () => { verifies++; return true; }, close: () => closed++ };
  }, async (ip, port) => { assert.equal(ip, '8.8.8.8'); assert.equal(port, 587); return socket; });
  assert.equal(result.status, 'verified'); assert.equal(verifies, 1); assert.equal(closed, 1); assert.equal(destroyed, 1);
  assert.doesNotMatch(JSON.stringify(result), /smtp-secret/);
  const failed = await verifySmtpConnection(smtpSettings, 'smtp-secret', async () => { throw new Error('private network'); }, () => { throw new Error('must not connect'); });
  assert.equal(failed.status, 'failed');
  const tlsFailed = await verifySmtpConnection({ ...smtpSettings, port: 465 }, 'smtp-secret', async () => ({ address: '8.8.8.8', family: 4 }), options => {
    assert.equal(options.secure, true);
    return { verify: async () => { throw new Error('TLS failure smtp-secret'); }, close: () => closed++ };
  }, async () => socket);
  assert.equal(tlsFailed.status, 'failed'); assert.doesNotMatch(JSON.stringify(tlsFailed), /smtp-secret/);
  assert.equal(closed, 2); assert.equal(destroyed, 2);
});

test('SMTP configuration is encrypted and uses the existing scoped verification queue', async () => {
  const { db, a, b } = fixture();
  try {
    const store = scopedStore(db, a), jobs = scopedJobs(db, a);
    const connection = store.saveConnection({ provider: 'email', integrationId: 'smtp', accountName: 'Example email', accessToken: 'smtp-secret', smtp: smtpSettings }, '12'.repeat(32));
    assert.doesNotMatch(JSON.stringify(connection), /smtp-secret|sender@example.com|apikey/);
    const job = jobs.enqueue(connection.id, 'smtp-verify');
    const result = await jobs.run(job.id, '12'.repeat(32), async () => { throw new Error('must not use Google'); }, async credentials => credentials, async (settings, password) => {
      assert.equal(settings.host, smtpSettings.host); assert.equal(password, 'smtp-secret'); return { status: 'verified', message: 'SMTP verified, delivery not tested' };
    });
    assert.equal(result.status, 'completed'); assert.equal(store.connections()[0].isConnected, true);
    assert.equal(scopedStore(db, b).connections().length, 0);
    const pending = jobs.enqueue(connection.id, 'smtp-revoke');
    await jobs.run(pending.id, '12'.repeat(32), undefined, undefined, async () => { store.revokeConnection(connection.id); return { status: 'verified', message: 'test' }; });
    assert.equal(jobs.list(pending.id).status, 'failed'); assert.equal(store.connections()[0].status, 'revoked');
  } finally { db.close(); }
});

test('OAuth renewal respects expiry and never uses global legacy credentials', async () => {
  let calls = 0;
  const client = { setCredentials: value => assert.equal(value.refresh_token, 'stored-project-refresh'), refreshAccessToken: async () => { calls++; return { credentials: { access_token: 'renewed', expiry_date: Date.now() + 3600000 } }; } };
  const fresh = { accessToken: 'fresh', refreshToken: 'stored-project-refresh', googleOAuth: true, expiresAt: Date.now() + 3600000 };
  assert.equal(await refreshGoogleCredentials(fresh, () => client), fresh);
  const expired = { ...fresh, expiresAt: 1 };
  const renewed = await refreshGoogleCredentials(expired, () => client);
  assert.equal(renewed.accessToken, 'renewed'); assert.equal(renewed.refreshToken, fresh.refreshToken); assert.equal(calls, 1);
  await assert.rejects(refreshGoogleCredentials({ ...expired, refreshToken: '' }, () => client));
  const manual = { accessToken: 'manual', refreshToken: 'legacy-like-value' };
  assert.equal(await refreshGoogleCredentials(manual, () => client), manual);
  const old = process.env.PLATFORM_GOOGLE_REDIRECT_URI;
  const oldId = process.env.PLATFORM_GOOGLE_CLIENT_ID, oldSecret = process.env.PLATFORM_GOOGLE_CLIENT_SECRET;
  try {
    process.env.PLATFORM_GOOGLE_CLIENT_ID = 'fixture'; process.env.PLATFORM_GOOGLE_CLIENT_SECRET = 'fixture';
    process.env.PLATFORM_GOOGLE_REDIRECT_URI = 'https://example.com/api/platform/google/callback';
    assert.equal(googleConfiguration().redirectUri, process.env.PLATFORM_GOOGLE_REDIRECT_URI);
    process.env.PLATFORM_GOOGLE_REDIRECT_URI = 'http://example.com/api/platform/google/callback';
    assert.throws(() => googleConfiguration());
  } finally {
    for (const [key, value] of [['PLATFORM_GOOGLE_CLIENT_ID', oldId], ['PLATFORM_GOOGLE_CLIENT_SECRET', oldSecret], ['PLATFORM_GOOGLE_REDIRECT_URI', old]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('OAuth binds project and browser, consumes state once and never exposes tokens', async () => {
  const { db, a, b } = fixture();
  try {
    const client = googleFixtureClient(), oauth = scopedOAuth(db, a, client), other = scopedOAuth(db, b, client);
    const started = await oauth.start({ provider: 'ga4', resource: '123', accountName: 'Alpha analytics' });
    const url = new URL(started.authorizationUrl), state = url.searchParams.get('state');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    const pending = db.prepare('SELECT * FROM platform_oauth_requests').get();
    assert.ok(!pending.encrypted_verifier.includes('private-code-verifier'));
    assert.ok(!JSON.stringify(pending).includes(started.browser));
    await assert.rejects(other.complete(state, started.browser, 'code'));
    await assert.rejects(oauth.complete(state, 'a'.repeat(43), 'code'));
    const result = await oauth.complete(state, started.browser, 'code', async () => ({ status: 'verified', message: 'test' }));
    assert.equal(scopedStore(db, a).connections().length, 1);
    assert.equal(scopedStore(db, b).connections().length, 0);
    assert.doesNotMatch(JSON.stringify(result), /oauth-access-secret|oauth-refresh-secret/);
    await assert.rejects(oauth.complete(state, started.browser, 'code'));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_oauth_requests').get().n, 0);
  } finally { db.close(); }
});

test('OAuth rejects expired, replaced, cancelled and insufficient-scope requests', async () => {
  const { db, a } = fixture();
  try {
    const input = { provider: 'ga4', resource: '123', accountName: 'Alpha analytics' };
    const oauth = scopedOAuth(db, a, googleFixtureClient());
    const first = await oauth.start(input), state = new URL(first.authorizationUrl).searchParams.get('state');
    db.prepare("UPDATE platform_oauth_requests SET expires_at='2000-01-01'").run();
    await assert.rejects(oauth.complete(state, first.browser, 'code'));
    const next = await oauth.start(input);
    await oauth.start(input);
    await assert.rejects(oauth.complete(new URL(next.authorizationUrl).searchParams.get('state'), next.browser, 'code'));
    const store = scopedStore(db, a);
    const saved = store.saveConnection({ provider: 'ga4', integrationId: '123', accountName: 'Analytics', accessToken: 'secret' }, '12'.repeat(32));
    const pending = await oauth.start(input);
    await assert.rejects(oauth.complete(new URL(pending.authorizationUrl).searchParams.get('state'), pending.browser, 'code', async () => { store.revokeConnection(saved.id); return { status: 'verified', message: 'test' }; }));
    assert.equal(store.connections()[0].status, 'revoked');
    const badScope = scopedOAuth(db, a, googleFixtureClient(async () => ({ tokens: { access_token: 'secret', refresh_token: 'refresh', expiry_date: Date.now() + 3600000, scope: 'unrelated.scope' } })));
    const wrong = await badScope.start(input);
    await assert.rejects(badScope.complete(new URL(wrong.authorizationUrl).searchParams.get('state'), wrong.browser, 'code'));
    assert.equal(store.connections()[0].status, 'revoked');
    await assert.rejects(oauth.start({ ...input, provider: '__proto__' }));
  } finally { db.close(); }
});

test('Google token renewal persists encrypted credentials and cannot resurrect a revoked connection', async () => {
  const { db, a } = fixture();
  try {
    const store = scopedStore(db, a), jobs = scopedJobs(db, a);
    const connection = store.saveConnection({ provider: 'ga4', integrationId: '123', accountName: 'Analytics', accessToken: 'expired', refreshToken: 'refresh-secret', googleOAuth: true, expiresAt: 1 }, '12'.repeat(32));
    const job = jobs.enqueue(connection.id, 'refresh');
    const fresh = { accessToken: 'renewed-secret', refreshToken: 'refresh-secret', googleOAuth: true, expiresAt: Date.now() + 3600000 };
    assert.equal((await jobs.run(job.id, '12'.repeat(32), async (provider, resource, token) => { assert.equal(token, fresh.accessToken); return { status: 'verified', message: 'test' }; }, async credentials => { assert.equal(credentials.refreshToken, 'refresh-secret'); return fresh; })).status, 'completed');
    const row = db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(connection.id);
    assert.ok(!row.encrypted_credentials.includes('renewed-secret'));
    assert.equal(decryptCredentials(row.encrypted_credentials, '12'.repeat(32), a.organizationId, a.projectId, connection.id).accessToken, fresh.accessToken);
    const second = jobs.enqueue(connection.id, 'refresh-race');
    let verifyCalls = 0;
    await jobs.run(second.id, '12'.repeat(32), async () => { verifyCalls++; }, async () => { store.revokeConnection(connection.id); return fresh; });
    assert.equal(verifyCalls, 0);
    assert.equal(jobs.list(second.id).status, 'failed');
    assert.equal(store.connections()[0].status, 'revoked');
  } finally { db.close(); }
});

test('Google verification uses fixed hosts and requires an authorized matching property', async () => {
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++; assert.equal(new URL(url).hostname, 'www.googleapis.com');
      assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify({ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteUnverifiedUser' }));
    };
    assert.equal((await verifyGoogleConnection('search_console', 'sc-domain:example.com', 'secret')).status, 'failed');
    assert.equal((await verifyGoogleConnection('ga4', '../evil', 'secret')).status, 'failed');
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response(JSON.stringify({ name: 'properties/123' }));
    assert.equal((await verifyGoogleConnection('ga4', '123', 'secret')).status, 'verified');
    assert.equal((await verifyGoogleConnection('ga4', '456', 'secret')).status, 'failed');
    globalThis.fetch = async () => new Response('provider secret', { status: 403 });
    assert.doesNotMatch(JSON.stringify(await verifyGoogleConnection('ga4', '123', 'secret')), /provider secret/);
  } finally { globalThis.fetch = original; }
});

test('verification jobs are scoped, idempotent and decrypt only inside the worker', async () => {
  const { db, a, b } = fixture();
  try {
    const store = scopedStore(db, a), jobs = scopedJobs(db, a), other = scopedJobs(db, b);
    const connection = store.saveConnection({ provider: 'ga4', integrationId: '123456789', accountName: 'Analytics', accessToken: 'private-token' }, '12'.repeat(32));
    const job = jobs.enqueue(connection.id, 'same-key');
    assert.equal(jobs.enqueue(connection.id, 'same-key').id, job.id);
    assert.equal(jobs.enqueue(connection.id, 'other-key').id, job.id);
    assert.throws(() => other.enqueue(connection.id, 'same-key'));
    assert.throws(() => other.list(job.id));
    assert.throws(() => other.cancel(job.id));
    let calls = 0;
    const verify = async (provider, resource, token) => { calls++; assert.equal(token, 'private-token'); assert.equal(resource, '123456789'); return { status: 'verified', message: 'fixture verified' }; };
    const result = await jobs.run(job.id, '12'.repeat(32), verify);
    assert.equal(result.status, 'completed');
    assert.equal(store.connections()[0].isConnected, true);
    await jobs.run(job.id, '12'.repeat(32), verify);
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(jobs.list()), /private-token|encrypted_credentials/);
    store.saveConnection({ id: connection.id, provider: 'ga4', integrationId: '123456789', accountName: 'Analytics', accessToken: 'replacement' }, '12'.repeat(32));
    assert.equal(store.connections()[0].isConnected, false);
    assert.throws(() => jobs.enqueue(connection.id, 'same-key'));
  } finally { db.close(); }
});

test('running verification cannot overwrite cancelled, revoked or replaced connections', async () => {
  const { db, repository, a } = fixture();
  try {
    const store = scopedStore(db, a), jobs = scopedJobs(db, a);
    const input = { provider: 'ga4', integrationId: '123', accountName: 'Analytics', accessToken: 'secret' };
    const connection = store.saveConnection(input, '12'.repeat(32));
    const first = jobs.enqueue(connection.id, 'cancel');
    await jobs.run(first.id, '12'.repeat(32), async () => { jobs.cancel(first.id); return { status: 'verified', message: 'test' }; });
    assert.equal(jobs.list(first.id).status, 'cancelled');
    assert.equal(store.connections()[0].isConnected, false);
    const second = jobs.enqueue(connection.id, 'replace');
    await jobs.run(second.id, '12'.repeat(32), async () => { store.saveConnection(input, '12'.repeat(32)); return { status: 'verified', message: 'test' }; });
    assert.equal(jobs.list(second.id).status, 'failed');
    assert.equal(store.connections()[0].isConnected, false);
    const third = jobs.enqueue(connection.id, 'revoke');
    await jobs.run(third.id, '12'.repeat(32), async () => { store.revokeConnection(connection.id); return { status: 'verified', message: 'test' }; });
    assert.equal(jobs.list(third.id).status, 'failed');
    assert.equal(store.connections()[0].status, 'revoked');
    store.saveConnection(input, '12'.repeat(32));
    const admin = repository.addMember(a.userId, a.organizationId, a.projectId, { username: 'job-admin', password: 'job-test-password', role: 'admin' });
    const adminJobs = scopedJobs(db, { ...a, userId: admin.userId });
    const fourth = adminJobs.enqueue(connection.id, 'member-revoke');
    repository.updateMember(a.userId, a.organizationId, a.projectId, admin.userId, 'admin', false);
    let calls = 0;
    await jobs.run(fourth.id, '12'.repeat(32), async () => { calls++; return { status: 'verified', message: 'test' }; });
    assert.equal(calls, 0);
    assert.equal(jobs.list(fourth.id).status, 'failed');
  } finally { db.close(); }
});

test('expired leases recover within attempt limit; failed tests never mark connected', async () => {
  const { db, a } = fixture();
  try {
    const store = scopedStore(db, a), jobs = scopedJobs(db, a);
    const connection = store.saveConnection({ provider: 'email', integrationId: 'mail', accountName: 'Mail', accessToken: 'secret' }, '12'.repeat(32));
    const job = jobs.enqueue(connection.id, 'recover');
    db.prepare("UPDATE platform_jobs SET status='running',lease_until='2000-01-01',attempts=1 WHERE id=?").run(job.id);
    const result = await jobs.run(job.id, '12'.repeat(32), async () => ({ status: 'unsupported', message: 'Adapter pending' }));
    assert.equal(result.status, 'failed'); assert.equal(result.attempts, 2);
    assert.equal(store.connections()[0].isConnected, false);
    const limited = jobs.enqueue(connection.id, 'limit');
    db.prepare('UPDATE platform_jobs SET attempts=3 WHERE id=?').run(limited.id);
    let calls = 0;
    assert.equal((await jobs.run(limited.id, '12'.repeat(32), async () => { calls++; })).status, 'failed');
    assert.equal(calls, 0);
  } finally { db.close(); }
});

test('campaign and content CRUD never falls back to another project by ID', () => {
  const { db, repository, a, b } = fixture();
  try {
    const alpha = scopedStore(db, a), beta = scopedStore(db, b);
    alpha.saveCampaign(draft('cmp_alpha'), true);
    beta.saveCampaign(draft('cmp_beta'), true);
    assert.equal(beta.campaign('cmp_alpha'), null);
    assert.throws(() => beta.saveCampaign({ ...draft('cmp_alpha'), name: 'Overwrite' }, false));
    assert.throws(() => beta.deleteCampaign('cmp_alpha'));
    assert.equal(alpha.campaign('cmp_alpha').name, 'Same campaign name');
    const history = { id: 'hist_alpha', content: 'Alpha private draft', platform: 'email', language: 'tr', timestamp: Date.now(), prompt: '' };
    alpha.saveContent(history, true);
    beta.saveContent({ ...history, id: 'hist_beta', content: 'Beta private draft' }, true);
    assert.throws(() => beta.saveContent(history, false));
    assert.throws(() => beta.deleteContent(history.id));
    beta.deleteContent();
    assert.equal(beta.history().length, 0);
    assert.equal(alpha.history().length, 1);
    const viewer = repository.addMember(a.userId, a.organizationId, a.projectId, { username: 'readonly-drafts', password: 'test-readonly-password', role: 'viewer' });
    const readOnly = scopedStore(db, { ...a, userId: viewer.userId });
    assert.equal(readOnly.listCampaigns().length, 1);
    assert.throws(() => readOnly.saveCampaign(draft('cmp_forbidden'), true));
    assert.throws(() => readOnly.deleteContent());
    repository.updateMember(a.userId, a.organizationId, a.projectId, viewer.userId, 'viewer', false);
    assert.throws(() => readOnly.history());
  } finally { db.close(); }
});

test('connection secrets stay encrypted and are scoped on read/update/revoke', () => {
  const { db, a, b } = fixture();
  try {
    const alpha = scopedStore(db, a), beta = scopedStore(db, b);
    const secret = 'fixture-secret-never-returned';
    const input = { provider: 'email', integrationId: 'same-name', accountName: 'Alpha mail', accessToken: secret };
    const publicConnection = alpha.saveConnection(input, '12'.repeat(32));
    assert.equal(publicConnection.isConnected, false);
    assert.equal(publicConnection.status, 'configured_not_verified');
    assert.doesNotMatch(JSON.stringify(publicConnection), /fixture-secret|accessToken|ciphertext/);
    const row = db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(publicConnection.id);
    assert.ok(!row.encrypted_credentials.includes(secret));
    assert.equal(beta.connections().length, 0);
    assert.throws(() => beta.saveConnection({ ...input, id: publicConnection.id }, '12'.repeat(32)));
    assert.throws(() => beta.revokeConnection(publicConnection.id));
    const second = alpha.saveConnection(input, '12'.repeat(32));
    assert.equal(second.id, publicConnection.id);
    assert.equal(alpha.connections().length, 1);
    beta.saveConnection(input, '12'.repeat(32));
    assert.equal(beta.connections().length, 1);
    alpha.revokeConnection(publicConnection.id);
    assert.equal(alpha.connections()[0].status, 'revoked');
    assert.equal(db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(publicConnection.id).encrypted_credentials, '');
    assert.equal(beta.connections()[0].status, 'configured_not_verified');
  } finally { db.close(); }
});

test('project brand and goals are transactional, scoped and cannot change the Crewin pack', () => {
  const { db, repository, a, b } = fixture();
  try {
    const input = { name: 'Alpha revised', website: 'https://alpha.example', timezone: 'UTC', language: 'en', brandVoice: 'Clear and concise', goals: [{ id: 'demo', label: { tr: 'Demo', en: 'Demo' }, audience: { tr: 'Şirket', en: 'Business' }, stages: [{ tr: 'Ziyaret', en: 'Visit' }, { tr: 'Talep', en: 'Request' }] }] };
    assert.throws(() => repository.updateProject(a.userId, b.organizationId, b.projectId, input));
    repository.updateProject(a.userId, a.organizationId, a.projectId, input);
    assert.equal(repository.workspace(a.userId, a.organizationId, a.projectId).project.goals[0].id, 'demo');
    assert.equal(repository.workspace(b.userId, b.organizationId, b.projectId).project.goals.length, 0);
    assert.throws(() => repository.updateProject(a.userId, a.organizationId, a.projectId, { ...input, name: 'Invalid write', goals: [input.goals[0], input.goals[0]] }));
    assert.equal(repository.workspace(a.userId, a.organizationId, a.projectId).project.name, 'Alpha revised');
    assert.throws(() => repository.updateProject('legacy-admin', 'crewin', 'crewinjob', input));
    assert.equal(repository.workspace('legacy-admin', 'crewin', 'crewinjob').project.name, 'CrewinJob');
  } finally { db.close(); }
});

test('passwords are hashed, correct credentials authenticate, response omits hash', () => {
  const { db, repository, a } = fixture();
  try {
    assert.equal(repository.authenticate('Alpha-owner', 'wrong-password'), null);
    assert.equal(repository.authenticate('Alpha-owner', 'test-password-with-12-chars').id, a.userId);
    const row = db.prepare('SELECT password_hash FROM platform_users WHERE id=?').get(a.userId);
    assert.match(row.password_hash, /^scrypt:/);
    assert.ok(!row.password_hash.includes('test-password'));
    assert.doesNotMatch(JSON.stringify(repository.members(a.userId, a.organizationId, a.projectId)), /password|scrypt/);
  } finally { db.close(); }
});

test('revocation applies immediately and last owner is protected', () => {
  const { db, repository, a } = fixture();
  try {
    assert.throws(() => repository.updateMember(a.userId, a.organizationId, a.projectId, a.userId, 'viewer', false));
    const editor = repository.addMember(a.userId, a.organizationId, a.projectId, { username: 'editor', password: 'test-editor-password', role: 'editor' });
    assert.equal(repository.can(editor.userId, a.organizationId, a.projectId, 'content.write'), true);
    assert.equal(repository.can(editor.userId, a.organizationId, a.projectId, 'members.manage'), false);
    repository.updateMember(a.userId, a.organizationId, a.projectId, editor.userId, 'editor', false);
    assert.equal(repository.workspace(editor.userId, a.organizationId, a.projectId), null);
    assert.equal(repository.workspaces(editor.userId).length, 0);
  } finally { db.close(); }
});

test('duplicate provisioning rolls back and bootstrap remains idempotent', () => {
  const { db, repository } = fixture();
  try {
    repository.bootstrapLegacy('fixture-admin');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_organizations').get().n, 3);
    assert.throws(() => repository.provision('legacy-admin', { organizationName: 'Duplicate', projectName: 'Duplicate', website: 'https://duplicate.example', username: 'Alpha-owner', password: 'another-test-password' }));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_organizations').get().n, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM platform_projects').get().n, 3);
  } finally { db.close(); }
});
