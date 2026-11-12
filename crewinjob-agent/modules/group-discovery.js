'use strict';
// Denizcilik Telegram gruplarını keşfeder ve öneri listesine yazar. Katılma yalnız bir kişinin seçtiği gruplara,
// düğmeyle olur (joinSelectedGroups); keşif ve zamanlayıcı kendiliğinden hiçbir gruba katılmaz.
const path = require('path');
const { Api } = require('telegram');
const { getClient } = require('./tg-client');
const store = require('./store');

// Testler geçici bir klasör verir; gerçek data/ klasörüne dokunmaz.
const DATA_DIR   = process.env.CREWINJOB_AGENT_DATA_DIR || path.join(__dirname, '..', 'data');
const GROUPS_FILE = path.join(DATA_DIR, 'discovered-groups.json');
// store.js: dosya modunda bu dosya, db modunda panelin tablosu (agent:discovered-groups)
const GROUPS_STORE = store.store('data/discovered-groups.json', { file: GROUPS_FILE });

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

// ── Veri ──────────────────────────────────────────────────────────────────────
async function loadGroups() {
  return store.read(GROUPS_STORE);
}

// ── Öneri kaydı ───────────────────────────────────────────────────────────────
// Arama sonuçlarını öneri olarak yazar (joined:false). Katılım yapmaz. Userbot'un günlük araması da bunu kullanır.
async function recordSuggestions(chats, query) {
  let found = [];
  await store.mutate(GROUPS_STORE, existing => {
    const seenIds  = new Set(existing.map(g => g.id));
    found          = [];
    for (const chat of chats || []) {
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
      console.log(`[discovery] Öneri: "${item.title}" (${members} üye) — query: "${query}"`);
    }
    return found.length ? existing : undefined;
  });
  return found;
}

// ── Grup arama (yalnız öneri) ─────────────────────────────────────────────────
async function discoverGroups(keywords = SEARCH_QUERIES) {
  const client = await getClient();
  const found  = [];
  for (const query of keywords) {
    try {
      const res = await client.invoke(new Api.contacts.Search({ q: query, limit: 20 }));
      found.push(...(await recordSuggestions(res.chats || [], query)));
    } catch (e) {
      console.warn(`[discovery] Arama hatası "${query}": ${e.message}`);
    }
    await sleep(3000, 6000);
  }
  return found;
}

// ── Öneri listesi ─────────────────────────────────────────────────────────────
async function listSuggestions() {
  return (await loadGroups()).filter(g => !g.joined && !g.dismissed).sort((a, b) => (b.members || 0) - (a.members || 0));
}

async function dismissSuggestions(ids) {
  const wanted = new Set(validIds(ids));
  let dismissed = 0;
  await store.mutate(GROUPS_STORE, groups => {
    dismissed = 0;
    for (const g of groups) if (wanted.has(g.id) && !g.joined && !g.dismissed) { g.dismissed = true; g.dismissedAt = new Date().toISOString(); dismissed++; }
    return dismissed ? groups : undefined;
  });
  return dismissed;
}

const MAX_JOIN_PER_REQUEST = 10;
function validIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && /^\d{1,20}$/.test(id)))];
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

// ── Yalnız seçilen önerilere katıl ────────────────────────────────────────────
// Bir kişinin ekranda seçtiği gruplar (en fazla 10). Listede olmayan, gizlenen veya zaten katılınan gruplar atlanır.
async function joinSelectedGroups(ids, join = joinGroup) {
  const wanted = validIds(ids);
  if (!wanted.length) throw new Error('Katılmak için en az bir grup seçin.');
  if (wanted.length > MAX_JOIN_PER_REQUEST) throw new Error(`Bir seferde en fazla ${MAX_JOIN_PER_REQUEST} gruba katılın.`);
  const groups = await loadGroups();
  const toJoin = groups.filter(g => wanted.includes(g.id) && !g.joined && !g.dismissed);
  let joined   = 0;

  for (const g of toJoin) {
    const target = g.username || g.id;
    try {
      const ok = await join(target);
      if (ok) {
        g.joined   = true;
        g.joinedAt = new Date().toISOString();
        joined++;
        console.log(`[discovery] ✅ Katıldı: "${g.title}" (${g.members} üye)`);
        // Her katılımdan sonra kaydet — liste taze okunur, yalnız bu grup işaretlenir (paralel değişiklikler ezilmez)
        await store.mutate(GROUPS_STORE, current => {
          const saved = current.find(item => item.id === g.id);
          if (!saved) return undefined;
          saved.joined   = true;
          saved.joinedAt = g.joinedAt;
          return current;
        });
      }
    } catch (e) {
      console.warn(`[discovery] ⚠️ "${g.title}": ${e.message}`);
    }
    if (g !== toJoin[toJoin.length - 1]) await sleep(12000, 20000); // Ban önlemi: 12-20s bekle
  }

  return { joined, skipped: wanted.length - toJoin.length };
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
    return (await loadGroups()).filter(g => g.joined);
  }

  return groups.sort((a, b) => b.members - a.members);
}

module.exports = { discoverGroups, recordSuggestions, listSuggestions, dismissSuggestions, joinGroup, joinSelectedGroups, getJoinedGroups, SEARCH_QUERIES, MAX_JOIN_PER_REQUEST };
