'use strict';
// Gruplara yeni katılan gemi adamlarına crewinjob.com kaydı için DM gönderir
const { getClient } = require('./tg-client');
const { getJoinedGroups } = require('./group-discovery');
const { log } = require('./auto-poster');
const path = require('path');
const fsLib = require('fs');
const { writeJsonAtomic } = require('./json-file');

const DATA_DIR      = path.join(__dirname, '..', 'data');
const DM_LOG_FILE   = path.join(DATA_DIR, 'onboarding-sent.json');
const COOLDOWN_DAYS  = 30; // Aynı kullanıcıya kaç günde bir gönder
const MAX_GROUPS_PER_RUN = 15; // Tek çalışmada taranacak max grup (flood koruması)

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function loadDmLog() {
  try { return JSON.parse(fsLib.readFileSync(DM_LOG_FILE, 'utf-8')); } catch { return {}; }
}
function saveDmLog(log_) {
  writeJsonAtomic(DM_LOG_FILE, log_);
}

function canSend(userId, dmLog) {
  const last = dmLog[userId];
  if (!last) return true;
  const daysSince = (Date.now() - new Date(last).getTime()) / 86400000;
  return daysSince >= COOLDOWN_DAYS;
}

const DM_MESSAGES = {
  tr: `👋 Merhaba! Denizcilere özel iş ilanları ve kariyer fırsatları için crewinjob.com'a göz at 🚢\n\n🔗 https://crewinjob.com\n\nÜcretsiz profil oluştur, binlerce ilan arasından sana uygun pozisyonu bul! ⚓`,
  en: `👋 Hi! Looking for maritime jobs? Check out crewinjob.com 🚢\n\n🔗 https://crewinjob.com\n\nCreate your free profile and find the right position among thousands of job listings! ⚓`,
};

async function onboardNewMembers(maxDms = 20) {
  const client = await getClient();
  const dmLog  = loadDmLog();
  const allGroups = await getJoinedGroups();
  // Flood koruması: tek seferde max 15 grup tara, üye sayısına göre sırala
  const groups = allGroups
    .sort((a, b) => (b.members || 0) - (a.members || 0))
    .slice(0, MAX_GROUPS_PER_RUN);

  log(`[onboarding] ${groups.length}/${allGroups.length} grupta yeni üye taraması başlıyor...`);

  let sent = 0;
  const { Api } = require('telegram');

  for (const g of groups) {
    if (sent >= maxDms) break;
    if (!g.id) continue;

    try {
      // Son 24 saatte katılan üyeleri çek (updateNewChannelMessage / service mesajlar)
      const history = await client.invoke(
        new Api.messages.GetHistory({
          peer:       g.id,
          limit:      50,
          offsetId:   0,
          offsetDate: 0,
          addOffset:  0,
          maxId:      0,
          minId:      0,
          hash:       BigInt(0),
        })
      );

      const oneDayAgo = Math.floor((Date.now() - 86400000) / 1000);

      for (const msg of history.messages || []) {
        if (sent >= maxDms) break;
        if (msg.date < oneDayAgo) continue;

        // Gruba katılım servis mesajı
        const isJoin = msg.action?.className === 'MessageActionChatAddUser' ||
                       msg.action?.className === 'MessageActionChatJoinedByLink';
        if (!isJoin) continue;

        const userIds = msg.action?.users || (msg.fromId?.userId ? [msg.fromId.userId] : []);

        for (const userId of userIds) {
          if (sent >= maxDms) break;
          const uid = userId.toString();
          if (!canSend(uid, dmLog)) continue;

          try {
            const isTurkishGroup = /türk|türkiye|deniz|gemi/i.test(g.title);
            const text = isTurkishGroup ? DM_MESSAGES.tr : DM_MESSAGES.en;

            await client.sendMessage(userId, { message: text });
            dmLog[uid] = new Date().toISOString();
            sent++;
            // Artımlı kayıt: süreç yarıda kesilirse aynı kişiye tekrar DM gitmesin
            try { saveDmLog(dmLog); } catch (e) { log(`[onboarding] ⚠️ DM kaydı yazılamadı: ${e.message}`); }
            log(`[onboarding] ✅ DM gönderildi → user ${uid} (grup: ${g.title})`);
            await sleep(20000 + Math.random() * 10000); // DM flood koruması
          } catch (e) {
            if (e.message?.includes('USER_PRIVACY_RESTRICTED')) {
              log(`[onboarding] 🔒 User ${userId}: DM'e kapalı`);
            } else {
              log(`[onboarding] ⚠️ User ${userId}: ${e.message}`);
            }
          }
        }
      }
    } catch (e) {
      log(`[onboarding] "${g.title}" tarama hatası: ${e.message}`);
    }

    await sleep(3000);
  }

  saveDmLog(dmLog);
  log(`[onboarding] Tamamlandı — ${sent} DM gönderildi`);
  return { sent };
}

module.exports = { onboardNewMembers };
