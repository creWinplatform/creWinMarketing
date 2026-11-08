import { everySeries, flatMapSeries, mapSeries } from '../db/async-array';
import type { Db } from '../db/client';
import 'server-only';
import { randomUUID,createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { MobileGrowth,mobileRevision } from './mobile-store';
import { MarketingStoreError } from './errors';
import { encryptCredentials,decryptCredentials } from './credential-envelope';
import { assertProjectWork,assertProjectDelivery } from './entitlements';
import { ProjectOperations } from './operations';
import { mobileDate,mobileId,mobilePath,mobileText } from './mobile-validation';
import { mobileEntity,recordMobileEvents } from './mobile-ingestion';
import { sendMobilePush } from './mobile-providers';
import type { MobileMessage } from './mobile-types';
import { ProductSegments } from './segments';
import type { SegmentEntity } from './segment-engine';

type Contact={id:string;entity_key:string;provider:string;encrypted_destination:string;push_consent:number;in_app_consent:number;allow_pilot:number;updated_at:string};
// audience: "pilot" is the original 1-5 allowlisted contacts. "all", "segment" and "entities" (an automation's ready
// people) reach every contact with consent for the channel, up to MOBILE_AUDIENCE_MAX; a live send to them also needs
// PLATFORM_MOBILE_BROADCAST_ENABLED=1. Pushes per project per day: PLATFORM_MOBILE_PUSH_PER_DAY (default 5, the pilot).
export type MobileAudience='pilot'|'all'|'segment'|'entities';
type Intent={appId:string;appRevision:string;campaignId:string;campaignDigest:string;connectionId:string;connectionRevision:string;provider:string;channel:'push'|'in_app';mode:'live'|'rehearsal';title:string;body:string;path:string;scheduledAt:string|null;expiresAt:string;targets:{id:string;revision:string}[];audience?:MobileAudience;segment?:{id:string;version:number}|null};
export const MOBILE_AUDIENCE_MAX=1000;
export const mobileBroadcastEnabled=()=>process.env.PLATFORM_MOBILE_BROADCAST_ENABLED==='1';
export const mobilePushPerDay=()=>{const value=Number(process.env.PLATFORM_MOBILE_PUSH_PER_DAY||5);return Number.isSafeInteger(value)&&value>=1&&value<=10000?value:5;};
// A pilot target is fixed with its allowlist flag; a broad audience only with its destination and consent.
const targetRevision=(audience:MobileAudience,row:Contact)=>mobileRevision(JSON.stringify(audience==='pilot'?[row.encrypted_destination,row.push_consent,row.in_app_consent,row.allow_pilot]:[row.encrypted_destination,row.push_consent,row.in_app_consent]));
type Row={id:string;organization_id:string;project_id:string;actor_id:string;connection_id:string;status:string;state:string;app_id:string;campaign_id:string;channel:string;mode:string;scheduled_at:string;expires_at:string;source_digest:string;encrypted_snapshot:string;reason:string|null;created_at:string;task_id:string|null};
const query="SELECT j.id,j.actor_id,j.connection_id,j.status,j.created_at,m.* FROM platform_jobs j JOIN platform_mobile_messages m ON m.job_id=j.id AND m.organization_id=j.organization_id AND m.project_id=j.project_id WHERE j.job_type='mobile.message' AND j.organization_id=? AND j.project_id=?";
type PushSender=typeof sendMobilePush;
export class MobileDelivery {
  constructor(public service:MobileGrowth){}
  private args(){return this.service.args();}
  private async authorize(){await this.service.authorize('connections.manage');await this.service.authorize('campaign.approve');await this.service.authorize('campaign.dispatch');}
  private async row(id:string){const row=await this.service.db.prepare(query+' AND j.id=?').get(...this.args(),mobileId(id)) as Row|undefined;if(!row)throw new MarketingStoreError('Mobil gönderim bulunamadı.',404);return row;}
  private snapshot(row:Row){return decryptCredentials<Intent>(row.encrypted_snapshot,this.service.key,...this.args(),`mobile-message:${row.id}`);}
  async contacts(appId:string){await this.service.authorize('connections.manage');await this.service.rawApp(appId);return (await this.service.db.prepare('SELECT id,provider,push_consent,in_app_consent,allow_pilot,updated_at FROM platform_mobile_contacts WHERE app_id=? AND organization_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 100').all(appId,...this.args()) as Contact[]).map(row=>({id:row.id,reference:row.id.slice(-8),provider:row.provider,pushConsent:Boolean(row.push_consent),inAppConsent:Boolean(row.in_app_consent),pilot:Boolean(row.allow_pilot),updatedAt:row.updated_at}));}
  async setPilot(appId:string,id:string,enabled:boolean){await this.service.authorize('recipients.manage');await this.service.authorize('connections.manage');await this.service.rawApp(appId);if(typeof enabled!=='boolean')throw new MarketingStoreError('Pilot seçimi gerekli.');const contact=await this.service.db.prepare('SELECT * FROM platform_mobile_contacts WHERE id=? AND app_id=? AND organization_id=? AND project_id=?').get(id,appId,...this.args()) as Contact|undefined;if(!contact||enabled&&!contact.push_consent&&!contact.in_app_consent)throw new MarketingStoreError('İzinli mobil alıcı bulunamadı.',409);await this.service.db.prepare('UPDATE platform_mobile_contacts SET allow_pilot=? WHERE id=?').run(Number(enabled),id);await this.service.audit('mobile.pilot.allowlist');return await this.contacts(appId);}
  private async intent(raw:Record<string,unknown>):Promise<Intent> {
    await this.authorize();await assertProjectWork(this.service.db,this.service.scope);
    const app=await this.service.app(String(raw.appId)),connection=await this.service.integration(String(raw.connectionId)),channel=raw.channel,mode=raw.mode;
    if(connection.app_id!==app.id||!connection.active||!['push','in_app'].includes(String(channel))||!['rehearsal','live'].includes(String(mode))||!(channel==='push'?['onesignal','firebase'].includes(connection.kind):connection.kind==='bridge'))throw new MarketingStoreError('Uygulama, kanal veya sağlayıcı eşleşmiyor.');
    const campaign=await this.service.store.campaign(String(raw.campaignId));if(!campaign||campaign.status!=='draft')throw new MarketingStoreError('Kampanya taslağı bulunamadı.',404);
    const title=(campaign.content.subject||campaign.name).trim(),body=campaign.content.text.trim();if(!title||title.length>100||!body||body.length>1000||/\{\{[\s\S]*?\}\}/.test(title+body))throw new MarketingStoreError('Kampanyada en fazla 100 karakter başlık ve 1000 karakter değişkensiz mesaj gerekli.');
    const audience:MobileAudience=['all','segment','entities'].includes(String(raw.audience))?raw.audience as MobileAudience:'pilot';
    let segment:Intent['segment']=null,contacts:{id:string;revision:string}[];
    if(audience!=='pilot'){
      const consented=`SELECT * FROM platform_mobile_contacts WHERE app_id=? AND organization_id=? AND project_id=? AND ${channel==='push'?'push_consent=1 AND provider=?':'in_app_consent=1'}`,params=[app.id,...this.args(),...(channel==='push'?[connection.kind]:[])];
      let rows:Contact[];
      if(audience==='all')rows=await this.service.db.prepare(`${consented} ORDER BY updated_at DESC LIMIT ?`).all(...params,MOBILE_AUDIENCE_MAX+1) as Contact[];
      else{
        let ids:string[];
        if(audience==='segment'){const version=Number(raw.segmentVersion),members:SegmentEntity[]=[];if(typeof raw.segmentId!=='string'||!Number.isSafeInteger(version))throw new MarketingStoreError('Segment ve sürümü gerekli.');
          await new ProductSegments(this.service.db,this.service.scope).evaluateSaved(raw.segmentId,version,members);segment={id:raw.segmentId,version};ids=members.map(item=>item.id);}
        else{if(!Array.isArray(raw.entityIds)||raw.entityIds.length>MOBILE_AUDIENCE_MAX)throw new MarketingStoreError('Kişi listesi geçersiz.');ids=raw.entityIds.map(String);}
        const keys=[...new Set(ids.flatMap(id=>{try{return [mobileEntity(this.service.key,app.id,id)];}catch{return [];}}))];rows=[];
        for(let i=0;i<keys.length;i+=400){const chunk=keys.slice(i,i+400);rows.push(...await this.service.db.prepare(`${consented} AND entity_key IN (${chunk.map(()=>'?').join(',')})`).all(...params,...chunk) as Contact[]);}
      }
      // One device per person: the most recently updated registration.
      const byPerson=new Map<string,Contact>();for(const row of rows){const old=byPerson.get(row.entity_key);if(!old||old.updated_at<row.updated_at)byPerson.set(row.entity_key,row);}
      if(!byPerson.size)throw new MarketingStoreError('Bu kitlede kanala izin vermiş alıcı yok.',409);
      if(byPerson.size>MOBILE_AUDIENCE_MAX)throw new MarketingStoreError('Bir mesaj en çok 1.000 alıcıya gidebilir; kitleyi daraltın.',429);
      contacts=[...byPerson.values()].map(row=>({id:row.id,revision:targetRevision(audience,row)})).sort((a,b)=>a.id.localeCompare(b.id));
    }else{
    if(!Array.isArray(raw.contactIds)||raw.contactIds.length<1||raw.contactIds.length>5||new Set(raw.contactIds).size!==raw.contactIds.length)throw new MarketingStoreError('1-5 benzersiz pilot alıcı seçin.');
    const identities=new Set<string>();
    contacts=(await mapSeries(raw.contactIds, async value=>{const id=mobileId(value),contact=await this.service.db.prepare('SELECT * FROM platform_mobile_contacts WHERE id=? AND app_id=? AND organization_id=? AND project_id=?').get(id,app.id,...this.args()) as Contact|undefined;if(!contact||!contact.allow_pilot||!(channel==='push'?contact.push_consent&&contact.provider===connection.kind:contact.in_app_consent))throw new MarketingStoreError('Alıcı izni veya pilot allowlist kaydı eksik.',409);if(identities.has(contact.entity_key))throw new MarketingStoreError('Aynı kullanıcı için tek cihaz/sağlayıcı kaydı seçin.');identities.add(contact.entity_key);return {id,revision:targetRevision('pilot',contact)};})).sort((a,b)=>a.id.localeCompare(b.id));
    }
    const scheduledAt=raw.scheduledAt?mobileDate(raw.scheduledAt):null,expiresAt=mobileDate(raw.expiresAt);
    if(scheduledAt&&(Date.parse(scheduledAt)<Date.now()-60000||Date.parse(scheduledAt)>Date.now()+30*86400000)||Date.parse(expiresAt)<(scheduledAt?Date.parse(scheduledAt):Date.now())+60000||Date.parse(expiresAt)>(scheduledAt?Date.parse(scheduledAt):Date.now())+7*86400000)throw new MarketingStoreError('Geçerli yayın zamanı ve en fazla 7 günlük bitiş seçin.');
    return {appId:app.id,appRevision:app.updatedAt,campaignId:campaign.id,campaignDigest:mobileRevision(JSON.stringify(campaign)),connectionId:connection.connection_id,connectionRevision:mobileRevision(connection.encrypted_credentials),provider:connection.kind,channel:channel as Intent['channel'],mode:mode as Intent['mode'],title,body,path:mobilePath(raw.path||'/'),scheduledAt,expiresAt,targets:contacts,...(audience==='pilot'?{}:{audience,segment})};
  }
  async preview(raw:Record<string,unknown>){const intent=await this.intent(raw);return {digest:mobileRevision(JSON.stringify(intent)),title:intent.title,body:intent.body,path:intent.path,targetCount:intent.targets.length,channel:intent.channel,provider:intent.provider,scheduledAt:intent.scheduledAt,expiresAt:intent.expiresAt,audience:intent.audience||'pilot',broadcastEnabled:mobileBroadcastEnabled()};}
  async enqueue(raw:Record<string,unknown>){
    await this.authorize();const idempotency=`mobile:${mobileId(raw.idempotencyKey)}`;
    return await this.service.db.transaction(async ()=>{
      const previous=await this.service.db.prepare(query+' AND j.idempotency_key=?').get(...this.args(),idempotency) as Row|undefined;if(previous){if(previous.source_digest!==raw.expectedDigest)throw new MarketingStoreError('İşlem anahtarı farklı önizlemeye ait.',409);return await this.describe(previous);}
      const intent=await this.intent(raw),digest=mobileRevision(JSON.stringify(intent));if(digest!==raw.expectedDigest)throw new MarketingStoreError('Önizleme değişti. Tekrar inceleyin.',409);
      if(intent.mode==='live'){await assertProjectDelivery(this.service.db,this.service.scope);if(process.env.PLATFORM_MOBILE_SEND_ENABLED!=='1'||raw.acknowledged!==true)throw new MarketingStoreError('Gerçek mobil gönderim kapalı veya onay eksik.',409);
        if(intent.audience&&intent.audience!=='pilot'&&!mobileBroadcastEnabled())throw new MarketingStoreError('Pilot dışı kitleye gerçek gönderim bu sunucuda kapalı.',409);}
      await this.service.quota('mobile_enqueue',20);const id=randomUUID(),now=new Date().toISOString(),scheduled=intent.scheduledAt||now;
      const task=await new ProjectOperations(this.service.db,this.service.scope).saveTask({title:`${intent.mode==='rehearsal'?'Prova':'Mobil'} · ${intent.title}`.slice(0,160),campaignId:intent.campaignId,dueAt:scheduled,status:'planned',note:`mobile-message:${id}\n${intent.channel} · ${intent.provider}`});
      await this.service.db.prepare("INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES(?,?,?,?,?,?,?,'queued',?,?,'mobile.message')").run(id,...this.args(),this.service.scope.subject,intent.connectionId,intent.connectionRevision,idempotency,now,now);
      await this.service.db.prepare('INSERT INTO platform_mobile_messages(job_id,organization_id,project_id,app_id,campaign_id,channel,mode,scheduled_at,expires_at,source_digest,encrypted_snapshot,task_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,...this.args(),intent.appId,intent.campaignId,intent.channel,intent.mode,scheduled,intent.expiresAt,digest,encryptCredentials(intent,this.service.key,...this.args(),`mobile-message:${id}`),task.id);
      for(const target of intent.targets)await this.service.db.prepare('INSERT INTO platform_mobile_deliveries(job_id,contact_id) VALUES(?,?)').run(id,target.id);
      await this.service.audit('mobile.message.approve');return await this.get(id);
    });
  }
  private async describe(row:Row):Promise<MobileMessage> {
    const intent=this.snapshot(row),counts=await this.service.db.prepare('SELECT state,COUNT(*) n FROM platform_mobile_deliveries WHERE job_id=? GROUP BY state').all(row.id) as {state:string;n:number}[],count=(state:string)=>counts.find(item=>item.state===state)?.n||0;
    return {id:row.id,appId:row.app_id,campaignId:row.campaign_id,channel:row.channel as MobileMessage['channel'],provider:intent.provider,mode:row.mode as MobileMessage['mode'],status:row.state,title:intent.title,body:intent.body,scheduledAt:row.scheduled_at,expiresAt:row.expires_at,targetCount:intent.targets.length,accepted:count('accepted'),failed:count('rejected')+count('blocked'),uncertain:count('uncertain')+count('submitted'),impressions:count('impression')+count('clicked')+count('dismissed'),clicks:count('clicked'),reason:row.reason,createdAt:row.created_at};
  }
  async get(id:string){await this.service.authorize();return await this.describe(await this.row(id));}
  async isCurrent(id:string){await this.service.authorize();const row=await this.row(id);try{await this.valid(this.snapshot(row),row.actor_id);return true;}catch{return false;}}
  async list(appId:string){await this.service.rawApp(appId);return await mapSeries((await this.service.db.prepare(query+' AND m.app_id=? ORDER BY j.created_at DESC LIMIT 50').all(...this.args(),appId) as Row[]), async row=>await this.describe(row));}
  async cancel(id:string){await this.authorize();const row=await this.row(id);await this.service.db.prepare("UPDATE platform_mobile_messages SET state='cancelled',reason='cancelled' WHERE job_id=?").run(id);await this.service.db.prepare("UPDATE platform_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(),id);if(row.task_id)await this.service.db.prepare("UPDATE platform_work_items SET status='cancelled' WHERE id=? AND organization_id=? AND project_id=?").run(row.task_id,...this.args());await this.service.audit('mobile.message.cancel');return await this.get(id);}
  private async valid(intent:Intent,actor:string){
    await this.authorize();for(const permission of ['connections.manage','campaign.approve','campaign.dispatch'] as const)if(!await this.service.repo.can(actor,...this.args(),permission))throw new Error('Approval authority lost.');
    const app=await this.service.app(intent.appId),connection=await this.service.integration(intent.connectionId),campaign=await this.service.store.campaign(intent.campaignId);
    if(app.updatedAt!==intent.appRevision||!connection.active||mobileRevision(connection.encrypted_credentials)!==intent.connectionRevision||!campaign||mobileRevision(JSON.stringify(campaign))!==intent.campaignDigest)throw new Error('Approval changed.');
    if(intent.mode==='live'){await assertProjectDelivery(this.service.db,this.service.scope);if(process.env.PLATFORM_MOBILE_SEND_ENABLED!=='1'||intent.audience&&intent.audience!=='pilot'&&!mobileBroadcastEnabled())throw new Error('Sending disabled.');}else await assertProjectWork(this.service.db,this.service.scope);
    return connection;
  }
  private async contact(intent:Intent,id:string){const target=intent.targets.find(item=>item.id===id),row=await this.service.db.prepare('SELECT * FROM platform_mobile_contacts WHERE id=? AND app_id=? AND organization_id=? AND project_id=?').get(id,intent.appId,...this.args()) as Contact|undefined;const audience=intent.audience||'pilot';if(!target||!row||audience==='pilot'&&!row.allow_pilot||!(intent.channel==='push'?row.push_consent&&row.provider===intent.provider:row.in_app_consent)||targetRevision(audience,row)!==target.revision)throw new Error('Recipient permission changed.');return row;}
  async process(id:string,sender:PushSender=sendMobilePush){
    await this.authorize();const lease=randomUUID(),started=Date.now(),row=await this.row(id),intent=this.snapshot(row);
    const claimed=await this.service.db.transaction(async ()=>{const now=new Date().toISOString(),job=await this.service.db.prepare('SELECT status,lease_until FROM platform_jobs WHERE id=?').get(id) as {status:string;lease_until:string|null};if(!['queued','running'].includes(job.status)||row.scheduled_at>now||job.status==='running'&&job.lease_until&&job.lease_until>now)return false;await this.service.db.prepare("UPDATE platform_mobile_deliveries SET state='uncertain' WHERE job_id=? AND state='submitted'").run(id);await this.service.db.prepare("UPDATE platform_jobs SET status='running',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=?").run(lease,new Date(Date.now()+60000).toISOString(),now,id);return true;});if(!claimed)return await this.get(id);
    const holder=async ()=>Boolean(await this.service.db.prepare("SELECT 1 FROM platform_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_until>?").get(id,lease,new Date().toISOString()));
    const finish=async (state:string,reason:string|null=null)=>{if(!await holder())return;await this.service.db.prepare('UPDATE platform_mobile_messages SET state=?,reason=? WHERE job_id=?').run(state,reason,id);await this.service.db.prepare('UPDATE platform_jobs SET status=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?').run(['rehearsed','active','accepted','partial'].includes(state)?'completed':'failed',new Date().toISOString(),id);if(row.task_id)await this.service.db.prepare('UPDATE platform_work_items SET status=? WHERE id=? AND organization_id=? AND project_id=?').run(['rehearsed','active','accepted'].includes(state)?'completed':'in_progress',row.task_id,...this.args());};
    try{
      const connection=await this.valid(intent,row.actor_id);if(Date.parse(row.expires_at)<=Date.now()){await finish('blocked','expired');return await this.get(id);}
      if(intent.mode==='rehearsal'){for(const target of intent.targets)await this.contact(intent,target.id);await finish('rehearsed');return await this.get(id);}
      if(intent.channel==='in_app'){await finish('active');return await this.get(id);}
      for(const target of intent.targets){
        if(Date.now()-started>25000)break;if(!await holder())return await this.get(id);await this.valid(intent,row.actor_id);
        const delivery=await this.service.db.prepare('SELECT state FROM platform_mobile_deliveries WHERE job_id=? AND contact_id=?').get(id,target.id) as {state:string};if(delivery.state!=='pending')continue;
        let contact:Contact;try{contact=await this.contact(intent,target.id);}catch{await this.service.db.prepare("UPDATE platform_mobile_deliveries SET state='blocked' WHERE job_id=? AND contact_id=?").run(id,target.id);continue;}
        const reserve=await this.service.db.transaction(async ()=>{if(!await holder())return false;await this.valid(intent,row.actor_id);await this.contact(intent,target.id);await this.service.quota('mobile_push',mobilePushPerDay());return Boolean((await this.service.db.prepare("UPDATE platform_mobile_deliveries SET state='submitted',submitted_at=? WHERE job_id=? AND contact_id=? AND state='pending'").run(new Date().toISOString(),id,target.id)).changes);});if(!reserve)continue;
        const destination=decryptCredentials<{destination:string}>(contact.encrypted_destination,this.service.key,...this.args(),`mobile-contact:${contact.id}`).destination;
        const rawId=createHash('sha256').update(`${id}:${contact.id}`).digest('hex').slice(0,32),idempotencyKey=`${rawId.slice(0,8)}-${rawId.slice(8,12)}-4${rawId.slice(13,16)}-a${rawId.slice(17,20)}-${rawId.slice(20)}`;
        const result=await sender({provider:intent.provider as 'firebase'|'onesignal',config:JSON.parse(connection.config_json),secret:this.service.secret(connection),destination,title:intent.title,body:intent.body,path:intent.path,idempotencyKey});
        if(!await holder())return await this.get(id);await this.service.db.prepare('UPDATE platform_mobile_deliveries SET state=?,provider_id=? WHERE job_id=? AND contact_id=? AND state=?').run(result.state,result.providerId||null,id,target.id,'submitted');
      }
      if(await holder()){
        const pending=(await this.service.db.prepare("SELECT COUNT(*) n FROM platform_mobile_deliveries WHERE job_id=? AND state='pending'").get(id) as {n:number}).n;
        if(pending){await this.service.db.prepare("UPDATE platform_jobs SET status='queued',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(),id);return await this.get(id);}
        const result=await this.describe(await this.row(id));await finish(result.uncertain?'uncertain':result.failed?'partial':'accepted');
      }
    }catch{await finish('blocked','changed_or_limit');}
    await this.service.audit('mobile.message.result');return await this.get(id);
  }
  async feed(appId:string,entityId:string){
    await assertProjectDelivery(this.service.db,this.service.scope);const app=await this.service.app(appId);if(process.env.PLATFORM_MOBILE_SEND_ENABLED!=='1')return {items:[]};
    const entityKey=mobileEntity(this.service.key,appId,entityId),rows=await this.service.db.prepare(query+" AND m.app_id=? AND m.channel='in_app' AND m.mode='live' AND m.state='active' AND m.scheduled_at<=? AND m.expires_at>? ORDER BY j.created_at DESC LIMIT 10").all(...this.args(),appId,new Date().toISOString(),new Date().toISOString()) as Row[];
    const items=[];for(const row of rows){try{const intent=this.snapshot(row);await this.valid(intent,row.actor_id);for(const target of intent.targets){const contact=await this.contact(intent,target.id);if(contact.entity_key!==entityKey)continue;const state=await this.service.db.prepare('SELECT state FROM platform_mobile_deliveries WHERE job_id=? AND contact_id=?').get(row.id,contact.id) as {state:string};if(!['pending','impression'].includes(state.state))continue;items.push({id:row.id,title:intent.title,body:intent.body,path:intent.path,expiresAt:row.expires_at});break;}}catch{}}
    return {items:items.slice(0,5),appId:app.id};
  }
  async feedback(appId:string,entityId:string,messageId:string,action:string){
    if(!['impression','clicked','dismissed'].includes(action))throw new MarketingStoreError('Uygulama içi geri bildirim geçersiz.');
    const row=await this.row(messageId);if(row.app_id!==appId||row.channel!=='in_app'||row.state!=='active'||row.expires_at<=new Date().toISOString())throw new MarketingStoreError('Aktif mesaj bulunamadı.',404);
    const intent=this.snapshot(row);await this.valid(intent,row.actor_id);const entityKey=mobileEntity(this.service.key,appId,entityId),contact=(await flatMapSeries(intent.targets, async target=>{try{return [await this.contact(intent,target.id)];}catch{return [];}})).find(item=>item.entity_key===entityKey);if(!contact)throw new MarketingStoreError('Mesaj alıcısı bulunamadı.',404);
    return await this.service.db.transaction(async ()=>{
      const prior=await this.service.db.prepare('SELECT state FROM platform_mobile_deliveries WHERE job_id=? AND contact_id=?').get(messageId,contact.id) as {state:string};if(prior.state===action||['clicked','dismissed'].includes(prior.state))return {recorded:false};
      await recordMobileEvents(this.service,await this.service.app(appId),'bridge',[{id:`${messageId}:${contact.id}:${action}`,entityId,occurredAt:new Date().toISOString(),kind:action==='impression'?'message_impression':action==='clicked'?'message_click':'message_dismiss',platform:(await this.service.app(appId)).platform,details:{identity:'customer',messageId,environment:'production'}}]);
      await this.service.db.prepare('UPDATE platform_mobile_deliveries SET state=? WHERE job_id=? AND contact_id=?').run(action,messageId,contact.id);return {recorded:true};
    });
  }
}
export async function settleUnauthorizedMobileJob(db:Db,service:MobileGrowth,id:string){
  const row=await db.prepare("SELECT actor_id FROM platform_jobs WHERE id=? AND organization_id=? AND project_id=? AND job_type='mobile.message' AND status IN ('queued','running')").get(id,...service.args()) as {actor_id:string}|undefined;
  if(!row||await everySeries((['connections.manage','campaign.approve','campaign.dispatch'] as const), async permission=>await service.repo.can(row.actor_id,...service.args(),permission)))return false;
  await db.prepare("UPDATE platform_jobs SET status='failed',lease_token=NULL,lease_until=NULL WHERE id=?").run(id);await db.prepare("UPDATE platform_mobile_messages SET state='blocked',reason='authority_lost' WHERE job_id=?").run(id);return true;
}
