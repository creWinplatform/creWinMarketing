import 'server-only';
import type Database from 'better-sqlite3';
import type { PlatformRepository } from './repository';

// The project a person opened last, so login returns there. Only remembered for projects they can still open; anything
// else falls back to the first project they belong to.
export function rememberProject(db: Database.Database, userId: string, organizationId: string, projectId: string) {
  db.prepare('INSERT INTO platform_user_preferences(user_id,last_organization_id,last_project_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET last_organization_id=excluded.last_organization_id,last_project_id=excluded.last_project_id,updated_at=excluded.updated_at').run(userId, organizationId, projectId, new Date().toISOString());
}
export function preferredWorkspace(db: Database.Database, repository: PlatformRepository, userId: string) {
  const spaces = repository.workspaces(userId), last = db.prepare('SELECT last_organization_id,last_project_id FROM platform_user_preferences WHERE user_id=?').get(userId) as { last_organization_id: string | null; last_project_id: string | null } | undefined;
  return spaces.find(space => space.organization.id === last?.last_organization_id && space.project.id === last?.last_project_id) || spaces[0] || null;
}
