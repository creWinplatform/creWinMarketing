// Sales assistant, after the first answer: the team's own booking page, a proposal draft with a shareable link, how
// companies are shared out in the team, and the data-keeping rules. Pure data shared by the server and the browser.
type Pair = [string, string];
export const BOOKING_LIMITS = { durations: [15, 30, 45, 60] as const, perDay: 20, slots: 200, note: 500 } as const;
export type BookingSettings = { enabled: boolean; title: string; durationMin: number; weekdays: number[]; startHour: number; endHour: number; noticeHours: number; horizonDays: number };
export const DEFAULT_BOOKING: BookingSettings = { enabled: false, title: '', durationMin: 30, weekdays: [1, 2, 3, 4, 5], startHour: 10, endHour: 17, noticeHours: 12, horizonDays: 14 };
export type BookingView = { id: string; startsAt: string; endsAt: string; name: string; email: string; company: string; note: string; prospectId: string | null; state: 'booked' | 'cancelled' };
export type BookingSnapshot = { settings: BookingSettings; link: string | null; upcoming: BookingView[]; canManage: boolean; canWrite: boolean };
// The public booking page (no session).
export type PublicBooking = { title: string; project: string; website: string; durationMin: number; timezone: string; slots: string[]; language: 'tr' | 'en'; primary: string; accent: string; logo: string | null };
export const BOOKING_NOTICE: Pair = [
  'Adınız, e-posta adresiniz, firmanız ve notunuz yalnız bu görüşmeyi planlamak ve sizinle iletişim kurmak için, randevu verdiğiniz işletmeye iletilir. Ayrıntılar için işletmenin aydınlatma metnine bakın.',
  'Your name, email address, company and note are passed only to the business you are booking with, to plan this meeting and contact you. See the business’s privacy notice for details.',
];

// successMetrics: agreed with the customer before a trial or start (Y Combinator: agree the success metrics first).
export type ProposalContent = { title: string; summary: string; needs: string[]; solution: string; scope: string[]; successMetrics: string[]; timeline: string; price: string; nextStep: string };
export const PROPOSAL_LIMITS = { title: 120, text: 1200, item: 240, items: 8, price: 200, days: 60, perDay: 30 } as const;
export type ProposalView = { content: ProposalContent; source: 'ai' | 'template' | 'human'; shared: { active: boolean; views: number; lastViewedAt: string | null; expiresAt: string } | null; revision: number; updatedAt: string };
export type PublicProposal = { language: 'tr' | 'en'; company: string; content: ProposalContent; createdAt: string; sender: { name: string; website: string; primary: string; accent: string; logo: string | null }; booking: string | null };

export type AssignMode = 'manual' | 'round_robin' | 'by_sector';
export type AssignRule = { sector: string; userId: string };
export type SalesMember = { id: string; username: string };
export const RETENTION_MONTHS = [0, 3, 6, 12] as const;
// A privacy notice the team can publish for B2B outreach; the project fills in its own details.
export const PRIVACY_TEMPLATE: Pair = [
  '{name} ({website}), iş birliği fırsatları için işletmelerle iletişime geçerken firmaların kendi sitelerinde, haritalarda veya iş rehberlerinde yayımladığı kurumsal iletişim bilgilerini ve bu firmaların çalışanlarının iş iletişim bilgilerini işler. Bu veriler 6698 sayılı KVKK’nın 5/2-f maddesi (meşru menfaat) kapsamında, yalnız iş teklifi sunmak ve yanıtlarınızı takip etmek amacıyla, {months} süreyle saklanır. Her e-postadaki bağlantıyla veya yanıt vererek iletişimi istediğiniz an durdurabilir; KVKK 11. maddedeki haklarınız için {website} üzerinden bize ulaşabilirsiniz.',
  '{name} ({website}) processes the business contact details companies publish on their own sites, on maps or in business directories, and the work contact details of their employees, when contacting businesses about cooperation. This data is kept for {months} on the basis of legitimate interest, only to offer our services and follow up your answers. You can stop the contact at any time with the link in every email or by replying; for your other rights, contact us through {website}.',
];
