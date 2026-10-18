'use strict';
// İçerik üretim zamanlayıcısı — CLI menüsündeki "Zamanlayıcı" (16) seçeneği
// pipeline-scheduler.js'den bağımsız: Telegram değil, haftalık/aylık içerik üretir

const cron = require('node-cron');

let _active = false;
const _tasks = [];

function startScheduler() {
  if (_active) return;

  // Her Pazartesi 08:00 UTC — haftalık içerik + SEO + KPI
  _tasks.push(
    cron.schedule('0 8 * * 1', () => {
      console.log('[scheduler] 📅 Haftalık içerik döngüsü başladı (Pazartesi 08:00)');
    }, { timezone: 'UTC' })
  );

  // Ayın 1'i 09:00 UTC — aylık blog paketi
  _tasks.push(
    cron.schedule('0 9 1 * *', () => {
      console.log('[scheduler] 📚 Aylık blog paketi başladı (Ayın 1\'i 09:00)');
    }, { timezone: 'UTC' })
  );

  // Her gün 09:00 UTC — yeni ilan SEO meta
  _tasks.push(
    cron.schedule('0 9 * * *', () => {
      console.log('[scheduler] 🔍 Günlük ilan SEO meta üretimi başladı (09:00)');
    }, { timezone: 'UTC' })
  );

  _active = true;
  console.log('[scheduler] ✅ Zamanlayıcı aktif.');
}

function stopScheduler() {
  _tasks.forEach(t => t.stop());
  _tasks.length = 0;
  _active = false;
  console.log('[scheduler] ⏹ Zamanlayıcı durduruldu.');
}

function getSchedulerStatus() {
  return { active: _active };
}

module.exports = { startScheduler, stopScheduler, getSchedulerStatus };
