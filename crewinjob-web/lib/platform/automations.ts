import 'server-only';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { MarketingStoreError, ProjectMarketingStore, type MarketingScope } from './marketing-store';
import { ProductSegments } from './segments';
import type { SegmentEntity } from './segment-engine';
import { EmailRecipients, type EligibleEmailRecipient } from './email-recipients';
import { CampaignReviews } from './campaign-review';
import { EmailPilotQueue } from './email-pilots';
import { SesProvider } from './ses-provider';
import { emailIdentity } from './email-safety';
import { AUTOMATION_LIMITS, type AutomationDefinition, type AutomationState, type AutomationsSnapshot, type AutomationView, type EnrollmentState } from './automation-types';

type Row={id:string;name:string;state:AutomationState;definition_json:string;source_id:string;revision:number;created_by:string;activated_by:string|null;activated_at:string|null;last_evaluated_at:string|null;updated_at:string};
type Enrollment={id:number;entity_id:string;entered_at:string;due_at:string;state:EnrollmentState;reason:string|null};
const DAY=86400000,EVENT=/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const later=(iso:string,days:number)=>new Date(Date.parse(iso)+days*DAY).toISOString();

// Lifecycle automation: a contact enters (joins a segment or a product event arrives), waits, is re-checked, and is
// offered to an approver, who sends the approved campaign through the existing email pilot gates. One enrollment per
// contact per rule (no loops), a project-wide frequency cap, and exits when the goal event arrives, the contact leaves
// the segment or can no longer be emailed. Nothing is sent without an approver.
export class ProjectAutomations{
  repo:PlatformRepository;
  constructor(public db:Database.Database,public scope:MarketingScope,public key:string){this.repo=new PlatformRepository(db);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private can(permission:'read'|'content.write'|'campaign.approve',subject=this.scope.subject){return this.repo.can(subject,...this.args(),permission);}
  private canApprove(subject=this.scope.subject){return new EmailPilotQueue(this.db,{...this.scope,subject},this.key).canManage(subject);}
  authorize(permission:'read'|'content.write'|'campaign.approve'='read'){
    if(!this.can('read')||this.repo.workspace(this.scope.subject,...this.args())?.project.productPack!=='standard')throw new MarketingStoreError('Otomasyon için standart proje erişimi gerekli.',403);
    if(!this.can(permission))throw new MarketingStoreError(permission==='campaign.approve'?'Otomasyonu yalnız onay yetkisi olan ekip üyeleri etkinleştirebilir.':'Bu işlem için içerik yazma yetkisi gerekir.',403);
  }
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
  private row(id:unknown){const row=typeof id==='string'?this.db.prepare('SELECT * FROM platform_automations WHERE id=? AND organization_id=? AND project_id=?').get(id,...this.args()) as Row|undefined:undefined;if(!row)throw new MarketingStoreError('Otomasyon bulunamadı.',404);return row;}
  private definition(row:Row){return JSON.parse(row.definition_json) as AutomationDefinition;}
  // Validates a rule against this project's own segments, sources and campaigns.
  normalize(raw:Record<string,unknown>):{definition:AutomationDefinition;sourceId:string}{
    const name=typeof raw.name==='string'?raw.name.trim():'';if(!name||name.length>80)throw new MarketingStoreError('Otomasyon adı 1–80 karakter olmalı.');
    const trigger=raw.trigger&&typeof raw.trigger==='object'?raw.trigger as Record<string,unknown>:{},int=(value:unknown,min:number,max:number,message:string)=>{if(!Number.isInteger(value)||(value as number)<min||(value as number)>max)throw new MarketingStoreError(message);return value as number;};
    let sourceId:string,definitionTrigger:AutomationDefinition['trigger'];
    if(trigger.kind==='segment'){
      const version=this.db.prepare('SELECT v.source_id FROM platform_segment_versions v JOIN platform_segments s ON s.id=v.segment_id WHERE v.segment_id=? AND v.version=? AND v.organization_id=? AND v.project_id=? AND s.archived=0').get(trigger.segmentId,trigger.segmentVersion,...this.args()) as {source_id:string}|undefined;
      if(!version)throw new MarketingStoreError('Kitle sürümü bu projede bulunamadı.',404);sourceId=version.source_id;definitionTrigger={kind:'segment',segmentId:String(trigger.segmentId),segmentVersion:Number(trigger.segmentVersion)};
    }else if(trigger.kind==='event'){
      if(typeof trigger.eventName!=='string'||!EVENT.test(trigger.eventName))throw new MarketingStoreError('Olay adı geçersiz.');
      const source=this.db.prepare('SELECT connection_id FROM platform_product_sources WHERE connection_id=? AND organization_id=? AND project_id=?').get(trigger.sourceId,...this.args()) as {connection_id:string}|undefined;
      if(!source)throw new MarketingStoreError('Veri kaynağı bu projede bulunamadı.',404);sourceId=source.connection_id;definitionTrigger={kind:'event',sourceId,eventName:trigger.eventName};
    }else throw new MarketingStoreError('Tetikleyici geçersiz.');
    const exitEvent=raw.exitEvent===null||raw.exitEvent===undefined||raw.exitEvent===''?null:typeof raw.exitEvent==='string'&&EVENT.test(raw.exitEvent)?raw.exitEvent:undefined;
    if(exitEvent===undefined)throw new MarketingStoreError('Çıkış olayı adı geçersiz.');
    const campaign=typeof raw.campaignId==='string'?new ProjectMarketingStore(this.db,this.scope).campaign(raw.campaignId):undefined;
    if(!campaign||!campaign.channels.email)throw new MarketingStoreError('E-posta kanalı açık bir kampanya seçin.',404);
    if(!campaign.segmentBinding||campaign.segmentBinding.sourceId!==sourceId)throw new MarketingStoreError('Kampanyanın kitlesi otomasyonla aynı veri kaynağından olmalı.',409);
    return {sourceId,definition:{name,trigger:definitionTrigger,waitDays:int(raw.waitDays,0,AUTOMATION_LIMITS.waitDays,'Bekleme süresi 0–30 gün olmalı.'),exitEvent,exitOnLeave:raw.exitOnLeave===true&&definitionTrigger.kind==='segment',campaignId:campaign.id,capDays:int(raw.capDays,1,AUTOMATION_LIMITS.capDays,'Sıklık sınırı 1–90 gün olmalı.')}};
  }
  save(raw:Record<string,unknown>){
    this.authorize('content.write');const {definition,sourceId}=this.normalize(raw);
    return this.db.transaction(()=>{
      this.authorize('content.write');const now=new Date().toISOString();
      if(raw.id===undefined){
        if((this.db.prepare('SELECT COUNT(*) n FROM platform_automations WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n>=AUTOMATION_LIMITS.automations)throw new MarketingStoreError('Otomasyon sınırına ulaşıldı.',429);
        this.db.prepare("INSERT INTO platform_automations(id,organization_id,project_id,name,state,definition_json,source_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?,?,?,?,?)").run(`automation_${randomUUID()}`,...this.args(),definition.name,JSON.stringify(definition),sourceId,this.scope.subject,this.scope.subject,now,now);
        this.audit('automation.create');return this.read();
      }
      const row=this.row(raw.id);if(row.state==='active')throw new MarketingStoreError('Etkin otomasyonu düzenlemeden önce duraklatın.',409);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Otomasyon başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      this.db.prepare('UPDATE platform_automations SET name=?,definition_json=?,source_id=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=?').run(definition.name,JSON.stringify(definition),sourceId,this.scope.subject,now,row.id);
      this.audit('automation.update');return this.read();
    }).immediate();
  }
  // Activating is a standing rule, so it needs the approval right. Pausing is open to every writer, as a safety stop.
  setState(raw:Record<string,unknown>){
    const next=raw.state==='active'?'active':raw.state==='paused'?'paused':null;if(!next)throw new MarketingStoreError('Geçersiz otomasyon durumu.');
    this.authorize(next==='active'?'campaign.approve':'content.write');
    return this.db.transaction(()=>{
      const row=this.row(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Otomasyon başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      if(next==='active')this.normalize({...this.definition(row)});
      const now=new Date().toISOString();
      this.db.prepare('UPDATE platform_automations SET state=?,revision=revision+1,updated_by=?,updated_at=?,activated_by=CASE WHEN ?=\'active\' THEN ? ELSE activated_by END,activated_at=CASE WHEN ?=\'active\' THEN ? ELSE activated_at END WHERE id=?').run(next,this.scope.subject,now,next,this.scope.subject,next,now,row.id);
      this.audit(`automation.${next==='active'?'activate':'pause'}`);return this.read();
    }).immediate();
  }
  private members(sourceId:string,ids:string[]):SegmentEntity[]{
    if(!ids.length)return [];const version=(this.db.prepare('SELECT version FROM platform_product_sources WHERE connection_id=? AND organization_id=? AND project_id=?').get(sourceId,...this.args()) as {version:number}|undefined)?.version;if(!version)return [];
    const found:SegmentEntity[]=[];
    for(let i=0;i<ids.length;i+=400){const chunk=ids.slice(i,i+400);for(const row of this.db.prepare(`SELECT external_id,attributes_json,observed_at FROM platform_product_records WHERE connection_id=? AND version=? AND organization_id=? AND project_id=? AND external_id IN (${chunk.map(()=>'?').join(',')})`).all(sourceId,version,...this.args(),...chunk) as {external_id:string;attributes_json:string;observed_at:string}[])found.push({id:row.external_id,attributes:JSON.parse(row.attributes_json),observedAt:row.observed_at});}
    return found;
  }
  private hasEvent(sourceId:string,entityId:string,eventName:string,since:string){return Boolean(this.db.prepare('SELECT 1 FROM platform_product_events WHERE connection_id=? AND organization_id=? AND project_id=? AND entity_id=? AND event_name=? AND occurred_at>=? LIMIT 1').get(sourceId,...this.args(),entityId,eventName,since));}
  // Enrolls new contacts and moves due ones forward. Read and bookkeeping only: nothing is queued or sent here.
  evaluate(raw:Record<string,unknown>,now=new Date()){
    this.authorize('content.write');const row=this.row(raw.id);if(row.state!=='active')throw new MarketingStoreError('Önce otomasyonu etkinleştirin.',409);
    const definition=this.definition(row),at=now.toISOString();let current:Set<string>|null=null,entered:string[]=[];
    if(definition.trigger.kind==='segment'){const members:SegmentEntity[]=[];new ProductSegments(this.db,this.scope).evaluateSaved(definition.trigger.segmentId,definition.trigger.segmentVersion,members);current=new Set(members.map(item=>item.id));entered=[...current];}
    else{const since=row.last_evaluated_at||row.activated_at||at;entered=(this.db.prepare('SELECT DISTINCT entity_id FROM platform_product_events WHERE connection_id=? AND organization_id=? AND project_id=? AND event_name=? AND received_at>=? AND received_at<=? LIMIT ?').all(row.source_id,...this.args(),definition.trigger.eventName,since,at,AUTOMATION_LIMITS.enrollPerRun) as {entity_id:string}[]).map(item=>item.entity_id);}
    return this.db.transaction(()=>{
      this.authorize('content.write');const counts={entered:0,ready:0,exited:0,deferred:0};
      const insert=this.db.prepare("INSERT OR IGNORE INTO platform_automation_enrollments(automation_id,organization_id,project_id,source_id,entity_id,entered_at,due_at,state,updated_at) VALUES(?,?,?,?,?,?,?,'waiting',?)");
      for(const entity of entered.slice(0,AUTOMATION_LIMITS.enrollPerRun))counts.entered+=insert.run(row.id,...this.args(),row.source_id,entity,at,later(at,definition.waitDays),at).changes;
      const update=this.db.prepare('UPDATE platform_automation_enrollments SET state=?,reason=?,due_at=?,updated_at=? WHERE id=?');
      const lastSent=this.db.prepare("SELECT MAX(updated_at) at FROM platform_automation_enrollments WHERE organization_id=? AND project_id=? AND source_id=? AND entity_id=? AND state='sent'");
      for(const item of this.db.prepare("SELECT id,entity_id,entered_at,due_at,state,reason FROM platform_automation_enrollments WHERE automation_id=? AND state='waiting' AND due_at<=? ORDER BY due_at LIMIT ?").all(row.id,at,AUTOMATION_LIMITS.enrollPerRun) as Enrollment[]){
        if(definition.exitEvent&&this.hasEvent(row.source_id,item.entity_id,definition.exitEvent,item.entered_at)){update.run('exited','goal_reached',item.due_at,at,item.id);counts.exited++;continue;}
        if(definition.exitOnLeave&&current&&!current.has(item.entity_id)){update.run('exited','left_segment',item.due_at,at,item.id);counts.exited++;continue;}
        // Frequency cap across all of this project's automations: wait until the cap has passed since the last send.
        const sent=(lastSent.get(...this.args(),row.source_id,item.entity_id) as {at:string|null}).at;
        if(sent&&later(sent,definition.capDays)>at){update.run('waiting','frequency_cap',later(sent,definition.capDays),at,item.id);counts.deferred++;continue;}
        update.run('ready',null,item.due_at,at,item.id);counts.ready++;
      }
      this.db.prepare('UPDATE platform_automations SET last_evaluated_at=? WHERE id=?').run(at,row.id);
      this.db.prepare("INSERT INTO platform_automation_runs(id,automation_id,organization_id,project_id,kind,mode,actor_id,job_id,counts_json,created_at) VALUES(?,?,?,?,'evaluate',NULL,?,NULL,?,?)").run(`autorun_${randomUUID()}`,row.id,...this.args(),this.scope.subject,JSON.stringify(counts),at);
      this.audit('automation.evaluate');return {counts,snapshot:this.read()};
    }).immediate();
  }
  // The approver sends the approved campaign to ready contacts through the email pilot: the same consent, suppression,
  // allowlist, recipient limit and daily reservations apply. A rehearsal checks recipients and sends nothing.
  approve(raw:Record<string,unknown>){
    this.authorize('campaign.approve');if(!this.canApprove())throw new MarketingStoreError('Pilot gönderimi için onay, bağlantı ve alıcı yönetimi yetkileri gerekli.',403);
    const mode=raw.mode==='send'?'send':raw.mode==='rehearsal'?'rehearsal':null;if(!mode)throw new MarketingStoreError('Gönderim türü geçersiz.');
    return this.db.transaction(()=>{
      const row=this.row(raw.id);if(row.state!=='active')throw new MarketingStoreError('Önce otomasyonu etkinleştirin.',409);
      const definition=this.definition(row),ready=this.db.prepare("SELECT id,entity_id,entered_at,due_at,state,reason FROM platform_automation_enrollments WHERE automation_id=? AND state='ready' ORDER BY due_at LIMIT ?").all(row.id,AUTOMATION_LIMITS.approvePerRun) as Enrollment[];
      if(!ready.length)throw new MarketingStoreError('Onay bekleyen kişi yok.',409);
      const now=new Date().toISOString(),version=(this.db.prepare('SELECT version FROM platform_product_sources WHERE connection_id=? AND organization_id=? AND project_id=?').get(row.source_id,...this.args()) as {version:number}).version;
      const members=this.members(row.source_id,ready.map(item=>item.entity_id)),eligible:EligibleEmailRecipient[]=[];
      const eligibility=new EmailRecipients(this.db,this.scope,this.key).eligibility(row.source_id,version,members,undefined,eligible);
      if(!eligibility.mappingReady)throw new MarketingStoreError('Güncel alıcı eşleştirmesi gerekli.',409);
      // Contacts that cannot be emailed (no consent, suppressed, invalid or missing) leave the automation now.
      const entityKeyOf=(id:string)=>emailEntityKey(this.scope,this.key,row.source_id,id),eligibleEntities=new Set(eligible.map(item=>item.entityKey)),emailByEntity=new Map(eligible.map(item=>[item.entityKey,item.emailKey]));
      const update=this.db.prepare('UPDATE platform_automation_enrollments SET state=?,reason=?,job_id=?,updated_at=? WHERE id=?'),counts={notSendable:0,sent:0,held:0,rehearsed:0};
      const sendable=ready.filter(item=>{const ok=eligibleEntities.has(entityKeyOf(item.entity_id));if(!ok&&mode==='send'){update.run('exited','not_sendable',null,now,item.id);counts.notSendable++;}return ok;});
      if(!sendable.length){if(mode==='send')this.run(row.id,mode,null,counts,now);return {counts,job:null,snapshot:this.read()};}
      const reviews=new CampaignReviews(this.db,this.scope,this.key),current=reviews.get(definition.campaignId);
      if(current.approval!=='approved')throw new MarketingStoreError('Kampanyanın güncel içeriği onaylı olmalı.',409);
      const checked=reviews.check(definition.campaignId,current.digest),keys=new Set(sendable.map(item=>emailByEntity.get(entityKeyOf(item.entity_id))!));
      const job=new EmailPilotQueue(this.db,this.scope,this.key).enqueue({campaignId:definition.campaignId,expectedDigest:checked.digest,expectedReviewId:checked.history[0].id,idempotencyKey:`automation-${randomUUID()}`,acknowledged:true,sendAcknowledged:raw.sendAcknowledged===true},mode,keys);
      const included=new Set((this.db.prepare('SELECT email_key FROM platform_email_pilot_recipients WHERE job_id=?').all(job.id) as {email_key:string}[]).map(item=>item.email_key));
      for(const item of sendable){const inJob=included.has(emailByEntity.get(entityKeyOf(item.entity_id))!);
        if(mode==='send'&&inJob){update.run('sent',null,job.id,now,item.id);counts.sent++;}else if(mode==='rehearsal'&&inJob)counts.rehearsed++;else{update.run('ready','pilot_limit',null,now,item.id);counts.held++;}}
      this.run(row.id,mode,job.id,counts,now);this.audit(`automation.approve.${mode}`);return {counts,job,snapshot:this.read()};
    }).immediate();
  }
  private run(id:string,mode:'rehearsal'|'send',jobId:string|null,counts:Record<string,number>,at:string){this.db.prepare("INSERT INTO platform_automation_runs(id,automation_id,organization_id,project_id,kind,mode,actor_id,job_id,counts_json,created_at) VALUES(?,?,?,?,'approve',?,?,?,?,?)").run(`autorun_${randomUUID()}`,id,...this.args(),mode,this.scope.subject,jobId,JSON.stringify(counts),at);}
  read():AutomationsSnapshot{
    this.authorize();const rows=this.db.prepare('SELECT * FROM platform_automations WHERE organization_id=? AND project_id=? ORDER BY created_at,id').all(...this.args()) as Row[];
    const store=new ProjectMarketingStore(this.db,this.scope),campaigns=store.listCampaigns().filter(item=>item.channels.email),reviews=this.can('content.write')?new CampaignReviews(this.db,this.scope,this.key):null;
    const segments=this.db.prepare('SELECT s.id,s.name,s.version,v.source_id FROM platform_segments s JOIN platform_segment_versions v ON v.segment_id=s.id AND v.version=s.version WHERE s.organization_id=? AND s.project_id=? AND s.archived=0 ORDER BY s.name').all(...this.args()) as {id:string;name:string;version:number;source_id:string}[];
    const automations=rows.map((row):AutomationView=>{
      const definition=this.definition(row),counts={waiting:0,ready:0,sent:0,exited:0} as Record<EnrollmentState,number>,reasons:Record<string,number>={};
      for(const item of this.db.prepare('SELECT state,reason,COUNT(*) n FROM platform_automation_enrollments WHERE automation_id=? GROUP BY state,reason').all(row.id) as {state:EnrollmentState;reason:string|null;n:number}[]){counts[item.state]+=item.n;if(item.reason)reasons[item.reason]=(reasons[item.reason]||0)+item.n;}
      const runs=(this.db.prepare('SELECT kind,mode,job_id,counts_json,created_at FROM platform_automation_runs WHERE automation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 5').all(row.id) as {kind:'evaluate'|'approve';mode:'rehearsal'|'send'|null;job_id:string|null;counts_json:string;created_at:string}[]).map(item=>({kind:item.kind,mode:item.mode,createdAt:item.created_at,counts:JSON.parse(item.counts_json),jobId:item.job_id}));
      return {...definition,id:row.id,state:row.state,revision:row.revision,sourceId:row.source_id,activatedAt:row.activated_at,lastEvaluatedAt:row.last_evaluated_at,updatedAt:row.updated_at,counts,reasons,runs,
        campaignName:campaigns.find(item=>item.id===definition.campaignId)?.name||null,segmentName:definition.trigger.kind==='segment'?segments.find(item=>item.id===(definition.trigger as {segmentId:string}).segmentId)?.name||null:null};
    });
    const sources=this.can('content.write')?new ProductSegments(this.db,this.scope).sources().map(item=>({id:item.id,name:item.name,eventNames:item.eventNames})):[];
    return {automations,segments:segments.map(item=>({id:item.id,name:item.name,version:item.version,sourceId:item.source_id})),sources,
      campaigns:campaigns.map(item=>{let approval='none';try{approval=reviews?reviews.get(item.id).approval:'none';}catch{approval='none';}return {id:item.id,name:item.name,sourceId:item.segmentBinding?.sourceId||null,approval};}),
      canWrite:this.can('content.write'),canActivate:this.can('campaign.approve'),canApprove:this.canApprove(),sendingEnabled:new SesProvider(this.db,this.scope,this.key).state().ready};
  }
}
const emailEntityKey=(scope:MarketingScope,key:string,sourceId:string,entityId:string)=>emailIdentity(scope,key,'entity',[sourceId,entityId]);
// Worker step: keeps active automations' enrollments current (no sends). The activator's rights are re-checked;
// without them the automation is paused.
export function evaluateDueAutomations(db:Database.Database,key:string,everyMs=6*3600000,limit=3){
  const cutoff=new Date(Date.now()-everyMs).toISOString(),rows=db.prepare("SELECT id,organization_id,project_id,activated_by FROM platform_automations WHERE state='active' AND (last_evaluated_at IS NULL OR last_evaluated_at<?) ORDER BY last_evaluated_at LIMIT ?").all(cutoff,limit) as {id:string;organization_id:string;project_id:string;activated_by:string}[];
  let evaluated=0;
  for(const row of rows){
    const automations=new ProjectAutomations(db,{subject:row.activated_by,organizationId:row.organization_id,projectId:row.project_id},key);
    try{automations.evaluate({id:row.id});evaluated++;}
    // Lost rights pause the rule; other errors (e.g. a stale source) are retried next tick without skipping any events.
    catch(error){if(error instanceof MarketingStoreError&&error.status===403)db.prepare("UPDATE platform_automations SET state='paused',revision=revision+1,updated_at=? WHERE id=? AND state='active'").run(new Date().toISOString(),row.id);}
  }
  return evaluated;
}
