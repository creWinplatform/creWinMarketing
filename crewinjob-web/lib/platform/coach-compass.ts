import type Database from 'better-sqlite3';
import type { CompassChannel, CompassIntent } from './guidance-catalog';
import type { CoachAnswers, CoachBrief, CoachChannel } from './coach-types';
// Coach ↔ Compass bridge: one guided start. The approved brief suggests the Compass path (priority and pilot
// channels) so members don't answer the same questions twice. Read helpers only use SQL, never the stores, to stay cycle-free.
const CHANNEL:Partial<Record<CoachChannel,CompassChannel>>={linkedin:'linkedin_company',instagram:'instagram',facebook:'facebook',twitter:'twitter',email:'email'};
export type CompassSuggestion={intent:CompassIntent;channels:CompassChannel[];goalId:string};
export function compassFromBrief(brief:CoachBrief,answers:CoachAnswers|null,goals:{id:string}[]):CompassSuggestion{
  const first=brief.channels[0]?.id,channels=brief.channels.map(item=>CHANNEL[item.id]).filter((item):item is CompassChannel=>Boolean(item)).slice(0,3);
  // The goal the team chose in the diagnosis sets the path; older answers without a goal fall back to the first channel.
  const intent:CompassIntent=answers?.goal?answers.goal:first==='seo'?'seo':answers?.market==='b2c'&&['instagram','facebook','twitter'].includes(first||'')?'social':'leads';
  return {intent,channels,goalId:goals.length===1?goals[0].id:''};
}
export function coachState(db:Database.Database,organizationId:string,projectId:string){
  const row=db.prepare('SELECT answers_json,draft_json,brief_json FROM platform_growth_coach WHERE organization_id=? AND project_id=?').get(organizationId,projectId) as {answers_json:string;draft_json:string|null;brief_json:string|null}|undefined;
  return {brief:row?.brief_json?JSON.parse(row.brief_json) as CoachBrief:null,answers:row?JSON.parse(row.answers_json) as CoachAnswers:null,hasDraft:Boolean(row?.draft_json)};
}
// Seeds the approver's own Compass path once (no row yet, or only an empty first-run deferral). Other members keep their choices.
export function seedCompassFromBrief(db:Database.Database,user:string,organizationId:string,projectId:string,suggestion:CompassSuggestion){
  const row=db.prepare('SELECT revision,deferred,preferences_json FROM platform_compass_preferences WHERE user_id=? AND organization_id=? AND project_id=?').get(user,organizationId,projectId) as {revision:number;deferred:number;preferences_json:string}|undefined;
  if(row&&!(row.deferred&&!(JSON.parse(row.preferences_json).channels||[]).length))return false;
  const now=new Date().toISOString(),preferences=JSON.stringify({intent:suggestion.intent,experience:'guided',goalId:suggestion.goalId,campaignId:'',appId:'',channels:suggestion.channels,obstacles:{}});
  db.prepare('INSERT INTO platform_compass_preferences VALUES(?,?,?,?,?,0,?,?) ON CONFLICT(user_id,organization_id,project_id) DO UPDATE SET revision=excluded.revision,preferences_json=excluded.preferences_json,deferred=0,updated_at=excluded.updated_at').run(user,organizationId,projectId,(row?.revision||0)+1,preferences,now,now);
  db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(user,organizationId,projectId,'compass.preferences',now);
  return true;
}
