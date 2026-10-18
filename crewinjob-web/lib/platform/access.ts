export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'analyst' | 'viewer';
export type WorkspacePermission = 'read' | 'content.write' | 'campaign.approve' | 'campaign.dispatch' | 'connections.manage' | 'members.manage' | 'recipients.manage' | 'billing.manage';
export type Membership = {
  subject: string;
  organizationId: string;
  projectIds: readonly string[];
  role: WorkspaceRole;
  active: boolean;
};
const ROLE_PERMISSIONS: Record<WorkspaceRole, readonly WorkspacePermission[]> = {
  owner: ['read', 'content.write', 'campaign.approve', 'campaign.dispatch', 'connections.manage', 'members.manage', 'recipients.manage', 'billing.manage'],
  admin: ['read', 'content.write', 'campaign.approve', 'campaign.dispatch', 'connections.manage', 'members.manage', 'recipients.manage'],
  editor: ['read', 'content.write', 'campaign.dispatch'],
  analyst: ['read'],
  viewer: ['read'],
};

export function hasWorkspacePermission(memberships: readonly Membership[], subject: string,
  organizationId: string, projectId: string, permission: WorkspacePermission): boolean {
  return memberships.some(membership => membership.active && membership.subject === subject
    && membership.organizationId === organizationId && membership.projectIds.includes(projectId)
    && (ROLE_PERMISSIONS[membership.role]?.includes(permission) ?? false));
}

// Compatibility mapping only. Replace with persisted, server-verified membership in layer 2B.
export function legacyMembership(subject: string, administrator: string | undefined): Membership | null {
  if (!administrator || subject !== administrator) return null;
  return { subject, organizationId: 'crewin', projectIds: ['crewinjob'], role: 'owner', active: true };
}

export const LEGACY_SCOPE = { organizationId: 'crewin', projectId: 'crewinjob' } as const;
export function isLegacyScope(organizationId: unknown, projectId: unknown): boolean {
  return organizationId === LEGACY_SCOPE.organizationId && projectId === LEGACY_SCOPE.projectId;
}
