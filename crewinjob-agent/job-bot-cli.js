'use strict';
// CLI wrapper: node job-bot-cli.js <action> [jsonInput]
// Tüm sonuç JSON olarak stdout'a yazılır.
// stdout YALNIZCA sonuç JSON'u içermeli: modül logları (console.log/info, GramJS logger)
// stderr'e yönlendirilir — aksi halde web route JSON.parse edemiyordu.
const util = require('util');
console.log  = (...args) => process.stderr.write(util.format(...args) + '\n');
console.info = console.log;

const action    = process.argv[2] || '';
const inputArg  = process.argv[3] || '{}';
let input;
try { input = JSON.parse(inputArg); } catch { input = {}; }

const bot = require('./modules/job-bot');

async function main() {
  let data;

  if (action === 'positions') {
    data = await bot.fetchPositions();
    process.stdout.write(JSON.stringify({ ok: true, positions: data }));
    return;
  }
  if (action === 'countries') {
    data = await bot.fetchCountries();
    process.stdout.write(JSON.stringify({ ok: true, countries: data }));
    return;
  }
  if (action === 'companies') {
    data = await bot.fetchCompanies();
    process.stdout.write(JSON.stringify({ ok: true, companies: data }));
    return;
  }
  if (action === 'languages') {
    data = await bot.fetchLanguages();
    process.stdout.write(JSON.stringify({ ok: true, languages: data }));
    return;
  }
  if (action === 'certificates') {
    data = await bot.fetchCertificates();
    process.stdout.write(JSON.stringify({ ok: true, certificates: data }));
    return;
  }
  if (action === 'cities') {
    data = await bot.fetchCities(input.countryId);
    process.stdout.write(JSON.stringify({ ok: true, cities: data }));
    return;
  }
  if (action === 'parse_ai') {
    data = await bot.parseJobWithAI(input.text || '');
    process.stdout.write(JSON.stringify({ ok: true, data }));
    return;
  }
  if (action === 'generate_ai') {
    data = await bot.generateJobWithAI(input.hint || '');
    process.stdout.write(JSON.stringify({ ok: true, data }));
    return;
  }
  if (action === 'create_direct') {
    data = await bot.createIlan(input.jobData || {});
    process.stdout.write(JSON.stringify({ ok: true, result: data }));
    return;
  }
  if (action === 'add_to_queue') {
    data = bot.addToQueue(input.jobData || {}, input.source || 'manual');
    process.stdout.write(JSON.stringify({ ok: true, item: data }));
    return;
  }
  if (action === 'approve') {
    data = await bot.approveAndPost(input.id);
    process.stdout.write(JSON.stringify({ ok: true, result: data }));
    return;
  }
  if (action === 'update') {
    data = bot.updateQueueItem(input.id, { data: input.jobData });
    process.stdout.write(JSON.stringify({ ok: true, item: data }));
    return;
  }
  if (action === 'remove') {
    bot.removeFromQueue(input.id);
    process.stdout.write(JSON.stringify({ ok: true }));
    return;
  }
  if (action === 'queue') {
    const queue = bot.readQueue();
    process.stdout.write(JSON.stringify({ ok: true, queue }));
    return;
  }

  // ── Pipeline modülleri ─────────────────────────────────────────────────────
  if (action === 'discover_groups') {
    const { discoverGroups } = require('./modules/group-discovery');
    data = await discoverGroups();
    process.stdout.write(JSON.stringify({ ok: true, found: data.length, groups: data }));
    return;
  }
  if (action === 'join_groups') {
    // Yalnız bir kişinin ekranda seçtiği önerilere katılır (en fazla 10).
    const { joinSelectedGroups } = require('./modules/group-discovery');
    const result = await joinSelectedGroups(input.ids);
    process.stdout.write(JSON.stringify({ ok: true, ...result }));
    return;
  }
  if (action === 'suggested_groups') {
    const { listSuggestions } = require('./modules/group-discovery');
    process.stdout.write(JSON.stringify({ ok: true, groups: listSuggestions() }));
    return;
  }
  if (action === 'dismiss_groups') {
    const { dismissSuggestions } = require('./modules/group-discovery');
    process.stdout.write(JSON.stringify({ ok: true, dismissed: dismissSuggestions(input.ids) }));
    return;
  }
  if (action === 'joined_groups') {
    const { getJoinedGroups } = require('./modules/group-discovery');
    data = await getJoinedGroups();
    process.stdout.write(JSON.stringify({ ok: true, groups: data }));
    return;
  }
  if (action === 'run_pipeline') {
    const { runPipeline } = require('./modules/auto-poster');
    const result = await runPipeline({
      maxJobs: input.maxJobs || 15,
      dryRun:  input.dryRun  || false,
    });
    process.stdout.write(JSON.stringify({ ok: true, result }));
    return;
  }
  if (action === 'broadcast_jobs') {
    const { broadcastNewJobs } = require('./modules/group-broadcaster');
    const sent = await broadcastNewJobs(input.maxJobs || 5, input.maxGroups || 20);
    process.stdout.write(JSON.stringify({ ok: true, sent }));
    return;
  }
  if (action === 'posted_jobs') {
    const { loadPosted } = require('./modules/auto-poster');
    data = loadPosted();
    process.stdout.write(JSON.stringify({ ok: true, jobs: data }));
    return;
  }
  if (action === 'pipeline_logs') {
    const fs   = require('fs');
    const path = require('path');
    const LOG_DIR = path.join(__dirname, 'logs');
    const today   = new Date().toISOString().slice(0, 10);
    const logFile = path.join(LOG_DIR, `pipeline-${today}.log`);
    try {
      const content = fs.readFileSync(logFile, 'utf-8');
      const lines   = content.split('\n').filter(Boolean).slice(-100);
      process.stdout.write(JSON.stringify({ ok: true, lines }));
    } catch {
      process.stdout.write(JSON.stringify({ ok: true, lines: [] }));
    }
    return;
  }

  // ── Feature 1+2: İnceleme kuyruğu ──────────────────────────────────────────
  if (action === 'review_queue') {
    const { loadReviewQueue } = require('./modules/auto-poster');
    const queue = loadReviewQueue().filter(i => i.status === 'pending');
    process.stdout.write(JSON.stringify({ ok: true, queue, total: queue.length }));
    return;
  }
  if (action === 'approve_review') {
    const { approveReview } = require('./modules/auto-poster');
    const result = await approveReview(input.id, input.positionId || null);
    process.stdout.write(JSON.stringify({ ok: true, result }));
    return;
  }
  if (action === 'reject_review') {
    const { rejectReview } = require('./modules/auto-poster');
    rejectReview(input.id);
    process.stdout.write(JSON.stringify({ ok: true }));
    return;
  }

  if (action === 'bulk_reject') {
    const { loadReviewQueue, saveReviewQueue } = require('./modules/auto-poster');
    // Boş/eksik ids → HİÇBİR şey reddedilmez (eskiden boş liste TÜM kuyruğu reddediyordu).
    // Tümünü temizlemek için açıkça 'clear_queue' kullanılmalı.
    const ids = Array.isArray(input.ids) ? input.ids.filter(id => typeof id === 'string' && id) : [];
    if (!ids.length) {
      process.stdout.write(JSON.stringify({ ok: false, error: 'bulk_reject: boş olmayan bir ids listesi gerekli' }));
      return;
    }
    const idSet = new Set(ids);
    const queue = loadReviewQueue();
    let count = 0;
    queue.forEach(i => {
      if (i.status === 'pending' && idSet.has(i.id)) {
        i.status = 'rejected';
        i.rejectedAt = new Date().toISOString();
        count++;
      }
    });
    saveReviewQueue(queue);
    process.stdout.write(JSON.stringify({ ok: true, count }));
    return;
  }

  if (action === 'clear_queue') {
    const { loadReviewQueue, saveReviewQueue } = require('./modules/auto-poster');
    const queue = loadReviewQueue();
    // Yalnızca bekleyenler reddedilir — onaylanmış/yayınlanmış kayıtların durumu ezilmez
    let count = 0;
    queue.forEach(i => {
      if (i.status !== 'pending') return;
      i.status = 'rejected';
      i.rejectedAt = new Date().toISOString();
      count++;
    });
    saveReviewQueue(queue);
    process.stdout.write(JSON.stringify({ ok: true, count }));
    return;
  }

  if (action === 'get_config') {
    const { loadConfig } = require('./modules/auto-poster');
    process.stdout.write(JSON.stringify({ ok: true, config: loadConfig() }));
    return;
  }
  if (action === 'set_config') {
    const { loadConfig, saveConfig } = require('./modules/auto-poster');
    const updated = { ...loadConfig(), ...input };
    saveConfig(updated);
    process.stdout.write(JSON.stringify({ ok: true, config: updated }));
    return;
  }
  if (action === 'api_usage') {
    const { loadUsage } = require('./ai-client');
    process.stdout.write(JSON.stringify({ ok: true, usage: loadUsage() }));
    return;
  }
  if (action === 'job_stats') {
    // posted-jobs.json'daki ilanlar için başvuru sayısını çek (max 10 en yeni)
    const { loadPosted, savePosted } = require('./modules/auto-poster');
    const { fetchIlanApplicationCount } = require('./modules/job-bot');
    const posted = loadPosted();
    const recent = posted.filter(p => p.ilanId).slice(-10).reverse();
    for (const job of recent) {
      try {
        job.applicationCount = await fetchIlanApplicationCount(job.ilanId);
      } catch { job.applicationCount = null; }
    }
    // Güncellenen sayıları geri yaz
    for (const r of recent) {
      const idx = posted.findIndex(p => p.ilanId === r.ilanId);
      if (idx >= 0) posted[idx].applicationCount = r.applicationCount;
    }
    savePosted(posted);
    process.stdout.write(JSON.stringify({ ok: true, jobs: recent }));
    return;
  }

  // ── Feature 3: Grup istatistikleri ──────────────────────────────────────────
  if (action === 'group_stats') {
    const { loadGroupStats } = require('./modules/auto-poster');
    const list = Object.values(loadGroupStats()).sort((a, b) => (b.posted || 0) - (a.posted || 0));
    process.stdout.write(JSON.stringify({ ok: true, stats: list }));
    return;
  }

  // ── Feature 5: Expiry yönetimi ──────────────────────────────────────────────
  if (action === 'manage_expiry') {
    const { manageExpirations } = require('./modules/expiry-manager');
    const result = await manageExpirations();
    process.stdout.write(JSON.stringify({ ok: true, result }));
    return;
  }

  // ── Feature 6: Günlük rapor ─────────────────────────────────────────────────
  if (action === 'send_daily_report') {
    const { sendDailySummary } = require('./modules/daily-reporter');
    const result = await sendDailySummary();
    process.stdout.write(JSON.stringify({ ok: true, result }));
    return;
  }

  // ── Feature 7: Başvuru takibi ───────────────────────────────────────────────
  if (action === 'track_applications') {
    const { trackApplications } = require('./modules/application-tracker');
    const result = await trackApplications(input.maxCheck || 20);
    process.stdout.write(JSON.stringify({ ok: true, result }));
    return;
  }

  // Yeni grup üyelerine kendiliğinden karşılama DM'si gönderme özelliği kaldırıldı (istenmeyen mesaj).

  process.stdout.write(JSON.stringify({ ok: false, error: 'Bilinmeyen action: ' + action }));
}

// Uzun süren işlemler — durum dosyasına yazılır ki web panel tab değişse de görsün
const LONG_ACTIONS = new Set([
  'run_pipeline', 'discover_groups', 'join_groups', 'broadcast_jobs',
  'track_applications', 'manage_expiry',
]);

(async () => {
  const isLong = LONG_ACTIONS.has(action);
  if (isLong) {
    try { require('./modules/auto-poster').setPipelineState(action); } catch {}
  }
  try {
    await main();
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }));
  } finally {
    if (isLong) {
      try { require('./modules/auto-poster').clearPipelineState(); } catch {}
    }
    // GramJS bağlantısı açık kalırsa süreç hiç kapanmıyor (execFile timeout'a kadar asılı kalıyordu).
    // tg-client yalnızca yüklendiyse kapat — Telegram'sız action'larda paketi boşuna yükleme.
    try {
      const tgPath = require.resolve('./modules/tg-client');
      if (require.cache[tgPath]) await require('./modules/tg-client').disconnect();
    } catch {}
    // Güvenlik ağı: başka bir açık handle kalırsa 5 sn sonra çık (unref → normal çıkışı geciktirmez)
    setTimeout(() => process.exit(process.exitCode || 0), 5000).unref();
  }
})();
