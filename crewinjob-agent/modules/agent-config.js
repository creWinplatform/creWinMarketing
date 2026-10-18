'use strict';
// Ortak yapılandırma yükleyici — TÜM agent modülleri aynı önceliği kullanır:
//   1) process.env (web'in .env.local'ı / Docker ortamı) HER ZAMAN kazanır
//   2) .userbot-config.json yalnızca tanımsız (boş) anahtarları doldurur
//   3) agent .env yalnızca hâlâ tanımsız anahtarları doldurur (CLI kullanımı için yedek)
// Not: .env burada kendi basit ayrıştırıcımızla okunur — dotenvx v17 base64 değerlerdeki
// '+' ve '=' karakterlerini bozuyordu (TG_SESSION).
const fs   = require('fs');
const path = require('path');

const AGENT_DIR = path.join(__dirname, '..');
const CFG_FILE  = path.join(AGENT_DIR, '.userbot-config.json');
const ENV_FILE  = path.join(AGENT_DIR, '.env');

// Agent'ın ihtiyaç duyduğu anahtarlar — .userbot-config.json'a YALNIZCA bunlar yazılır
const AGENT_KEY_PATTERNS = [/^TG_/, /^TELEGRAM_/, /^REPORT_CHAT_ID$/, /^GEMINI_API_KEY$/, /^CREWINJOB_API_/];

function isAgentKey(key) {
  return AGENT_KEY_PATTERNS.some(re => re.test(key));
}

function parseEnvFile(file = ENV_FILE) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf-8'); } catch { return {}; }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#') || !l.includes('=')) continue;
    const idx = l.indexOf('=');
    const key = l.slice(0, idx).replace(/^export\s+/, '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = l.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function readJsonConfig(file = CFG_FILE) {
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  } catch { return {}; }
}

function fillUnset(source) {
  Object.entries(source).forEach(([k, v]) => {
    if (!process.env[k]) process.env[k] = String(v ?? '');
  });
}

// Süreç başına bir kez çalışır (CLI/userbot/scheduler ayrı süreçlerdir)
let _loaded = false;
function loadAgentConfig() {
  if (_loaded) return;
  _loaded = true;
  fillUnset(readJsonConfig(CFG_FILE));
  fillUnset(parseEnvFile(ENV_FILE));
}

// Web route'ları için: .userbot-config.json içeriği — önce process.env, sonra agent .env;
// yalnızca agent anahtarları (web'in diğer sırları — reklam/OAuth token'ları vb. — kopyalanmaz).
function collectAgentConfig(primaryEnv = process.env, envFile = ENV_FILE) {
  const out = {};
  Object.entries(parseEnvFile(envFile)).forEach(([k, v]) => {
    if (isAgentKey(k) && v !== '') out[k] = v;
  });
  Object.entries(primaryEnv || {}).forEach(([k, v]) => {
    if (isAgentKey(k) && v) out[k] = String(v);
  });
  return out;
}

// Atomik yazım (tmp + rename), sahibine özel izin. İçerik değişmediyse yazmaz.
function writeAgentConfigFile(primaryEnv = process.env) {
  const cfg  = collectAgentConfig(primaryEnv);
  const json = JSON.stringify(cfg);
  try { if (fs.readFileSync(CFG_FILE, 'utf-8') === json) return Object.keys(cfg); } catch {}
  const tmp = `${CFG_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, json, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, CFG_FILE);
  return Object.keys(cfg);
}

module.exports = {
  CFG_FILE, ENV_FILE,
  isAgentKey, parseEnvFile, readJsonConfig,
  loadAgentConfig, collectAgentConfig, writeAgentConfigFile,
};
