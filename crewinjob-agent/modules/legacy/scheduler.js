// ─── Zamanlayıcı — Otomatik Görevler ─────────────────────────────────────────
const cron   = require('node-cron');
const path   = require('path');
const fs     = require('fs-extra');

const scraper   = require('../scraper');
const generator = require('../generator');
const formatter = require('../formatter');
const seo       = require('./seo');
const blog      = require('./blog');
const kpi       = require('./kpi');

const OUTPUT_DIR = path.join(__dirname, '..', 'output');

let schedulerActive = false;
const activeJobs    = [];

// ─── Görev: Pazartesi 08:00 — Haftalık ilan özeti ────────────────────────────
async function weeklyJobSummaryTask() {
  console.log('\n⏰ [ZAMANLAYICI] Pazartesi görevi başladı: Haftalık ilan özeti');
  try {
    const jobData = await scraper.getJobData();

    // 1. Sosyal medya içerikleri
    const weeklyDir = path.join(OUTPUT_DIR, 'haftalik_gorev');
    await fs.ensureDir(weeklyDir);

    for (const platform of ['linkedin', 'instagram', 'twitter', 'facebook']) {
      process.stdout.write(`  📡 ${platform} ilan özeti... `);
      const content  = await generator.generateSinglePlatform(platform, 'ilan_ozeti', jobData);
      await formatter.saveSinglePost(platform, 'ilan_ozeti', content, weeklyDir);
      console.log('✅');
      await new Promise(r => setTimeout(r, 800));
    }

    // 2. Yeni ilanlar için SEO meta
    if (jobData.newJobs.length > 0) {
      await seo.generateBulkJobSEO(jobData.newJobs, path.join(weeklyDir, 'seo'));
    }

    // 3. KPI raporu
    await kpi.generateWeeklyReport(jobData, path.join(weeklyDir, 'kpi'));

    console.log(`\n✅ Pazartesi görevi tamamlandı → ${weeklyDir}`);
  } catch (err) {
    console.error('❌ Pazartesi görevi hatası:', err.message);
  }
}

// ─── Görev: Ayın 1'i 09:00 — Aylık blog + KPI paketi ─────────────────────────
async function monthlyBlogTask() {
  console.log('\n⏰ [ZAMANLAYICI] Aylık görev başladı: Blog paketi + KPI');
  try {
    const jobData  = await scraper.getJobData();
    const monthDir = path.join(OUTPUT_DIR, `aylik_${getMonthStr()}`);
    await fs.ensureDir(monthDir);

    // 3 blog makalesi
    await blog.generateMonthlyBlogPack(jobData.stats, path.join(monthDir, 'blog'));

    // Aylık KPI
    await kpi.generateWeeklyReport(jobData, path.join(monthDir, 'kpi'));

    console.log(`\n✅ Aylık görev tamamlandı → ${monthDir}`);
  } catch (err) {
    console.error('❌ Aylık görev hatası:', err.message);
  }
}

// ─── Görev: Her gün 09:00 — Yeni ilan SEO kontrolü ───────────────────────────
async function dailyNewJobsSEOTask() {
  try {
    const jobData = await scraper.getJobData();
    if (jobData.newJobs.length === 0) return;

    console.log(`\n⏰ [ZAMANLAYICI] ${jobData.newJobs.length} yeni ilan için SEO meta üretiliyor`);
    const seoDir = path.join(OUTPUT_DIR, 'daily_seo');
    await seo.generateBulkJobSEO(jobData.newJobs, seoDir);
  } catch (err) {
    console.error('❌ Günlük SEO görevi hatası:', err.message);
  }
}

// ─── Zamanlayıcıları başlat ───────────────────────────────────────────────────
function startScheduler() {
  if (schedulerActive) {
    console.log('  ⚠️  Zamanlayıcı zaten çalışıyor');
    return;
  }

  console.log('\n  ⏰ Zamanlayıcılar başlatılıyor...\n');

  // Pazartesi 08:00 — Haftalık ilan özeti + sosyal medya + KPI
  const j1 = cron.schedule('0 8 * * 1', weeklyJobSummaryTask, {
    timezone: 'Europe/Istanbul'
  });

  // Ayın 1'i 09:00 — Aylık blog + KPI paketi
  const j2 = cron.schedule('0 9 1 * *', monthlyBlogTask, {
    timezone: 'Europe/Istanbul'
  });

  // Her gün 09:00 — Yeni ilanlar için SEO
  const j3 = cron.schedule('0 9 * * *', dailyNewJobsSEOTask, {
    timezone: 'Europe/Istanbul'
  });

  activeJobs.push(j1, j2, j3);
  schedulerActive = true;

  console.log('  ✅ Zamanlayıcılar aktif:\n');
  console.log('     📅 Her Pazartesi 08:00  → Haftalık ilan özeti + sosyal medya + KPI raporu');
  console.log('     📅 Ayın 1\'i 09:00       → Aylık blog paketi (3 makale) + KPI raporu');
  console.log('     📅 Her gün 09:00        → Yeni ilanlar için SEO meta otomatik üretimi');
  console.log('\n  💡 Ajan çalışırken arka planda otomatik çalışır.');
  console.log('     Kapatmak için Ctrl+C\n');
}

// ─── Zamanlayıcıları durdur ───────────────────────────────────────────────────
function stopScheduler() {
  activeJobs.forEach(j => j.destroy());
  activeJobs.length = 0;
  schedulerActive   = false;
  console.log('  ⏹️  Zamanlayıcılar durduruldu');
}

// ─── Manuel tetikleme (test için) ────────────────────────────────────────────
async function runNow(task) {
  const tasks = {
    weekly:  weeklyJobSummaryTask,
    monthly: monthlyBlogTask,
    seo:     dailyNewJobsSEOTask,
  };

  const fn = tasks[task];
  if (!fn) {
    console.log(`  ❌ Geçersiz görev: ${task}`);
    console.log('  Geçerli görevler: weekly, monthly, seo');
    return;
  }

  console.log(`\n  🚀 "${task}" görevi şimdi çalıştırılıyor...`);
  await fn();
}

function getSchedulerStatus() {
  return {
    active: schedulerActive,
    jobs: schedulerActive ? [
      { name: 'Haftalık ilan özeti', schedule: 'Her Pazartesi 08:00' },
      { name: 'Aylık blog paketi',   schedule: 'Ayın 1\'i 09:00' },
      { name: 'Günlük SEO kontrolü', schedule: 'Her gün 09:00' },
    ] : [],
  };
}

function getMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}_${String(d.getMonth()+1).padStart(2,'0')}`;
}

module.exports = {
  startScheduler,
  stopScheduler,
  runNow,
  getSchedulerStatus,
  weeklyJobSummaryTask,
  monthlyBlogTask,
};
