import 'server-only';
import type Database from 'better-sqlite3';
import type { MarketingScope } from './marketing-store';
import { GrowthCoach,coachPlanId,coachWeekKey,zonedInstant,zonedShiftDays } from './coach';
import { LinkTracking,linkTag } from './link-tracking';
import { ProjectAttribution } from './attribution';
import type { LocalizedText } from './catalog';
import { diffBriefs,type CoachBrief,type CoachEmailResults,type CoachEngagement,type CoachLearningGroup,type CoachLearningSnapshot,type CoachOutcomeCell,type CoachOutcomeRow,type CoachOutcomes,type CoachTrack,type CoachTrackItem,type CoachWeekActivity } from './coach-types';

type Draft={id:string;payload:string};
type Campaign={id:string;payload:string};
type Publication={source_id:string;mode:string;state:string;submitted_at:string|null;scheduled_at:string;counts_json:string|null;observed_at:string|null;engagement_state:string|null;link_tag:string|null};
type Pilot={campaign_id:string;mode:'rehearsal'|'send';created_at:string;states:string|null};
type Entry={goal_id:string;stage_index:number;value:number;observed_at:string;source:string;period_from:string|null;period_to:string|null};
type Row={id:string;ref:string;title:string;channel:string;source:'plan'|'setup'|'content'|'seo';theme:string;createdAt:string;goalId:string|null;campaign:boolean;published:number;rehearsed:number;engagement:CoachEngagement;pubs:Publication[];
  tag:string;measurable:boolean;firstPublishedAt:string|null;results:number[]|null};
const INTERACTIONS=['likes','comments','shares','clicks','bookmarks','quotes'];
const RECIPIENTS=['accepted','delivered','bounced','complained','rejected','uncertain'] as const;
const DAY=86400000,WEEKS=8,RESULT_DAYS=90,WAIT_DAYS=14;
// Monday of a calendar date key (automatic readings carry the provider's own date for the measured period).
const mondayOf=(dateKey:string)=>{const day=new Date(`${dateKey.slice(0,10)}T00:00:00Z`);day.setUTCDate(day.getUTCDate()-(day.getUTCDay()+6)%7);return day.toISOString().slice(0,10);};
// Learning loop: which coach suggestions became drafts or campaigns, which were accepted for publication or sent, what
// providers actually reported, and the project's own measurements week by week. Read-only and observational: no
// estimates, no causal claims. Site visits are GA4 sessions that arrived through a post's tagged link: observed arrivals,
// never credited causes.
export class CoachLearning{
  coach:GrowthCoach;
  constructor(public db:Database.Database,public scope:MarketingScope){this.coach=new GrowthCoach(db,scope);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  read():CoachLearningSnapshot{
    this.coach.authorize();const {brief}=this.coach.approved(),project=this.coach.repo.workspace(this.scope.subject,...this.args())!.project,timeZone=this.coach.timeZone();
    const drafts=this.db.prepare("SELECT id,payload FROM platform_content_history WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.coachRef') IS NOT NULL AND json_extract(payload,'$.starter') IS NULL ORDER BY updated_at DESC,id LIMIT 200").all(...this.args()) as Draft[];
    const campaigns=this.db.prepare("SELECT id,payload FROM platform_campaigns WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.coachRef') IS NOT NULL ORDER BY updated_at DESC,id LIMIT 100").all(...this.args()) as Campaign[];
    const ids=drafts.map(item=>item.id),publications=ids.length?this.db.prepare(`SELECT p.source_id,p.mode,p.state,p.submitted_at,p.scheduled_at,e.counts_json,e.observed_at,e.state engagement_state,p.link_tag FROM platform_social_publications p LEFT JOIN platform_social_engagement e ON e.job_id=p.job_id WHERE p.organization_id=? AND p.project_id=? AND p.source_kind='content' AND p.source_id IN (${ids.map(()=>'?').join(',')})`).all(...this.args(),...ids) as Publication[]:[];
    const campaignIds=campaigns.map(item=>item.id),pilots=campaignIds.length?this.db.prepare(`SELECT p.campaign_id,p.mode,j.created_at,(SELECT json_group_array(r.state) FROM platform_email_pilot_recipients r WHERE r.job_id=p.job_id) states FROM platform_email_pilots p JOIN platform_jobs j ON j.id=p.job_id AND j.organization_id=p.organization_id AND j.project_id=p.project_id WHERE p.organization_id=? AND p.project_id=? AND p.campaign_id IN (${campaignIds.map(()=>'?').join(',')})`).all(...this.args(),...campaignIds) as Pilot[]:[];
    const contentItems=new Map((this.db.prepare('SELECT id,theme,channel,goal_id,stage_index FROM platform_coach_content_items WHERE organization_id=? AND project_id=?').all(...this.args()) as {id:string;theme:string;channel:string;goal_id:string|null;stage_index:number|null}[]).map(row=>[row.id,row]));
    const topics=new Map((this.db.prepare('SELECT id,cluster FROM platform_coach_seo_topics WHERE organization_id=? AND project_id=?').all(...this.args()) as {id:string;cluster:string}[]).map(row=>[row.id,row.cluster]));
    const planTitles=new Map((brief?.plan||[]).map(item=>[coachPlanId(item),item.title]));
    const engagement=(list:Publication[]):CoachEngagement=>{const totals:Record<string,number>={};let observed=0;
      for(const item of list){if(item.mode!=='publish'||item.state!=='accepted'||item.engagement_state!=='ready'||!item.observed_at||!item.counts_json)continue;observed++;for(const [key,value] of Object.entries(JSON.parse(item.counts_json) as Record<string,number>))if(Number.isSafeInteger(value)&&value>=0)totals[key]=(totals[key]||0)+value;}
      return {observed,totals,interactions:INTERACTIONS.reduce((sum,key)=>sum+(totals[key]||0),0)};};
    // User themes are shown as written; built-in groups use @keys that the UI translates.
    const origin=(coachRef:string)=>{const [kind,...rest]=coachRef.split(':'),ref=rest.join(':'),item=kind==='content'?contentItems.get(ref):undefined;
      return {kind:kind as Row['source'],theme:kind==='content'?item?.theme||'@content':kind==='seo'?topics.get(ref)||'@seo':'@weekly',goalId:item?.goal_id||null};};
    // People who first came through each tag and reached a goal stage in the last 90 days (the team's product events).
    const counts=new ProjectAttribution(this.db,this.scope).tagCounts(new Date(Date.now()-RESULT_DAYS*DAY).toISOString(),new Date(Date.now()+1000).toISOString());
    const resultsOf=(tag:string)=>counts.stages.length?counts.byTag.get(tag)||counts.stages.map(()=>0):null;
    const accepted=(list:Publication[])=>list.filter(item=>item.mode==='publish'&&item.state==='accepted');
    const earliest=(values:(string|null)[])=>values.filter((value):value is string=>Boolean(value)).sort()[0]||null;
    let site='';try{site=new URL(project.website).hostname.toLowerCase().replace(/^www\./,'');}catch{site='';}
    const ownSite=(url:unknown)=>{try{const host=new URL(String(url)).hostname.toLowerCase();return Boolean(site)&&(host.replace(/^www\./,'')===site||host.endsWith(`.${site}`));}catch{return false;}};
    const rows:Row[]=drafts.map(row=>{
      const payload=JSON.parse(row.payload) as {coachRef:string;platform:string;headline?:string;content:string;timestamp:number},{kind,theme,goalId}=origin(payload.coachRef),list=publications.filter(item=>item.source_id===row.id);
      const title=payload.headline||(kind==='plan'?planTitles.get(payload.coachRef):undefined)||payload.content.slice(0,80),tag=linkTag(this.scope,'content',row.id),live=accepted(list);
      return {id:row.id,ref:payload.coachRef,title,channel:payload.platform,source:kind,theme,createdAt:new Date(payload.timestamp).toISOString(),goalId,campaign:false,
        published:live.length,rehearsed:list.filter(item=>item.mode==='rehearsal'&&item.state==='rehearsed').length,engagement:engagement(list),pubs:list,
        tag,measurable:live.some(item=>item.link_tag===tag),firstPublishedAt:earliest(live.map(item=>item.submitted_at||item.scheduled_at)),results:resultsOf(tag)};
    });
    // Email campaigns opened from the coach: a send counts as "published"; rehearsals send nothing.
    for(const row of campaigns){
      const payload=JSON.parse(row.payload) as {coachRef:string;name:string;createdAt:string;goalId?:string;channels?:{email?:boolean};content?:{ctaUrl?:string;text?:string}},{kind,theme,goalId}=origin(payload.coachRef),list=pilots.filter(item=>item.campaign_id===row.id);
      const sends=list.filter(item=>item.mode==='send'),tag=linkTag(this.scope,'campaign',row.id);
      // A sent email can be measured when it linked to the project's own site (those links carry the campaign's tag).
      const linked=ownSite(payload.content?.ctaUrl)||String(payload.content?.text||'').split(/\s+/).some(word=>/^https?:\/\//.test(word)&&ownSite(word));
      rows.push({id:row.id,ref:payload.coachRef,title:payload.name,channel:'email',source:kind,theme,createdAt:payload.createdAt,goalId:payload.goalId||goalId,campaign:true,published:sends.length,rehearsed:list.filter(item=>item.mode==='rehearsal').length,engagement:{observed:0,totals:{},interactions:0},pubs:[],
        tag,measurable:sends.length>0&&linked,firstPublishedAt:earliest(sends.map(item=>item.created_at)),results:resultsOf(tag)});
    }
    rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
    const group=(key:(item:Row)=>string,name:(key:string)=>string):CoachLearningGroup[]=>{
      const map=new Map<string,Row[]>();for(const item of rows){const k=key(item);map.set(k,[...(map.get(k)||[]),item]);}
      return [...map].map(([k,list])=>({key:k,label:name(k),drafts:list.length,published:list.reduce((sum,item)=>sum+item.published,0),measured:list.filter(item=>item.measurable).length,
        results:counts.stages.length?counts.stages.map((_,index)=>list.reduce((sum,item)=>sum+(item.measurable?item.results?.[index]||0:0),0)):null,...engagement(list.flatMap(item=>item.pubs))})).sort((a,b)=>b.drafts-a.drafts||a.label.localeCompare(b.label));
    };
    const byChannel=group(item=>item.channel,key=>key),byTheme=group(item=>item.theme,key=>key);
    // A "leader" is only named with at least two groups that have observed engagement and two observed publications in the top group.
    const candidates=[...byChannel.map(item=>({dimension:'channel' as const,...item})),...byTheme.map(item=>({dimension:'theme' as const,...item}))].filter(item=>item.observed>0);
    const pick=(dimension:'channel'|'theme')=>{const list=candidates.filter(item=>item.dimension===dimension).map(item=>({...item,average:item.interactions/item.observed})).sort((a,b)=>b.average-a.average);return list.length>=2&&list[0].observed>=2&&list[0].average>list[1].average?list[0]:null;};
    // With product results, the leader is the group whose measured items brought the most people to the first mapped stage
    // per item, under the same thresholds; otherwise the engagement rule above.
    const byResult=(dimension:'channel'|'theme')=>{const list=(dimension==='channel'?byChannel:byTheme).filter(item=>item.measured>0&&item.results).map(item=>({dimension,...item,average:item.results![0]/item.measured})).sort((a,b)=>b.average-a.average);
      return list.length>=2&&list[0].measured>=2&&list[0].average>list[1].average?list[0]:null;};
    const result=counts.stages.length?byResult('channel')||byResult('theme'):null,best=result?null:pick('channel')||pick('theme');
    // Trend per goal stage and source: manual and automatic readings are never mixed in one line.
    const since=new Date(Date.now()-56*DAY).toISOString(),entries=this.db.prepare('SELECT goal_id,stage_index,value,observed_at,source FROM platform_metric_entries WHERE organization_id=? AND project_id=? AND observed_at>=? ORDER BY observed_at,id').all(...this.args(),since) as {goal_id:string;stage_index:number;value:number;observed_at:string;source:string}[];
    const measurements=project.goals.flatMap(goal=>goal.stages.flatMap((stage,index)=>[...new Set(entries.filter(item=>item.goal_id===goal.id&&item.stage_index===index).map(item=>item.source))].map(source=>{const list=entries.filter(item=>item.goal_id===goal.id&&item.stage_index===index&&item.source===source);return {goal:goal.label,stage,source,first:list[0].value,firstAt:list[0].observed_at,last:list.at(-1)!.value,lastAt:list.at(-1)!.observed_at,entries:list.length};})));
    const email:CoachEmailResults={campaigns:campaigns.length,rehearsals:pilots.filter(item=>item.mode==='rehearsal').length,sends:pilots.filter(item=>item.mode==='send').length,recipients:{accepted:0,delivered:0,bounced:0,complained:0,rejected:0,uncertain:0}};
    for(const pilot of pilots)if(pilot.mode==='send')for(const state of JSON.parse(pilot.states||'[]') as string[])if((RECIPIENTS as readonly string[]).includes(state))email.recipients[state as typeof RECIPIENTS[number]]++;
    const versions=this.coach.versions(10);
    const leader=result?{dimension:result.dimension,key:result.key,label:result.label,average:Math.round(result.average*10)/10,observed:result.measured,basis:'results' as const,stage:counts.stages[0].label}
      :best?{dimension:best.dimension,key:best.key,label:best.label,average:Math.round(best.average*10)/10,observed:best.observed,basis:'engagement' as const,stage:null}:null;
    return {drafts:rows.map(({pubs,goalId,campaign,ref,tag,measurable,firstPublishedAt,results,...item})=>{void pubs;void goalId;void campaign;void ref;void tag;void measurable;void firstPublishedAt;void results;return item;}).slice(0,50),byChannel,byTheme,leader,measurements,
      versions:versions.map(item=>({revision:item.revision,kind:item.kind,approvedAt:item.approvedAt,channels:item.brief.channels.map(channel=>channel.id),planItems:item.brief.plan.length})),
      changes:versions.length>=2?diffBriefs(versions[1].brief as CoachBrief,versions[0].brief as CoachBrief):null,hasBrief:Boolean(brief),
      outcomes:this.outcomes(rows,publications,pilots,timeZone),email,site:new LinkTracking(this.db,this.scope).summary(),
      results:counts.stages.length?{stages:counts.stages.map(stage=>stage.label),days:RESULT_DAYS}:null,
      track:counts.stages.length?this.track(rows,counts,versions.map(item=>item.brief as CoachBrief),contentItems,project.goals):null};
  }
  // The coach's track record: every suggestion that became a draft or a campaign, what it was expected to move, and what
  // the team's own product events showed for the people who first came through it.
  private track(rows:Row[],counts:ReturnType<ProjectAttribution['tagCounts']>,briefs:CoachBrief[],contentItems:Map<string,{goal_id:string|null;stage_index:number|null}>,goals:{id:string;label:LocalizedText;stages:LocalizedText[]}[]):CoachTrack{
    // Plan ids include the week, so an action that moved or was renewed is found in an older brief version.
    const plans=new Map<string,CoachBrief['plan'][number]>();for(const brief of [...briefs].reverse())for(const item of brief.plan||[])plans.set(coachPlanId(item),item);
    const expected=(goalId:string|null|undefined,stage:number|null|undefined)=>{const goal=goals.find(item=>item.id===goalId),label=goal&&typeof stage==='number'?goal.stages[stage]:undefined;return goal&&label?{goal:goal.label,stage:label}:null;};
    const sessions=new Map((this.db.prepare('SELECT r.tag,SUM(r.sessions) AS n FROM platform_link_results r JOIN platform_link_tracking l ON l.organization_id=r.organization_id AND l.project_id=r.project_id AND l.connection_id IS NOT NULL WHERE r.organization_id=? AND r.project_id=? GROUP BY r.tag').all(...this.args()) as {tag:string;n:number}[]).map(row=>[row.tag,row.n]));
    const byRef=new Map<string,Row[]>();for(const row of rows)byRef.set(row.ref,[...(byRef.get(row.ref)||[]),row]);
    const zero=()=>counts.stages.map(()=>0),now=Date.now();
    const items:CoachTrackItem[]=[...byRef].map(([ref,list])=>{
      const [kind,...rest]=ref.split(':'),id=rest.join(':'),plan=kind==='plan'?plans.get(id):undefined,content=kind==='content'?contentItems.get(id):undefined;
      const measured=list.filter(item=>item.measurable),published=list.filter(item=>item.published>0),first=published.map(item=>item.firstPublishedAt).filter((value):value is string=>Boolean(value)).sort()[0]||null;
      const people=zero();for(const item of measured)item.results?.forEach((value,index)=>{people[index]+=value;});
      const state:CoachTrackItem['state']=!published.length?'not_published':!measured.length?'no_link':people.every(value=>value===0)&&first&&now-Date.parse(first)<WAIT_DAYS*DAY?'waiting':'measured';
      return {ref,kind:kind as CoachTrackItem['kind'],title:plan?.title||list[0].title,channels:[...new Set(list.map(item=>item.channel))],firstPublishedAt:first,
        expected:plan?expected(plan.goalId,plan.stage):content?expected(content.goal_id,content.stage_index):null,state,counts:people,
        sessions:measured.some(item=>sessions.has(item.tag))?measured.reduce((sum,item)=>sum+(sessions.get(item.tag)||0),0):null};
    }).sort((a,b)=>(b.firstPublishedAt||'').localeCompare(a.firstPublishedAt||'')||a.title.localeCompare(b.title));
    const people=zero();for(const item of items)item.counts.forEach((value,index)=>{people[index]+=value;});
    // Tagged items the coach did not suggest, published or sent in the same 90 days.
    const coachTags=new Set(rows.map(row=>row.tag)),since=new Date(now-RESULT_DAYS*DAY).toISOString();
    const others=new Set([...(this.db.prepare("SELECT DISTINCT link_tag FROM platform_social_publications WHERE organization_id=? AND project_id=? AND mode='publish' AND state='accepted' AND link_tag IS NOT NULL AND COALESCE(submitted_at,scheduled_at)>=?").all(...this.args(),since) as {link_tag:string}[]).map(row=>row.link_tag),
      ...(this.db.prepare("SELECT DISTINCT p.campaign_id FROM platform_email_pilots p JOIN platform_jobs j ON j.id=p.job_id AND j.organization_id=p.organization_id AND j.project_id=p.project_id WHERE p.organization_id=? AND p.project_id=? AND p.mode='send' AND j.created_at>=?").all(...this.args(),since) as {campaign_id:string}[]).map(row=>linkTag(this.scope,'campaign',row.campaign_id))].filter(tag=>!coachTags.has(tag)));
    const baseline=others.size>=2?{items:others.size,average:Math.round([...others].reduce((sum,tag)=>sum+(counts.byTag.get(tag)?.[0]||0),0)/others.size*10)/10}:null;
    return {items:items.filter(item=>item.state!=='not_published').slice(0,20),used:items.length,published:items.filter(item=>item.state!=='not_published').length,withResults:items.filter(item=>item.counts[0]>0).length,people,baseline};
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
