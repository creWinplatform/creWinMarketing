export const EMAIL_QUEUE_LIMITS = { recipients: 5, jobsPerDay: 20, storedJobs: 500, leaseSeconds: 30, attempts: 3, lifetimeMinutes: 60 } as const;
export type PilotRecipientState = 'queued' | 'checking' | 'validated' | 'skipped' | 'uncertain' | 'cancelled' | 'submitting' | 'accepted' | 'rejected' | 'delivered' | 'bounced' | 'complained';
export type PilotReason = 'changed' | 'recipient_ineligible' | 'authority_lost' | 'expired' | 'interrupted' | 'cancelled' | 'check_failed';
export type EmailPilotJob = {
  id: string; campaignId: string; campaignName: string; mode: 'rehearsal'|'send';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  outcome: 'pending' | 'checked' | 'partial' | 'blocked' | 'interrupted' | 'cancelled';
  createdAt: string; updatedAt: string; attempts: number;
  total: number; checked: number; skipped: number; uncertain: number; cancelled: number;
  sender: { domain: string | null; maskedSender: string | null };
  gates: { smtp: boolean; domain: boolean; authentication: boolean };
  recipients: { id: number; maskedEmail: string; state: PilotRecipientState; reason: PilotReason | null }[];
  sendingEnabled: boolean; canManage: boolean;
  accepted?:number;delivered?:number;bounced?:number;complained?:number;
};
export type EmailPilotWorkspace = { jobs: EmailPilotJob[]; sendingEnabled: boolean };
export const PILOT_STATE_LABELS: Record<PilotRecipientState, [string, string]> = {
  queued: ['Bekliyor', 'Queued'], checking: ['Kontrol ediliyor', 'Checking'],
  validated: ['Alıcı kontrolleri geçti', 'Recipient checks passed'], skipped: ['Atlandı', 'Skipped'],
  uncertain: ['Sonuç belirsiz', 'Outcome uncertain'], cancelled: ['İptal edildi', 'Cancelled'],
  submitting:['SES’e sunuluyor','Submitting to SES'],accepted:['SES kabul etti','Accepted by SES'],rejected:['SES reddetti','Rejected by SES'],delivered:['Teslimat bildirildi','Delivery reported'],bounced:['Geri döndü','Bounced'],complained:['Şikâyet bildirildi','Complaint reported'],
};
export const PILOT_REASON_LABELS: Record<PilotReason, [string, string]> = {
  changed: ['Kampanya, onay veya gönderen değişti', 'Campaign, approval or sender changed'],
  recipient_ineligible: ['Alıcı, izin veya pilot listesi artık uygun değil', 'Recipient, consent or allowlist is no longer eligible'],
  authority_lost: ['İşlem yetkisi kaldırıldı', 'Operation permission was revoked'],
  expired: ['Pilot süresi doldu', 'Pilot expired'], interrupted: ['İşlem kesildi; otomatik tekrarlanmaz', 'Interrupted; will not retry automatically'],
  cancelled: ['Kullanıcı iptal etti', 'Cancelled by user'], check_failed: ['Kontrol tamamlanamadı', 'Check could not be completed'],
};
