'use strict';
// Ryzevo kaynak etiketi (utm_campaign=rz_…) — panelin lib/platform/crewin-links.ts'iyle aynı kural:
// "rz_" + sha256(JSON.stringify(["crewin","crewinjob", tür, kimlik])) ilk 10 hane.
// crewinjob.com, linkle gelen ziyaretçinin ilk temasını çerezde tutar; kayıt olayıyla panele döner ve panelin
// "Hangi iş müşteri getirdi" raporu etiketi buradaki başlıkla adlandırır (data/link-tags.jsonl, panel okur).
// Kayıt dosyasına yalnız satır eklenir: ajan ve panel süreçleri aynı anda yazsa da kayıt kaybolmaz.
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const SCOPE  = ['crewin', 'crewinjob'];
const HOST   = 'crewinjob.com';
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const tagsFile = () => process.env.CREWIN_LINK_TAGS_FILE || path.join(__dirname, '..', 'data', 'link-tags.jsonl');

// Sabit etiketler: tek tek ilan dışındaki bot ve kanal linkleri.
const FIXED = {
  bot:     ['bot', 'telegram-bot',    'Telegram botu'],
  channel: ['bot', 'channel-summary', 'Telegram kanalı günlük güncelleme'],
  groups:  ['bot', 'telegram-groups', 'Telegram grup paylaşımları'],
};

function crewinTag(kind, id) {
  return 'rz_' + crypto.createHash('sha256').update(JSON.stringify([...SCOPE, String(kind), String(id)])).digest('hex').slice(0, 10);
}

function isCrewinSite(url) {
  const name = url.hostname.toLowerCase();
  return name === HOST || name.endsWith('.' + HOST);
}

// crewinjob.com linkine etiketi ekler. Var olan utm_source/utm_medium korunur, yoksa verilenler yazılır.
// utm_campaign zaten varsa, link başka sitedeyse, bozuksa veya abonelikten çıkma linkiyse aynen döner.
function tagUrl(raw, tag, { source = 'telegram', medium = 'social' } = {}) {
  let url;
  try { url = new URL(raw); } catch { return raw; }
  if (!/^rz_[a-f0-9]{10}$/.test(tag) || !isCrewinSite(url) || url.searchParams.has('utm_campaign') || /unsubscribe|abonelik/i.test(url.pathname + url.search)) return raw;
  if (!url.searchParams.has('utm_source')) url.searchParams.set('utm_source', source);
  if (!url.searchParams.has('utm_medium')) url.searchParams.set('utm_medium', medium);
  url.searchParams.set('utm_campaign', tag);
  return url.toString();
}

// Metindeki crewinjob.com linklerini etiketler. "&amp;" taşıyan (HTML'e kaçışlanmış) link aynen kalır.
function tagText(text, tag, opts) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(URL_RE, match => {
    const trail = (match.match(/[.,;:!?)\]}»”’]+$/) || [''])[0];
    const raw   = match.slice(0, match.length - trail.length);
    return raw.includes('&amp;') ? match : tagUrl(raw, tag, opts) + trail;
  });
}

// Etiketin başlığını kaydeder. Genel başlık ("İlan #123") sonradan gerçek başlıkla bir kez güncellenebilir;
// panel bir etiketin son satırını kullanır.
let known = { file: '', titles: new Map() };
function loadKnown() {
  const file = tagsFile();
  if (known.file === file) return known.titles;
  const titles = new Map();
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      try { const item = JSON.parse(line); if (item && item.tag) titles.set(item.tag, { generic: Boolean(item.generic) }); } catch { /* bozuk satır */ }
    }
  } catch { /* dosya henüz yok */ }
  known = { file, titles };
  return titles;
}
function remember(tag, kind, title, generic = false) {
  try {
    const titles = loadKnown(), current = titles.get(tag);
    if (current && (generic || !current.generic)) return false;
    const line = { tag, kind, title: String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80), createdAt: new Date().toISOString(), ...(generic ? { generic: true } : {}) };
    fs.mkdirSync(path.dirname(tagsFile()), { recursive: true });
    fs.appendFileSync(tagsFile(), JSON.stringify(line) + '\n');
    titles.set(tag, { generic });
    return true;
  } catch (e) {
    console.warn('[link-tags] kayıt yazılamadı:', e.message);
    return false;
  }
}

function fixedTag(name) {
  const [kind, id, title] = FIXED[name];
  const tag = crewinTag(kind, id);
  remember(tag, kind, title);
  return tag;
}

// İlan linki: aynı ilan kanalda, gruplarda ve bot yanıtında aynı etiketi taşır (utm_medium nerede paylaşıldığını söyler).
// Kimlik yoksa grup veya bot için sabit etiket kullanılır.
function jobLink(url, jobId, title, medium = 'social') {
  if (!url) return url;
  if (jobId === null || jobId === undefined || jobId === '') return tagUrl(url, fixedTag(medium === 'group' ? 'groups' : 'bot'), { source: 'telegram', medium });
  const tag = crewinTag('job', jobId);
  remember(tag, 'job', title ? `İlan: ${title}` : `İlan #${jobId}`, !title);
  return tagUrl(url, tag, { source: 'telegram', medium });
}

// crewinjob.com/jobs/detail/{id} linkindeki ilan kimliği.
function jobIdFromUrl(url) {
  const match = String(url || '').match(/crewinjob\.com\/jobs\/detail\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

module.exports = { crewinTag, tagUrl, tagText, remember, fixedTag, jobLink, jobIdFromUrl };
