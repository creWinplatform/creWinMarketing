import 'server-only';
import type Database from 'better-sqlite3';
import type { MarketingScope } from './marketing-store';
import { GrowthCoach,coachPlanId } from './coach';
import { diffBriefs,type CoachBrief,type CoachEngagement,type CoachLearningGroup,type CoachLearningSnapshot } from './coach-types';

type Draft={id:string;payload:string};
type Publication={source_id:string;mode:string;state:string;counts_json:string|null;observed_at:string|null;engagement_state:string|null};
const INTERACTIONS=['likes','comments','shares','clicks','bookmarks','quotes'];
const DAY=86400000;
// Learning loop: which coach suggestions became drafts, which were accepted for publication, and what engagement
// providers actually reported. Read-only and observational: no estimates, no attribution, no causal claims.
export class CoachLearning{
  coach:GrowthCoach;
  constructor(public db:Database.Database,public scope:MarketingScope){this.coach=new GrowthCoach(db,scope);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  read():CoachLearningSnapshot{
    this.coach.authorize();const {brief}=this.coach.approved(),project=this.coach.repo.workspace(this.scope.subject,...this.args())!.project;
    const drafts=this.db.prepare("SELECT id,payload FROM platform_content_history WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.coachRef') IS NOT NULL ORDER BY updated_at DESC,id LIMIT 200").all(...this.args()) as Draft[];
    const ids=drafts.map(item=>item.id),publications=ids.length?this.db.prepare(`SELECT p.source_id,p.mode,p.state,e.counts_json,e.observed_at,e.state engagement_state FROM platform_social_publications p LEFT JOIN platform_social_engagement e ON e.job_id=p.job_id WHERE p.organization_id=? AND p.project_id=? AND p.source_kind='content' AND p.source_id IN (${ids.map(()=>'?').join(',')})`).all(...this.args(),...ids) as Publication[]:[];
    const contentItems=new Map((this.db.prepare('SELECT id,theme,channel FROM platform_coach_content_items WHERE organization_id=? AND project_id=?').all(...this.args()) as {id:string;theme:string;channel:string}[]).map(row=>[row.id,row]));
    const topics=new Map((this.db.prepare('SELECT id,cluster FROM platform_coach_seo_topics WHERE organization_id=? AND project_id=?').all(...this.args()) as {id:string;cluster:string}[]).map(row=>[row.id,row.cluster]));
    const planTitles=new Map((brief?.plan||[]).map(item=>[coachPlanId(item),item.title]));
    const engagement=(list:Publication[]):CoachEngagement=>{const totals:Record<string,number>={};let observed=0;
      for(const item of list){if(item.mode!=='publish'||item.state!=='accepted'||item.engagement_state!=='ready'||!item.observed_at||!item.counts_json)continue;observed++;for(const [key,value] of Object.entries(JSON.parse(item.counts_json) as Record<string,number>))if(Number.isSafeInteger(value)&&value>=0)totals[key]=(totals[key]||0)+value;}
      return {observed,totals,interactions:INTERACTIONS.reduce((sum,key)=>sum+(totals[key]||0),0)};};
    const rows=drafts.map(row=>{
      const payload=JSON.parse(row.payload) as {coachRef:string;platform:string;headline?:string;content:string;timestamp:number},[kind,...rest]=payload.coachRef.split(':'),ref=rest.join(':'),list=publications.filter(item=>item.source_id===row.id);
      // User themes are shown as written; built-in groups use @keys that the UI translates.
      const theme=kind==='content'?contentItems.get(ref)?.theme||'@content':kind==='seo'?topics.get(ref)||'@seo':'@weekly';
      const title=payload.headline||(kind==='plan'?planTitles.get(payload.coachRef):undefined)||payload.content.slice(0,80);
      return {id:row.id,title,channel:payload.platform,source:kind as 'plan'|'setup'|'content'|'seo',theme,createdAt:new Date(payload.timestamp).toISOString(),
        published:list.filter(item=>item.mode==='publish'&&item.state==='accepted').length,rehearsed:list.filter(item=>item.mode==='rehearsal'&&item.state==='rehearsed').length,engagement:engagement(list),pubs:list};
    });
    const group=(key:(item:typeof rows[number])=>string,name:(key:string)=>string):CoachLearningGroup[]=>{
      const map=new Map<string,typeof rows>();for(const item of rows){const k=key(item);map.set(k,[...(map.get(k)||[]),item]);}
      return [...map].map(([k,list])=>({key:k,label:name(k),drafts:list.length,published:list.reduce((sum,item)=>sum+item.published,0),...engagement(list.flatMap(item=>item.pubs))})).sort((a,b)=>b.drafts-a.drafts||a.label.localeCompare(b.label));
    };
    const byChannel=group(item=>item.channel,key=>key),byTheme=group(item=>item.theme,key=>key);
    // A "leader" is only named with at least two groups that have observed engagement and two observed publications in the top group.
    const candidates=[...byChannel.map(item=>({dimension:'channel' as const,...item})),...byTheme.map(item=>({dimension:'theme' as const,...item}))].filter(item=>item.observed>0);
    const pick=(dimension:'channel'|'theme')=>{const list=candidates.filter(item=>item.dimension===dimension).map(item=>({...item,average:item.interactions/item.observed})).sort((a,b)=>b.average-a.average);return list.length>=2&&list[0].observed>=2&&list[0].average>list[1].average?list[0]:null;};
    const best=pick('channel')||pick('theme');
    const since=new Date(Date.now()-56*DAY).toISOString(),entries=this.db.prepare('SELECT goal_id,stage_index,value,observed_at FROM platform_metric_entries WHERE organization_id=? AND project_id=? AND observed_at>=? ORDER BY observed_at,id').all(...this.args(),since) as {goal_id:string;stage_index:number;value:number;observed_at:string}[];
    const measurements=project.goals.flatMap(goal=>goal.stages.map((stage,index)=>{const list=entries.filter(item=>item.goal_id===goal.id&&item.stage_index===index);return list.length?{goal:goal.label,stage,first:list[0].value,firstAt:list[0].observed_at,last:list.at(-1)!.value,lastAt:list.at(-1)!.observed_at,entries:list.length}:null;})).filter((item):item is NonNullable<typeof item>=>Boolean(item));
    const versions=this.coach.versions(10);
    return {drafts:rows.map(({pubs,...item})=>{void pubs;return item;}).slice(0,50),byChannel,byTheme,leader:best?{dimension:best.dimension,key:best.key,label:best.label,average:Math.round(best.average*10)/10,observed:best.observed}:null,measurements,
      versions:versions.map(item=>({revision:item.revision,kind:item.kind,approvedAt:item.approvedAt,channels:item.brief.channels.map(channel=>channel.id),planItems:item.brief.plan.length})),
      changes:versions.length>=2?diffBriefs(versions[1].brief as CoachBrief,versions[0].brief as CoachBrief):null,hasBrief:Boolean(brief)};
  }
}
