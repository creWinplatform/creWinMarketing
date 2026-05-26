// ─── Messaging Send — WhatsApp Business Cloud API + Telegram Bot API ──────────
// Mevcut kullanıcılara bildirim / mesaj gönderme
//
// WhatsApp : Meta Business Cloud API  → graph.facebook.com/v18.0/{phone-id}/messages
// Telegram : Bot API                  → api.telegram.org/bot{TOKEN}/sendMessage
//
// ENV değişkenleri (.env.local):
//   WHATSAPP_PHONE_NUMBER_ID   — Meta'dan alınan Phone Number ID
//   WHATSAPP_ACCESS_TOKEN      — Meta System User Access Token (uzun ömürlü)
//   WHATSAPP_FROM_NUMBER       — Gönderen WA numarası (+90...)
//   TELEGRAM_BOT_TOKEN         — @BotFather'dan alınan bot token
//   TELEGRAM_CHANNEL_ID        — @handle veya sayısal -100... chat ID

async function _fetch(...args) {
  const fetch = (await import('node-fetch')).default;
  return fetch(...args);
}

// ─── ENV yardımcıları ─────────────────────────────────────────────────────────
const WA_PHONE_ID     = () => process.env.WHATSAPP_PHONE_NUMBER_ID || null;
const WA_ACCESS_TOKEN = () => process.env.WHATSAPP_ACCESS_TOKEN    || null;
const TG_TOKEN        = () => process.env.TELEGRAM_BOT_TOKEN       || null;
const TG_CHANNEL      = () => process.env.TELEGRAM_CHANNEL_ID      || null;

// ─────────────────────────────────────────────────────────────────────────────
//  WHATSAPP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tek bir telefon numarasına WhatsApp text mesajı gönderir.
 * @param {string} to  — Alıcı numarası E.164 formatında (+905XXXXXXXXX)
 * @param {string} text — Gönderilecek metin
 * @returns {{ success: boolean, messageId?: string, error?: string }}
 */
async function sendWhatsAppMessage(to, text) {
  const phoneId = WA_PHONE_ID();
  const token   = WA_ACCESS_TOKEN();

  if (!phoneId || !token) {
    return {
      success: false,
      error:   'WhatsApp yapılandırılmamış. .env.local içinde WHATSAPP_PHONE_NUMBER_ID ve WHATSAPP_ACCESS_TOKEN ayarlayın.',
    };
  }

  try {
    const res = await _fetch(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text, preview_url: false },
        }),
      },
    );

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.error?.message || `${res.status} ${res.statusText}`;
      return { success: false, error: msg };
    }
    const messageId = json?.messages?.[0]?.id;
    return { success: true, messageId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Birden fazla numaraya toplu WhatsApp mesajı gönderir (rate-limit için 200ms aralık).
 * @param {string[]} numbers — E.164 formatında numara listesi
 * @param {string} text      — Mesaj metni
 * @returns {{ sent: number, failed: number, errors: string[] }}
 */
async function broadcastWhatsApp(numbers, text) {
  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const num of numbers) {
    const result = await sendWhatsAppMessage(num, text);
    if (result.success) {
      sent++;
    } else {
      failed++;
      errors.push(`${num}: ${result.error}`);
    }
    // Meta rate limit: saniyede ~80 mesaj — 200ms boşluk yeterli
    await new Promise(r => setTimeout(r, 200));
  }

  return { sent, failed, errors };
}

/**
 * WhatsApp template mesajı gönderir (onaylı şablonlar için).
 * @param {string} to           — Alıcı numarası E.164
 * @param {string} templateName — Onaylı şablon adı (örn: 'seafarer_welcome')
 * @param {string} langCode     — Şablon dil kodu ('tr' | 'en' | 'tl')
 * @param {{ type: string; text?: string }[]} [components] — Şablon parametreleri
 */
async function sendWhatsAppTemplate(to, templateName, langCode, components = []) {
  const phoneId = WA_PHONE_ID();
  const token   = WA_ACCESS_TOKEN();

  if (!phoneId || !token) {
    return {
      success: false,
      error:   'WhatsApp yapılandırılmamış.',
    };
  }

  try {
    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name:     templateName,
        language: { code: langCode },
        ...(components.length > 0 && { components }),
      },
    };

    const res = await _fetch(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
    );

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = json?.error?.message || `${res.status} ${res.statusText}`;
      return { success: false, error: msg };
    }
    return { success: true, messageId: json?.messages?.[0]?.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  TELEGRAM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Telegram kanalına / gruba / kullanıcıya mesaj gönderir.
 * @param {string|number} chatId — @handle veya sayısal chat ID
 * @param {string} text          — Mesaj metni (HTML veya Markdown)
 * @param {'HTML'|'Markdown'|'MarkdownV2'} [parseMode] — Formatlama modu
 * @param {object} [extra] — Ekstra Telegram API parametreleri
 */
async function sendTelegramMessage(chatId, text, parseMode = 'HTML', extra = {}) {
  const token = TG_TOKEN();
  if (!token) {
    return {
      success: false,
      error:   'Telegram yapılandırılmamış. .env.local içinde TELEGRAM_BOT_TOKEN ayarlayın.',
    };
  }

  try {
    const res = await _fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          chat_id:    chatId,
          text,
          parse_mode: parseMode,
          ...extra,
        }),
      },
    );

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      const msg = json?.description || `${res.status} ${res.statusText}`;
      return { success: false, error: msg };
    }
    return { success: true, messageId: json.result?.message_id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Varsayılan kanalı kullanarak Telegram'a mesaj gönderir.
 * TELEGRAM_CHANNEL_ID env değişkenini kullanır.
 */
async function sendToDefaultChannel(text, parseMode = 'HTML') {
  const channelId = TG_CHANNEL();
  if (!channelId) {
    return {
      success: false,
      error:   'TELEGRAM_CHANNEL_ID ayarlanmamış. .env.local içinde tanımlayın.',
    };
  }
  return sendTelegramMessage(channelId, text, parseMode);
}

/**
 * Telegram'da inline butonlu mesaj gönderir.
 * @param {string|number} chatId
 * @param {string} text
 * @param {{ text: string; url?: string; callback_data?: string }[][]} buttons
 *   — 2D array: dış dizi = satırlar, iç dizi = butonlar
 */
async function sendTelegramWithButtons(chatId, text, buttons) {
  return sendTelegramMessage(chatId, text, 'HTML', {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

/**
 * Birden fazla kullanıcıya Telegram mesajı gönderir.
 * @param {(string|number)[]} chatIds
 * @param {string} text
 */
async function broadcastTelegram(chatIds, text, parseMode = 'HTML') {
  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const chatId of chatIds) {
    const result = await sendTelegramMessage(chatId, text, parseMode);
    if (result.success) {
      sent++;
    } else {
      failed++;
      errors.push(`${chatId}: ${result.error}`);
    }
    // Telegram rate limit: saniyede 30 mesaj — 40ms yeterli ama 100ms güvenli
    await new Promise(r => setTimeout(r, 100));
  }

  return { sent, failed, errors };
}

// ─── Yapılandırma durumu ──────────────────────────────────────────────────────
function getConfigStatus() {
  return {
    whatsapp: {
      configured: !!(WA_PHONE_ID() && WA_ACCESS_TOKEN()),
      phoneNumberId: WA_PHONE_ID() ? '***' + WA_PHONE_ID().slice(-4) : null,
      fromNumber:    process.env.WHATSAPP_FROM_NUMBER || null,
    },
    telegram: {
      configured: !!TG_TOKEN(),
      tokenSet:   !!TG_TOKEN(),
      channelId:  TG_CHANNEL() || null,
    },
  };
}

module.exports = {
  // WhatsApp
  sendWhatsAppMessage,
  broadcastWhatsApp,
  sendWhatsAppTemplate,
  // Telegram
  sendTelegramMessage,
  sendToDefaultChannel,
  sendTelegramWithButtons,
  broadcastTelegram,
  // Yardımcı
  getConfigStatus,
};
