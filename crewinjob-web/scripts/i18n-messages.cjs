#!/usr/bin/env node
// Sunucu tarafındaki Türkçe kullanıcı mesajlarını (hata ve durum metinleri) kaynaktan çıkarır.
// İngilizce arayüz bu metinleri lib/i18n/messages-en.ts sözlüğünden çevirir.
//   node scripts/i18n-messages.cjs            → çıkarılan mesajları JSON olarak yazdırır
//   node scripts/i18n-messages.cjs --missing  → sözlükte İngilizcesi olmayanları yazdırır (eksik varsa çıkış kodu 1)
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// ../crewinjob-agent: panelin çağırdığı ajan modülleri (kuyruk nedenleri, hata metinleri arayüzde görünür)
const DIRS = ['lib', 'app/api', '../crewinjob-agent/modules', '../crewinjob-agent/pipeline.js'];
const FILES = ['middleware.ts'];
const TURKISH = /[çğıöşüÇĞİÖŞÜ]|\b(ve|veya|için|bir|yok|ile|bulunamadı|gerekli|geçersiz|değil|olmalı|zorunlu|henüz)\b|\b\w+(?:amadı|emedi|ılamadı|ilemedi|edildi|ildi|ıldı|uldu|üldü)\b/u;
// Mesaj bağlamları: new XError('…'), error/message/reason/detail/warning: '…' ve denetim bulgusu alanları
// (title, category, recommendation, evidence, limitations, note …) — arayüz bunları translateMessage ile gösterir.
const CONTEXT = /(?:Error\(\s*|\b(?:error|message|reason|detail|warning|title|category|recommendation|evidence|limitations?|dataNote|note|verificationMessage|summary|label)\s*:\s*)(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
// Bu modüller yalnız CrewinJob müşteri projesine ait içerik üretir; kullanıcıya hata metni dönmez.
const SKIP = [/lib\/image-composite\.ts$/, /\.test\./];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!/^(node_modules|output|context|data|test|\.)/.test(entry.name)) walk(full, out); }
    else if (/\.(ts|tsx|js|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Şablon değişkenlerini ${…} → {0}, {1} … biçimine çevirir. */
function normalise(raw, quote) {
  let text = raw;
  if (quote === '`') {
    let index = 0;
    text = text.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, () => `{${index++}}`);
  }
  return text.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
}

function extract() {
  const files = DIRS.flatMap(dir => { const full = path.join(ROOT, dir); if (!fs.existsSync(full)) return []; return fs.statSync(full).isFile() ? [full] : walk(full, []); }).concat(FILES.map(file => path.join(ROOT, file)).filter(fs.existsSync));
  const found = new Map();
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (SKIP.some(pattern => pattern.test(rel))) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(CONTEXT)) {
      const text = normalise(match[2], match[1]).trim();
      if (text.length < 3 || !TURKISH.test(text)) continue;
      if (!found.has(text)) found.set(text, new Set());
      found.get(text).add(rel);
    }
  }
  return [...found.entries()].map(([text, files]) => ({ text, files: [...files].sort() })).sort((a, b) => a.text.localeCompare(b.text, 'tr'));
}

function dictionary() {
  const file = path.join(ROOT, 'lib/i18n/messages-en.ts');
  if (!fs.existsSync(file)) return {};
  const source = fs.readFileSync(file, 'utf8');
  const body = source.slice(source.indexOf('= {') + 2, source.lastIndexOf('}') + 1);
  // Sözlük düz bir nesne değişmezi; JSON'a yakın sözdizimi kullanır.
  return Function(`"use strict";return (${body});`)();
}

if (require.main === module) {
  const messages = extract();
  if (process.argv.includes('--missing')) {
    const dict = dictionary();
    const missing = messages.filter(message => !Object.prototype.hasOwnProperty.call(dict, message.text));
    process.stdout.write(JSON.stringify(missing, null, 2) + '\n');
    process.exitCode = missing.length ? 1 : 0;
  } else {
    process.stdout.write(JSON.stringify(messages, null, 2) + '\n');
  }
}

module.exports = { extract, dictionary };
