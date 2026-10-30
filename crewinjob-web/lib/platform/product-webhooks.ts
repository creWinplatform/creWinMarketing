import 'server-only';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ProductDataSources } from './product-data';
import { PlatformRepository } from './repository';
import { ProjectMarketingStore, MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials, type StoredCredentials } from './credential-envelope';
import { PRODUCT_SOURCE_LIMITS, type ProductPreview } from './product-data-types';
import { normalizeProductRecords, productTimestamp, writeProductRecords, type ProductRecord } from './product-records';
import { normalizeWebhookConfig, WEBHOOK_LIMITS, type WebhookConfig, type WebhookEventSample, type WebhookSource } from './product-webhook-types';
import { recordEmailOptOut } from './email-safety';
import { queueIysConsent } from './iys';
import { normalizeAttribution, recordAttribution } from './attribution';
import type { AttributionTouch } from './attribution-types';

type Row={connection_id:string;organization_id:string;project_id:string;version:number;config_json:string;enabled:number;paused:number;preview_at:string|null;preview_revision:string|null;last_synced_at:string|null;webhook_actor_id:string|null;account_name:string;active:number;encrypted_credentials:string;integration_id:string};
type Consent={channel:'email';status:'opted_in'|'opted_out';evidenceRef:string;recordedAt:string};
type Event={id:string;eventName:string;record:ProductRecord;consent:Consent|null;touch:AttributionTouch|null;ignoredTouch:boolean;digest:string};
const dayMs=86400000,mask=(id:string)=>`...${id.slice(-4)}`;
const query=`SELECT s.*,c.account_name,c.active,c.encrypted_credentials,c.integration_id FROM platform_product_sources s JOIN platform_connections c ON c.id=s.connection_id AND c.organization_id=s.organization_id AND c.project_id=s.project_id JOIN platform_projects p ON p.id=s.project_id AND p.organization_id=s.organization_id WHERE c.provider='product_webhook' AND p.product_pack='standard'`;
const revision=(row:Row)=>createHash('sha256').update(JSON.stringify([row.version,row.config_json,row.encrypted_credentials])).digest('hex');
const authorized=(db:Database.Database,row:Row)=>Boolean(row.webhook_actor_id&&new PlatformRepository(db).can(row.webhook_actor_id,row.organization_id,row.project_id,'connections.manage'));
export class ProductWebhookError extends MarketingStoreError {
  constructor(public code:string,message:string,status=422){super(message,status);}
}
function parseEvents(payload:unknown,row:Row,retentionDays:number=WEBHOOK_LIMITS.retentionDays):{events:Event[];duplicates:number} {
  const raw=payload as Record<string,unknown>;
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.sourceVersion!==row.version)throw new ProductWebhookError('schema_version','Kaynak sürümü güncel değil.',409);
  if(!Array.isArray(raw.events)||raw.events.length<1||raw.events.length>WEBHOOK_LIMITS.batch)throw new ProductWebhookError('batch_size','Her istekte 1-20 olay gerekli.');
  const config=normalizeWebhookConfig(JSON.parse(row.config_json));
  const unique=new Map<string,Event>(),snapshots=new Map<string,string>();let duplicates=0;
  for(const [index,input] of raw.events.entries()){
    try{
      if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(input.id)||!config.eventNames.includes(input.eventName))throw new Error();
      if(!input.attributes||typeof input.attributes!=='object'||Array.isArray(input.attributes)||Object.keys(input.attributes).some(key=>!config.attributes.some(field=>field.key===key)))throw new Error();
      const parsed=normalizeProductRecords([input],{idPath:'entityId',updatedAtPath:'occurredAt',attributes:config.attributes.map(field=>({...field,path:`attributes.${field.key}`}))});
      if(parsed.errors.length)throw new Error();
      const record=parsed.records[0];
      if(Date.parse(record.observedAt)<Date.now()-retentionDays*dayMs)throw new Error();
      const snapshotKey=JSON.stringify([record.externalId,record.observedAt]),snapshot=JSON.stringify(record.attributes);
      if(snapshots.has(snapshotKey)&&snapshots.get(snapshotKey)!==snapshot)throw new ProductWebhookError('record_conflict','Aynı kayıt ve zamanda çelişen özellikler var.',409);
      snapshots.set(snapshotKey,snapshot);
      let consent:Consent|null=null;
      if(input.consent!==undefined){
        const claim=input.consent;
        if(!claim||typeof claim!=='object'||claim.channel!=='email'||!['opted_in','opted_out'].includes(claim.status)||typeof claim.evidenceRef!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/.test(claim.evidenceRef))throw new Error();
        const recordedAt=productTimestamp(claim.recordedAt);
        if(Date.parse(recordedAt)>Date.parse(record.observedAt)||Date.parse(recordedAt)<Date.parse(record.observedAt)-30*dayMs)throw new Error();
        consent={channel:'email',status:claim.status,evidenceRef:claim.evidenceRef,recordedAt};
      }
      // The first tagged link the person arrived through. A malformed one is dropped, never the event; events without it
      // keep the digest they always had.
      const {touch,invalid}=normalizeAttribution(input.attribution,record.observedAt);
      const digest=createHash('sha256').update(JSON.stringify(touch?[input.id,input.eventName,record,consent,touch]:[input.id,input.eventName,record,consent])).digest('hex');
      const prior=unique.get(input.id);
      if(prior){if(prior.digest!==digest)throw new ProductWebhookError('event_conflict','Aynı olay kimliğinin içeriği değiştirilemez.',409);duplicates++;}
      else unique.set(input.id,{id:input.id,eventName:input.eventName,record,consent,touch,ignoredTouch:invalid,digest});
    }catch(error){if(error instanceof ProductWebhookError)throw error;throw new ProductWebhookError('event_schema',`Olay ${index+1}: kimlik, olay adı, tarih, özellik türü veya izin kanıtı geçersiz.`);}
  }
  return {events:[...unique.values()],duplicates};
}
function consumeRate(db:Database.Database,row:Row) {
  db.transaction(()=>{
    const now=Date.now(),key=`product-webhook:${row.organization_id}:${row.project_id}:${row.connection_id}`;
    const old=db.prepare('SELECT count,expires_at FROM platform_login_limits WHERE key=?').get(key) as {count:number;expires_at:number}|undefined;
    if(old&&old.expires_at>now&&old.count>=WEBHOOK_LIMITS.requestsPerMinute)throw new ProductWebhookError('rate_limit','İstek sınırına ulaşıldı. Bir dakika sonra tekrar deneyin.',429);
    db.prepare('INSERT INTO platform_login_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires_at=excluded.expires_at').run(key,old&&old.expires_at>now?old.count+1:1,old&&old.expires_at>now?old.expires_at:now+60000);
  })();
}
export function authenticateProductWebhook(db:Database.Database,id:string,headers:Headers,key:string) {
  const row=db.prepare(`${query} AND s.connection_id=?`).get(id) as Row|undefined;
  if(!row?.active)throw new ProductWebhookError('signature','Webhook doğrulanamadı.',401);
  consumeRate(db,row);
  const timestamp=headers.get('x-ryzevo-timestamp')||'',signature=headers.get('x-ryzevo-signature')||'';
  if(!/^\d{10}$/.test(timestamp)||Math.abs(Date.now()/1000-Number(timestamp))>WEBHOOK_LIMITS.signatureSeconds||!/^v1=[a-f0-9]{64}$/.test(signature))throw new ProductWebhookError('signature','Webhook doğrulanamadı.',401);
  const secret=decryptCredentials<StoredCredentials>(row.encrypted_credentials,key,row.organization_id,row.project_id,id).accessToken;
  return (bytes:Uint8Array)=>{
    if(bytes.byteLength>WEBHOOK_LIMITS.bodyBytes)throw new ProductWebhookError('body_limit','Olay gövdesi 64 KiB sınırını aşıyor.',413);
    const expected=createHmac('sha256',Buffer.from(secret,'hex')).update(`${timestamp}.${id}.`).update(bytes).digest();
    if(!timingSafeEqual(expected,Buffer.from(signature.slice(3),'hex')))throw new ProductWebhookError('signature','Webhook doğrulanamadı.',401);
    return db.transaction(()=>{
      const fresh=db.prepare(`${query} AND s.connection_id=?`).get(id) as Row|undefined;
      if(!fresh?.active||revision(fresh)!==revision(row))throw new ProductWebhookError('source_changed','Kaynak bağlantısı değişti.',409);
      if(!fresh.enabled||!authorized(db,fresh))throw new ProductWebhookError('source_inactive','Kaynak etkin değil veya kaynak yöneticisinin yetkisi kaldırıldı.',409);
      let payload:unknown;
      try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ProductWebhookError('invalid_json','Geçerli UTF-8 JSON gerekli.');}
      const mobileBound=Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='platform_mobile_apps'").get()&&db.prepare('SELECT 1 FROM platform_mobile_apps WHERE source_id=?').get(id));
      const parsed=parseEvents(payload,fresh,mobileBound?90:WEBHOOK_LIMITS.retentionDays),pending:Event[]=[];let duplicates=parsed.duplicates;
      for(const event of parsed.events){
        const receipt=db.prepare('SELECT digest FROM platform_product_event_receipts WHERE connection_id=? AND event_id=?').get(id,event.id) as {digest:string}|undefined;
        if(receipt){if(receipt.digest!==event.digest)throw new ProductWebhookError('event_conflict','Aynı olay kimliğinin içeriği değiştirilemez.',409);duplicates++;}else pending.push(event);
      }
      const args=[fresh.organization_id,fresh.project_id] as const,period=new Date().toISOString().slice(0,10);
      const used=db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='product_events'").get(...args,period) as {count:number}|undefined;
      if((used?.count||0)+pending.length>WEBHOOK_LIMITS.eventsPerDay)throw new ProductWebhookError('quota','Günlük olay kotasına ulaşıldı.',429);
      for(const [table,limit] of [['platform_product_events',WEBHOOK_LIMITS.events],['platform_product_event_receipts',WEBHOOK_LIMITS.receipts]] as const){
        const count=(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE organization_id=? AND project_id=?`).get(...args) as {n:number}).n;
        if(count+pending.length>limit)throw new ProductWebhookError('quota','Saklanan olay sınırına ulaşıldı. Saklama işçisini kontrol edin.',429);
      }
      const receivedAt=new Date().toISOString(),scope={subject:fresh.webhook_actor_id!,organizationId:fresh.organization_id,projectId:fresh.project_id};
      // Ordered source timestamps protect the projection from out-of-order deliveries.
      const ordered=[...pending].sort((a,b)=>a.record.observedAt.localeCompare(b.record.observedAt));
      const entityType=normalizeWebhookConfig(JSON.parse(fresh.config_json)).entityType;
      const written=writeProductRecords(db,scope,id,fresh.version,entityType,ordered.map(event=>event.record),receivedAt);
      let touched=0;
      for(const event of pending){
        if(event.consent?.status==='opted_out'){const email=recordEmailOptOut(db,scope,key,id,fresh.version,event.record.externalId,event.record.attributes);if(email)queueIysConsent(db,scope,key,{channel:'EPOSTA',recipient:email,status:'RET',source:'HS_WEB',consentDate:event.consent.recordedAt,actor:scope.subject});}
        db.prepare('INSERT INTO platform_product_events VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,event.id,fresh.version,...args,event.record.externalId,event.eventName,JSON.stringify(event.record.attributes),event.consent?JSON.stringify(event.consent):null,event.record.observedAt,receivedAt);
        db.prepare('INSERT INTO platform_product_event_receipts VALUES(?,?,?,?,?,?)').run(id,event.id,...args,event.digest,receivedAt);
        if(recordAttribution(db,scope,key,{connectionId:id,entityType,eventId:event.id,eventName:event.eventName,externalId:event.record.externalId,observedAt:event.record.observedAt,attributes:event.record.attributes,touch:event.touch},receivedAt))touched++;
      }
      if(pending.length){
        db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'product_events',?) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+excluded.count").run(...args,period,pending.length);
        db.prepare('UPDATE platform_product_sources SET last_synced_at=? WHERE connection_id=?').run(receivedAt,id);
        db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(scope.subject,...args,'source.events',receivedAt);
      }
      return {accepted:pending.length,duplicates,recordsUpdated:written,receivedAt,attribution:{recorded:touched,ignored:pending.filter(event=>event.ignoredTouch).length}};
    })();
  };
}

export class ProductWebhooks {
  constructor(private db:Database.Database,private scope:MarketingScope){}
  authorize(){new ProductDataSources(this.db,this.scope).authorize();}
  private args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private row(id:string):Row {
    const row=this.db.prepare(`${query} AND s.connection_id=? AND s.organization_id=? AND s.project_id=?`).get(id,...this.args()) as Row|undefined;
    if(!row)throw new MarketingStoreError('Webhook kaynağı bulunamadı.',404);return row;
  }
  private validPreview(row:Row){return Boolean(row.preview_at&&Date.now()-Date.parse(row.preview_at)<3600000&&row.preview_revision===revision(row));}
  private dto(row:Row):WebhookSource {
    const cutoff=new Date(Date.now()-WEBHOOK_LIMITS.retentionDays*dayMs).toISOString();
    const eventCount=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_product_events WHERE connection_id=? AND received_at>=?').get(row.connection_id,cutoff) as {n:number}).n;
    const recordCount=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_product_records WHERE connection_id=? AND version=? AND received_at>=?').get(row.connection_id,row.version,cutoff) as {n:number}).n;
    return {id:row.connection_id,name:row.account_name,version:row.version,state:!row.active?'revoked':row.enabled?!authorized(this.db,row)?'blocked':'active':row.paused?'paused':this.validPreview(row)?'ready':'draft',config:JSON.parse(row.config_json),endpointPath:`/api/platform/product-events/${row.connection_id}`,previewAt:row.preview_at,lastReceivedAt:row.last_synced_at,eventCount,recordCount};
  }
  list(){this.authorize();return (this.db.prepare(`${query} AND s.organization_id=? AND s.project_id=? ORDER BY c.updated_at DESC`).all(...this.args()) as Row[]).map(row=>this.dto(row));}
  save(input:{id?:string;version?:number;name:string;config:unknown;secret?:string},key:string){
    this.authorize();let config:WebhookConfig;
    try{config=normalizeWebhookConfig(input.config);}catch(error){throw new MarketingStoreError(error instanceof Error?error.message:'Webhook şeması geçersiz.');}
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>160||input.secret!==undefined&&typeof input.secret!=='string')throw new MarketingStoreError('Webhook adı veya anahtarı geçersiz.');
    return this.db.transaction(()=>{
      const current=input.id?this.row(input.id):null;
      if(current&&input.version!==current.version)throw new MarketingStoreError('Kaynak sürümü değişti.',409);
      const count=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_product_sources WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n;
      if(!current&&count>=PRODUCT_SOURCE_LIMITS.sources||current&&current.version>=25)throw new MarketingStoreError('Pilot kaynak veya sürüm sınırına ulaşıldı.',429);
      let secret=input.secret||'';
      if(!secret&&current?.active)secret=decryptCredentials<StoredCredentials>(current.encrypted_credentials,key,...this.args(),current.connection_id).accessToken;
      if(!/^[a-f0-9]{64}$/.test(secret)||new Set(secret).size<8)throw new MarketingStoreError('Rastgele üretilmiş 32-byte anahtarın 64 karakterlik küçük harfli hex değeri gerekli.');
      const connection=new ProjectMarketingStore(this.db,this.scope).saveConnection({id:current?.connection_id,provider:'product_webhook',integrationId:current?.integration_id||`webhook:${randomUUID()}`,accountName:input.name.trim(),accessToken:secret},key)!;
      const version=(current?.version||0)+1;
      this.db.prepare(`INSERT INTO platform_product_sources(connection_id,organization_id,project_id,version,config_json,webhook_actor_id) VALUES(?,?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET version=excluded.version,config_json=excluded.config_json,enabled=0,paused=0,preview_at=NULL,preview_revision=NULL,last_synced_at=NULL,webhook_actor_id=excluded.webhook_actor_id,event_coverage_from=NULL`).run(connection.id,...this.args(),version,JSON.stringify(config),this.scope.subject);
      this.db.prepare('INSERT INTO platform_product_source_versions VALUES(?,?,?,?,?,?)').run(connection.id,version,...this.args(),JSON.stringify(config),new Date().toISOString());
      return this.dto(this.row(connection.id));
    })();
  }
  preview(id:string,payload:unknown):ProductPreview {
    this.authorize();const row=this.row(id);
    if(!row.active)throw new MarketingStoreError('Kaynak bağlantısı iptal edilmiş.',409);
    this.db.transaction(()=>{
      const period=new Date().toISOString().slice(0,10),used=this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='product_preview'").get(...this.args(),period) as {count:number}|undefined;
      if((used?.count||0)>=PRODUCT_SOURCE_LIMITS.previewsPerDay)throw new MarketingStoreError('Günlük kaynak önizleme sınırına ulaşıldı.',429);
      this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'product_preview',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),period);
    })();
    this.db.prepare('UPDATE platform_product_sources SET preview_at=NULL,preview_revision=NULL WHERE connection_id=?').run(id);
    const {events}=parseEvents(payload,row);
    this.db.prepare('UPDATE platform_product_sources SET preview_at=?,preview_revision=? WHERE connection_id=?').run(new Date().toISOString(),revision(row),id);
    return {total:events.length,valid:events.length,errors:[],samples:events.slice(0,5).map(event=>({...event.record,externalId:mask(event.record.externalId),consentStatus:'unknown'})),canActivate:true,attribution:{found:events.filter(event=>event.touch).length,ignored:events.filter(event=>event.ignoredTouch).length}};
  }
  state(id:string,version:number,action:'activate'|'pause'|'revoke'){
    this.authorize();return this.db.transaction(()=>{
      const row=this.row(id);
      if(version!==row.version)throw new MarketingStoreError('Kaynak sürümü değişti.',409);
      if(action==='revoke')new ProjectMarketingStore(this.db,this.scope).revokeConnection(id);
      else if(!row.active||action==='activate'&&!this.validPreview(row))throw new MarketingStoreError('Önce güncel şemanın önizlemesini tamamlayın.',409);
      const coverage=action==='activate'?(row.enabled&&authorized(this.db,row)?(this.db.prepare('SELECT event_coverage_from FROM platform_product_sources WHERE connection_id=?').get(id) as {event_coverage_from:string|null}).event_coverage_from:new Date().toISOString()):null;
      this.db.prepare('UPDATE platform_product_sources SET enabled=?,paused=?,webhook_actor_id=?,event_coverage_from=? WHERE connection_id=?').run(Number(action==='activate'),Number(action!=='activate'),this.scope.subject,coverage,id);
      this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),`source.webhook.${action}`,new Date().toISOString());
      return this.dto(this.row(id));
    })();
  }
  events(id:string,page=1):{items:WebhookEventSample[];total:number;page:number}{
    this.authorize();this.row(id);
    if(!Number.isSafeInteger(page)||page<1||page>1000)throw new MarketingStoreError('Geçersiz sayfa.');
    const cutoff=new Date(Date.now()-WEBHOOK_LIMITS.retentionDays*dayMs).toISOString();
    const total=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_product_events WHERE connection_id=? AND received_at>=?').get(id,cutoff) as {n:number}).n;
    const rows=this.db.prepare('SELECT * FROM platform_product_events WHERE connection_id=? AND received_at>=? ORDER BY received_at DESC,event_id LIMIT 20 OFFSET ?').all(id,cutoff,(page-1)*20) as {event_id:string;entity_id:string;event_name:string;occurred_at:string;received_at:string;attributes_json:string;consent_json:string|null;version:number}[];
    return {items:rows.map(row=>({id:mask(row.event_id),entityId:mask(row.entity_id),eventName:row.event_name,occurredAt:row.occurred_at,receivedAt:row.received_at,version:row.version,attributes:JSON.parse(row.attributes_json),consentStatus:row.consent_json?JSON.parse(row.consent_json).status==='opted_in'?'reported_opted_in':'reported_opted_out':'unknown'})),total,page};
  }
}
export function pruneProductEvents(db:Database.Database) {
  return db.transaction(()=>{
    const cutoff=new Date(Date.now()-WEBHOOK_LIMITS.retentionDays*dayMs).toISOString(),receiptCutoff=new Date(Date.now()-WEBHOOK_LIMITS.receiptDays*dayMs).toISOString();
    const mobile=Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='platform_mobile_apps'").get());
    const events=mobile?db.prepare('DELETE FROM platform_product_events WHERE rowid IN (SELECT e.rowid FROM platform_product_events e WHERE e.received_at<? OR (e.received_at<? AND NOT EXISTS(SELECT 1 FROM platform_mobile_apps a WHERE a.source_id=e.connection_id)) LIMIT 1000)').run(new Date(Date.now()-90*dayMs).toISOString(),cutoff).changes:db.prepare('DELETE FROM platform_product_events WHERE rowid IN (SELECT rowid FROM platform_product_events WHERE received_at<? LIMIT 1000)').run(cutoff).changes;
    const receipts=db.prepare('DELETE FROM platform_product_event_receipts WHERE rowid IN (SELECT rowid FROM platform_product_event_receipts WHERE received_at<? LIMIT 1000)').run(receiptCutoff).changes;
    const records=db.prepare("DELETE FROM platform_product_records WHERE rowid IN (SELECT r.rowid FROM platform_product_records r JOIN platform_connections c ON c.id=r.connection_id WHERE c.provider='product_webhook' AND r.received_at<? LIMIT 1000)").run(cutoff).changes;
    return {events,receipts,records};
  })();
}
