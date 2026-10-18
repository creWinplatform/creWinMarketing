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

type Contact={id:string;entity_key:string;provider:string;encrypted_destination:string;push_consent:number;in_app_consent:number;allow_pilot:number;updated_at:string};
type Intent={appId:string;appRevision:string;campaignId:string;campaignDigest:string;connectionId:string;connectionRevision:string;provider:string;channel:'push'|'in_app';mode:'live'|'rehearsal';title:string;body:string;path:string;scheduledAt:string|null;expiresAt:string;targets:{id:string;revision:string}[]};
type Row={id:string;organization_id:string;project_id:string;actor_id:string;connection_id:string;status:string;state:string;app_id:string;campaign_id:string;channel:string;mode:string;scheduled_at:string;expires_at:string;source_digest:string;encrypted_snapshot:string;reason:string|null;created_at:string;task_id:string|null};
const query="SELECT j.id,j.actor_id,j.connection_id,j.status,j.created_at,m.* FROM platform_jobs j JOIN platform_mobile_messages m ON m.job_id=j.id AND m.organization_id=j.organization_id AND m.project_id=j.project_id WHERE j.job_type='mobile.message' AND j.organization_id=? AND j.project_id=?";
type PushSender=typeof sendMobilePush;
export class MobileDelivery {
  constructor(public service:MobileGrowth){}
  private args(){return this.service.args();}
  private authorize(){this.service.authorize('connections.manage');this.service.authorize('campaign.approve');this.service.authorize('campaign.dispatch');}
  private row(id:string){const row=this.service.db.prepare(query+' AND j.id=?').get(...this.args(),mobileId(id)) as Row|undefined;if(!row)throw new MarketingStoreError('Mobil gönderim bulunamadı.',404);return row;}
  private snapshot(row:Row){return decryptCredentials<Intent>(row.encrypted_snapshot,this.service.key,...this.args(),`mobile-message:${row.id}`);}
  contacts(appId:string){this.service.authorize('connections.manage');this.service.rawApp(appId);return (this.service.db.prepare('SELECT id,provider,push_consent,in_app_consent,allow_pilot,updated_at FROM platform_mobile_contacts WHERE app_id=? AND organization_id=? AND project_id=? ORDER BY updated_at DESC LIMIT 100').all(appId,...this.args()) as Contact[]).map(row=>({id:row.id,reference:row.id.slice(-8),provider:row.provider,pushConsent:Boolean(row.push_consent),inAppConsent:Boolean(row.in_app_consent),pilot:Boolean(row.allow_pilot),updatedAt:row.updated_at}));}
  setPilot(appId:string,id:string,enabled:boolean){this.service.authorize('recipients.manage');this.service.authorize('connections.manage');this.service.rawApp(appId);if(typeof enabled!=='boolean')throw new MarketingStoreError('Pilot seçimi gerekli.');const contact=this.service.db.prepare('SELECT * FROM platform_mobile_contacts WHERE id=? AND app_id=? AND organization_id=? AND project_id=?').get(id,appId,...this.args()) as Contact|undefined;if(!contact||enabled&&!contact.push_consent&&!contact.in_app_consent)throw new MarketingStoreError('İzinli mobil alıcı bulunamadı.',409);this.service.db.prepare('UPDATE platform_mobile_contacts SET allow_pilot=? WHERE id=?').run(Number(enabled),id);this.service.audit('mobile.pilot.allowlist');return this.contacts(appId);}
  private intent(raw:Record<string,unknown>):Intent {
    this.authorize();assertProjectWork(this.service.db,this.service.scope);
    const app=this.service.app(String(raw.appId)),connection=this.service.integration(String(raw.connectionId)),channel=raw.channel,mode=raw.mode;
    if(connection.app_id!==app.id||!connection.active||!['push','in_app'].includes(String(channel))||!['rehearsal','live'].includes(String(mode))||!(channel==='push'?['onesignal','firebase'].includes(connection.kind):connection.kind==='bridge'))throw new MarketingStoreError('Uygulama, kanal veya sağlayıcı eşleşmiyor.');
    const campaign=this.service.store.campaign(String(raw.campaignId));if(!campaign||campaign.status!=='draft')throw new MarketingStoreError('Kampanya taslağı bulunamadı.',404);
    const title=(campaign.content.subject||campaign.name).trim(),body=campaign.content.text.trim();if(!title||title.length>100||!body||body.length>1000||/\{\{[\s\S]*?\}\}/.test(title+body))throw new MarketingStoreError('Kampanyada en fazla 100 karakter başlık ve 1000 karakter değişkensiz mesaj gerekli.');
    if(!Array.isArray(raw.contactIds)||raw.contactIds.length<1||raw.contactIds.length>5||new Set(raw.contactIds).size!==raw.contactIds.length)throw new MarketingStoreError('1-5 benzersiz pilot alıcı seçin.');
    const identities=new Set<string>();
    const contacts=raw.contactIds.map(value=>{const id=mobileId(value),contact=this.service.db.prepare('SELECT * FROM platform_mobile_contacts WHERE id=? AND app_id=? AND organization_id=? AND project_id=?').get(id,app.id,...this.args()) as Contact|undefined;if(!contact||!contact.allow_pilot||!(channel==='push'?contact.push_consent&&contact.provider===connection.kind:contact.in_app_consent))throw new MarketingStoreError('Alıcı izni veya pilot allowlist kaydı eksik.',409);if(identities.has(contact.entity_key))throw new MarketingStoreError('Aynı kullanıcı için tek cihaz/sağlayıcı kaydı seçin.');identities.add(contact.entity_key);return {id,revision:mobileRevision(JSON.stringify([contact.encrypted_destination,contact.push_consent,contact.in_app_consent,contact.allow_pilot]))};}).sort((a,b)=>a.id.localeCompare(b.id));
    const scheduledAt=raw.scheduledAt?mobileDate(raw.scheduledAt):null,expiresAt=mobileDate(raw.expiresAt);
    if(scheduledAt&&(Date.parse(scheduledAt)<Date.now()-60000||Date.parse(scheduledAt)>Date.now()+30*86400000)||Date.parse(expiresAt)<(scheduledAt?Date.parse(scheduledAt):Date.now())+60000||Date.parse(expiresAt)>(scheduledAt?Date.parse(scheduledAt):Date.now())+7*86400000)throw new MarketingStoreError('Geçerli yayın zamanı ve en fazla 7 günlük bitiş seçin.');
    return {appId:app.id,appRevision:app.updatedAt,campaignId:campaign.id,campaignDigest:mobileRevision(JSON.stringify(campaign)),connectionId:connection.connection_id,connectionRevision:mobileRevision(connection.encrypted_credentials),provider:connection.kind,channel:channel as Intent['channel'],mode:mode as Intent['mode'],title,body,path:mobilePath(raw.path||'/'),scheduledAt,expiresAt,targets:contacts};
  }
  preview(raw:Record<string,unknown>){const intent=this.intent(raw);return {digest:mobileRevision(JSON.stringify(intent)),title:intent.title,body:intent.body,path:intent.path,targetCount:intent.targets.length,channel:intent.channel,provider:intent.provider,scheduledAt:intent.scheduledAt,expiresAt:intent.expiresAt};}
  enqueue(raw:Record<string,unknown>){
    this.authorize();const idempotency=`mobile:${mobileId(raw.idempotencyKey)}`;
    return this.service.db.transaction(()=>{
      const previous=this.service.db.prepare(query+' AND j.idempotency_key=?').get(...this.args(),idempotency) as Row|undefined;if(previous){if(previous.source_digest!==raw.expectedDigest)throw new MarketingStoreError('İşlem anahtarı farklı önizlemeye ait.',409);return this.describe(previous);}
      const intent=this.intent(raw),digest=mobileRevision(JSON.stringify(intent));if(digest!==raw.expectedDigest)throw new MarketingStoreError('Önizleme değişti. Tekrar inceleyin.',409);
      if(intent.mode==='live'){assertProjectDelivery(this.service.db,this.service.scope);if(process.env.PLATFORM_MOBILE_SEND_ENABLED!=='1'||raw.acknowledged!==true)throw new MarketingStoreError('Gerçek mobil gönderim kapalı veya onay eksik.',409);}
      this.service.quota('mobile_enqueue',20);const id=randomUUID(),now=new Date().toISOString(),scheduled=intent.scheduledAt||now;
      const task=new ProjectOperations(this.service.db,this.service.scope).saveTask({title:`${intent.mode==='rehearsal'?'Prova':'Mobil'} · ${intent.title}`.slice(0,160),campaignId:intent.campaignId,dueAt:scheduled,status:'planned',note:`mobile-message:${id}\n${intent.channel} · ${intent.provider}`});
      this.service.db.prepare("INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES(?,?,?,?,?,?,?,'queued',?,?,'mobile.message')").run(id,...this.args(),this.service.scope.subject,intent.connectionId,intent.connectionRevision,idempotency,now,now);
      this.service.db.prepare('INSERT INTO platform_mobile_messages(job_id,organization_id,project_id,app_id,campaign_id,channel,mode,scheduled_at,expires_at,source_digest,encrypted_snapshot,task_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,...this.args(),intent.appId,intent.campaignId,intent.channel,intent.mode,scheduled,intent.expiresAt,digest,encryptCredentials(intent,this.service.key,...this.args(),`mobile-message:${id}`),task.id);
      for(const target of intent.targets)this.service.db.prepare('INSERT INTO platform_mobile_deliveries(job_id,contact_id) VALUES(?,?)').run(id,target.id);
      this.service.audit('mobile.message.approve');return this.get(id);
    }).immediate();
  }
  private describe(row:Row):MobileMessage {
    const intent=this.snapshot(row),counts=this.service.db.prepare('SELECT state,COUNT(*) n FROM platform_mobile_deliveries WHERE job_id=? GROUP BY state').all(row.id) as {state:string;n:number}[],count=(state:string)=>counts.find(item=>item.state===state)?.n||0;
    return {id:row.id,appId:row.app_id,campaignId:row.campaign_id,channel:row.channel as MobileMessage['channel'],provider:intent.provider,mode:row.mode as MobileMessage['mode'],status:row.state,title:intent.title,body:intent.body,scheduledAt:row.scheduled_at,expiresAt:row.expires_at,targetCount:intent.targets.length,accepted:count('accepted'),failed:count('rejected')+count('blocked'),uncertain:count('uncertain')+count('submitted'),impressions:count('impression')+count('clicked')+count('dismissed'),clicks:count('clicked'),reason:row.reason,createdAt:row.created_at};
  }
  get(id:string){this.service.authorize();return this.describe(this.row(id));}
  isCurrent(id:string){this.service.authorize();const row=this.row(id);try{this.valid(this.snapshot(row),row.actor_id);return true;}catch{return false;}}
  list(appId:string){this.service.rawApp(appId);return (this.service.db.prepare(query+' AND m.app_id=? ORDER BY j.created_at DESC LIMIT 50').all(...this.args(),appId) as Row[]).map(row=>this.describe(row));}
  cancel(id:string){this.authorize();const row=this.row(id);this.service.db.prepare("UPDATE platform_mobile_messages SET state='cancelled',reason='cancelled' WHERE job_id=?").run(id);this.service.db.prepare("UPDATE platform_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(),id);if(row.task_id)this.service.db.prepare("UPDATE platform_work_items SET status='cancelled' WHERE id=? AND organization_id=? AND project_id=?").run(row.task_id,...this.args());this.service.audit('mobile.message.cancel');return this.get(id);}
  private valid(intent:Intent,actor:string){
    this.authorize();for(const permission of ['connections.manage','campaign.approve','campaign.dispatch'] as const)if(!this.service.repo.can(actor,...this.args(),permission))throw new Error('Approval authority lost.');
    const app=this.service.app(intent.appId),connection=this.service.integration(intent.connectionId),campaign=this.service.store.campaign(intent.campaignId);
    if(app.updatedAt!==intent.appRevision||!connection.active||mobileRevision(connection.encrypted_credentials)!==intent.connectionRevision||!campaign||mobileRevision(JSON.stringify(campaign))!==intent.campaignDigest)throw new Error('Approval changed.');
    if(intent.mode==='live'){assertProjectDelivery(this.service.db,this.service.scope);if(process.env.PLATFORM_MOBILE_SEND_ENABLED!=='1')throw new Error('Sending disabled.');}else assertProjectWork(this.service.db,this.service.scope);
    return connection;
  }
  private contact(intent:Intent,id:string){const target=intent.targets.find(item=>item.id===id),row=this.service.db.prepare('SELECT * FROM platform_mobile_contacts WHERE id=? AND app_id=? AND organization_id=? AND project_id=?').get(id,intent.appId,...this.args()) as Contact|undefined;if(!target||!row||!row.allow_pilot||!(intent.channel==='push'?row.push_consent&&row.provider===intent.provider:row.in_app_consent)||mobileRevision(JSON.stringify([row.encrypted_destination,row.push_consent,row.in_app_consent,row.allow_pilot]))!==target.revision)throw new Error('Recipient permission changed.');return row;}
  async process(id:string,sender:PushSender=sendMobilePush){
    this.authorize();const lease=randomUUID(),started=Date.now(),row=this.row(id),intent=this.snapshot(row);
    const claimed=this.service.db.transaction(()=>{const now=new Date().toISOString(),job=this.service.db.prepare('SELECT status,lease_until FROM platform_jobs WHERE id=?').get(id) as {status:string;lease_until:string|null};if(!['queued','running'].includes(job.status)||row.scheduled_at>now||job.status==='running'&&job.lease_until&&job.lease_until>now)return false;this.service.db.prepare("UPDATE platform_mobile_deliveries SET state='uncertain' WHERE job_id=? AND state='submitted'").run(id);this.service.db.prepare("UPDATE platform_jobs SET status='running',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=?").run(lease,new Date(Date.now()+60000).toISOString(),now,id);return true;}).immediate();if(!claimed)return this.get(id);
    const holder=()=>Boolean(this.service.db.prepare("SELECT 1 FROM platform_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_until>?").get(id,lease,new Date().toISOString()));
    const finish=(state:string,reason:string|null=null)=>{if(!holder())return;this.service.db.prepare('UPDATE platform_mobile_messages SET state=?,reason=? WHERE job_id=?').run(state,reason,id);this.service.db.prepare('UPDATE platform_jobs SET status=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?').run(['rehearsed','active','accepted','partial'].includes(state)?'completed':'failed',new Date().toISOString(),id);if(row.task_id)this.service.db.prepare('UPDATE platform_work_items SET status=? WHERE id=? AND organization_id=? AND project_id=?').run(['rehearsed','active','accepted'].includes(state)?'completed':'in_progress',row.task_id,...this.args());};
    try{
      const connection=this.valid(intent,row.actor_id);if(Date.parse(row.expires_at)<=Date.now()){finish('blocked','expired');return this.get(id);}
      if(intent.mode==='rehearsal'){for(const target of intent.targets)this.contact(intent,target.id);finish('rehearsed');return this.get(id);}
      if(intent.channel==='in_app'){finish('active');return this.get(id);}
      for(const target of intent.targets){
        if(Date.now()-started>25000)break;if(!holder())return this.get(id);this.valid(intent,row.actor_id);
        const delivery=this.service.db.prepare('SELECT state FROM platform_mobile_deliveries WHERE job_id=? AND contact_id=?').get(id,target.id) as {state:string};if(delivery.state!=='pending')continue;
        let contact:Contact;try{contact=this.contact(intent,target.id);}catch{this.service.db.prepare("UPDATE platform_mobile_deliveries SET state='blocked' WHERE job_id=? AND contact_id=?").run(id,target.id);continue;}
        const reserve=this.service.db.transaction(()=>{if(!holder())return false;this.valid(intent,row.actor_id);this.contact(intent,target.id);this.service.quota('mobile_push',5);return Boolean(this.service.db.prepare("UPDATE platform_mobile_deliveries SET state='submitted',submitted_at=? WHERE job_id=? AND contact_id=? AND state='pending'").run(new Date().toISOString(),id,target.id).changes);}).immediate();if(!reserve)continue;
        const destination=decryptCredentials<{destination:string}>(contact.encrypted_destination,this.service.key,...this.args(),`mobile-contact:${contact.id}`).destination;
        const rawId=createHash('sha256').update(`${id}:${contact.id}`).digest('hex').slice(0,32),idempotencyKey=`${rawId.slice(0,8)}-${rawId.slice(8,12)}-4${rawId.slice(13,16)}-a${rawId.slice(17,20)}-${rawId.slice(20)}`;
        const result=await sender({provider:intent.provider as 'firebase'|'onesignal',config:JSON.parse(connection.config_json),secret:this.service.secret(connection),destination,title:intent.title,body:intent.body,path:intent.path,idempotencyKey});
        if(!holder())return this.get(id);this.service.db.prepare('UPDATE platform_mobile_deliveries SET state=?,provider_id=? WHERE job_id=? AND contact_id=? AND state=?').run(result.state,result.providerId||null,id,target.id,'submitted');
      }
      if(holder()){
        const pending=(this.service.db.prepare("SELECT COUNT(*) n FROM platform_mobile_deliveries WHERE job_id=? AND state='pending'").get(id) as {n:number}).n;
        if(pending){this.service.db.prepare("UPDATE platform_jobs SET status='queued',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(),id);return this.get(id);}
        const result=this.describe(this.row(id));finish(result.uncertain?'uncertain':result.failed?'partial':'accepted');
      }
    }catch{finish('blocked','changed_or_limit');}
    this.service.audit('mobile.message.result');return this.get(id);
  }
  feed(appId:string,entityId:string){
    assertProjectDelivery(this.service.db,this.service.scope);const app=this.service.app(appId);if(process.env.PLATFORM_MOBILE_SEND_ENABLED!=='1')return {items:[]};
    const entityKey=mobileEntity(this.service.key,appId,entityId),rows=this.service.db.prepare(query+" AND m.app_id=? AND m.channel='in_app' AND m.mode='live' AND m.state='active' AND m.scheduled_at<=? AND m.expires_at>? ORDER BY j.created_at DESC LIMIT 10").all(...this.args(),appId,new Date().toISOString(),new Date().toISOString()) as Row[];
    const items=[];for(const row of rows){try{const intent=this.snapshot(row);this.valid(intent,row.actor_id);for(const target of intent.targets){const contact=this.contact(intent,target.id);if(contact.entity_key!==entityKey)continue;const state=this.service.db.prepare('SELECT state FROM platform_mobile_deliveries WHERE job_id=? AND contact_id=?').get(row.id,contact.id) as {state:string};if(!['pending','impression'].includes(state.state))continue;items.push({id:row.id,title:intent.title,body:intent.body,path:intent.path,expiresAt:row.expires_at});break;}}catch{}}
    return {items:items.slice(0,5),appId:app.id};
  }
  feedback(appId:string,entityId:string,messageId:string,action:string){
    if(!['impression','clicked','dismissed'].includes(action))throw new MarketingStoreError('Uygulama içi geri bildirim geçersiz.');
    const row=this.row(messageId);if(row.app_id!==appId||row.channel!=='in_app'||row.state!=='active'||row.expires_at<=new Date().toISOString())throw new MarketingStoreError('Aktif mesaj bulunamadı.',404);
    const intent=this.snapshot(row);this.valid(intent,row.actor_id);const entityKey=mobileEntity(this.service.key,appId,entityId),contact=intent.targets.flatMap(target=>{try{return [this.contact(intent,target.id)];}catch{return [];}}).find(item=>item.entity_key===entityKey);if(!contact)throw new MarketingStoreError('Mesaj alıcısı bulunamadı.',404);
    return this.service.db.transaction(()=>{
      const prior=this.service.db.prepare('SELECT state FROM platform_mobile_deliveries WHERE job_id=? AND contact_id=?').get(messageId,contact.id) as {state:string};if(prior.state===action||['clicked','dismissed'].includes(prior.state))return {recorded:false};
      recordMobileEvents(this.service,this.service.app(appId),'bridge',[{id:`${messageId}:${contact.id}:${action}`,entityId,occurredAt:new Date().toISOString(),kind:action==='impression'?'message_impression':action==='clicked'?'message_click':'message_dismiss',platform:this.service.app(appId).platform,details:{identity:'customer',messageId,environment:'production'}}]);
      this.service.db.prepare('UPDATE platform_mobile_deliveries SET state=? WHERE job_id=? AND contact_id=?').run(action,messageId,contact.id);return {recorded:true};
    }).immediate();
  }
}
export function settleUnauthorizedMobileJob(db:Database.Database,service:MobileGrowth,id:string){
  const row=db.prepare("SELECT actor_id FROM platform_jobs WHERE id=? AND organization_id=? AND project_id=? AND job_type='mobile.message' AND status IN ('queued','running')").get(id,...service.args()) as {actor_id:string}|undefined;
  if(!row||(['connections.manage','campaign.approve','campaign.dispatch'] as const).every(permission=>service.repo.can(row.actor_id,...service.args(),permission)))return false;
  db.prepare("UPDATE platform_jobs SET status='failed',lease_token=NULL,lease_until=NULL WHERE id=?").run(id);db.prepare("UPDATE platform_mobile_messages SET state='blocked',reason='authority_lost' WHERE job_id=?").run(id);return true;
}
