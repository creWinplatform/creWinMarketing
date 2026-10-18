import 'server-only';
import { getSessionIdentity } from '@/lib/auth';
import { platformDatabase } from './database';
import { PlatformRepository } from './repository';
import type { WorkspacePermission } from './access';
import { securityVersion } from './account';

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
