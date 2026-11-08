import 'server-only';
import { getSessionIdentity } from '@/lib/auth';
import { platformDatabase } from './database';
import { PlatformRepository } from './repository';
import type { WorkspacePermission } from './access';
import { securityVersion } from './account';
import { isLegacyScope } from './access';

// The legacy administrator rows are ensured once per process and username, not on every request: on SQL Server the
// per-request upsert transaction made concurrent requests deadlock on the same rows and added five round trips each.
const legacyReady = globalThis as typeof globalThis & { __ryzevoLegacyBootstrap?: Map<string, Promise<void>> };
export async function platformRepository() {
  const repository = new PlatformRepository(platformDatabase());
  const username = process.env.ADMIN_USERNAME;
  if (username) {
    const done = legacyReady.__ryzevoLegacyBootstrap ??= new Map();
    let ready = done.get(username);
    if (!ready) {
      ready = repository.bootstrapLegacy(username);
      done.set(username, ready);
      ready.catch(() => done.delete(username));
    }
    await ready;
  }
  return repository;
}

export async function getPlatformAccess(permission: WorkspacePermission = 'read') {
  const identity = await getSessionIdentity();
  if (!identity) return null;
  const repository = await platformRepository();
  if(identity.mode==='platform' && (identity.securityVersion || 0)!==await securityVersion(platformDatabase(),identity.subject)) return null;
  const subject = identity.mode === 'legacy' && identity.subject === process.env.ADMIN_USERNAME ? 'legacy-admin' : identity.mode === 'platform' ? identity.subject : '';
  if (!subject || !await repository.can(subject, identity.organizationId, identity.projectId, permission)) return null;
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
  const workspace = await access.repository.workspace(access.subject, access.identity.organizationId, access.identity.projectId);
  if (workspace && access.identity.mode === 'legacy') workspace.accessMode = 'legacy_single_account';
  // Crewin-only adapters are not enabled for team accounts until their permissions are mapped.
  if (workspace && access.identity.mode === 'platform' && workspace.project.productPack === 'crewin') {
    workspace.modules = workspace.modules.filter(module => module.id === 'project');
  }
  return workspace;
}
