const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const API_PATH = path.join(__dirname, '..', 'modules', 'api.js');

// api.js env'i yükleme anında okur — her senaryo için taze modül örneği
function loadApi(env) {
  delete require.cache[require.resolve(API_PATH)];
  const keys = ['CREWINJOB_API_KEY', 'CREWINJOB_API_USERNAME', 'CREWINJOB_API_PASSWORD',
    'CREWINJOB_CREDIT_API_KEY', 'CREWINJOB_CREDIT_API_USERNAME', 'CREWINJOB_CREDIT_API_PASSWORD'];
  keys.forEach((k) => { delete process.env[k]; });
  process.env.CREWINJOB_API_URL = 'https://api.example.test';
  Object.assign(process.env, env);
  return require(API_PATH);
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

async function withFetch(handler, fn) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options, calls.length);
  };
  try { await fn(calls); } finally { global.fetch = originalFetch; }
}

test('401 → cached token reset, re-login and a single retry', async () => {
  const api = loadApi({ CREWINJOB_API_USERNAME: 'svc', CREWINJOB_API_PASSWORD: 'pw' });
  let logins = 0;
  await withFetch((url, options) => {
    if (url.endsWith('/api/TokenAuth/Authenticate')) {
      logins++;
      return jsonResponse(200, { result: { accessToken: 'token-' + logins, expireInSeconds: 3600 } });
    }
    if (options.headers.Authorization === 'Bearer token-1') return jsonResponse(401, { error: 'expired' });
    return jsonResponse(200, { result: { ok: true } });
  }, async (calls) => {
    const result = await api.marketingCampaignGet('GetAll', { channel: 'email' });
    assert.deepEqual(result, { ok: true });
    assert.equal(logins, 2);
    const serviceCalls = calls.filter((c) => c.url.includes('/MarketingCampaign/'));
    assert.equal(serviceCalls.length, 2);
    assert.equal(serviceCalls[1].options.headers.Authorization, 'Bearer token-2');
  });
});

test('401 with static CREWINJOB_API_KEY is not retried', async () => {
  const api = loadApi({ CREWINJOB_API_KEY: 'static-key' });
  await withFetch(() => jsonResponse(401, { error: 'nope' }), async (calls) => {
    await assert.rejects(api.marketingCampaignGet('GetAll', {}), (err) => err.status === 401);
    assert.equal(calls.length, 1);
  });
});

test('getToken is exported', () => {
  const api = loadApi({ CREWINJOB_API_KEY: 'static-key' });
  assert.equal(typeof api.getToken, 'function');
});

test('marketing endpoint path segments are validated and encoded', async () => {
  const api = loadApi({ CREWINJOB_API_KEY: 'static-key' });
  await withFetch(() => jsonResponse(200, { result: 1 }), async (calls) => {
    await assert.rejects(api.marketingAutomationJobGet('../../TokenAuth/Authenticate', {}), (err) => err.status === 400);
    await assert.rejects(api.marketingAutomationJobGet('a//b', {}), (err) => err.status === 400);
    await assert.rejects(api.marketingAutomationJobGet('', {}), (err) => err.status === 400);
    assert.equal(calls.length, 0);
    await api.marketingAutomationJobGet('Get Status?x=1', {});
    assert.equal(new URL(calls[0].url).pathname, '/api/services/app/MarketingAutomation/Get%20Status%3Fx%3D1');
  });
});

test('uploadAndParseCV sends a Blob via built-in FormData without manual Content-Type', async () => {
  const api = loadApi({ CREWINJOB_API_KEY: 'static-key' });
  await withFetch(() => jsonResponse(200, { result: { belgeId: 7 } }), async (calls) => {
    const result = await api.uploadAndParseCV(Buffer.from('%PDF-1.4'), 'cv.pdf', { belgeKaynakTipi: 1 });
    assert.deepEqual(result, { belgeId: 7 });
    const { options } = calls[0];
    assert.ok(options.body instanceof FormData);
    const file = options.body.get('dosya');
    assert.ok(file instanceof Blob);
    assert.equal(file.name, 'cv.pdf');
    assert.equal(file.type, 'application/pdf');
    assert.ok(options.body.get('file') instanceof Blob);
    assert.equal(options.headers['Content-Type'], undefined);
  });
});

test('fetchAllData: all calls failing → isRealData false, short apiErrors', async () => {
  const api = loadApi({ CREWINJOB_API_KEY: 'static-key' });
  await withFetch(() => jsonResponse(500, { error: { message: 'secret stack trace' } }), async () => {
    const data = await api.fetchAllData();
    assert.equal(data.isRealData, false);
    assert.equal(data.partial, true);
    assert.ok(Array.isArray(data.apiErrors) && data.apiErrors.length > 0);
    data.apiErrors.forEach((e) => {
      assert.match(e, /→ HTTP 500$/);
      assert.ok(!e.includes('secret'));
    });
  });
});

test('fetchAllData: some calls succeeding → isRealData true, partial flag', async () => {
  const api = loadApi({ CREWINJOB_API_KEY: 'static-key' });
  await withFetch((url) => {
    if (url.includes('GetTotalCountOfGemiAdamiGenel')) return jsonResponse(200, { result: 1234 });
    return jsonResponse(404, {});
  }, async () => {
    const data = await api.fetchAllData();
    assert.equal(data.isRealData, true);
    assert.equal(data.partial, true);
    assert.equal(data.seafarers.total, 1234);
  });
});

test('postOnboardingAction requires a target userId and sends it', async () => {
  const api = loadApi({ CREWINJOB_API_KEY: 'static-key' });
  await withFetch(() => jsonResponse(200, { result: null }), async (calls) => {
    await assert.rejects(api.postOnboardingAction('SkipOnboarding'), (err) => err.status === 400);
    await assert.rejects(api.postOnboardingAction('DeleteEverything', 5), (err) => err.status === 400);
    assert.equal(calls.length, 0);
    await api.postOnboardingAction('CompleteOnboarding', 42);
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, '/api/services/app/GemiAdamiGenel/CompleteOnboarding');
    assert.equal(url.searchParams.get('userId'), '42');
    assert.deepEqual(JSON.parse(calls[0].options.body), { userId: 42 });
  });
});

test('firma kredi permission check fails closed when configuration endpoint errors', async () => {
  const api = loadApi({ CREWINJOB_API_KEY: 'static-key' });
  await withFetch((url) => {
    if (url.includes('/AbpUserConfiguration/GetAll')) return jsonResponse(500, {});
    return jsonResponse(200, { result: [] });
  }, async (calls) => {
    await assert.rejects(api.firmaKrediGet('GetAll', {}), (err) => err.status === 503);
    assert.equal(calls.filter((c) => c.url.includes('FirmaKrediYonetimi')).length, 0);
  });
});
