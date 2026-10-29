import 'server-only';
import { getSessionIdentity } from '@/lib/auth';
import { platformDatabase } from './database';
import { PlatformRepository } from './repository';
import type { WorkspacePermission } from './access';
import { securityVersion } from './account';
import { isLegacyScope } from './access';

export function platformRepository() {
  const repository = new PlatformRepository(platformDatabase());
  if (process.env.ADMIN_USERNAME) repository.bootstrapLegacy(process.env.ADMIN_USERNAME);
  return repository;
}

export async function getPlatformAccess(permission: WorkspacePermission = 'read') {
  const identity = await getSessionIdentity();
  if (!identity) return null;
  const repository = platformRepository();
  if(identity.mode==='platform' && (identity.securityVersion || 0)!==securityVersion(platformDatabase(),identity.subject)) return null;
  const subject = identity.mode === 'legacy' && identity.subject === process.env.ADMIN_USERNAME ? 'legacy-admin' : identity.mode === 'platform' ? identity.subject : '';
  if (!subject || !repository.can(subject, identity.organizationId, identity.projectId, permission)) return null;
  return { subject, identity, repository };
}

// Ryzevo routes: a project (platform) session, or the Crewin workspace's single legacy account on its own project. The
// legacy session keeps its Crewin tabs and data sources; which Ryzevo features it reaches is decided per store by
// ryzevoFeature (lib/platform/ryzevo-features.ts).
export async function getRyzevoAccess(permission: WorkspacePermission = 'read') {
  const access = await getPlatformAccess(permission);
  if (!access) return null;
  if (access.identity.mode === 'platform') return access;
  return access.subject === 'legacy-admin' && isLegacyScope(access.identity.organizationId, access.identity.projectId) ? access : null;
}

export async function getAuthorizedWorkspace() {
  const access = await getPlatformAccess();
  if (!access) return null;
  const workspace = access.repository.workspace(access.subject, access.identity.organizationId, access.identity.projectId);
  if (workspace && access.identity.mode === 'legacy') workspace.accessMode = 'legacy_single_account';
  // Crewin-only adapters are not enabled for team accounts until their permissions are mapped.
  if (workspace && access.identity.mode === 'platform' && workspace.project.productPack === 'crewin') {
    workspace.modules = workspace.modules.filter(module => module.id === 'project');
  }
  return workspace;
}
