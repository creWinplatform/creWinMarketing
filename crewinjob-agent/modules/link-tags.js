'use strict';
// Ryzevo kaynak etiketi (utm_campaign=rz_…) — panelin lib/platform/crewin-links.ts'iyle aynı kural:
// "rz_" + sha256(JSON.stringify(["crewin","crewinjob", tür, kimlik])) ilk 10 hane.
// crewinjob.com, linkle gelen ziyaretçinin ilk temasını çerezde tutar; kayıt olayıyla panele döner ve panelin
// "Hangi iş müşteri getirdi" raporu etiketi buradaki başlıkla adlandırır (data/link-tags.jsonl, panel okur).
// Kayıt dosyasına yalnız satır eklenir: ajan ve panel süreçleri aynı anda yazsa da kayıt kaybolmaz.
// Kayıt store.js üzerinden yazılır (dosya modunda aynı .jsonl dosyası, db modunda panelin tablosu); linkler eşzamanlı
// üretilir, kayıt arkada sırayla yapılır — kapanmadan önce flush() beklenir.
const crypto = require('crypto');
const store  = require('./store');

const SCOPE  = ['crewin', 'crewinjob'];
const HOST   = 'crewinjob.com';
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
// CREWIN_LINK_TAGS_FILE: dosya modunda başka bir kayıt dosyası (testler)
const tagsStore = () => process.env.CREWIN_LINK_TAGS_FILE
  ? store.store('data/link-tags.jsonl', { file: process.env.CREWIN_LINK_TAGS_FILE })
  : store.stores.linkTags;

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
let known = { key: '', titles: new Map() };
async function loadKnown() {
  const def = tagsStore(), key = `${store.mode()}:${def.file}`;
  if (known.key === key) return known.titles;
  const titles = new Map();
  for (const item of await store.read(def)) if (item && item.tag) titles.set(item.tag, { generic: Boolean(item.generic) }); // bozuk satır okunurken atlanır
  known = { key, titles };
  return titles;
}
// Kayıtlar sırayla yazılır (aynı etiket iki kez eklenmesin); döner: Promise<boolean> (satır eklendi mi).
let pending = Promise.resolve();
function remember(tag, kind, title, generic = false) {
  const createdAt = new Date().toISOString();
  const run = pending.then(async () => {
    try {
      const titles = await loadKnown(), current = titles.get(tag);
      if (current && (generic || !current.generic)) return false;
      const line = { tag, kind, title: String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80), createdAt, ...(generic ? { generic: true } : {}) };
      await store.append(tagsStore(), [line]);
      titles.set(tag, { generic });
      return true;
    } catch (e) {
      console.warn('[link-tags] kayıt yazılamadı:', e.message);
      return false;
    }
  });
  pending = run;
  return run;
}
// Bekleyen etiket kayıtları bitene kadar bekler (CLI çıkmadan önce, testler).
function flush() { return pending.then(() => undefined); }

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

module.exports = { crewinTag, tagUrl, tagText, remember, flush, fixedTag, jobLink, jobIdFromUrl };
