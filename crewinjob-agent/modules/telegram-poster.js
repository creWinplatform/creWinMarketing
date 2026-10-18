'use strict';
// Config: process.env > .userbot-config.json > .env — bkz. agent-config.js
// (api.js / job-bot.js env'i yükleme anında okuduğu için bu satır onlardan ÖNCE çalışmalı)
require('./agent-config').loadAgentConfig();
const cron = require('node-cron');

const CHANNEL  =  process.env.TELEGRAM_CHANNEL_ID   || '';

// Herkese açık ilan detay sayfası (/ilan/{id} ve /jobs/{id} 404 verir)
const JOB_DETAIL_URL = 'https://crewinjob.com/jobs/detail/';

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── İlan çekme ────────────────────────────────────────────────────────────────
// Eskiden var olmayan 'Ilan/GetAllIlan' çağrılıyor ve ilanAdi/firmaAdi gibi olmayan alanlar
// okunuyordu. Artık api.js getJobListings kullanılır: Ilan/GetAll (job-bot.js ile aynı servis),
// yanıt { ilan: {...} } normalize edilmiş biçimde döner (jobId, title, company, vesselType,
// duration, salary, location, postedAt, applyUrl).
async function fetchLatestJobs(maxCount = 5) {
  try {
    const api = require('./api');
    return await api.getJobListings(null, maxCount);
  } catch (e) {
    console.error('[poster] fetchLatestJobs hata:', e.message);
    return [];
  }
}

function formatJobPost(job) {
  const id       = job.jobId ?? job.id ?? null;
  const title    = job.title    || job.positionName || 'Pozisyon Belirtilmedi';
  const company  = job.company  || job.firmName     || '';
  const shipType = job.vesselType || job.ship       || '';
  const location = job.location || job.ilanCountryName || '';
  const duration = job.duration || job.contratTypeName || '';
  const salary   = job.salary   || '';
  const url = id
    ? `${JOB_DETAIL_URL}${encodeURIComponent(id)}?utm_source=telegram&utm_medium=bot`
    : 'https://crewinjob.com/?utm_source=telegram&utm_medium=bot';

  let text = `🚢 <b>${escapeHtml(title)}</b>\n`;
  if (company)  text += `🏢 ${escapeHtml(company)}\n`;
  if (shipType) text += `⚓ ${escapeHtml(shipType)}\n`;
  if (location) text += `🌍 ${escapeHtml(location)}\n`;
  if (duration) text += `📅 ${escapeHtml(duration)}\n`;
  if (salary)   text += `💰 ${escapeHtml(salary)}\n`;
  text += `\n🔗 <a href="${escapeHtml(url)}">Detaylar &amp; Başvur</a>`;
  return text;
}

function formatStatsSummary() {
  const now = new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  return `📊 <b>CrewinJob Günlük Güncelleme</b> — ${now}\n\n` +
    `🌍 Gemi adamı ve denizcilik iş ilanları için:\n` +
    `🔗 <a href="https://crewinjob.com?utm_source=telegram">crewinjob.com</a>\n\n` +
    `#crewinjob #denizcilik #gemiadami #maritimejobs`;
}

async function sendToChannel(bot, text, opts = {}) {
  if (!CHANNEL) { console.warn('[poster] TELEGRAM_CHANNEL_ID tanımlı değil'); return; }
  await bot.sendMessage(CHANNEL, text, { parse_mode: 'HTML', ...opts });
}

async function postJobsToChannel(bot) {
  console.log('[poster] Kanal paylaşımı başlıyor...');
  try {
    const jobs = await fetchLatestJobs(3);
    if (jobs.length > 0) {
      for (const job of jobs) {
        await sendToChannel(bot, formatJobPost(job));
        await new Promise(r => setTimeout(r, 1500));
      }
      console.log(`[poster] ${jobs.length} ilan paylaşıldı`);
    } else {
      await sendToChannel(bot, formatStatsSummary());
    }
  } catch (e) {
    console.error('[poster] postJobsToChannel hata:', e.message);
    try { await sendToChannel(bot, formatStatsSummary()); } catch {}
  }
}

// İlan oluşturma: job-bot.js ile aynı yol — POST Ilan/CreateOrEdit (ID tabanlı DTO).
// Eskiden var olmayan 'Ilan/CreateIlan' GET ile çağrılıyordu (hiçbir zaman çalışmadı; şu an
// hiçbir yerden çağrılmıyor). jobData, job-bot.parseJobWithAI çıktısı gibi positionId vb.
// ID alanlarını içermelidir — parseGroupJobPost'un metin alanları doğrudan GÖNDERİLEMEZ.
async function submitJobToApi(jobData) {
  const bot = require('./job-bot');
  const check = bot.validateJobData(jobData || {});
  if (!check.valid) throw new Error('İlan verisi geçersiz: ' + check.errors.join(', '));
  return await bot.createIlan(jobData);
}

async function parseGroupJobPost(text) {
  if (!process.env.GEMINI_API_KEY) return { isJob: false };
  try {
    const prompt = `Aşağıdaki Telegram mesajının bir denizcilik iş ilanı olup olmadığını analiz et.
Eğer ilan ise JSON olarak döndür: {"isJob":true,"data":{"position":"...","company":"...","shipType":"...","salary":"...","port":"...","contact":"...","requirements":"..."}}
Değilse: {"isJob":false}
Sadece JSON döndür.

MESAJ:
${text.slice(0, 1000)}`;

    const ai  = require('../ai-client');
    const resp = await ai.messages.create({
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = resp?.content?.[0]?.text?.trim() || '';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    return { isJob: false };
  }
}

function scheduleChannelPosts(bot) {
  cron.schedule('0 6 * * *',  () => postJobsToChannel(bot), { timezone: 'UTC' });
  cron.schedule('0 15 * * *', () => postJobsToChannel(bot), { timezone: 'UTC' });
  console.log('[poster] Zamanlanmış görevler aktif: 09:00 ve 18:00 (TR saati)');
}

module.exports = {
  fetchLatestJobs, formatJobPost, sendToChannel,
  postJobsToChannel, submitJobToApi, parseGroupJobPost, scheduleChannelPosts,
};
