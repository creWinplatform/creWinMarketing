// Invitations of existing accounts (for example an agency) to a project, and the portfolio of every project a person
// belongs to. Client-safe types only.
export type MemberInvite = { id: string; maskedEmail: string; role: 'admin' | 'editor' | 'analyst' | 'viewer'; state: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'; createdAt: string; expiresAt: string; decidedAt: string | null };
export type ReceivedInvite = { id: string; projectName: string; organizationName: string; role: MemberInvite['role']; invitedBy: string; expiresAt: string };
export type PortfolioProject = {
  organizationId: string; organizationName: string; projectId: string; projectName: string; website: string; role: string; current: boolean;
  plan: { id: string; active: boolean; endsAt: string | null } | null;
  alerts: { urgent: number; warning: number }; approvals: number;
  posts30: number; inboxOpen: number | null; lastReport: { month: string; approved: boolean } | null;
  // The open agency link of this project, if any (state and which agency project covers it).
  agency: { linkId: string; state: 'requested' | 'linked'; agencyProjectId: string } | null;
};
export type PortfolioView = { projects: PortfolioProject[]; invites: ReceivedInvite[]; total: number; agencies: AgencyView[] };
// Agency package: the agency's own (home) project and the client projects it covers.
export type AgencyLinkState = 'requested' | 'linked' | 'declined' | 'removed';
export type AgencyView = {
  organizationId: string; projectId: string; name: string; limit: number; used: number;
  period: { endsAt: string; graceEndsAt: string; inGrace: boolean } | null;
  links: { id: string; organizationId: string; projectId: string; projectName: string; organizationName: string; origin: 'created' | 'invited'; state: AgencyLinkState; requestedAt: string; decidedAt: string | null }[];
};
export type AgencyClientLink = { id: string; agencyName: string; agencyOrganization: string; requestedBy: string; origin: 'created' | 'invited'; state: AgencyLinkState; requestedAt: string; decidedAt: string | null; packageRunning: boolean };
