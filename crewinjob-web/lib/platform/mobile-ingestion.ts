import 'server-only';
import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { MobileGrowth,mobileIntegrationQuery,mobileRevision,type MobileIntegrationRow } from './mobile-store';
import { MarketingStoreError } from './errors';
import { assertProjectWork } from './entitlements';
import { encryptCredentials,decryptCredentials,type StoredCredentials } from './credential-envelope';
import { authenticateProductWebhook } from './product-webhooks';
import { mobileDate,mobileText,mobileNumber,mobileCurrency,mobileRecord as rec } from './mobile-validation';
import type { MobileApp,MobileProvider } from './mobile-types';

export type MobileObservedEvent={id:string;entityId:string;occurredAt:string;kind:'install'|'session'|'activation'|'purchase'|'refund'|'subscription'|'attribution'|'message_impression'|'message_click'|'message_dismiss';platform:string;details:Record<string,string|number|boolean|null>};
export const mobileEntity=(key:string,appId:string,id:unknown)=>{
  const value=mobileText(id,160);if(!/^[a-zA-Z0-9_$:.-]+$/.test(value))throw new MarketingStoreError('Kişisel veri içermeyen kararlı kullanıcı kimliği gerekli.');
  return createHmac('sha256',Buffer.from(key,'hex')).update(JSON.stringify(['mobile-entity',appId,value])).digest('hex');
};
function eventTime(value:unknown){if(typeof value==='number'&&Number.isSafeInteger(value))return new Date(value>1e12?value:value*1000).toISOString();return mobileDate(value);}
function boundedLabel(value:unknown){return value===undefined||value===null?'':mobileText(value,120,true);}
export function normalizeMobileEvents(provider:MobileProvider,app:MobileApp,config:Record<string,string>,raw:unknown):MobileObservedEvent[]{
  const input=rec(raw);
  if(provider==='bridge'){
    if(input.appId!==app.id||!Array.isArray(input.events)||input.events.length<1||input.events.length>20)throw new MarketingStoreError('Uygulama ve 1-20 olay gerekli.');
    return input.events.map(value=>{const row=rec(value),kind=String(row.kind);if(!['install','session','activation','purchase','refund','subscription','attribution'].includes(kind))throw new MarketingStoreError('Mobil olay türü geçersiz. Mesaj etkileşimleri feedback işlemiyle bildirilmelidir.');
      const details:MobileObservedEvent['details']={identity:'customer',campaign:boundedLabel(row.campaignId),channel:boundedLabel(row.channel),environment:row.environment==='sandbox'?'sandbox':'production'};
      if(['purchase','refund'].includes(kind)){details.amount=mobileNumber(row.amount);details.currency=mobileCurrency(row.currency);details.transaction=mobileText(row.transactionId,160);}
      if(kind==='subscription'){details.status=boundedLabel(row.status);details.product=boundedLabel(row.productId);}
      if(kind.startsWith('message_'))details.messageId=mobileText(row.messageId,80);
      return {id:mobileText(row.id,160),entityId:mobileText(row.entityId,160),occurredAt:eventTime(row.occurredAt),kind:kind as MobileObservedEvent['kind'],platform:app.platform,details};
    });
  }
  if(provider==='revenuecat'){
    const event=rec(input.event);if(event.app_id!==config.externalAppId)throw new MarketingStoreError('RevenueCat uygulaması eşleşmedi.');
    if(event.environment!=='PRODUCTION')return [];
    const type=event.type,charge=['INITIAL_PURCHASE','RENEWAL','NON_RENEWING_PURCHASE'].includes(String(type)),refund=type==='CANCELLATION'&&event.cancel_reason==='CUSTOMER_SUPPORT';
    const kind=charge?'purchase':refund?'refund':'subscription';
    if(!['INITIAL_PURCHASE','RENEWAL','NON_RENEWING_PURCHASE','CANCELLATION','UNCANCELLATION','EXPIRATION','BILLING_ISSUE','SUBSCRIPTION_PAUSED','PRODUCT_CHANGE','SUBSCRIPTION_EXTENDED','REFUND_REVERSED'].includes(String(type)))return [];
    const details:MobileObservedEvent['details']={identity:String(event.app_user_id||'').startsWith('$RCAnonymousID:')?'provider':'customer',environment:'production',status:String(type),product:boundedLabel(event.product_id),expiresAt:typeof event.expiration_at_ms==='number'?new Date(event.expiration_at_ms).toISOString():null};
    if(charge||refund){details.transaction=mobileText(event.transaction_id,160);if(typeof event.price_in_purchased_currency==='number'&&typeof event.currency==='string'){details.amount=mobileNumber(Math.abs(event.price_in_purchased_currency));details.currency=mobileCurrency(event.currency);}else{details.amount=null;details.currency=null;}}
    return [{id:mobileText(event.id,160),entityId:mobileText(event.app_user_id,160),occurredAt:eventTime(event.event_timestamp_ms),kind,platform:event.store==='APP_STORE'?'ios':event.store==='PLAY_STORE'?'android':app.platform,details}];
  }
  if(provider==='appsflyer'||provider==='adjust'){
    const rows=Array.isArray(raw)?raw:[raw];if(rows.length<1||rows.length>20)throw new MarketingStoreError('Attribution olay sınırı aşıldı.');
    return rows.flatMap(value=>{
      const row=rec(value),af=provider==='appsflyer';if((af?row.app_id:row.app_token)!==config.externalAppId)throw new MarketingStoreError('Attribution uygulaması eşleşmedi.');
      const activity=af?row.event_name:row.activity_kind,kind=activity==='install'?'install':activity==='launch'||activity==='session'?'session':activity==='attribution_changed'?'attribution':null;if(!kind)return [];
      const customer=row.customer_user_id,entity=customer||(af?row.appsflyer_id:row.adid),time=row.event_time_ms??row.event_time??row.created_at;
      // A relay must convert timezone-ambiguous provider timestamps to ISO/epoch.
      const occurredAt=eventTime(time),identity=customer?'customer':'provider';
      const eventId=row.event_id??createHash('sha256').update(JSON.stringify([provider,entity,kind,occurredAt,row.campaign||'',row.network_name||row.media_source||''])).digest('hex');
      return [{id:mobileText(eventId,160),entityId:mobileText(entity,160),occurredAt,kind,platform:boundedLabel(row.platform)||app.platform,details:{identity,environment:'production',campaign:boundedLabel(row.campaign),channel:boundedLabel(row.media_source||row.network_name),providerConfirmed:true}}];
    });
  }
  throw new MarketingStoreError('Bu sağlayıcı olay kabul etmiyor.');
}

export function recordMobileEvents(service:MobileGrowth,app:MobileApp,provider:MobileProvider,events:MobileObservedEvent[]){
  const {db,key}=service;
  return db.transaction(()=>{
    const source=db.prepare('SELECT c.encrypted_credentials FROM platform_connections c WHERE c.id=? AND c.organization_id=? AND c.project_id=? AND c.active=1').get(app.sourceId,...service.args()) as {encrypted_credentials:string}|undefined;
    if(!source)throw new MarketingStoreError('Mobil olay kaynağı kapalı.',409);
    const sourceSecret=decryptCredentials<StoredCredentials>(source.encrypted_credentials,key,...service.args(),app.sourceId).accessToken;
    const normalized=events.map(event=>{
      if(Date.parse(event.occurredAt)<Date.now()-90*86400000||Date.parse(event.occurredAt)>Date.now()+300000)throw new MarketingStoreError('Olay tarihi 90 günlük pencere dışında.');
      const id=createHash('sha256').update(JSON.stringify([provider,event.id])).digest('hex'),entityId=mobileEntity(key,app.id,event.entityId),digest=mobileRevision(JSON.stringify(event));
      const old=db.prepare('SELECT digest FROM platform_mobile_event_details WHERE source_id=? AND event_id=?').get(app.sourceId,id) as {digest:string}|undefined;
      if(old&&old.digest!==digest)throw new MarketingStoreError('Aynı mobil olayın içeriği değiştirilemez.',409);
      return {id,entityId,event,digest};
    });
    const payload={sourceVersion:app.sourceVersion,events:normalized.map(({id,entityId,event})=>({id,entityId,eventName:`mobile.${event.kind}`,occurredAt:event.occurredAt,attributes:{platform:event.platform}}))},body=Buffer.from(JSON.stringify(payload)),timestamp=String(Math.floor(Date.now()/1000));
    const signature=createHmac('sha256',Buffer.from(sourceSecret,'hex')).update(`${timestamp}.${app.sourceId}.`).update(body).digest('hex');
    const result=authenticateProductWebhook(db,app.sourceId,new Headers({'x-ryzevo-timestamp':timestamp,'x-ryzevo-signature':`v1=${signature}`}),key)(body);
    for(const item of normalized)db.prepare('INSERT INTO platform_mobile_event_details VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,event_id) DO NOTHING').run(app.sourceId,item.id,...service.args(),app.id,provider,item.event.kind,item.digest,JSON.stringify(item.event.details));
    return result;
  }).immediate();
}

export function registerMobileContact(service:MobileGrowth,app:MobileApp,raw:Record<string,unknown>){
  const entityKey=mobileEntity(service.key,app.id,raw.entityId),provider=String(raw.provider),destination=provider==='bridge'?'':mobileText(raw.destination,4096),at=mobileDate(raw.recordedAt),consent=rec(raw.consent);
  if(!['onesignal','firebase','bridge'].includes(provider)||typeof consent.push!=='boolean'||typeof consent.inApp!=='boolean'||provider==='bridge'&&consent.push||Date.parse(at)>Date.now()+300000||/[\r\n]/.test(destination))throw new MarketingStoreError('Kayıt veya açık iletişim izni geçersiz.');
  const evidenceRef=mobileText(raw.evidenceRef,200),id=createHash('sha256').update(JSON.stringify([app.id,entityKey,provider])).digest('hex'),digest=mobileRevision(JSON.stringify([provider,destination,consent,evidenceRef,at]));
  return service.db.transaction(()=>{
    const old=service.db.prepare('SELECT * FROM platform_mobile_contacts WHERE id=? AND organization_id=? AND project_id=?').get(id,...service.args()) as {encrypted_destination:string;updated_at:string;allow_pilot:number}|undefined;
    if(old&&old.updated_at>at)return {id,unchanged:true};
    const previous=old?decryptCredentials<Record<string,unknown>>(old.encrypted_destination,service.key,...service.args(),`mobile-contact:${id}`):null;
    if(old&&old.updated_at===at){if(previous?.digest!==digest)throw new MarketingStoreError('Aynı zamanda çelişen iletişim izni kaydı var.',409);return {id,unchanged:true};}
    if(!old&&(service.db.prepare('SELECT COUNT(*) n FROM platform_mobile_contacts WHERE organization_id=? AND project_id=?').get(...service.args()) as {n:number}).n>=1000)throw new MarketingStoreError('Mobil alıcı sınırına ulaşıldı.',429);
    const keepPilot=old?.allow_pilot&&previous?.destination===destination&&previous?.push===consent.push&&previous?.inApp===consent.inApp;
    service.db.prepare('INSERT INTO platform_mobile_contacts VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_destination=excluded.encrypted_destination,push_consent=excluded.push_consent,in_app_consent=excluded.in_app_consent,allow_pilot=excluded.allow_pilot,updated_at=excluded.updated_at').run(id,...service.args(),app.id,entityKey,provider,encryptCredentials({destination,entityId:mobileText(raw.entityId,160),push:consent.push,inApp:consent.inApp,evidenceRef,digest},service.key,...service.args(),`mobile-contact:${id}`),Number(consent.push),Number(consent.inApp),Number(Boolean(keepPilot)),at);
    service.audit('mobile.contact.consent');return {id,unchanged:false};
  }).immediate();
}
export function authenticateMobileHook(db:Database.Database,id:string,headers:Headers,key:string){
  const row=db.prepare(mobileIntegrationQuery+' AND i.connection_id=?').get(id) as MobileIntegrationRow|undefined;
  if(!row?.active||!['bridge','appsflyer','adjust','revenuecat'].includes(row.kind))throw new MarketingStoreError('Mobil webhook doğrulanamadı.',401);
  const service=new MobileGrowth(db,{subject:row.actor_id,organizationId:row.organization_id,projectId:row.project_id},key);service.authorize('connections.manage');assertProjectWork(db,service.scope);
  const now=Date.now(),limitKey=`mobile-hook:${id}`,old=db.prepare('SELECT count,expires_at FROM platform_login_limits WHERE key=?').get(limitKey) as {count:number;expires_at:number}|undefined;
  if(old&&old.expires_at>now&&old.count>=120)throw new MarketingStoreError('Mobil webhook hız sınırı aşıldı.',429);
  db.prepare('INSERT INTO platform_login_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,expires_at=excluded.expires_at').run(limitKey,old&&old.expires_at>now?old.count+1:1,old&&old.expires_at>now?old.expires_at:now+60000);
  const supplied=headers.get('authorization')||'',expected=`Bearer ${service.secret(row).webhookSecret}`;
  if(headers.has('origin')||supplied.length>1024||!timingSafeEqual(createHash('sha256').update(supplied).digest(),createHash('sha256').update(expected).digest()))throw new MarketingStoreError('Mobil webhook doğrulanamadı.',401);
  const assertCurrent=()=>{service.authorize('connections.manage');assertProjectWork(db,service.scope);const fresh=service.integration(id);if(!fresh.active||mobileRevision(fresh.encrypted_credentials)!==mobileRevision(row.encrypted_credentials))throw new MarketingStoreError('Mobil bağlantı değişti.',409);};
  return {service,row,app:service.app(row.app_id),assertCurrent,commit(raw:unknown){
    return db.transaction(()=>{
      service.authorize('connections.manage');const fresh=service.integration(id);if(!fresh.active||mobileRevision(fresh.encrypted_credentials)!==mobileRevision(row.encrypted_credentials))throw new MarketingStoreError('Mobil bağlantı değişti.',409);
      const app=service.app(row.app_id),input=rec(raw);let result:unknown;
      if(row.kind==='bridge'&&input.action==='register'){if(input.appId!==app.id)throw new MarketingStoreError('Uygulama eşleşmedi.');result=registerMobileContact(service,app,input);}
      else if(row.kind==='bridge'&&input.action==='coverage'){
        if(input.appId!==app.id||app.sourceState!=='active')throw new MarketingStoreError('Etkin uygulama kaynağı gerekli.',409);
        const through=mobileDate(input.through);if(Date.parse(through)>Date.now()||Date.parse(through)<Date.now()-90*86400000)throw new MarketingStoreError('Kapsam tarihi geçersiz.');
        db.prepare('UPDATE platform_mobile_apps SET coverage_through=CASE WHEN coverage_through IS NULL OR coverage_through<? THEN ? ELSE coverage_through END WHERE id=?').run(through,through,app.id);result={accepted:true};
      }else{const events=normalizeMobileEvents(row.kind,app,JSON.parse(row.config_json),raw);result=events.length?recordMobileEvents(service,app,row.kind,events):{accepted:0,ignored:true};}
      if(!(result as {ignored?:boolean})?.ignored)db.prepare("UPDATE platform_mobile_integrations SET status='event_received',last_event_at=? WHERE connection_id=?").run(new Date().toISOString(),id);return result;
    }).immediate();
  }};
}
