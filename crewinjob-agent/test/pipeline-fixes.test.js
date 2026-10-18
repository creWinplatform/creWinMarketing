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
