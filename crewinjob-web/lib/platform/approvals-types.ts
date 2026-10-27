// "Waiting for your decision": counts of records that need a person's approval, each linking to its own screen.
export type ApprovalKind = 'coach_brief' | 'coach_review' | 'coach_renewal' | 'content_plan' | 'inbox_reply' | 'ad_plan' | 'whatsapp_approve' | 'whatsapp_send' | 'automation' | 'monthly_report' | 'agency_link';
export type ApprovalItem = { kind: ApprovalKind; count: number; oldest: string | null; href: string };
export type ApprovalsView = { items: ApprovalItem[]; timezone: string };
