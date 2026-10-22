'use strict';
// Pipeline koordinatörü: Telegram mesajları → crewinjob.com ilanı
const fs   = require('fs');
const path = require('path');
const bot  = require('./job-bot');
const { scrapeAllGroups, markProcessed } = require('./message-scraper');
const { writeJsonAtomic } = require('./json-file');

const DATA_DIR        = path.join(__dirname, '..', 'data');
const LOG_DIR         = path.join(__dirname, '..', 'logs');
const POSTED_FILE     = path.join(DATA_DIR, 'posted-jobs.json');
const REVIEW_FILE     = path.join(DATA_DIR, 'review-queue.json');
const GROUP_STATS_FILE = path.join(DATA_DIR, 'group-stats.json');
const STATE_FILE      = path.join(DATA_DIR, 'pipeline-state.json');
const FAILED_FILE     = path.join(DATA_DIR, 'failed-messages.jsonl');
const CONFIG_FILE     = path.join(DATA_DIR, 'agent-config.json');
const DAILY_LIMIT     = 50;

// Telegram'dan toplanan ilanlar Crewinjob Manning (10339) adıyla yayınlandığı için HİÇBİRİ kendiliğinden yayınlanmaz:
// reviewAllItems her zaman true. Her ilan inceleme kuyruğuna düşer ve ancak bir kişinin onayıyla (approveReview) yayınlanır.
const DEFAULT_CONFIG = {
  autoApproveThreshold: 85, // yalnız skor gösterimi; otomatik yayın yok
  qualityThreshold:     65, // skor < bu → kuyrukta "düşük skor" olarak işaretlenir
  reviewAllItems:       true, // sabit: her ilan inceleme kuyruğuna
  alertQueueSize:       20, // bekleyen kuyruk bu sayıyı aşınca Telegram uyarısı
};

// Kayıtlı ayar ne derse desin inceleme zorunlu kalır.
function withMandatoryReview(saved) {
  return { ...DEFAULT_CONFIG, ...(saved && typeof saved === 'object' ? saved : {}), reviewAllItems: true };
}
function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch { saved = {}; }
  return withMandatoryReview(saved);
}
function saveConfig(cfg) {
  writeJsonAtomic(CONFIG_FILE, { ...cfg, reviewAllItems: true });
}

// ── Loglama ───────────────────────────────────────────────────────────────────
function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const logFile = path.join(LOG_DIR, `pipeline-${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(logFile, line + '\n', 'utf-8');
  } catch {}
}

// ── Disk I/O ──────────────────────────────────────────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadPosted() {
  try { return JSON.parse(fs.readFileSync(POSTED_FILE, 'utf-8')); } catch { return []; }
}
function savePosted(jobs) {
  writeJsonAtomic(POSTED_FILE, jobs);
}
// Tek ilanı diskten taze okuyarak güncelle (uzun süren işlemlerde artımlı kayıt;
// eldeki eski tam listeyi yazıp paralel değişiklikleri ezmemek için).
function updatePostedJob(ilanId, mutate) {
  const posted = loadPosted();
  const job = posted.find(p => p.ilanId === ilanId);
  if (!job) return null;
  mutate(job);
  savePosted(posted);
  return job;
}

const REVIEW_RETENTION_DAYS = 30;

function loadReviewQueue() {
  try { return JSON.parse(fs.readFileSync(REVIEW_FILE, 'utf-8')); } catch { return []; }
}
// Kaydederken budama: bekleyen (pending) olmayan ve 30 günden eski kayıtlar silinir
// (dosya 2.7 MB'a ulaşmıştı). Bekleyenlere asla dokunulmaz.
function pruneReviewQueue(items) {
  const cutoff = Date.now() - REVIEW_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return items.filter(i => {
    if (!i || i.status === 'pending') return true;
    const ts = Date.parse(i.rejectedAt || i.approvedAt || i.queuedAt || '');
    return !Number.isFinite(ts) || ts >= cutoff;
  });
}
function saveReviewQueue(items) {
  writeJsonAtomic(REVIEW_FILE, pruneReviewQueue(items));
}

// Format/API sorunu yaşayan ham mesajları biriktir (sonradan analiz + yeni kural için)
function logFailedMessage(msg, reason, jobData = null) {
  ensureDataDir();
  try {
    const line = JSON.stringify({
      at:         new Date().toISOString(),
      reason,
      sourceChat: msg.chatTitle,
      sourceChatId: msg.chatId,
      sourceMessageId: msg.messageId,
      text:       (msg.text || '').slice(0, 1000),
      jobData:    jobData ? {
        positionName: jobData.positionName, positionId: jobData.positionId,
        minPrice: jobData.minPrice, maxPrice: jobData.maxPrice,
        startDate: jobData.startDate, expirationDate: jobData.expirationDate,
      } : null,
    });
    fs.appendFileSync(FAILED_FILE, line + '\n', 'utf-8');
  } catch {}
}

function loadGroupStats() {
  try { return JSON.parse(fs.readFileSync(GROUP_STATS_FILE, 'utf-8')); } catch { return {}; }
}
function saveGroupStats(stats) {
  writeJsonAtomic(GROUP_STATS_FILE, stats);
}

function todayPostedCount(posted) {
  const today = new Date().toISOString().slice(0, 10);
  return posted.filter(p => p.postedAt?.startsWith(today)).length;
}

// ── Pipeline durum dosyası (tab değişse de işlem görünür kalsın) ──────────────
function setPipelineState(action) {
  try {
    writeJsonAtomic(STATE_FILE, {
      running: action, startedAt: new Date().toISOString(), finishedAt: null, lastResult: null, pid: process.pid,
    }, false);
  } catch {}
}
function clearPipelineState(result = null) {
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } catch {}
  try {
    writeJsonAtomic(STATE_FILE, {
      running: null, startedAt: prev.startedAt || null,
      finishedAt: new Date().toISOString(), lastAction: prev.running || null, lastResult: result,
    }, false);
  } catch {}
}
function readPipelineState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { running: null, startedAt: null, finishedAt: null, lastResult: null }; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Feature 1: Parse kalite skoru (0-100) ────────────────────────────────────
function scoreJobData(jobData) {
  let score = 0;
  if (jobData.positionId)                          score += 40; // Kritik
  if (jobData.minPrice || jobData.maxPrice)         score += 20; // Maaş bilgisi
  const expLen = (jobData.explanation || '').length;
  if (expLen > 200)      score += 15;
  else if (expLen > 80)  score += 8;
  if (jobData.countryId)                           score += 10;
  if (jobData.shipTypeId)                          score += 10;
  if (jobData.contractTypeId)                      score += 5;
  return Math.min(score, 100);
}

// ── Feature 3: Grup istatistiği güncelle ─────────────────────────────────────
function updateGroupStat(chatId, chatTitle, field) {
  const stats = loadGroupStats();
  if (!stats[chatId]) {
    stats[chatId] = { chatId, chatTitle, scraped: 0, queued: 0, posted: 0, rejected: 0, qualityRatio: 0 };
  }
  stats[chatId].chatTitle = chatTitle;
  stats[chatId][field]    = (stats[chatId][field] || 0) + 1;
  // Kalite oranı: posted / scraped
  const s = stats[chatId];
  s.qualityRatio = s.scraped > 0 ? +(s.posted / s.scraped).toFixed(3) : 0;
  saveGroupStats(stats);
}

// ── Feature 2: İnceleme kuyruğu ──────────────────────────────────────────────
function addToReviewQueue(msg, jobData, score, flags = {}) {
  const queue = loadReviewQueue();
  queue.push({
    id:                  Date.now().toString() + Math.random().toString(36).slice(2, 5),
    score,
    needsPositionReview: flags.needsPositionReview || false,
    reason:              flags.reason || null,
    sourceChat:          msg.chatTitle,
    sourceChatId:        msg.chatId,
    sourceMessageId:     msg.messageId,
    sourceText:          msg.text.slice(0, 600),
    jobData,
    queuedAt:            new Date().toISOString(),
    status:              'pending',
  });
  saveReviewQueue(queue);
}

async function approveReview(id, positionIdOverride) {
  const queue = loadReviewQueue();
  const item  = queue.find(i => i.id === id && i.status === 'pending');
  if (!item) throw new Error('İtem bulunamadı veya zaten işlendi');

  // Operatör review ekranında manuel pozisyon seçtiyse jobData'ya uygula
  const jobData = { ...item.jobData };
  if (positionIdOverride) {
    jobData.positionId = Number(positionIdOverride);
  }
  if (!jobData.positionId) throw new Error('Yayınlamadan önce bir pozisyon seçilmeli');

  const result = await bot.createIlan(jobData);
  if (!result?.id) throw new Error('createIlan başarısız');

  item.status     = 'approved';
  item.approvedAt = new Date().toISOString();
  saveReviewQueue(queue);

  const posted = loadPosted();
  posted.push({
    ilanId:          result.id,
    ilanUrl:         result.url,
    sourceChat:      item.sourceChat,
    sourceChatId:    item.sourceChatId,
    sourceMessageId: item.sourceMessageId,
    jobData:         jobData,
    postedAt:        new Date().toISOString(),
    approvedFromQueue: true,
    broadcastedAt:   null,
    broadcastedTo:   0,
  });
  savePosted(posted);
  updateGroupStat(item.sourceChatId, item.sourceChat, 'posted');
  log(`[review] ✅ Onaylandı & yayınlandı: ${result.url}`);
  return result;
}

function rejectReview(id) {
  const queue = loadReviewQueue();
  const item  = queue.find(i => i.id === id);
  if (!item) throw new Error('İtem bulunamadı');
  item.status     = 'rejected';
  item.rejectedAt = new Date().toISOString();
  saveReviewQueue(queue);
  updateGroupStat(item.sourceChatId, item.sourceChat, 'rejected');
  log(`[review] ❌ Reddedildi: ${id}`);
}

// ── İçerik imzası (semantik dedup) ────────────────────────────────────────────
// Aynı vacancy farklı sözcüklerle gelse bile aynı imzayı üretir.
// Ayırt edici bilgi yoksa (email de maaş da yok) null döner → dedup uygulanmaz.
function jobSignature(jd) {
  if (!jd) return null;
  const email     = (jd.email || '').toLowerCase().trim();
  const hasSalary = jd.minPrice != null || jd.maxPrice != null;
  if (!email && !hasSalary) return null;
  return [
    jd.positionId ?? '',
    jd.shipTypeId ?? '',
    jd.countryId  ?? '',
    jd.minPrice   ?? '',
    jd.maxPrice   ?? '',
    email,
  ].join('|');
}

// ── Ana pipeline ──────────────────────────────────────────────────────────────
async function runPipeline(options = {}) {
  const { maxJobs = 15, dryRun = false } = options;

  const posted     = loadPosted();
  const todayCount = todayPostedCount(posted);

  if (todayCount >= DAILY_LIMIT) {
    log(`[pipeline] Günlük limit (${DAILY_LIMIT}) doldu, atlanıyor.`);
    return { posted: 0, queued: 0, skipped: 0, errors: 0 };
  }

  const remaining = Math.min(maxJobs, DAILY_LIMIT - todayCount);
  log(`[pipeline] Başlıyor. Bugün: ${todayCount}/${DAILY_LIMIT}, bu turda max: ${remaining}`);

  // Dedup imza seti: son 30 gün yayınlanan + inceleme bekleyen ilanlar
  const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const seenSignatures = new Set();
  for (const p of posted) {
    const t = new Date(p.postedAt || 0).getTime();
    if (t >= recentCutoff) { const s = jobSignature(p.jobData); if (s) seenSignatures.add(s); }
  }
  for (const q of loadReviewQueue()) {
    if (q.status === 'pending') { const s = jobSignature(q.jobData); if (s) seenSignatures.add(s); }
  }

  // Feature 3: Grup kalite sıralaması — yüksek kaliteli gruplar önce işlenir
  const groupStats = loadGroupStats();
  const { messages, processed } = await scrapeAllGroups(80, groupStats);

  let postedCount = 0, queuedCount = 0, skipped = 0, errors = 0, duplicates = 0;
  const processedNow = [];

  const isTurkishText = (t) => /[çğıöşüÇĞİÖŞÜ]/.test(t);

// Regex ön filtre — AI çağrısı yapılmadan önce ilan olmayan mesajları eler
function isLikelyJobPost(text) {
  if (!text || text.length < 60) return false; // çok kısa

  const t = text.toLowerCase();

  // Açıkça ilan olmayan içerikler
  const spam = [
    /join\s+our\s+(channel|group|community)/i,
    /subscribe|abone\s+ol/i,
    /congratulat|tebrik/i,
    /happy\s+(new\s+year|birthday|holiday)/i,
    /\bRIP\b|\brest\s+in\s+peace\b/i,
    /^(hi|hello|dear|merhaba|salutations?)[^a-z]{0,10}$/im,
    /news\s*letter|haber\s*bülten/i,
  ];
  if (spam.some(r => r.test(text))) return false;

  // Denizcilik pozisyon kelimeleri
  const posKeywords = /\b(master|captain|chief\s*(officer|mate|eng)|second\s*(officer|eng|mate)|third\s*(officer|eng)|4th\s*eng|fourth\s*eng|eto|bosun|boatswain|able\s*seaman|\bab\b|\bos\b|oiler|fitter|cook|cadet|motorman|electrician|officer|engineer|mate|pilot|purser|rating|seaman|seafarer|pelaut|kaptan|zabit|makinist|tayfa)\b/i;

  // Ücret / maaş belirteci
  const salaryKeywords = /(\$|usd|eur|rub|gbp|\bsalary\b|\bmaaş\b|\bgaji\b|\bwage\b|\bpay\b|\bcompensation\b|\bincome\b|\busd\s*\d|\d\s*usd|\d{3,})/i;

  // İşe alım fiilleri
  const hiringKeywords = /\b(hiring|vacancy|vacanc|urgent|required|needed|looking\s+for|join\s+(us|our\s+fleet|our\s+team)|we\s+(need|seek|require|are\s+(looking|hiring|seeking))|open\s+position|job\s+offer|iş\s+ilanı|arıyor(uz)?|alınacak|aranıyor|acil|needed|wanted|crew\s+(needed|wanted|required|opening))\b/i;

  return posKeywords.test(text) || (salaryKeywords.test(text) && hiringKeywords.test(text));
}

  for (const msg of messages) {
    if (postedCount >= remaining) break;

    try {
      log(`[pipeline] İşleniyor: "${msg.chatTitle}" → ${msg.text.slice(0, 70).replace(/\n/g, ' ')}…`);
      updateGroupStat(msg.chatId, msg.chatTitle, 'scraped');

      // ── Regex ön filtre — AI çağrısından önce, token tasarrufu ──────────────
      if (!isLikelyJobPost(msg.text)) {
        skipped++;
        processedNow.push(msg);
        try { require('../ai-client').trackFiltered(); } catch {}
        continue;
      }

      // ── Parse ────────────────────────────────────────────────────────────────
      let parseResult;
      try {
        parseResult = await bot.parseJobWithAI(msg.text);
      } catch (e) {
        log(`[pipeline] ⚠️ Parse hatası (AI): ${e.message} — mesaj bir sonraki turda tekrar denenecek`);
        errors++;
        // İşlenmiş sayma — bir sonraki pipeline turunda tekrar denensin
        continue;
      }

      // İlan değil (spam / duyuru / genel içerik)
      if (!parseResult.isJob) {
        log(`[pipeline] İlan değil — atlanıyor`);
        skipped++;
        processedNow.push(msg);
        continue;
      }

      const isTurkish = isTurkishText(msg.text);
      const disclaimer = isTurkish
        ? '\n\n📋 Başvurular değerlendirilerek uygun adaylar işveren ile paylaşılacaktır.'
        : '\n\n📋 Applications will be reviewed and qualified candidates forwarded to the employer.';

      const jobs = parseResult.jobs || [];
      if (jobs.length > 1) log(`[pipeline] Tablo mesajı — ${jobs.length} vacancy bulundu`);

      // ── Her job için ayrı işlem ──────────────────────────────────────────────
      for (const jobData of jobs) {
        if (postedCount >= remaining) break;

        // Zorunlu alanlar
        jobData.companyId   = 10339;
        jobData.companyText = 'Crewinjob Manning';
        jobData.explanation = (jobData.explanation || '').trim() + disclaimer;

        // positionId null → inceleme kuyruğu (sessizce DÜŞÜRME)
        if (!jobData.positionId) {
          const posLabel = jobData.positionName || jobData._positionName || '?';
          log(`[pipeline] ⚠️ Pozisyon eşleşmedi ("${posLabel}") → inceleme kuyruğuna alındı`);
          addToReviewQueue(msg, jobData, 0, {
            needsPositionReview: true,
            reason: `Pozisyon tanımlanamadı: "${posLabel}"`,
          });
          updateGroupStat(msg.chatId, msg.chatTitle, 'queued');
          queuedCount++;
          continue;
        }

        // Semantik dedup: aynı ilan (pozisyon+maaş+email) daha önce işlendi mi?
        const sig = jobSignature(jobData);
        if (sig && seenSignatures.has(sig)) {
          log(`[pipeline] ↩️ Aynı ilan zaten mevcut (${jobData._positionName || jobData.positionId}) — tekrar yayınlanmıyor`);
          duplicates++;
          continue;
        }
        if (sig) seenSignatures.add(sig);

        // Kalite skoru
        const score = scoreJobData(jobData);
        const cfg = loadConfig();
        log(`[pipeline] Kalite skoru: ${score}/100 (eşik: otomatik≥${cfg.autoApproveThreshold}, kuyruk≥${cfg.qualityThreshold}${cfg.reviewAllItems ? ', reviewAll=ON' : ''})`);

        // Katman 1: Yayın öncesi yerel doğrulama
        const check = bot.validateJobData(jobData);
        if (check.warnings.length) log(`[pipeline] ℹ️ Uyarı: ${check.warnings.join(', ')}`);

        if (dryRun) {
          const willReview = cfg.reviewAllItems || score < cfg.autoApproveThreshold;
          const verdict = !check.valid ? `KUYRUK (doğrulama: ${check.errors.join(', ')})`
                        : score < cfg.qualityThreshold ? `KUYRUK (skor<${cfg.qualityThreshold})`
                        : willReview ? `KUYRUK (reviewAll veya skor<${cfg.autoApproveThreshold})`
                        : 'YAYINLA';
          log(`[pipeline] DRY RUN → ${verdict} | Skor:${score} | ${jobData._positionName || jobData.positionId}`);
          if (verdict === 'YAYINLA') postedCount++; else queuedCount++;
          continue;
        }

        // Doğrulama başarısız → inceleme kuyruğu
        if (!check.valid) {
          log(`[pipeline] ⚠️ Doğrulama başarısız (${check.errors.join(', ')}) — inceleme kuyruğuna alındı`);
          addToReviewQueue(msg, jobData, score, { reason: 'Doğrulama: ' + check.errors.join(', ') });
          logFailedMessage(msg, 'validation: ' + check.errors.join(', '), jobData);
          updateGroupStat(msg.chatId, msg.chatTitle, 'queued');
          queuedCount++;
          continue;
        }

        // Düşük kalite eşiği → inceleme kuyruğu
        if (score < cfg.qualityThreshold) {
          log(`[pipeline] ⚠️ Skor düşük (${score}<${cfg.qualityThreshold}) — inceleme kuyruğuna alındı`);
          addToReviewQueue(msg, jobData, score);
          updateGroupStat(msg.chatId, msg.chatTitle, 'queued');
          queuedCount++;
          continue;
        }

        // ReviewAll modu veya oto-onay eşiği altında → inceleme kuyruğu
        if (cfg.reviewAllItems || score < cfg.autoApproveThreshold) {
          log(`[pipeline] ℹ️ İnceleme kuyruğuna alındı (${cfg.reviewAllItems ? 'reviewAll' : `skor ${score}<${cfg.autoApproveThreshold}`})`);
          addToReviewQueue(msg, jobData, score);
          updateGroupStat(msg.chatId, msg.chatTitle, 'queued');
          queuedCount++;
          continue;
        }

        // Katman 2: Yayınla — API reddederse KAYBETME, kuyruğa al
        let result;
        try {
          result = await bot.createIlan(jobData);
        } catch (e) {
          const apiErr = e.message?.slice(0, 200) || 'bilinmeyen';
          log(`[pipeline] ⚠️ API reddetti (${apiErr}) — inceleme kuyruğuna alındı`);
          addToReviewQueue(msg, jobData, score, { reason: 'API hatası: ' + apiErr });
          logFailedMessage(msg, 'api: ' + apiErr, jobData);
          updateGroupStat(msg.chatId, msg.chatTitle, 'queued');
          queuedCount++;
          continue;
        }

        if (result?.id) {
          log(`[pipeline] ✅ Yayınlandı (skor:${score}): ${result.url}`);
          posted.push({
            ilanId:          result.id,
            ilanUrl:         result.url,
            sourceChat:      msg.chatTitle,
            sourceChatId:    msg.chatId,
            sourceMessageId: msg.messageId,
            qualityScore:    score,
            jobData,
            postedAt:        new Date().toISOString(),
            broadcastedAt:   null,
            broadcastedTo:   0,
          });
          savePosted(posted);
          updateGroupStat(msg.chatId, msg.chatTitle, 'posted');
          postedCount++;

          // Auto-reply kaynak mesaja
          try {
            const { replyToSource } = require('./group-broadcaster');
            await replyToSource(msg, result.url, isTurkish);
          } catch (e) {
            log(`[pipeline] Auto-reply hatası: ${e.message}`);
          }
        } else {
          log(`[pipeline] ⚠️ createIlan ID döndürmedi — inceleme kuyruğuna alındı`);
          addToReviewQueue(msg, jobData, score, { reason: 'createIlan ID döndürmedi' });
          logFailedMessage(msg, 'no-id-returned', jobData);
          queuedCount++;
        }

        // İlanlar arası bekleme (çok-pozisyonlu mesajda kısa, tekil mesajda uzun)
        if (jobs.length > 1) await sleep(5000);
        else await sleep(30000);
      }

      processedNow.push(msg);
      // Mesajlar arası bekleme (çok-pozisyonlu mesaj zaten iç döngüde bekledi)
      if (jobs.length <= 1) { /* bekleme zaten yukarıda */ }

    } catch (e) {
      log(`[pipeline] ❌ Beklenmeyen hata: ${e.message}`);
      errors++;
      processedNow.push(msg);
    }
  }

  markProcessed(processedNow, processed);
  log(`[pipeline] Tamamlandı — Yayınlandı: ${postedCount} | Kuyruğa: ${queuedCount} | Tekrar: ${duplicates} | Atlandı: ${skipped} | Hata: ${errors}`);
  return { posted: postedCount, queued: queuedCount, duplicates, skipped, errors };
}

module.exports = {
  runPipeline,
  loadPosted, savePosted, updatePostedJob,
  loadReviewQueue, saveReviewQueue, pruneReviewQueue,
  addToReviewQueue,
  withMandatoryReview,
  approveReview, rejectReview,
  loadGroupStats,
  scoreJobData,
  updateGroupStat,
  setPipelineState, clearPipelineState, readPipelineState,
  loadConfig, saveConfig,
  log,
};
