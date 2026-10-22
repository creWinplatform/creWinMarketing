'use strict';
// Pipeline cron scheduler — her 4 saatte bir tam döngü çalıştırır
const cron = require('node-cron');
const { discoverGroups } = require('./group-discovery');
const { runPipeline, loadConfig, loadReviewQueue } = require('./auto-poster');
const { broadcastNewJobs } = require('./group-broadcaster');
const { manageExpirations } = require('./expiry-manager');
const { sendDailySummary }  = require('./daily-reporter');
const { disconnect }       = require('./tg-client');
const { log }              = require('./auto-poster');

let _running = false;

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Telegram Bot API üzerinden admin'e hızlı bildirim.
// YALNIZCA admin/rapor sohbetine gider — herkese açık kanala (TELEGRAM_CHANNEL_ID) ASLA düşmez
// (eskiden admin chat tanımlı değilse hata mesajları public kanala gidiyordu).
async function sendAdminAlert(text) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.REPORT_CHAT_ID;
  if (!token || !chatId) {
    log(`[scheduler] ℹ️ Admin uyarısı gönderilmedi (TELEGRAM_ADMIN_CHAT_ID/REPORT_CHAT_ID veya bot token yok): ${text.replace(/<[^>]+>/g, '')}`);
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) log(`[scheduler] ⚠️ Admin uyarısı gönderilemedi (HTTP ${res.status})`);
  } catch (e) {
    log(`[scheduler] ⚠️ Admin uyarısı gönderilemedi: ${e.message}`);
  }
}

// ── Tam döngü ─────────────────────────────────────────────────────────────────
async function fullCycle(options = {}) {
  if (_running) {
    log('[scheduler] Önceki döngü devam ediyor, atlanıyor.');
    return;
  }
  _running = true;

  log('════════════════════════════════════════');
  log('  Pipeline döngüsü başladı');
  log('════════════════════════════════════════');

  try {
    // 1. Yeni grupları keşfet — yalnız öneri listesine yazılır.
    // 2. Katılma otomatik değil: Pipeline → Gruplar ekranında bir kişi seçip onaylar.
    log('[scheduler] 🔍 Grup keşfi (yalnız öneri)...');
    const found = await discoverGroups();
    log(`[scheduler] ${found.length} yeni grup öneri listesine eklendi (katılınmadı).`);

    // 3. Mesajları çek → crewinjob.com'a ilan oluştur
    log('[scheduler] 📋 Pipeline çalışıyor...');
    const result = await runPipeline({ maxJobs: options.maxJobs || 15 });
    log(`[scheduler] Pipeline bitti: ${JSON.stringify(result)}`);

    // İnceleme kuyruğu çok büyüdüyse uyar
    const pendingCount = loadReviewQueue().filter(i => i.status === 'pending').length;
    const alertSize = loadConfig().alertQueueSize || 20;
    if (pendingCount >= alertSize) {
      await sendAdminAlert(`⚠️ <b>crewinjob Review Queue</b>\n${pendingCount} ilan inceleme bekliyor.\ndashboard'u kontrol et.`);
    }

    // 4. Telegram broadcast — MANUEL MOD: otomatik gönderim devre dışı.
    //    Pipeline tab'ından "Telegram'a Gönder" butonu ile manuel yapılır.
    // const sent = await broadcastNewJobs(options.maxBroadcast || 5);
    log('[scheduler] 📢 Broadcast atlandı (manuel mod aktif).');

    // 5. Sona yaklaşan ilanları uzat
    log('[scheduler] ⏳ Sona erme kontrolü...');
    const expResult = await manageExpirations();
    log(`[scheduler] Expiry: ${JSON.stringify(expResult)}`);

  } catch (e) {
    log(`[scheduler] ❌ Döngü hatası: ${e.message}`);
    console.error(e);
    await sendAdminAlert(`❌ <b>crewinjob Pipeline Hatası</b>\n${escapeHtml(e.message)}`);
  } finally {
    _running = false;
  }

  log('════════════════════════════════════════');
  log('  Pipeline döngüsü tamamlandı');
  log('════════════════════════════════════════\n');
}

// ── Daemon modu (node pipeline-scheduler.js ile başlatılır) ───────────────────
async function startScheduler(options = {}) {
  log('[scheduler] Başlatılıyor (her 4 saatte bir: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC)');

  // Her 4 saatte bir çalış
  cron.schedule('0 0,4,8,12,16,20 * * *', () => fullCycle(options), { timezone: 'UTC' });

  // Günlük rapor: her sabah 08:00 UTC
  cron.schedule('0 8 * * *', () => sendDailySummary(), { timezone: 'UTC' });
  log('[scheduler] Günlük rapor: her sabah 08:00 UTC');

  // Hemen ilk çalışma (10s sonra — bağlantı kurulsun diye)
  setTimeout(() => fullCycle(options), 10000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    log('[scheduler] SIGINT — kapatılıyor...');
    await disconnect();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    log('[scheduler] SIGTERM — kapatılıyor...');
    await disconnect();
    process.exit(0);
  });

  // Daemon: süreci canlı tut
  return new Promise(() => {});
}

module.exports = { startScheduler, fullCycle };

// Doğrudan çalıştırılınca scheduler'ı başlat
if (require.main === module) {
  startScheduler().catch(e => { console.error(e); process.exit(1); });
}
