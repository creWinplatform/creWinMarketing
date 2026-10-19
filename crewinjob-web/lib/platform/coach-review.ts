import 'server-only';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { LocalizedText } from './catalog';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { GrowthCoach,coachChannelName,coachChoice,coachPlanId,coachWeekKey,zonedDateKey,zonedInstant,zonedShiftDays } from './coach';
import type { CoachAdjustment,CoachBrief,CoachChannel,CoachPlanItem,CoachReview,CoachReviewFacts,CoachReviewMeasurement,CoachReviewSnapshot } from './coach-types';

type Row={id:string;week:string;facts_json:string;adjustments_json:string;revision:number;created_at:string};
const l=(tr:string,en:string):LocalizedText=>({tr,en});
const DAY=86400000;
// Weekly review: deterministic facts from this project's own records (no AI, no estimates), plus rule-based plan
// adjustments that change the approved plan only after an approver accepts them.
export class CoachWeeklyReview{
  coach:GrowthCoach;
  constructor(public db:Database.Database,public scope:MarketingScope){this.coach=new GrowthCoach(db,scope);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private count(sql:string,...values:unknown[]){return (this.db.prepare(sql).get(...this.args(),...values) as {n:number}).n;}
  private row(week=coachWeekKey(new Date(),this.coach.timeZone())){return this.db.prepare('SELECT id,week,facts_json,adjustments_json,revision,created_at FROM platform_coach_reviews WHERE organization_id=? AND project_id=? AND week=?').get(...this.args(),week) as Row|undefined;}
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
  facts(now=new Date()):CoachReviewFacts{
    const timeZone=this.coach.timeZone(),to=now.toISOString(),from=zonedInstant(zonedShiftDays(zonedDateKey(now,timeZone),-6),0,timeZone),project=this.coach.repo.workspace(this.scope.subject,...this.args())!.project;
    const entries=this.db.prepare("SELECT e.goal_id,e.stage_index,e.value,e.observed_at,e.source,b.provider FROM platform_metric_entries e LEFT JOIN platform_measurement_bindings b ON b.id=e.binding_id WHERE e.organization_id=? AND e.project_id=? AND e.observed_at<=? ORDER BY e.observed_at DESC,e.id").all(...this.args(),to) as {goal_id:string;stage_index:number;value:number;observed_at:string;source:string;provider:string|null}[];
    const measurements:CoachReviewMeasurement[]=[];
    for(const goal of project.goals)goal.stages.forEach((stage,index)=>{
      const list=entries.filter(entry=>entry.goal_id===goal.id&&entry.stage_index===index),latest=list.find(entry=>entry.observed_at>=from);if(!latest)return;
      const previous=list.find(entry=>entry.observed_at<from);
      measurements.push({goalId:goal.id,goal:goal.label,stage,latest:latest.value,latestAt:latest.observed_at,previous:previous?.value??null,previousAt:previous?.observed_at??null,source:latest.source==='manual'?'manual':latest.provider||latest.source});
    });
    const connected=(provider:string)=>this.count('SELECT COUNT(*) n FROM platform_connections WHERE organization_id=? AND project_id=? AND active=1 AND provider=?',provider)>0;
    const states=this.db.prepare('SELECT action_id,state FROM platform_growth_coach_actions WHERE organization_id=? AND project_id=? AND updated_at>=? AND updated_at<=?').all(...this.args(),from,to) as {action_id:string;state:string}[];
    const {brief}=this.coach.approved(),snapshot=brief?this.coach.read():null,titles=new Map((brief?.plan||[]).map(item=>[coachPlanId(item),item.title]));
    const byChannel:Record<string,number>={};
    for(const item of this.db.prepare("SELECT json_extract(payload,'$.platform') platform FROM platform_content_history WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.timestamp')>=?").all(...this.args(),Date.parse(from)) as {platform:string|null}[])if(item.platform)byChannel[item.platform]=(byChannel[item.platform]||0)+1;
    const audits=(operation:string)=>this.count('SELECT COUNT(*) n FROM platform_audit WHERE organization_id=? AND project_id=? AND operation=? AND created_at>=? AND created_at<=?',operation,from,to);
    const activity=Object.values(byChannel).reduce((sum,value)=>sum+value,0)+states.filter(item=>item.state==='done').length;
    return {from,to,measurements,lastMeasuredAt:entries[0]?.observed_at||null,connections:{ga4:connected('ga4'),searchConsole:connected('search_console')},
      actions:{done:states.filter(item=>item.state==='done').length,skipped:states.filter(item=>item.state==='skipped').length,open:snapshot?.remaining||0,doneTitles:states.filter(item=>item.state==='done').map(item=>titles.get(item.action_id)).filter((item):item is string=>Boolean(item)).slice(0,5)},
      content:{drafts:audits('content.create'),draftsByChannel:byChannel,campaigns:audits('campaign.create'),
        publications:this.count("SELECT COUNT(*) n FROM platform_social_publications p JOIN platform_jobs j ON j.id=p.job_id WHERE p.organization_id=? AND p.project_id=? AND p.mode='publish' AND p.state='accepted' AND j.updated_at>=? AND j.updated_at<=?",from,to),
        planApproved:this.count('SELECT COUNT(*) n FROM platform_coach_content_items WHERE organization_id=? AND project_id=? AND approved_at>=? AND approved_at<=?',from,to)},
      seo:{audits:this.count("SELECT COUNT(*) n FROM platform_audit WHERE organization_id=? AND project_id=? AND operation GLOB 'seo.audit.completed:*' AND operation NOT GLOB '*:clean' AND created_at>=? AND created_at<=?",from,to),briefsApproved:audits('coach.seo.brief.approve')},
      rose:activity?measurements.filter(item=>item.previous!==null&&item.latest>item.previous).map(item=>({goal:item.goal,stage:item.stage,from:item.previous!,to:item.latest})):[]};
  }
  // Rule-based proposals; each names the fact it comes from. Nothing changes until an approver accepts it.
  private proposals(facts:CoachReviewFacts,brief:CoachBrief,planWeek:number):CoachAdjustment[]{
    const lang=brief.language,current=Math.min(planWeek,4),next=Math.min(current+1,4),list:CoachAdjustment[]=[],project=this.coach.repo.workspace(this.scope.subject,...this.args())!.project;
    const add=(id:string,title:LocalizedText,why:LocalizedText,item:Omit<CoachPlanItem,'week'|'title'>&{title:LocalizedText})=>list.push({id,kind:'add',title,why,item:{...item,week:next,title:item.title[lang]},actionId:null,toWeek:next,state:'proposed'});
    const stale=!facts.lastMeasuredAt||Date.now()-Date.parse(facts.lastMeasuredAt)>14*DAY;
    if(project.goals.length&&stale)add('measure',l('Gelecek hafta bir ölçüm kaydı ekle','Add a measurement next week'),l('Son 14 günde ölçüm kaydı yok; ölçüm olmadan bir sonraki özet neyin değiştiğini söyleyemez.','Nothing was measured in the last 14 days; without a measurement the next review can’t tell what changed.'),{title:l('Bu haftanın ölçümünü hedefe kaydedin','Record this week’s measurement for your goal'),why:lang==='tr'?'Haftalık özetin karşılaştırma yapabilmesi için tarihli bir değer gerekir.':'The weekly review needs a dated value to compare.',how:lang==='tr'?'Analitik’te hedef aşaması için bugünkü değeri girin. Bilmiyorsanız boş bırakın; tahmin yazmayın.':'In Analytics, enter today’s value for a goal stage. If you don’t know it, leave it empty; don’t estimate.',minutes:15,tool:'analytics',channel:null});
    if(!facts.connections.ga4&&!facts.connections.searchConsole)add('connect-data',l('Trafik verisi için bir kaynak bağla','Connect a source for traffic data'),l('Google Analytics veya Search Console bağlı değil; site trafiği hakkında hiçbir şey söylenemiyor.','Neither Google Analytics nor Search Console is connected, so nothing can be said about site traffic.'),{title:l('Google Analytics veya Search Console’u bağlayın','Connect Google Analytics or Search Console'),why:lang==='tr'?'Gerçek trafik ve arama verisi, neyin işe yaradığını görmenin tek yoludur.':'Real traffic and search data is the only way to see what works.',how:lang==='tr'?'Proje ayarları → Bağlantılar’daki rehberi izleyin. Bağlantı hiçbir şey yayınlamaz.':'Follow the guide in Project settings → Connections. Connecting publishes nothing.',minutes:20,tool:'connections',channel:null});
    const stored=new Map((this.db.prepare('SELECT action_id,state FROM platform_growth_coach_actions WHERE organization_id=? AND project_id=?').all(...this.args()) as {action_id:string;state:string}[]).map(row=>[row.action_id,row.state]));
    const open=brief.plan.filter(item=>item.week===current&&stored.get(coachPlanId(item))!=='done').sort((a,b)=>b.minutes-a.minutes);
    const approvedAt=this.coach.approved().approvedAt,settled=Boolean(approvedAt&&Date.now()-Date.parse(approvedAt)>5*DAY);
    if((facts.actions.skipped>=2||settled&&facts.actions.done===0&&facts.actions.open>=3)&&open.length>1&&next>current){const item=open[0];list.push({id:`move:${coachPlanId(item)}`,kind:'move',title:l(`“${item.title}” eylemini ${next}. haftaya taşı`,`Move “${item.title}” to week ${next}`),why:facts.actions.skipped>=2?l(`Bu hafta ${facts.actions.skipped} eylem atlandı; en uzun eylemi ertelemek haftayı hafifletir.`,`${facts.actions.skipped} actions were skipped this week; deferring the longest one lightens the week.`):l('Bu hafta tamamlanan eylem yok; daha az eylemle başlamak kolaylaştırabilir.','No action was completed this week; starting with fewer actions can help.'),item:null,actionId:coachPlanId(item),toWeek:next,state:'proposed'});}
    const channel=brief.channels.map(item=>item.id).filter(id=>(facts.content.draftsByChannel[id==='seo'?'blog':id]||0)>0).sort((a,b)=>(facts.content.draftsByChannel[b==='seo'?'blog':b]||0)-(facts.content.draftsByChannel[a==='seo'?'blog':a]||0))[0] as CoachChannel|undefined;
    if(channel){const name=(lang:'tr'|'en')=>coachChannelName(channel,lang),count=facts.content.draftsByChannel[channel==='seo'?'blog':channel];
      add(`repeat:${channel}`,l(`${name('tr')} için bir taslak daha planla`,`Plan one more ${name('en')} draft`),l(`Bu hafta ${count} ${name('tr')} taslağı oluşturuldu; ritmi korumak yeniden başlamaktan kolaydır.${facts.rose.length?' Bazı ölçümler aynı dönemde arttı; bu bir neden-sonuç kanıtı değildir.':''}`,`${count} ${name('en')} draft(s) were created this week; keeping the rhythm is easier than restarting.${facts.rose.length?' Some measurements rose in the same period; this is not proof of cause.':''}`),{title:l(`${name('tr')} için bir taslak daha hazırlayın`,`Draft one more ${name('en')} piece`),why:lang==='tr'?'Geçen hafta bu kanalda taslak hazırladınız; aynı konuyu farklı bir açıdan sürdürün.':'You drafted for this channel last week; continue the topic from a different angle.',how:lang==='tr'?'İçerik stüdyosunda geçen haftaki taslağı açın ve bir müşteri sorusuna odaklanan yeni bir versiyon yazın.':'Open last week’s draft in the content studio and write a new version focused on one customer question.',minutes:30,tool:channel==='email'?'campaigns':'library',channel});}
    if(planWeek>=4)list.push({id:'renew',kind:'note',title:l('30 günlük planı yenile','Renew the 30-day plan'),why:l('Plan dönemi sona eriyor. Öğrendiklerinizle yeni bir teşhis yapıp briefi güncelleyebilirsiniz.','The plan period is ending. You can run a new diagnosis with what you learned and update the brief.'),item:null,actionId:null,toWeek:null,state:'proposed'});
    return list.slice(0,4);
  }
  generate(now=new Date()){
    this.coach.authorize('content.write');const {brief,week}=this.coach.approved();if(!brief||!week)throw new MarketingStoreError('Önce strateji briefini onaylayın.',404);
    return this.db.transaction(()=>{
      this.coach.authorize('content.write');const facts=this.facts(now),current=this.row(coachWeekKey(now,this.coach.timeZone())),kept=current?(JSON.parse(current.adjustments_json) as CoachAdjustment[]).filter(item=>item.state!=='proposed'):[];
      const adjustments=[...kept,...this.proposals(facts,brief,week).filter(item=>!kept.some(other=>other.id===item.id))],stamp=new Date().toISOString();
      if(current)this.db.prepare('UPDATE platform_coach_reviews SET facts_json=?,adjustments_json=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=?').run(JSON.stringify(facts),JSON.stringify(adjustments),stamp,this.scope.subject,current.id);
      else this.db.prepare('INSERT INTO platform_coach_reviews(id,organization_id,project_id,week,facts_json,adjustments_json,revision,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?,?)').run(`review_${randomUUID()}`,...this.args(),coachWeekKey(now,this.coach.timeZone()),JSON.stringify(facts),JSON.stringify(adjustments),this.scope.subject,this.scope.subject,stamp,stamp);
      this.audit('coach.review.generate');return this.read(coachWeekKey(now,this.coach.timeZone()));
    }).immediate();
  }
  // Accepting an "add" or "move" proposal edits the approved plan (approval right); rejecting only records the decision.
  decide(raw:Record<string,unknown>){
    const decision=coachChoice(['accept','reject'] as const,raw.decision);this.coach.authorize(decision==='accept'?'campaign.approve':'content.write');
    return this.db.transaction(()=>{
      const row=typeof raw.reviewId==='string'?this.db.prepare('SELECT id,week,facts_json,adjustments_json,revision,created_at FROM platform_coach_reviews WHERE id=? AND organization_id=? AND project_id=?').get(raw.reviewId,...this.args()) as Row|undefined:undefined;
      if(!row)throw new MarketingStoreError('Haftalık özet bulunamadı.',404);if(row.week!==coachWeekKey(new Date(),this.coach.timeZone()))throw new MarketingStoreError('Yalnız bu haftanın özetindeki öneriler uygulanabilir.',409);
      const adjustments=JSON.parse(row.adjustments_json) as CoachAdjustment[],target=adjustments.find(item=>item.id===raw.adjustmentId);
      if(!target)throw new MarketingStoreError('Öneri bulunamadı.',404);if(target.state!=='proposed')throw new MarketingStoreError('Bu öneri için zaten karar verildi.',409);
      if(decision==='accept'&&target.kind!=='note')this.coach.adjustPlan(raw.expectedRevision,brief=>{
        if(target.kind==='add'){const item=target.item!;if(brief.plan.length>=16)throw new MarketingStoreError('Plan dolu (en fazla 16 eylem). Önce bir eylemi kaldırın.',409);if(brief.plan.some(other=>coachPlanId(other)===coachPlanId(item)))return brief;return {...brief,plan:[...brief.plan,item]};}
        const index=brief.plan.findIndex(item=>coachPlanId(item)===target.actionId);if(index<0)throw new MarketingStoreError('Taşınacak eylem planda artık yok.',409);
        return {...brief,plan:brief.plan.map((item,i)=>i===index?{...item,week:target.toWeek!}:item)};
      },`coach.review.${target.kind}`);
      this.db.prepare('UPDATE platform_coach_reviews SET adjustments_json=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=?').run(JSON.stringify(adjustments.map(item=>item.id===target.id?{...item,state:decision==='accept'?'accepted':'rejected'}:item)),new Date().toISOString(),this.scope.subject,row.id);
      this.audit(`coach.review.${decision}`);return this.read(row.week);
    }).immediate();
  }
  read(week=coachWeekKey(new Date(),this.coach.timeZone())):CoachReviewSnapshot{
    this.coach.authorize();const {brief,week:planWeek,revision}=this.coach.approved(),row=this.row(week);
    const review:CoachReview|null=row?{id:row.id,week:row.week,createdAt:row.created_at,revision:row.revision,facts:JSON.parse(row.facts_json),adjustments:JSON.parse(row.adjustments_json),hasData:false}:null;
    if(review){const facts=review.facts;review.hasData=Boolean(facts.measurements.length||facts.actions.done||facts.actions.skipped||facts.content.drafts||facts.content.campaigns||facts.content.publications||facts.content.planApproved||facts.seo.audits||facts.seo.briefsApproved);}
    const history=(this.db.prepare('SELECT id,week,created_at FROM platform_coach_reviews WHERE organization_id=? AND project_id=? ORDER BY week DESC LIMIT 8').all(...this.args()) as {id:string;week:string;created_at:string}[]).map(item=>({id:item.id,week:item.week,createdAt:item.created_at}));
    return {review,history,hasBrief:Boolean(brief),planWeek,coachRevision:revision,canWrite:this.coach.can('content.write'),canApprove:this.coach.can('campaign.approve')};
  }
}
