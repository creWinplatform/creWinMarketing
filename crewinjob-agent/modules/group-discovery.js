'use strict';
// Denizcilik Telegram gruplarını keşfeder ve katılır
const fs   = require('fs');
const path = require('path');
const { Api } = require('telegram');
const { getClient } = require('./tg-client');
const { writeJsonAtomic } = require('./json-file');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const GROUPS_FILE = path.join(DATA_DIR, 'discovered-groups.json');

const SEARCH_QUERIES = [
  'seafarer jobs',
  'maritime jobs',
  'ship crew hiring',
  'marine officer vacancy',
  'able seaman job',
  'tanker crew jobs',
  'bulk carrier crew',
  'marine engineer job',
  'cadet seafarer',
  'pelaut kerja kapal',
  'gemi adamı iş',
  'denizci ilan',
  'gemi mürettebat iş',
  'maritime vacancy',
  'sailor jobs ship',
  'crewing agency',
];

const sleep = (min, max = min) =>
  new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

// ── Disk I/O ──────────────────────────────────────────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadGroups() {
  try { return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf-8')); } catch { return []; }
}

function saveGroups(groups) {
  writeJsonAtomic(GROUPS_FILE, groups);
}

// ── Grup arama ────────────────────────────────────────────────────────────────
async function discoverGroups(keywords = SEARCH_QUERIES) {
  const client    = await getClient();
  const existing  = loadGroups();
  const seenIds   = new Set(existing.map(g => g.id));
  const found     = [];

  for (const query of keywords) {
    try {
      const res = await client.invoke(
        new Api.contacts.Search({ q: query, limit: 20 })
      );

      for (const chat of res.chats || []) {
        const id = chat.id?.toString();
        if (!id || seenIds.has(id)) continue;

        const isGroup   = chat.megagroup || chat.gigagroup || chat.className === 'Chat';
        const isChannel = chat.className === 'Channel' && !chat.megagroup;
        if (!isGroup && !isChannel) continue;

        const members = chat.participantsCount || 0;
        if (members < 100) continue; // çok küçük grupları atla

        const item = {
          id,
          title:       chat.title || '',
          username:    chat.username ? `@${chat.username}` : null,
          members,
          type:        isGroup ? 'group' : 'channel',
          joined:      false,
          discoveredAt: new Date().toISOString(),
          query,
        };

        seenIds.add(id);
        existing.push(item);
        found.push(item);
        console.log(`[discovery] Yeni: "${item.title}" (${members} üye) — query: "${query}"`);
      }
    } catch (e) {
      console.warn(`[discovery] Arama hatası "${query}": ${e.message}`);
    }
    await sleep(3000, 6000);
  }

  saveGroups(existing);
  return found;
}

// ── Tek grup katılımı ────────────────────────────────────────────────────────
async function joinGroup(target) {
  const client = await getClient();
  try {
    await client.invoke(new Api.channels.JoinChannel({ channel: target }));
    return true;
  } catch (e) {
    if (e.message?.includes('already') || e.message?.includes('USER_ALREADY')) return true;
    if (e.message?.includes('FLOOD_WAIT')) {
      const secs = parseInt(e.message.match(/\d+/)?.[0] || '60');
      console.warn(`[discovery] Flood wait: ${secs}s`);
      await sleep(secs * 1000);
      return false;
    }
    throw e;
  }
}

// ── Keşfedilen tüm katılınmamış gruplara katıl ────────────────────────────────
async function joinDiscoveredGroups() {
  const groups = loadGroups();
  const toJoin = groups.filter(g => !g.joined);
  let joined   = 0;

  for (const g of toJoin) {
    const target = g.username || g.id;
    try {
      const ok = await joinGroup(target);
      if (ok) {
        g.joined   = true;
        g.joinedAt = new Date().toISOString();
        joined++;
        console.log(`[discovery] ✅ Katıldı: "${g.title}" (${g.members} üye)`);
      }
    } catch (e) {
      console.warn(`[discovery] ⚠️ "${g.title}": ${e.message}`);
    }
    saveGroups(groups); // Her katılımdan sonra kaydet
    await sleep(12000, 20000); // Ban önlemi: 12-20s bekle
  }

  return joined;
}

// ── Katılınan tüm grup/kanalları getir (dialog listesinden) ──────────────────
async function getJoinedGroups() {
  const client = await getClient();
  const groups = [];

  try {
    const dialogs = await client.getDialogs({ limit: 300 });
    for (const d of dialogs) {
      const entity = d.entity;
      if (!entity) continue;
      const isGroup   = entity.megagroup || entity.gigagroup || entity.className === 'Chat';
      const isChannel = entity.className === 'Channel';
      if (!isGroup && !isChannel) continue;
      groups.push({
        id:       entity.id?.toString(),
        title:    entity.title || d.title || '',
        username: entity.username ? `@${entity.username}` : null,
        members:  entity.participantsCount || 0,
        type:     isGroup ? 'group' : 'channel',
      });
    }
  } catch (e) {
    console.error('[discovery] Dialog listesi alınamadı:', e.message);
    // Fallback: disk'teki keşfedilen grupları kullan
    return loadGroups().filter(g => g.joined);
  }

  return groups.sort((a, b) => b.members - a.members);
}

module.exports = { discoverGroups, joinGroup, joinDiscoveredGroups, getJoinedGroups, SEARCH_QUERIES };
