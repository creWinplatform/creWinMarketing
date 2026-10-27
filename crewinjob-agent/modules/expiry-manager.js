'use strict';
// İlan sona erme yönetimi: dolmak üzere olanları otomatik uzatır
const { loadPosted, savePosted, log } = require('./auto-poster');
const bot = require('./job-bot');

const EXTEND_DAYS   = 30; // Uzatma süresi
const WARN_DAYS     = 7;  // Kaç gün kala uyar/uzat

async function manageExpirations() {
  const posted = loadPosted();
  const today  = new Date();
  const soon   = new Date(today.getTime() + WARN_DAYS * 86400000);

  const expiring = posted.filter(job => {
    const exp = job.jobData?.expirationDate;
    if (!exp) return false;
    const d = new Date(exp);
    return d > today && d <= soon;
  });

  const expired = posted.filter(job => {
    const exp = job.jobData?.expirationDate;
    if (!exp) return false;
    return new Date(exp) <= today;
  });

  log(`[expiry] Süresi yaklaşan: ${expiring.length} | Süresi dolmuş: ${expired.length}`);

  let extended = 0;
  let skipped = 0;
  let disabledReason = null;
  for (const job of expiring) {
    try {
      const newExp = new Date(today.getTime() + EXTEND_DAYS * 86400000)
        .toISOString().slice(0, 10);
      await bot.updateIlanExpiry(job.ilanId, newExp);
      job.jobData.expirationDate = newExp;
      log(`[expiry] ✅ İlan #${job.ilanId} uzatıldı → ${newExp}`);
      extended++;
    } catch (e) {
      if (e.code === 'ILAN_EDIT_GETTER_MISSING') {
        // Tam DTO alınamıyor → kısmi DTO ile veri silme riskine girme; tüm uzatmaları durdur
        disabledReason = e.message;
        log(`[expiry] ⛔ Uzatma durduruldu: ${e.message}`);
        break;
      }
      if (e.code === 'ILAN_EXPIRY_SKIPPED') {
        // Bulunamayan veya pozisyon/gemi tipi 0 olan ilan: yalnız bu ilan atlanır
        skipped++;
        log(`[expiry] ⏭️ ${e.message}`);
        continue;
      }
      log(`[expiry] ⚠️ İlan #${job.ilanId} uzatılamadı: ${e.message}`);
    }
  }

  if (extended > 0) savePosted(posted);

  return {
    expiring: expiring.length,
    expired:  expired.length,
    extended,
    skipped,
    disabled: disabledReason,
  };
}

module.exports = { manageExpirations };
