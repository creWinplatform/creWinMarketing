// Sales assistant, part 3: reaching approved companies and following them through a simple sales pipeline. An email
// sequence (a first email and at most two follow-ups) is written from the company's own site findings, approved by a
// person and sent from the project's own verified sender; LinkedIn and WhatsApp messages are prepared for a person to
// send from their own account. Pure data shared by the server and the browser.
type Pair = [string, string];

// Sending grows slowly (warm-up) and stops by itself when too many messages bounce or are reported as spam.
export const OUTREACH_LIMITS = {
  startPerDay: 10, stepPerDay: 5, maxPerDay: 50, followUps: 4, followUpDays: [3, 7] as readonly number[],
  // Short emails get answered: aim for 75 words with one question at the end (follow-ups 50); the hard limits leave
  // a little room for the team's own edits.
  subject: 80, firstWords: 90, followWords: 60, firstTarget: 75, followTarget: 50, channelChars: 600, linkedinChars: 300, signature: 300,
  draftsPerDay: 40, repliesPerDay: 60, remindDays: 90, autoReplyDays: 7, channelRemindDays: 5,
  pauseWindowDays: 14, minSendsForRate: 20, bounceRate: 0.05, bouncesWhenFew: 3, complaints: 2,
  windowStart: 9, windowEnd: 18,
} as const;
// The token the email text carries for the mini analysis link; replaced by the real link when the email goes out.
export const ANALYSIS_TOKEN = '{{analiz}}';

export type PipelineStage = 'new' | 'contacted' | 'replied' | 'meeting' | 'proposal' | 'won' | 'lost';
export const PIPELINE_STAGES: PipelineStage[] = ['new', 'contacted', 'replied', 'meeting', 'proposal', 'won', 'lost'];
export const STAGE_LABELS: Record<PipelineStage, Pair> = {
  new: ['Yeni', 'New'], contacted: ['İletişime geçildi', 'Contacted'], replied: ['Yanıt geldi', 'Replied'], meeting: ['Görüşme', 'Meeting'],
  proposal: ['Teklif', 'Proposal'], won: ['Kazanıldı', 'Won'], lost: ['Kaybedildi', 'Lost'],
};

export type ReplyClass = 'interested' | 'not_now' | 'not_interested' | 'feature_gap' | 'wrong_person' | 'auto_reply';
export const REPLY_CLASSES: Record<ReplyClass, { label: Pair; effect: Pair }> = {
  interested: { label: ['İlgileniyor', 'Interested'], effect: ['Takipler durdu; görüşme için Takvim’e iş eklendi.', 'Follow-ups stopped; a meeting task was added to the Calendar.'] },
  not_now: { label: ['Şimdi değil', 'Not now'], effect: ['Takipler durdu; 3 ay sonra hatırlatılacak.', 'Follow-ups stopped; you will be reminded in 3 months.'] },
  not_interested: { label: ['İstemiyor', 'Not interested'], effect: ['Adres engellendi ve bir daha yazılmaz; İYS’ye ret bildirilir.', 'The address is blocked and never written to again; the opt-out goes to İYS.'] },
  // Y Combinator: “it’s just missing this one feature” is almost a pass.
  feature_gap: { label: ['Tek bir özellik eksik', 'Just one feature missing'], effect: ['Neredeyse ret sayılır: takipler durdu, eksik özellik hunide not edildi. Gerçekten yapılacaksa haber verin, yoksa kapatın.', 'Almost a pass: follow-ups stopped and the missing feature is noted in the pipeline. Tell them if you will really build it; otherwise close it.'] },
  wrong_person: { label: ['Yanlış kişi', 'Wrong person'], effect: ['Bu adrese takip gitmez; firmaya başka bir adresten ulaşabilirsiniz.', 'No follow-up goes to this address; reach the company through another one.'] },
  auto_reply: { label: ['Otomatik yanıt', 'Automatic reply'], effect: ['Sıradaki takip bir hafta ertelendi.', 'The next follow-up was moved by a week.'] },
};

export type OutreachStep = { subject: string; body: string };
export type OutreachState = 'draft' | 'active' | 'finished' | 'replied' | 'stopped' | 'bounced' | 'failed';
export type OutreachStopReason = 'cancelled' | 'replied' | 'unsubscribed' | 'blocked' | 'bounced' | 'complained' | 'uncertain' | 'rejected' | 'stage' | 'removed';
export type OutreachWait = null | 'switch_off' | 'sender_not_ready' | 'iys' | 'paused' | 'daily_limit' | 'window' | 'no_origin';
export const WAIT_LABELS: Record<Exclude<OutreachWait, null>, Pair> = {
  switch_off: ['Satış e-postası gönderimi bu sunucuda kapalı.', 'Sales email sending is off on this server.'],
  sender_not_ready: ['Gönderen (SES) hazır değil: alan adı, DKIM ve geri bildirim doğrulanmalı.', 'The sender (SES) is not ready: domain, DKIM and feedback must be verified.'],
  iys: ['İYS kontrolü bekleniyor.', 'Waiting for the İYS check.'],
  paused: ['Gönderim, geri dönen veya şikâyet edilen e-postalar yüzünden durduruldu.', 'Sending was paused because of bounced or reported emails.'],
  daily_limit: ['Bugünkü gönderim sınırı doldu; ilk uygun saatte gider.', 'Today’s sending limit is reached; it goes at the next opening.'],
  window: ['Mesai saatinde (hafta içi 09–18) gönderilecek.', 'It goes during business hours (weekdays 9–18).'],
  no_origin: ['Ret bağlantısı için genel adres (PLATFORM_PUBLIC_ORIGIN) eksik.', 'The public address for the opt-out link (PLATFORM_PUBLIC_ORIGIN) is missing.'],
};
export type OutreachSend = { step: number; state: 'reserved' | 'accepted' | 'delivered' | 'bounced' | 'complained' | 'uncertain' | 'rejected'; at: string };
export type OutreachView = {
  id: string; prospectId: string; contactId: string | null; maskedEmail: string | null; language: 'tr' | 'en';
  steps: OutreachStep[]; linkedin: string; whatsapp: string; source: 'ai' | 'template' | 'human';
  state: OutreachState; approvedAt: string | null; sentSteps: number; nextDueAt: string | null; lastSentAt: string | null;
  wait: OutreachWait; stopReason: OutreachStopReason | null;
  reply: { kind: ReplyClass; summary: string; draft: string; at: string } | null; remindAt: string | null;
  sends: OutreachSend[]; revision: number; updatedAt: string;
};
// Qualifying (Y Combinator: check the problem, the budget and who signs; get to a yes or a no fast).
export type Qualification = { problem: 'yes' | 'no' | 'unknown'; budget: 'yes' | 'no' | 'unknown'; signer: string; nextStep: string; nextStepAt: string | null };
export const STALE_DAYS = 14;
export type PipelineEntry = { stage: PipelineStage; valueMinor: number | null; currency: string; lostReason: string; assignedTo: string | null; updatedAt: string;
  qualification: Qualification; featureGap: string; stageSince: string; stale: boolean };
export type ChannelTouch = { channel: 'linkedin' | 'whatsapp' | 'phone' | 'network'; at: string };
export type OutreachSettings = { fromName: string; signature: string; calendarUrl: string; followUpDays: number[]; updatedAt: string | null;
  privacyUrl: string; retentionMonths: number; weeklyGoal: number; orgWide: boolean; assignMode: 'manual' | 'round_robin' | 'by_sector'; assignRules: { sector: string; userId: string }[]; bookingUrl: string | null };
export type OutreachReadiness = {
  switchOn: boolean; senderReady: boolean; domain: string | null; publicOrigin: boolean;
  dmarc: { state: 'ok' | 'missing' | 'unknown'; checkedAt: string | null };
  iys: 'not_required' | 'ready' | 'needs_exemption' | 'not_connected' | 'scope_missing';
  paused: { reason: 'bounces' | 'complaints'; at: string } | null;
  dailyLimit: number; sentToday: number;
};
// What the team's own history says: replies by sector, by the site signal the email was built on, and by who wrote it.
export type LearningRow = { key: string; sends: number; replies: number; interested: number };
// channels: first touches by way in (email, warm introduction, LinkedIn, WhatsApp, phone) and how many moved on.
export type SalesLearning = { sends: number; replies: number; interested: number; won: number; sectors: LearningRow[]; signals: LearningRow[]; sources: LearningRow[]; channels: LearningRow[] };
export const LEARNING_MIN_SENDS = 5;
// The week in numbers (Y Combinator: it is a numbers game; 2–3 replies per 100 emails is a fine place to start).
export type SalesWeek = { weekStart: string; goal: number; touches: number; replies: number; meetings: number; firstHundred: number; emails: number; emailReplies: number; active: boolean };
export const FIRST_HUNDRED = 100;
export type SalesSnapshot = {
  outreach: Record<string, OutreachView>; pipeline: Record<string, PipelineEntry>; touches: Record<string, ChannelTouch[]>;
  settings: OutreachSettings; readiness: OutreachReadiness; stages: Record<PipelineStage, number>; learning: SalesLearning; week: SalesWeek;
  members: { id: string; username: string }[];
  // Who the team already knows at each company (first name and initial, how many people).
  network: Record<string, { count: number; first: string; position: string }>;
  aiConfigured: boolean; canWrite: boolean; canApprove: boolean; canManage: boolean;
};
