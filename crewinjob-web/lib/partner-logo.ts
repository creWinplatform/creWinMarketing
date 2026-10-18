// Fuar / etkinlik / işbirliği logosu — crewinjob logosunun yanına eklenir.
//
// Marka logosundan farkı: geçicidir. Etkinlik bitince ilgisiz postlara sızmaması
// için bir bitiş tarihi tutulur; tarih geçtiyse okuma anında otomatik temizlenir.
// Bu mantık OutputPanel, SocialTab ve ContentLibraryTab tarafından paylaşılır.

export const PARTNER_LOGO_KEY  = 'crewinjob_partner_logo';
export const PARTNER_UNTIL_KEY = 'crewinjob_partner_logo_until';

export interface PartnerLogoState {
  data:  string;  // base64 (prefix'siz), boşsa logo yok
  until: string;  // 'YYYY-MM-DD', boşsa süresiz
}

const EMPTY: PartnerLogoState = { data: '', until: '' };

/** 'YYYY-MM-DD' günün sonuna kadar geçerli sayılır. */
export function isExpired(until: string): boolean {
  if (!until) return false;
  const end = new Date(`${until}T23:59:59`);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() < Date.now();
}

/**
 * Bitiş tarihine kaç gün kaldığı. Süresiz ise null, bugün bitiyorsa 0.
 *
 * Ham süre farkı değil TAKVİM GÜNÜ farkı hesaplanır: aksi halde son gün
 * (gece yarısına 10 saat kala) yukarı yuvarlanıp "1 gün kaldı" görünürdü.
 */
export function daysLeft(until: string): number | null {
  if (!until) return null;
  const end = new Date(`${until}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}

/** Süresi geçmişse depoyu temizler ve boş döner. */
export function loadPartnerLogo(): PartnerLogoState {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const data  = localStorage.getItem(PARTNER_LOGO_KEY)  || '';
    const until = localStorage.getItem(PARTNER_UNTIL_KEY) || '';
    if (!data) return EMPTY;
    if (isExpired(until)) { clearPartnerLogo(); return EMPTY; }
    return { data, until };
  } catch {
    return EMPTY;
  }
}

export function savePartnerLogo(data: string): void {
  try { localStorage.setItem(PARTNER_LOGO_KEY, data); } catch { /* ignore */ }
}

export function savePartnerUntil(until: string): void {
  try {
    if (until) localStorage.setItem(PARTNER_UNTIL_KEY, until);
    else       localStorage.removeItem(PARTNER_UNTIL_KEY);
  } catch { /* ignore */ }
}

export function clearPartnerLogo(): void {
  try {
    localStorage.removeItem(PARTNER_LOGO_KEY);
    localStorage.removeItem(PARTNER_UNTIL_KEY);
  } catch { /* ignore */ }
}
