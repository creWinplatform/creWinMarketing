import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { ART_DIRECTIONS, pickArtDirection } from '@/lib/art-directions';
import { fetchAllData } from '@/lib/agent-bridge';

// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

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
  // {SEAFARERS} → canlı denizci sayısı (resolveStatTokens); veri yoksa nötr başlığa döner
  registration:        'Join {SEAFARERS}\nSeafarers',
  seo_job:             'Maritime Jobs\nWorldwide',
  tiktok_cta:          'Right Job\nRight Talent',
  sektor_haberi:       'Maritime News\nThis Week',
  trend_analiz:        'The Future of\nSeafaring',
  etkinlik_duyurusu:   'Maritime Event\nDon\'t Miss It',
};

/** Sabit sayı yazmak yerine canlı istatistik kullanılır ("11,000+" zamanla yanlış kalıyordu). */
const SEAFARERS_TOKEN    = '{SEAFARERS}';
const NEUTRAL_JOIN_TITLE = 'Join the\nCrewinJob Fleet';

/** Toplam denizci sayısını aşağı yuvarlayıp "11,000+" biçiminde döner; veri yoksa null. */
async function seafarerCountLabel(): Promise<string | null> {
  try {
    const data  = await Promise.race([
      fetchAllData(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
    const total = Number(data?.seafarers?.total || 0);
    if (!data?.isRealData || !Number.isFinite(total) || total < 100) return null;
    const step  = total >= 1000 ? 1000 : 100;
    return `${(Math.floor(total / step) * step).toLocaleString('en-US')}+`;
  } catch {
    return null;
  }
}

/** Başlık/önerilerdeki istatistik yer tutucularını çözer (yalnızca gerektiğinde API çağrısı). */
async function resolveStatTokens(headline: string, suggestions: string[]): Promise<{ headline: string; suggestions: string[] }> {
  const all = [headline, ...suggestions];
  if (!all.some(h => h.includes(SEAFARERS_TOKEN))) return { headline, suggestions };
  const label = await seafarerCountLabel();
  const fix   = (h: string) => !h.includes(SEAFARERS_TOKEN) ? h : label ? h.split(SEAFARERS_TOKEN).join(label) : NEUTRAL_JOIN_TITLE;
  return { headline: fix(headline), suggestions: suggestions.map(fix) };
}

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
 * Bu yardımcı çağrılar KISA ve YAPISAL işler (başlık üret, sahneyi revize et,
 * stili tarif et). gemini-2.5-flash'ta düşünme varsayılan olarak AÇIK ve
 * düşünme jetonları çıktı bütçesinden harcanıyor — bu işlerde ölçülebilir bir
 * kalite katkısı olmadan her istekte jeton yakıyor. Yaratıcılık zaten
 * sıcaklıkla sağlanıyor.
 */
const NO_THINKING = { thinkingConfig: { thinkingBudget: 0 } };

/** Büyük metinleri tarayıp anahtar üretmeden ucuz parmak izi çıkarır. */
function fingerprint(...parts: string[]): string {
  return parts
    .map(p => `${p.length}:${p.slice(0, 48)}:${p.slice(-48)}`)
    .join('|');
}

/** Basit LRU — sunucu ayakta kaldığı sürece tekrar eden çağrıları önler. */
class Lru<V> {
  private m = new Map<string, V>();
  constructor(private max = 40) {}
  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v); }   // taze tut
    return v;
  }
  set(k: string, v: V) {
    if (this.m.has(k)) this.m.delete(k);
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }
}

// Referans görsel analizi EN PAHALI çağrı: 4 tam görsel vision modeline gidiyor.
// Referans postlar nadiren değişir, sonucu saklamak her üretimde binlerce
// giriş jetonu tasarruf ettirir.
const STYLE_CACHE    = new Lru<string>(12);
// Başlık yalnızca içerik + dile bağlıdır. Stil çipine veya alternatif konsepte
// tıklayınca içerik değişmediği hâlde yeniden üretiliyordu.
const HEADLINE_CACHE = new Lru<{ headline: string; suggestions: string[] }>(40);

/**
 * Metinden API çağrısı olmadan anahtar kelimelerle başlık üret (fallback).
 */
function extractHeadlineLocal(textContent: string): string {
  const text = textContent.slice(0, 400);

  // Hashtag'leri temizle
  const clean = text.replace(/#\w+/g, '').replace(/\s+/g, ' ').trim();

  // Özel gün/kutlama tespiti
  const celebrations: [RegExp, string][] = [
    [/seafarer.*day|world seafarers/i,     'Day of the\nSeafarer'],
    [/world maritime/i,                     'World Maritime\nDay'],
    [/new year/i,                           'Happy New Year\nFrom CrewinJob'],
    [/ramadan|ramazan/i,                    'Ramadan Mubarak\nFrom CrewinJob'],
    [/eid|bayram/i,                         'Eid Mubarak\nFrom CrewinJob'],
    [/congratulat|tebrik/i,                 'Congratulations\nFrom the Fleet'],
    [/hiring|we.re hiring|işe alım/i,       'Now Hiring\nApply Today'],
    [/job.*open|ilan/i,                     'Fresh Jobs\nJust Posted'],
    [/career tip|kariyer ipucu/i,           'Level Up\nYour Career'],
    [/salary|maaş/i,                        'Know Your\nMarket Value'],
    [/certif|sertifika/i,                   'Certify Your\nSkills at Sea'],
    [/interview|mülakat/i,                  'Ace Your\nInterview'],
    [/community|topluluk/i,                 'One Community\nOne Ocean'],
    [/success|başarı/i,                     'Success Found\nAt Sea'],
    [/tip|advice|ipucu/i,                   'Pro Tips\nFor Seafarers'],
    [/news|haber/i,                         'Maritime News\nThis Week'],
    [/event|etkinlik/i,                     'Maritime Event\nDon\'t Miss It'],
    [/partner|ortaklık/i,                   'Stronger Together\nAt Sea'],
    [/join|katıl/i,                         `Join ${SEAFARERS_TOKEN}\nSeafarers`],
    [/platform|app/i,                       'Smart Hiring\nStarts Here'],
  ];

  for (const [pattern, headline] of celebrations) {
    if (pattern.test(clean)) return headline;
  }

  // İlk anlamlı cümleyi al ve kıs
  const firstSentence = clean.split(/[.!?]/)[0].trim();
  const words = firstSentence.split(' ').filter(w => w.length > 2);
  if (words.length >= 4) {
    const line1 = words.slice(0, 3).join(' ');
    const line2 = words.slice(3, 6).join(' ');
    return line2 ? `${line1}\n${line2}` : line1;
  }
  return firstSentence.slice(0, 35) || 'The Right Job\nThe Right Talent';
}

/**
 * İçerikten 4 başlık seçeneği üretir (görsel overlay için).
 * Döner: { headline: string (en iyi), suggestions: string[] (alternatifler) }
 * language: 'tr' → Türkçe, diğer → İngilizce
 */
async function generateHeadlineFromContent(
  textContent: string,
  apiKey: string,
  language = 'en',
): Promise<{ headline: string; suggestions: string[] }> {
  const model = 'gemini-2.5-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const isTr = language === 'tr';
  const prompt = isTr
    ? `Bu sosyal medya içeriğinden görselin üstüne yazılacak 4 farklı Türkçe başlık öner.

Kurallar:
- Her başlık maks. 2 satır, satır başına 2-4 kelime
- YALNIZCA Türkçe, noktalama işareti yok, tırnak yok
- Satır arası için gerçek yeni satır kullan (Enter)
- Her seçenek birbirinden farklı ton ve açıdan yaklaşsın:
  Seçenek 1: İçeriğin özünü en güçlü ifade eden (en iyi)
  Seçenek 2: Duygusal/ilham verici ton
  Seçenek 3: Eylem odaklı/CTA tonu
  Seçenek 4: Kısa ve çarpıcı (tek satır)
- Yanıt formatı — SADECE geçerli JSON dizisi, başka hiçbir şey:
["Başlık bir\nikinci satır", "Başlık iki", "Başlık üç\nalt satır", "Başlık dört"]

İÇERİK (ilk 400 karakter):
${textContent.slice(0, 400)}`
    : `Generate 4 different headline options for this social media post image overlay.

Rules:
- Each headline: max 2 lines, 2-4 words per line
- English only, no punctuation, no quotes
- Use real newline (Enter) to separate lines within a headline
- Each option should have a distinctly different angle:
  Option 1: Core message, strongest impact (best pick)
  Option 2: Emotional / inspirational tone
  Option 3: Action-oriented / CTA tone
  Option 4: Short and punchy (single line)
- Response format — ONLY valid JSON array, nothing else:
["Headline one\\nsecond line", "Headline two", "Headline three\\nsub line", "Headline four"]

POST CONTENT (first 400 chars):
${textContent.slice(0, 400)}`;

  const fallback = extractHeadlineLocal(textContent);

  // Başlık yalnızca içerik + dile bağlı. Aynı içerik için stil/konsept
  // denerken her seferinde yeniden üretmek boşuna çağrıydı.
  const cacheKey = fingerprint(textContent.slice(0, 400), language);
  const cached   = HEADLINE_CACHE.get(cacheKey);
  if (cached) {
    console.log('[headline] önbellekten — API çağrısı yapılmadı');
    return cached;
  }

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        generationConfig: { ...NO_THINKING, maxOutputTokens: 512, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) {
      console.warn(`[headline] API ${res.status} — local fallback kullanılıyor`);
      return { headline: fallback, suggestions: [] };
    }
    const data     = await res.json();
    const parts    = data?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p: GeminiPart) => p.text);
    const raw      = (textPart?.text?.trim() || '').replace(/```json|```/g, '').trim();

    // JSON dizisi parse et
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      const arr: string[] = JSON.parse(match[0]);
      if (Array.isArray(arr) && arr.length > 0) {
        const normalized = arr.map(h => h.replace(/\\n/g, '\n').trim()).filter(Boolean);
        const [headline, ...suggestions] = normalized;
        const out = { headline: headline || fallback, suggestions };
        HEADLINE_CACHE.set(cacheKey, out);
        return out;
      }
    }

    // Fallback: ilk satırı başlık, geri kalanları öneri olarak al
    const lines = raw.split('\n').map((l: string) => l.trim()).filter(Boolean);
    const out = { headline: lines[0] || fallback, suggestions: lines.slice(1) };
    if (lines.length) HEADLINE_CACHE.set(cacheKey, out);
    return out;
  } catch {
    return { headline: fallback, suggestions: [] };
  }
}

/**
 * Metin içeriğinden 3 FARKLI illüstrasyon konsepti üret.
 * Birincisi kullanılır, diğerleri panelde alternatif olarak sunulur.
 *
 * Tek konsept üretildiğinde her post birbirine benziyordu; burada modelden
 * kasıtlı olarak birbirinden ayrışan üç yaklaşım isteniyor ve yaratıcılık için
 * sıcaklık yükseltiliyor.
 */
async function generateScenesFromContent(
  textContent: string,
  apiKey: string,
): Promise<{ scene: string; alternatives: string[] }> {
  const model = 'gemini-2.5-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `You are a senior art director for CrewinJob, a maritime recruitment platform. Write illustration scene concepts for a social media post background.

Based on the post content below, propose THREE genuinely different visual concepts. Each is 2-3 sentences.

The three must differ in APPROACH, not just in details:
  Concept 1 — Literal & human: a person in a specific moment that embodies the message
  Concept 2 — Metaphorical & symbolic: represent the idea through an object, scale contrast, or visual metaphor rather than a literal depiction
  Concept 3 — Environmental & wide: the message told through place and atmosphere, with the human small or absent

Rules for every concept:
- Be SPECIFIC to this post's message — never generic maritime stock imagery
- State the subject, the setting, the light, and one concrete telling detail
- AVOID these overused clichés: a lone figure gazing at the horizon from the bow, a generic handshake, a compass on a chart table, arms raised in triumph
- Maritime context must be present (ships, ocean, seafarers, ports, engine rooms, cargo, navigation)
- Characters are clearly illustrated/stylised, never photorealistic, never resembling any real or famous person — fictional people only
- Do NOT mention text, logos, letters or numbers
- Do NOT specify an overall art style, colour grading or rendering technique — that is decided separately. Describe only WHAT is in the scene and its light.

Respond with ONLY a valid JSON array of three strings, nothing else:
["concept one", "concept two", "concept three"]

POST CONTENT (first 500 chars):
${textContent.slice(0, 500)}`;

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          // Yaratıcı çeşitlilik sıcaklıktan geliyor, düşünmeden değil
          temperature: 1.15, topP: 0.95,
          ...NO_THINKING,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (!res.ok) return { scene: '', alternatives: [] };
    const data     = await res.json();
    const parts    = data?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p: GeminiPart) => p.text);
    const raw      = (textPart?.text?.trim() || '').replace(/```json|```/g, '').trim();

    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      const arr: string[] = JSON.parse(match[0]);
      const clean = arr.map(s => String(s).trim()).filter(Boolean);
      if (clean.length) return { scene: clean[0], alternatives: clean.slice(1) };
    }
    // JSON gelmezse düz metni tek konsept olarak kullan
    return raw ? { scene: raw, alternatives: [] } : { scene: '', alternatives: [] };
  } catch {
    return { scene: '', alternatives: [] };
  }
}

/**
 * Mevcut sahneyi kullanıcının serbest talimatıyla düzenler.
 *
 * `userScene`den farkı: userScene sahnenin YERİNE geçer. Burada ise kullanıcı
 * "şunu değiştir / şunu ekle" diyor ve mevcut sahne korunarak revize ediliyor —
 * metin tarafındaki /api/content/refine ile aynı mantık.
 *
 * Talimat görselde YAZI istiyorsa (tarih, yer, stant no) bu sahneye çevrilemez:
 * görsel modeline yazı çizdirmek yasak ve zaten kötü sonuç veriyor. O bilgi alt
 * çubuktaki detay satırına yazılır; burada sahne yalnızca konuyu ima edecek
 * şekilde revize edilir.
 */
async function reviseScene(
  baseScene: string,
  instruction: string,
  apiKey: string,
): Promise<string> {
  const model = 'gemini-2.5-flash';
  const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `You are an art director revising an illustration brief for a maritime recruitment post.

CURRENT SCENE BRIEF:
---
${baseScene.slice(0, 1200)}
---

USER'S REQUEST:
---
${instruction.slice(0, 600)}
---

HOW TO READ THE REQUEST:
- It is a brief describing what to change, NEVER text to copy verbatim into the scene.
- It is often written in another language (the user's own). Understand it, then write the revised
  brief in ENGLISH.
- Apply only what it asks. Keep every other element of the current scene intact.
- If the request describes an entirely different scene, replace the brief completely.

CRITICAL — REQUESTS FOR TEXT:
The illustration must contain NO words, letters, numbers, dates, signage text or logos; that is a hard
constraint of this pipeline (captions are composited separately). If the request asks to show text such
as a venue name, a date, or a booth number, DO NOT try to render it. Instead, evoke it visually —
e.g. a recognisable venue silhouette, a conference hall setting, an exhibition booth, autumn light —
and never as readable lettering.

Respond with ONLY the revised scene brief: 2-3 sentences describing subject, setting, light and one
telling detail. No preamble, no explanation, no quotes.`;

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents:         [{ parts: [{ text: prompt }] }],
        // Düşünme kapalı: sahneyi revize etmek kısa ve yapısal bir iş.
        // (Düşünme açıkken jetonlar çıktı bütçesinden harcanıp sahneyi
        // cümle ortasında kesiyordu — kapatınca 512 fazlasıyla yetiyor.)
        generationConfig: { temperature: 0.6, ...NO_THINKING, maxOutputTokens: 512 },
      }),
    });
    if (!res.ok) return '';
    const data     = await res.json();
    const parts    = data?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p: GeminiPart) => p.text);
    return (textPart?.text?.trim() || '').replace(/^["']|["']$/g, '');
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

  // BU EN PAHALI ÇAĞRI: 4 tam görsel vision modeline gidiyor (görsel başına
  // binlerce giriş jetonu). Referans postlar nadiren değişir, oysa şu ana kadar
  // her görsel üretiminde yeniden analiz ediliyordu. Aynı referans setinde
  // sonuç değişmeyeceği için saklanabilir — kalite kaybı yok.
  const cacheKey = fingerprint(...refImages);
  const cached   = STYLE_CACHE.get(cacheKey);
  if (cached) {
    console.log('[style] önbellekten — referans görselleri yeniden analiz edilmedi');
    return cached;
  }

  for (const b64 of refImages) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
  }

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contents:         [{ parts }],
        generationConfig: { ...NO_THINKING, maxOutputTokens: 512 },
      }),
    });
    if (!res.ok) return '';
    const data    = await res.json();
    const resParts = data?.candidates?.[0]?.content?.parts || [];
    const textPart = resParts.find((p: GeminiPart) => p.text);
    const out = textPart?.text?.trim() || '';
    if (out) STYLE_CACHE.set(cacheKey, out);
    return out;
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
  const { platform, contentType, textContent, imageModel, refImages, userScene, language, artDirection, sceneInstruction, baseScene } = await request.json() as {
    platform:          string;
    contentType:       string;
    textContent?:      string;
    imageModel?:       string;
    refImages?:        string[];
    userScene?:        string;   // Kullanıcının kendi tarifi — varsa AI sahne üretimini atla
    language?:         string;   // İçerik dili ('tr' | 'en') — başlık diline yansır
    artDirection?:     string;   // Sanat yönü id'si — boşsa rastgele seçilir
    sceneInstruction?: string;   // "şunu değiştir/ekle" — mevcut sahneyi revize eder
    baseScene?:        string;   // revize edilecek mevcut sahne
  };
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY tanımlı değil — .env.local kontrol edin' }, { status: 500 });

  const dims = PLATFORM_DIMS[platform] || PLATFORM_DIMS.instagram;

  // Adım 1a: Sahne + başlık belirleme
  // Öncelik: 1) Kullanıcı tarifi (userScene) → 2) İçerikten AI türet → 3) contentType varsayılanı
  let contentScene  = CONTENT_THEMES[contentType] || CONTENT_THEMES.ilan_ozeti;
  let headline      = HEADLINES[contentType]       || 'The Right Job\nThe Right Talent';
  let suggestions: string[] = [];
  let sceneSuggestions: string[] = [];

  const lang = language || 'en';

  if (sceneInstruction && sceneInstruction.trim().length > 2) {
    // Talimat modu: mevcut sahneyi koruyarak revize et.
    // Revize edilecek sahne yoksa önce içerikten bir sahne türetilir.
    let base = (baseScene || '').trim();
    if (!base && textContent && textContent.trim().length > 50) {
      const s = await generateScenesFromContent(textContent, apiKey);
      base = s.scene || contentScene;
      sceneSuggestions = s.alternatives;
    }
    if (!base) base = contentScene;

    const [revised, headlineResult] = await Promise.all([
      reviseScene(base, sceneInstruction.trim(), apiKey),
      textContent && textContent.trim().length > 50
        ? generateHeadlineFromContent(textContent, apiKey, lang)
        : Promise.resolve({ headline: '', suggestions: [] as string[] }),
    ]);
    contentScene = revised || base;
    console.log(`[generate-image] Sahne talimatla revize edildi: ${contentScene.slice(0, 80)}...`);
    if (headlineResult.headline) { headline = headlineResult.headline; suggestions = headlineResult.suggestions; }
  } else if (userScene && userScene.trim().length > 10) {
    // Kullanıcı tarifi: sahne olarak doğrudan kullan, başlığı içerikten türet
    contentScene = userScene.trim();
    console.log(`[generate-image] Kullanıcı sahnesi kullanılıyor: ${contentScene.slice(0, 80)}...`);
    if (textContent && textContent.trim().length > 50) {
      const result = await generateHeadlineFromContent(textContent, apiKey, lang);
      if (result.headline) { headline = result.headline; suggestions = result.suggestions; }
    }
  } else if (textContent && textContent.trim().length > 50) {
    console.log(`[generate-image] İçerikten sahne + başlık türetiliyor... (dil: ${lang})`);
    const [sceneResult, headlineResult] = await Promise.all([
      generateScenesFromContent(textContent, apiKey),
      generateHeadlineFromContent(textContent, apiKey, lang),
    ]);
    if (sceneResult.scene) {
      contentScene     = sceneResult.scene;
      sceneSuggestions = sceneResult.alternatives;
      console.log(`[generate-image] Sahne: ${sceneResult.scene.slice(0, 80)}... | Alternatif: ${sceneSuggestions.length}`);
    }
    if (headlineResult.headline) {
      headline    = headlineResult.headline;
      suggestions = headlineResult.suggestions;
      console.log(`[generate-image] Başlık: ${headline} | Öneriler: ${suggestions.length}`);
    }
  }

  // Sabit sayı yerine canlı istatistik ({SEAFARERS} yer tutucusu varsa)
  ({ headline, suggestions } = await resolveStatTokens(headline, suggestions));

  // Sanat yönü: kullanıcı seçtiyse o, seçmediyse rastgele — "Yeniden Üret" çeşitlilik versin
  const direction = pickArtDirection(artDirection);
  console.log(`[generate-image] Sanat yönü: ${direction.id}`);

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
    ? `Generate a background digital illustration for a maritime recruitment social media post.

ABSOLUTE RULES:
1. NO text, NO logos, NO watermarks, NO UI elements whatsoever. NO artist signature.
2. NO REAL PEOPLE. NO CELEBRITIES. Every human must be a clearly fictional, stylised, illustrated character — never photorealistic, never resembling any real or famous person.
3. ALL human figures must read unmistakably as illustrations — editorial art or graphic-novel style, not photographs or hyperrealistic CGI.

SCENE SUBJECT: ${theme}
DIMENSIONS: ${dims}

VISUAL STYLE — follow this EXACTLY, extracted from brand reference images:
${styleGuide}

Apply the above style faithfully. Keep left side slightly darker for text overlay.
Character rendering: stylised illustration, non-realistic faces, diverse fictional characters only.
QUALITY: Ultra high resolution, maximum detail, sharp edges, professional print quality, no compression artifacts.
CLEAN ILLUSTRATION BACKGROUND ONLY. NO TEXT. NO LOGOS. NO REAL PEOPLE.`

    : `Generate a stunning, high-quality digital illustration for a maritime recruitment social media post background.

ABSOLUTE RULES — these override everything else:
1. NO text, NO logos, NO watermarks, NO captions, NO UI overlays, NO numbers, NO letters, NO artist signature.
2. NO REAL PEOPLE. NO CELEBRITIES. NO RECOGNISABLE INDIVIDUALS. Every human in the scene must be a clearly fictional, stylised, illustrated character — never a photorealistic portrait, never resembling any real or famous person. If a face looks like it could belong to a real human being, redraw it as stylised art.
3. ALL human figures must read unmistakably as ILLUSTRATIONS — editorial art, graphic-novel characters, animation-quality draughtsmanship — not photographs, not hyperrealistic CGI renders, not AI-photorealism.

SCENE: ${theme}
DIMENSIONS: ${dims}

ART DIRECTION — "${direction.label.en}". Commit to it fully; do not blend it with other looks:
${direction.prompt}

ALWAYS APPLY, regardless of art direction:
- Character rendering: Every person must be CLEARLY ILLUSTRATED AND STYLISED. Think editorial illustration or graphic novel — confident line work, expressive but non-realistic faces, genuinely diverse characters. A face that could pass for a real human or celebrity is a failure. Avoid portrait-quality eyes, skin pores, hair strands, or any photorealistic detail.
- Text-safe area: keep the LEFT THIRD visually calm and slightly darker — a headline will be overlaid there, so nothing important or busy belongs in that zone
- Depth: clear separation between foreground, mid-ground and background — avoid flat, empty or wallpaper-like images
- Mood: aspirational and professional — this represents a career opportunity at sea, never bleak or corporate-stock
- Quality: 4K-equivalent detail, ultra-sharp edges on the main subject, no banding, no blur, no compression noise, print-grade

AVOID: photorealistic rendering of any kind, generic stock-photo staging, symmetrical centred compositions, muddy colour, plastic-looking surfaces, cluttered focal points.

REMEMBER: NO TEXT. NO LOGOS. NO REAL PEOPLE. CLEAN STYLISED ILLUSTRATION BACKGROUND ONLY.`;

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
            fit:      'cover',       // en-boy oranı korunur, fazlası kırpılır
            position: 'centre',      // merkez alınır
            kernel:   'lanczos3',    // küçültmede en keskin sonuç
          })
          .sharpen({ sigma: 0.6 })   // yeniden boyutlandırma yumuşamasını telafi et
          // Bu JPEG bir ARA ÜRÜNDÜR: istemci compositePostImage'de üstüne başlık/logo
          // çizip PNG olarak yeniden kodluyor. Dolayısıyla buradaki sıkıştırma
          // artefaktları nihai görsele kalıcı işleniyor ve düşük kalitenin dosya
          // boyutuna bir faydası da olmuyor. Yüksek kalite + 4:4:4 renk örnekleme
          // (keskin kenarlarda renk bulaşmasını önler) bilinçli tercih.
          .jpeg({ quality: 95, chromaSubsampling: '4:4:4', mozjpeg: true })
          .toBuffer();
        finalBase64 = resized.toString('base64');
        finalMime   = 'image/jpeg';
        console.log(`[generate-image] Resize OK → ${targetPx.w}×${targetPx.h} JPEG q95 4:4:4`);
      } catch (resizeErr) {
        // Sharp hata verirse orijinal görseli döndür — hiç görsel yok'tan iyidir
        console.warn('[generate-image] Sharp resize başarısız, orijinal kullanılıyor:', resizeErr);
      }

      return NextResponse.json({
        imageData: finalBase64,
        mimeType:  finalMime,
        headline,
        suggestions,
        sceneSuggestions,                    // alternatif görsel konseptleri
        scene:        theme,                 // kullanılan konsept (alternatife dönmek için)
        artDirection: direction.id,          // kullanılan sanat yönü
        artDirections: ART_DIRECTIONS.map(d => ({ id: d.id, label: d.label, icon: d.icon })),
      });
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[generate-image] ${orderedModels[i]} başarısız: ${lastError.message.slice(0, 80)}`);
      if (i < orderedModels.length - 1) await sleep(1500);
    }
  }

  return NextResponse.json({ error: lastError?.message || 'Görsel üretilemedi' }, { status: 500 });
}
