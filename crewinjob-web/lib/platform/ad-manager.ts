import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials, encryptCredentials } from './credential-envelope';
import { AD_LIMITS, AD_OBJECTIVES, AD_SPECIAL_CATEGORIES, type AdPlanState, type AdPlanView, type AdsSnapshot } from './ad-types';
import { AD_CONNECTION, GoogleAdsClient, LinkedInAdsClient, adHttp, googleAdsConfigured, googleCustomerId, linkedInAccountId, type AdHttp, type AdProvider, type ProviderPlan } from './ad-providers';
import { refreshGoogleCredentials } from './google-client';
import type { StoredCredentials } from './credential-envelope';

type AdCredentials={accessToken:string;refreshToken:string;adAccountId:string;currency:string;name:string;status:number|string|null;timezone:string|null;checkedAt:string;googleOAuth?:boolean;expiresAt?:number};
const PROVIDER_NAME:Record<AdProvider,string>={meta:'Meta',google:'Google Ads',linkedin:'LinkedIn'};
type Plan={id:string;provider:AdProvider;connection_id:string;name:string;objective:typeof AD_OBJECTIVES[number];special_category:typeof AD_SPECIAL_CATEGORIES[number];daily_budget_minor:number;currency:string;start_date:string;end_date:string;countries_json:string;link_url:string;state:AdPlanState;digest:string;approved_by:string|null;approved_digest:string|null;approved_at:string|null;provider_campaign_id:string|null;provider_adset_id:string|null;last_error:string|null;spend_minor:number|null;spend_checked_at:string|null;impressions:number|null;clicks:number|null;revision:number;updated_at:string};
// One Graph API call. The token travels only in the Authorization header; the host is fixed.
export type AdGraph=(method:'GET'|'POST',path:string,token:string,params?:Record<string,string>)=>Promise<Record<string,unknown>>;
const version=()=>{const value=process.env.PLATFORM_META_ADS_GRAPH_VERSION||'v25.0';return /^v\d{1,3}\.\d$/.test(value)?value:'v25.0';};
export const metaAdsGraph:AdGraph=async(method,path,token,params={})=>{
  if(!/^(act_\d{1,20}|\d{1,25})(\/(campaigns|adsets|insights))?$/.test(path))throw new Error('Invalid ad path.');
  const url=new URL(`https://graph.facebook.com/${version()}/${path}`);if(method==='GET')for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:method==='POST'?new URLSearchParams(params):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  const text=await response.text();let payload:Record<string,unknown>={};try{payload=JSON.parse(text.slice(0,65536));}catch{payload={};}
  if(!response.ok||payload.error)throw new Error('Meta reklam isteği reddedildi.');return payload;
};
// Currencies Meta bills without a fractional part; everything else uses cents.
const ZERO_DECIMAL=new Set(['CLP','COP','CRC','HUF','ISK','IDR','JPY','KRW','PYG','TWD','VND']);
export const adMinorUnit=(currency:string)=>ZERO_DECIMAL.has(currency)?1:100;
const DATE=/^\d{4}-\d{2}-\d{2}$/,COUNTRY=/^[A-Z]{2}$/;
const days=(from:string,to:string)=>Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000)+1;
const digestOf=(plan:Pick<Plan,'name'|'objective'|'special_category'|'daily_budget_minor'|'currency'|'start_date'|'end_date'|'countries_json'|'link_url'|'connection_id'>)=>createHash('sha256').update(JSON.stringify([plan.connection_id,plan.name,plan.objective,plan.special_category,plan.daily_budget_minor,plan.currency,plan.start_date,plan.end_date,plan.countries_json,plan.link_url])).digest('hex');
export const adsLaunchEnabled=()=>process.env.PLATFORM_ADS_ENABLED==='1';

// Ad management. A project connects its own Meta ad account and sets a daily and monthly cap. Plans are written by
// the team, approved on their exact content, and created on Meta as PAUSED. Starting delivery needs a second explicit
// go-ahead, the server switch, an unchanged approval and the caps. Pausing is always possible. Spend is shown only as
// Meta reports it; nothing here promises results.
export class ProjectAds{
  repo:PlatformRepository;
  constructor(public db:Database.Database,public scope:MarketingScope,public key:string,public graph:AdGraph=metaAdsGraph,public provider:AdProvider='meta',public http:AdHttp=adHttp,public refreshGoogle:typeof refreshGoogleCredentials=refreshGoogleCredentials){this.repo=new PlatformRepository(db);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private can(permission:'read'|'content.write'|'campaign.approve'|'connections.manage'){return this.repo.can(this.scope.subject,...this.args(),permission);}
  private manager(){return this.can('connections.manage')&&this.can('campaign.approve');}
  authorize(need:'read'|'content.write'|'campaign.approve'|'manage'='read'){
    if(!this.can('read')||this.repo.workspace(this.scope.subject,...this.args())?.project.productPack!=='standard')throw new MarketingStoreError('Reklam yönetimi için standart proje erişimi gerekli.',403);
    if(need==='manage'?!this.manager():need!=='read'&&!this.can(need))throw new MarketingStoreError(need==='manage'?'Reklam hesabı ve bütçe tavanı için bağlantı yönetimi ve onay yetkisi gerekli.':need==='campaign.approve'?'Reklam planlarını yalnız onay yetkisi olan ekip üyeleri onaylayabilir.':'Bu işlem için içerik yazma yetkisi gerekir.',403);
  }
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
  private connection(id?:string){return this.db.prepare(`SELECT id,integration_id,account_name,encrypted_credentials FROM platform_connections WHERE organization_id=? AND project_id=? AND provider=? AND active=1${id?' AND id=?':''} ORDER BY updated_at DESC LIMIT 1`).get(...this.args(),AD_CONNECTION[this.provider],...(id?[id]:[])) as {id:string;integration_id:string;account_name:string;encrypted_credentials:string}|undefined;}
  // With an id, only that (still active) account: a plan is always started, paused and read on its own account.
  private credentials(id?:string){const connection=this.connection(id);if(!connection)throw new MarketingStoreError(id?'Planın reklam hesabı artık bağlı değil. Kampanyayı sağlayıcının kendi ekranından kontrol edin.':'Önce reklam hesabını bağlayın.',409);const credentials=decryptCredentials<AdCredentials>(connection.encrypted_credentials,this.key,...this.args(),connection.id);
    if(this.provider==='google'&&!credentials.currency)throw new MarketingStoreError('Önce Google Ads hesabını doğrulayın.',409);return {connection,credentials};}
  // Google tokens expire within an hour; a refreshed token is stored encrypted again before use.
  private async token(connection:{id:string},credentials:AdCredentials){
    if(this.provider!=='google')return credentials.accessToken;
    let fresh:StoredCredentials;try{fresh=await this.refreshGoogle(credentials as unknown as StoredCredentials);}catch{throw new MarketingStoreError('Google Ads erişimi yenilenemedi. Hesabı yeniden bağlayın.',409);}
    if(fresh.accessToken!==credentials.accessToken){const next={...credentials,accessToken:fresh.accessToken,refreshToken:fresh.refreshToken||credentials.refreshToken,expiresAt:fresh.expiresAt};
      this.db.prepare('UPDATE platform_connections SET encrypted_credentials=?,updated_at=? WHERE id=?').run(encryptCredentials(next,this.key,...this.args(),connection.id),new Date().toISOString(),connection.id);}
    return fresh.accessToken;
  }
  private client(credentials:AdCredentials,token:string){return this.provider==='google'?new GoogleAdsClient(this.http,credentials.adAccountId,token):new LinkedInAdsClient(this.http,credentials.adAccountId,token);}
  private providerPlan(row:Plan):ProviderPlan{return {id:row.id,name:row.name,objective:row.objective,daily_budget_minor:row.daily_budget_minor,currency:row.currency,start_date:row.start_date,end_date:row.end_date,countries_json:row.countries_json,link_url:row.link_url,provider_campaign_id:row.provider_campaign_id,provider_adset_id:row.provider_adset_id};}
  private policy(){return this.db.prepare('SELECT * FROM platform_ad_policies WHERE organization_id=? AND project_id=? AND provider=?').get(...this.args(),this.provider) as {connection_id:string;currency:string;daily_cap_minor:number;monthly_cap_minor:number;revision:number;updated_at:string}|undefined;}
  // Connects the project's own ad account: the token is checked against the account and stored encrypted.
  async connect(raw:Record<string,unknown>){
    this.authorize('manage');
    if(this.provider!=='meta')return this.connectProvider(raw);
    const account=typeof raw.adAccountId==='string'?raw.adAccountId.trim().replace(/^(\d)/,'act_$1'):'',token=typeof raw.accessToken==='string'?raw.accessToken.trim():'';
    if(!/^act_\d{1,20}$/.test(account))throw new MarketingStoreError('Reklam hesabı kimliği act_123… biçiminde olmalı.');
    if(!token||token.length>4096||/[\s\x00]/.test(token))throw new MarketingStoreError('Geçerli bir erişim anahtarı girin.');
    let info:Record<string,unknown>;try{info=await this.graph('GET',account,token,{fields:'name,currency,account_status,timezone_name'});}catch{throw new MarketingStoreError('Meta reklam hesabına erişilemedi. Hesap kimliğini, anahtarın ads_read/ads_management iznini ve hesaptaki rolünüzü kontrol edin.',502);}
    const currency=typeof info.currency==='string'&&/^[A-Z]{3}$/.test(info.currency)?info.currency:null;if(!currency)throw new MarketingStoreError('Meta reklam hesabının para birimi okunamadı.',502);
    return this.db.transaction(()=>{
      this.authorize('manage');const now=new Date().toISOString(),old=this.connection(),id=old?.integration_id===account?old.id:`adconn_${randomUUID()}`;
      const credentials:AdCredentials={accessToken:token,refreshToken:'',adAccountId:account,currency,name:typeof info.name==='string'?info.name.slice(0,120):account,status:Number.isSafeInteger(info.account_status)?info.account_status as number:null,timezone:typeof info.timezone_name==='string'?info.timezone_name.slice(0,60):null,checkedAt:now};
      if(old&&old.id!==id){this.db.prepare('UPDATE platform_connections SET active=0,updated_at=? WHERE id=?').run(now,old.id);this.db.prepare('DELETE FROM platform_ad_policies WHERE organization_id=? AND project_id=? AND provider=?').run(...this.args(),this.provider);}
      this.db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,'meta_ads',?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET account_name=excluded.account_name,encrypted_credentials=excluded.encrypted_credentials,active=1,updated_at=excluded.updated_at").run(id,...this.args(),account,credentials.name,encryptCredentials(credentials,this.key,...this.args(),id),now);
      const policy=this.policy();if(policy&&policy.currency!==currency)this.db.prepare('DELETE FROM platform_ad_policies WHERE organization_id=? AND project_id=? AND provider=?').run(...this.args(),this.provider);
      this.audit('ads.account.connect');return this.read();
    }).immediate();
  }
  // LinkedIn: ad account id and a token with rw_ads. Google: the account is connected through Google sign-in (adwords
  // scope); this step reads its name and currency with the server's developer token.
  private async connectProvider(raw:Record<string,unknown>){
    const now=new Date().toISOString();let id:string,accountId:string,token:string,refresh='',google:{googleOAuth?:boolean;expiresAt?:number}={};
    if(this.provider==='linkedin'){
      accountId=linkedInAccountId(raw.adAccountId)||'';token=typeof raw.accessToken==='string'?raw.accessToken.trim():'';
      if(!accountId)throw new MarketingStoreError('LinkedIn reklam hesabı kimliği yalnız rakamlardan oluşmalı.');
      if(!token||token.length>4096||/[\s\x00]/.test(token))throw new MarketingStoreError('Geçerli bir erişim anahtarı girin.');
      const old=this.connection();id=old?.integration_id===accountId?old.id:`adconn_${randomUUID()}`;
    }else{
      if(!googleAdsConfigured())throw new MarketingStoreError('Google Ads geliştirici anahtarı bu sunucuda yapılandırılmamış.',503);
      const connection=this.connection();if(!connection)throw new MarketingStoreError('Önce Google ile oturum açarak Google Ads hesabını bağlayın.',409);
      const stored=decryptCredentials<AdCredentials>(connection.encrypted_credentials,this.key,...this.args(),connection.id);
      id=connection.id;accountId=googleCustomerId(connection.integration_id)||'';if(!accountId)throw new MarketingStoreError('Google Ads müşteri kimliği 10 haneli olmalı.');
      token=await this.token(connection,{...stored,adAccountId:accountId});const latest=decryptCredentials<AdCredentials>(this.connection()!.encrypted_credentials,this.key,...this.args(),connection.id);refresh=latest.refreshToken;google={googleOAuth:true,expiresAt:latest.expiresAt};
    }
    let info;try{info=await this.client({adAccountId:accountId} as AdCredentials,token).account();}catch(error){if(error instanceof MarketingStoreError)throw error;throw new MarketingStoreError(this.provider==='google'?'Google Ads hesabına erişilemedi. Müşteri kimliğini, hesaptaki rolünüzü ve geliştirici anahtarının erişim düzeyini kontrol edin.':'LinkedIn reklam hesabına erişilemedi. Hesap kimliğini, anahtarın rw_ads iznini ve hesaptaki rolünüzü kontrol edin.',502);}
    return this.db.transaction(()=>{
      this.authorize('manage');const old=this.connection();
      const credentials:AdCredentials={accessToken:token,refreshToken:refresh,adAccountId:accountId,currency:info.currency,name:info.name,status:info.status,timezone:info.timezone,checkedAt:now,...google};
      if(old&&old.id!==id){this.db.prepare('UPDATE platform_connections SET active=0,updated_at=? WHERE id=?').run(now,old.id);this.db.prepare('DELETE FROM platform_ad_policies WHERE organization_id=? AND project_id=? AND provider=?').run(...this.args(),this.provider);}
      this.db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET account_name=excluded.account_name,encrypted_credentials=excluded.encrypted_credentials,active=1,updated_at=excluded.updated_at").run(id,...this.args(),AD_CONNECTION[this.provider],accountId,info.name,encryptCredentials(credentials,this.key,...this.args(),id),now);
      const policy=this.policy();if(policy&&policy.currency!==info.currency)this.db.prepare('DELETE FROM platform_ad_policies WHERE organization_id=? AND project_id=? AND provider=?').run(...this.args(),this.provider);
      this.audit(`ads.${this.provider}.connect`);return this.read();
    }).immediate();
  }
  // Caps in the account currency's minor units (e.g. cents). Lowering a cap below an active plan is allowed: it blocks
  // new starts, and the team is shown which running plans exceed it.
  setPolicy(raw:Record<string,unknown>){
    this.authorize('manage');const {connection,credentials}=this.credentials(),daily=raw.dailyCapMinor,monthly=raw.monthlyCapMinor;
    if(!Number.isSafeInteger(daily)||(daily as number)<1||!Number.isSafeInteger(monthly)||(monthly as number)<(daily as number))throw new MarketingStoreError('Günlük tavan pozitif, aylık tavan en az günlük tavan kadar olmalı.');
    return this.db.transaction(()=>{const old=this.policy();if(raw.expectedRevision!==(old?.revision||0))throw new MarketingStoreError('Bütçe politikası başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      this.db.prepare('INSERT INTO platform_ad_policies(organization_id,project_id,provider,connection_id,currency,daily_cap_minor,monthly_cap_minor,revision,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?) ON CONFLICT(organization_id,project_id,provider) DO UPDATE SET connection_id=excluded.connection_id,currency=excluded.currency,daily_cap_minor=excluded.daily_cap_minor,monthly_cap_minor=excluded.monthly_cap_minor,revision=platform_ad_policies.revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(...this.args(),this.provider,connection.id,credentials.currency,daily,monthly,this.scope.subject,new Date().toISOString());
      this.audit('ads.policy');return this.read();}).immediate();
  }
  private normalize(raw:Record<string,unknown>,connectionId:string,currency:string){
    const policy=this.policy();if(!policy||policy.connection_id!==connectionId||policy.currency!==currency)throw new MarketingStoreError('Önce bu reklam hesabı için bütçe tavanı belirleyin.',409);
    const name=typeof raw.name==='string'?raw.name.trim():'';if(!name||name.length>100||/[\x00-\x1f]/.test(name))throw new MarketingStoreError('Plan adı 1–100 karakter olmalı.');
    if(!AD_OBJECTIVES.includes(raw.objective as never))throw new MarketingStoreError('Geçersiz reklam hedefi.');
    const category=raw.specialCategory===undefined?'NONE':raw.specialCategory;if(!AD_SPECIAL_CATEGORIES.includes(category as never))throw new MarketingStoreError('Geçersiz özel reklam kategorisi.');
    if(this.provider!=='meta'&&category!=='NONE')throw new MarketingStoreError('Özel reklam kategorisi yalnız Meta planlarında seçilebilir.');
    if(this.provider==='google'&&raw.objective!=='OUTCOME_TRAFFIC')throw new MarketingStoreError('Google Ads için yalnız site trafiği (Arama ağı) planları desteklenir.',409);
    const budget=raw.dailyBudgetMinor;if(!Number.isSafeInteger(budget)||(budget as number)<1)throw new MarketingStoreError('Günlük bütçe pozitif bir tutar olmalı.');
    if((budget as number)>policy.daily_cap_minor)throw new MarketingStoreError('Günlük bütçe projenin günlük tavanını aşıyor.',409);
    const start=String(raw.startDate),end=String(raw.endDate),today=new Date().toISOString().slice(0,10);
    if(!DATE.test(start)||!DATE.test(end)||Number.isNaN(Date.parse(start))||Number.isNaN(Date.parse(end))||start<today||end<start)throw new MarketingStoreError('Bugünden başlayan geçerli bir başlangıç ve bitiş tarihi girin.');
    const length=days(start,end);if(length>AD_LIMITS.maxDays)throw new MarketingStoreError('Bir plan en fazla 31 gün sürebilir.');
    if((budget as number)*length>policy.monthly_cap_minor)throw new MarketingStoreError('Planın toplam bütçesi aylık tavanı aşıyor.',409);
    const countries=Array.isArray(raw.countries)?[...new Set(raw.countries.map(item=>String(item).trim().toUpperCase()))]:[];
    if(!countries.length||countries.length>AD_LIMITS.countries||!countries.every(item=>COUNTRY.test(item)))throw new MarketingStoreError('1–10 geçerli ülke kodu girin (ör. TR).');
    let link:URL;try{link=new URL(String(raw.linkUrl));}catch{throw new MarketingStoreError('Geçerli bir https hedef bağlantısı girin.');}
    if(link.protocol!=='https:'||link.username||link.password||link.href.length>1000)throw new MarketingStoreError('Geçerli bir https hedef bağlantısı girin.');
    return {name,objective:raw.objective as typeof AD_OBJECTIVES[number],special_category:category as typeof AD_SPECIAL_CATEGORIES[number],daily_budget_minor:budget as number,currency,start_date:start,end_date:end,countries_json:JSON.stringify(countries),link_url:link.href,connection_id:connectionId};
  }
  // Drafts are written by the team. Editing a plan clears its approval; plans already on Meta cannot be edited here.
  savePlan(raw:Record<string,unknown>){
    this.authorize('content.write');const {connection,credentials}=this.credentials(),plan=this.normalize(raw,connection.id,credentials.currency),digest=digestOf(plan);
    return this.db.transaction(()=>{
      this.authorize('content.write');const now=new Date().toISOString();
      if(raw.id===undefined){
        if((this.db.prepare('SELECT COUNT(*) n FROM platform_ad_plans WHERE organization_id=? AND project_id=? AND provider=?').get(...this.args(),this.provider) as {n:number}).n>=AD_LIMITS.plans)throw new MarketingStoreError('Reklam planı sınırına ulaşıldı.',429);
        this.db.prepare("INSERT INTO platform_ad_plans(id,organization_id,project_id,provider,connection_id,name,objective,special_category,daily_budget_minor,currency,start_date,end_date,countries_json,link_url,state,digest,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?)").run(`adplan_${randomUUID()}`,...this.args(),this.provider,plan.connection_id,plan.name,plan.objective,plan.special_category,plan.daily_budget_minor,plan.currency,plan.start_date,plan.end_date,plan.countries_json,plan.link_url,digest,this.scope.subject,now,now);
        this.audit('ads.plan.create');return this.read();
      }
      const row=this.row(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Reklam planı başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      if(!['draft','approved'].includes(row.state))throw new MarketingStoreError('Meta’da oluşturulmuş bir plan burada düzenlenemez.',409);
      this.db.prepare("UPDATE platform_ad_plans SET connection_id=?,name=?,objective=?,special_category=?,daily_budget_minor=?,currency=?,start_date=?,end_date=?,countries_json=?,link_url=?,digest=?,state='draft',approved_by=NULL,approved_digest=NULL,approved_at=NULL,revision=revision+1,updated_at=? WHERE id=?").run(plan.connection_id,plan.name,plan.objective,plan.special_category,plan.daily_budget_minor,plan.currency,plan.start_date,plan.end_date,plan.countries_json,plan.link_url,digest,now,row.id);
      this.audit('ads.plan.update');return this.read();
    }).immediate();
  }
  private row(id:unknown){const row=typeof id==='string'?this.db.prepare('SELECT * FROM platform_ad_plans WHERE id=? AND organization_id=? AND project_id=? AND provider=?').get(id,...this.args(),this.provider) as Plan|undefined:undefined;if(!row)throw new MarketingStoreError('Reklam planı bulunamadı.',404);return row;}
  private approvedNow(row:Plan){return row.approved_digest===row.digest&&Boolean(row.approved_by&&this.repo.can(row.approved_by,...this.args(),'campaign.approve'));}
  approve(raw:Record<string,unknown>){
    this.authorize('campaign.approve');
    return this.db.transaction(()=>{const row=this.row(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Reklam planı başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      if(row.state!=='draft')throw new MarketingStoreError('Yalnız taslak planlar onaylanabilir.',409);
      this.db.prepare("UPDATE platform_ad_plans SET state='approved',approved_by=?,approved_digest=digest,approved_at=?,revision=revision+1,updated_at=? WHERE id=?").run(this.scope.subject,new Date().toISOString(),new Date().toISOString(),row.id);
      this.audit('ads.plan.approve');return this.read();}).immediate();
  }
  // Planned spend of plans that are delivering or about to: daily budget × remaining days, within the current month.
  private plannedActive(exclude?:string){
    const today=new Date().toISOString().slice(0,10),monthEnd=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()+1,0)).toISOString().slice(0,10);
    return (this.db.prepare("SELECT id,daily_budget_minor,start_date,end_date FROM platform_ad_plans WHERE organization_id=? AND project_id=? AND provider=? AND state IN ('active','starting')").all(...this.args(),this.provider) as {id:string;daily_budget_minor:number;start_date:string;end_date:string}[])
      .filter(item=>item.id!==exclude).reduce((sum,item)=>{const from=item.start_date>today?item.start_date:today,to=item.end_date<monthEnd?item.end_date:monthEnd;return sum+(to>=from?item.daily_budget_minor*days(from,to):0);},0);
  }
  // Creates the campaign and its ad set on Meta, both PAUSED. Creatives are added by the team in Ads Manager.
  async create(raw:Record<string,unknown>){
    this.authorize('manage');const row=this.row(raw.id);if(row.state!=='approved'||!this.approvedNow(row))throw new MarketingStoreError('Plan onaylı ve onaydan sonra değişmemiş olmalı.',409);
    const {connection,credentials}=this.credentials();if(connection.id!==row.connection_id)throw new MarketingStoreError('Plan başka bir reklam hesabına ait.',409);
    this.normalize({name:row.name,objective:row.objective,specialCategory:row.special_category,dailyBudgetMinor:row.daily_budget_minor,startDate:row.start_date,endDate:row.end_date,countries:JSON.parse(row.countries_json),linkUrl:row.link_url},connection.id,credentials.currency);
    // Claim the plan before any provider call: a second click or tab cannot create a second campaign.
    const claimed=this.db.transaction(()=>{this.authorize('manage');const current=this.row(row.id);if(current.state!=='approved'||!this.approvedNow(current)||current.digest!==row.digest)return 0;
      return this.db.prepare("UPDATE platform_ad_plans SET state='creating',updated_at=? WHERE id=? AND state='approved'").run(new Date().toISOString(),row.id).changes;}).immediate();
    if(!claimed)throw new MarketingStoreError('Plan şu anda oluşturuluyor veya onaydan sonra değişti. Sayfayı yenileyin.',409);
    if(this.provider!=='meta'){
      const token=await this.token(connection,credentials);let campaignId:string|null=null,groupId:string|null=null,error:string|null=null;
      try{const result=this.provider==='google'?await (this.client(credentials,token) as GoogleAdsClient).create(this.providerPlan(row),adMinorUnit(row.currency)):await (this.client(credentials,token) as LinkedInAdsClient).create(this.providerPlan(row),adMinorUnit(row.currency),this.repo.workspace(this.scope.subject,...this.args())?.project.language==='en'?'en':'tr');
        campaignId=result.campaignId;groupId=result.groupId;error=result.partial;}
      catch(reason){error=reason instanceof MarketingStoreError?reason.message:`${PROVIDER_NAME[this.provider]} üzerinde kampanya oluşturulamadı.`;}
      return this.db.transaction(()=>{const now=new Date().toISOString();
        this.db.prepare("UPDATE platform_ad_plans SET state=?,provider_campaign_id=?,provider_adset_id=?,last_error=?,revision=revision+1,updated_at=? WHERE id=? AND state='creating'").run(error?'failed':'created',campaignId,groupId,error,now,row.id);
        this.audit(error?'ads.plan.create_failed':'ads.plan.created');return this.read();}).immediate();
    }
    const countries=JSON.parse(row.countries_json) as string[],special=row.special_category==='NONE'?[]:[row.special_category];
    let campaignId='',adsetId='',error:string|null=null;
    try{
      const campaign=await this.graph('POST',`${credentials.adAccountId}/campaigns`,credentials.accessToken,{name:row.name,objective:row.objective,status:'PAUSED',special_ad_categories:JSON.stringify(special),...(special.length?{special_ad_category_country:JSON.stringify(countries)}:{}),is_adset_budget_sharing_enabled:'false'});
      campaignId=typeof campaign.id==='string'&&/^\d{1,25}$/.test(campaign.id)?campaign.id:'';if(!campaignId)throw new Error('no campaign');
      const adset=await this.graph('POST',`${credentials.adAccountId}/adsets`,credentials.accessToken,{name:`${row.name} · Ad set`,campaign_id:campaignId,daily_budget:String(row.daily_budget_minor),billing_event:'IMPRESSIONS',optimization_goal:row.objective==='OUTCOME_TRAFFIC'?'LINK_CLICKS':'REACH',bid_strategy:'LOWEST_COST_WITHOUT_CAP',...(row.objective==='OUTCOME_TRAFFIC'?{destination_type:'WEBSITE'}:{}),
        start_time:`${row.start_date}T00:00:00+0000`,end_time:`${row.end_date}T23:59:59+0000`,targeting:JSON.stringify({geo_locations:{countries},age_min:18,age_max:65}),status:'PAUSED'});
      adsetId=typeof adset.id==='string'&&/^\d{1,25}$/.test(adset.id)?adset.id:'';if(!adsetId)throw new Error('no ad set');
    }catch{error=campaignId?'Kampanya oluşturuldu ancak reklam seti oluşturulamadı; kampanya Meta’da duraklatılmış duruyor.':'Meta’da kampanya oluşturulamadı.';}
    return this.db.transaction(()=>{const now=new Date().toISOString();
      this.db.prepare("UPDATE platform_ad_plans SET state=?,provider_campaign_id=?,provider_adset_id=?,last_error=?,revision=revision+1,updated_at=? WHERE id=? AND state='creating'").run(error?'failed':'created',campaignId||null,adsetId||null,error,now,row.id);
      this.audit(error?'ads.plan.create_failed':'ads.plan.created');return this.read();}).immediate();
  }
  // Starting delivery: explicit acknowledgement, the server switch, an unchanged approval and the monthly cap.
  async start(raw:Record<string,unknown>){
    this.authorize('manage');const row=this.row(raw.id);
    if(raw.acknowledged!==true)throw new MarketingStoreError('Harcamayı başlatmak için açık onay gerekli.');
    if(!adsLaunchEnabled())throw new MarketingStoreError('Reklam yayınını başlatma bu sunucuda kapalı.',409);
    if(!['created','paused'].includes(row.state)||!row.provider_campaign_id||!row.provider_adset_id||!this.approvedNow(row))throw new MarketingStoreError('Plan reklam sağlayıcısında duraklatılmış olarak oluşturulmuş ve onayı geçerli olmalı.',409);
    const {connection,credentials}=this.credentials(row.connection_id),policy=this.policy();
    if(!policy||policy.connection_id!==row.connection_id||policy.currency!==row.currency||row.daily_budget_minor>policy.daily_cap_minor)throw new MarketingStoreError('Plan, güncel bütçe tavanının dışında.',409);
    const today=new Date().toISOString().slice(0,10);if(row.end_date<today)throw new MarketingStoreError('Planın bitiş tarihi geçti.',409);
    const monthEnd=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()+1,0)).toISOString().slice(0,10),from=row.start_date>today?row.start_date:today,to=row.end_date<monthEnd?row.end_date:monthEnd,own=to>=from?row.daily_budget_minor*days(from,to):0;
    // The cap is checked again and the plan claimed in one transaction, so two starts can never pass the cap together.
    const claimed=this.db.transaction(()=>{this.authorize('manage');const current=this.row(row.id);
      if(!['created','paused'].includes(current.state)||!this.approvedNow(current))return 'state';
      if(this.plannedActive(row.id)+own>policy.monthly_cap_minor)return 'cap';
      return this.db.prepare("UPDATE platform_ad_plans SET state='starting',updated_at=? WHERE id=? AND state IN ('created','paused')").run(new Date().toISOString(),row.id).changes?'ok':'state';}).immediate();
    if(claimed==='cap')throw new MarketingStoreError('Çalışan planlarla birlikte bu ayın planlanan harcaması aylık tavanı aşıyor.',409);
    if(claimed!=='ok')throw new MarketingStoreError('Plan şu anda başlatılıyor veya durumu değişti. Sayfayı yenileyin.',409);
    let error:string|null=null;
    if(this.provider!=='meta'){
      const token=await this.token(connection,credentials),client=this.client(credentials,token);
      try{await client.status(this.providerPlan(row),(this.provider==='google'?'ENABLED':'ACTIVE') as never);}catch{error=`${PROVIDER_NAME[this.provider]} yayını başlatmayı reddetti; plan duraklatılmış kabul edildi. Hesapta reklam içeriğini ve ödeme yöntemini kontrol edin.`;}
      if(error){try{await client.status(this.providerPlan(row),'PAUSED');}catch{/* the pause is retried by the team from the plan */}}
    }else{
    try{await this.graph('POST',row.provider_adset_id,credentials.accessToken,{status:'ACTIVE'});await this.graph('POST',row.provider_campaign_id,credentials.accessToken,{status:'ACTIVE'});}catch{error='Meta yayını başlatmayı reddetti; plan duraklatılmış kabul edildi. Reklam hesabında kreatif ve ödeme yöntemini kontrol edin.';}
    if(error){try{await this.graph('POST',row.provider_campaign_id,credentials.accessToken,{status:'PAUSED'});}catch{/* the pause is retried by the team from the plan */}}
    }
    return this.db.transaction(()=>{const now=new Date().toISOString();this.db.prepare("UPDATE platform_ad_plans SET state=?,last_error=?,revision=revision+1,updated_at=? WHERE id=? AND state='starting'").run(error?'paused':'active',error,now,row.id);this.audit(error?'ads.plan.start_failed':'ads.plan.start');return this.read();}).immediate();
  }
  // A claim left by an interrupted request is settled after 10 minutes. An interrupted start is treated as running, so
  // the pause button is shown; an interrupted create may have left a paused campaign at the provider.
  private settleStale(){
    const before=new Date(Date.now()-600000).toISOString(),now=new Date().toISOString();
    this.db.prepare("UPDATE platform_ad_plans SET state='failed',last_error=?,revision=revision+1,updated_at=? WHERE organization_id=? AND project_id=? AND provider=? AND state='creating' AND updated_at<?").run('Oluşturma yarıda kaldı; sağlayıcıda duraklatılmış bir kampanya oluşmuş olabilir. Hesabınızı kontrol edin.',now,...this.args(),this.provider,before);
    this.db.prepare("UPDATE platform_ad_plans SET state='active',last_error=?,revision=revision+1,updated_at=? WHERE organization_id=? AND project_id=? AND provider=? AND state='starting' AND updated_at<?").run('Başlatma yarıda kaldı; kampanya yayında olabilir. Gerekirse duraklatın ve sağlayıcıda kontrol edin.',now,...this.args(),this.provider,before);
  }
  // Pausing never needs the switch or approval: stopping spend is always allowed to every writer.
  async pause(raw:Record<string,unknown>){
    this.authorize('content.write');const row=this.row(raw.id);if(!row.provider_campaign_id)throw new MarketingStoreError('Plan reklam sağlayıcısında oluşturulmamış.',409);
    if(row.state==='starting')throw new MarketingStoreError('Plan şu anda başlatılıyor; birkaç saniye sonra tekrar duraklatın.',409);
    const {connection,credentials}=this.credentials(row.connection_id);let error:string|null=null;
    if(this.provider!=='meta'){try{await this.client(credentials,await this.token(connection,credentials)).status(this.providerPlan(row),'PAUSED');}catch{error=`${PROVIDER_NAME[this.provider]} duraklatma isteğini doğrulamadı. Hesabınızdan kampanyanın durumunu kontrol edin.`;}}
    else try{await this.graph('POST',row.provider_campaign_id,credentials.accessToken,{status:'PAUSED'});}catch{error='Meta duraklatma isteğini doğrulamadı. Ads Manager’dan kampanyanın durumunu kontrol edin.';}
    return this.db.transaction(()=>{const now=new Date().toISOString();this.db.prepare('UPDATE platform_ad_plans SET state=CASE WHEN ? IS NULL THEN \'paused\' ELSE state END,last_error=?,revision=revision+1,updated_at=? WHERE id=?').run(error,error,now,row.id);this.audit(error?'ads.plan.pause_failed':'ads.plan.pause');return this.read();}).immediate();
  }
  // Spend as Meta reports it for the campaign's lifetime; no estimate is made when Meta returns nothing.
  async refreshSpend(raw:Record<string,unknown>){
    this.authorize('read');const row=this.row(raw.id);if(!row.provider_campaign_id)throw new MarketingStoreError('Plan reklam sağlayıcısında oluşturulmamış.',409);
    const {connection,credentials}=this.credentials(row.connection_id);let spend:number|null=null,impressions:number|null=null,clicks:number|null=null;
    if(this.provider!=='meta'){
      try{const result=await this.client(credentials,await this.token(connection,credentials)).spend(this.providerPlan(row),adMinorUnit(row.currency));spend=result.spendMinor;impressions=result.impressions;clicks=result.clicks;}
      catch(reason){if(reason instanceof MarketingStoreError)throw reason;throw new MarketingStoreError(`${PROVIDER_NAME[this.provider]} harcama verisi şu anda alınamadı.`,502);}
      return this.db.transaction(()=>{this.db.prepare('UPDATE platform_ad_plans SET spend_minor=?,impressions=?,clicks=?,spend_checked_at=?,updated_at=? WHERE id=?').run(spend,impressions,clicks,new Date().toISOString(),new Date().toISOString(),row.id);return this.read();}).immediate();
    }
    const count=(value:unknown)=>typeof value==='string'&&/^\d{1,15}$/.test(value)?Number(value):null;
    try{const insights=await this.graph('GET',`${row.provider_campaign_id}/insights`,credentials.accessToken,{fields:'spend,impressions,clicks',date_preset:'maximum'}),first=(insights.data as Record<string,unknown>[]|undefined)?.[0];
      if(first&&typeof first.spend==='string'&&/^\d+(\.\d+)?$/.test(first.spend)){spend=Math.round(Number(first.spend)*adMinorUnit(row.currency));impressions=count(first.impressions);clicks=count(first.clicks);}
      else if(Array.isArray(insights.data)&&!insights.data.length){spend=0;impressions=0;clicks=0;}}catch{throw new MarketingStoreError('Meta harcama verisi şu anda alınamadı.',502);}
    return this.db.transaction(()=>{this.db.prepare('UPDATE platform_ad_plans SET spend_minor=?,impressions=?,clicks=?,spend_checked_at=?,updated_at=? WHERE id=?').run(spend,impressions,clicks,new Date().toISOString(),new Date().toISOString(),row.id);return this.read();}).immediate();
  }
  read():AdsSnapshot{
    this.authorize();this.settleStale();const connection=this.connection(),policy=this.policy();let account:AdsSnapshot['account']=null;
    let pendingVerification=false;
    if(connection){const credentials=decryptCredentials<AdCredentials>(connection.encrypted_credentials,this.key,...this.args(),connection.id);
      if(credentials.currency)account={connectionId:connection.id,adAccountId:credentials.adAccountId,name:credentials.name,currency:credentials.currency,status:typeof credentials.status==='number'?credentials.status:null,timezone:credentials.timezone,checkedAt:credentials.checkedAt};else pendingVerification=true;}
    const rows=this.db.prepare("SELECT * FROM platform_ad_plans WHERE organization_id=? AND project_id=? AND provider=? ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'created' THEN 1 WHEN 'paused' THEN 2 WHEN 'approved' THEN 3 WHEN 'draft' THEN 4 ELSE 5 END,updated_at DESC").all(...this.args(),this.provider) as Plan[];
    return {account,policy:policy?{currency:policy.currency,dailyCapMinor:policy.daily_cap_minor,monthlyCapMinor:policy.monthly_cap_minor,revision:policy.revision,updatedAt:policy.updated_at}:null,minorUnit:adMinorUnit(account?.currency||policy?.currency||'USD'),
      plans:rows.map((row):AdPlanView=>({id:row.id,name:row.name,objective:row.objective,specialCategory:row.special_category,dailyBudgetMinor:row.daily_budget_minor,currency:row.currency,startDate:row.start_date,endDate:row.end_date,days:days(row.start_date,row.end_date),totalMinor:row.daily_budget_minor*days(row.start_date,row.end_date),
        countries:JSON.parse(row.countries_json),linkUrl:row.link_url,state:row.state,approved:this.approvedNow(row),approvedAt:row.approved_at,providerCampaignId:row.provider_campaign_id,lastError:row.last_error,spendMinor:row.spend_minor,impressions:row.impressions,clicks:row.clicks,spendCheckedAt:row.spend_checked_at,revision:row.revision,updatedAt:row.updated_at})),
      plannedActiveMinor:this.plannedActive(),launchEnabled:adsLaunchEnabled(),canWrite:this.can('content.write'),canManage:this.manager(),canApprove:this.can('campaign.approve'),
      provider:this.provider,pendingVerification,providerReady:this.provider!=='google'||googleAdsConfigured()};
  }
}
