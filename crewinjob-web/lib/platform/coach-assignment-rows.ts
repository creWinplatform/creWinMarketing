import 'server-only';
import type Database from 'better-sqlite3';
import type { CoachAssignment } from './coach-types';

// Assignment rows for one kind of coach item, keyed by item id. "Overdue" compares calendar dates in the project's time zone.
export function coachAssignmentRows(db:Database.Database,organizationId:string,projectId:string,kind:'action'|'content',today:string,viewer?:string){
  const rows=db.prepare('SELECT a.item_id,a.assignee_id,u.username,a.due_on,a.revision FROM platform_coach_assignments a JOIN platform_users u ON u.id=a.assignee_id WHERE a.organization_id=? AND a.project_id=? AND a.item_kind=?').all(organizationId,projectId,kind) as {item_id:string;assignee_id:string;username:string;due_on:string|null;revision:number}[];
  return new Map(rows.map((row):[string,CoachAssignment]=>[row.item_id,{assigneeId:row.assignee_id,assigneeName:row.username,dueOn:row.due_on,overdue:Boolean(row.due_on&&row.due_on<today),revision:row.revision,mine:row.assignee_id===viewer}]));
}
