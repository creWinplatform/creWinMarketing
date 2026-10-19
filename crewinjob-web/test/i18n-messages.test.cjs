// TR/EN arayüz dili: sunucu mesajı sözlüğünün kapsamı ve çeviri yardımcıları.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { extract, dictionary } = require('../scripts/i18n-messages.cjs');
const pairs = require('../scripts/i18n-pairs.cjs');

function loadTs(file, modules = {}) {
  const full = path.resolve(__dirname, '..', file);
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported = {};
  vm.runInNewContext(code, { exports: exported, require: name => modules[name] ?? require(name) });
  return exported;
}

const dict = dictionary();
const shared = loadTs('lib/i18n/shared.ts');
const uiPairs = loadTs('lib/i18n/ui-pairs.ts').UI_PAIRS;
const messages = loadTs('lib/i18n/messages.ts', { './messages-en': { MESSAGES_EN: dict }, './ui-pairs': { UI_PAIRS: uiPairs } });

test('every Turkish server message has an English translation', () => {
  const missing = extract().filter(message => !Object.prototype.hasOwnProperty.call(dict, message.text)).map(message => `${message.text}  (${message.files.join(', ')})`);
  assert.deepEqual(missing, [], `Add these to lib/i18n/messages-en.ts:\n${missing.join('\n')}`);
});

test('translations keep placeholders and avoid banned claims', () => {
  for (const [tr, en] of Object.entries(dict)) {
    assert.ok(en.trim(), `empty translation for: ${tr}`);
    const count = text => (text.match(/\{\d+\}/g) || []).sort().join();
    assert.equal(count(en), count(tr), `placeholder mismatch: ${tr}`);
    assert.doesNotMatch(en, /\bautonomous|\bguarantee/i, `brand rule: ${en}`);
    assert.doesNotMatch(en, /[çğıöşüÇĞİÖŞÜ]/, `Turkish letters left in: ${en}`);
  }
});

test('translateMessage handles exact, templated and unknown text', () => {
  const [exact] = Object.entries(dict).find(([tr]) => !/\{\d+\}/.test(tr));
  assert.equal(messages.translateMessage(exact, 'en'), dict[exact]);
  assert.equal(messages.translateMessage(exact, 'tr'), exact);
  const [templated, english] = Object.entries(dict).find(([tr]) => /^\{0\} /.test(tr));
  assert.equal(messages.translateMessage(templated.replace('{0}', '7'), 'en'), english.replace('{0}', '7'));
  assert.equal(messages.translateMessage('Unknown text', 'en'), 'Unknown text');
  assert.equal(messages.translateMessage(undefined, 'en'), '');
});

test('messages switch back when the interface language changes', () => {
  // Sunucu mesajı: EN → TR
  const [tr, en] = Object.entries(dict).find(([key]) => !/\{\d+\}/.test(key));
  assert.equal(messages.translateMessage(en, 'tr'), tr);
  // Arayüz çifti iki yönde
  assert.equal(messages.translateMessage('İstek tamamlanamadı.', 'en'), 'Request failed.');
  assert.equal(messages.translateMessage('Request failed.', 'tr'), 'İstek tamamlanamadı.');
  // Birleştirilmiş cümleler parça parça çevrilir
  assert.equal(messages.translateMessage('Kitle kaydedilemedi. Webhook kabul edilemedi.', 'en'), "Couldn't save the audience. Couldn't accept the webhook.");
  // Şablon değişkeni de çevrilebilir bir mesajsa çevrilir
  assert.equal(messages.translateMessage('CLI çıktısı JSON değil: Durduruldu', 'en'), 'CLI output is not JSON: Stopped');
});

test('generated UI message pairs are up to date', () => {
  const expected = pairs.render(pairs.extract());
  const current = fs.readFileSync(path.resolve(__dirname, '../lib/i18n/ui-pairs.ts'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(current, expected, 'Run: node scripts/i18n-pairs.cjs');
});

test('language preference from Accept-Language', () => {
  assert.equal(shared.langFromAcceptLanguage(null), 'tr');
  assert.equal(shared.langFromAcceptLanguage('tr-TR,tr;q=0.9,en;q=0.8'), 'tr');
  assert.equal(shared.langFromAcceptLanguage('en-US,en;q=0.9'), 'en');
  assert.equal(shared.langFromAcceptLanguage('de-DE,de;q=0.9'), 'en');
  assert.equal(shared.langFromAcceptLanguage('en;q=0.5,tr;q=0.9'), 'tr');
  assert.equal(shared.localeTag('en'), 'en-GB');
  assert.equal(shared.pick('en', 'a', 'b'), 'b');
});
