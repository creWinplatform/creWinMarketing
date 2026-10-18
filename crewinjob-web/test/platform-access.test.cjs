const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHmac } = require('node:crypto');
const { test } = require('node:test');
const ts = require('typescript');
const environment = { AUTH_SECRET: 'test-only-secret-for-workspace-sessions' };

function load(file) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(code, { exports, Buffer, TextEncoder, Uint8Array, ArrayBuffer, URL,
    crypto: webcrypto, process: { env: environment }, require: name => {
      if (name === 'next/headers' || name === 'next/server') return {};
      if (name === './platform/access') return access;
      if (name === '@/lib/auth') return auth;
      if (name === '@/lib/platform/login-location') return load('lib/platform/login-location.ts');
      throw new Error(`Unexpected module: ${name}`);
    } });
  return exports;
}
const access = load('lib/platform/access.ts');
const auth = load('lib/auth.ts');
const sign = payload => Buffer.from(`${payload}:${createHmac('sha256', environment.AUTH_SECRET).update(payload).digest('hex')}`).toString('base64url');
const expiresAt = () => Date.now() + 60000;

test('compiled middleware excludes only exact public auth handlers, not adjacent protected paths', () => {
  const { getMiddlewareMatchers } = require('next/dist/build/analysis/get-page-static-info');
  const matchers = getMiddlewareMatchers(load('middleware.ts').config.matcher, {});
  const matches = pathname => matchers.some(matcher => new RegExp(matcher.regexp).test(pathname));
  for (const name of ['login', 'enroll', 'identity']) {
    assert.equal(matches('/api/auth/' + name), false);
    assert.equal(matches('/api/auth/' + name + '/'), false);
    assert.equal(matches('/api/auth/' + name + '/extra'), true);
    assert.equal(matches('/api/auth/' + name + '-other'), true);
  }
  for (const pathname of ['/api/workspace', '/api/platform/account', '/api/campaigns', '/api/stats', '/']) assert.equal(matches(pathname), true);
});

test('membership scope and active state are required for every permission', () => {
  const memberships = [{ subject: 'alice', organizationId: 'a', projectIds: ['p'], role: 'owner', active: true }];
  assert.equal(access.hasWorkspacePermission(memberships, 'alice', 'a', 'p', 'read'), true);
  for (const args of [['bob', 'a', 'p'], ['alice', 'b', 'p'], ['alice', 'a', 'other']]) {
    assert.equal(access.hasWorkspacePermission(memberships, ...args, 'read'), false);
  }
  memberships[0].active = false;
  assert.equal(access.hasWorkspacePermission(memberships, 'alice', 'a', 'p', 'read'), false);
});

test('viewers cannot write, dispatch or manage memberships', () => {
  const memberships = [{ subject: 'alice', organizationId: 'a', projectIds: ['p'], role: 'viewer', active: true }];
  assert.equal(access.hasWorkspacePermission(memberships, 'alice', 'a', 'p', 'read'), true);
  for (const permission of ['content.write', 'campaign.approve', 'campaign.dispatch', 'connections.manage', 'members.manage']) {
    assert.equal(access.hasWorkspacePermission(memberships, 'alice', 'a', 'p', permission), false);
  }
});

test('legacy membership is granted only to configured administrator', () => {
  assert.equal(access.legacyMembership('other', 'admin'), null);
  assert.equal(access.legacyMembership('admin', undefined), null);
  assert.equal(access.legacyMembership('admin', 'admin').role, 'owner');
});

test('new scoped sessions roundtrip and legacy valid cookies remain usable', async () => {
  const token = await auth.createSessionToken('admin');
  assert.equal(await auth.verifySessionToken(token), 'admin');
  assert.match(Buffer.from(token, 'base64url').toString(), /^v2:/);
  assert.equal(await auth.verifySessionToken(sign(`admin:${expiresAt()}`)), 'admin');
  assert.equal(await auth.verifySessionToken(await auth.createSessionToken('schedule-runner', 5000)), 'schedule-runner');
});

test('signed unsupported workspace scope is rejected', async () => {
  for (const scope of [{ organizationId: 'other', projectId: 'crewinjob' }, { organizationId: 'crewin', projectId: 'other' }]) {
    const payload = `v2:${JSON.stringify({ subject: 'admin', expiresAt: expiresAt(), ...scope })}`;
    assert.equal(await auth.verifySessionToken(sign(payload)), null);
  }
});

test('tampered, expired and malformed sessions are rejected', async () => {
  const validToken = await auth.createSessionToken('admin');
  const tampered = Buffer.from(Buffer.from(validToken, 'base64url').toString().replace('admin', 'intruder')).toString('base64url');
  assert.equal(await auth.verifySessionToken(tampered), null);
  assert.equal(await auth.verifySessionToken(sign('admin:NaN')), null);
  assert.equal(await auth.verifySessionToken(sign('admin:123garbage')), null);
  assert.equal(await auth.verifySessionToken(sign(`admin:${Date.now() - 1}`)), null);
  assert.equal(await auth.verifySessionToken(sign(`:${expiresAt()}`)), null);
  assert.equal(await auth.verifySessionToken('not-a-session'), null);
});

test('platform scopes roundtrip but cannot authorize legacy public publishing helpers', async () => {
  const identity = { subject: 'user-a', organizationId: 'org-a', projectId: 'project-a' };
  const token = await auth.createPlatformSessionToken(identity);
  const verified = await auth.verifySessionIdentity(token);
  assert.equal(verified.organizationId, 'org-a');
  assert.equal(verified.projectId, 'project-a');
  assert.equal(verified.mode, 'platform');
  assert.equal(await auth.getSessionFromRequest({ cookies: { get: () => ({ value: token }) } }), null);
});
