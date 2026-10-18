const test = require('node:test');
const assert = require('node:assert/strict');

process.env.GEMINI_API_KEY = 'test-key';
const ai = require('../ai-client.js');

// Gemini SDK global fetch kullanır — ağ çağrısı yapılmaz. Yanıtlarda usageMetadata
// yok, böylece testler data/api-usage.json dosyasına yazmaz.
function geminiOk(text) {
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 });
}
function geminiError(status, message, details) {
  return new Response(JSON.stringify({ error: { code: status, message, status: 'RESOURCE_EXHAUSTED', details } }), { status });
}
function modelFromUrl(url) {
  return /models\/([^:]+):generateContent/.exec(url)[1];
}

async function withFetch(handler, fn) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const call = { url: String(url), body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    return handler(call, calls.length);
  };
  try { await fn(calls); } finally { global.fetch = originalFetch; }
}

test('messages.create maps system, multi-turn messages and max_tokens', async () => {
  await withFetch(() => geminiOk('hello'), async (calls) => {
    const res = await ai.messages.create({
      model: 'gemini-2.0-flash-lite',
      max_tokens: 300,
      system: 'SYS',
      messages: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: [{ type: 'text', text: 'u2' }] },
      ],
    });
    assert.equal(res.content[0].text, 'hello');
    assert.equal(modelFromUrl(calls[0].url), 'gemini-2.0-flash-lite');
    const body = calls[0].body;
    assert.equal(body.systemInstruction.parts[0].text, 'SYS');
    assert.deepEqual(body.contents.map(c => c.role), ['user', 'model', 'user']);
    assert.equal(body.contents[2].parts[0].text, 'u2');
    assert.equal(body.generationConfig.maxOutputTokens, 300);
  });
});

test('thinking models get headroom on top of the visible max_tokens budget', async () => {
  await withFetch(() => geminiOk('ok'), async (calls) => {
    await ai.messages.create({ model: 'gemini-2.5-flash', max_tokens: 600, messages: [{ role: 'user', content: 'x' }] });
    assert.ok(calls[0].body.generationConfig.maxOutputTokens > 600);
  });
});

test('unknown textModel falls back to the default chain', async () => {
  await withFetch(() => geminiOk('ok'), async (calls) => {
    await ai.generateWithRetry('prompt', 'evil-model/../x');
    assert.equal(modelFromUrl(calls[0].url), 'gemini-flash-lite-latest');
  });
});

test('429 is retried on the same model honoring RetryInfo retryDelay', async () => {
  await withFetch((call, n) => (n === 1
    ? geminiError(429, 'Resource has been exhausted', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0.01s' }])
    : geminiOk('after-retry')), async (calls) => {
    const text = await ai.generateWithRetry('prompt', 'gemini-2.5-flash');
    assert.equal(text, 'after-retry');
    assert.equal(calls.length, 2);
    assert.equal(modelFromUrl(calls[1].url), 'gemini-2.5-flash');
  });
});

test('daily quota 429 falls back to the next model without waiting', async () => {
  await withFetch((call) => (modelFromUrl(call.url) === 'gemini-2.5-pro'
    ? geminiError(429, 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0', [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }])
    : geminiOk('fallback')), async (calls) => {
    const text = await ai.generateWithRetry('prompt', 'gemini-2.5-pro');
    assert.equal(text, 'fallback');
    assert.equal(calls.length, 2);
    assert.equal(modelFromUrl(calls[1].url), 'gemini-flash-lite-latest');
  });
});
