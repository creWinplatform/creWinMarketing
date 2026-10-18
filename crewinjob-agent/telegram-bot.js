'use strict';
require('dotenv').config();
const _tgLib      = require('node-telegram-bot-api');
const TelegramBot = _tgLib.default || _tgLib;
const poster      = require('./modules/telegram-poster');

const TOKEN         = process.env.TELEGRAM_BOT_TOKEN   || '';
const SCRAPE_GROUPS = (process.env.TELEGRAM_SCRAPE_GROUPS || '').split(',').map(s => s.trim()).filter(Boolean);

if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN tanımlı değil — .env dosyasını kontrol edin');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
console.log('✅ Telegram botu başlatıldı, polling aktif...');

// ── Dil tespiti ───────────────────────────────────────────────────────────────
// Telegram'ın language_code'u kullan, TR dışı hepsine EN ver
function detectLang(msg) {
  const lc = msg.from?.language_code || '';
  return lc.startsWith('tr') ? 'tr' : 'en';
}

// ── Çeviri yardımcısı ─────────────────────────────────────────────────────────
const i18n = {
  welcome: {
    tr: (n) => `👋 Merhaba ${n}!\n\nCrewinJob Asistanı'na hoş geldiniz.\n\nSizi daha iyi tanıyalım:`,
    en: (n) => `👋 Hello ${n}!\n\nWelcome to CrewinJob Assistant.\n\nLet's get to know you better:`,
  },
  whoAreYou: {
    tr: '👤 Kim olduğunuzu seçin:',
    en: '👤 Who are you?',
  },
  rankQ: {
    tr: '⚓ Rütbenizi seçin:',
    en: '⚓ Select your rank:',
  },
  shipQ: {
    tr: '🚢 Hangi gemi tipinde çalışıyorsunuz?',
    en: '🚢 What type of vessel do you work on?',
  },
  expQ: {
    tr: '📅 Toplam deniz hizmeti süreniz:',
    en: '📅 Total sea service duration:',
  },
  profile: {
    tr: (r, s, e) => `✅ <b>Profiliniz Kaydedildi!</b>\n\n📋 Rütbe: ${r}\n🚢 Gemi: ${s}\n📅 Deneyim: ${e}\n\n`,
    en: (r, s, e) => `✅ <b>Profile Saved!</b>\n\n📋 Rank: ${r}\n🚢 Vessel: ${s}\n📅 Experience: ${e}\n\n`,
  },
  jobsLink: {
    tr: '🔍 Size uygun ilanlar:\n',
    en: '🔍 Jobs matching your profile:\n',
  },
  jobsCmd: {
    tr: '📲 /jobs komutuyla güncel ilanları görebilirsiniz.',
    en: '📲 Use /jobs to see the latest openings.',
  },
  company: {
    tr: `🏢 <b>İşveren Portalı</b>\n\nCrewinJob'da ilan yayınlamak ve nitelikli denizci bulmak için:\n\n🌐 <a href="https://crewinjob.com/firma-kayit?utm_source=telegram">crewinjob.com/firma-kayit</a>\n\n📧 <a href="mailto:info@crewision.com">info@crewision.com</a>`,
    en: `🏢 <b>Employer Portal</b>\n\nTo post jobs and find qualified seafarers on CrewinJob:\n\n🌐 <a href="https://crewinjob.com/firma-kayit?utm_source=telegram">crewinjob.com/employer</a>\n\n📧 <a href="mailto:info@crewision.com">info@crewision.com</a>`,
  },
  cadet: {
    tr: `🎓 <b>Stajyer / Kadet Programı</b>\n\nİlk gemicilik deneyiminiz için staj ilanlarımızı inceleyin:\n\n🔗 <a href="https://crewinjob.com/staj?utm_source=telegram">crewinjob.com/staj</a>`,
    en: `🎓 <b>Cadet Program</b>\n\nFind cadet / trainee positions:\n\n🔗 <a href="https://crewinjob.com/cadet?utm_source=telegram">crewinjob.com/cadet</a>`,
  },
  noJobs: {
    tr: '📭 Şu an aktif ilan bulunamadı.\n🔗 https://crewinjob.com',
    en: '📭 No active jobs found at the moment.\n🔗 https://crewinjob.com',
  },
  cancel: {
    tr: '✅ İşlem iptal edildi. /start ile yeniden başlayabilirsiniz.',
    en: '✅ Cancelled. Use /start to begin again.',
  },
  analyzing: {
    tr: '🔍 İlan analiz ediliyor...',
    en: '🔍 Analyzing job post...',
  },
  notJob: {
    tr: '📭 Bu mesajda iş ilanı bulunamadı.\n\n/jobs komutu ile güncel ilanları görebilirsiniz.',
    en: '📭 No job listing found in this message.\n\nUse /jobs to see current openings.',
  },
};

const t = (key, lang, ...args) => {
  const entry = i18n[key];
  if (!entry) return key;
  const fn = entry[lang] || entry.en;
  return typeof fn === 'function' ? fn(...args) : fn;
};

// ── Oturum yönetimi ───────────────────────────────────────────────────────────
const sessions = new Map();

function getSession(chatId, lang) {
  if (!sessions.has(chatId)) sessions.set(chatId, { step: 'idle', data: {}, lang: lang || 'en' });
  return sessions.get(chatId);
}

function resetSession(chatId) {
  const lang = getSession(chatId).lang;
  sessions.set(chatId, { step: 'idle', data: {}, lang });
}

// ── /start ────────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name   = msg.from?.first_name || 'Seafarer';
  const lang   = detectLang(msg);
  const sess   = getSession(chatId, lang);
  sess.lang    = lang;
  sess.step    = 'usertype';

  await bot.sendMessage(chatId, t('welcome', lang, name), {
    reply_markup: {
      inline_keyboard: [
        [{ text: lang === 'tr' ? '🚢 Gemi Adamı' : '🚢 Seafarer',      callback_data: 'type_seafarer' }],
        [{ text: lang === 'tr' ? '🏢 İşveren / Armatör' : '🏢 Employer / Shipowner', callback_data: 'type_company'  }],
        [{ text: lang === 'tr' ? '🎓 Stajyer / Kadet' : '🎓 Cadet / Trainee',        callback_data: 'type_cadet'   }],
      ],
    },
  });
});

// ── /help ─────────────────────────────────────────────────────────────────────
bot.onText(/\/help/, async (msg) => {
  const lang = detectLang(msg);
  await bot.sendMessage(msg.chat.id,
    lang === 'tr'
      ? `📖 <b>Komutlar</b>\n\n/start — Kayıt akışı\n/jobs — Güncel ilanlar\n/salary — Maaş rehberi\n/stcw — Sertifika rehberi\n/cancel — İptal\n\n🌐 <a href="https://crewinjob.com">crewinjob.com</a>`
      : `📖 <b>Commands</b>\n\n/start — Registration flow\n/jobs — Latest job listings\n/salary — Salary guide\n/stcw — Certificate guide\n/cancel — Cancel\n\n🌐 <a href="https://crewinjob.com">crewinjob.com</a>`,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
});

// ── /cancel ───────────────────────────────────────────────────────────────────
bot.onText(/\/cancel/, async (msg) => {
  const lang = getSession(msg.chat.id).lang;
  resetSession(msg.chat.id);
  await bot.sendMessage(msg.chat.id, t('cancel', lang));
});

// ── /jobs ─────────────────────────────────────────────────────────────────────
bot.onText(/\/jobs/, async (msg) => {
  const chatId = msg.chat.id;
  const lang   = getSession(chatId).lang || detectLang(msg);
  await bot.sendMessage(chatId, lang === 'tr' ? '🔍 İlanlar yükleniyor...' : '🔍 Loading jobs...');
  try {
    const jobs = await poster.fetchLatestJobs(5);
    if (!jobs.length) {
      await bot.sendMessage(chatId, t('noJobs', lang));
      return;
    }
    for (const job of jobs) {
      await bot.sendMessage(chatId, poster.formatJobPost(job), { parse_mode: 'HTML' });
      await new Promise(r => setTimeout(r, 800));
    }
  } catch (e) {
    console.error('[bot] /jobs hata:', e.message);
    await bot.sendMessage(chatId, lang === 'tr' ? '❌ İlanlar yüklenemedi.' : '❌ Could not load jobs.');
  }
});

// ── /salary ───────────────────────────────────────────────────────────────────
bot.onText(/\/salary/, async (msg) => {
  const lang = getSession(msg.chat.id).lang || detectLang(msg);
  await bot.sendMessage(msg.chat.id,
    lang === 'tr'
      ? `💰 <b>Denizci Maaş Rehberi (Ortalama USD/ay)</b>\n\n👨‍✈️ Kaptan: $8,000–$15,000\n🧭 Baş Zabit: $5,000–$9,000\n⚙️ Başmakinist: $7,000–$13,000\n🔧 2. Makinist: $4,500–$8,000\n📡 ETO: $4,000–$7,000\n🚢 AB/Güverte: $1,800–$3,500\n\n📊 Güncel ilanlar: <a href="https://crewinjob.com">crewinjob.com</a>`
      : `💰 <b>Seafarer Salary Guide (Avg USD/month)</b>\n\n👨‍✈️ Master: $8,000–$15,000\n🧭 Chief Officer: $5,000–$9,000\n⚙️ Chief Engineer: $7,000–$13,000\n🔧 2nd Engineer: $4,500–$8,000\n📡 ETO: $4,000–$7,000\n🚢 AB/Deck: $1,800–$3,500\n\n📊 Current jobs: <a href="https://crewinjob.com">crewinjob.com</a>`,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
});

// ── /stcw ─────────────────────────────────────────────────────────────────────
bot.onText(/\/stcw/, async (msg) => {
  const lang = getSession(msg.chat.id).lang || detectLang(msg);
  await bot.sendMessage(msg.chat.id,
    lang === 'tr'
      ? `📋 <b>STCW Sertifika Rehberi</b>\n\n✅ Basic Safety Training (BST)\n✅ GMDSS / ROC\n✅ Advanced Fire Fighting\n✅ Medical First Aid\n✅ Proficiency in Survival Craft\n✅ ECDIS\n✅ BRM / ERM\n\n🔗 <a href="https://crewinjob.com">crewinjob.com</a>`
      : `📋 <b>STCW Certificate Guide</b>\n\n✅ Basic Safety Training (BST)\n✅ GMDSS / ROC\n✅ Advanced Fire Fighting\n✅ Medical First Aid\n✅ Proficiency in Survival Craft\n✅ ECDIS\n✅ BRM / ERM\n\n🔗 <a href="https://crewinjob.com">crewinjob.com</a>`,
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
});

// ── Dil komutları ─────────────────────────────────────────────────────────────
bot.onText(/\/lang_tr/, async (msg) => {
  getSession(msg.chat.id).lang = 'tr';
  await bot.sendMessage(msg.chat.id, '✅ Dil Türkçe olarak ayarlandı.');
});
bot.onText(/\/lang_en/, async (msg) => {
  getSession(msg.chat.id).lang = 'en';
  await bot.sendMessage(msg.chat.id, '✅ Language set to English.');
});

// ── Callback: inline butonlar ─────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data   = query.data;
  const sess   = getSession(chatId);
  const lang   = sess.lang || 'en';
  await bot.answerCallbackQuery(query.id);

  // Kullanıcı tipi
  if (data === 'type_seafarer') {
    sess.data.type = 'seafarer';
    sess.step = 'rank';
    await bot.sendMessage(chatId, t('rankQ', lang), {
      reply_markup: {
        inline_keyboard: [
          [{ text: lang === 'tr' ? '👨‍✈️ Kaptan'         : '👨‍✈️ Master / Captain',     callback_data: 'rank_master'  },
           { text: lang === 'tr' ? '🧭 Baş Güverte Zabiti' : '🧭 Chief Officer (C/O)',    callback_data: 'rank_co'     }],
          [{ text: lang === 'tr' ? '⚙️ Başmakinist'      : '⚙️ Chief Engineer (C/E)',    callback_data: 'rank_ce'     },
           { text: lang === 'tr' ? '🔧 2. Makinist'      : '🔧 2nd Engineer (2/E)',       callback_data: 'rank_2e'     }],
          [{ text: '📡 ETO / Electrician',                                                 callback_data: 'rank_eto'    },
           { text: lang === 'tr' ? '🚢 AB / Güverte Er'  : '🚢 Able Seaman (AB)',         callback_data: 'rank_ab'     }],
          [{ text: lang === 'tr' ? '🔩 Makine Tayfası'   : '🔩 Engine Rating',            callback_data: 'rank_engine' },
           { text: lang === 'tr' ? '🍳 Aşçı / Kamarot'  : '🍳 Cook / Steward',           callback_data: 'rank_cook'   }],
          [{ text: lang === 'tr' ? '🎓 Stajyer / Kadet'  : '🎓 Cadet / Trainee',          callback_data: 'rank_cadet'  },
           { text: lang === 'tr' ? '🔵 Diğer'            : '🔵 Other',                    callback_data: 'rank_other'  }],
        ],
      },
    });

  } else if (data === 'type_company') {
    resetSession(chatId);
    await bot.sendMessage(chatId, t('company', lang), { parse_mode: 'HTML', disable_web_page_preview: false });

  } else if (data === 'type_cadet') {
    resetSession(chatId);
    await bot.sendMessage(chatId, t('cadet', lang), { parse_mode: 'HTML', disable_web_page_preview: false });

  // Rütbe seçimi
  } else if (data.startsWith('rank_')) {
    sess.data.rank = data.replace('rank_', '');
    sess.step = 'shiptype';
    await bot.sendMessage(chatId, t('shipQ', lang), {
      reply_markup: {
        inline_keyboard: [
          [{ text: lang === 'tr' ? '📦 Konteyner'      : '📦 Container',    callback_data: 'ship_container' },
           { text: lang === 'tr' ? '🛢️ Petrol Tankeri' : '🛢️ Oil Tanker',   callback_data: 'ship_tanker'    }],
          [{ text: lang === 'tr' ? '🌾 Kuru Dökme'     : '🌾 Bulk Carrier', callback_data: 'ship_bulk'      },
           { text: lang === 'tr' ? '⚗️ Kimyasal Tanker': '⚗️ Chemical Tanker', callback_data: 'ship_chem'   }],
          [{ text: lang === 'tr' ? '⚓ LNG/LPG'        : '⚓ LNG/LPG',      callback_data: 'ship_gas'       },
           { text: lang === 'tr' ? '🛳️ Yolcu/Cruise'   : '🛳️ Passenger/Cruise', callback_data: 'ship_cruise'}],
          [{ text: lang === 'tr' ? '🔧 Offshore/OSV'   : '🔧 Offshore/OSV', callback_data: 'ship_offshore'  },
           { text: lang === 'tr' ? '⛴️ Feribot/RoRo'   : '⛴️ Ferry/RoRo',  callback_data: 'ship_roro'      }],
          [{ text: lang === 'tr' ? '🔵 Diğer'          : '🔵 Other',        callback_data: 'ship_other'     }],
        ],
      },
    });

  // Gemi tipi seçimi
  } else if (data.startsWith('ship_')) {
    sess.data.shipType = data.replace('ship_', '');
    sess.step = 'experience';
    await bot.sendMessage(chatId, t('expQ', lang), {
      reply_markup: {
        inline_keyboard: [
          [{ text: lang === 'tr' ? '🟢 Yeni Mezun / Stajyer (0–6 ay)' : '🟢 New Graduate / Trainee (0–6 mo)', callback_data: 'exp_0to6m'  }],
          [{ text: lang === 'tr' ? '🔵 Junior (6 ay – 2 yıl)'          : '🔵 Junior (6 mo – 2 years)',          callback_data: 'exp_6mto2y' }],
          [{ text: lang === 'tr' ? '🟡 Mid-Level (2 – 5 yıl)'          : '🟡 Mid-Level (2 – 5 years)',          callback_data: 'exp_2to5y'  }],
          [{ text: lang === 'tr' ? '🟠 Senior (5 – 10 yıl)'            : '🟠 Senior (5 – 10 years)',            callback_data: 'exp_5to10y' }],
          [{ text: lang === 'tr' ? '🔴 Expert (10+ yıl)'               : '🔴 Expert (10+ years)',               callback_data: 'exp_10yp'   }],
        ],
      },
    });

  // Deneyim seçimi → Sonuç
  } else if (data.startsWith('exp_')) {
    const expMap = {
      exp_0to6m:  { tr: '0–6 ay',          en: '0–6 months'    },
      exp_6mto2y: { tr: '6 ay – 2 yıl',    en: '6 mo – 2 years'},
      exp_2to5y:  { tr: '2–5 yıl',          en: '2–5 years'     },
      exp_5to10y: { tr: '5–10 yıl',         en: '5–10 years'    },
      exp_10yp:   { tr: '10+ yıl',          en: '10+ years'     },
    };
    sess.data.experience = expMap[data]?.[lang] || data;
    sess.step = 'idle';

    const { rank, shipType, experience } = sess.data;
    const url = `https://crewinjob.com/ilanlar?rank=${rank}&shipType=${shipType}&utm_source=telegram&utm_medium=bot`;
    await bot.sendMessage(chatId,
      t('profile', lang, rank, shipType, experience) +
      t('jobsLink', lang) + `<a href="${url}">${url}</a>\n\n` +
      t('jobsCmd', lang),
      { parse_mode: 'HTML', disable_web_page_preview: false }
    );
    resetSession(chatId);
  }
});

// ── Grup / Forward iş ilanı tarama ───────────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId    = msg.chat.id;
  const text      = msg.text || msg.caption || '';
  const isGroup   = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
  const isForward = !!(msg.forward_from || msg.forward_from_chat || msg.forward_sender_name);
  const isPrivate = msg.chat.type === 'private';

  if (text.startsWith('/')) return;

  // Grup: scrape listesindeyse analiz et
  if (isGroup && SCRAPE_GROUPS.includes(String(chatId))) {
    if (text.length < 30) return;
    try {
      const result = await poster.parseGroupJobPost(text);
      if (result.isJob) console.log('[bot] Grup ilanı:', JSON.stringify(result.data));
    } catch (e) { console.error('[bot] Grup parse hata:', e.message); }
    return;
  }

  // Private forward: ilan analizi
  if (isPrivate && isForward && text.length > 30) {
    const sess = getSession(chatId);
    const lang = sess.lang || detectLang(msg);
    if (sess.step !== 'idle') return;

    await bot.sendMessage(chatId, t('analyzing', lang));
    try {
      const result = await poster.parseGroupJobPost(text);
      if (result.isJob) {
        const d = result.data;
        await bot.sendMessage(chatId,
          (lang === 'tr' ? `✅ <b>İlan Tespit Edildi!</b>\n\n` : `✅ <b>Job Found!</b>\n\n`) +
          `📋 ${lang === 'tr' ? 'Pozisyon' : 'Position'}: ${d.position || '-'}\n` +
          `🏢 ${lang === 'tr' ? 'Şirket' : 'Company'}: ${d.company || '-'}\n` +
          `🚢 ${lang === 'tr' ? 'Gemi' : 'Vessel'}: ${d.shipType || '-'}\n` +
          `💰 ${lang === 'tr' ? 'Maaş' : 'Salary'}: ${d.salary || '-'}\n` +
          `🌍 ${lang === 'tr' ? 'Liman' : 'Port'}: ${d.port || '-'}\n` +
          `📞 ${lang === 'tr' ? 'İletişim' : 'Contact'}: ${d.contact || '-'}\n\n` +
          `🔗 <a href="https://crewinjob.com">CrewinJob</a>`,
          { parse_mode: 'HTML', disable_web_page_preview: true }
        );
      } else {
        await bot.sendMessage(chatId, t('notJob', lang));
      }
    } catch (e) {
      await bot.sendMessage(chatId, lang === 'tr' ? '❌ Analiz yapılamadı.' : '❌ Analysis failed.');
    }
  }
});

// ── Hata yönetimi ─────────────────────────────────────────────────────────────
bot.on('polling_error', (err) => {
  console.error('[bot] Polling hatası:', err.message || err.code);
});

// ── Zamanlanmış kanal paylaşımları ───────────────────────────────────────────
poster.scheduleChannelPosts(bot);

console.log('🤖 Bot hazır! Komutlar: /start /jobs /help /salary /stcw');
