import type { Db } from '../db/client';
import 'server-only';
import type Database from 'better-sqlite3';
import { ProjectAds } from './ad-manager';
import type { AdProvider } from './ad-providers';

// Worker step: the spend of one running plan is read from its provider every 6 hours, as the person who approved it,
// at most four times a day per plan. It is a read; nothing on the provider changes.
export async function refreshDueAdSpend(db:Db,key:string,make?:(db:Db,scope:{subject:string;organizationId:string;projectId:string},key:string,provider:AdProvider)=>{refreshSpend:(raw:Record<string,unknown>)=>Promise<unknown>}){
  const cutoff=new Date(Date.now()-6*3600000).toISOString(),period=new Date().toISOString().slice(0,10);
  const plan=await db.prepare(`SELECT a.id,a.provider,a.organization_id,a.project_id,a.approved_by FROM platform_ad_plans a JOIN platform_projects p ON p.id=a.project_id AND p.organization_id=a.organization_id AND p.product_pack='standard'
    WHERE a.state='active' AND a.approved_by IS NOT NULL AND (a.spend_checked_at IS NULL OR a.spend_checked_at<?) AND COALESCE((SELECT count FROM platform_usage u WHERE u.organization_id=a.organization_id AND u.project_id=a.project_id AND u.period=? AND u.resource='ad_spend_auto:'||a.id),0)<4
    ORDER BY a.spend_checked_at IS NOT NULL,a.spend_checked_at LIMIT 1`).get(cutoff,period) as {id:string;provider:AdProvider;organization_id:string;project_id:string;approved_by:string}|undefined;
  if(!plan)return 0;
  await db.prepare('INSERT INTO platform_usage VALUES(?,?,?,?,1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1').run(plan.organization_id,plan.project_id,period,`ad_spend_auto:${plan.id}`);
  const scope={subject:plan.approved_by,organizationId:plan.organization_id,projectId:plan.project_id};
  const ads=make?make(db,scope,key,plan.provider):new ProjectAds(db,scope,key,undefined,plan.provider);
  try{await ads.refreshSpend({id:plan.id});return 1;}catch{return 0;}
}
