'use strict';
// JSON veri dosyaları için ortak okuma/atomik yazma yardımcıları.
// Atomik yazım: önce aynı klasöre geçici dosya, sonra rename. Böylece web paneli
// (doğrudan okuyan route'lar) ve paralel CLI süreçleri hiçbir zaman yarım yazılmış JSON görmez.
const fs   = require('fs');
const path = require('path');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {}
}

function writeJsonAtomic(file, data, pretty = true) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  const tmp  = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
  fs.writeFileSync(tmp, json, 'utf-8');
  // Windows: hedef dosya o anda başka süreçte (antivirüs vb.) açıksa rename EPERM/EBUSY verebilir — kısa tekrar
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (attempt < 4 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { sleepSync(50 * (attempt + 1)); continue; }
      try { fs.unlinkSync(tmp); } catch {}
      throw e;
    }
  }
}

module.exports = { readJson, writeJsonAtomic };
