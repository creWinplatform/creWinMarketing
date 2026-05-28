// ─── İçerik Üretici — Gemini API ile ─────────────────────────────────────────
const client = require('./ai-client');
const config = require('./config');

// ─── Platform prompt'ları ─────────────────────────────────────────────────────
const PLATFORM_PROMPTS = {

  instagram: (data, type) => `
Sen crewinjob.com'un sosyal medya uzmanısın. ${config.brand.tone}

Platform: Instagram
İçerik tipi: ${type}
Marka: ${config.site.name} — "${config.site.slogan}"

VERİ:
${JSON.stringify(data, null, 2)}

GÖREV: Aşağıdakileri içeren bir Instagram postu yaz:
1. 📸 GÖRSEL BRIEF: Görselde ne olmalı (tasarımcıya yönelik)
2. 📝 CAPTION: Max 2200 karakter, hook ile başla
3. #️⃣ HASHTAG'LER: 15-20 adet, karışık (${config.brand.hashtags.core.join(' ')} + ilgili)
4. 📱 STORIES VERSİYONU: 3 slide için kısa metin

Türkçe ve İngilizce AYRI AYRI yaz.
Tone: ${config.brand.tone}
`,

  facebook: (data, type) => `
Sen crewinjob.com'un sosyal medya uzmanısın. ${config.brand.tone}

Platform: Facebook
İçerik tipi: ${type}
Marka: ${config.site.name} — "${config.site.slogan}"

VERİ:
${JSON.stringify(data, null, 2)}

GÖREV:
1. 📝 FACEBOOK POST:
   - Sıcak, samimi ve topluluk odaklı ton
   - Dikkat çekici açılış → kısa paragraflar → etkileşim sorusu ile bitir
   - Post sonunda yeni satırda 3-5 hashtag ekle: #CrewinJob #Maritime #Seafarer + konuya özgü 1-2 etiket
   - 2-4 emoji doğal şekilde kullan
   - Max 500 kelime
2. 🖼️ GÖRSEL BRIEF: Görselde ne olmalı (1-2 cümle)
3. 📌 PINNED POST VERSİYONU: Pin'lenecek daha kısa versiyon (varsa)

Türkçe ve İngilizce AYRI AYRI yaz.
`,

  twitter: (data, type) => `
Sen crewinjob.com'un sosyal medya uzmanısın. ${config.brand.tone}

Platform: Twitter/X
İçerik tipi: ${type}
Marka: ${config.site.name}

VERİ:
${JSON.stringify(data, null, 2)}

GÖREV: Her biri 280 karakter altında olmak üzere:
1. 🐦 ANA TWEET: Dikkat çekici, CTA ile biter
2. 🧵 THREAD: Eğer içerik uzunsa 3-5 tweet'lik thread yaz (her biri 1/, 2/ formatında)
3. 💬 REPLY HOOK: Engagement için "sizin favori ____?" tarzı takip tweeti

Türkçe ve İngilizce AYRI AYRI yaz.
Max hashtag: 2
`,

  linkedin: (data, type) => `
Sen crewinjob.com'un sosyal medya uzmanısın. ${config.brand.tone}

Platform: LinkedIn
İçerik tipi: ${type}
Marka: ${config.site.name} — "${config.site.slogan}"

VERİ:
${JSON.stringify(data, null, 2)}

GÖREV:
1. 💼 LİNKEDİN POSTU:
   - İlk 2 satır: Scroll'u durduracak kadar güçlü hook
   - "...daha fazla gör" öncesinde merak uyandır
   - Kişisel ve samimi ton
   - Sonunda soru veya CTA
   - Max 3000 karakter
2. 🏷️ HASHTAG'LER: 5 adet, sektör + platform odaklı
3. 📰 ARTICLE VERSİYONU: Eğer uzun içerikse LinkedIn Article için genişletilmiş versiyon başlığı ve outline

Türkçe ve İngilizce AYRI AYRI yaz.
`,

  tiktok: (data, type) => `
Sen crewinjob.com'un TikTok içerik uzmanısın. ${config.brand.tone}

Platform: TikTok
İçerik tipi: ${type}
Marka: ${config.site.name}

VERİ:
${JSON.stringify(data, null, 2)}

GÖREV: Viral potansiyelli TikTok video scripti yaz:

1. 🎬 VİDEO SCRİPT (60 saniye):
   - HOOK (0-3 sn): İzleyiciyi durduracak ilk cümle — "POV:", "Bu videoyu görmeden gemi adamı olma" gibi
   - BODY (3-50 sn): Ana içerik, hızlı tempo
   - CTA (50-60 sn): Takip et, link bio'da, yorum yap

2. 📱 KISA VERSİYON (15 saniye): Sadece hook + CTA

3. 🎵 MÜZİK ÖNERİSİ: Trenddeki ses / müzik tipi

4. 📝 CAPTION: Max 150 karakter + 8 hashtag
   (${config.brand.hashtags.tiktok.join(' ')} + özel)

5. 💬 COMMENT HOOK: İlk yorum olarak atılacak metin (engagement artırır)

İngilizce yaz (global kitle), Türkçe altyazı notu ekle.
`,
};

// ─── Tek içerik üret ──────────────────────────────────────────────────────────
async function generateContent(platform, contentType, data, model) {
  const promptFn = PLATFORM_PROMPTS[platform];
  if (!promptFn) throw new Error(`Bilinmeyen platform: ${platform}`);

  const prompt = promptFn(data, contentType);

  const response = await client.messages.create({
    model: model || 'gemini-2.5-flash-lite',
    max_tokens: 2000,
    system: `Sen crewinjob.com için çalışan deneyimli bir dijital pazarlama uzmanısın.
Denizcilik sektörünü iyi bilirsin. Ürettiğin içerikler özgün, platform'a özgü ve yüksek engagement'lı olur.
Her zaman hem Türkçe hem İngilizce versiyon üret (açıkça belirtilmedikçe).
Çıktını düzenli ve net bölümler halinde sun.`,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

// ─── Haftalık takvim üret ─────────────────────────────────────────────────────
async function generateWeeklyContent(jobData) {
  const schedule = config.contentCalendar.weeklySchedule;
  const results  = {};
  const days     = Object.entries(schedule);

  console.log(`\n  🤖 ${days.length} günlük içerik üretiliyor...\n`);

  for (const [day, { platform, type, note }] of days) {
    process.stdout.write(`  📅 ${day.toUpperCase()} — ${platform} (${note})... `);

    // Her platform için uygun veri hazırla
    const contentData = prepareDataForPlatform(platform, type, jobData);

    try {
      const content = await generateContent(platform, type, contentData);
      results[day]  = { platform, type, note, content, generatedAt: new Date().toISOString() };
      console.log('✅');
    } catch (err) {
      results[day] = { platform, type, note, content: null, error: err.message };
      console.log('❌ ' + err.message);
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }

  return results;
}

// ─── Tek platform için içerik üret ───────────────────────────────────────────
async function generateSinglePlatform(platform, type, jobData, model) {
  const data = prepareDataForPlatform(platform, type, jobData);
  return await generateContent(platform, type, data, model);
}

// ─── Platform'a göre veri hazırla ────────────────────────────────────────────
function prepareDataForPlatform(platform, type, jobData) {
  const base = {
    brand:     config.site.name,
    slogan:    config.site.slogan,
    siteUrl:   config.site.url,
    stats:     jobData.stats,
    date:      new Date().toLocaleDateString('tr-TR'),
  };

  switch (type) {
    case 'ilan_ozeti':
      return { ...base, jobs: jobData.newJobs.slice(0, 5), totalJobs: jobData.jobs.length };

    case 'kariyer_ipucu':
      return { ...base, context: 'Denizci kariyeri geliştirme ipuçları, CV hazırlama, sertifika önerileri' };

    case 'istatistik':
      return { ...base, stats: jobData.stats, weeklyTrend: '15% artış bu hafta' };

    case 'platform_tanitim':
      return { ...base, features: ['BullsEye Filtering', 'Online Meeting', 'AI-powered matching', 'Crew Management'] };

    case 'motivasyon':
      return { ...base, context: 'Denizci motivasyonu, gemi hayatı, kariyer başarı hikayeleri' };

    case 'video_script':
      return { ...base, jobs: jobData.newJobs.slice(0, 3), format: 'TikTok 60 saniye' };

    case 'topluluk_sorusu':
      return { ...base, context: 'Denizci topluluğuna yönelik engagement sorusu — deneyim, kariyer, platform' };

    case 'sektor_analizi':
      return { ...base, context: 'Denizcilik sektörü trendleri, iş piyasası analizi, 2026 öngörüleri' };

    case 'basari_hikayesi':
      return { ...base, context: 'Platform üzerinden iş bulan seafarer\'ın başarı hikayesi formatı' };

    default:
      return { ...base, jobs: jobData.jobs.slice(0, 3) };
  }
}

// ─── Platform başına temiz çıktı kuralları ────────────────────────────────────
// PLATFORM_OUTPUT_RULES artık dil parametresi alıyor
// lang = 'tr' | 'en' | undefined (undefined → ikidilli TR+EN)
function getPlatformOutputRules(platform, lang) {
  const single = !!lang; // dil seçildiyse tek dil modu

  const langNote = single
    ? `- Write ONLY in ${lang === 'en' ? 'English' : 'Turkish'} — absolutely NO second language, NO "---" separator`
    : `- Write TR version first, then "---" separator, then EN version`;

  const rules = {
    twitter: `OUTPUT RULES FOR TWITTER:
- Output ONLY the tweet text (max 280 chars)
- ONE complete tweet — no mid-sentence cuts
${langNote}
- NO headers, NO "Tweet:" labels, NO "Ana Tweet:", NO analysis sections
- NO "Neden Bu Tweet?", NO "Görsel Brief", NO markdown (##, **, etc.)
- End with 2-3 relevant hashtags (e.g. #CrewinJob #Maritime #Seafarer)`,

    instagram: `OUTPUT RULES FOR INSTAGRAM:
- Output ONLY the caption text
${langNote}
- Hook line → body (2-3 short paragraphs) → CTA → blank line → hashtags
- Include 15-20 hashtags on a new line: mix brand (#CrewinJob #crewinjob), maritime (#maritime #seafarer #marinelife #shipping #nautical), and topic-specific tags
- Emojis are encouraged — use naturally throughout the caption
- NO headers like "Caption:", "Instagram Postu:", NO markdown (##, **)
- NO "Görsel Brief", NO analysis sections`,

    linkedin: `OUTPUT RULES FOR LINKEDIN:
- Output ONLY the post text (max 3000 chars)
${langNote}
- Strong hook (first 2 lines must stop the scroll — no "I am happy to share" clichés)
- Hook → insightful body paragraphs → data point or story → CTA → hashtags
- End with 3-5 professional hashtags: #Maritime #Seafarer #MaritimeRecruitment #CrewinJob + 1 topic-specific
- Short paragraphs, add line breaks for readability
- NO headers, NO markdown (##, **), NO analysis sections`,

    facebook: `OUTPUT RULES FOR FACEBOOK:
- Output ONLY the post text
${langNote}
- Warm, conversational tone — like sharing news with a community
- Structure: engaging opener → 2-3 short paragraphs → end with a question that invites comments
- After the question, add a blank line then 3-5 hashtags: #CrewinJob #Maritime #Seafarer + 1-2 topic-specific (e.g. #JobOpportunity #SeafarerLife #MaritimeJobs)
- Use 2-4 emojis placed naturally — not clustered at the end
- NO headers, NO markdown (##, **), NO analysis sections`,

    tiktok: `OUTPUT RULES FOR TIKTOK:
- Output ONLY: [60-sec script] then "---" then [caption + hashtags]
${langNote}
- Label sections simply as "SCRIPT:" and "CAPTION:"
- Caption must include 8-10 hashtags: #CrewinJob #Maritime #Seafarer #SeafarerLife #MaritimeCareers + trending maritime tags
- NO extra analysis, NO markdown headers`,
  };

  return rules[platform] || rules.instagram;
}

// ─── Ton modifikatörleri (A/B Varyant) ───────────────────────────────────────
const TONE_MODIFIERS = {
  professional: 'TONE: Write in a strictly professional, authoritative tone. No emojis. Formal language, industry terminology.',
  casual:       'TONE: Write in a casual, friendly, conversational tone. Use emojis naturally. Speak like a colleague.',
  emotional:    'TONE: Write in an emotional, inspiring, storytelling tone. Speak from the heart. Use vivid imagery — the sound of the sea, the pride of a seafarer, the journey ahead. Make the reader feel something.',
  data_driven:  'TONE: Lead with statistics and data. Use numbers and percentages to make points. Be precise and factual.',
  humorous:     'TONE: Write with light humor and wit — the kind that maritime professionals would appreciate. Relatable, fun, but still on-brand. Avoid sarcasm.',
  urgency:      'TONE: Create a sense of urgency. Highlight time-sensitive opportunities. Use strong action verbs. FOMO-inducing but honest.',
};

// ─── Serbest prompt ile içerik üret ──────────────────────────────────────────
async function generateWithCustomPrompt(platform, customPrompt, jobData, model, language, tone) {
  const data = {
    brand:   config.site.name,
    slogan:  config.site.slogan,
    siteUrl: config.site.url,
    stats:   jobData.stats,
    date:    new Date().toLocaleDateString('tr-TR'),
    jobs:    (jobData.newJobs || jobData.jobs || []).slice(0, 5),
  };

  // Dil zorlaması — önce tanımla
  const lang = language === 'en' ? 'en' : 'tr';
  const langInstruction = lang === 'tr'
    ? 'LANGUAGE: Write ONLY in Turkish. Do NOT write an English version. Output single-language Turkish post only.'
    : 'LANGUAGE: Write ONLY in English. Do NOT write a Turkish version. Output single-language English post only.';

  // Platform çıktı kuralları (dil parametresiyle — ikidilli satırları override eder)
  const outputRules = getPlatformOutputRules(platform, lang);

  // Ton modifikatörü
  const toneInstruction = tone && TONE_MODIFIERS[tone] ? TONE_MODIFIERS[tone] : '';

  const prompt = `Platform: ${platform.toUpperCase()}
Brand: ${config.site.name} — "${config.site.slogan}" — ${config.site.url}

CONTEXT DATA:
- Total jobs on platform: ${data.stats?.totalJobs || 'N/A'}
- Date: ${data.date}

${langInstruction}
${toneInstruction ? `\n${toneInstruction}` : ''}
USER REQUEST:
${customPrompt}

${outputRules}

Write the post now:`;

  // Platform'a özgü ek kural
  const platformExtraRule = platform === 'facebook'
    ? 'HASHTAG RULE: Always end the post with 3-5 relevant hashtags on a new line. Required tags: #CrewinJob #Maritime — add 1-3 topic-specific tags.'
    : platform === 'instagram'
    ? 'HASHTAG RULE: Always end with 15-20 hashtags on a new line. Include #CrewinJob #maritime #seafarer #marinelife #shipping and topic-specific tags.'
    : platform === 'linkedin'
    ? 'HASHTAG RULE: End with 3-5 professional hashtags. Include #Maritime #CrewinJob and relevant industry tags.'
    : platform === 'twitter'
    ? 'HASHTAG RULE: Include 2-3 hashtags inline or at the end. Keep total tweet under 280 chars.'
    : '';

  const response = await client.messages.create({
    model:      model || 'gemini-2.5-flash-lite',
    max_tokens: 2000,
    system: `You are a social media copywriter for CrewinJob, a maritime recruitment platform connecting seafarers with shipping companies worldwide.
You write clean, engaging, ready-to-post social media content with appropriate hashtags.
STRICT RULE: Output ONLY the post text. No analysis, no explanations, no "Here is your post", no markdown headers (##, **bold**), no "Görsel Brief", no "Neden Bu İçerik?" sections.
Just the post content, ready to copy-paste.
${lang === 'tr' ? 'LANGUAGE RULE: Write ONLY in Turkish. Absolutely no English version.' : 'LANGUAGE RULE: Write ONLY in English. Absolutely no Turkish version.'}
${platformExtraRule}`,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text;
}

module.exports = { generateContent, generateWeeklyContent, generateSinglePlatform, generateWithCustomPrompt };
