// Invitations of existing accounts (for example an agency) to a project, and the portfolio of every project a person
// belongs to. Client-safe types only.
export type MemberInvite = { id: string; maskedEmail: string; role: 'admin' | 'editor' | 'analyst' | 'viewer'; state: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'; createdAt: string; expiresAt: string; decidedAt: string | null };
export type ReceivedInvite = { id: string; projectName: string; organizationName: string; role: MemberInvite['role']; invitedBy: string; expiresAt: string };
export type PortfolioProject = {
  organizationId: string; organizationName: string; projectId: string; projectName: string; website: string; role: string; current: boolean;
  plan: { id: string; active: boolean; endsAt: string | null } | null;
  alerts: { urgent: number; warning: number }; approvals: number;
  posts30: number; inboxOpen: number | null; lastReport: { month: string; approved: boolean } | null;
};
export type PortfolioView = { projects: PortfolioProject[]; invites: ReceivedInvite[]; total: number };
