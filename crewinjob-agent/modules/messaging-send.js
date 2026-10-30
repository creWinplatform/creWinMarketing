// ─── Messaging Send — WhatsApp Business Cloud API + Telegram Bot API + SMTP ───
// Mevcut kullanıcılara bildirim / mesaj gönderme
//
// WhatsApp : Meta Business Cloud API  → graph.facebook.com/{META_GRAPH_VERSION}/{phone-id}/messages
// Telegram : Bot API                  → api.telegram.org/bot{TOKEN}/sendMessage
// E-posta  : SMTP (nodemailer)        → örn. AWS SES SMTP endpoint'i
//
// ENV değişkenleri (.env.local):
//   WHATSAPP_PHONE_NUMBER_ID   — Meta'dan alınan Phone Number ID
//   WHATSAPP_ACCESS_TOKEN      — Meta System User Access Token (uzun ömürlü)
//   WHATSAPP_FROM_NUMBER       — Gönderen WA numarası (+90...)
//   META_GRAPH_VERSION         — Graph API sürümü (varsayılan v25.0; v18.0 kullanımdan kalktı)
//   TELEGRAM_BOT_TOKEN         — @BotFather'dan alınan bot token
//   TELEGRAM_CHANNEL_ID        — @handle veya sayısal -100... chat ID
//   SMTP_HOST                  — örn. email-smtp.eu-west-1.amazonaws.com
//   SMTP_PORT                  — örn. 587
//   SMTP_USER                  — SMTP kullanıcı adı (AWS SES: Access Key ID)
//   SMTP_PASSWORD               — SMTP şifresi (AWS SES: SMTP password — API secret'tan farklı)
//   SMTP_FROM_EMAIL             — Gönderen adres, örn. info@crewin.org
//   SMTP_FROM_NAME              — Gönderen görünen ad, örn. "CrewinJob"

async function _fetch(...args) {
  const fetch = (await import('node-fetch')).default;
  return fetch(...args);
}

// ─── ENV yardımcıları ─────────────────────────────────────────────────────────
const WA_PHONE_ID     = () => process.env.WHATSAPP_PHONE_NUMBER_ID || null;
const WA_ACCESS_TOKEN = () => process.env.WHATSAPP_ACCESS_TOKEN    || null;
const TG_TOKEN        = () => process.env.TELEGRAM_BOT_TOKEN       || null;
const TG_CHANNEL      = () => process.env.TELEGRAM_CHANNEL_ID      || null;
const WA_GRAPH_VERSION = () => process.env.META_GRAPH_VERSION      || 'v25.0';

// ─────────────────────────────────────────────────────────────────────────────
//  WHATSAPP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tek bir telefon numarasına WhatsApp text mesajı gönderir.
 * @param {string} to  — Alıcı numarası E.164 formatında (+905XXXXXXXXX)
 * @param {string} text — Gönderilecek metin
 * @returns {{ success: boolean, messageId?: string, error?: string, code?: number }}
 *   code: Meta hata kodu (ör. 131050 = kişi bu işletmenin pazarlama mesajlarını durdurdu; panel çıkış olarak kaydeder)
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
      `https://graph.facebook.com/${WA_GRAPH_VERSION()}/${phoneId}/messages`,
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
      return { success: false, error: msg, code: json?.error?.code };
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
 * @returns {{ sent: number, failed: number, errors: string[], results: { to: string, success: boolean, code?: number }[] }}
 */
async function broadcastWhatsApp(numbers, text) {
  let sent = 0;
  let failed = 0;
  const errors = [];
  const results = []; // numara bazında sonuç: panel 131050 alan numarayı çıkış olarak kaydeder

  for (const num of numbers) {
    const result = await sendWhatsAppMessage(num, text);
    if (result.success) {
      sent++;
    } else {
      failed++;
      errors.push(`${num}: ${result.error}`);
    }
    results.push({ to: num, success: result.success, ...(result.code !== undefined && { code: result.code }) });
    // Meta rate limit: saniyede ~80 mesaj — 200ms boşluk yeterli
    await new Promise(r => setTimeout(r, 200));
  }

  return { sent, failed, errors, results };
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
      `https://graph.facebook.com/${WA_GRAPH_VERSION()}/${phoneId}/messages`,
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
      return { success: false, error: msg, code: json?.error?.code };
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
 * parse_mode=HTML için kullanıcı/kampanya metnini kaçışlar (& < >). Telegram HTML'inde
 * yalnızca bu üç karakter özeldir; biçimlendirme etiketleri sadece kodun ürettiği kısımlarda kullanılmalı.
 * @param {string} text
 */
function escapeTelegramHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

// ─────────────────────────────────────────────────────────────────────────────
//  E-POSTA (SMTP — nodemailer)
// ─────────────────────────────────────────────────────────────────────────────

const SMTP_HOST      = () => process.env.SMTP_HOST       || null;
const SMTP_PORT      = () => Number(process.env.SMTP_PORT || 587);
const SMTP_USER      = () => process.env.SMTP_USER        || null;
const SMTP_PASSWORD  = () => process.env.SMTP_PASSWORD    || null;
const SMTP_FROM      = () => process.env.SMTP_FROM_EMAIL  || null;
const SMTP_FROM_NAME = () => process.env.SMTP_FROM_NAME   || 'CrewinJob';

let _transporter = null;
function _getTransporter() {
  if (_transporter) return _transporter;
  const nodemailer = require('nodemailer');
  _transporter = nodemailer.createTransport({
    host: SMTP_HOST(),
    port: SMTP_PORT(),
    secure: SMTP_PORT() === 465,
    auth: { user: SMTP_USER(), pass: SMTP_PASSWORD() },
  });
  return _transporter;
}

// CrewinJob logosu — CID (Content-ID) ile gömülür, e-posta şablonu <img src="cid:crewinjob-logo">
// referans verir. Harici bir URL'e bağlanmadığı için Gmail/Outlook gibi istemcilerde
// varsayılan olarak engellenmez (dış görsellerin aksine).
const LOGO_CID = 'crewinjob-logo';
let _logoAttachment;
function _getLogoAttachment() {
  if (_logoAttachment !== undefined) return _logoAttachment;
  try {
    // Beyaz (şeffaf zeminli) logo — koyu gradient header üzerinde kullanılır.
    const logoPath = require('path').join(__dirname, '..', 'assets', 'email-logo.png');
    if (require('fs').existsSync(logoPath)) {
      _logoAttachment = { filename: 'crewinjob-logo.png', path: logoPath, cid: LOGO_CID };
    } else {
      _logoAttachment = null;
    }
  } catch (_) {
    _logoAttachment = null;
  }
  return _logoAttachment;
}

/**
 * Unsubscribe linki biliniyorsa List-Unsubscribe (+ https ise RFC 8058 one-click) başlıkları.
 * @param {string} [unsubscribeUrl] — https/http veya mailto
 * @returns {Record<string,string>}
 */
function _listUnsubscribeHeaders(unsubscribeUrl) {
  if (!unsubscribeUrl) return {};
  let url;
  try { url = new URL(String(unsubscribeUrl)); } catch (_) { return {}; }
  if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return {};
  const headers = { 'List-Unsubscribe': `<${url.toString()}>` };
  if (url.protocol === 'https:') headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  return headers;
}

/**
 * Tek bir alıcıya e-posta gönderir.
 * @param {string} to      — Alıcı e-posta adresi
 * @param {string} subject — Konu
 * @param {string} html    — HTML gövde
 * @param {string} [text]  — Düz metin alternatifi (verilmezse html'den türetilir)
 * @param {Record<string,string>} [headers] — Ek SMTP header'ları (ör. X-SES-MESSAGE-TAGS, X-SES-CONFIGURATION-SET —
 *   bounce/complaint bildirimlerinde userId'yi geri alabilmek için)
 * @param {string} [unsubscribeUrl] — Alıcının unsubscribe linki → List-Unsubscribe başlıkları
 * @returns {{ success: boolean, messageId?: string, error?: string }}
 */
async function sendEmail(to, subject, html, text, headers, unsubscribeUrl) {
  if (!SMTP_HOST() || !SMTP_USER() || !SMTP_PASSWORD() || !SMTP_FROM()) {
    return {
      success: false,
      error: 'E-posta yapılandırılmamış. .env içinde SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL ayarlayın.',
    };
  }
  try {
    const transporter = _getTransporter();
    const logo = _getLogoAttachment();
    const allHeaders = { ...(headers || {}), ..._listUnsubscribeHeaders(unsubscribeUrl) };
    const info = await transporter.sendMail({
      from: `"${SMTP_FROM_NAME()}" <${SMTP_FROM()}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      headers: Object.keys(allHeaders).length ? allHeaders : undefined,
      attachments: logo ? [logo] : undefined,
    });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Birden fazla alıcıya toplu e-posta gönderir (SES rate-limit için 300ms aralık).
 * @param {string[]} recipients — Alıcı e-posta listesi
 * @param {string} subject
 * @param {string} html
 * @param {string} [text]
 * @param {string} [unsubscribeUrl] — Ortak unsubscribe linki (List-Unsubscribe başlığı için)
 * @returns {{ sent: number, failed: number, errors: string[] }}
 */
async function broadcastEmail(recipients, subject, html, text, unsubscribeUrl) {
  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const to of recipients) {
    const result = await sendEmail(to, subject, html, text, undefined, unsubscribeUrl);
    if (result.success) {
      sent++;
    } else {
      failed++;
      errors.push(`${to}: ${result.error}`);
    }
    // AWS SES varsayılan sandbox/production rate-limit'e göre güvenli aralık
    await new Promise(r => setTimeout(r, 300));
  }

  return { sent, failed, errors };
}

/**
 * Kişiselleştirilmiş toplu e-posta (her alıcı için farklı konu/HTML/düz metin/header — ör. unsubscribe linki,
 * bounce takibi için X-SES-MESSAGE-TAGS).
 * @param {{ to: string, html: string, subject?: string, text?: string, headers?: Record<string,string>, unsubscribeUrl?: string|null }[]} items
 * @param {string} subject — item.subject yoksa kullanılan varsayılan konu
 * @returns {{ sent: number, failed: number, errors: string[] }}
 */
async function broadcastPersonalizedEmail(items, subject) {
  let sent = 0;
  let failed = 0;
  const errors = [];
  const results = [];

  for (const item of items) {
    const result = await sendEmail(item.to, item.subject || subject, item.html, item.text || undefined, item.headers, item.unsubscribeUrl || undefined);
    if (result.success) {
      sent++;
      results.push({ to: item.to, success: true, messageId: result.messageId });
    } else {
      failed++;
      errors.push(`${item.to}: ${result.error}`);
      results.push({ to: item.to, success: false, error: result.error });
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return { sent, failed, errors, results };
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
    email: {
      configured: !!(SMTP_HOST() && SMTP_USER() && SMTP_PASSWORD() && SMTP_FROM()),
      host:      SMTP_HOST() || null,
      fromEmail: SMTP_FROM() || null,
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
  escapeTelegramHtml,
  // E-posta
  sendEmail,
  broadcastEmail,
  broadcastPersonalizedEmail,
  // Yardımcı
  getConfigStatus,
};
