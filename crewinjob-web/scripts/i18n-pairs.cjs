#!/usr/bin/env node
// Arayüzdeki iki dilli metin çiftlerini (tr ? 'A' : 'B', t('A','B'), l('A','B'), { tr:'A', en:'B' })
// kaynaktan çıkarır. Ekranda duran bir mesaj (hata, bildirim) dil değişince karşılığına çevrilebilsin diye
// yalnızca mesaj olarak kullanılan çiftler (setError/setNotice/setMessage/throw … yakınındakiler) saklanır.
//   node scripts/i18n-pairs.cjs          → lib/i18n/ui-pairs.ts dosyasını yeniden üretir
//   node scripts/i18n-pairs.cjs --check  → dosya güncel değilse çıkış kodu 1
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['components', 'app', 'lib'];
const OUT = path.join(ROOT, 'lib/i18n/ui-pairs.ts');
// '…' | "…" | `… ${x} …` (şablon değişkenleri {0}, {1} … olur)
const S = String.raw`'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|` + '`' + String.raw`((?:\\.|\$\{[^{}\n]*\}|[^\\\n` + '`' + String.raw`])*)` + '`';
const PATTERNS = [
  new RegExp(String.raw`\btr\s*\?\s*(?:${S})\s*:\s*(?:${S})`, 'g'),
  new RegExp(String.raw`\blang\s*===?\s*'tr'\s*\?\s*(?:${S})\s*:\s*(?:${S})`, 'g'),
  new RegExp(String.raw`\b(?:t|l|pick\(\s*lang\s*,)\s*\(?\s*(?:${S})\s*,\s*(?:${S})\s*\)`, 'g'),
  new RegExp(String.raw`\btr\s*:\s*(?:${S})\s*,\s*en\s*:\s*(?:${S})`, 'g'),
];
const REVERSED = [
  new RegExp(String.raw`\blang\s*===?\s*'en'\s*\?\s*(?:${S})\s*:\s*(?:${S})`, 'g'),
  new RegExp(String.raw`\ben\s*\?\s*(?:${S})\s*:\s*(?:${S})`, 'g'),
];
// Çiftin bir mesaj olarak kullanıldığı bağlam (önceki ~200 karakter içinde).
const MESSAGE_CONTEXT = /(set\w*(?:Error|Errors|Notice|Message|Status|Info|Feedback|Success|Toast|Warning)\w*\(|\b(?:flash|toast|notify|showToast)\(|new Error\(|throw\b|catch\b|fail\w*|\.message|error\s*[:=]|notice\s*[:=]|message\s*[:=]|reject)/;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) walk(full, out); }
    else if (/\.(ts|tsx)$/.test(entry.name) && !full.endsWith(path.join('i18n', 'ui-pairs.ts')) && !full.endsWith(path.join('i18n', 'messages-en.ts'))) out.push(full);
  }
  return out;
}

const unescape = text => text.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');

function extract() {
  const pairs = new Map();
  const holes = text => { let index = 0; return text.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, () => `{${index++}}`); };
  const count = text => (text.match(/\{\d+\}/g) || []).length;
  const add = (tr, en) => {
    tr = holes(unescape(tr)).trim(); en = holes(unescape(en)).trim();
    if (tr.length < 3 || en.length < 3 || tr === en) return;
    // Değişken sayısı uyuşmayan veya yalnızca değişkenden oluşan çiftler çevrilemez.
    if (count(tr) !== count(en) || !tr.replace(/\{\d+\}/g, '').trim()) return;
    if (!pairs.has(tr)) pairs.set(tr, en);
  };
  for (const file of DIRS.flatMap(dir => walk(path.join(ROOT, dir), []))) {
    // CRLF checkouts must give the same result as LF ones: the message-context window is measured in characters.
    const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const scan = (patterns, swap) => {
      for (const pattern of patterns) for (const match of source.matchAll(pattern)) {
        const context = source.slice(Math.max(0, match.index - 200), match.index + 20);
        if (!MESSAGE_CONTEXT.test(context)) continue;
        const first = match[1] ?? match[2] ?? match[3], second = match[4] ?? match[5] ?? match[6];
        if (first == null || second == null) continue;
        if (swap) add(second, first); else add(first, second);
      }
    };
    scan(PATTERNS, false);
    scan(REVERSED, true);
  }
  return [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b, 'tr'));
}

function render(entries) {
  const body = entries.map(([tr, en]) => `  ${JSON.stringify(tr)}: ${JSON.stringify(en)},`).join('\n');
  return `// OTOMATİK ÜRETİLİR — elle düzenlemeyin: node scripts/i18n-pairs.cjs\n// Arayüzde mesaj olarak gösterilen iki dilli çiftler (Türkçe → İngilizce). translateMessage bunları iki yönde kullanır.\nexport const UI_PAIRS: Record<string, string> = {\n${body}\n};\n`;
}

if (require.main === module) {
  const next = render(extract());
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (current !== next) { console.error('lib/i18n/ui-pairs.ts güncel değil: node scripts/i18n-pairs.cjs'); process.exitCode = 1; }
  } else {
    fs.writeFileSync(OUT, next);
    console.log(`${next.split('\n').length - 5} pairs → lib/i18n/ui-pairs.ts (${Buffer.byteLength(next)} bytes)`);
  }
}

module.exports = { extract, render };
