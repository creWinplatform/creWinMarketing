import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

/** Gemini'nin ürettiği görseli bu piksel boyutlarına kırp/resize et */
const PLATFORM_PX: Record<string, { w: number; h: number }> = {
  instagram:    { w: 1080, h: 1080 },
  facebook:     { w: 1200, h: 630  },
  twitter:      { w: 1200, h: 675  },
  linkedin:     { w: 1200, h: 627  },
  tiktok:       { w: 1080, h: 1920 },
  blog:         { w: 1200, h: 630  },
  retention:    { w: 1080, h: 1080 },
  registration: { w: 1080, h: 1080 },
  tiktok_cta:   { w: 1080, h: 1920 },
  seo_job:      { w: 1200, h: 630  },
  kpi:          { w: 1200, h: 630  },
};

const PLATFORM_DIMS: Record<string, string> = {
  instagram:    '1:1 square (1080x1080)',
  facebook:     'wide landscape 1.91:1 (1200x630) — horizontal panoramic, wider than tall',
  twitter:      'landscape 16:9 (1200x675) — horizontal, wider than tall',
  linkedin:     'landscape 1.91:1 (1200x627) — horizontal, wider than tall',
  tiktok:       '9:16 vertical (1080x1920) — tall portrait, mobile screen',
  blog:         'landscape 16:9 (1200x630)',
  retention:    '1:1 square (1080x1080)',
  registration: '1:1 square (1080x1080)',
  tiktok_cta:   '9:16 vertical (1080x1920) — tall portrait, mobile screen',
  seo_job:      'landscape 16:9 (1200x630)',
  kpi:          'landscape 16:9 (1200x630)',
};

const CONTENT_THEMES: Record<string, string> = {
  // ── İlan & İşe Alım ──────────────────────────────────────────────────────
  ilan_ozeti:          'a confident illustrated seafarer in pristine white officer uniform standing on a large container ship deck, dramatic golden hour lighting, ocean stretching to horizon, cargo cranes visible in distance, volumetric light rays through clouds, rich navy-blue and gold color palette',
  acil_ilan:           'illustrated urgent maritime hiring scene — powerful cargo vessel surging through dark waves under spotlights, a determined seafarer with a duffel bag striding purposefully down a floodlit dock gangway, dynamic diagonal composition, high-contrast teal and amber tones',
  yeni_ilan:           'illustrated ship captain in full dress uniform receiving a glowing golden scroll at sunrise on the bridge wing, ocean sunrise casting warm amber and rose gradients across calm sea, hopeful cinematic atmosphere, soft lens flare',
  toplu_ilan:          'illustrated panoramic ocean scene with five distinct vessels — tanker, bulker, container ship, cruise liner, and tugboat — each with a glowing golden job-offer badge floating above, diverse seafarers on each bow, vibrant blue-green ocean, abundant and optimistic mood',
  sezonluk_ilan:       'illustrated festive maritime port at golden hour — decorated container ship with string lights and nautical flags, seafarers in uniform toasting a contract signing on the dock, warm amber and red tones, celebratory atmosphere',
  premium_ilan:        'illustrated luxury superyacht at Monaco-style harbor at twilight, uniformed officers on deck in formal whites, deep navy water with golden reflections, sleek modern vessel design, executive high-end atmosphere, rich jewel tones',

  // ── Kariyer & Gelişim ──────────────────────────────────────────────────────
  kariyer_ipucu:       'illustrated ship captain at a wooden chart table with navigational instruments — brass compass, detailed sea charts, warm lantern light casting golden glow across the cabin interior, inspiring and professional nautical atmosphere, deep teal and mahogany color palette',
  kariyer_yol_haritasi:'illustrated vintage-style nautical career map — a winding sea route from "Cadet" to "Captain" marked with milestone flags and rank insignia, miniature ships sailing the path, achievement stars and compass roses, warm parchment and navy tones',
  cv_rehberi:          'illustrated seafarer in professional uniform confidently holding a glowing digital CV tablet, busy international port in background with cranes and ships, clean flat modern style, confident and accomplished mood, cool blue-white palette',
  mulakat_hazirlik:    'illustrated seafarer in crisp uniform sitting across from two maritime executives at a glass table, maritime certificates and awards framed on wall, warm professional office lighting, city port view through large windows, confident and calm atmosphere',
  sertifika_rehberi:   'illustrated open nautical book with STCW certificates, endorsement stamps, and maritime badges radiating outward like a burst of achievement, graduation cap, anchor, and helm motifs, soft graduation-day atmosphere, blue and gold palette',
  maas_bilgisi:        'illustrated confident seafarer officer receiving a glowing paycheck on a ship bridge, world map on screen behind showing global voyage routes, subtle dollar and euro signs as design elements, warm optimistic lighting, clean financial-professional style',
  terfi_hikayesi:      'illustrated seafarer ascending a ship\'s ladder from cadet quarters to the captain\'s bridge, each deck labeled with a rank badge, dramatic upward perspective, warm sunset light behind, triumphant and aspirational mood',

  // ── Platform & Özellikler ──────────────────────────────────────────────────
  platform_tanitim:    'modern illustrated maritime recruitment digital interface — a glowing tablet floating above the ocean with ship silhouettes visible on screen, three diverse seafarers reaching toward it from different angles, dynamic teal and navy gradient background with subtle circuit-board patterns',
  bullseye_ozellik:    'illustrated precision matching scene — concentric rings forming a bullseye target, a glowing seafarer profile silhouette at center surrounded by orbiting ship icons connected by golden threads, futuristic blue-teal holographic UI atmosphere, tech-forward maritime illustration',
  mobil_uygulama:      'illustrated modern smartphone floating above a calm tropical ocean at sunset, maritime recruitment app interface glowing on screen with job cards and profile icons, happy seafarer in background using the app on deck, clean flat design, warm sunset palette',
  hizli_basvuru:       'illustrated one-tap magic application moment — close-up of a finger touching a glowing "Apply Now" button, a burst of light and confetti exploding outward, happy seafarer visible in background, minimalist white-and-teal style with golden accent flash',
  akilli_eslestirme:   'illustrated AI-powered maritime matching network — stylized neural network with a central glowing brain connected by golden arcs to ship icons, seafarer profiles, and company logos, deep-space navy background with constellation-like node patterns, futuristic and precise',
  bildirim_ozelligi:   'illustrated seafarer on deck at dusk checking a glowing phone notification — a bright "Perfect Match!" popup with ship and briefcase icons, warm sunset ocean behind, excited expression, modern flat illustration with amber and teal colors',

  // ── İstatistik & Veri ─────────────────────────────────────────────────────
  istatistik:          'clean illustrated maritime data visualization — elegant floating stat panels with charts and globe showing shipping lanes, seafarer silhouettes from multiple nations standing around a glowing world map, minimal professional flat design, deep navy and electric blue palette',
  kpi:                 'illustrated modern analytics dashboard floating in a maritime setting — upward bar charts and line graphs with ship icons as data points, glowing KPI bubbles, ocean visible through background windows, clean infographic style, cool blue-white with green accent highlights',
  basari_istatistigi:  'illustrated achievement celebration — giant glowing milestone numbers surrounded by confetti and nautical stars, diverse seafarers in uniform cheering with raised arms, golden trophy at center, vibrant warm-gold and deep-navy color burst, achievement and pride atmosphere',
  buyume_grafigi:      'illustrated ascending growth chart built from stacked illuminated ship containers, each tier taller than the last, ocean backdrop with rising sun, bold upward-trending composition, optimistic deep blue and golden-yellow palette',
  ulke_istatistigi:    'illustrated world globe with glowing maritime shipping routes arcing between continents, country flags as small pins, seafarer population shown as warm-light dots of varying sizes, clean infographic flat style, teal-blue globe on dark navy background',

  // ── Motivasyon & İlham ─────────────────────────────────────────────────────
  motivasyon:          'illustrated seafarer standing tall at a ship\'s bow, arms slightly raised, looking toward a dramatic ocean horizon where sunbeams pierce through storm clouds, god rays of golden light on the water, epic wide-angle cinematic composition, deep navy sea and brilliant amber sky',
  ilham_hikayesi:      'illustrated diptych — left panel: young cadet in simple clothes gazing at the sea with a small ship in hand; right panel: the same person as a confident captain on a ship bridge at golden hour; connected by a flowing painted ocean, warm and inspiring color story',
  hedef_belirleme:     'illustrated determined seafarer planting a glowing flag on top of a ship mast at sunrise, the flag bearing a bold star, dramatic upward camera angle, golden light flooding the sky, cumulus clouds behind, triumphal and aspirational composition',
  kisisel_gelisim:     'illustrated seafarer in a cozy ship cabin at night reading a glowing digital textbook, compass and star charts on the desk, soft moonlight through the porthole reflecting on calm ocean, warm amber reading light, contemplative and growth-focused atmosphere',

  // ── Topluluk & Sosyal ─────────────────────────────────────────────────────
  topluluk:            'illustrated warm community scene — eight diverse seafarers from different nations in uniform standing together on a sunlit ship deck, flags of their countries as small pins on their uniforms, handshakes and friendly gestures, golden hour lighting, inclusive and welcoming atmosphere',
  basari_hikayesi:     'illustrated authentic success moment — smiling seafarer in uniform on a ship gangway with a new contract glowing in hand, supportive colleagues in background, sunset port with cranes, genuine pride and accomplishment, warm golden tones',
  denizci_yasami:      'illustrated circular day-in-the-life mosaic — six vignette panels showing: sunrise bridge watch, chart navigation, shared crew meal, engine room inspection, deck exercise, and starlit night watch — all connected by an ocean wave motif, warm storytelling narrative style',
  liman_izni:          'illustrated seafarer in casual clothes exploring a vibrant colorful port city — famous landmark silhouette in background, local market stalls, bright tropical colors, backpack and camera, adventurous and travel-inspired atmosphere, joyful and multicultural scene',

  // ── İçerik Tipleri ────────────────────────────────────────────────────────
  video_script:        'illustrated dramatic underwater-to-surface cinematic scene — bioluminescent sea creatures in deep blue depths below, large vessel silhouette cutting the surface above, rays of light filtering down from the surface, vibrant gradient from midnight blue to turquoise, cinematic widescreen composition',
  blog:                'illustrated seafarer in a cozy chart room writing in a leather-bound journal, cup of coffee steaming beside a brass compass and nautical charts, warm golden sunset visible through porthole, candle-like atmosphere, editorial and reflective mood',
  retention:           'illustrated seafarer on a sun-drenched deck confidently updating their profile on a glowing tablet, a holographic profile card floating in the air showing completion percentage rising, golden ocean sunset behind, modern flat style with warm amber tones',
  registration:        'illustrated joyful welcome scene — group of twelve diverse seafarers in various naval uniforms celebrating together on a ship deck, confetti burst, arms raised, glowing "Welcome" arch of light, vibrant and energetic, warm community atmosphere',
  seo_job:             'illustrated dark-navy world map with glowing maritime shipping routes as bright arcs between continents, golden anchor and anchor-chain border, pulsing job-pin markers on key port cities, clean and authoritative infographic style, deep navy and electric blue',
  tiktok_cta:          'illustrated vibrant vertical scene — young energetic seafarer on a sun-drenched deck filming a selfie video, ocean horizon behind, colorful social-media icons orbiting like satellites, dynamic diagonal composition, bright tropical-blue sky, Gen-Z trendy and fresh',

  // ── Sektör & Haberler ─────────────────────────────────────────────────────
  sektor_haberi:       'illustrated editorial maritime newsroom concept — floating newspaper front pages with ship silhouettes dissolving into ocean waves, globe in background, bold journalistic composition, high contrast teal and cream palette, dynamic and informative visual energy',
  trend_analiz:        'illustrated near-future maritime scene — officer wearing sleek AR visor overlaying holographic data charts onto the ocean, an autonomous ship with green accent lighting on the horizon, tech-forward composition, electric blue and silver palette with subtle green accents',
  ortaklik_duyurusu:   'illustrated professional partnership scene — two maritime executives in uniform sharing a confident handshake in front of a grand container ship at dock, national and company flags behind them, golden sunset, official and celebratory atmosphere',
  etkinlik_duyurusu:   'illustrated grand maritime conference scene — bright spotlight illuminating a keynote speaker at a nautical-themed stage with a giant ship projection backdrop, packed audience of seafarers and executives, exciting event energy, deep blue stage lighting with golden accents',
};

const HEADLINES: Record<string, string> = {
  ilan_ozeti:          'Fresh Jobs\nOn Board Now',
  acil_ilan:           'Urgent Hiring\nApply Today',
  yeni_ilan:           'New Opening\nJust Posted',
  toplu_ilan:          'Hundreds of Jobs\nWaiting for You',
  kariyer_ipucu:       'Level Up\nYour Career',
  kariyer_yol_haritasi:'From Cadet\nto Captain',
  cv_rehberi:          'Build a CV\nThat Gets Hired',
  mulakat_hazirlik:    'Ace Your\nNext Interview',
  sertifika_rehberi:   'Certify Your\nSkills at Sea',
  maas_bilgisi:        'Know Your\nMarket Value',
  platform_tanitim:    'Smart Hiring\nStarts Here',
  bullseye_ozellik:    'Perfect Match\nEvery Time',
  akilli_eslestirme:   'AI-Powered\nJob Matching',
  istatistik:          'Maritime Stats\nYou Need to See',
  kpi:                 'Platform Growth\nThis Week',
  basari_istatistigi:  'Milestone\nReached',
  buyume_grafigi:      'Growing Fast\nJoin the Fleet',
  ulke_istatistigi:    'Seafarers\nAround the Globe',
  motivasyon:          'Your Career\nBegins Here',
  ilham_hikayesi:      'From Dream\nto Captain',
  topluluk:            'One Community\nOne Ocean',
  basari_hikayesi:     'Success Found\nOn CrewinJob',
  denizci_yasami:      'Life at Sea\nRedefined',
  video_script:        'Watch This\nBefore You Ship',
  blog:                'Seafarer\nCareer Guide',
  retention:           'Complete Your\nProfile Today',
  registration:        'Join 11,000+\nSeafarers',
  seo_job:             'Maritime Jobs\nWorldwide',
  tiktok_cta:          'Right Job\nRight Talent',
  sektor_haberi:       'Maritime News\nThis Week',
  trend_analiz:        'The Future of\nSeafaring',
  etkinlik_duyurusu:   'Maritime Event\nDon\'t Miss It',
};

const IMAGE_MODELS = [
  'gemini-3.1-flash-image-preview',
  'gemini-2.5-flash-image',
  'gemini-3-pro-image-preview',
];

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

interface GeminiPart {
  text?:       string;
  inlineData?: { mimeType: string; data: string };
}

/**
 * İçerikten kısa, görsele yazılacak başlık üret (max 2 satır, 40 char/satır).
 */
async function generateHeadlineFromContent(textContent: string, apiKey: string): Promise<string> {
  const model = 'gemini-2.5-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `Extract a short, powerful headline (max 2 lines) from this social media post content. The headline will be displayed as large text overlaid on a visual image, so it must be impactful, short, and visually appealing as big typography.

Rules:
- Line 1: 2-4 words — the strongest, most attention-grabbing fragment
- Line 2 (optional): 2-4 words — a supporting phrase or contrast
- English only
- Verb-first or noun-first — avoid articles ("A", "The") at start if possible
- Use action words or aspirational language: "Hire Smarter", "Your Career Awaits", "Built for Seafarers", "10,000+ Jobs", "Join the Fleet"
- NO punctuation at the end of lines
- NO quotation marks
- Output ONLY the headline text, use \\n to separate lines if 2 lines needed

POST CONTENT (first 300 chars):
${textContent.slice(0, 300)}

HEADLINE:`;

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) return '';
    const data     = await res.json();
    const parts    = data?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p: GeminiPart) => p.text);
    return textPart?.text?.trim() || '';
  } catch {
    return '';
  }
}

/**
 * Metin içeriğinden illüstrasyon sahne tarifi üret.
 * Hangi content type olursa olsun içeriğe özgü sahne çıkar.
 */
async function generateSceneFromContent(textContent: string, apiKey: string): Promise<string> {
  const model = 'gemini-2.5-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `You are a senior art director for CrewinJob, a maritime recruitment platform. Your job is to write vivid illustration scene descriptions for social media post background images.

Based on the following social media post content, write a rich, specific scene description (2-3 sentences) that will be used to generate a premium digital illustration.

Rules:
- Describe a SPECIFIC scene that directly represents the post's key message — not generic maritime imagery
- Include: the main subject (who/what), the setting (where), the lighting/atmosphere, and a mood descriptor
- Use vivid, painterly language: specify lighting direction, color palette hints, compositional details
- Style: premium digital illustration — cinematic, aspirational, modern
- Maritime context must be present (ships, ocean, seafarers, ports, navigation instruments, etc.)
- Characters must be illustrated/stylized — not photorealistic
- No text, no logos in the description
- Output ONLY the scene description, nothing else

POST CONTENT (first 500 chars):
${textContent.slice(0, 500)}

SCENE DESCRIPTION:`;

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) return '';
    const data     = await res.json();
    const parts    = data?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p: GeminiPart) => p.text);
    return textPart?.text?.trim() || '';
  } catch {
    return '';
  }
}

/**
 * Adım 1 — Referans görselleri vision modeliyle analiz et, stil tarifi üret.
 * gemini-2.5-flash multimodal girişi destekler (metin + görsel).
 */
async function extractStyleFromRefs(refImages: string[], apiKey: string): Promise<string> {
  const visionModel = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${visionModel}:generateContent?key=${apiKey}`;

  const parts: GeminiPart[] = [
    {
      text: `You are a professional art director analyzing social media post images to extract a precise visual style guide.

Analyze the following ${refImages.length} reference post image(s) and provide a detailed style description that can be used as a photography/image generation prompt.

Focus on:
1. COLOR PALETTE: dominant colors, accent colors, shadows, highlights (use hex-like descriptions)
2. LIGHTING: type (golden hour / blue hour / studio / overcast), direction, intensity, contrast level
3. MOOD & ATMOSPHERE: emotional tone, energy level, cinematic style
4. COMPOSITION: rule of thirds / centered / diagonal, foreground-background relationship
5. COLOR GRADING: warm/cool tones, saturation level, shadow/highlight treatment
6. VISUAL STYLE: photorealistic / illustrated / cinematic / documentary / commercial

Respond ONLY with a concise but detailed photography style prompt (2-4 sentences) that can be injected directly into an image generation prompt. No explanations, no headers, just the style description.`,
    },
  ];

  for (const b64 of refImages) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
  }

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents: [{ parts }] }),
    });
    if (!res.ok) return '';
    const data    = await res.json();
    const resParts = data?.candidates?.[0]?.content?.parts || [];
    const textPart = resParts.find((p: GeminiPart) => p.text);
    return textPart?.text?.trim() || '';
  } catch {
    return '';
  }
}

/**
 * Adım 2 — Stil tarifini prompt'a ekleyerek görsel üret.
 */
async function generateBgViaREST(prompt: string, modelName: string, apiKey: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      contents:         [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['image', 'text'] },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[${res.status}] ${errText.slice(0, 200)}`);
  }
  const data     = await res.json();
  const resParts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart  = resParts.find((p: GeminiPart) => p.inlineData);
  if (!imgPart) throw new Error('Model görsel döndürmedi');
  return imgPart.inlineData as { data: string; mimeType: string };
}

export async function POST(request: NextRequest) {
  const { platform, contentType, textContent, imageModel, refImages } = await request.json() as {
    platform:     string;
    contentType:  string;
    textContent?: string;
    imageModel?:  string;
    refImages?:   string[];
  };
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY tanımlı değil — .env.local kontrol edin' }, { status: 500 });

  const dims = PLATFORM_DIMS[platform] || PLATFORM_DIMS.instagram;

  // Adım 1a: İçerikten sahne + başlık paralel türet
  let contentScene = CONTENT_THEMES[contentType] || CONTENT_THEMES.ilan_ozeti;
  let headline     = HEADLINES[contentType]       || 'The Right Job\nThe Right Talent';

  if (textContent && textContent.trim().length > 50) {
    console.log(`[generate-image] İçerikten sahne + başlık türetiliyor...`);
    const [derivedScene, derivedHeadline] = await Promise.all([
      generateSceneFromContent(textContent, apiKey),
      generateHeadlineFromContent(textContent, apiKey),
    ]);
    if (derivedScene)    { contentScene = derivedScene;    console.log(`[generate-image] Sahne: ${derivedScene.slice(0, 80)}...`); }
    if (derivedHeadline) { headline     = derivedHeadline; console.log(`[generate-image] Başlık: ${derivedHeadline}`); }
  }

  // Adım 1b: Referans görseller varsa stil tarifi çıkar (vision model)
  let styleGuide = '';
  if (refImages && refImages.length > 0) {
    console.log(`[generate-image] ${refImages.length} referans görsel analiz ediliyor...`);
    styleGuide = await extractStyleFromRefs(refImages, apiKey);
    console.log(`[generate-image] Stil tarifi: ${styleGuide.slice(0, 120)}...`);
  }

  const theme = contentScene;

  // Referans varsa stil rehberi prompt'u domine eder, yoksa varsayılan yön kullanılır
  const prompt = styleGuide
    ? `Generate a background photograph for a maritime recruitment social media post.

CRITICAL: NO text, NO logos, NO watermarks, NO UI elements whatsoever.

SCENE SUBJECT: ${theme}
DIMENSIONS: ${dims}

VISUAL STYLE — follow this EXACTLY, extracted from brand reference images:
${styleGuide}

Apply the above style faithfully. Keep left side slightly darker for text overlay.
QUALITY: Ultra high resolution, maximum detail, sharp edges, professional print quality, no compression artifacts.
CLEAN BACKGROUND ONLY. NO TEXT. NO LOGOS.`

    : `Generate a stunning, high-quality digital illustration for a maritime recruitment social media post background.

ABSOLUTE RULE: Generate ONLY the illustration background — NO text, NO logos, NO watermarks, NO captions, NO UI overlays, NO numbers, NO letters whatsoever in the image.

SCENE: ${theme}
DIMENSIONS: ${dims}

ILLUSTRATION STYLE — APPLY ALL OF THESE:
- Art style: Premium digital illustration, polished and modern — quality level of award-winning app store artwork, Netflix poster art, or high-end editorial magazine covers
- Character rendering: Smooth cel-shading with volumetric depth, slightly stylized proportions (heroic but approachable), expressive and diverse faces with genuine emotion, clean outlines
- Color palette: Rich and intentional — deep navy (#0a1628) and ocean teal (#0e7490) as foundational base; warm golden-amber (#f59e0b) as the hero accent; coral and sky-blue as secondary accents; avoid muddy or desaturated colors
- Lighting: Cinematic — strong directional golden-hour or sunrise/sunset light source creating long warm shadows, soft rim lighting on characters, volumetric light rays or god rays where appropriate, atmospheric depth haze in distance
- Composition: Rule of thirds — main subject slightly right-of-center; left third kept noticeably cleaner/slightly darker to accommodate text overlay; clear foreground/mid-ground/background separation for depth
- Background atmosphere: Rich layered backgrounds — detailed foreground elements, well-defined mid-ground subject, soft atmospheric ocean/sky horizon with gradients and clouds; avoid flat or empty backgrounds
- Texture: Subtle fabric texture on uniforms, water reflections on ocean surface, cloud texture in sky; avoid plastic-looking surfaces
- Mood: Aspirational, professional, cinematic — evokes career ambition, adventure at sea, and the excitement of a new opportunity
- Quality: 4K resolution equivalent, ultra-sharp edges on foreground subjects, no banding artifacts, no blurry areas, no JPEG noise, suitable for billboard-size print

REMEMBER: NO TEXT. NO LOGOS. CLEAN ILLUSTRATION BACKGROUND ONLY.`;

  const orderedModels = imageModel
    ? [imageModel, ...IMAGE_MODELS.filter(m => m !== imageModel)]
    : IMAGE_MODELS;

  const targetPx = PLATFORM_PX[platform] || PLATFORM_PX.instagram;

  let lastError: Error | null = null;
  for (let i = 0; i < orderedModels.length; i++) {
    try {
      const imgData = await generateBgViaREST(prompt, orderedModels[i], apiKey);

      // ── Sharp ile tam hedef boyuta getir (cover kırpma — siyah bar yok) ──────
      let finalBase64  = imgData.data;
      let finalMime    = imgData.mimeType;
      try {
        const inputBuf = Buffer.from(imgData.data, 'base64');
        const resized  = await sharp(inputBuf)
          .resize(targetPx.w, targetPx.h, {
            fit:      'cover',     // en-boy oranı korunur, fazlası kırpılır
            position: 'centre',    // merkez alınır
          })
          .jpeg({ quality: 90 })   // Facebook JPEG bekler, PNG'den küçük
          .toBuffer();
        finalBase64 = resized.toString('base64');
        finalMime   = 'image/jpeg';
        console.log(`[generate-image] Resize OK → ${targetPx.w}×${targetPx.h} JPEG`);
      } catch (resizeErr) {
        // Sharp hata verirse orijinal görseli döndür — hiç görsel yok'tan iyidir
        console.warn('[generate-image] Sharp resize başarısız, orijinal kullanılıyor:', resizeErr);
      }

      return NextResponse.json({ imageData: finalBase64, mimeType: finalMime, headline });
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[generate-image] ${orderedModels[i]} başarısız: ${lastError.message.slice(0, 80)}`);
      if (i < orderedModels.length - 1) await sleep(1500);
    }
  }

  return NextResponse.json({ error: lastError?.message || 'Görsel üretilemedi' }, { status: 500 });
}
