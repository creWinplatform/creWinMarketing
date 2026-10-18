'use strict';
// Her sabah Telegram botundan günlük özet raporu gönderir
const { loadPosted, loadReviewQueue, loadGroupStats, log } = require('./auto-poster');

// Config: process.env > .userbot-config.json > .env — bkz. agent-config.js
require('./agent-config').loadAgentConfig();

// Grup başlıkları dışarıdan gelir (`*`, `_`, `[` içerebilir) — Markdown ayrıştırması bozuluyor
// ve Telegram mesajı reddediyordu. HTML modu + kaçış kullanılır.
function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegramMessage(botToken, chatId, text) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API hatası');
  return data;
}

async function sendDailySummary() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.REPORT_CHAT_ID;

  if (!botToken || !chatId) {
    log('[reporter] ⚠️ TELEGRAM_BOT_TOKEN veya REPORT_CHAT_ID tanımlı değil — rapor atlandı');
    return null;
  }

  const today   = new Date().toISOString().slice(0, 10);
  const posted  = loadPosted();
  const queue   = loadReviewQueue();
  const gStats  = loadGroupStats();

  const todayPosted      = posted.filter(p => p.postedAt?.startsWith(today));
  const todayBroadcasted = todayPosted.filter(p => p.broadcastedAt);
  const pendingReview    = queue.filter(r => r.status === 'pending');
  const totalGroups      = Object.keys(gStats).length;

  // En iyi 3 kaynak grup
  const topGroups = Object.values(gStats)
    .filter(g => g.posted > 0)
    .sort((a, b) => b.posted - a.posted)
    .slice(0, 3)
    .map(g => `  • ${escapeHtml(g.chatTitle)}: ${g.posted} ilan`)
    .join('\n');

  const message =
    `📊 <b>Crewinjob Manning — Günlük Rapor</b>\n` +
    `📅 ${today}\n\n` +
    `✅ Bugün yayınlanan ilan: <b>${todayPosted.length}</b>\n` +
    `📢 Telegram'a paylaşılan: <b>${todayBroadcasted.length}</b>\n` +
    `🔍 İnceleme bekleyen: <b>${pendingReview.length}</b>\n` +
    `📦 Toplam ilan (tüm zamanlar): <b>${posted.length}</b>\n` +
    `🤝 Takip edilen grup: <b>${totalGroups}</b>\n` +
    (topGroups ? `\n🏆 <b>En iyi kaynak gruplar:</b>\n${topGroups}\n` : '') +
    `\n<i>crewinjob.com Marketing Agent</i>`;

  try {
    await sendTelegramMessage(botToken, chatId, message);
    log(`[reporter] ✅ Günlük rapor gönderildi → chat ${chatId}`);
    return { ok: true, today: today, todayPosted: todayPosted.length };
  } catch (e) {
    log(`[reporter] ❌ Rapor gönderilemedi: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendDailySummary, escapeHtml };
