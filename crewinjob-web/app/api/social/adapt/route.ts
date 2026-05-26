import { NextRequest, NextResponse } from 'next/server';

const PLATFORM_RULES: Record<string, { limit: number; name: string; format: string }> = {
  twitter: {
    limit:  280,
    name:   'Twitter / X',
    format: `ONE single tweet in ONE language only (Turkish preferred if input contains Turkish). Max 280 chars total including hashtags. Strong hook, core message, 2-3 hashtags at the end. NO "---" separator, NO second language version, NO thread format. Just one complete, well-formed tweet.`,
  },
  instagram: {
    limit:  2200,
    name:   'Instagram',
    format: `Instagram caption: engaging opening line (hook), storytelling body, 3-5 line breaks for readability, emotional CTA, then 20-30 relevant hashtags on a new line. Emojis welcome.`,
  },
  linkedin: {
    limit:  3000,
    name:   'LinkedIn',
    format: `Professional LinkedIn post: strong opening hook, structured paragraphs, insights or data points, professional tone, soft CTA. No excessive hashtags (max 5). Line breaks for readability.`,
  },
  facebook: {
    limit:  63206,
    name:   'Facebook',
    format: `Facebook post: conversational and engaging tone, can be longer, asks a question to drive comments, uses emojis sparingly, ends with a community-engaging prompt.`,
  },
  instagram_story: {
    limit:  200,
    name:   'Instagram Story',
    format: `Ultra-short, punchy story text (max 200 chars). Single bold statement or question. High energy. Swipe-up CTA.`,
  },
  tiktok: {
    limit:  2200,
    name:   'TikTok',
    format: `TikTok caption: very short hook (first line), 3-5 relevant trending hashtags, casual Gen-Z friendly tone, optional video context.`,
  },
};

type Rule = { limit: number; name: string; format: string };

// ── AI ile uyarlama (sadece limit aşıldığında çağrılır) ───────────────────────
async function adaptWithAI(
  text: string,
  platform: string,
  rule: Rule,
  apiKey: string,
): Promise<NextResponse> {
  const prompt = `Rewrite the following social media post for ${rule.name}.

RULES (follow strictly):
1. Output ONLY the final post text — NO preamble, NO "Here is...", NO explanations, NO meta-commentary
2. Stay under ${rule.limit} characters (hard limit)
3. Same language as the input text — do NOT add a second language version
4. Keep the core message intact — do NOT invent new facts
5. The output MUST be a complete, grammatically correct sentence — never cut off mid-sentence
6. Format: ${rule.format}

INPUT POST:
---
${text.slice(0, 2000)}
---

OUTPUT (the post text only, nothing else):`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        system_instruction: {
          parts: [{
            text: 'You are a post formatter. Output ONLY the final post text — one language, complete sentences, no meta-commentary, no "Here is...", no second language version.',
          }],
        },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 1024 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini hatası: ${err.slice(0, 100)}`);
    }

    const data    = await res.json();
    const parts   = data?.candidates?.[0]?.content?.parts || [];
    const adapted = parts.find((p: { text?: string }) => p.text)?.text?.trim();

    if (!adapted) throw new Error('Model yanıt vermedi');

    // Son güvenlik: limit aşıldıysa sert kes (bu noktaya normalde gelinmemeli)
    const final = adapted.length > rule.limit ? adapted.slice(0, rule.limit - 1) + '…' : adapted;

    return NextResponse.json({ adapted: final, platform, charCount: final.length, limit: rule.limit });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Bilinmeyen hata' },
      { status: 500 },
    );
  }
}

// ── Ana POST handler ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { content, platform } = await req.json() as { content: string; platform: string };

  if (!content?.trim()) return NextResponse.json({ error: 'İçerik boş' }, { status: 400 });

  const rule = PLATFORM_RULES[platform];
  if (!rule)   return NextResponse.json({ error: 'Bilinmeyen platform' }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY eksik' }, { status: 500 });

  // ── Akıllı ön-işleme: "---" ile ayrılmış ikidilli içerik ─────────────────
  // Generator bazen TR + EN iki versiyon üretir, aralarına "---" koyar.
  // Bu durumda: ilk kısmı (Türkçe) ayır, limit'e sığıyorsa direkt döndür.
  const hasSeparator = /\n---/.test(content);
  if (hasSeparator) {
    const firstPart = content.split(/\n---/)[0].trim();
    if (firstPart.length > 0 && firstPart.length <= rule.limit) {
      // Türkçe kısım zaten sığıyor — AI'ya gerek yok, direkt döndür
      return NextResponse.json({
        adapted:   firstPart,
        platform,
        charCount: firstPart.length,
        limit:     rule.limit,
      });
    }
    // Türkçe kısım da büyükse sadece onu AI'ya gönder
    if (firstPart.length > rule.limit) {
      return adaptWithAI(firstPart, platform, rule, apiKey);
    }
  }

  // ── İçerik zaten limit içinde — uyarlamaya gerek yok ─────────────────────
  if (content.trim().length <= rule.limit) {
    return NextResponse.json({
      adapted:   content.trim(),
      platform,
      charCount: content.trim().length,
      limit:     rule.limit,
    });
  }

  // ── Limit aşılıyor — AI ile uyarla ───────────────────────────────────────
  return adaptWithAI(content, platform, rule, apiKey);
}
