import 'server-only';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { projectEntitlement } from './entitlements';
import { hasMessagingDuty } from './messaging-duties';
import { teamAlerts } from './team-alerts';
import { approvalQueue } from './approvals';
import { coachMonthKey } from './coach-content';
import { receivedInvites } from './member-invites';
import { agencyHomes } from './agency';
import type { PortfolioView } from './member-invites-types';

const DAY = 86400000, PROJECTS = 50;
// Every standard project the person belongs to, each read with that person's own rights in that project: alerts and
// approvals are the same lists the project's overview shows them. Counts only; nothing crosses from one project to another.
export function portfolio(db: Database.Database, subject: string, current: { organizationId: string; projectId: string }, now = Date.now()): PortfolioView {
  const repo = new PlatformRepository(db), spaces = repo.workspaces(subject).filter(space => space.project.productPack === 'standard');
  const projects = spaces.slice(0, PROJECTS).map(space => {
    const scope = { subject, organizationId: space.organization.id, projectId: space.project.id }, args = [scope.organizationId, scope.projectId] as const;
    let plan: PortfolioView['projects'][number]['plan'] = null;
    try { const rights = projectEntitlement(db, scope); plan = { id: rights.id, active: rights.active, endsAt: rights.endsAt }; } catch { plan = null; }
    const alerts = teamAlerts(db, scope, now).filter(item => item.kind !== 'invite_pending'), approvals = approvalQueue(db, scope, now);
    const role = (db.prepare('SELECT role FROM platform_memberships WHERE user_id=? AND organization_id=? AND project_id=?').get(subject, ...args) as { role: string }).role;
    const posts30 = (db.prepare("SELECT COUNT(*) n FROM platform_social_publications WHERE organization_id=? AND project_id=? AND mode='publish' AND state='accepted' AND COALESCE(submitted_at,scheduled_at)>=?").get(...args, new Date(now - 30 * DAY).toISOString()) as { n: number }).n;
    const inboxOpen = hasMessagingDuty(db, subject, ...args, 'source.read') ? (db.prepare("SELECT COUNT(*) n FROM platform_social_inbox WHERE organization_id=? AND project_id=? AND state='new'").get(...args) as { n: number }).n : null;
    const month = coachMonthKey(new Date(now), -1, space.project.timezone);
    const report = db.prepare('SELECT state FROM platform_monthly_reports WHERE organization_id=? AND project_id=? AND month=?').get(...args, month) as { state: string } | undefined;
    const link = db.prepare("SELECT id,state,agency_project_id FROM platform_agency_links WHERE organization_id=? AND project_id=? AND state IN ('requested','linked')").get(...args) as { id: string; state: 'requested' | 'linked'; agency_project_id: string } | undefined;
    return { organizationId: space.organization.id, organizationName: space.organization.name, projectId: space.project.id, projectName: space.project.name, website: space.project.website, role,
      current: space.organization.id === current.organizationId && space.project.id === current.projectId, plan,
      alerts: { urgent: alerts.filter(item => item.severity === 'urgent').length, warning: alerts.filter(item => item.severity === 'warning').length },
      approvals: approvals.reduce((sum, item) => sum + item.count, 0), posts30, inboxOpen, lastReport: { month, approved: report?.state === 'approved' },
      agency: link ? { linkId: link.id, state: link.state, agencyProjectId: link.agency_project_id } : null };
  });
  // Projects that need someone first: urgent alerts, then waiting decisions, then by name.
  projects.sort((a, b) => b.alerts.urgent - a.alerts.urgent || b.approvals - a.approvals || a.projectName.localeCompare(b.projectName));
  return { projects, invites: receivedInvites(db, subject), total: spaces.length, agencies: agencyHomes(db, subject) };
}
