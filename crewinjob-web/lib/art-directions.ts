// Sanat yönetimi varyantları — görsel üretiminde stil çeşitliliği sağlar.
//
// Tek bir sabit stil bloğu kullanıldığında üretilen her görsel birbirinin aynısı
// görünüyordu ("hep altın saat, hep navy-teal-amber"). Aşağıdaki yönler birbirinden
// belirgin biçimde ayrışır; istek başına biri seçilir. Kullanıcı seçmezse rastgele
// gelir — böylece "Yeniden Üret" gerçekten farklı bir görsel getirir.

export interface ArtDirection {
  id:     string;
  label:  { tr: string; en: string };
  icon:   string;
  prompt: string;
}

export const ART_DIRECTIONS: ArtDirection[] = [
  {
    id:    'cinematic_golden',
    label: { tr: 'Sinematik Altın Saat', en: 'Cinematic Golden Hour' },
    icon:  '🌅',
    prompt: `- Art style: Premium cinematic digital illustration — quality of award-winning Netflix key art
- Lighting: Strong directional golden-hour sun, long warm shadows, soft rim light on characters, volumetric god rays, atmospheric haze in the distance
- Color palette: Deep navy (#0a1628) and ocean teal (#0e7490) foundation, warm golden-amber (#f59e0b) hero accent, coral secondary
- Composition: Rule of thirds, subject slightly right of centre, layered foreground/mid/background for depth
- Texture: Fabric weave on uniforms, specular water reflections, cloud volume in sky`,
  },
  {
    id:    'blue_hour_tech',
    label: { tr: 'Mavi Saat / Teknoloji', en: 'Blue Hour Tech' },
    icon:  '🌌',
    prompt: `- Art style: Sleek near-future digital illustration with a technological edge
- Lighting: Twilight blue hour — cool ambient sky light with cyan practical lights, glowing screens and holographic UI as secondary light sources on faces
- Color palette: Midnight indigo (#0b1220), electric cyan (#22d3ee), soft violet accents; a single warm amber highlight for contrast — deliberately COOL overall, not golden
- Composition: Strong leading lines and geometry, subject framed by structures or holographic panels, generous negative space top-left
- Texture: Fine grid and circuit motifs, glass reflections, subtle light bloom around emissive elements
- CRITICAL for this direction: holographic panels and screens must show ONLY abstract graphics — wireframe vessel outlines, radar rings, bar/line graph shapes, grids and nodes. They must contain NO lettering, NO words, NO digits, NO labels of any kind. Glowing UI is a light source and a shape, never a surface with writing on it.`,
  },
  {
    id:    'editorial_minimal',
    label: { tr: 'Editoryal Minimal', en: 'Editorial Minimal' },
    icon:  '📰',
    prompt: `- Art style: Restrained editorial illustration — the visual language of a premium magazine cover, confident and uncluttered
- Lighting: Soft, even, diffused light with gentle falloff; no dramatic rays, no heavy contrast
- Color palette: Muted and sophisticated — dusty slate blue, warm off-white, deep ink navy, ONE restrained accent colour used sparingly; low saturation overall
- Composition: A single clear subject with generous empty space around it; large calm areas; strongly asymmetric layout; left half kept nearly empty
- Texture: Matte paper-like finish, minimal detail, clean flat shapes, no busy backgrounds`,
  },
  {
    id:    'bold_poster',
    label: { tr: 'Grafik Poster', en: 'Bold Graphic Poster' },
    icon:  '🎨',
    prompt: `- Art style: Bold flat graphic poster art — screenprint / vintage travel-poster sensibility, strong silhouettes over fine detail
- Lighting: Stylised, non-realistic — light expressed through flat colour blocking and hard shadow shapes rather than gradients
- Color palette: Limited to 4-5 flat colours with high contrast — deep navy, bright coral-red, warm cream, ocean teal; unapologetically graphic
- Composition: Strong diagonals, oversized subject filling the frame, dramatic scale contrast between subject and vessel
- Texture: Subtle halftone/screenprint grain, crisp geometric shapes, hard edges, no photorealistic rendering`,
  },
  {
    id:    'documentary_warm',
    label: { tr: 'Belgesel / Samimi', en: 'Documentary Warm' },
    icon:  '📷',
    prompt: `- Art style: Naturalistic, candid illustration — feels observed rather than staged, human and unpolished in the best way
- Lighting: Available light — overcast diffusion, or warm practical lamps at night; realistic and unforced, gentle contrast
- Color palette: Natural and slightly desaturated — weathered steel grey, sea green, warm skin tones, faded orange work gear; subtle film-grain colour cast
- Composition: Off-centre documentary framing, subject caught mid-action and mid-expression, environmental context clearly visible
- Texture: Fine film grain, worn metal and rope detail, weathered surfaces, honest imperfection`,
  },
  {
    id:    'dramatic_storm',
    label: { tr: 'Dramatik / Epik', en: 'Dramatic Epic' },
    icon:  '⚡',
    prompt: `- Art style: High-drama cinematic illustration — epic scale, the sea as a powerful force
- Lighting: Extreme contrast — a break in storm clouds throwing a hard shaft of light onto the water, deep shadows elsewhere, silver-edged rim light
- Color palette: Storm slate, cold steel blue, near-black shadow, with a piercing shaft of pale gold; dominated by DARK values
- Composition: Wide epic framing, small human figure against a vast vessel or sea to convey scale, low horizon with a towering sky
- Texture: Spray and mist, churning water detail, heavy cloud volume, wet reflective surfaces`,
  },
];

/** İstenen yön geçerliyse onu, değilse rastgele birini döndürür. */
export function pickArtDirection(requested?: string): ArtDirection {
  if (requested) {
    const found = ART_DIRECTIONS.find(d => d.id === requested);
    if (found) return found;
  }
  return ART_DIRECTIONS[Math.floor(Math.random() * ART_DIRECTIONS.length)];
}
