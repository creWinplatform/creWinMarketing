'use strict';
// crewinjob.com'daki ilanları Telegram gruplarında paylaşır (MTProto user client)
const { getClient }       = require('./tg-client');
const { getJoinedGroups } = require('./group-discovery');
const { loadPosted, updatePostedJob, log } = require('./auto-poster');
const { writeJsonAtomic } = require('./json-file');
const fs   = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Yazma izni olmayan grupları takip et ──────────────────────────────────────
const READONLY_FILE = path.join(__dirname, '..', 'data', 'readonly-groups.json');

function loadReadonly() {
  try { return new Set(JSON.parse(fs.readFileSync(READONLY_FILE, 'utf-8'))); }
  catch { return new Set(); }
}
function markReadonly(groupId) {
  const set = loadReadonly();
  set.add(String(groupId));
  try { writeJsonAtomic(READONLY_FILE, [...set], false); } catch {}
}

// ── Grup başına günlük paylaşım sınırı (ban / göze çarpma koruması) ────────────
const BROADCAST_LOG_FILE = path.join(__dirname, '..', 'data', 'broadcast-log.json');
const MAX_PER_GROUP_PER_DAY = 3; // Bir gruba günde en fazla kaç ilan

function today() { return new Date().toISOString().slice(0, 10); }

function loadBroadcastLog() {
  try { return JSON.parse(fs.readFileSync(BROADCAST_LOG_FILE, 'utf-8')); }
  catch { return {}; }
}
function saveBroadcastLog(logObj) {
  // Sadece bugünü tut — eski günleri buda
  const pruned = { [today()]: logObj[today()] || {} };
  try { writeJsonAtomic(BROADCAST_LOG_FILE, pruned); } catch {}
}
function broadcastCountToday(groupId, logObj = loadBroadcastLog()) {
  return logObj[today()]?.[String(groupId)] || 0;
}
function recordBroadcast(groupId, logObj) {
  const t = today();
  if (!logObj[t]) logObj[t] = {};
  const gid = String(groupId);
  logObj[t][gid] = (logObj[t][gid] || 0) + 1;
}

// ── Mesaj varyasyonları (anti-fingerprint: aynı şablonun tespitini engeller) ──
// Her ilan için ilanId'ye göre deterministik bir şablon seçilir
const TEMPLATES = [
  // Şablon 0 — standart
  (pos, ship, country, contract, salary, url) =>
    `🚢 *NEW JOB OPPORTUNITY | crewinjob.com*\n\n` +
    `📌 Position: *${pos}*\n` +
    (ship     ? `🛳 Vessel: ${ship}\n`     : '') +
    (country  ? `🌍 Flag: ${country}\n`   : '') +
    (contract ? `📅 Contract: ${contract}\n` : '') +
    salary +
    `\n\n✅ *Apply & see full details:*\n${url}\n\n` +
    `#seafarerjobs #maritimejobs #crewjobs #crewinjob`,

  // Şablon 1 — farklı başlık ve sıralama
  (pos, ship, country, contract, salary, url) =>
    `⚓ *MARITIME VACANCY | crewinjob.com*\n\n` +
    `🔹 Position: *${pos}*\n` +
    (country  ? `🌐 Country: ${country}\n` : '') +
    (ship     ? `🚢 Ship Type: ${ship}\n`  : '') +
    (contract ? `🗓 Duration: ${contract}\n` : '') +
    salary +
    `\n\n👉 *Apply now:*\n${url}\n\n` +
    `#seafarer #maritime #crewing #shipping`,

  // Şablon 2 — daha kısa, emoji ağırlıklı
  (pos, ship, country, contract, salary, url) =>
    `🔔 *HIRING NOW — crewinjob.com*\n\n` +
    `✦ *${pos}*\n` +
    (ship || country ? `${ship ? `🛥 ${ship}` : ''}${ship && country ? ' · ' : ''}${country ? `🗺 ${country}` : ''}\n` : '') +
    (contract ? `⏱ ${contract}\n` : '') +
    salary +
    `\n\n📲 *Full details & apply:*\n${url}\n\n` +
    `#jobs #seafarerjobs #crew #maritime`,

  // Şablon 3 — farklı ton (profesyonel)
  (pos, ship, country, contract, salary, url) =>
    `📢 *JOB ALERT | crewinjob.com*\n\n` +
    `We are looking for *${pos}*\n` +
    (ship     ? `▸ Vessel type: ${ship}\n` : '') +
    (country  ? `▸ Flag state: ${country}\n` : '') +
    (contract ? `▸ Contract: ${contract}\n` : '') +
    salary +
    `\n\n🔗 *Apply & view vacancy:*\n${url}\n\n` +
    `#seafarers #maritimejobs #crewinjob #hiring`,
];

function formatJobMessage(job) {
  const d        = job.jobData || {};
  const pos      = d._positionName    || `Position #${job.ilanId}`;
  const ship     = d._shipTypeName    || '';
  const country  = d._countryName     || '';
  const contract = d._contractName    || '';
  const currency = d._currencyName    || '';
  const minP     = d.minPrice != null  ? String(d.minPrice) : '';
  const maxP     = d.maxPrice != null  ? String(d.maxPrice) : '';

  const salary = (minP || maxP) && currency
    ? `\n💰 Salary: ${minP || '?'}–${maxP || '?'} ${currency}`
    : '';

  // İlanId'ye göre deterministik şablon seçimi (tekrar eden aynı mesaj yok)
  const tpl = TEMPLATES[(job.ilanId || 0) % TEMPLATES.length];
  return tpl(pos, ship, country, contract, salary, job.ilanUrl);
}

// ── Tek ilanı tek gruba gönder (hata yönetimi + günlük sayaç) ─────────────────
// Döner: 'sent' | 'skip' (geçici) | 'readonly' (kalıcı) | 'flood'
async function sendJobToGroup(client, g, job, bcLog) {
  const peer = g.username ? g.username : parseInt(g.id);
  try {
    await client.sendMessage(peer, { message: formatJobMessage(job), parseMode: 'md' });
    recordBroadcast(g.id, bcLog);
    saveBroadcastLog(bcLog);
    log(`[broadcast] ✅ "${g.title}" → ${job.ilanUrl} (bugün ${broadcastCountToday(g.id, bcLog)}/${MAX_PER_GROUP_PER_DAY})`);
    return 'sent';
  } catch (e) {
    if (e.message?.includes('FLOOD_WAIT')) {
      const secs = parseInt(e.message.match(/\d+/)?.[0] || '60');
      log(`[broadcast] ⚠️ Flood wait ${secs}s — bekleniyor`);
      await sleep(secs * 1000 + 2000);
      return 'flood';
    }
    if (
      e.message?.includes('CHAT_ADMIN_REQUIRED') ||
      e.message?.includes('CHAT_WRITE_FORBIDDEN') ||
      e.message?.includes('BANNED') ||
      e.message?.includes('USER_BANNED')
    ) {
      log(`[broadcast] 🚫 "${g.title}": yazma izni yok — bir daha denenmeyecek`);
      markReadonly(g.id);
      return 'readonly';
    }
    if (e.message?.includes('PEER_ID_INVALID')) {
      log(`[broadcast] ⚠️ "${g.title}": geçersiz peer (atlanıyor)`);
      return 'readonly';
    }
    log(`[broadcast] ⚠️ "${g.title}": ${e.message}`);
    return 'skip';
  }
}

// ── Yeni ilanları gruplara DAĞITARAK paylaş ───────────────────────────────────
// Aynı ilanı her gruba göndermek yerine, farklı gruplara farklı ilanlar dağıtır
// (round-robin). Böylece her grup benzersiz görünür ve tüm ilan havuzu ağa yayılır.
const MAX_JOB_AGE_DAYS = 7; // Bu kadar günden eski ilanlar broadcast havuzuna alınmaz

async function broadcastNewJobs(maxJobs = 60, maxGroups = 30) {
  const posted  = loadPosted();
  const ageCutoff = Date.now() - MAX_JOB_AGE_DAYS * 24 * 60 * 60 * 1000;
  const pool    = posted
    .filter(p => {
      if (p.broadcastedAt || !p.ilanUrl) return false;
      // Bayat ilan filtresi: yayın tarihi çok eskiyse havuza alma
      const postedMs = new Date(p.postedAt || 0).getTime();
      if (postedMs < ageCutoff) {
        log(`[broadcast] 🗑 Bayat ilan atlanıyor: ${p.ilanUrl} (${new Date(p.postedAt).toLocaleDateString('tr-TR')})`);
        return false;
      }
      return true;
    })
    .slice(0, maxJobs);

  if (!pool.length) {
    log('[broadcast] Yayınlanacak yeni ilan yok.');
    return 0;
  }

  // Yazılabilir grupları hazırla (salt-okunur kanalları çıkar, üyeye göre sırala)
  const readonly  = loadReadonly();
  const allGroups = await getJoinedGroups();
  const groups    = allGroups
    .filter(g => g.id && g.members >= 100 && !readonly.has(String(g.id)))
    .sort((a, b) => b.members - a.members)
    .slice(0, maxGroups);

  if (!groups.length) {
    log('[broadcast] Yayınlanacak yazılabilir grup yok.');
    return 0;
  }

  const client = await getClient();
  const bcLog  = loadBroadcastLog();

  log(`[broadcast] ${pool.length} ilan, ${groups.length} gruba DAĞITILARAK paylaşılacak (grup başı max ${MAX_PER_GROUP_PER_DAY}/gün).`);

  let totalSent   = 0;
  let pointer     = 0;                       // havuzda sıradaki ilan (gruplar arası devam eder)
  const sentJobIds = new Set();              // en az 1 gruba gönderilen ilanlar

  for (const g of groups) {
    let remaining = MAX_PER_GROUP_PER_DAY - broadcastCountToday(g.id, bcLog);
    if (remaining <= 0) {
      log(`[broadcast] ⏭ "${g.title}": günlük sınır dolu — atlanıyor`);
      continue;
    }

    let placedForGroup = 0;
    let tries = 0;
    // Bu grup için kalan kotası kadar FARKLI ilan yerleştir
    while (placedForGroup < remaining && tries < pool.length) {
      const job = pool[pointer % pool.length];
      pointer++;
      tries++;

      // KURAL: kaynak gruba geri yayınlama
      if (String(job.sourceChatId || '') === String(g.id)) continue;

      const res = await sendJobToGroup(client, g, job, bcLog);

      if (res === 'sent') {
        sentJobIds.add(job.ilanId);
        job.broadcastedTo = (job.broadcastedTo || 0) + 1;
        placedForGroup++;
        totalSent++;
        // Artımlı kayıt: her gönderimden hemen sonra diske yaz (mesaj başı 45-60 sn sürüyor;
        // süreç timeout/çökme ile kesilirse aynı ilan tekrar gönderilmesin).
        try {
          updatePostedJob(job.ilanId, (p) => {
            p.broadcastedTo = (p.broadcastedTo || 0) + 1;
            if (!p.broadcastedAt) p.broadcastedAt = new Date().toISOString();
          });
        } catch (e) {
          log(`[broadcast] ⚠️ İlerleme kaydedilemedi (#${job.ilanId}): ${e.message}`);
        }
        await sleep(45000 + Math.random() * 15000); // flood koruması
      } else if (res === 'flood') {
        // aynı ilanı bu grup için tekrar dene (pointer'ı geri al)
        pointer--; tries--;
      } else if (res === 'readonly') {
        break; // bu gruba hiç gönderemeyiz, sonraki gruba geç
      }
      // 'skip' → sonraki ilanı dene
    }
  }

  // Gönderilen ilanlar her gönderimde artımlı olarak işaretlendi (broadcastedAt — bir daha
  // havuza girmez). Eldeki eski tam liste yeniden yazılmıyor (paralel değişiklikleri ezmesin).

  log(`[broadcast] Tamamlandı. ${sentJobIds.size} farklı ilan, toplam ${totalSent} mesaj gönderildi.`);
  return totalSent;
}

// ── Feature 4: Kaynak mesaja otomatik reply ───────────────────────────────────
async function replyToSource(msg, ilanUrl, isTurkish = false) {
  if (!msg.chatId || !msg.messageId) return;
  try {
    const client = await getClient();
    const peer = msg.chatUsername
      ? msg.chatUsername
      : parseInt(msg.chatId);

    const replyText = isTurkish
      ? `✅ Bu ilan crewinjob.com'da yayınlandı!\n👉 ${ilanUrl}`
      : `✅ This job has been published on crewinjob.com!\n👉 ${ilanUrl}`;

    await client.sendMessage(peer, {
      message:  replyText,
      replyTo:  msg.messageId,
    });
    log(`[auto-reply] ✅ Reply gönderildi → "${msg.chatTitle}"`);
  } catch (e) {
    // CHAT_ADMIN_REQUIRED: kanal mesajı, reply normal kullanıcıdan gidemiyor — beklenen durum
    if (e.message?.includes('CHAT_ADMIN_REQUIRED')) return;
    log(`[auto-reply] ⚠️ Reply gönderilemedi (${msg.chatTitle}): ${e.message}`);
  }
}

module.exports = { broadcastNewJobs, sendJobToGroup, formatJobMessage, replyToSource };
