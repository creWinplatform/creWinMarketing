// Brand kit and design studio: shared by the server store (brand-kit.ts), the layout engine (design-layout.ts) and the
// browser renderer. Pure data, no server imports.
export type BrandFont = 'manrope' | 'sans' | 'serif' | 'mono';
export type BrandColors = { primary: string; accent: string; dark: string; light: string };
export type BrandKitInput = { colors: BrandColors; font: BrandFont; handle: string; tagline: string };
export type BrandLogo = { data: string; mime: 'image/png' | 'image/jpeg' | 'image/webp' };
export type BrandKit = BrandKitInput & {
  revision: number; logo: BrandLogo | null; updatedAt: string | null; canEdit: boolean;
};

export const BRAND_FONTS: readonly BrandFont[] = ['manrope', 'sans', 'serif', 'mono'];
// Canvas font stacks: Manrope is bundled with the app (@fontsource-variable/manrope); the others are system faces
// available on phones and desktops, so a design never waits for a download.
export const FONT_STACKS: Record<BrandFont, string> = {
  manrope: '"Manrope Variable", Manrope, Arial, sans-serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};
export const FONT_LABELS: Record<BrandFont, { tr: string; en: string }> = {
  manrope: { tr: 'Manrope (modern)', en: 'Manrope (modern)' },
  sans: { tr: 'Sistem (sade)', en: 'System (plain)' },
  serif: { tr: 'Serif (klasik)', en: 'Serif (classic)' },
  mono: { tr: 'Mono (teknik)', en: 'Mono (technical)' },
};
export const DEFAULT_BRAND_KIT: BrandKitInput = {
  colors: { primary: '#191f16', accent: '#baf331', dark: '#111510', light: '#f4f5f2' },
  font: 'manrope', handle: '', tagline: '',
};
export const LOGO_MAX_BYTES = 400 * 1024;
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// WCAG relative luminance and contrast; the renderer picks dark or light text by contrast, never by guess.
export function luminance(hex: string) {
  const channel = (offset: number) => { const value = parseInt(hex.slice(offset, offset + 2), 16) / 255; return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
// The kit colour (dark or light) that reads best on a background.
export function inkOn(background: string, colors: BrandColors) {
  return contrast(colors.dark, background) >= contrast(colors.light, background) ? colors.dark : colors.light;
}

// Canvas sizes. Every size names where it is used; channel sizes follow each network's current recommendation.
export type DesignSize = { id: string; w: number; h: number; label: string; group: string };
// Size and group names are network terms; the few Turkish ones get an English twin here.
const EN_NAMES: Record<string, string> = { 'Genel': 'General', 'Google duyarlı': 'Google responsive', 'Profil': 'Profile', 'Kapak': 'Cover', 'Öne çıkanlar': 'Highlights', 'Profil fotoğrafı 1:1': 'Profile picture 1:1', 'Facebook kapak': 'Facebook cover', 'LinkedIn sayfa kapağı': 'LinkedIn page cover', 'X başlık': 'X header', 'YouTube kanal kapağı': 'YouTube channel banner', 'Instagram öne çıkan kapağı': 'Instagram highlight cover', 'Akış videosu': 'Feed video', 'Kare video': 'Square video' };
export function sizeName(value: string, lang: 'tr' | 'en') { if (lang === 'tr') return value; const prefix = Object.keys(EN_NAMES).find(key => value === key || value.startsWith(key + ' ')); return prefix ? EN_NAMES[prefix] + value.slice(prefix.length) : value; }
const size = (id: string, w: number, h: number, label: string, group: string): DesignSize => ({ id, w, h, label, group });
export const POST_SIZES: Record<string, DesignSize[]> = {
  instagram: [size('ig-portrait', 1080, 1350, 'Instagram 4:5', 'Instagram'), size('ig-square', 1080, 1080, 'Instagram 1:1', 'Instagram'), size('ig-story', 1080, 1920, 'Story / Reels 9:16', 'Instagram')],
  facebook: [size('fb-feed', 1080, 1350, 'Facebook 4:5', 'Facebook'), size('fb-square', 1080, 1080, 'Facebook 1:1', 'Facebook'), size('fb-link', 1200, 630, 'Facebook 1.91:1', 'Facebook')],
  linkedin: [size('li-square', 1200, 1200, 'LinkedIn 1:1', 'LinkedIn'), size('li-landscape', 1200, 627, 'LinkedIn 1.91:1', 'LinkedIn'), size('li-portrait', 1080, 1350, 'LinkedIn 4:5', 'LinkedIn')],
  twitter: [size('x-landscape', 1600, 900, 'X 16:9', 'X'), size('x-square', 1080, 1080, 'X 1:1', 'X')],
  tiktok: [size('tt-photo', 1080, 1920, 'TikTok 9:16', 'TikTok'), size('tt-square', 1080, 1080, 'TikTok 1:1', 'TikTok')],
  pinterest: [size('pin', 1000, 1500, 'Pinterest 2:3', 'Pinterest'), size('pin-square', 1000, 1000, 'Pinterest 1:1', 'Pinterest')],
  youtube: [size('yt-thumb', 1280, 720, 'YouTube 16:9', 'YouTube')],
  telegram: [size('tg-landscape', 1280, 720, 'Telegram 16:9', 'Telegram'), size('tg-square', 1080, 1080, 'Telegram 1:1', 'Telegram')],
};
export function postSizes(channel: string) { return POST_SIZES[channel] || [size('square', 1080, 1080, '1:1', 'Genel'), size('landscape', 1200, 630, '1.91:1', 'Genel')]; }
// One design, every common ad placement (Meta, Google Display and responsive, LinkedIn, TikTok, X, Pinterest).
export const AD_SIZES: DesignSize[] = [
  size('meta-square', 1080, 1080, 'Meta 1:1', 'Meta'), size('meta-portrait', 1080, 1350, 'Meta 4:5', 'Meta'), size('meta-story', 1080, 1920, 'Meta Story/Reels 9:16', 'Meta'),
  size('gdn-300x250', 300, 250, '300×250', 'Google Display'), size('gdn-336x280', 336, 280, '336×280', 'Google Display'), size('gdn-728x90', 728, 90, '728×90', 'Google Display'),
  size('gdn-300x600', 300, 600, '300×600', 'Google Display'), size('gdn-320x50', 320, 50, '320×50', 'Google Display'), size('gdn-320x100', 320, 100, '320×100', 'Google Display'),
  size('gdn-970x250', 970, 250, '970×250', 'Google Display'), size('gdn-160x600', 160, 600, '160×600', 'Google Display'), size('gdn-468x60', 468, 60, '468×60', 'Google Display'),
  size('gdn-250x250', 250, 250, '250×250', 'Google Display'), size('gdn-200x200', 200, 200, '200×200', 'Google Display'), size('gdn-970x90', 970, 90, '970×90', 'Google Display'),
  size('gdn-300x50', 300, 50, '300×50', 'Google Display'), size('gdn-120x600', 120, 600, '120×600', 'Google Display'),
  size('gda-1200x628', 1200, 628, 'Google duyarlı 1.91:1', 'Google duyarlı'), size('gda-1200x1200', 1200, 1200, 'Google duyarlı 1:1', 'Google duyarlı'), size('gda-960x1200', 960, 1200, 'Google duyarlı 4:5', 'Google duyarlı'),
  size('li-ad', 1200, 627, 'LinkedIn 1.91:1', 'LinkedIn'), size('li-ad-square', 1200, 1200, 'LinkedIn 1:1', 'LinkedIn'), size('li-ad-portrait', 720, 900, 'LinkedIn 4:5', 'LinkedIn'),
  size('tt-ad', 1080, 1920, 'TikTok 9:16', 'TikTok'), size('x-ad', 1600, 900, 'X 16:9', 'X'), size('x-ad-square', 1080, 1080, 'X 1:1', 'X'), size('pin-ad', 1000, 1500, 'Pinterest 2:3', 'Pinterest'),
];
// Profile pictures and page covers. Covers keep text inside the centre band each network shows on phones.
export const PROFILE_SIZES: DesignSize[] = [
  size('avatar', 1080, 1080, 'Profil fotoğrafı 1:1', 'Profil'),
  size('fb-cover', 1640, 624, 'Facebook kapak', 'Kapak'), size('li-cover', 1128, 191, 'LinkedIn sayfa kapağı', 'Kapak'),
  size('x-header', 1500, 500, 'X başlık', 'Kapak'), size('yt-banner', 2560, 1440, 'YouTube kanal kapağı', 'Kapak'),
];
// Short videos: vertical for Reels, Stories, TikTok and Shorts; 4:5 and 1:1 for feed videos.
export const VIDEO_SIZES: DesignSize[] = [size('video-vertical', 1080, 1920, 'Reels / TikTok / Shorts 9:16', 'Video'), size('video-portrait', 1080, 1350, 'Akış videosu 4:5', 'Video'), size('video-square', 1080, 1080, 'Kare video 1:1', 'Video')];
export const HIGHLIGHT_SIZE: DesignSize = size('highlight', 1080, 1920, 'Instagram öne çıkan kapağı', 'Öne çıkanlar');
