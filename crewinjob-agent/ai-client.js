// ─── Gemini AI Client — Anthropic arayüzüyle uyumlu wrapper ──────────────────
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs   = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const DATA_DIR   = path.join(__dirname, 'data');
const USAGE_FILE = path.join(DATA_DIR, 'api-usage.json');

// ── Model bazlı fiyatlandırma (USD / 1M token, yaklaşık liste fiyatı) ─────────
// Google fiyatları değişirse burayı güncelleyin. Düşünme (thinking) tokenları çıktı
// fiyatından faturalandığı için çıktı token'ına dahil edilir.
const PRICE_TIERS = {
  'flash-lite': { input: 0.10, output: 0.40 },
  'flash':      { input: 0.30, output: 2.50 },
  'pro':        { input: 1.25, output: 10.00 },
};

// Bilinen modeller → fiyat katmanı. Listede olmayan model flash fiyatıyla hesaplanır ve işaretlenir.
const MODEL_TIERS = {
  'gemini-flash-lite-latest': 'flash-lite',
  'gemini-2.5-flash-lite':    'flash-lite',
  'gemini-2.0-flash-lite':    'flash-lite',
  'gemini-flash-latest':      'flash',
  'gemini-2.5-flash':         'flash',
  'gemini-2.0-flash':         'flash',
  'gemini-3-flash-preview':   'flash',
  'gemini-2.5-pro':           'pro',
  'gemini-3.1-pro-preview':   'pro',
};

function priceFor(modelName) {
  const tier = MODEL_TIERS[modelName];
  if (tier) return { tier, rates: PRICE_TIERS[tier], unpriced: false };
  return { tier: 'flash', rates: PRICE_TIERS.flash, unpriced: true };
}

function _today() { return new Date().toISOString().slice(0, 10); }

function _emptyDay() {
  return { inputTokens: 0, outputTokens: 0, calls: 0, filtered: 0, costUsd: 0, byModel: {} };
}

// Atomik yazım: önce geçici dosya, sonra rename — web süreci ve CLI aynı anda yazsa da
// okuyucu yarım JSON görmez.
function _writeUsage(data) {
  const tmp = `${USAGE_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, USAGE_FILE);
}

function trackUsage(modelName, promptTokens, outputTokens) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    let data = {};
    try { data = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8')); } catch {}
    const d = _today();
    if (!data[d]) data[d] = _emptyDay();
    const day = data[d];
    if (!day.byModel) day.byModel = {};

    const inTok  = promptTokens || 0;
    const outTok = outputTokens || 0;
    const { tier, rates, unpriced } = priceFor(modelName);
    const callCost = (inTok * rates.input + outTok * rates.output) / 1_000_000;

    day.inputTokens  += inTok;
    day.outputTokens += outTok;
    day.calls        += 1;
    day.costUsd       = +((day.costUsd || 0) + callCost).toFixed(6);

    const m = day.byModel[modelName] || (day.byModel[modelName] = { tier, inputTokens: 0, outputTokens: 0, calls: 0, costUsd: 0 });
    m.inputTokens  += inTok;
    m.outputTokens += outTok;
    m.calls        += 1;
    m.costUsd       = +((m.costUsd || 0) + callCost).toFixed(6);
    if (unpriced) {
      // Fiyatı bilinmeyen model: flash fiyatıyla tahmin edildi — rapor ekranında işaretlenir
      m.unpriced = true;
      day.unpricedModels = Array.from(new Set([...(day.unpricedModels || []), modelName]));
    }

    // Son 30 günü tut
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    Object.keys(data).forEach(k => { if (k < cutoff) delete data[k]; });
    _writeUsage(data);
  } catch {}
}

function trackFiltered() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    let data = {};
    try { data = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8')); } catch {}
    const d = _today();
    if (!data[d]) data[d] = _emptyDay();
    data[d].filtered = (data[d].filtered || 0) + 1;
    _writeUsage(data);
  } catch {}
}

function loadUsage() {
  try { return JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8')); } catch { return {}; }
}

// Yedek model sırası — hata durumunda sırayla denenir
// 'latest' alias'ları Google tarafında otomatik güncel tutulur (model emekli olunca 404 vermez)
const MODEL_FALLBACKS = [
  'gemini-flash-lite-latest', // birincil — alias, her zaman güncel & en dayanıklı
  'gemini-2.5-flash-lite',    // ikincil — sabit sürüm
  'gemini-flash-latest',      // alias — güncel flash (daha güçlü)
  'gemini-2.5-flash',         // sabit sürüm
  'gemini-2.0-flash',         // son yedek
];

// Web'den (ModelPicker) gelebilecek + modüllerin kullandığı model ID'leri.
// Listede olmayan değer (elle düzenlenmiş localStorage, eski/emekli model, keyfi string)
// varsayılana (fallback zinciri) düşer — keyfi model adı Gemini'ye iletilmez.
const ALLOWED_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-2.0-flash-lite',
  ...MODEL_FALLBACKS,
]);

function resolveModel(name) {
  if (!name) return null;
  if (ALLOWED_MODELS.has(name)) return name;
  console.warn(`[ai-client] İzin verilmeyen model "${String(name).slice(0, 60)}" — varsayılan kullanılıyor`);
  return null;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function shouldRetry(err) {
  const msg = (err?.message || '').toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('service unavailable') ||
    msg.includes('no longer available') ||
    msg.includes('not found for api version') ||
    msg.includes('404') ||
    msg.includes('error fetching from') ||   // Gemini SDK ağ hatası
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('fetch failed') ||
    msg.includes('zaman aşımı')              // bizim timeout hatamız
  );
}

// ── 429 / kota hataları ───────────────────────────────────────────────────────
const RATE_LIMIT_RETRIES   = 2;      // aynı modelde en fazla 2 ek deneme
const RATE_LIMIT_BASE_MS   = 2_000;  // 2s, 4s (+ jitter)
const RATE_LIMIT_MAX_WAIT  = 20_000; // daha uzun bekleme isteniyorsa bekleme, sonraki modele geç

function isRateLimit(err) {
  const msg = (err?.message || '').toLowerCase();
  return (
    err?.status === 429 ||
    msg.includes('429') ||
    msg.includes('too many requests') ||
    msg.includes('resource_exhausted') ||
    msg.includes('resource has been exhausted') ||
    msg.includes('quota')
  );
}

// Günlük kota dolduysa aynı modelde beklemek anlamsız → doğrudan sonraki modele geç
function isDailyQuota(err) {
  const msg = (err?.message || '').toLowerCase();
  if (msg.includes('perday') || msg.includes('per day')) return true;
  const details = Array.isArray(err?.errorDetails) ? err.errorDetails : [];
  return details.some(d => Array.isArray(d?.violations) &&
    d.violations.some(v => /perday/i.test(String(v?.quotaId || ''))));
}

// Retry-After: SDK HTTP header'larını dışarı vermiyor; Google'ın RetryInfo detayını
// (errorDetails[].retryDelay, ör. "33s") veya mesajdaki "retry in 33.5s" ifadesini kullan.
function retryAfterMs(err) {
  const details = Array.isArray(err?.errorDetails) ? err.errorDetails : [];
  for (const d of details) {
    if (d && typeof d.retryDelay === 'string') {
      const secs = parseFloat(d.retryDelay);
      if (Number.isFinite(secs)) return Math.ceil(secs * 1000);
    }
  }
  const m = /retry(?:[- ]after|\s+in)\s*:?\s*([\d.]+)\s*s/i.exec(err?.message || '');
  if (m) {
    const secs = parseFloat(m[1]);
    if (Number.isFinite(secs)) return Math.ceil(secs * 1000);
  }
  return null;
}

// null → bu modelde bekleme (sonraki modele geç)
function rateLimitWaitMs(err, attempt) {
  const hinted = retryAfterMs(err);
  if (hinted !== null) return hinted <= RATE_LIMIT_MAX_WAIT ? hinted : null;
  return Math.min(RATE_LIMIT_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 500), RATE_LIMIT_MAX_WAIT);
}

const REQUEST_TIMEOUT_MS = 25_000;

// @google/generative-ai SDK'sının generateContent'i kendi timeout'unu desteklemiyor —
// ağ bağlantısı takılırsa (VPN/proxy/DNS kesintisi vb.) hiç hata fırlatmadan sonsuza kadar
// bekliyor. Bu da fallback zincirinin hiç devreye girmemesine ve isteğin kalıcı olarak
// asılı kalmasına yol açıyordu. Promise.race ile zorla zaman aşımı ekliyoruz.
// Zamanlayıcı iş bitince temizlenir — aksi halde CLI süreci 25 sn boyunca kapanmıyordu.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini isteği zaman aşımı (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Gemini 2.5+/3 "thinking" modellerinde düşünme tokenları maxOutputTokens'a dahildir.
// Çağıranın max_tokens'ı GÖRÜNÜR çıktı bütçesi olarak korunur; düşünme için ek pay bırakılır,
// aksi halde düşük limitlerde (ör. 600) yanıt boş/kesik dönebilir.
const THINKING_HEADROOM_TOKENS = 8192;

function usesThinking(modelName) {
  const m = String(modelName || '').toLowerCase();
  if (m.includes('lite')) return false; // lite modellerde thinking varsayılan kapalı
  return /gemini-(2\.5|3)/.test(m) || m === 'gemini-flash-latest';
}

function buildModelParams(modelName, options) {
  const params = { model: modelName };
  if (options.systemInstruction) params.systemInstruction = options.systemInstruction;
  if (options.maxOutputTokens) {
    params.generationConfig = {
      maxOutputTokens: options.maxOutputTokens + (usesThinking(modelName) ? THINKING_HEADROOM_TOKENS : 0),
    };
  }
  return params;
}

/**
 * @param {string|{contents:Array}} prompt  — düz metin ya da hazır Gemini contents isteği
 * @param {string} [preferredModel]         — allowlist dışındaysa yok sayılır
 * @param {{systemInstruction?:string, maxOutputTokens?:number}} [options]
 */
async function generateWithRetry(prompt, preferredModel, options = {}) {
  // Tercih edilen model önce, sonra fallback'ler
  const preferred = resolveModel(preferredModel);
  const models = preferred
    ? [preferred, ...MODEL_FALLBACKS.filter(m => m !== preferred)]
    : MODEL_FALLBACKS;
  let lastError;
  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];
    const isLast = i === models.length - 1;

    for (let attempt = 0; ; attempt++) {
      try {
        const model = genAI.getGenerativeModel(buildModelParams(modelName, options));
        const result = await withTimeout(model.generateContent(prompt), REQUEST_TIMEOUT_MS);
        const usage = result.response.usageMetadata;
        if (usage) {
          trackUsage(modelName, usage.promptTokenCount, (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0));
        }
        return result.response.text();
      } catch (err) {
        lastError = err;
        // 429 / kota: aynı modelde üstel geri çekilme ile tekrar dene (retry-after'a uy)
        if (isRateLimit(err) && attempt < RATE_LIMIT_RETRIES && !isDailyQuota(err)) {
          const wait = rateLimitWaitMs(err, attempt);
          if (wait !== null) {
            console.warn(`[ai-client] ${modelName} 429/kota — ${Math.round(wait / 100) / 10}s sonra tekrar (${attempt + 1}/${RATE_LIMIT_RETRIES})`);
            await sleep(wait);
            continue;
          }
        }
        break;
      }
    }

    const retry = shouldRetry(lastError) || isRateLimit(lastError);
    if (retry && !isLast) {
      console.warn(`[ai-client] ${modelName} hata (${lastError.message?.slice(0, 60)}) — ${models[i + 1]} deneniyor...`);
      await sleep(500); // 1500ms → 500ms: daha hızlı fallback
      continue;
    }
    break;
  }
  throw lastError;
}

// Anthropic tarzı içerik → düz metin ("string" ya da [{type:'text', text}] dizisi)
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(p => (typeof p === 'string' ? p : (p && typeof p.text === 'string' ? p.text : '')))
      .filter(Boolean)
      .join('\n');
  }
  return content == null ? '' : String(content);
}

// Anthropic messages → Gemini contents: user→user, assistant→model.
// Ardışık aynı roldeki mesajlar tek turda birleştirilir (Gemini rol sırasını bekler).
function toGeminiContents(msgs) {
  const contents = [];
  for (const m of msgs || []) {
    if (!m) continue;
    const role = m.role === 'assistant' || m.role === 'model' ? 'model' : 'user';
    const text = contentToText(m.content);
    if (!text) continue;
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) prev.parts.push({ text });
    else contents.push({ role, parts: [{ text }] });
  }
  return contents;
}

const messages = {
  async create({ system, messages: msgs, model: preferredModel, max_tokens }) {
    const contents = toGeminiContents(msgs);
    if (!contents.length) throw new Error('ai-client: boş mesaj listesi');
    const text = await generateWithRetry({ contents }, preferredModel, {
      systemInstruction: system ? contentToText(system) : undefined,
      maxOutputTokens:   Number.isFinite(max_tokens) && max_tokens > 0 ? Math.floor(max_tokens) : undefined,
    });
    return { content: [{ text }] };
  }
};

module.exports = { messages, generateWithRetry, trackFiltered, loadUsage, resolveModel, ALLOWED_MODELS };
