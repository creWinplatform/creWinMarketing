import 'server-only';
import type Database from 'better-sqlite3';
import type { LocalizedText } from './catalog';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { GrowthCoach,coachChoice,zonedDateKey,zonedShiftDays } from './coach';
import { coachAssignmentRows } from './coach-assignment-rows';
import type { CoachAssignmentItem,CoachAssignmentsSnapshot } from './coach-types';

type Kind='action'|'content';
const DATE=/^\d{4}-\d{2}-\d{2}$/;
// Team assignment for weekly actions and content plan items: an owner and an optional due date. Internal coordination
// only: nothing is sent, and the coach never assigns anyone by itself.
export class CoachAssignments{
  coach:GrowthCoach;
  constructor(public db:Database.Database,public scope:MarketingScope){this.coach=new GrowthCoach(db,scope);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private today(){return zonedDateKey(new Date(),this.coach.timeZone());}
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
  // Active teammates who can do the work (content rights).
  members(){
    const rows=this.db.prepare('SELECT u.id,u.username FROM platform_memberships m JOIN platform_users u ON u.id=m.user_id WHERE m.organization_id=? AND m.project_id=? AND m.active=1 AND u.active=1 ORDER BY u.username COLLATE NOCASE').all(...this.args()) as {id:string;username:string}[];
    return rows.filter(row=>this.coach.repo.can(row.id,...this.args(),'content.write')).map(row=>({id:row.id,name:row.username}));
  }
  // Every assignable item that still exists, with its current state.
  private items():CoachAssignmentItem[]{
    const {brief}=this.coach.approved(),today=this.today(),pick=(value:string|LocalizedText)=>typeof value==='string'?value:value[brief?.language||'en'];
    const actions=coachAssignmentRows(this.db,...this.args(),'action',today,this.scope.subject),contents=coachAssignmentRows(this.db,...this.args(),'content',today,this.scope.subject);
    const list:CoachAssignmentItem[]=[];
    for(const action of brief?this.coach.actions():[]){const assignment=actions.get(action.id);if(assignment)list.push({kind:'action',itemId:action.id,title:pick(action.title),href:action.href,state:action.state==='done'?'done':'open',...assignment,overdue:assignment.overdue&&action.state!=='done'});}
    const used=new Set((this.db.prepare("SELECT json_extract(payload,'$.coachRef') ref FROM platform_content_history WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.coachRef') LIKE 'content:%' UNION SELECT json_extract(payload,'$.coachRef') FROM platform_campaigns WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.coachRef') LIKE 'content:%'").all(...this.args(),...this.args()) as {ref:string}[]).map(row=>row.ref));
    for(const row of this.db.prepare("SELECT id,title,channel,state FROM platform_coach_content_items WHERE organization_id=? AND project_id=? AND state<>'dismissed'").all(...this.args()) as {id:string;title:string;channel:string;state:string}[]){
      const assignment=contents.get(row.id);if(!assignment)continue;const done=used.has(`content:${row.id}`);
      list.push({kind:'content',itemId:row.id,title:row.title,href:row.channel==='email'?'/?tab=campaigns':'/?tab=calendar&planning=content',state:done?'done':'open',...assignment,overdue:assignment.overdue&&!done});
    }
    // Open work first, then by due date (undated last).
    return list.sort((a,b)=>Number(a.state==='done')-Number(b.state==='done')||(a.dueOn||'9999').localeCompare(b.dueOn||'9999')||a.title.localeCompare(b.title));
  }
  read():CoachAssignmentsSnapshot{
    this.coach.authorize();const items=this.items();
    return {mine:items.filter(item=>item.mine&&item.state==='open'),all:items.slice(0,50),members:this.coach.can('content.write')?this.members():[],today:this.today(),canWrite:this.coach.can('content.write')};
  }
  assign(raw:Record<string,unknown>){
    this.coach.authorize('content.write');const kind=coachChoice(['action','content'] as const,raw.kind) as Kind;
    if(typeof raw.itemId!=='string'||!raw.itemId||raw.itemId.length>160)throw new MarketingStoreError('Atanacak iş bulunamadı.',404);
    const assignee=raw.assigneeId===null||raw.assigneeId===''?null:typeof raw.assigneeId==='string'?raw.assigneeId:undefined;if(assignee===undefined)throw new MarketingStoreError('Sorumlu kişi geçersiz.');
    const today=this.today(),due=raw.dueOn===null||raw.dueOn===''||raw.dueOn===undefined?null:typeof raw.dueOn==='string'&&DATE.test(raw.dueOn)&&!Number.isNaN(Date.parse(`${raw.dueOn}T00:00:00Z`))&&new Date(`${raw.dueOn}T00:00:00Z`).toISOString().slice(0,10)===raw.dueOn?raw.dueOn:undefined;
    if(due===undefined||due&&(due<zonedShiftDays(today,-31)||due>zonedShiftDays(today,366)))throw new MarketingStoreError('Son tarih geçersiz (bugünden en fazla bir ay önce, bir yıl sonra).');
    return this.db.transaction(()=>{
      this.coach.authorize('content.write');
      const exists=kind==='action'?this.coach.actions().some(item=>item.id===raw.itemId):Boolean(this.db.prepare("SELECT 1 FROM platform_coach_content_items WHERE id=? AND organization_id=? AND project_id=? AND state<>'dismissed'").get(raw.itemId,...this.args()));
      if(!exists)throw new MarketingStoreError('Atanacak iş bulunamadı.',404);
      const current=this.db.prepare('SELECT revision FROM platform_coach_assignments WHERE organization_id=? AND project_id=? AND item_kind=? AND item_id=?').get(...this.args(),kind,raw.itemId) as {revision:number}|undefined;
      if(raw.expectedRevision!==(current?.revision||0))throw new MarketingStoreError('Atama başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      const now=new Date().toISOString();
      if(!assignee){if(current)this.db.prepare('DELETE FROM platform_coach_assignments WHERE organization_id=? AND project_id=? AND item_kind=? AND item_id=?').run(...this.args(),kind,raw.itemId);this.audit('coach.unassign');return this.read();}
      if(!this.members().some(member=>member.id===assignee))throw new MarketingStoreError('Sorumlu kişi bu projede içerik yazma yetkisi olan etkin bir ekip üyesi olmalı.',403);
      this.db.prepare('INSERT INTO platform_coach_assignments(organization_id,project_id,item_kind,item_id,assignee_id,due_on,revision,assigned_by,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?) ON CONFLICT(organization_id,project_id,item_kind,item_id) DO UPDATE SET assignee_id=excluded.assignee_id,due_on=excluded.due_on,revision=platform_coach_assignments.revision+1,assigned_by=excluded.assigned_by,updated_at=excluded.updated_at').run(...this.args(),kind,raw.itemId,assignee,due,this.scope.subject,now,now);
      this.audit('coach.assign');return this.read();
    }).immediate();
  }
}
