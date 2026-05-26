// ─── Gemini AI Client — Anthropic arayüzüyle uyumlu wrapper ──────────────────
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Yedek model sırası — hepsi API listesinde mevcut ve yeni kullanıcılara açık
const MODEL_FALLBACKS = [
  'gemini-2.5-flash',       // birincil — bazen 503
  'gemini-2.5-flash-lite',  // kararlı yedek (Temmuz 2025)
  'gemini-2.0-flash-lite',  // son yedek
];

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function shouldRetry(err) {
  const msg = err?.message || '';
  return (
    msg.includes('503') ||
    msg.includes('Service Unavailable') ||
    msg.includes('no longer available') ||
    msg.includes('not found for API version') ||
    msg.includes('404')
  );
}

async function generateWithRetry(prompt, preferredModel) {
  // Tercih edilen model önce, sonra fallback'ler
  const models = preferredModel
    ? [preferredModel, ...MODEL_FALLBACKS.filter(m => m !== preferredModel)]
    : MODEL_FALLBACKS;
  let lastError;
  for (let i = 0; i < models.length; i++) {
    const modelName = models[i];
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      lastError = err;
      const retry = shouldRetry(err);
      const isLast = i === models.length - 1;
      if (retry && !isLast) {
        console.warn(`[ai-client] ${modelName} hata (${err.message?.slice(0, 60)}) — ${MODEL_FALLBACKS[i + 1]} deneniyor...`);
        await sleep(1500);
        continue;
      }
      break;
    }
  }
  throw lastError;
}

const messages = {
  async create({ system, messages: msgs, model: preferredModel }) {
    const userContent = msgs.find(m => m.role === 'user')?.content || '';
    const prompt = system ? `${system}\n\n${userContent}` : userContent;
    const text = await generateWithRetry(prompt, preferredModel);
    return { content: [{ text }] };
  }
};

module.exports = { messages };
