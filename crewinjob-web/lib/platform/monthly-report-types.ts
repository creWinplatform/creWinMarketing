// Monthly results report: counts and provider-reported figures for one calendar month in the project's time zone.
// It is assembled from the project's own records, approved by a person and only then shared. No customer message text,
// contact or personal data is ever part of it.
export type ReportPost = { title: string; channel: string; publishedAt: string; url: string | null; sessions: number | null; keyEvents: number | null; interactions: number | null };
export type MonthlyReportFacts = {
  version: 1; month: string; from: string; to: string; timezone: string; language: 'tr' | 'en';
  project: { name: string; website: string };
  publications: { total: number; byChannel: { channel: string; count: number }[]; top: ReportPost[] };
  // Sessions and key events GA4 reported for the tagged links of this month's posts, in GA4's stored period.
  site: { state: 'ready' | 'partial' | 'no_data'; from: string; to: string; checkedAt: string; posts: number; sessions: number; keyEvents: number } | null;
  engagement: { observed: number; interactions: number } | null;
  inbox: { received: number; comments: number; messages: number; replied: number; messagesInWindow: number; open: number; dismissed: number } | null;
  email: { sends: number; accepted: number; delivered: number; bounced: number; complained: number } | null;
  ads: { name: string; provider: string; currency: string; spendMinor: number | null; impressions: number | null; clicks: number | null; checkedAt: string | null }[];
  measurements: { goal: { tr: string; en: string }; stage: { tr: string; en: string }; source: string; first: number; firstAt: string; last: number; lastAt: string; entries: number }[];
  work: { drafts: number; coachActionsDone: number; contentPlanApproved: number; tasksCompleted: number };
  // People who arrived through a tagged post or email and reached a goal stage this month, by the team's own product
  // events (first touch, 90 days). Absent in reports approved before it existed.
  results?: MonthlyResults | null;
};
export type MonthlyResults = {
  stages: { tr: string; en: string }[];
  coverage: { entities: number; touched: number; ryzevo: number } | null;
  value: { currency: string; eventName: string } | null;
  items: { title: string; kind: 'content' | 'campaign'; sources: string[]; counts: number[]; value: number | null }[];
  channels: { source: string; counts: number[]; value: number | null }[];
};
export type ReportShare = { id: string; createdAt: string; expiresAt: string; revokedAt: string | null; views: number; lastViewedAt: string | null };
export type MonthlyReportView = {
  month: string; months: string[]; state: 'draft' | 'approved';
  facts: MonthlyReportFacts; digest: string; note: string;
  approvedAt: string | null; approvedBy: string | null; revision: number;
  canEdit: boolean; canApprove: boolean; shares: ReportShare[];
};
// What a link opens: the approved snapshot and note only.
export type SharedReport = { facts: MonthlyReportFacts; note: string; approvedAt: string; expiresAt: string };
export const REPORT_LIMITS = { months: 12, note: 1200, sharesPerReport: 5, shareDays: [7, 30, 90] as const, topPosts: 10 } as const;
