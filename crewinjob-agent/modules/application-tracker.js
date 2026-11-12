'use strict';
// Yayınlanan ilanların başvurularını crewinjob API'sinden çeker ve kaydeder
const bot = require('./job-bot');
const { loadPosted, mutatePosted, log } = require('./auto-poster');

async function fetchApplicationCount(ilanId) {
  try {
    return await bot.fetchIlanApplicationCount(ilanId);
  } catch {
    return null;
  }
}

async function trackApplications(maxCheck = 20) {
  const posted = await loadPosted();

  // Son 30 günde yayınlanan ilanları kontrol et (en yeniden başla)
  const cutoff  = new Date(Date.now() - 30 * 86400000).toISOString();
  const toCheck = posted
    .filter(p => p.ilanId && p.postedAt > cutoff)
    .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt))
    .slice(0, maxCheck);

  log(`[tracker] ${toCheck.length} ilan için başvuru sayısı kontrol ediliyor...`);

  let updated = 0;
  const changed = [];
  for (const job of toCheck) {
    const count = await fetchApplicationCount(job.ilanId);
    if (count !== null && count !== job.applicationCount) {
      job.applicationCount   = count;
      job.applicationCheckedAt = new Date().toISOString();
      changed.push(job);
      updated++;
      if (count > 0) {
        log(`[tracker] 📥 İlan #${job.ilanId} — ${count} başvuru`);
      }
    }
  }

  // Liste taze okunur, yalnız güncellenen ilanların sayıları yazılır (ağ çağrıları sürerken yapılan değişiklikler ezilmez)
  if (updated > 0) {
    await mutatePosted(list => {
      for (const job of changed) {
        const saved = list.find(p => p.ilanId === job.ilanId);
        if (!saved) continue;
        saved.applicationCount     = job.applicationCount;
        saved.applicationCheckedAt = job.applicationCheckedAt;
      }
      return list;
    });
  }
  log(`[tracker] Tamamlandı — ${updated} ilan güncellendi`);

  return {
    checked: toCheck.length,
    updated,
    totalApplications: posted.reduce((s, p) => s + (p.applicationCount || 0), 0),
  };
}

// Başvuru sayısı job-bot.fetchIlanApplicationCount üzerinden alınır:
// IlanBasvuru/GetStatusSummary?noticeId={id} → total (context/iletisim-frontend.md "Başvuru Yönetimi").
// (Kullanılmayan ayrı .userbot-config.json okuyucusu kaldırıldı — config: agent-config.js)

module.exports = { trackApplications };
