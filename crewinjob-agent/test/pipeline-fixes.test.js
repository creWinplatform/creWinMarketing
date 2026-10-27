const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Testler gerçek .env / .userbot-config.json dosyalarını OKUMAMALI: agent-config'in
// loadAgentConfig'ini require cache üzerinden etkisizleştir.
const agentConfigPath = require.resolve('../modules/agent-config.js');
const realAgentConfig = require(agentConfigPath);
require.cache[agentConfigPath].exports = { ...realAgentConfig, loadAgentConfig: () => {} };

const bot = require('../modules/job-bot.js');
const { writeJsonAtomic, readJson } = require('../modules/json-file.js');

test('createIlan id extraction from CreateOrEdit result', () => {
  assert.equal(bot.extractCreatedId(123), 123);
  assert.equal(bot.extractCreatedId('456'), 456);
  assert.equal(bot.extractCreatedId({ id: 7 }), 7);
  assert.equal(bot.extractCreatedId({ ilan: { id: 8 } }), 8);
  assert.equal(bot.extractCreatedId(null), null);
  assert.equal(bot.extractCreatedId({}), null);
  assert.equal(bot.extractCreatedId(0), null);
});

test('createIlan fallback matches title + company + recent timestamp only', () => {
  const dto = { positionId: 5, companyId: 10339 };
  const jobData = { _positionName: 'Chief Mate', companyText: 'Crewinjob Manning' };
  const since = Date.now() - 1000;
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString();

  assert.equal(bot.isSameCreatedIlan({ ilan: { id: 1, positionId: 5, companyId: 10339, creationTime: now } }, dto, jobData, since), true);
  assert.equal(bot.isSameCreatedIlan({ ilan: { id: 2, positionId: 6, companyId: 10339, creationTime: now } }, dto, jobData, since), false);
  assert.equal(bot.isSameCreatedIlan({ ilan: { id: 3, positionId: 5, companyId: 99, creationTime: now } }, dto, jobData, since), false);
  assert.equal(bot.isSameCreatedIlan({ ilan: { id: 4, positionId: 5, companyId: 10339, creationTime: old } }, dto, jobData, since), false);
  // Ad tabanlı eşleşme (ID alanları yanıtta yoksa)
  assert.equal(bot.isSameCreatedIlan({ ilan: { id: 5, positionName: 'Chief Mate', firmName: 'Crewinjob Manning', noticeDate: now } }, dto, jobData, since), true);
});

test('updateIlanExpiry refuses to send a partial DTO when no getter is configured', async () => {
  const prev = process.env.CREWINJOB_ILAN_EDIT_GETTER;
  delete process.env.CREWINJOB_ILAN_EDIT_GETTER;
  const originalFetch = global.fetch;
  let fetched = 0;
  global.fetch = async () => { fetched++; throw new Error('network disabled in tests'); };
  try {
    await assert.rejects(bot.updateIlanExpiry(1, '2026-12-01'), (err) => err.code === 'ILAN_EDIT_GETTER_MISSING');
    assert.equal(fetched, 0);
  } finally {
    global.fetch = originalFetch;
    if (prev !== undefined) process.env.CREWINJOB_ILAN_EDIT_GETTER = prev;
  }
});

// Backend sözleşmesi (27 Ekim 2026): GET Ilan/GetIlanForEdit → result.ilan; yalnız expirationDate değişir.
// fetch tamamen taklit edilir; gerçek API'ye hiçbir istek gitmez.
async function withIlanApi(handler, work) {
  const prev = process.env.CREWINJOB_ILAN_EDIT_GETTER, originalFetch = global.fetch, calls = [];
  process.env.CREWINJOB_ILAN_EDIT_GETTER = 'Ilan/GetIlanForEdit';
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  global.fetch = async (url, init = {}) => {
    const text = String(url);
    if (text.endsWith('/api/TokenAuth/Authenticate')) return reply(200, { result: { accessToken: 'test-only-token', expireInSeconds: 3600 } });
    calls.push({ url: text, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    return handler(text, init, reply);
  };
  try { await work(calls); } finally {
    global.fetch = originalFetch;
    if (prev === undefined) delete process.env.CREWINJOB_ILAN_EDIT_GETTER; else process.env.CREWINJOB_ILAN_EDIT_GETTER = prev;
  }
}

test('updateIlanExpiry sends the full DTO back with only expirationDate changed', async () => {
  const ilan = { id: 41, positionId: 3, shipTypeId: 7, companyId: 10339, description: 'Keep me', salary: 4200, expirationDate: '2026-10-30T00:00:00' };
  await withIlanApi((url, init, reply) => url.includes('/Ilan/GetIlanForEdit') ? reply(200, { success: true, result: { ilan } }) : reply(200, { success: true, result: null }), async calls => {
    await bot.updateIlanExpiry(41, '2026-11-29');
    assert.match(calls[0].url, /\/api\/services\/app\/Ilan\/GetIlanForEdit\?Id=41$/);
    assert.equal(calls[1].method, 'POST');assert.match(calls[1].url, /\/Ilan\/CreateOrEdit$/);
    assert.deepEqual(calls[1].body, { ...ilan, expirationDate: '2026-11-29' });
  });
});

test('updateIlanExpiry skips postings whose position or ship type is 0, and postings that are not found', async () => {
  for (const field of ['positionId', 'shipTypeId']) {
    const ilan = { id: 42, positionId: 3, shipTypeId: 7, [field]: 0 };
    await withIlanApi((url, init, reply) => reply(200, { success: true, result: { ilan } }), async calls => {
      await assert.rejects(bot.updateIlanExpiry(42, '2026-11-29'), err => err.code === 'ILAN_EXPIRY_SKIPPED' && err.reason === 'incomplete');
      assert.equal(calls.filter(call => call.method === 'POST').length, 0, `${field}=0 is never saved`);
    });
  }
  for (const status of [200, 500]) {
    await withIlanApi((url, init, reply) => reply(status, { success: false, result: null, error: { message: 'İlan bulunamadı.' } }), async calls => {
      await assert.rejects(bot.updateIlanExpiry(43, '2026-11-29'), err => err.code === 'ILAN_EXPIRY_SKIPPED' && err.reason === 'not_found');
      assert.equal(calls.length, 1);
    });
  }
  await withIlanApi((url, init, reply) => reply(200, { success: true, result: { ilan: { id: 44 } } }), async () => {
    await assert.rejects(bot.updateIlanExpiry(44, '2026-11-29'), err => err.code === 'ILAN_EDIT_GETTER_MISSING', 'a DTO without positionId stops every extension');
  });
  await withIlanApi((url, init, reply) => reply(403, { success: false, error: { message: 'Pages.Ilan izni gerekli' } }), async () => {
    await assert.rejects(bot.updateIlanExpiry(45, '2026-11-29'), err => !err.code && /HTTP 403 \| Pages\.Ilan/.test(err.message), 'other errors keep their message');
  });
});

test('writeJsonAtomic writes complete JSON and leaves no temp files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crewin-json-'));
  try {
    const file = path.join(dir, 'nested', 'data.json');
    writeJsonAtomic(file, { a: 1 });
    writeJsonAtomic(file, { a: 2, list: [1, 2, 3] }, false);
    assert.deepEqual(readJson(file, null), { a: 2, list: [1, 2, 3] });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['data.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('review queue pruning drops only old non-pending items', () => {
  const { pruneReviewQueue } = require('../modules/auto-poster.js');
  const old = new Date(Date.now() - 40 * 86400000).toISOString();
  const recent = new Date(Date.now() - 5 * 86400000).toISOString();
  const kept = pruneReviewQueue([
    { id: 'a', status: 'pending', queuedAt: old },
    { id: 'b', status: 'rejected', queuedAt: old, rejectedAt: old },
    { id: 'c', status: 'rejected', queuedAt: old, rejectedAt: recent },
    { id: 'd', status: 'approved', queuedAt: old, approvedAt: old },
  ]).map(i => i.id);
  assert.deepEqual(kept, ['a', 'c']);
});

test('agent config: only agent keys, process.env wins over .env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crewin-env-'));
  try {
    const envFile = path.join(dir, '.env');
    fs.writeFileSync(envFile, 'TG_SESSION=from-file\r\nGEMINI_API_KEY="file-key"\nGOOGLE_ADS_CLIENT_SECRET=nope\n# yorum\nREPORT_CHAT_ID=1\n');
    const cfg = realAgentConfig.collectAgentConfig({ GEMINI_API_KEY: 'env-key', NEXTAUTH_SECRET: 'nope', TELEGRAM_BOT_TOKEN: 't' }, envFile);
    assert.deepEqual(cfg, { TG_SESSION: 'from-file', GEMINI_API_KEY: 'env-key', REPORT_CHAT_ID: '1', TELEGRAM_BOT_TOKEN: 't' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('job-bot-cli bulk_reject with empty ids rejects nothing and stdout is pure JSON', () => {
  const cli = path.join(__dirname, '..', 'job-bot-cli.js');
  const out = execFileSync(process.execPath, [cli, 'bulk_reject', JSON.stringify({ ids: [] })], {
    cwd: path.join(__dirname, '..'),
    // Test sürecinin agent sırlarını CLI'ye taşıma; ağ çağrısı yapılmaz
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  }).toString();
  const result = JSON.parse(out);
  assert.equal(result.ok, false);
  assert.match(result.error, /ids/);
});
