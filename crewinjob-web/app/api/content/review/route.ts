/**
 * POST /api/content/review
 *
 * İçeriği AI ile değerlendirir ve geliştirilmiş versiyon önerir.
 * Puanlama kriterleri: hook gücü, CTA netliği, platform uyumu, engagement potansiyeli
 *
 * Body: { content: string, platform: string, language?: 'tr' | 'en' }
 * Returns: { score: number, strengths: string[], weaknesses: string[], improved: string }
 */
import { NextRequest, NextResponse } from 'next/server';

const REVIEW_PROMPT = (content: string, platform: string, lang: string) => `
You are a senior social media strategist reviewing a ${platform.toUpperCase()} post for CrewinJob, a maritime recruitment platform.

PLATFORM: ${platform}
LANGUAGE: ${lang === 'tr' ? 'Turkish' : 'English'}
POST TO REVIEW:
---
${content.slice(0, 3000)}
---

Evaluate this post and respond with ONLY a valid JSON object (no markdown, no preamble):
{
  "score": <integer 1-100>,
  "grade": "<A+ | A | B | C | D>",
  "summary": "<one sentence overall assessment in ${lang === 'tr' ? 'Turkish' : 'English'}>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>"],
  "hashtag_score": <integer 1-10>,
  "hook_score": <integer 1-10>,
  "cta_score": <integer 1-10>,
  "improved": "<the improved version of the post — same language, platform-optimized, ready to post>"
}

SCORING CRITERIA:
- hook_score: Does the first line stop the scroll? (10 = irresistible opener)
- cta_score: Is the call-to-action clear and actionable? (10 = very clear CTA)
- hashtag_score: Relevant, appropriate count for platform? (10 = perfect hashtag strategy)
- score: Overall 1-100 considering hook, body quality, CTA, hashtags, emojis, and platform fit

For the "improved" field:
- Keep the same language and core message
- Strengthen the opening hook
- Tighten the body (remove fluff)
- Add/improve CTA
- Optimize hashtags for ${platform}
`;

export async function POST(req: NextRequest) {
  const { content, platform, language } = await req.json() as {
    content: string;
    platform: string;
    language?: string;
  };

  if (!content?.trim()) {
    return NextResponse.json({ error: 'İçerik boş' }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY eksik' }, { status: 500 });
  }

  const lang = language === 'en' ? 'en' : 'tr';
  const plat = platform || 'instagram';

  // Önce 2.5-flash dene, 503 alırsa 2.0-flash'e düş
  const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-001', 'gemini-1.5-flash'];
  let res: Response | null = null;
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        system_instruction: {
          parts: [{
            text: 'You are a social media strategist. Respond with ONLY valid JSON — no markdown code blocks, no preamble, no trailing text.',
          }],
        },
        contents: [{ parts: [{ text: REVIEW_PROMPT(content, plat, lang) }] }],
        generationConfig: {
          temperature:      0.3,   // Düşük temperature → tutarlı puanlama
          maxOutputTokens:  2048,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (res.ok || res.status !== 503) break;
  }

  if (!res || !res.ok) {
    const errText = await res?.text() || 'Bağlantı hatası';
    return NextResponse.json({ error: `Gemini hatası: ${errText.slice(0, 100)}` }, { status: 500 });
  }

  const data   = await res.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!rawText) {
    return NextResponse.json({ error: 'Model yanıt vermedi' }, { status: 500 });
  }

  try {
    // Bazen model JSON'u markdown code block içine sarabilir
    const clean = rawText
      .replace(/^```json\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const result = JSON.parse(clean);
    return NextResponse.json(result);
  } catch {
    // JSON parse hata → ham metni döndür
    return NextResponse.json({ error: 'JSON parse hatası', raw: rawText.slice(0, 500) }, { status: 500 });
  }
}
