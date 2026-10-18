/**
 * POST /api/content/refine
 *
 * Üretilmiş bir içeriği kullanıcının serbest metin talimatıyla düzenler
 * ("hashtag'leri azalt", "daha kısa yap", "IMHFC standını vurgula" gibi).
 *
 * /api/content/review'dan farkı: review içeriği PUANLAR ve kendi kriterlerine
 * göre iyileştirir; burada ise yalnızca kullanıcının söylediği değişiklik
 * yapılır, geri kalan metne dokunulmaz.
 *
 * Body: { content: string, instruction: string, platform?: string, language?: 'tr' | 'en' }
 * Returns: { content: string }
 */
import { NextRequest, NextResponse } from 'next/server';

// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const REFINE_PROMPT = (content: string, instruction: string, platform: string, lang: string) => {
  const postLang = lang === 'tr' ? 'Turkish' : 'English';
  return `
You are a professional copy editor revising an existing ${platform.toUpperCase()} post for CrewinJob, a maritime recruitment platform.

THE POST IS WRITTEN IN ${postLang.toUpperCase()}. Your output must be entirely in ${postLang}.

USER'S REQUEST:
---
${instruction.slice(0, 800)}
---

CURRENT POST:
---
${content.slice(0, 4000)}
---

HOW TO READ THE REQUEST — read this carefully, it is where edits usually go wrong:
- The request is a BRIEF describing what should change. It is NEVER text to copy into the post verbatim.
- The request is often written in a DIFFERENT LANGUAGE than the post (the user's own language). That is normal.
  You must understand its meaning and then express it in ${postLang}. Never leave the user's wording,
  or any fragment of it, in the post in its original language.
- The request may be phrased as bare facts rather than a command (e.g. just a date, a place, a booth number).
  Treat bare facts as "incorporate this information into the post".
- Convert facts to ${postLang} conventions: date formats, month names, and the accepted ${postLang} form of
  institution and place names.

HOW TO PLACE AN ADDITION:
- Find the sentence or paragraph the new information actually belongs to and integrate it THERE, rewording that
  sentence so it reads as though it was written that way from the start.
- Never insert a bare standalone line between paragraphs. Never append the information at the end as a leftover
  fragment. If the addition genuinely warrants its own sentence, it still belongs inside the relevant paragraph.
- Example of the required behaviour — a Turkish request against an English post:
    Request:  "etkinlik 3-4 Eylül de ITU Denizcilik Fakültesinde olacak"
    WRONG:    a new line reading "etkinlik 3-4 Eylül de ITU Denizcilik Fakültesinde olacak"
    WRONG:    a new line reading "The event is on 3-4 September at ITU Maritime Faculty."
    RIGHT:    the existing sentence about the conference becomes
              "...the International Maritime Human Factors Conference 2026, taking place on 3-4 September at
              the ITU Maritime Faculty, a pivotal event bringing together..."

OTHER RULES:
- Change ONLY what the request concerns. Do not rewrite, restructure or "improve" untouched sentences.
- Preserve the existing formatting: paragraph breaks, emoji usage, and the hashtag block at the end
  (unless the request concerns them).
- Keep the CrewinJob brand voice: professional, warm, maritime-focused.
- When removing something, remove it cleanly — no dangling punctuation, no leftover blank lines.
- If the request cannot be applied at all, return the post unchanged.

Respond with ONLY the full edited post text. No preamble, no explanation, no markdown code fences, no commentary.
`;
};

export async function POST(req: NextRequest) {
  const { content, instruction, platform, language } = await req.json() as {
    content:     string;
    instruction: string;
    platform?:   string;
    language?:   string;
  };

  if (!content?.trim())     return NextResponse.json({ error: 'İçerik boş' },  { status: 400 });
  if (!instruction?.trim()) return NextResponse.json({ error: 'Talimat boş' }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY eksik' }, { status: 500 });

  const lang = language === 'en' ? 'en' : 'tr';
  const plat = platform || 'instagram';

  // Kota/sunucu hatasında (429/5xx) 2.5-flash-lite'a düş (1.5-flash ve 2.0-flash emekliye ayrıldı)
  const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  let res: Response | null = null;
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        system_instruction: {
          parts: [{
            text: 'You are a precise copy editor. You apply exactly the change requested and return only the resulting text — never explanations, never markdown fences. The user\'s request is a brief, never literal text to paste: understand it, then write the result in the language of the post being edited.',
          }],
        },
        contents: [{ parts: [{ text: REFINE_PROMPT(content, instruction, plat, lang) }] }],
        generationConfig: {
          // Düşük sıcaklık: talimat dışına çıkıp metni yeniden yazmasını engeller
          temperature:     0.4,
          // Düşünme kapalı: bu hedefli bir düzenleme işi, muhakeme gerektirmiyor.
          // 2.5-flash'ta düşünme varsayılan olarak açık ve jetonları çıktı
          // bütçesinden harcıyor — kalite katkısı olmadan maliyet üretiyordu.
          thinkingConfig:  { thinkingBudget: 0 },
          maxOutputTokens: 2048,
        },
      }),
    }).catch(() => null);   // ağ hatası → sonraki model
    if (res && (res.ok || !RETRYABLE.has(res.status))) break;
  }

  if (!res || !res.ok) {
    const errText = await res?.text() || 'Bağlantı hatası';
    return NextResponse.json({ error: `Gemini hatası: ${errText.slice(0, 100)}` }, { status: 500 });
  }

  const data    = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!rawText) return NextResponse.json({ error: 'Model yanıt vermedi' }, { status: 500 });

  // Model yine de code fence sararsa temizle
  const clean = rawText
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  return NextResponse.json({ content: clean });
}
