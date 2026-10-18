import 'server-only';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { ProjectMarketingStore,type MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { assertProjectWork,assertProjectDelivery } from './entitlements';
import { decryptCredentials,type StoredCredentials } from './credential-envelope';
import { ProductWebhooks } from './product-webhooks';
import { ProjectOperations } from './operations';
import { MOBILE_EVENT_NAMES,mobileId,mobileText,normalizeMobileApp,mobileProvider,mobilePath,mobileDay,mobileCurrency,mobileNumber } from './mobile-validation';
import { asoFindings,readAppleListing,readPlayListing,probeMobileIntegration,validateMobileIntegration,createBranchLink,type MobileTransport,type MobileSecret } from './mobile-providers';
import type { MobileApp,MobileIntegration,MobileProvider,MobileStoreSnapshot,MobileLink } from './mobile-types';

export type MobileAppRow={id:string;organization_id:string;project_id:string;source_id:string;source_version:number;config_json:string;coverage_through:string|null;created_at:string;updated_at:string};
export type MobileIntegrationRow={connection_id:string;organization_id:string;project_id:string;app_id:string;kind:MobileProvider;config_json:string;actor_id:string;status:string;checked_at:string|null;checked_revision:string|null;last_event_at:string|null;encrypted_credentials:string;active:number};
export const mobileRevision=(value:string)=>createHash('sha256').update(value).digest('hex');
export const mobileIntegrationQuery=`SELECT i.*,c.encrypted_credentials,c.active FROM platform_mobile_integrations i JOIN platform_connections c ON c.id=i.connection_id AND c.organization_id=i.organization_id AND c.project_id=i.project_id WHERE c.provider='mobile'`;
export class MobileGrowth {
  repo:PlatformRepository;store:ProjectMarketingStore;
  constructor(public db:Database.Database,public scope:MarketingScope,public key:string){this.repo=new PlatformRepository(db);this.store=new ProjectMarketingStore(db,scope);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  authorize(permission:'read'|'connections.manage'|'content.write'|'campaign.approve'|'campaign.dispatch'|'recipients.manage'='read'){
    if(!this.repo.can(this.scope.subject,...this.args(),permission)||this.repo.workspace(this.scope.subject,...this.args())?.project.productPack!=='standard')throw new MarketingStoreError('Mobil büyüme erişimi reddedildi.',403);
  }
  audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
  quota(resource:string,limit:number){const period=new Date().toISOString().slice(0,10),old=this.db.prepare('SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource=?').get(...this.args(),period,resource) as {count:number}|undefined;if((old?.count||0)>=limit)throw new MarketingStoreError('Günlük mobil işlem sınırına ulaşıldı.',429);this.db.prepare('INSERT INTO platform_usage VALUES(?,?,?,?,1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1').run(...this.args(),period,resource);}
  rawApp(id:string){this.authorize();const row=this.db.prepare('SELECT * FROM platform_mobile_apps WHERE id=? AND organization_id=? AND project_id=?').get(mobileId(id),...this.args()) as MobileAppRow|undefined;if(!row)throw new MarketingStoreError('Uygulama bulunamadı.',404);return row;}
  app(id:string):MobileApp {
    const row=this.rawApp(id),source=this.db.prepare('SELECT s.enabled,s.version,c.active FROM platform_product_sources s JOIN platform_connections c ON c.id=s.connection_id WHERE s.connection_id=? AND s.organization_id=? AND s.project_id=?').get(row.source_id,...this.args()) as {enabled:number;version:number;active:number}|undefined;
    return {id:row.id,...JSON.parse(row.config_json),sourceId:row.source_id,sourceVersion:row.source_version,sourceState:source?.version!==row.source_version?'changed':!source.active?'revoked':source.enabled?'active':'paused',coverageThrough:row.coverage_through,createdAt:row.created_at,updatedAt:row.updated_at};
  }
  apps(){this.authorize();return (this.db.prepare('SELECT id FROM platform_mobile_apps WHERE organization_id=? AND project_id=? ORDER BY created_at,id').all(...this.args()) as {id:string}[]).map(row=>this.app(row.id));}
  saveApp(raw:Record<string,unknown>){
    this.authorize('connections.manage');assertProjectWork(this.db,this.scope);const config=normalizeMobileApp(raw);
    return this.db.transaction(()=>{
      this.authorize('connections.manage');const previous=raw.id?this.rawApp(String(raw.id)):null;
      if(!previous&&this.apps().length>=3)throw new MarketingStoreError('Pilot projede en fazla üç uygulama kaydedilebilir.',429);
      const id=previous?.id||randomUUID(),now=new Date().toISOString();
      const source=previous?{id:previous.source_id,version:previous.source_version}:new ProductWebhooks(this.db,this.scope).save({name:`Mobil · ${config.name}`,secret:randomBytes(32).toString('hex'),config:{entityType:'user',attributes:[{key:'platform',type:'string'}],eventNames:[...MOBILE_EVENT_NAMES]}},this.key);
      this.db.prepare('INSERT INTO platform_mobile_apps VALUES(?,?,?,?,?,?,NULL,?,?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,coverage_through=NULL,updated_at=excluded.updated_at').run(id,...this.args(),source.id,source.version,JSON.stringify(config),now,now);
      this.audit(previous?'mobile.app.update':'mobile.app.create');return this.app(id);
    }).immediate();
  }
  setSource(id:string,enabled:boolean){
    this.authorize('connections.manage');if(typeof enabled!=='boolean')throw new MarketingStoreError('Geçerli etkinlik seçimi gerekli.');
    const app=this.app(id),source=new ProductWebhooks(this.db,this.scope);
    if(enabled){source.preview(app.sourceId,{sourceVersion:app.sourceVersion,events:[{id:'schema-validation-only',entityId:'schema-validation-only',eventName:'mobile.session',occurredAt:new Date().toISOString(),attributes:{platform:app.platform}}]});}
    const value=source.state(app.sourceId,app.sourceVersion,enabled?'activate':'pause');this.db.prepare('UPDATE platform_mobile_apps SET coverage_through=NULL WHERE id=?').run(id);this.audit('mobile.source.state');return value;
  }
  integration(id:string){this.authorize();const row=this.db.prepare(mobileIntegrationQuery+' AND i.connection_id=? AND i.organization_id=? AND i.project_id=?').get(mobileId(id),...this.args()) as MobileIntegrationRow|undefined;if(!row)throw new MarketingStoreError('Mobil bağlantı bulunamadı.',404);return row;}
  secret(row:MobileIntegrationRow):MobileSecret{if(!row.active)throw new MarketingStoreError('Mobil bağlantı kapalı.',409);return JSON.parse(decryptCredentials<StoredCredentials>(row.encrypted_credentials,this.key,...this.args(),row.connection_id).accessToken);}
  integrations(appId:string):MobileIntegration[]{
    this.rawApp(appId);return (this.db.prepare(mobileIntegrationQuery+' AND i.app_id=? AND i.organization_id=? AND i.project_id=? ORDER BY i.kind').all(appId,...this.args()) as MobileIntegrationRow[]).map(row=>({id:row.connection_id,appId:row.app_id,provider:row.kind,config:JSON.parse(row.config_json),status:!row.active?'revoked':row.checked_revision&&row.checked_revision!==mobileRevision(row.encrypted_credentials)?'configured':row.status,checkedAt:row.checked_at,lastEventAt:row.last_event_at,active:Boolean(row.active),endpoint:['bridge','appsflyer','adjust','revenuecat'].includes(row.kind)?`/api/platform/mobile-hooks/${row.connection_id}`:null}));
  }
  saveIntegration(raw:Record<string,unknown>){
    this.authorize('connections.manage');assertProjectWork(this.db,this.scope);const app=this.app(String(raw.appId)),provider=mobileProvider(raw.provider);
    let normalized;try{normalized=validateMobileIntegration(provider,raw.config,raw.credentials,app);}catch{throw new MarketingStoreError('Sağlayıcı ayarlarını ve gizli bağlantı alanlarını kontrol edin.');}
    return this.db.transaction(()=>{
      const old=this.db.prepare('SELECT connection_id FROM platform_mobile_integrations WHERE app_id=? AND kind=?').get(app.id,provider) as {connection_id:string}|undefined;
      const connection=this.store.saveConnection({id:old?.connection_id,provider:'mobile',integrationId:`mobile:${app.id}:${provider}`,accountName:`${app.name} · ${provider}`,accessToken:JSON.stringify(normalized.credentials)},this.key)!;
      this.db.prepare("INSERT INTO platform_mobile_integrations(connection_id,organization_id,project_id,app_id,kind,config_json,actor_id,status) VALUES(?,?,?,?,?,?,?,'configured') ON CONFLICT(connection_id) DO UPDATE SET config_json=excluded.config_json,actor_id=excluded.actor_id,status='configured',checked_at=NULL,checked_revision=NULL").run(connection.id,...this.args(),app.id,provider,JSON.stringify(normalized.config),this.scope.subject);
      this.audit('mobile.integration.save');return this.integrations(app.id);
    }).immediate();
  }
  revoke(id:string){this.authorize('connections.manage');const row=this.integration(id);this.store.revokeConnection(id);this.audit('mobile.integration.revoke');return this.integrations(row.app_id);}
  async probe(id:string,read?:MobileTransport){
    this.authorize('connections.manage');assertProjectWork(this.db,this.scope);const row=this.integration(id),revision=mobileRevision(row.encrypted_credentials);this.db.transaction(()=>this.quota('mobile_probe',25)).immediate();
    let status='unavailable';try{status=await probeMobileIntegration(row.kind,JSON.parse(row.config_json),this.secret(row),read);}catch{}
    this.authorize('connections.manage');if(!this.integration(id).active||mobileRevision(this.integration(id).encrypted_credentials)!==revision)throw new MarketingStoreError('Test sırasında bağlantı değişti.',409);
    this.db.prepare('UPDATE platform_mobile_integrations SET status=?,checked_at=?,checked_revision=? WHERE connection_id=?').run(status,new Date().toISOString(),revision,id);this.audit('mobile.integration.probe');return this.integrations(row.app_id);
  }
  async auditStore(raw:Record<string,unknown>,read?:MobileTransport){
    this.authorize('connections.manage');assertProjectWork(this.db,this.scope);const app=this.app(String(raw.appId)),revision=app.updatedAt,store=raw.store;
    if(!['ios','android'].includes(String(store)))throw new MarketingStoreError('Mağaza seçin.');
    this.db.transaction(()=>this.quota('mobile_aso',20)).immediate();let metadata,source:MobileStoreSnapshot['source'];
    try{
      if(raw.mode==='manual'){metadata={title:mobileText(raw.title,300,true),subtitle:mobileText(raw.subtitle,500,true),description:mobileText(raw.description,20000,true),screenshotCount:raw.screenshotCount===null||raw.screenshotCount===''?null:Number(raw.screenshotCount)};if(metadata.screenshotCount!==null&&(!Number.isSafeInteger(metadata.screenshotCount)||metadata.screenshotCount<0||metadata.screenshotCount>100))throw new Error();source='manual';}
      else if(store==='ios'){metadata=await readAppleListing(app,read);source='apple_public';}
      else{const row=this.integration(String(raw.connectionId));if(row.app_id!==app.id||row.kind!=='google_play')throw new Error();metadata=await readPlayListing(app,JSON.parse(row.config_json),this.secret(row),read);source='google_publisher';}
    }catch{throw new MarketingStoreError('Mağaza kaydı okunamadı. Kimlik, ülke/dil, erişim ve Google Play edit ID değerini kontrol edin.',409);}
    this.authorize('connections.manage');if(this.app(app.id).updatedAt!==revision)throw new MarketingStoreError('Uygulama ayarları değişti.',409);
    const value:MobileStoreSnapshot={id:randomUUID(),store:String(store),source,locale:app.locale,...metadata,checkedAt:new Date().toISOString(),findings:asoFindings(String(store),metadata.title,metadata.subtitle,metadata.description,metadata.screenshotCount)};
    this.db.transaction(()=>{this.db.prepare('INSERT INTO platform_mobile_store_snapshots VALUES(?,?,?,?,?,?)').run(value.id,...this.args(),app.id,JSON.stringify(value),value.checkedAt);this.db.prepare('DELETE FROM platform_mobile_store_snapshots WHERE app_id=? AND id NOT IN (SELECT id FROM platform_mobile_store_snapshots WHERE app_id=? ORDER BY checked_at DESC LIMIT 20)').run(app.id,app.id);this.audit('mobile.aso.audit');}).immediate();return value;
  }
  stores(appId:string){this.rawApp(appId);return (this.db.prepare('SELECT payload FROM platform_mobile_store_snapshots WHERE app_id=? AND organization_id=? AND project_id=? ORDER BY checked_at DESC LIMIT 10').all(appId,...this.args()) as {payload:string}[]).map(row=>JSON.parse(row.payload) as MobileStoreSnapshot);}
  asoTask(appId:string,snapshotId:string,code:string){
    this.authorize('content.write');const snapshot=this.stores(appId).find(item=>item.id===snapshotId),finding=snapshot?.findings.find(item=>item.code===code);if(!finding)throw new MarketingStoreError('ASO bulgusu bulunamadı.',404);
    const marker=`mobile-aso:${appId}:${code}`,operations=new ProjectOperations(this.db,this.scope),existing=operations.tasks().find(item=>item.note.includes(marker)&&!['completed','cancelled'].includes(item.status));if(existing)return existing;
    return operations.saveTask({title:`ASO · ${this.app(appId).name} · ${code}`.slice(0,160),dueAt:new Date(Date.now()+86400000).toISOString(),note:`${marker}\n${finding.evidence}\n${finding.recommendation}\nKaynak: ${snapshot!.source}`,status:'planned'});
  }
  links(appId:string):MobileLink[]{this.rawApp(appId);return (this.db.prepare('SELECT * FROM platform_mobile_links WHERE app_id=? AND organization_id=? AND project_id=? ORDER BY created_at DESC LIMIT 50').all(appId,...this.args()) as Record<string,string>[]).map(row=>({id:row.id,appId:row.app_id,campaignId:row.campaign_id,name:row.name,path:row.path,status:row.status,url:row.url||null,createdAt:row.created_at}));}
  async createLink(raw:Record<string,unknown>,read?:MobileTransport){
    this.authorize('connections.manage');assertProjectDelivery(this.db,this.scope);if(process.env.PLATFORM_MOBILE_LINKS_ENABLED!=='1'||raw.acknowledged!==true)throw new MarketingStoreError('Branch bağlantı oluşturma kapalı veya onay eksik.',409);
    const app=this.app(String(raw.appId)),row=this.integration(String(raw.connectionId));if(row.kind!=='branch'||row.app_id!==app.id)throw new MarketingStoreError('Bu uygulamanın Branch bağlantısını seçin.');
    const id=mobileId(raw.idempotencyKey),path=mobilePath(raw.path),campaign=this.store.campaign(String(raw.campaignId));if(!campaign)throw new MarketingStoreError('Proje kampanyası bulunamadı.',404);
    const digest=mobileRevision(JSON.stringify([app.id,row.connection_id,path,campaign.id]));
    const record=this.db.prepare('SELECT request_digest FROM platform_mobile_links WHERE id=? AND app_id=? AND organization_id=? AND project_id=?').get(id,app.id,...this.args()) as {request_digest:string}|undefined;if(record){if(record.request_digest!==digest)throw new MarketingStoreError('İşlem anahtarı başka bağlantıya ait.',409);return this.links(app.id).find(link=>link.id===id)||{id,status:'recorded',url:null};}
    this.db.transaction(()=>{this.quota('mobile_link',20);this.db.prepare("INSERT INTO platform_mobile_links VALUES(?,?,?,?,?,?,?,?,?,'creating',NULL,?)").run(id,...this.args(),app.id,row.connection_id,campaign.id,mobileText(raw.name,100),path,digest,new Date().toISOString());}).immediate();
    let url:string|null=null;try{url=await createBranchLink(app,JSON.parse(row.config_json),this.secret(row),{id,path,campaignId:campaign.id},read);}catch{}
    this.authorize('connections.manage');if(this.app(app.id).updatedAt!==app.updatedAt||!this.integration(row.connection_id).active||mobileRevision(this.integration(row.connection_id).encrypted_credentials)!==mobileRevision(row.encrypted_credentials))url=null;
    this.db.prepare('UPDATE platform_mobile_links SET status=?,url=? WHERE id=?').run(url?'created':'uncertain',url,id);this.audit('mobile.link.result');return this.links(app.id).find(link=>link.id===id)!;
  }
  associations(appId:string,teamId:string,fingerprint:string){
    const app=this.app(appId);if(!app.bundleId&&!app.packageName||app.bundleId&&!/^[A-Z0-9]{10}$/.test(teamId)||app.packageName&&!/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(fingerprint))throw new MarketingStoreError('Kayıtlı platforma ait Apple Team ID veya Android SHA-256 parmak izi gerekli.');
    return {domain:new URL(app.website).hostname,apple:{applinks:{details:app.bundleId?[{appIDs:[`${teamId}.${app.bundleId}`],components:[{'/':'/*'}]}]:[]}},android:app.packageName?[{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:app.packageName,sha256_cert_fingerprints:[fingerprint]}}]:[],deploymentRequired:true};
  }
  costs(appId:string){this.rawApp(appId);return this.db.prepare('SELECT campaign_id AS campaignId,attribution_campaign AS attributionCampaign,day,currency,amount,updated_at AS updatedAt FROM platform_mobile_costs WHERE app_id=? AND organization_id=? AND project_id=? ORDER BY day DESC LIMIT 100').all(appId,...this.args());}
  saveCost(raw:Record<string,unknown>){
    this.authorize('content.write');assertProjectWork(this.db,this.scope);const app=this.app(String(raw.appId)),campaign=this.store.campaign(String(raw.campaignId));if(!campaign)throw new MarketingStoreError('Proje kampanyası bulunamadı.',404);
    const day=mobileDay(raw.day),currency=mobileCurrency(raw.currency),amount=mobileNumber(raw.amount),attribution=mobileText(raw.attributionCampaign,120);
    if(day>new Date().toISOString().slice(0,10)||Date.parse(day)<Date.now()-90*86400000)throw new MarketingStoreError('Harcama tarihi son 90 gün içinde olmalı.');
    this.db.prepare('INSERT INTO platform_mobile_costs VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(app_id,campaign_id,day,currency) DO UPDATE SET attribution_campaign=excluded.attribution_campaign,amount=excluded.amount,actor_id=excluded.actor_id,updated_at=excluded.updated_at').run(...this.args(),app.id,campaign.id,attribution,day,currency,amount,this.scope.subject,new Date().toISOString());this.audit('mobile.spend.manual');return this.costs(app.id);
  }
}
