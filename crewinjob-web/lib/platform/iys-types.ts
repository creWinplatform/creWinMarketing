// İYS (İleti Yönetim Sistemi): Turkey's register of commercial-message consents. A project that declares it sends
// commercial messages to recipients in Turkey may send email (EPOSTA) and WhatsApp (MESAJ) only to recipients whose
// consent İYS confirms; new consents and opt-outs are reported to İYS within three business days.
// Switched off for now: with NEXT_PUBLIC_IYS_ENABLED unset, no İYS check, queue or screen is active and every project
// behaves as if it declared no İYS duty. Records already stored are kept. Set it to 1 (and restart) to turn İYS back on.
export const iysEnabled = () => process.env.NEXT_PUBLIC_IYS_ENABLED === '1';
export const IYS_CHANNELS = ['EPOSTA', 'MESAJ'] as const;
export type IysChannel = typeof IYS_CHANNELS[number];
export type IysStatus = 'ONAY' | 'RET';
export type IysScope = 'tr' | 'none' | null;
// BIREYSEL: individuals (prior consent needed). TACIR: merchants and tradespeople, who need no prior consent but can
// reject through İYS; used only when the project turns the merchant exemption on.
export type IysRecipientType = 'BIREYSEL' | 'TACIR';
export type IysEnvironment = 'production' | 'sandbox';
// How the consent was obtained, in İYS's own source codes.
export const IYS_SOURCES = ['HS_WEB', 'HS_EPOSTA', 'HS_MESAJ', 'HS_MOBIL', 'HS_SOSYAL_MEDYA', 'HS_FIZIKSEL_ORTAM', 'HS_ISLAK_IMZA', 'HS_CAGRI_MERKEZI', 'HS_ETKINLIK'] as const;
export type IysSource = typeof IYS_SOURCES[number];
export const IYS_SOURCE_LABELS: Record<IysSource, [string, string]> = {
  HS_WEB: ['Web sitesi formu', 'Website form'], HS_EPOSTA: ['E-posta ile', 'By email'], HS_MESAJ: ['SMS / mesaj ile', 'By text message'],
  HS_MOBIL: ['Mobil uygulama', 'Mobile app'], HS_SOSYAL_MEDYA: ['Sosyal medya', 'Social media'], HS_FIZIKSEL_ORTAM: ['Mağaza / yüz yüze', 'In store / in person'],
  HS_ISLAK_IMZA: ['Islak imzalı form', 'Signed paper form'], HS_CAGRI_MERKEZI: ['Çağrı merkezi', 'Call centre'], HS_ETKINLIK: ['Etkinlik', 'Event'],
};
export type IysGateReason = 'iys_scope_missing' | 'iys_not_connected' | 'iys_no_consent' | 'iys_rejected' | 'iys_stale';
export const IYS_REASON_LABELS: Record<IysGateReason, [string, string]> = {
  iys_scope_missing: ['İYS beyanı yapılmadı', 'No IYS declaration yet'],
  iys_not_connected: ['İYS bağlı değil', 'IYS is not connected'],
  iys_no_consent: ['İYS onayı yok', 'No consent in IYS'],
  iys_rejected: ['Alıcı İYS’de ret verdi', 'The recipient rejected in IYS'],
  iys_stale: ['İYS durumu 24 saatten eski', 'IYS status is older than 24 hours'],
};
export const IYS_LIMITS = { uploadBusinessDays: 3, freshHours: 24, pullMinutes: 30, attempts: 3, queryBatch: 50, outbox: 20000, perTick: 10, merchants: 2000, merchantsPerRequest: 100 } as const;
export type IysMerchantView = { channel: IysChannel; key: string; masked: string; evidence: string; checkedAt: string | null; createdAt: string };
export type IysOutboxItem = { id: string; channel: IysChannel; status: IysStatus; masked: string; dueAt: string; state: 'queued' | 'sent' | 'failed'; error: string | null };
export type IysView = {
  scope: IysScope; declaredAt: string | null; declaredBy: string | null; canManage: boolean;
  connection: { environment: IysEnvironment; iysCode: string; brandCode: string; connectedAt: string } | null;
  pull: { state: 'idle' | 'ok' | 'failed'; at: string | null; error: string | null };
  outbox: { queued: number; sent: number; failed: number; overdue: number; nextDue: string | null };
  statuses: Record<IysChannel, { ONAY: number; RET: number }>;
  attention: IysOutboxItem[];
  // The merchant exemption: whether it is on, who turned it on, and the recipients marked as merchants (masked).
  merchants: { enabled: boolean; by: string | null; at: string | null; list: IysMerchantView[]; total: number };
  // Crewin workspace only: its email gate's mode and the addresses waiting for an İYS check (lib/crewin-iys-email.ts).
  crewinEmail?: { mode: 'measure' | 'enforce'; by: string | null; at: string | null; pending: number };
};

// Turkey's official holidays (Law 2429). The fixed ones apply every year; the religious ones only for years whose dates
// Diyanet has published (add a year when its calendar is out). Half days (eves, 28 October) count as business days, and
// a year without religious dates skips only the fixed ones, so the deadline is never later than the legal one.
export const TR_FIXED_HOLIDAYS = ['01-01', '04-23', '05-01', '05-19', '07-15', '08-30', '10-29'] as const;
export const TR_RELIGIOUS_HOLIDAYS: Record<number, readonly string[]> = {
  2026: ['03-20', '03-21', '03-22', '05-27', '05-28', '05-29', '05-30'],
  2027: ['03-09', '03-10', '03-11', '05-16', '05-17', '05-18', '05-19'],
};
export function trHoliday(day: Date) {
  const key = day.toISOString().slice(5, 10);
  return (TR_FIXED_HOLIDAYS as readonly string[]).includes(key) || Boolean(TR_RELIGIOUS_HOLIDAYS[day.getUTCFullYear()]?.includes(key));
}
// Three business days after `from`, ending at 23:59:59 Istanbul time. Weekends and full-day official holidays are skipped.
export function iysDueAt(from: string | Date, days: number = IYS_LIMITS.uploadBusinessDays) {
  const istanbul = (instant: number) => new Date(instant + 3 * 3600000);
  const day = istanbul(new Date(from).getTime());
  let left = days;
  while (left > 0) { day.setUTCDate(day.getUTCDate() + 1); if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && !trHoliday(day)) left--; }
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59) - 3 * 3600000).toISOString();
}
// İYS writes dates as "YYYY-MM-DD HH:mm:ss" in Turkey time.
export function iysDate(value: string | Date) {
  const day = new Date(new Date(value).getTime() + 3 * 3600000).toISOString();
  return `${day.slice(0, 10)} ${day.slice(11, 19)}`;
}
