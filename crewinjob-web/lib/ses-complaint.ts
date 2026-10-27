// ─── Legacy Crewin panel: SES spam complaints → Crewin backend ──────────────────────────────────────────────
// Backend contract (27 October 2026):
// - TrackActivationEvent accepts eventName 'email_complained'.
// - A complaint with the List-Unsubscribe token goes to ProcessUnsubscribe with reason 'complaint'.
// - A complaint without a token goes to GrowthAnalytics/SuppressContact (userId and/or email, channel, reason,
//   campaignId, providerEventId so a repeated notification is not counted twice). It answers status ok | not_found |
//   invalid, and each outcome is written to the activity log separately.
export type ComplaintApi = {
  trackActivationEvent: (eventName: string, userId: number, metadata?: Record<string, unknown>, source?: string) => Promise<unknown>;
  growthAnalyticsPost: (endpoint: string, body?: Record<string, unknown>) => Promise<unknown>;
  growthAnalyticsPublicPost: (endpoint: string, body?: Record<string, unknown>) => Promise<unknown>;
};
export type ComplaintOutcome = 'ok' | 'not_found' | 'invalid' | 'error';
export type ComplaintInput = {
  recipients: string[]; userId: number | null; campaignId: string | null; token: string | null;
  feedbackType: string | null; providerMessageId: string | null;
  // SES feedbackId or the SNS MessageId: the same for every retry of one complaint.
  eventId: string;
};

export function maskEmail(value: string): string {
  const [local, domain] = String(value || '').split('@');
  return domain ? `${local.slice(0, 2)}***@${domain}` : '***';
}
export function suppressionOutcome(result: unknown): ComplaintOutcome {
  const status = result && typeof result === 'object' ? String((result as { status?: unknown }).status || '') : '';
  return status === 'ok' || status === 'not_found' || status === 'invalid' ? status : 'error';
}
// Turkish labels; the English pairs are in lib/i18n/messages-en.ts.
export const COMPLAINT_LABELS: Record<ComplaintOutcome | 'unsubscribed', string> = {
  unsubscribed: 'Spam şikâyeti: kişinin e-posta aboneliği sonlandırıldı',
  ok: 'Spam şikâyeti: kişi e-posta listesinden çıkarıldı',
  not_found: 'Spam şikâyeti: adres hiçbir kullanıcıya veya adaya ait değil',
  invalid: 'Spam şikâyeti işlenemedi: kullanıcı ve e-posta bilgisi yok',
  error: 'Spam şikâyeti backend’e iletilemedi',
};

export function complaintTasks(input: ComplaintInput, api: ComplaintApi, record: (outcome: ComplaintOutcome | 'unsubscribed', detail: string) => Promise<unknown> | void): Array<() => Promise<unknown>> {
  const tasks: Array<() => Promise<unknown>> = [];
  const { userId, campaignId, token, feedbackType } = input;
  if (userId != null) tasks.push(() => api.trackActivationEvent('email_complained', userId, { campaign: campaignId, feedbackType }, 'ses-webhook'));
  if (token) {
    tasks.push(async () => {
      try {
        try {
          await api.growthAnalyticsPublicPost('ProcessUnsubscribe', { token, channel: 'email', reason: 'complaint' });
        } catch (error) {
          // Until the backend accepts 'complaint' everywhere, a 400 is retried as the person's own request.
          if (Number((error as { status?: number }).status || 0) !== 400) throw error;
          await api.growthAnalyticsPublicPost('ProcessUnsubscribe', { token, channel: 'email', reason: 'user_request' });
        }
      } catch (error) {
        await record('error', input.recipients.map(maskEmail).join(', '));
        throw error;
      }
      await record('unsubscribed', input.recipients.map(maskEmail).join(', '));
    });
  } else {
    // The userId tag belongs to the one recipient of a personal send; with several recipients only the address is sent.
    input.recipients.forEach((email, index) => tasks.push(async () => {
      let outcome: ComplaintOutcome;
      try {
        outcome = suppressionOutcome(await api.growthAnalyticsPost('SuppressContact', {
          ...(userId != null && input.recipients.length === 1 ? { userId } : {}), email, channel: 'email', reason: 'complaint',
          ...(campaignId ? { campaignId } : {}), providerEventId: `${input.eventId}:${index}`.slice(0, 200),
        }));
      } catch { outcome = 'error'; }
      await record(outcome, maskEmail(email));
    }));
  }
  if (userId != null && campaignId) {
    tasks.push(() => api.growthAnalyticsPost('TrackCampaignDeliveryEvent', {
      userId, campaignId, channel: 'email', eventType: 'complained', providerMessageId: input.providerMessageId, occurredAt: new Date().toISOString(),
      metadataJson: JSON.stringify({ feedbackType }),
    }));
  }
  return tasks;
}
