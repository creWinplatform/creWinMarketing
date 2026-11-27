// Sales assistant: customer groups (segments). Who the team sells to, as a few concrete groups ("dental clinics
// without online booking"), each with why it fits, an estimated fit, the search phrase for Find companies and the
// site signals that mean an opportunity. The companies found for a group are counted under it, and its results
// (emails, replies, meetings, wins) tell whether to find more of them or to stop. Pure data for server and browser.
import type { SignalKey } from './prospect-finder-types';
type Pair = [string, string];

export const SEGMENT_LIMITS = { max: 8, suggestPerDay: 5, suggestions: 4, name: 60, reason: 240, keyword: 60, signals: 3,
  // Results: too early before 10 first emails; 20 first emails without a reply means the message or the group is wrong.
  early: 10, pauseAfter: 20, scaleRate: 0.05 } as const;
export type SegmentAdvice = 'early' | 'scale' | 'steady' | 'pause';
export const SEGMENT_ADVICE: Record<SegmentAdvice, { label: Pair; text: Pair }> = {
  early: { label: ['Henüz erken', 'Too early'], text: ['Sonuç için bu gruba en az 10 ilk e-posta veya temas gerekiyor.', 'This group needs at least 10 first emails or touches before it tells anything.'] },
  scale: { label: ['İşe yarıyor: büyüt', 'Working: grow it'], text: ['Bu gruptan ilgilenen yanıt geliyor. Aynı aramayı başka şehirlerde yapıp daha çok firma bulun.', 'This group answers with interest. Run the same search in other cities to find more companies.'] },
  steady: { label: ['Normal', 'Normal'], text: ['Yanıtlar normal aralıkta (100 e-postada 2–3). Devam edin, mesajı firmaya göre kişiselleştirin.', 'Replies are in the normal range (2–3 per 100 emails). Keep going and tailor the message to each company.'] },
  pause: { label: ['Tutmuyor: değiştir', 'Not working: change it'], text: ['20 ilk e-postaya yanıt yok. Mesajı değiştirin veya bu grubu duraklatıp başka bir gruba geçin.', '20 first emails and no reply. Change the message, or pause this group and move to another one.'] },
};
export type SegmentView = {
  id: string; name: string; reason: string; fit: number; keyword: string; signals: SignalKey[]; state: 'active' | 'paused'; source: 'ai' | 'template' | 'human';
  prospects: number; approved: number; sends: number; replies: number; interested: number; meetings: number; won: number; advice: SegmentAdvice; createdAt: string;
};
export type SegmentsSnapshot = {
  segments: SegmentView[]; members: Record<string, string>; aiConfigured: boolean; canWrite: boolean; suggestionsLeft: number;
  // What a suggestion can rest on: the growth coach's customer profile, competitors, and companies the team approved or won.
  basis: { profile: boolean; competitors: number; approved: number; won: number };
};
export function segmentAdvice(sends: number, replies: number, interested: number): SegmentAdvice {
  if (interested > 0 && sends >= 3 || sends >= SEGMENT_LIMITS.early && replies / sends >= SEGMENT_LIMITS.scaleRate) return 'scale';
  if (sends < SEGMENT_LIMITS.early) return 'early';
  if (sends >= SEGMENT_LIMITS.pauseAfter && replies === 0) return 'pause';
  return 'steady';
}
