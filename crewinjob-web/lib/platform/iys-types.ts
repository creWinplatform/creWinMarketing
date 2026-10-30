// İYS (İleti Yönetim Sistemi): Turkey's register of commercial-message consents. A project that declares it sends
// commercial messages to recipients in Turkey may send email (EPOSTA) and WhatsApp (MESAJ) only to recipients whose
// consent İYS confirms; new consents and opt-outs are reported to İYS within three business days.
export const IYS_CHANNELS = ['EPOSTA', 'MESAJ'] as const;
export type IysChannel = typeof IYS_CHANNELS[number];
export type IysStatus = 'ONAY' | 'RET';
export type IysScope = 'tr' | 'none' | null;
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
export const IYS_LIMITS = { uploadBusinessDays: 3, freshHours: 24, pullMinutes: 30, attempts: 3, queryBatch: 50, outbox: 20000, perTick: 10 } as const;
export type IysOutboxItem = { id: string; channel: IysChannel; status: IysStatus; masked: string; dueAt: string; state: 'queued' | 'sent' | 'failed'; error: string | null };
export type IysView = {
  scope: IysScope; declaredAt: string | null; declaredBy: string | null; canManage: boolean;
  connection: { environment: IysEnvironment; iysCode: string; brandCode: string; connectedAt: string } | null;
  pull: { state: 'idle' | 'ok' | 'failed'; at: string | null; error: string | null };
  outbox: { queued: number; sent: number; failed: number; overdue: number; nextDue: string | null };
  statuses: Record<IysChannel, { ONAY: number; RET: number }>;
  attention: IysOutboxItem[];
};

// Three business days after `from`, ending at 23:59:59 Istanbul time. Weekends are skipped; public holidays are not
// counted as days off, so the deadline is never later than the legal one.
export function iysDueAt(from: string | Date, days: number = IYS_LIMITS.uploadBusinessDays) {
  const istanbul = (instant: number) => new Date(instant + 3 * 3600000);
  const day = istanbul(new Date(from).getTime());
  let left = days;
  while (left > 0) { day.setUTCDate(day.getUTCDate() + 1); if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) left--; }
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59) - 3 * 3600000).toISOString();
}
// İYS writes dates as "YYYY-MM-DD HH:mm:ss" in Turkey time.
export function iysDate(value: string | Date) {
  const day = new Date(new Date(value).getTime() + 3 * 3600000).toISOString();
  return `${day.slice(0, 10)} ${day.slice(11, 19)}`;
}
