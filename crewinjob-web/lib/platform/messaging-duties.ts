import { everySeries } from '../db/async-array';
import type { Db } from '../db/client';
import 'server-only';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import type { WorkspacePermission } from './access';
import type { MessagingDuty } from './messaging-types';

// Each duty sits on top of an existing workspace permission; the duty alone never grants anything.
// Publishing to a channel already needs the full social publishing rights (connect, approve and dispatch).
export const DUTY_BASE:Record<MessagingDuty,readonly WorkspacePermission[]>={
  'source.read':['read'],
  suggest:['content.write'],
  publish:['connections.manage','campaign.approve','campaign.dispatch'],
};
export async function dutyEligible(repo:PlatformRepository,subject:string,organizationId:string,projectId:string,duty:MessagingDuty){
  return await everySeries(DUTY_BASE[duty], async permission=>await repo.can(subject,organizationId,projectId,permission));
}
// Owners hold every duty they are eligible for; everyone else, admins included, needs it given on purpose.
export async function isProjectOwner(db:Db,subject:string,organizationId:string,projectId:string){
  return Boolean(await db.prepare("SELECT 1 FROM platform_memberships m JOIN platform_users u ON u.id=m.user_id WHERE m.user_id=? AND m.organization_id=? AND m.project_id=? AND m.role='owner' AND m.active=1 AND u.active=1").get(subject,organizationId,projectId));
}
export async function hasMessagingDuty(db:Db,subject:string,organizationId:string,projectId:string,duty:MessagingDuty){
  const repo=new PlatformRepository(db);
  if(!await dutyEligible(repo,subject,organizationId,projectId,duty))return false;
  if(await isProjectOwner(db,subject,organizationId,projectId))return true;
  return Boolean(await db.prepare('SELECT 1 FROM platform_messaging_duties WHERE organization_id=? AND project_id=? AND user_id=? AND duty=?').get(organizationId,projectId,subject,duty));
}
