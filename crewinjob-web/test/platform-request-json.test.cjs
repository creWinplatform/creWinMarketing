const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./platform-loader.cjs');
const { readAuthenticationJson, readBoundedJsonBytes, readBoundedBodyBytes } = load('request-json.ts');

const request = (body, headers = {}, signal) => new Request('http://fixture.invalid', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, duplex: 'half', signal,
});
const promptlyRejects = async (promise, pattern) => {
  let timer;
  try {
    await assert.rejects(Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Test request did not settle.')), 1000);
    })]), pattern);
  } finally { clearTimeout(timer); }
};

test('authentication JSON accepts a bounded object and split UTF-8 chunks', async () => {
  const bytes = Buffer.from(JSON.stringify({ username: '\u00e9', password: 'fixture' }));
  const stream = new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  assert.equal((await readAuthenticationJson(request(stream, { 'content-type': 'application/json; charset=utf-8' }))).username, '\u00e9');
});

test('authentication JSON rejects null, arrays, primitives, invalid JSON and malformed UTF-8', async () => {
  for (const body of ['null', '[]', 'true', '123', '"text"', '{', Uint8Array.of(0xff)]) {
    await assert.rejects(readAuthenticationJson(request(body)));
  }
});

test('JSON content type must be application/json, not a prefix match', async () => {
  for (const mime of ['application/jsonp', 'application/json-invalid', 'text/plain']) {
    await assert.rejects(readBoundedJsonBytes(request('{}', { 'content-type': mime }), 16), /Invalid request/);
  }
});

test('bounded provider response parsing still works without a request signal', async () => {
  const bytes = await readBoundedBodyBytes(new Response('{"status":"ok"}'), 32);
  assert.equal(new TextDecoder().decode(bytes), '{"status":"ok"}');
});

test('invalid declared sizes and invalid parser budgets are refused', async () => {
  for (const size of ['-1', '1.5', '1e3', 'NaN', 'Infinity', '9007199254740992']) {
    await assert.rejects(readBoundedBodyBytes(request('{}', { 'content-length': size }), 32), /Request too large/);
  }
  for (const maximum of [0, -1, NaN, Infinity, 1.5]) {
    await assert.rejects(readBoundedBodyBytes(request('{}'), maximum), /Invalid body limit/);
  }
});

test('actual byte count is enforced without content-length and with an understated header', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(8)); controller.enqueue(new Uint8Array(9));
    }, cancel() { cancelled = true; } });
    await promptlyRejects(readBoundedBodyBytes(request(stream, headers), 16), /Request too large/);
    assert.equal(cancelled, true);
  }
  assert.equal((await readBoundedBodyBytes(request(new Uint8Array(16)), 16)).length, 16);
});

test('oversize cancellation cannot hold the request open even when upstream cancel never settles', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(17)); },
    cancel() { cancelled = true; return new Promise(() => {}); } });
  await promptlyRejects(readBoundedBodyBytes(request(stream), 16), /Request too large/);
  assert.equal(cancelled, true);
});

test('oversize rejection is preserved when upstream cancellation throws', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(17)); },
    cancel() { throw new Error('private upstream detail'); } });
  await promptlyRejects(readBoundedBodyBytes(request(stream), 16), /Request too large/);
});

test('declared oversized body is cancelled without waiting for a chunk', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  await promptlyRejects(readBoundedBodyBytes(request(stream, { 'content-length': '17' }), 16), /Request too large/);
  assert.equal(cancelled, true);
});

test('client abort settles a stalled read without waiting for upstream cancellation', async () => {
  const abort = new AbortController(); let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  const reading = readBoundedBodyBytes(request(stream, {}, abort.signal), 16);
  abort.abort();
  await promptlyRejects(reading, /Request aborted/);
  assert.equal(cancelled, true);
});

test('a pre-aborted request is refused even when its body is immediately available', async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(readBoundedBodyBytes(request('{}', {}, abort.signal), 16), /Request aborted/);
});

test('five-second deadline bounds a stalled body independently of upstream cancellation', { timeout: 7000 }, async () => {
  const stream = new ReadableStream({ cancel() { return new Promise(() => {}); } });
  const start = performance.now();
  await assert.rejects(readBoundedBodyBytes(request(stream), 16), /Request timed out/);
  assert.ok(performance.now() - start < 6500);
});
