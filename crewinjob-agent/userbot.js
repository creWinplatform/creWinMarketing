'use strict';
const fs   = require('fs');
const path = require('path');

// Config önceliği diğer modüllerle AYNI: process.env kazanır; .userbot-config.json (web'in
// yazdığı ham değerler) ve .env yalnızca tanımsız anahtarları doldurur. .env kendi
// ayrıştırıcımızla okunur — dotenvx v17 base64 değerlerdeki + ve = karakterlerini bozuyordu.
require('./modules/agent-config').loadAgentConfig();

const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { NewMessage }     = require('telegram/events');
const { Api }            = require('telegram');
const cron               = require('node-cron');
const poster             = require('./modules/telegram-poster');

// ── Ortam değişkenleri ────────────────────────────────────────────────────────
const API_ID       = parseInt(process.env.TG_API_ID      || '0');
const API_HASH     =           process.env.TG_API_HASH   || '';
const SESSION      =           process.env.TG_SESSION    || '';
const BOT_USERNAME =           process.env.TG_BOT_USERNAME || '@CrewinJobBot';

// Virgülle ayrılmış kanal/grup kullanıcı adları veya ID'leri
// Örn: @denizcilikgrubu,@maritime_turkey veya -1001234567890
const TARGET_CHANNELS = (process.env.TG_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean);

// ── Denizcilik grubu arama sorguları ─────────────────────────────────────────
const SEARCH_QUERIES = [
  'gemi adamı iş',
  'denizci iş ilanı',
  'maritime jobs turkey',
  'seafarer jobs',
  'ship crew hiring',
  'denizcilik ilan',
  'gemi mürettebat',
  'marine officer jobs',
];

// ── İş ilanı anahtar kelimeleri (en az 2 eşleşme = ilan) ─────────────────────
const JOB_KEYWORDS = [
  'kaptan','master','chief officer','baş zabit','zabit','officer',
  'makinist','engineer','ab seaman','güverte','deck','eto','elektrik',
  'bosun','pumper','motorman','oiler','wiper','cadet','stajyer',
  'crew','mürettebat','maaş','salary','başvur','apply',
  'ilan','vacancy','job','hiring','arıyoruz','aranıyor',
];

// ── Bant genişliği kontrolü ───────────────────────────────────────────────────
const dmSentSet    = new Set(); // Aynı kişiye 1 DM
const joinedSet    = new Set(); // Aynı gruba 1 katılım
let   dmCountToday = 0;
const DM_DAILY_LIMIT = 50;     // Günlük maksimum DM (Telegram ban'dan korunmak için)

const sleep = (min, max = min) =>
  new Promise(r => setTimeout(r, min + Math.random() * (max - min)));

// ── Yardımcılar ───────────────────────────────────────────────────────────────
function isJobPost(text = '') {
  if (text.length < 40) return false;
  const lower = text.toLowerCase();
  return JOB_KEYWORDS.filter(kw => lower.includes(kw)).length >= 2;
}

function isSeekingJob(text = '') {
  const lower = text.toLowerCase();
  return lower.includes('iş arıyorum') ||
         lower.includes('looking for job') ||
         lower.includes('seeking position') ||
         lower.includes('available for') ||
         lower.includes('müsaitim');
}

function dmText(lang = 'tr') {
  return lang === 'tr'
    ? `👋 Merhaba!\n\nCrewinJob — Türkiye'nin denizcilik iş platformunu keşfettiniz mi?\n\n🚢 Binlerce gemi ilanı, doğrulanmış armatörler, kolay başvuru sistemi.\n\n📲 Telegram botumuzdan anında iş ara: ${BOT_USERNAME}\n🌐 https://crewinjob.com\n\nHerhangi bir sorunuz olursa yardımcı olmaktan memnuniyet duyarım!`
    : `👋 Hello!\n\nHave you heard of CrewinJob — the leading maritime job platform?\n\n🚢 Thousands of ship jobs, verified employers, easy applications.\n\n📲 Search jobs via our Telegram bot: ${BOT_USERNAME}\n🌐 https://crewinjob.com\n\nFeel free to reach out if you have any questions!`;
}

// ── Mevcut diyalogları tara ve kaydet ────────────────────────────────────────
const GROUPS_FILE = path.join(__dirname, '.userbot-groups.json');

async function scanExistingDialogs(client) {
  console.log('[userbot] 📂 Mevcut grup ve kanallar taranıyor...');
  try {
    const dialogs = await client.getDialogs({ limit: 200 });
    const groups  = [];

    for (const d of dialogs) {
      const entity = d.entity;
      if (!entity) continue;

      const isGroup   = entity.megagroup || entity.gigagroup || entity.className === 'Chat';
      const isChannel = entity.className === 'Channel' && !entity.megagroup;
      if (!isGroup && !isChannel) continue;

      const item = {
        id:    entity.id?.toString(),
        title: entity.title || d.title || '',
        username: entity.username ? `@${entity.username}` : null,
        members:  entity.participantsCount || 0,
        type:     isGroup ? 'group' : 'channel',
      };

      // Zaten takip edilen gruba kaydet
      if (item.id) joinedSet.add(item.id);
      groups.push(item);
    }

    // UI için dosyaya yaz
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2), 'utf-8');
    console.log(`[userbot] 📂 ${groups.length} grup/kanal bulundu ve izlemeye alındı.`);
  } catch (e) {
    console.error('[userbot] Dialog tarama hatası:', e.message);
  }
}

// ── Özellik 1: Verilen kanallara katıl ───────────────────────────────────────
async function joinTargetChannels(client) {
  if (!TARGET_CHANNELS.length) {
    console.log('[userbot] TG_CHANNELS tanımlı değil, kanal katılımı atlandı.');
    return;
  }
  console.log(`[userbot] ${TARGET_CHANNELS.length} hedefe katılınıyor...`);
  for (const ch of TARGET_CHANNELS) {
    try {
      await client.invoke(new Api.channels.JoinChannel({ channel: ch }));
      console.log(`[userbot] ✅ Katıldı: ${ch}`);
    } catch (e) {
      if (e.message?.includes('already') || e.message?.includes('USER_ALREADY')) {
        console.log(`[userbot] Zaten üye: ${ch}`);
      } else {
        console.warn(`[userbot] ⚠️ ${ch}: ${e.message}`);
      }
    }
    await sleep(3000, 7000);
  }
}

// ── Özellik 2: Denizcilik gruplarını ara ve katıl ─────────────────────────────
async function searchAndJoinGroups(client) {
  console.log('[userbot] 🔍 Denizcilik grupları aranıyor...');
  let joined = 0;

  for (const query of SEARCH_QUERIES) {
    try {
      const res = await client.invoke(new Api.contacts.Search({ q: query, limit: 20 }));

      for (const chat of res.chats || []) {
        const idStr = chat.id?.toString();
        if (!idStr || joinedSet.has(idStr)) continue;

        // Sadece gruplar (megagroup/gigagroup/Chat), kanalları atla
        const isGroup = chat.megagroup || chat.gigagroup || chat.className === 'Chat';
        if (!isGroup) continue;

        // Çok küçük (<50 üye) veya çok büyük (>50k) grupları atla
        const count = chat.participantsCount || 0;
        if (count < 50 || count > 50000) continue;

        try {
          const target = chat.username ? `@${chat.username}` : chat.id;
          await client.invoke(new Api.channels.JoinChannel({ channel: target }));
          joinedSet.add(idStr);
          joined++;
          console.log(`[userbot] ✅ Grup katıldı: "${chat.title}" (${count} üye)`);
          await sleep(15000, 30000); // Grup katılımları arası uzun bekleme
        } catch (e) {
          if (!e.message?.includes('already')) {
            console.warn(`[userbot] ⚠️ "${chat.title}": ${e.message}`);
          } else {
            joinedSet.add(idStr);
          }
        }
      }
    } catch (e) {
      console.error(`[userbot] Arama hatası "${query}": ${e.message}`);
    }
    await sleep(5000, 10000);
  }

  console.log(`[userbot] Grup tarama tamamlandı. Yeni: ${joined} grup.`);
}

// ── Özellik 3: Yeni mesajları dinle ──────────────────────────────────────────
function setupMessageListener(client) {
  client.addEventHandler(async (event) => {
    try {
      const msg    = event.message;
      const text   = msg?.text || msg?.message || '';
      const sender = msg?.senderId;

      if (!text || !sender) return;

      // İş ilanı tespiti → parse + log
      if (isJobPost(text)) {
        console.log(`[userbot] 📋 İlan tespit edildi: ${text.slice(0, 80).replace(/\n/g, ' ')}...`);
        try {
          const parsed = await poster.parseGroupJobPost(text);
          if (parsed.isJob) {
            console.log('[userbot] Parse sonucu:', JSON.stringify(parsed.data, null, 2));
          }
        } catch {}
      }

      // İş arayan veya iş ilanı paylaşan kullanıcıya DM gönder
      if ((isJobPost(text) || isSeekingJob(text)) && dmCountToday < DM_DAILY_LIMIT) {
        const senderStr = sender.toString();
        if (!dmSentSet.has(senderStr)) {
          await sleep(3000, 8000); // İnsan gibi gecikme
          try {
            await client.sendMessage(sender, { message: dmText('tr') });
            dmSentSet.add(senderStr);
            dmCountToday++;
            console.log(`[userbot] 📨 DM gönderildi: ${senderStr} (bugün: ${dmCountToday}/${DM_DAILY_LIMIT})`);
            await sleep(5000, 12000);
          } catch (e) {
            // Kullanıcı DM kapatmış, bot engellemiş vb. — sessizce geç
          }
        }
      }
    } catch (e) {
      // Event handler hataları sessizce geçilir
    }
  }, new NewMessage({}));

  console.log('[userbot] 👂 Mesaj dinleyicisi aktif');
}

// ── Ana fonksiyon ─────────────────────────────────────────────────────────────
async function main() {
  if (!API_ID || !API_HASH) {
    console.error('❌ TG_API_ID ve TG_API_HASH .env dosyasında tanımlı olmalı');
    process.exit(1);
  }
  if (!SESSION) {
    console.error('❌ TG_SESSION eksik. Önce kimlik doğrulama yap:\n   node userbot-auth.js');
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, {
    connectionRetries: 10,
    retryDelay:        2000,
    autoReconnect:     true,
  });

  console.log('[userbot] Bağlanıyor...');
  await client.connect();

  const me = await client.getMe();
  console.log(`[userbot] ✅ Giriş: ${me.firstName} ${me.lastName || ''} (@${me.username || me.phone})`);

  // 1) Mevcut tüm grup/kanalları tara ve kaydet
  await scanExistingDialogs(client);

  // 2) Hedef kanallara katıl
  await joinTargetChannels(client);

  // 3) Mesaj dinleyicisini kur (tüm mevcut gruplar dahil)
  setupMessageListener(client);

  // 4) Grup aramasını 3 dakika sonra başlat
  setTimeout(() => searchAndJoinGroups(client), 3 * 60 * 1000);

  // 5) Her gün 08:00 TR'de yeni grupları ara + sayaç sıfırla
  cron.schedule('0 5 * * *', () => {
    dmCountToday = 0;
    searchAndJoinGroups(client);
  }, { timezone: 'UTC' });

  console.log('[userbot] 🤖 Hazır! Ctrl+C ile durdurabilirsin.\n');

  // Süreci canlı tut
  await new Promise(() => {});
}

main().catch((e) => {
  console.error('[userbot] Fatal hata:', e.message);
  process.exit(1);
});
