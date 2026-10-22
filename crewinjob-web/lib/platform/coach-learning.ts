import 'server-only';
import type Database from 'better-sqlite3';
import type { MarketingScope } from './marketing-store';
import { GrowthCoach,coachPlanId,coachWeekKey,zonedInstant,zonedShiftDays } from './coach';
import { diffBriefs,type CoachBrief,type CoachEmailResults,type CoachEngagement,type CoachLearningGroup,type CoachLearningSnapshot,type CoachOutcomeCell,type CoachOutcomeRow,type CoachOutcomes,type CoachWeekActivity } from './coach-types';

type Draft={id:string;payload:string};
type Campaign={id:string;payload:string};
type Publication={source_id:string;mode:string;state:string;submitted_at:string|null;scheduled_at:string;counts_json:string|null;observed_at:string|null;engagement_state:string|null};
type Pilot={campaign_id:string;mode:'rehearsal'|'send';created_at:string;states:string|null};
type Entry={goal_id:string;stage_index:number;value:number;observed_at:string;source:string;period_from:string|null;period_to:string|null};
type Row={id:string;title:string;channel:string;source:'plan'|'setup'|'content'|'seo';theme:string;createdAt:string;goalId:string|null;campaign:boolean;published:number;rehearsed:number;engagement:CoachEngagement;pubs:Publication[]};
const INTERACTIONS=['likes','comments','shares','clicks','bookmarks','quotes'];
const RECIPIENTS=['accepted','delivered','bounced','complained','rejected','uncertain'] as const;
const DAY=86400000,WEEKS=8;
// Monday of a calendar date key (automatic readings carry the provider's own date for the measured period).
const mondayOf=(dateKey:string)=>{const day=new Date(`${dateKey.slice(0,10)}T00:00:00Z`);day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.toISOString().slice(0,10);};
// Learning loop: which coach suggestions became drafts or campaigns, which were accepted for publication or sent, what
// providers actually reported, and the project's own measurements week by week. Read-only and observational: no
// estimates, no attribution, no causal claims.
export class CoachLearning{
  coach:GrowthCoach;
  constructor(public db:Database.Database,public scope:MarketingScope){this.coach=new GrowthCoach(db,scope);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  read():CoachLearningSnapshot{
    this.coach.authorize();const {brief}=this.coach.approved(),project=this.coach.repo.workspace(this.scope.subject,...this.args())!.project,timeZone=this.coach.timeZone();
    const drafts=this.db.prepare("SELECT id,payload FROM platform_content_history WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.coachRef') IS NOT NULL AND json_extract(payload,'$.starter') IS NULL ORDER BY updated_at DESC,id LIMIT 200").all(...this.args()) as Draft[];
    const campaigns=this.db.prepare("SELECT id,payload FROM platform_campaigns WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.coachRef') IS NOT NULL ORDER BY updated_at DESC,id LIMIT 100").all(...this.args()) as Campaign[];
    const ids=drafts.map(item=>item.id),publications=ids.length?this.db.prepare(`SELECT p.source_id,p.mode,p.state,p.submitted_at,p.scheduled_at,e.counts_json,e.observed_at,e.state engagement_state FROM platform_social_publications p LEFT JOIN platform_social_engagement e ON e.job_id=p.job_id WHERE p.organization_id=? AND p.project_id=? AND p.source_kind='content' AND p.source_id IN (${ids.map(()=>'?').join(',')})`).all(...this.args(),...ids) as Publication[]:[];
    const campaignIds=campaigns.map(item=>item.id),pilots=campaignIds.length?this.db.prepare(`SELECT p.campaign_id,p.mode,j.created_at,(SELECT json_group_array(r.state) FROM platform_email_pilot_recipients r WHERE r.job_id=p.job_id) states FROM platform_email_pilots p JOIN platform_jobs j ON j.id=p.job_id AND j.organization_id=p.organization_id AND j.project_id=p.project_id WHERE p.organization_id=? AND p.project_id=? AND p.campaign_id IN (${campaignIds.map(()=>'?').join(',')})`).all(...this.args(),...campaignIds) as Pilot[]:[];
    const contentItems=new Map((this.db.prepare('SELECT id,theme,channel,goal_id FROM platform_coach_content_items WHERE organization_id=? AND project_id=?').all(...this.args()) as {id:string;theme:string;channel:string;goal_id:string|null}[]).map(row=>[row.id,row]));
    const topics=new Map((this.db.prepare('SELECT id,cluster FROM platform_coach_seo_topics WHERE organization_id=? AND project_id=?').all(...this.args()) as {id:string;cluster:string}[]).map(row=>[row.id,row.cluster]));
    const planTitles=new Map((brief?.plan||[]).map(item=>[coachPlanId(item),item.title]));
    const engagement=(list:Publication[]):CoachEngagement=>{const totals:Record<string,number>={};let observed=0;
      for(const item of list){if(item.mode!=='publish'||item.state!=='accepted'||item.engagement_state!=='ready'||!item.observed_at||!item.counts_json)continue;observed++;for(const [key,value] of Object.entries(JSON.parse(item.counts_json) as Record<string,number>))if(Number.isSafeInteger(value)&&value>=0)totals[key]=(totals[key]||0)+value;}
      return {observed,totals,interactions:INTERACTIONS.reduce((sum,key)=>sum+(totals[key]||0),0)};};
    // User themes are shown as written; built-in groups use @keys that the UI translates.
    const origin=(coachRef:string)=>{const [kind,...rest]=coachRef.split(':'),ref=rest.join(':'),item=kind==='content'?contentItems.get(ref):undefined;
      return {kind:kind as Row['source'],theme:kind==='content'?item?.theme||'@content':kind==='seo'?topics.get(ref)||'@seo':'@weekly',goalId:item?.goal_id||null};};
    const rows:Row[]=drafts.map(row=>{
      const payload=JSON.parse(row.payload) as {coachRef:string;platform:string;headline?:string;content:string;timestamp:number},{kind,theme,goalId}=origin(payload.coachRef),list=publications.filter(item=>item.source_id===row.id);
      const title=payload.headline||(kind==='plan'?planTitles.get(payload.coachRef):undefined)||payload.content.slice(0,80);
      return {id:row.id,title,channel:payload.platform,source:kind,theme,createdAt:new Date(payload.timestamp).toISOString(),goalId,campaign:false,
        published:list.filter(item=>item.mode==='publish'&&item.state==='accepted').length,rehearsed:list.filter(item=>item.mode==='rehearsal'&&item.state==='rehearsed').length,engagement:engagement(list),pubs:list};
    });
    // Email campaigns opened from the coach: a send counts as "published"; rehearsals send nothing.
    for(const row of campaigns){
      const payload=JSON.parse(row.payload) as {coachRef:string;name:string;createdAt:string;goalId?:string;channels?:{email?:boolean}},{kind,theme,goalId}=origin(payload.coachRef),list=pilots.filter(item=>item.campaign_id===row.id);
      rows.push({id:row.id,title:payload.name,channel:'email',source:kind,theme,createdAt:payload.createdAt,goalId:payload.goalId||goalId,campaign:true,published:list.filter(item=>item.mode==='send').length,rehearsed:list.filter(item=>item.mode==='rehearsal').length,engagement:{observed:0,totals:{},interactions:0},pubs:[]});
    }
    rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
    const group=(key:(item:Row)=>string,name:(key:string)=>string):CoachLearningGroup[]=>{
      const map=new Map<string,Row[]>();for(const item of rows){const k=key(item);map.set(k,[...(map.get(k)||[]),item]);}
      return [...map].map(([k,list])=>({key:k,label:name(k),drafts:list.length,published:list.reduce((sum,item)=>sum+item.published,0),...engagement(list.flatMap(item=>item.pubs))})).sort((a,b)=>b.drafts-a.drafts||a.label.localeCompare(b.label));
    };
    const byChannel=group(item=>item.channel,key=>key),byTheme=group(item=>item.theme,key=>key);
    // A "leader" is only named with at least two groups that have observed engagement and two observed publications in the top group.
    const candidates=[...byChannel.map(item=>({dimension:'channel' as const,...item})),...byTheme.map(item=>({dimension:'theme' as const,...item}))].filter(item=>item.observed>0);
    const pick=(dimension:'channel'|'theme')=>{const list=candidates.filter(item=>item.dimension===dimension).map(item=>({...item,average:item.interactions/item.observed})).sort((a,b)=>b.average-a.average);return list.length>=2&&list[0].observed>=2&&list[0].average>list[1].average?list[0]:null;};
    const best=pick('channel')||pick('theme');
    // Trend per goal stage and source: manual and automatic readings are never mixed in one line.
    const since=new Date(Date.now()-56*DAY).toISOString(),entries=this.db.prepare('SELECT goal_id,stage_index,value,observed_at,source FROM platform_metric_entries WHERE organization_id=? AND project_id=? AND observed_at>=? ORDER BY observed_at,id').all(...this.args(),since) as {goal_id:string;stage_index:number;value:number;observed_at:string;source:string}[];
    const measurements=project.goals.flatMap(goal=>goal.stages.flatMap((stage,index)=>[...new Set(entries.filter(item=>item.goal_id===goal.id&&item.stage_index===index).map(item=>item.source))].map(source=>{const list=entries.filter(item=>item.goal_id===goal.id&&item.stage_index===index&&item.source===source);return {goal:goal.label,stage,source,first:list[0].value,firstAt:list[0].observed_at,last:list.at(-1)!.value,lastAt:list.at(-1)!.observed_at,entries:list.length};})));
    const email:CoachEmailResults={campaigns:campaigns.length,rehearsals:pilots.filter(item=>item.mode==='rehearsal').length,sends:pilots.filter(item=>item.mode==='send').length,recipients:{accepted:0,delivered:0,bounced:0,complained:0,rejected:0,uncertain:0}};
    for(const pilot of pilots)if(pilot.mode==='send')for(const state of JSON.parse(pilot.states||'[]') as string[])if((RECIPIENTS as readonly string[]).includes(state))email.recipients[state as typeof RECIPIENTS[number]]++;
    const versions=this.coach.versions(10);
    return {drafts:rows.map(({pubs,goalId,campaign,...item})=>{void pubs;void goalId;void campaign;return item;}).slice(0,50),byChannel,byTheme,leader:best?{dimension:best.dimension,key:best.key,label:best.label,average:Math.round(best.average*10)/10,observed:best.observed}:null,measurements,
      versions:versions.map(item=>({revision:item.revision,kind:item.kind,approvedAt:item.approvedAt,channels:item.brief.channels.map(channel=>channel.id),planItems:item.brief.plan.length})),
      changes:versions.length>=2?diffBriefs(versions[1].brief as CoachBrief,versions[0].brief as CoachBrief):null,hasBrief:Boolean(brief),
      outcomes:this.outcomes(rows,publications,pilots,timeZone),email};
  }
  // Week-by-week view: each reading and each piece of work falls into exactly one project-time-zone week, so nothing is
  // counted twice and no outcome is credited to a piece of work.
  private outcomes(rows:Row[],publications:Publication[],pilots:Pilot[],timeZone:string):CoachOutcomes{
    const project=this.coach.repo.workspace(this.scope.subject,...this.args())!.project,current=coachWeekKey(new Date(),timeZone);
    const weeks=Array.from({length:WEEKS},(_,index)=>zonedShiftDays(current,-7*(WEEKS-1-index))),start=zonedInstant(weeks[0],0,timeZone),slot=(week:string)=>weeks.indexOf(week);
    const weekOf=(iso:string)=>coachWeekKey(new Date(iso),timeZone);
    // Automatic readings are fetched after their period ends, so look back a little further than the first week.
    const entries=this.db.prepare('SELECT goal_id,stage_index,value,observed_at,source,period_from,period_to FROM platform_metric_entries WHERE organization_id=? AND project_id=? AND observed_at>=? ORDER BY observed_at,id').all(...this.args(),new Date(Date.parse(start)-40*DAY).toISOString()) as Entry[];
    const table=new Map<string,CoachOutcomeRow>();
    for(const goal of project.goals)goal.stages.forEach((stage,index)=>{
      for(const entry of entries){
        if(entry.goal_id!==goal.id||entry.stage_index!==index)continue;
        const automatic=entry.source!=='manual'&&Boolean(entry.period_to),at=automatic?entry.period_to!.slice(0,10):entry.observed_at,position=slot(automatic?mondayOf(at):weekOf(at));if(position<0)continue;
        const key=`${goal.id}\n${index}\n${entry.source}`,row=table.get(key)||{goalId:goal.id,goal:goal.label,stage,stageIndex:index,source:entry.source,cells:weeks.map(():CoachOutcomeCell=>null)};
        // Latest reading of the week wins; entries arrive in recording order.
        const previous=row.cells[position];if(!previous||at>=previous.at)row.cells[position]={value:entry.value,at,from:automatic?entry.period_from?.slice(0,10)||null:null};
        table.set(key,row);
      }
    });
    const activity:CoachWeekActivity[]=weeks.map(week=>({week,drafts:0,campaigns:0,publications:0,emailRecipients:0,actionsDone:0,planApproved:0,byGoal:{}}));
    const bump=(iso:string|null,update:(item:CoachWeekActivity)=>void)=>{if(!iso)return;const position=slot(weekOf(iso));if(position>=0)update(activity[position]);};
    for(const row of rows)bump(row.createdAt,item=>{if(row.campaign)item.campaigns++;else item.drafts++;if(row.goalId)item.byGoal[row.goalId]=(item.byGoal[row.goalId]||0)+1;});
    for(const item of publications)if(item.mode==='publish'&&item.state==='accepted')bump(item.submitted_at||item.scheduled_at,week=>week.publications++);
    for(const pilot of pilots)if(pilot.mode==='send'){const sent=(JSON.parse(pilot.states||'[]') as string[]).filter(state=>['accepted','delivered','bounced','complained'].includes(state)).length;bump(pilot.created_at,week=>week.emailRecipients+=sent);}
    for(const item of this.db.prepare("SELECT updated_at FROM platform_growth_coach_actions WHERE organization_id=? AND project_id=? AND state='done' AND updated_at>=?").all(...this.args(),start) as {updated_at:string}[])bump(item.updated_at,week=>week.actionsDone++);
    for(const item of this.db.prepare('SELECT approved_at FROM platform_coach_content_items WHERE organization_id=? AND project_id=? AND approved_at>=?').all(...this.args(),start) as {approved_at:string}[])bump(item.approved_at,week=>week.planApproved++);
    return {weeks,rows:[...table.values()],activity,timeZone};
  }
}
