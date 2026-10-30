// Things that need the team before a deadline passes. Computed from existing records for the viewing member's rights;
// nothing is sent to customers and no message text, contact or account name leaves the app in the email.
export type TeamAlertKind = 'inbox_window' | 'publication_failed' | 'connection_expiring' | 'billing_period' | 'ad_error' | 'invite_pending' | 'seo_findings' | 'search_drop' | 'iys_deadline' | 'iys_sync';
export type TeamAlert = {
  kind: TeamAlertKind; severity: 'urgent' | 'warning'; count: number;
  // The earliest deadline (inbox window close, access expiry, period end) or the latest event time.
  at: string | null; href: string;
  // Billing only: which period is ending.
  phase?: 'paid_ending' | 'grace' | 'trial_ending';
  // Search drop only: clicks in the last 7 complete days and the 7 before (shown to connection managers only).
  clicks?: { current: number; previous: number };
  // Underlying records; a new one makes the alert new for the email.
  keys: string[];
};
export type TeamAlertsView = {
  alerts: TeamAlert[]; timezone: string;
  email: { enabled: boolean; subscribed: boolean; language: 'tr' | 'en' | null; hasVerifiedEmail: boolean };
  // Phone (web push) notifications are set per browser, so only whether the server offers them is known here.
  push: { enabled: boolean };
};
export const TEAM_ALERT_LIMITS = { inboxWarningHours: 6, eventDays: 7, accessDays: 7, paidDays: 7, trialDays: 3, emailGapHours: 3, emailsPerDay: 6 } as const;
