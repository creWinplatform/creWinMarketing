'use strict';
// Katılınan gruplardan iş ilanı mesajlarını çeker, deduplication uygular
const crypto = require('crypto');
const store  = require('./store');
const { Api } = require('telegram');
const { getClient }      = require('./tg-client');
const { getJoinedGroups } = require('./group-discovery');

// data/processed-messages.json — store.js üzerinden
const MAX_STORED     = 10000;

// ── İş ilanı anahtar kelimeleri ──────────────────────────────────────────────
const JOB_KEYWORDS = [
  // İngilizce — pozisyon
  'captain', 'master', 'chief officer', 'second officer', 'third officer',
  'chief engineer', 'second engineer', 'third engineer', 'fourth engineer',
  'able seaman', 'bosun', 'motorman', 'oiler', 'wiper', 'fitter',
  'cook', 'steward', 'pumpman', 'electrician', 'eto', 'cadet',
  // İngilizce — genel
  'position', 'vacancy', 'hiring', 'required', 'salary', 'contract',
  'vessel', 'ship', 'tanker', 'bulk', 'crew', 'apply', 'onboard', 'aboard',
  'stcw', 'experience', 'certificate', 'joining',
  // Türkçe
  'kaptan', 'zabit', 'makinist', 'güverte', 'maaş', 'ilan',
  'başvur', 'mürettebat', 'gemi', 'denizci',
  // Endonezya/Filipin
  'pelaut', 'kapal', 'kerja', 'gaji', 'kontrak',
];

// ── Yardımcılar ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loadProcessed() {
  try { return new Set(await store.read(store.stores.processedMessages)); }
  catch { return new Set(); }
}

function msgHash(chatId, messageId) {
  return crypto.createHash('md5').update(`${chatId}:${messageId}`).digest('hex');
}

function contentHash(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
  return crypto.createHash('md5').update(normalized).digest('hex');
}

function isJobPost(text = '') {
  if (text.length < 50) return false;
  const lower = text.toLowerCase();
  const hits  = JOB_KEYWORDS.filter(kw => lower.includes(kw)).length;
  return hits >= 2;
}

// ── Tek grup/kanaldan mesaj çek ───────────────────────────────────────────────
async function scrapeRecentMessages(chatId, limit = 80) {
  const client   = await getClient();
  const messages = [];

  try {
    const history = await client.invoke(
      new Api.messages.GetHistory({
        peer:       chatId,
        limit,
        offsetId:   0,
        offsetDate: 0,
        addOffset:  0,
        maxId:      0,
        minId:      0,
        hash:       BigInt(0),
      })
    );

    for (const msg of history.messages || []) {
      const text = msg.message || '';
      // Sadece iş ilanı niteliğindeki METİNLİ mesajlar.
      // Eskiden media olan HER mesaj atlanıyordu — link önizlemeli ilanlar (MessageMediaWebPage)
      // dahil. Artık: web önizlemesi metin mesajıdır, kabul edilir; foto/doküman/diğer gerçek
      // medya yalnızca metni (caption) yoksa atlanır.
      // msg.media artık tek başına eleme sebebi DEĞİL (MessageMediaWebPage = link önizlemesi).
      if (!text.trim()) continue;   // metinsiz mesaj / metinsiz foto, doküman, sticker... → atla
      if (!isJobPost(text)) continue;
      messages.push({
        chatId:    chatId.toString(),
        messageId: msg.id,
        text,
        date:      new Date(msg.date * 1000).toISOString(),
      });
    }
  } catch (e) {
    // Özel/kapalı gruplar sessizce atlanır
    const quiet = ['CHANNEL_PRIVATE', 'CHAT_FORBIDDEN', 'PEER_ID_INVALID'];
    if (!quiet.some(q => e.message?.includes(q))) {
      console.warn(`[scraper] ${chatId}: ${e.message}`);
    }
  }

  return messages;
}

// ── Tüm katılınan grupları tara ───────────────────────────────────────────────
async function scrapeAllGroups(limitPerGroup = 80, groupStats = {}) {
  const processed = await loadProcessed();
  let groups      = await getJoinedGroups();

  // Feature 3: Kalite sıralaması — yüksek qualityRatio olan gruplar önce işlenir
  if (Object.keys(groupStats).length > 0) {
    groups = groups.sort((a, b) => {
      const sa = groupStats[a.id]?.qualityRatio ?? 0;
      const sb = groupStats[b.id]?.qualityRatio ?? 0;
      return sb - sa;
    });
  }

  const allMessages = [];
  const seenThisRun = new Set(); // aynı tur içinde başka grupta görülen içerikleri ele

  console.log(`[scraper] ${groups.length} grup/kanaldan mesaj çekiliyor...`);

  for (const g of groups) {
    if (!g.id) continue;

    try {
      const msgs = await scrapeRecentMessages(g.id, limitPerGroup);

      for (const msg of msgs) {
        const mhash = msgHash(msg.chatId, msg.messageId);
        const chash = contentHash(msg.text);

        // Önceki turlarda işlenmiş mi?
        if (processed.has(mhash) || processed.has(chash)) continue;
        // Bu turda başka grupta aynı içerik görüldü mü? (aynı ilan 2 grupta)
        if (seenThisRun.has(chash)) continue;
        seenThisRun.add(chash);

        msg.chatTitle    = g.title;
        msg.chatUsername = g.username || null; // auto-reply için
        msg._mhash       = mhash;
        msg._chash       = chash;
        allMessages.push(msg);
      }
    } catch (e) {
      console.warn(`[scraper] "${g.title}" hatası: ${e.message}`);
    }

    await sleep(1200); // Gruplar arası küçük bekleme
  }

  console.log(`[scraper] ${allMessages.length} yeni ilan mesajı bulundu.`);
  return { messages: allMessages, processed };
}

// ── İşlenenleri kaydet ────────────────────────────────────────────────────────
// Kayıtlı liste taze okunur ve bu turun özetleri eklenir (tarama dakikalar sürer; paralel turların kayıtları ezilmez).
async function markProcessed(messages, processed) {
  const hashes = [];
  for (const msg of messages) {
    if (msg._mhash) hashes.push(msg._mhash);
    if (msg._chash) hashes.push(msg._chash);
  }
  for (const h of hashes) processed.add(h);
  await store.mutate(store.stores.processedMessages, saved => {
    const set = new Set(saved);
    for (const h of hashes) set.add(h);
    let arr = [...set];
    // Maksimum kayıt sayısını koru (eski kayıtları sil)
    if (arr.length > MAX_STORED) arr = arr.slice(arr.length - MAX_STORED);
    return arr;
  });
}

module.exports = { scrapeAllGroups, scrapeRecentMessages, markProcessed, isJobPost };
