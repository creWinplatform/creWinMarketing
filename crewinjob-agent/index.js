#!/usr/bin/env node
// ─── crewinjob Marketing Agent — TAM SİSTEM v4 ──────────────────────────────
require('dotenv').config();
const readline = require('readline');
const path     = require('path');
const fs       = require('fs-extra');

const config         = require('./config');
const scraper        = require('./scraper');
const generator      = require('./generator');
const formatter      = require('./formatter');
const seo            = require('./modules/seo');
const blog           = require('./modules/blog');
const kpi            = require('./modules/kpi');
const scheduler      = require('./modules/scheduler');
const seafarerGrowth = require('./modules/seafarer-growth');
const seafarerKPI    = require('./modules/seafarer-kpi');
const api            = require('./modules/api');
const performance    = require('./modules/performance');
const retention      = require('./modules/retention');

const OUTPUT_DIR = path.join(__dirname, 'output');

const bold   = t => `\x1b[1m${t}\x1b[0m`;
const blue   = t => `\x1b[34m${t}\x1b[0m`;
const cyan   = t => `\x1b[36m${t}\x1b[0m`;
const green  = t => `\x1b[32m${t}\x1b[0m`;
const yellow = t => `\x1b[33m${t}\x1b[0m`;
const gray   = t => `\x1b[90m${t}\x1b[0m`;
const red    = t => `\x1b[31m${t}\x1b[0m`;
const orange = t => `\x1b[33m${t}\x1b[0m`;

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
}

function printBanner(apiData) {
  console.clear();
  const isReal = apiData?.isRealData;
  const dataIcon = isReal ? green('● Gerçek API') : orange('◐ Mock Veri');

  console.log('\n' + blue('╔' + '═'.repeat(58) + '╗'));
  console.log(blue('║') + bold('          ⚓  crewinjob Marketing Agent           ') + '  ' + blue('║'));
  console.log(blue('║') + gray('          The Right Job, The Right Talent         ') + '  ' + blue('║'));
  console.log(blue('╠' + '═'.repeat(58) + '╣'));

  if (apiData) {
    const s = apiData.seafarers;
    const j = apiData.jobs;
    console.log(blue('║') + `  👥 ${bold(s.total.toLocaleString())} seafarer  |  📋 ${bold(j.total)} ilan  |  📊 ${bold('%'+s.profileCompletion)} profil  ` + blue('║'));
    console.log(blue('║') + `  📈 Bu hafta +${bold(s.newThisWeek)} yeni  |  ⚠️  ${bold(s.incompleteProfiles.toLocaleString())} yarım profil  |  ${dataIcon}  ` + blue('║'));
  }

  console.log(blue('╚' + '═'.repeat(58) + '╝') + '\n');
}

function printMenu(schedulerStatus) {
  const s = schedulerStatus.active ? green('● AKTİF') : gray('○ pasif');

  console.log(bold('  ─── 🎯 SEAFARER BÜYÜME (ÖNCELİK) ─────────────────────'));
  console.log(`  ${cyan('1')}  Facebook grup mesajları         ${gray('(10 grup, kayıt odaklı)')}`);
  console.log(`  ${cyan('2')}  Kayıt odaklı içerik üret        ${gray('(tüm platformlar, 3 ton)')}`);
  console.log(`  ${cyan('3')}  TikTok — "Profil Oluştur" CTA   ${gray('(5 script tipi)')}`);
  console.log(`  ${cyan('4')}  Seafarer büyüme dashboard        ${gray('(Excel + hedef takibi)')}`);

  console.log('\n' + bold('  ─── 🔄 RETENTİON (Yarım Profiller) ────────────────'));
  console.log(`  ${cyan('5')}  Profili yarım bırakanlar         ${gray('(segment analizi + içerik)')}`);
  console.log(`  ${cyan('6')}  Re-engagement içerik paketi      ${gray('(4 segment × 3 mesaj)')}`);

  console.log('\n' + bold('  ─── 📱 SOSYAL MEDYA ────────────────────────────────'));
  console.log(`  ${cyan('7')}  Haftalık sosyal medya takvimi   ${gray('(5 platform, 7 gün)')}`);
  console.log(`  ${cyan('8')}  Tek platform içerik`);
  console.log(`  ${cyan('9')}  Hızlı ilan paylaşımı            ${gray('(mevcut ilanlardan)')}`);

  console.log('\n' + bold('  ─── 🔍 SEO & BLOG ──────────────────────────────────'));
  console.log(`  ${cyan('G')}  Google SEO menüsü           ${gray('(teknik, keyword, rakip, backlink)')}`);
  console.log(`  ${cyan('10')} İlan SEO meta üretimi`);
  console.log(`  ${cyan('11')} Blog makale taslağı`);
  console.log(`  ${cyan('12')} Aylık blog paketi               ${gray('(3 makale)')}`);

  console.log('\n' + bold('  ─── 📊 RAPORLAMA & TAKİP ───────────────────────────'));
  console.log(`  ${cyan('13')} Performans raporu + UTM linkleri ${gray('(geri bildirim döngüsü)')}`);
  console.log(`  ${cyan('14')} Performans verisi gir            ${gray('(paylaşım sonuçları)')}`);
  console.log(`  ${cyan('15')} Genel KPI raporu                 ${gray('(Excel + AI analizi)')}`);
  console.log(`  ${cyan('16')} Zamanlayıcı                      ${s}`);

  console.log('\n' + bold('  ─── DİĞER ──────────────────────────────────────────'));
  console.log(`  ${cyan('17')} Dosyaları listele`);
  console.log(`  ${cyan('0')}  Çıkış\n`);
}

// ══════════════════════════════════════════════════════════
// SEAFARER BÜYÜME FONKSİYONLARI
// ══════════════════════════════════════════════════════════

async function fbGroupMessages(apiData) {
  console.log('\n' + bold('👥 Facebook Grup Mesajları'));
  console.log(gray('  10 farklı gruba özelleştirilmiş mesajlar\n'));
  console.log(gray('  Hafta 1-2: İsınma (platform linki yok)'));
  console.log(gray('  Hafta 3-4: Aktif tanıtım (kayıt daveti)\n'));
  const weekNum = parseInt(await ask(yellow('  Kaçıncı hafta? (1-4): '))) || 1;
  const dir = path.join(OUTPUT_DIR, 'seafarer_growth', 'facebook');
  await seafarerGrowth.generateFBGroupPack(apiData.stats, weekNum, dir);
}

async function registrationContent(apiData) {
  console.log('\n' + bold('🎯 Kayıt Odaklı İçerik'));
  console.log(gray('  3 farklı ton: acı noktası, fayda, sosyal kanıt\n'));
  const platforms = ['instagram','facebook','twitter','linkedin'];
  platforms.forEach((p,i) => console.log(`  ${cyan(i+1)}  ${p.toUpperCase()}`));
  console.log(`  ${cyan('5')}  Tüm platformlar`);
  const c    = await ask(yellow('\n  Seçim (1-5): '));
  const pls  = c === '5' ? platforms : [platforms[parseInt(c)-1] || platforms[0]];
  const dir  = path.join(OUTPUT_DIR, 'seafarer_growth', 'registration');
  await fs.ensureDir(dir);
  for (const p of pls) {
    process.stdout.write(gray(`\n  ${p.toUpperCase()}... `));
    try {
      const content = await seafarerGrowth.generateRegistrationContent(p, apiData.stats);
      await formatter.saveSinglePost(p, 'kayit_odakli', content, dir);
      console.log(green('✅'));
    } catch(e) { console.log(red('❌ '+e.message)); }
    await new Promise(r => setTimeout(r, 800));
  }
  console.log(green(`\n  ✅ → ${dir}`));
}

async function registrationTikTok(apiData) {
  console.log('\n' + bold('🎵 TikTok — Seafarer Kayıt CTA'));
  const types = [
    ['problem_solution', '⚡ Problem → Çözüm       (en etkili)'],
    ['day_in_life',      '🌊 Denizci Günlüğü'],
    ['reveal',           '🎭 "Bunu bilmiyorsan kayıp ediyorsun"'],
    ['stats_shock',      '📊 İstatistik Şok'],
    ['testimonial',      '🌟 Başarı Hikayesi'],
  ];
  console.log('');
  types.forEach(([k,v], i) => console.log(`  ${cyan(i+1)}  ${v}`));
  const c    = await ask(yellow('\n  Seçim (1-5): '));
  const type = (types[parseInt(c)-1] || types[0])[0];
  process.stdout.write(gray('\n  🎬 Script üretiliyor... '));
  const content  = await seafarerGrowth.generateRegistrationTikTok(type, apiData.stats);
  const dir      = path.join(OUTPUT_DIR, 'seafarer_growth', 'tiktok');
  const filepath = await formatter.saveSinglePost('tiktok', type, content, dir);
  console.log(green('✅\n'));
  console.log('─'.repeat(62));
  console.log(content);
  console.log('─'.repeat(62));
  console.log(gray(`\n  📁 ${path.relative(process.cwd(), filepath)}`));
}

async function seafarerDashboard(apiData) {
  console.log('\n' + bold('📊 Seafarer Büyüme Dashboard'));
  const dir    = path.join(OUTPUT_DIR, 'seafarer_growth', 'kpi');
  const result = await seafarerKPI.generateSeafarerGrowthReport(apiData, dir);
  console.log('\n' + '─'.repeat(62));
  console.log(result.analysis);
  console.log('─'.repeat(62));
  console.log(green(`\n  ✅ Excel: ${path.basename(result.excelPath)}`));
}

// ══════════════════════════════════════════════════════════
// RETENTİON FONKSİYONLARI
// ══════════════════════════════════════════════════════════

async function retentionAnalysis(apiData) {
  console.log('\n' + bold('🔄 Profili Yarım Bırakan Seafarerlar'));

  const incomplete = apiData.incomplete;
  const total      = incomplete.total;

  console.log(`\n  ${red('⚠️')}  ${bold(total.toLocaleString())} seafarer profili yarım bıraktı\n`);
  console.log('  Segment analizi:\n');

  incomplete.segments.forEach((s, i) => {
    const msg = retention.RETENTION_MESSAGES[s.missingField];
    if (!msg) return;
    const urgencyColor = msg.urgency === 'YÜKSEK' ? red : msg.urgency === 'ORTA' ? yellow : gray;
    console.log(`  ${cyan(i+1)}  ${bold(msg.label.padEnd(30))} ${bold(s.count.toLocaleString().padStart(6))} kişi  ${urgencyColor(msg.urgency)}`);
    console.log(gray(`       ${msg.why}`));
    console.log('');
  });

  const c = await ask(yellow('  Hangi segment için içerik üretilsin? (1-5, "hepsi", "atla"): '));
  if (c === 'atla') return;

  const dir = path.join(OUTPUT_DIR, 'retention');
  if (c === 'hepsi') {
    await retention.generateRetentionPack(incomplete, apiData.stats, dir);
  } else {
    const seg = incomplete.segments[parseInt(c)-1];
    if (!seg) { console.log(red('  Geçersiz seçim')); return; }
    process.stdout.write(gray(`\n  🤖 ${seg.missingField} için içerik üretiliyor... `));
    const content  = await retention.generateRetentionContent(seg, apiData.stats);
    const filepath = await formatter.saveSinglePost('retention', seg.missingField, content, dir);
    console.log(green('✅'));
    console.log('\n' + '─'.repeat(62));
    console.log(content);
    console.log('─'.repeat(62));
  }
}

async function retentionPack(apiData) {
  console.log('\n' + bold('🔄 Tam Retention Paketi'));
  console.log(gray('  4 segment × sosyal medya + direkt mesaj şablonları\n'));
  if ((await ask(yellow('  Başlansın mı? (e/h): '))).toLowerCase() !== 'e') return;
  const dir = path.join(OUTPUT_DIR, 'retention');
  await retention.generateRetentionPack(apiData.incomplete, apiData.stats, dir);
}

// ══════════════════════════════════════════════════════════
// SOSYAL MEDYA FONKSİYONLARI
// ══════════════════════════════════════════════════════════

async function weeklyCalendar(apiData) {
  console.log('\n' + bold('📅 Haftalık Sosyal Medya Takvimi'));
  console.log(gray('  5 platform × 7 gün  |  ~3-5 dakika\n'));
  if ((await ask(yellow('  Başlansın mı? (e/h): '))).toLowerCase() !== 'e') return;
  const jobData = { ...apiData, jobs: [], newJobs: [] };
  const weekly  = await generator.generateWeeklyContent(jobData);
  const dir     = await formatter.saveWeeklyCalendar(weekly, OUTPUT_DIR);
  console.log(green(`\n  ✅ → ${dir}`));
}

async function singlePlatform(apiData) {
  const platforms = ['instagram','facebook','twitter','linkedin','tiktok'];
  const emojis    = {instagram:'📸',facebook:'👥',twitter:'🐦',linkedin:'💼',tiktok:'🎵'};
  console.log('\n' + bold('  Platform:'));
  platforms.forEach((p,i) => console.log(`  ${cyan(i+1)}  ${emojis[p]} ${p.toUpperCase()}`));
  const p = platforms[parseInt(await ask(yellow('\n  Seçim (1-5): '))) - 1];
  if (!p) return;
  const types = config.platforms[p]?.contentTypes || ['ilan_ozeti','kariyer_ipucu'];
  console.log('\n' + bold('  Tür:'));
  types.forEach((t,i) => console.log(`  ${cyan(i+1)}  ${t.replace(/_/g,' ')}`));
  const type = types[parseInt(await ask(yellow('\n  Tür: '))) - 1] || types[0];
  process.stdout.write(gray(`\n  🤖 Üretiliyor... `));
  const jobData  = { ...apiData, jobs: [], newJobs: [] };
  const content  = await generator.generateSinglePlatform(p, type, jobData);
  const filepath = await formatter.saveSinglePost(p, type, content, OUTPUT_DIR);
  console.log(green('✅\n'));
  console.log('─'.repeat(62));
  console.log(content);
  console.log('─'.repeat(62));
  console.log(gray(`\n  📁 ${path.relative(process.cwd(), filepath)}`));
}

async function quickJobPost(apiData) {
  const jobs = apiData.jobs.newJobs || [];
  if (!jobs.length) {
    console.log(yellow('\n  Yeni ilan bulunamadı. API bağlantısı gerekebilir.'));
    return;
  }
  console.log('\n' + bold('🚀 Hızlı İlan Paylaşımı'));
  jobs.forEach((j,i) => console.log(`  ${cyan(i+1)}  ${bold(j.title)} — ${j.vesselType} — ${j.salary}`));
  const c    = await ask(yellow('\n  İlan: '));
  const sel  = c.toLowerCase() === 'hepsi' ? jobs : [jobs[parseInt(c)-1] || jobs[0]];
  console.log('  1) Tüm platformlar  2) LinkedIn+Instagram  3) Twitter');
  const pc   = await ask(yellow('  Platform: '));
  const pls  = pc==='3'?['twitter']:pc==='2'?['linkedin','instagram']:['instagram','facebook','twitter','linkedin','tiktok'];
  for (const p of pls) {
    process.stdout.write(gray(`\n  ${p.toUpperCase()}... `));
    try {
      const data    = { ...apiData, stats: apiData.stats, jobs: sel, newJobs: sel };
      const content = await generator.generateSinglePlatform(p, 'ilan_ozeti', data);
      await formatter.saveSinglePost(p, 'ilan_ozeti', content, OUTPUT_DIR);
      console.log(green('✅'));
    } catch(e) { console.log(red('❌ '+e.message)); }
    await new Promise(r => setTimeout(r, 800));
  }
}

// ══════════════════════════════════════════════════════════
// SEO & BLOG
// ══════════════════════════════════════════════════════════

async function jobSEO(apiData) {
  const jobs = apiData.jobs.active > 0
    ? Array(Math.min(5, apiData.jobs.active)).fill(null).map((_,i) => ({
        id: i+1, title: Object.keys(apiData.jobs.byRank||{})[i] || 'Chief Officer',
        vesselType: Object.keys(apiData.jobs.byVesselType||{})[0] || 'Bulk Carrier',
        salary: '$5,000-7,000/mo', location: 'Worldwide',
      }))
    : [{id:1,title:'Chief Officer',vesselType:'Bulk Carrier',salary:'$6,500/mo',location:'Worldwide'}];

  console.log(`\n  ${jobs.length} ilan için SEO meta üretiliyor...`);
  await seo.generateBulkJobSEO(jobs, path.join(OUTPUT_DIR, 'seo'));
}

async function singleBlog(apiData) {
  const topic     = await ask(yellow('\n  Blog konusu (boş = öneri listesinden): '));
  const topicData = topic ? {topic, keyword:topic.toLowerCase(), priority:'manual'} : blog.MONTHLY_BLOG_TOPICS[0];
  const content   = await blog.generateBlogArticle(topicData, apiData.stats);
  const filepath  = await formatter.saveSinglePost('blog', topicData.keyword.slice(0,30), content, path.join(OUTPUT_DIR,'blog'));
  console.log(green(`\n  ✅ ${filepath}`));
}

async function monthlyBlogPack(apiData) {
  console.log('\n' + bold('📚 Aylık Blog Paketi (3 makale, ~10 dk)'));
  if ((await ask(yellow('  Başlansın mı? (e/h): '))).toLowerCase() !== 'e') return;
  await blog.generateMonthlyBlogPack(apiData.stats, path.join(OUTPUT_DIR, 'blog'));
}

// ══════════════════════════════════════════════════════════
// RAPORLAMA & TAKİP
// ══════════════════════════════════════════════════════════

async function performanceReport(apiData) {
  console.log('\n' + bold('📈 Performans Raporu + UTM Linkleri'));
  console.log(gray('  Geçmiş içerik verilerini analiz eder, bu hafta için UTM linkler üretir\n'));

  let ga4Data = performance.getMockGA4Data ? null : null;
  const credsFile = path.join(__dirname, 'google-credentials.json');
  const ga4Id     = process.env.GA4_PROPERTY_ID;

  if (await fs.pathExists(credsFile) && ga4Id) {
    const creds = await fs.readJSON(credsFile);
    ga4Data = await performance.fetchGA4Data(creds, ga4Id);
  } else {
    console.log(gray('  ⚠️  GA4 bağlantısı yok — mock veri ile devam\n'));
    ga4Data = { period:'Son 7 gün', overview:{sessions:0,totalUsers:0,newUsers:0,bounceRate:'0%',avgSessionDur:'0:00'}, channels:[], topPages:[], utmSources:[], source:'mock' };
  }

  const dir    = path.join(OUTPUT_DIR, 'performance');
  const result = await performance.generatePerformanceReport(apiData, ga4Data, dir);

  console.log('\n' + '─'.repeat(62));
  console.log(result.insights);
  console.log('─'.repeat(62));
  console.log(green(`\n  ✅ Rapor: ${path.basename(result.filepath)}`));
  console.log('\n  📎 Bu haftanın UTM linkleri:');
  result.utmLinks.slice(0,5).forEach(u => console.log(gray(`     ${u.platform}: ${u.link}`)));
}

async function logPerformance() {
  console.log('\n' + bold('📊 Performans Verisi Gir'));
  console.log(gray('  Paylaşım yaptıktan sonra sonuçları kaydet → ajan öğrenir\n'));

  const platforms = ['instagram','facebook','twitter','linkedin','tiktok'];
  platforms.forEach((p,i) => console.log(`  ${cyan(i+1)}  ${p}`));
  const p    = platforms[parseInt(await ask(yellow('\n  Platform (1-5): '))) - 1] || 'instagram';
  const type = await ask(yellow('  İçerik türü (ör: kayit_odakli, ilan_ozeti): '));
  const reach    = await ask(yellow('  Ulaşım/Görüntülenme: '));
  const clicks   = await ask(yellow('  Tıklama sayısı: '));
  const signups  = await ask(yellow('  Bu içerikten gelen kayıt (UTM ile): '));
  const notes    = await ask(yellow('  Not (opsiyonel): '));

  await performance.saveContentPerformance({
    platform: p, type, date: new Date().toISOString().slice(0,10),
    reach: parseInt(reach)||0, clicks: parseInt(clicks)||0,
    signups: parseInt(signups)||0, notes,
  });

  console.log(green('\n  ✅ Kaydedildi — Ajan bir sonraki içerikte bu veriyi kullanacak'));
}

async function kpiReport(apiData) {
  console.log('\n' + bold('📊 Genel KPI Raporu'));
  let creds = null;
  const gsFile = path.join(__dirname, 'google-credentials.json');
  if (await fs.pathExists(gsFile)) {
    creds = await fs.readJSON(gsFile);
    console.log(green('  ✅ Google Search Console bağlı'));
  }
  const jobData  = { stats: apiData.stats, jobs: [], newJobs: [] };
  const result   = await kpi.generateWeeklyReport(jobData, path.join(OUTPUT_DIR,'kpi'), creds);
  console.log('\n' + '─'.repeat(62));
  console.log(result.analysis);
  console.log('─'.repeat(62));
  console.log(green(`\n  ✅ Excel: ${path.basename(result.excelPath)}`));
}

async function manageScheduler() {
  const s = scheduler.getSchedulerStatus();
  if (s.active) {
    if ((await ask(yellow('\n  Zamanlayıcı aktif. Durdurulsun mu? (e/h): '))).toLowerCase() === 'e')
      scheduler.stopScheduler();
  } else {
    console.log(gray('\n  • Her Pazartesi 08:00 → Haftalık içerik + SEO + KPI'));
    console.log(gray('  • Ayın 1\'i 09:00      → Aylık blog paketi (3 makale)'));
    console.log(gray('  • Her gün 09:00       → Yeni ilan SEO meta'));
    if ((await ask(yellow('\n  Başlatılsın mı? (e/h): '))).toLowerCase() === 'e')
      scheduler.startScheduler();
  }
}

async function listOutputs() {
  await fs.ensureDir(OUTPUT_DIR);
  const items = await fs.readdir(OUTPUT_DIR).catch(() => []);
  if (!items.length) { console.log(yellow('\n  Henüz içerik üretilmedi.')); return; }
  console.log(bold('\n  📁 Üretilen içerikler:\n'));
  for (const item of items.filter(i => !i.startsWith('.'))) {
    const stat = await fs.stat(path.join(OUTPUT_DIR, item)).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      const files = await fs.readdir(path.join(OUTPUT_DIR, item)).catch(() => []);
      console.log(`  ${cyan('📂')} ${bold(item)} ${gray('('+files.length+' dosya)')}`);
      files.slice(0,3).forEach(f => console.log(gray('       └─ '+f)));
      if (files.length > 3) console.log(gray('       └─ ... ve '+(files.length-3)+' daha'));
    } else {
      console.log(`  ${cyan('📄')} ${item}`);
    }
  }
  console.log(gray(`\n  Klasör: ${OUTPUT_DIR}`));
}

// ══════════════════════════════════════════════════════════
// ANA DÖNGÜ
// ══════════════════════════════════════════════════════════

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.log(red('\n  ❌ GEMINI_API_KEY bulunamadı!'));
    console.log(yellow('  .env dosyasına ekleyin: GEMINI_API_KEY=AIza...\n'));
    process.exit(1);
  }

  console.log('\n  📡 Veriler yükleniyor...');
  const apiData = await api.fetchAllData();

  // Eski scraper formatıyla uyumluluk
  apiData.stats = {
    seafarers:  String(apiData.seafarers.total),
    jobs:       String(apiData.jobs.total),
    businesses: '50+',
  };
  apiData.newJobs = [];

  printBanner(apiData);

  while (true) {
    printMenu(scheduler.getSchedulerStatus());
    switch (await ask(yellow('  Seçiminiz: '))) {
      case '1':  await fbGroupMessages(apiData);     break;
      case '2':  await registrationContent(apiData); break;
      case '3':  await registrationTikTok(apiData);  break;
      case '4':  await seafarerDashboard(apiData);   break;
      case '5':  await retentionAnalysis(apiData);   break;
      case '6':  await retentionPack(apiData);       break;
      case '7':  await weeklyCalendar(apiData);      break;
      case '8':  await singlePlatform(apiData);      break;
      case '9':  await quickJobPost(apiData);        break;
      case '10': await jobSEO(apiData);              break;
      case '11': await singleBlog(apiData);          break;
      case '12': await monthlyBlogPack(apiData);     break;
      case '13': await performanceReport(apiData);   break;
      case '14': await logPerformance();             break;
      case '15': await kpiReport(apiData);           break;
      case '16': await manageScheduler();            break;
      case '17': await listOutputs();                break;
      case '0':
        console.log(green('\n  ⚓ Görüşürüz!\n'));
        process.exit(0);
      default: console.log(red('  Geçersiz seçim'));
    }
  }
}

main().catch(err => {
  console.error(red('\n  ❌ ' + err.message));
  process.exit(1);
});

// ══════════════════════════════════════════════════════════
// GOOGLE SEO FONKSİYONLARI (sonradan eklendi)
// ══════════════════════════════════════════════════════════

// Modülleri yükle
let seoTech, seoKeywords;
try {
  seoTech     = require('./modules/seo-technical');
  seoKeywords = require('./modules/seo-keywords');
} catch(e) {}

async function seoMenu(apiData) {
  const creds   = await loadCreds();
  const jobStats = { jobs: apiData.jobs.total, seafarers: apiData.seafarers.total };

  console.log('\n' + bold('  ─── 🔍 Google SEO ──────────────────────────────'));
  console.log(`  ${cyan('a')}  Teknik SEO       ${gray('(Core Web Vitals, indexleme, crawl)')}`);
  console.log(`  ${cyan('b')}  Keyword analizi  ${gray('(sıralamalar, quick wins, rakipler)')}`);
  console.log(`  ${cyan('c')}  Tam SEO raporu   ${gray('(hepsi bir arada)')}`);
  console.log(`  ${cyan('d')}  Backlink fırsatları`);
  console.log(`  ${cyan('0')}  Geri\n`);

  const c = await ask(yellow('  Seçim: '));
  const dir = path.join(OUTPUT_DIR, 'seo_google');

  switch(c) {
    case 'a': {
      const result = await seoTech.generateTechnicalSEOReport(creds, dir);
      console.log('\n' + '─'.repeat(62));
      result.vitalsResults.forEach(v => {
        const pg = v.performanceScore;
        const icon = !pg ? '❓' : pg >= 90 ? '✅' : pg >= 50 ? '⚠️' : '❌';
        console.log(`  ${icon} ${v.url.replace('https://crewinjob.com','')||'/'} — ${pg ? pg+'/100' : v.error || 'N/A'}`);
        if (v.opportunities?.length) {
          v.opportunities.slice(0,2).forEach(o => console.log(gray(`     └─ ${o.title}: ${o.impact}`)));
        }
      });
      console.log('─'.repeat(62));
      console.log(green(`\n  ✅ Rapor: ${path.basename(result.filepath)}`));
      break;
    }
    case 'b': {
      console.log('\n  📊 Keyword sıralamaları + rakip analizi + AI strateji...');
      const rankings    = await seoKeywords.getKeywordRankings(creds);
      const competitors = await Promise.all(seoKeywords.COMPETITORS.slice(0,3).map(c => seoKeywords.analyzeCompetitor(c)));
      const strategy    = await seoKeywords.generateKeywordStrategy(rankings, competitors, jobStats);
      console.log('\n' + '─'.repeat(62));
      console.log(bold('  Keyword Sıralamaları (Top 10):'));
      rankings.rankings.slice(0,10).forEach(r =>
        console.log(`  ${r.status} ${r.keyword.padEnd(35)} Pos: ${String(r.position).padStart(5)}  Tıklama: ${r.clicks}`)
      );
      console.log('\n' + bold('  AI Strateji:'));
      console.log(strategy);
      console.log('─'.repeat(62));

      await fs.ensureDir(dir);
      const fp = path.join(dir, `keyword_analiz_${new Date().toISOString().slice(0,10)}.md`);
      await fs.writeFile(fp, `# Keyword Analizi\n\n## AI Strateji\n${strategy}\n\n## Sıralamalar\n\n${rankings.rankings.map(r=>`- ${r.keyword}: Pos ${r.position} | ${r.clicks} tıklama`).join('\n')}`);
      console.log(green(`\n  ✅ Kaydedildi: ${fp}`));
      break;
    }
    case 'c': {
      const result = await seoKeywords.generateFullSEOReport(creds, jobStats, dir);
      console.log('\n' + '─'.repeat(62));
      console.log(result.strategy);
      console.log('─'.repeat(62));
      await seoTech.generateTechnicalSEOReport(creds, dir);
      console.log(green(`\n  ✅ Tam SEO raporu → ${dir}`));
      break;
    }
    case 'd': {
      const backlinks = await seoKeywords.trackBacklinks();
      console.log('\n' + bold('  🔗 Backlink Durumu'));
      console.log(yellow('\n  ' + backlinks.note));
      console.log('\n' + bold('  Ücretsiz kontrol linkleri:'));
      backlinks.manualCheck.forEach(u => console.log(gray('  ' + u)));
      console.log('\n' + bold('  Backlink kazanma fırsatları:'));
      backlinks.earningOpportunities.forEach(o => console.log(`  • ${o}`));
      break;
    }
  }
}

async function loadCreds() {
  const gsFile = path.join(__dirname, 'google-credentials.json');
  if (await fs.pathExists(gsFile)) return await fs.readJSON(gsFile);
  return null;
}
