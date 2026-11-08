import { filterSeries, flatMapSeries, mapSeries } from '../db/async-array';
import type { Db } from '../db/client';
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
import { MobileGrowth } from './mobile-store';
import { MobileDelivery } from './mobile-delivery';
import { mobileEntity } from './mobile-ingestion';
import { AUTOMATION_LIMITS, type AutomationChannel, type AutomationDefinition, type AutomationState, type AutomationsSnapshot, type AutomationView, type EnrollmentState } from './automation-types';

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
  constructor(public db:Db,public scope:MarketingScope,public key:string){this.repo=new PlatformRepository(db);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private async can(permission:'read'|'content.write'|'campaign.approve',subject=this.scope.subject){return await this.repo.can(subject,...this.args(),permission);}
  private async canApprove(subject=this.scope.subject){return await new EmailPilotQueue(this.db,{...this.scope,subject},this.key).canManage(subject);}
  async authorize(permission:'read'|'content.write'|'campaign.approve'='read'){
    if(!await this.can('read')||(await this.repo.workspace(this.scope.subject,...this.args()))?.project.productPack!=='standard')throw new MarketingStoreError('Otomasyon için standart proje erişimi gerekli.',403);
    if(!await this.can(permission))throw new MarketingStoreError(permission==='campaign.approve'?'Otomasyonu yalnız onay yetkisi olan ekip üyeleri etkinleştirebilir.':'Bu işlem için içerik yazma yetkisi gerekir.',403);
  }
  private async audit(operation:string){await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
  private async row(id:unknown){const row=typeof id==='string'?await this.db.prepare('SELECT * FROM platform_automations WHERE id=? AND organization_id=? AND project_id=?').get(id,...this.args()) as Row|undefined:undefined;if(!row)throw new MarketingStoreError('Otomasyon bulunamadı.',404);return row;}
  private definition(row:Row){return JSON.parse(row.definition_json) as AutomationDefinition;}
  // Validates a rule against this project's own segments, sources and campaigns.
  async normalize(raw:Record<string,unknown>):Promise<{definition:AutomationDefinition;sourceId:string}>{
    const name=typeof raw.name==='string'?raw.name.trim():'';if(!name||name.length>80)throw new MarketingStoreError('Otomasyon adı 1–80 karakter olmalı.');
    const trigger=raw.trigger&&typeof raw.trigger==='object'?raw.trigger as Record<string,unknown>:{},int=(value:unknown,min:number,max:number,message:string)=>{if(!Number.isInteger(value)||(value as number)<min||(value as number)>max)throw new MarketingStoreError(message);return value as number;};
    let sourceId:string,definitionTrigger:AutomationDefinition['trigger'];
    if(trigger.kind==='segment'){
      const version=await this.db.prepare('SELECT v.source_id FROM platform_segment_versions v JOIN platform_segments s ON s.id=v.segment_id WHERE v.segment_id=? AND v.version=? AND v.organization_id=? AND v.project_id=? AND s.archived=0').get(trigger.segmentId,trigger.segmentVersion,...this.args()) as {source_id:string}|undefined;
      if(!version)throw new MarketingStoreError('Kitle sürümü bu projede bulunamadı.',404);sourceId=version.source_id;definitionTrigger={kind:'segment',segmentId:String(trigger.segmentId),segmentVersion:Number(trigger.segmentVersion)};
    }else if(trigger.kind==='event'){
      if(typeof trigger.eventName!=='string'||!EVENT.test(trigger.eventName))throw new MarketingStoreError('Olay adı geçersiz.');
      const source=await this.db.prepare('SELECT connection_id FROM platform_product_sources WHERE connection_id=? AND organization_id=? AND project_id=?').get(trigger.sourceId,...this.args()) as {connection_id:string}|undefined;
      if(!source)throw new MarketingStoreError('Veri kaynağı bu projede bulunamadı.',404);sourceId=source.connection_id;definitionTrigger={kind:'event',sourceId,eventName:trigger.eventName};
    }else throw new MarketingStoreError('Tetikleyici geçersiz.');
    const exitEvent=raw.exitEvent===null||raw.exitEvent===undefined||raw.exitEvent===''?null:typeof raw.exitEvent==='string'&&EVENT.test(raw.exitEvent)?raw.exitEvent:undefined;
    if(exitEvent===undefined)throw new MarketingStoreError('Çıkış olayı adı geçersiz.');
    const channel:AutomationChannel=raw.channel==='push'||raw.channel==='in_app'?raw.channel:'email';
    const campaign=typeof raw.campaignId==='string'?await new ProjectMarketingStore(this.db,this.scope).campaign(raw.campaignId):undefined;
    let mobile:AutomationDefinition['mobile']=null;
    if(channel==='email'){
      if(!campaign||!campaign.channels.email)throw new MarketingStoreError('E-posta kanalı açık bir kampanya seçin.',404);
      if(!campaign.segmentBinding||campaign.segmentBinding.sourceId!==sourceId)throw new MarketingStoreError('Kampanyanın kitlesi otomasyonla aynı veri kaynağından olmalı.',409);
    }else{
      // The message text comes from a campaign draft, the delivery from the app's own push or in-app connection.
      if(!campaign||campaign.status!=='draft')throw new MarketingStoreError('Mobil mesaj için bir kampanya taslağı seçin.',404);
      // A saved rule keeps them under "mobile" (re-checked on activation); the editor sends them flat.
      const target=(raw.mobile&&typeof raw.mobile==='object'?raw.mobile:raw) as Record<string,unknown>,service=new MobileGrowth(this.db,this.scope,this.key),appId=typeof target.appId==='string'?target.appId:'',connectionId=typeof target.connectionId==='string'?target.connectionId:'';
      let app;try{app=await service.app(appId);}catch{throw new MarketingStoreError('Mobil uygulama bu projede bulunamadı.',404);}
      const connection=(await service.integrations(app.id)).find(item=>item.id===connectionId);
      if(!connection||!connection.active||!(channel==='push'?['onesignal','firebase'].includes(connection.provider):connection.provider==='bridge'))throw new MarketingStoreError('Kanala uygun etkin bir mobil bağlantı seçin.',409);
      mobile={appId:app.id,connectionId};
    }
    return {sourceId,definition:{name,trigger:definitionTrigger,waitDays:int(raw.waitDays,0,AUTOMATION_LIMITS.waitDays,'Bekleme süresi 0–30 gün olmalı.'),exitEvent,exitOnLeave:raw.exitOnLeave===true&&definitionTrigger.kind==='segment',campaignId:campaign.id,capDays:int(raw.capDays,1,AUTOMATION_LIMITS.capDays,'Sıklık sınırı 1–90 gün olmalı.'),...(channel==='email'?{}:{channel,mobile})}};
  }
  async save(raw:Record<string,unknown>){
    await this.authorize('content.write');const {definition,sourceId}=await this.normalize(raw);
    return await this.db.transaction(async ()=>{
      await this.authorize('content.write');const now=new Date().toISOString();
      if(raw.id===undefined){
        if((await this.db.prepare('SELECT COUNT(*) n FROM platform_automations WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n>=AUTOMATION_LIMITS.automations)throw new MarketingStoreError('Otomasyon sınırına ulaşıldı.',429);
        await this.db.prepare("INSERT INTO platform_automations(id,organization_id,project_id,name,state,definition_json,source_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?,?,?,?,?)").run(`automation_${randomUUID()}`,...this.args(),definition.name,JSON.stringify(definition),sourceId,this.scope.subject,this.scope.subject,now,now);
        await this.audit('automation.create');return await this.read();
      }
      const row=await this.row(raw.id);if(row.state==='active')throw new MarketingStoreError('Etkin otomasyonu düzenlemeden önce duraklatın.',409);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Otomasyon başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      await this.db.prepare('UPDATE platform_automations SET name=?,definition_json=?,source_id=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=?').run(definition.name,JSON.stringify(definition),sourceId,this.scope.subject,now,row.id);
      await this.audit('automation.update');return await this.read();
    });
  }
  // Activating is a standing rule, so it needs the approval right. Pausing is open to every writer, as a safety stop.
  async setState(raw:Record<string,unknown>){
    const next=raw.state==='active'?'active':raw.state==='paused'?'paused':null;if(!next)throw new MarketingStoreError('Geçersiz otomasyon durumu.');
    await this.authorize(next==='active'?'campaign.approve':'content.write');
    return await this.db.transaction(async ()=>{
      const row=await this.row(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Otomasyon başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      if(next==='active')await this.normalize({...this.definition(row)});
      const now=new Date().toISOString();
      await this.db.prepare('UPDATE platform_automations SET state=?,revision=revision+1,updated_by=?,updated_at=?,activated_by=CASE WHEN ?=\'active\' THEN ? ELSE activated_by END,activated_at=CASE WHEN ?=\'active\' THEN ? ELSE activated_at END WHERE id=?').run(next,this.scope.subject,now,next,this.scope.subject,next,now,row.id);
      await this.audit(`automation.${next==='active'?'activate':'pause'}`);return await this.read();
    });
  }
  private async members(sourceId:string,ids:string[]):Promise<SegmentEntity[]>{
    if(!ids.length)return [];const version=(await this.db.prepare('SELECT version FROM platform_product_sources WHERE connection_id=? AND organization_id=? AND project_id=?').get(sourceId,...this.args()) as {version:number}|undefined)?.version;if(!version)return [];
    const found:SegmentEntity[]=[];
    for(let i=0;i<ids.length;i+=400){const chunk=ids.slice(i,i+400);for(const row of await this.db.prepare(`SELECT external_id,attributes_json,observed_at FROM platform_product_records WHERE connection_id=? AND version=? AND organization_id=? AND project_id=? AND external_id IN (${chunk.map(()=>'?').join(',')})`).all(sourceId,version,...this.args(),...chunk) as {external_id:string;attributes_json:string;observed_at:string}[])found.push({id:row.external_id,attributes:JSON.parse(row.attributes_json),observedAt:row.observed_at});}
    return found;
  }
  private async hasEvent(sourceId:string,entityId:string,eventName:string,since:string){return Boolean(await this.db.prepare('SELECT 1 FROM platform_product_events WHERE connection_id=? AND organization_id=? AND project_id=? AND entity_id=? AND event_name=? AND occurred_at>=? LIMIT 1').get(sourceId,...this.args(),entityId,eventName,since));}
  // Enrolls new contacts and moves due ones forward. Read and bookkeeping only: nothing is queued or sent here.
  async evaluate(raw:Record<string,unknown>,now=new Date()){
    await this.authorize('content.write');const row=await this.row(raw.id);if(row.state!=='active')throw new MarketingStoreError('Önce otomasyonu etkinleştirin.',409);
    const definition=this.definition(row),at=now.toISOString();let current:Set<string>|null=null,entered:string[]=[];
    if(definition.trigger.kind==='segment'){const members:SegmentEntity[]=[];await new ProductSegments(this.db,this.scope).evaluateSaved(definition.trigger.segmentId,definition.trigger.segmentVersion,members);current=new Set(members.map(item=>item.id));entered=[...current];}
    else{const since=row.last_evaluated_at||row.activated_at||at;entered=(await this.db.prepare('SELECT DISTINCT entity_id FROM platform_product_events WHERE connection_id=? AND organization_id=? AND project_id=? AND event_name=? AND received_at>=? AND received_at<=? LIMIT ?').all(row.source_id,...this.args(),definition.trigger.eventName,since,at,AUTOMATION_LIMITS.enrollPerRun) as {entity_id:string}[]).map(item=>item.entity_id);}
    return await this.db.transaction(async ()=>{
      await this.authorize('content.write');const counts={entered:0,ready:0,exited:0,deferred:0};
      const insert=this.db.prepare("INSERT OR IGNORE INTO platform_automation_enrollments(automation_id,organization_id,project_id,source_id,entity_id,entered_at,due_at,state,updated_at) VALUES(?,?,?,?,?,?,?,'waiting',?)");
      for(const entity of entered.slice(0,AUTOMATION_LIMITS.enrollPerRun))counts.entered+=(await insert.run(row.id,...this.args(),row.source_id,entity,at,later(at,definition.waitDays),at)).changes;
      const update=this.db.prepare('UPDATE platform_automation_enrollments SET state=?,reason=?,due_at=?,updated_at=? WHERE id=?');
      const lastSent=this.db.prepare("SELECT MAX(updated_at) at FROM platform_automation_enrollments WHERE organization_id=? AND project_id=? AND source_id=? AND entity_id=? AND state='sent'");
      for(const item of await this.db.prepare("SELECT id,entity_id,entered_at,due_at,state,reason FROM platform_automation_enrollments WHERE automation_id=? AND state='waiting' AND due_at<=? ORDER BY due_at LIMIT ?").all(row.id,at,AUTOMATION_LIMITS.enrollPerRun) as Enrollment[]){
        if(definition.exitEvent&&await this.hasEvent(row.source_id,item.entity_id,definition.exitEvent,item.entered_at)){await update.run('exited','goal_reached',item.due_at,at,item.id);counts.exited++;continue;}
        if(definition.exitOnLeave&&current&&!current.has(item.entity_id)){await update.run('exited','left_segment',item.due_at,at,item.id);counts.exited++;continue;}
        // Frequency cap across all of this project's automations: wait until the cap has passed since the last send.
        const sent=(await lastSent.get(...this.args(),row.source_id,item.entity_id) as {at:string|null}).at;
        if(sent&&later(sent,definition.capDays)>at){await update.run('waiting','frequency_cap',later(sent,definition.capDays),at,item.id);counts.deferred++;continue;}
        await update.run('ready',null,item.due_at,at,item.id);counts.ready++;
      }
      await this.db.prepare('UPDATE platform_automations SET last_evaluated_at=? WHERE id=?').run(at,row.id);
      await this.db.prepare("INSERT INTO platform_automation_runs(id,automation_id,organization_id,project_id,kind,mode,actor_id,job_id,counts_json,created_at) VALUES(?,?,?,?,'evaluate',NULL,?,NULL,?,?)").run(`autorun_${randomUUID()}`,row.id,...this.args(),this.scope.subject,JSON.stringify(counts),at);
      await this.audit('automation.evaluate');return {counts,snapshot:await this.read()};
    });
  }
  // The approver sends the approved campaign to ready contacts through the email pilot: the same consent, suppression,
  // allowlist, recipient limit and daily reservations apply. A rehearsal checks recipients and sends nothing.
  async approve(raw:Record<string,unknown>){
    await this.authorize('campaign.approve');if(!await this.canApprove())throw new MarketingStoreError('Pilot gönderimi için onay, bağlantı ve alıcı yönetimi yetkileri gerekli.',403);
    const mode=raw.mode==='send'?'send':raw.mode==='rehearsal'?'rehearsal':null;if(!mode)throw new MarketingStoreError('Gönderim türü geçersiz.');
    return await this.db.transaction(async ()=>{
      const row=await this.row(raw.id);if(row.state!=='active')throw new MarketingStoreError('Önce otomasyonu etkinleştirin.',409);
      const definition=this.definition(row),ready=await this.db.prepare("SELECT id,entity_id,entered_at,due_at,state,reason FROM platform_automation_enrollments WHERE automation_id=? AND state='ready' ORDER BY due_at LIMIT ?").all(row.id,AUTOMATION_LIMITS.approvePerRun) as Enrollment[];
      if(!ready.length)throw new MarketingStoreError('Onay bekleyen kişi yok.',409);
      const now=new Date().toISOString();
      if(definition.channel==='push'||definition.channel==='in_app')return await this.approveMobile(row,definition,ready,mode,raw.sendAcknowledged===true,now);
      const version=(await this.db.prepare('SELECT version FROM platform_product_sources WHERE connection_id=? AND organization_id=? AND project_id=?').get(row.source_id,...this.args()) as {version:number}).version;
      const members=await this.members(row.source_id,ready.map(item=>item.entity_id)),eligible:EligibleEmailRecipient[]=[];
      const eligibility=await new EmailRecipients(this.db,this.scope,this.key).eligibility(row.source_id,version,members,undefined,eligible);
      if(!eligibility.mappingReady)throw new MarketingStoreError('Güncel alıcı eşleştirmesi gerekli.',409);
      // Contacts that cannot be emailed (no consent, suppressed, invalid or missing) leave the automation now.
      const entityKeyOf=(id:string)=>emailEntityKey(this.scope,this.key,row.source_id,id),eligibleEntities=new Set(eligible.map(item=>item.entityKey)),emailByEntity=new Map(eligible.map(item=>[item.entityKey,item.emailKey]));
      const update=this.db.prepare('UPDATE platform_automation_enrollments SET state=?,reason=?,job_id=?,updated_at=? WHERE id=?'),counts={notSendable:0,sent:0,held:0,rehearsed:0};
      const sendable=await filterSeries(ready, async item=>{const ok=eligibleEntities.has(entityKeyOf(item.entity_id));if(!ok&&mode==='send'){await update.run('exited','not_sendable',null,now,item.id);counts.notSendable++;}return ok;});
      if(!sendable.length){if(mode==='send')await this.run(row.id,mode,null,counts,now);return {counts,job:null,snapshot:await this.read()};}
      const reviews=new CampaignReviews(this.db,this.scope,this.key),current=await reviews.get(definition.campaignId);
      if(current.approval!=='approved')throw new MarketingStoreError('Kampanyanın güncel içeriği onaylı olmalı.',409);
      const checked=await reviews.check(definition.campaignId,current.digest),keys=new Set(sendable.map(item=>emailByEntity.get(entityKeyOf(item.entity_id))!));
      const job=await new EmailPilotQueue(this.db,this.scope,this.key).enqueue({campaignId:definition.campaignId,expectedDigest:checked.digest,expectedReviewId:checked.history[0].id,idempotencyKey:`automation-${randomUUID()}`,acknowledged:true,sendAcknowledged:raw.sendAcknowledged===true},mode,keys);
      const included=new Set((await this.db.prepare('SELECT email_key FROM platform_email_pilot_recipients WHERE job_id=?').all(job.id) as {email_key:string}[]).map(item=>item.email_key));
      for(const item of sendable){const inJob=included.has(emailByEntity.get(entityKeyOf(item.entity_id))!);
        if(mode==='send'&&inJob){await update.run('sent',null,job.id,now,item.id);counts.sent++;}else if(mode==='rehearsal'&&inJob)counts.rehearsed++;else{await update.run('ready','pilot_limit',null,now,item.id);counts.held++;}}
      await this.run(row.id,mode,job.id,counts,now);await this.audit(`automation.approve.${mode}`);return {counts,job,snapshot:await this.read()};
    });
  }
  // Push / in-app: the ready people whose app registration has consent for the channel get one message job through the
  // app's own flow (preview, approval, live and broadcast switches, daily push limit). The others leave on a send.
  private async approveMobile(row:Row,definition:AutomationDefinition,ready:Enrollment[],mode:'rehearsal'|'send',acknowledged:boolean,now:string){
    const mobile=definition.mobile!,service=new MobileGrowth(this.db,this.scope,this.key),delivery=new MobileDelivery(service),counts={notSendable:0,sent:0,held:0,rehearsed:0};
    const contactsOf=async (ids:string[])=>{const keys=new Map(ids.map(id=>{try{return [mobileEntity(this.key,mobile.appId,id),id] as const;}catch{return ['',id] as const;}}));
      const found=new Set<string>();for(const [key,id] of keys){if(!key)continue;const has=await this.db.prepare(`SELECT 1 FROM platform_mobile_contacts WHERE app_id=? AND organization_id=? AND project_id=? AND entity_key=? AND ${definition.channel==='push'?'push_consent=1':'in_app_consent=1'} LIMIT 1`).get(mobile.appId,...this.args(),key);if(has)found.add(id);}return found;};
    const reachable=await contactsOf(ready.map(item=>item.entity_id)),update=this.db.prepare('UPDATE platform_automation_enrollments SET state=?,reason=?,job_id=?,updated_at=? WHERE id=?');
    const sendable=await filterSeries(ready, async item=>{const ok=reachable.has(item.entity_id);if(!ok&&mode==='send'){await update.run('exited','not_sendable',null,now,item.id);counts.notSendable++;}return ok;});
    if(!sendable.length){if(mode==='send')await this.run(row.id,mode,null,counts,now);return {counts,job:null,snapshot:await this.read()};}
    const input={appId:mobile.appId,connectionId:mobile.connectionId,campaignId:definition.campaignId,channel:definition.channel,mode:mode==='send'?'live':'rehearsal',path:'/',audience:'entities',entityIds:sendable.map(item=>item.entity_id),expiresAt:new Date(Date.parse(now)+2*DAY).toISOString()};
    const preview=await delivery.preview(input),job=await delivery.enqueue({...input,expectedDigest:preview.digest,idempotencyKey:randomUUID(),acknowledged});
    for(const item of sendable){if(mode==='send'){await update.run('sent',null,job.id,now,item.id);counts.sent++;}else counts.rehearsed++;}
    await this.run(row.id,mode,job.id,counts,now);await this.audit(`automation.approve.${mode}`);return {counts,job,snapshot:await this.read()};
  }
  private async run(id:string,mode:'rehearsal'|'send',jobId:string|null,counts:Record<string,number>,at:string){await this.db.prepare("INSERT INTO platform_automation_runs(id,automation_id,organization_id,project_id,kind,mode,actor_id,job_id,counts_json,created_at) VALUES(?,?,?,?,'approve',?,?,?,?,?)").run(`autorun_${randomUUID()}`,id,...this.args(),mode,this.scope.subject,jobId,JSON.stringify(counts),at);}
  // Apps and their push / in-app connections, for a push or in-app automation (empty without the mobile module).
  private async mobileOptions():Promise<AutomationsSnapshot['mobile']>{
    try{const service=new MobileGrowth(this.db,this.scope,this.key),apps=await service.apps();
      return {apps:apps.map(app=>({id:app.id,name:app.name})),connections:await flatMapSeries(apps, async app=>(await service.integrations(app.id)).filter(item=>item.active&&['onesignal','firebase','bridge'].includes(item.provider)).map(item=>({id:item.id,appId:app.id,provider:item.provider})))};}
    catch{return {apps:[],connections:[]};}
  }
  async read():Promise<AutomationsSnapshot>{
    await this.authorize();const rows=await this.db.prepare('SELECT * FROM platform_automations WHERE organization_id=? AND project_id=? ORDER BY created_at,id').all(...this.args()) as Row[];
    const store=new ProjectMarketingStore(this.db,this.scope),allCampaigns=await store.listCampaigns(),campaigns=allCampaigns.filter(item=>item.channels.email),reviews=await this.can('content.write')?new CampaignReviews(this.db,this.scope,this.key):null;
    const segments=await this.db.prepare('SELECT s.id,s.name,s.version,v.source_id FROM platform_segments s JOIN platform_segment_versions v ON v.segment_id=s.id AND v.version=s.version WHERE s.organization_id=? AND s.project_id=? AND s.archived=0 ORDER BY s.name').all(...this.args()) as {id:string;name:string;version:number;source_id:string}[];
    const automations=await mapSeries(rows, async (row):Promise<AutomationView>=>{
      const definition=this.definition(row),counts={waiting:0,ready:0,sent:0,exited:0} as Record<EnrollmentState,number>,reasons:Record<string,number>={};
      for(const item of await this.db.prepare('SELECT state,reason,COUNT(*) n FROM platform_automation_enrollments WHERE automation_id=? GROUP BY state,reason').all(row.id) as {state:EnrollmentState;reason:string|null;n:number}[]){counts[item.state]+=item.n;if(item.reason)reasons[item.reason]=(reasons[item.reason]||0)+item.n;}
      const runs=(await this.db.prepare('SELECT kind,mode,job_id,counts_json,created_at FROM platform_automation_runs WHERE automation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 5').all(row.id) as {kind:'evaluate'|'approve';mode:'rehearsal'|'send'|null;job_id:string|null;counts_json:string;created_at:string}[]).map(item=>({kind:item.kind,mode:item.mode,createdAt:item.created_at,counts:JSON.parse(item.counts_json),jobId:item.job_id}));
      return {...definition,id:row.id,state:row.state,revision:row.revision,sourceId:row.source_id,activatedAt:row.activated_at,lastEvaluatedAt:row.last_evaluated_at,updatedAt:row.updated_at,counts,reasons,runs,
        campaignName:allCampaigns.find(item=>item.id===definition.campaignId)?.name||null,segmentName:definition.trigger.kind==='segment'?segments.find(item=>item.id===(definition.trigger as {segmentId:string}).segmentId)?.name||null:null};
    });
    const sources=await this.can('content.write')?(await new ProductSegments(this.db,this.scope).sources()).map(item=>({id:item.id,name:item.name,eventNames:item.eventNames})):[];
    return {automations,segments:segments.map(item=>({id:item.id,name:item.name,version:item.version,sourceId:item.source_id})),sources,
      campaigns:[...await mapSeries(campaigns, async item=>{let approval='none';try{approval=reviews?(await reviews.get(item.id)).approval:'none';}catch{approval='none';}return {id:item.id,name:item.name,sourceId:item.segmentBinding?.sourceId||null,approval,email:true};}),
        ...allCampaigns.filter(item=>!item.channels.email&&item.status==='draft').map(item=>({id:item.id,name:item.name,sourceId:item.segmentBinding?.sourceId||null,approval:'none',email:false}))],
      mobile:await this.mobileOptions(),
      canWrite:await this.can('content.write'),canActivate:await this.can('campaign.approve'),canApprove:await this.canApprove(),sendingEnabled:(await new SesProvider(this.db,this.scope,this.key).state()).ready};
  }
}
const emailEntityKey=(scope:MarketingScope,key:string,sourceId:string,entityId:string)=>emailIdentity(scope,key,'entity',[sourceId,entityId]);
// Worker step: keeps active automations' enrollments current (no sends). The activator's rights are re-checked;
// without them the automation is paused.
export async function evaluateDueAutomations(db:Db,key:string,everyMs=6*3600000,limit=3){
  const cutoff=new Date(Date.now()-everyMs).toISOString(),rows=await db.prepare("SELECT id,organization_id,project_id,activated_by FROM platform_automations WHERE state='active' AND (last_evaluated_at IS NULL OR last_evaluated_at<?) ORDER BY last_evaluated_at LIMIT ?").all(cutoff,limit) as {id:string;organization_id:string;project_id:string;activated_by:string}[];
  let evaluated=0;
  for(const row of rows){
    const automations=new ProjectAutomations(db,{subject:row.activated_by,organizationId:row.organization_id,projectId:row.project_id},key);
    try{await automations.evaluate({id:row.id});evaluated++;}
    // Lost rights pause the rule; other errors (e.g. a stale source) are retried next tick without skipping any events.
    catch(error){if(error instanceof MarketingStoreError&&error.status===403)await db.prepare("UPDATE platform_automations SET state='paused',revision=revision+1,updated_at=? WHERE id=? AND state='active'").run(new Date().toISOString(),row.id);}
  }
  return evaluated;
}
