import 'server-only';
import { createPrivateKey, createSign } from 'node:crypto';
import { MarketingStoreError } from './marketing-store';

// Google Ads and LinkedIn ads clients for the ad manager. Fixed hosts, the token only in the Authorization header, and
// every object is created PAUSED. Creatives (ads, keywords) are added by the team in each provider's own tool.
export type AdProvider='meta'|'google'|'linkedin'|'tiktok'|'apple_search';
export const AD_PROVIDERS:AdProvider[]=['meta','google','linkedin','tiktok','apple_search'];
export const AD_CONNECTION:Record<AdProvider,'meta_ads'|'google_ads'|'linkedin_ads'|'tiktok_ads'|'apple_search_ads'>={meta:'meta_ads',google:'google_ads',linkedin:'linkedin_ads',tiktok:'tiktok_ads',apple_search:'apple_search_ads'};
export type AdHttp=(request:{method:'GET'|'POST'|'PUT';url:string;headers:Record<string,string>;body?:string|FormData})=>Promise<{status:number;header:(name:string)=>string|null;payload:Record<string,unknown>}>;
export const adHttp:AdHttp=async({method,url,headers,body})=>{
  const parsed=new URL(url);if(parsed.protocol!=='https:'||!['googleads.googleapis.com','api.linkedin.com','business-api.tiktok.com','api.searchads.apple.com','appleid.apple.com'].includes(parsed.hostname)||parsed.username||parsed.password||parsed.searchParams.has('access_token'))throw new Error('Invalid ad host.');
  const response=await fetch(parsed,{method,headers:{Accept:'application/json',...headers},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  const text=await response.text();let payload:Record<string,unknown>={};try{payload=text?JSON.parse(text.slice(0,262144)):{};}catch{payload={};}
  return {status:response.status,header:name=>response.headers.get(name),payload};
};
export type ProviderAccount={name:string;currency:string;status:string|null;timezone:string|null};
export type ProviderPlan={app_json?:string|null;id:string;name:string;objective:'OUTCOME_AWARENESS'|'OUTCOME_TRAFFIC'|'OUTCOME_APP_PROMOTION';daily_budget_minor:number;currency:string;start_date:string;end_date:string;countries_json:string;link_url:string;provider_campaign_id:string|null;provider_adset_id:string|null};
export type ProviderSpend={spendMinor:number;impressions:number|null;clicks:number|null};
// Spend per UTC day as the provider reports it, for the mobile report's CPI/ROAS (installs are matched by day).
export type ProviderDailySpend={day:string;spendMinor:number}[];
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const fail=(message:string,status=502)=>new MarketingStoreError(message,status);
const count=(value:unknown)=>typeof value==='string'&&/^\d{1,15}$/.test(value)?Number(value):typeof value==='number'&&Number.isSafeInteger(value)?value:null;

// Google Ads REST. Version and developer token come from the server; an optional manager (login) customer id too.
const googleVersion=()=>{const value=process.env.PLATFORM_GOOGLE_ADS_API_VERSION||'v23';return /^v\d{2}$/.test(value)?value:'v23';};
export const googleAdsConfigured=()=>/^[A-Za-z0-9_-]{10,64}$/.test(process.env.PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN||'');
export const googleCustomerId=(value:unknown)=>{const id=typeof value==='string'?value.replace(/-/g,'').trim():'';return /^\d{10}$/.test(id)?id:null;};
const CAMPAIGN_RESOURCE=/^customers\/\d{10}\/campaigns\/\d{1,20}$/,BUDGET_RESOURCE=/^customers\/\d{10}\/campaignBudgets\/\d{1,20}$/,GEO_RESOURCE=/^geoTargetConstants\/\d{1,12}$/;
export class GoogleAdsClient{
  constructor(public http:AdHttp,public customerId:string,public token:string){}
  private headers(){const headers:Record<string,string>={Authorization:`Bearer ${this.token}`,'developer-token':process.env.PLATFORM_GOOGLE_ADS_DEVELOPER_TOKEN||'','Content-Type':'application/json'};
    const login=googleCustomerId(process.env.PLATFORM_GOOGLE_ADS_LOGIN_CUSTOMER_ID||'');if(login)headers['login-customer-id']=login;return headers;}
  async call(path:'googleAds:search'|'campaignBudgets:mutate'|'campaigns:mutate'|'campaignCriteria:mutate',body:object){
    if(!googleAdsConfigured())throw fail('Google Ads geliştirici anahtarı bu sunucuda yapılandırılmamış.',503);
    const result=await this.http({method:'POST',url:`https://googleads.googleapis.com/${googleVersion()}/customers/${this.customerId}/${path}`,headers:this.headers(),body:JSON.stringify(body)});
    if(result.status!==200)throw new Error(`google_${result.status}`);return result.payload;
  }
  async search(query:string){const payload=await this.call('googleAds:search',{query});return (Array.isArray(payload.results)?payload.results:[]) as Record<string,Record<string,unknown>>[];}
  async account():Promise<ProviderAccount>{
    const row=(await this.search('SELECT customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status FROM customer LIMIT 1'))[0]?.customer;
    if(!row||typeof row.currencyCode!=='string'||!/^[A-Z]{3}$/.test(row.currencyCode))throw new Error('no customer');
    return {name:String(row.descriptiveName||this.customerId).slice(0,120),currency:row.currencyCode,status:typeof row.status==='string'?row.status:null,timezone:typeof row.timeZone==='string'?row.timeZone.slice(0,60):null};
  }
  private resource(payload:Record<string,unknown>,pattern:RegExp){const name=(payload.results as Record<string,unknown>[]|undefined)?.[0]?.resourceName;if(typeof name!=='string'||!pattern.test(name))throw new Error('no resource');return name;}
  // A Search campaign optimised for clicks (Maximize clicks), its own daily budget and the country targets, all PAUSED.
  async create(plan:ProviderPlan,minorUnit:number){
    if(plan.objective==='OUTCOME_APP_PROMOTION')return this.createApp(plan,minorUnit);
    if(plan.objective!=='OUTCOME_TRAFFIC')throw fail('Google Ads için site trafiği (Arama ağı) veya uygulama yükleme (App kampanyası) planları desteklenir.',409);
    const countries=JSON.parse(plan.countries_json) as string[],geo=(await this.search(`SELECT geo_target_constant.resource_name, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.country_code IN (${countries.map(code=>`'${code}'`).join(',')}) AND geo_target_constant.target_type = 'Country' AND geo_target_constant.status = 'ENABLED'`)).map(row=>row.geoTargetConstant?.resourceName).filter((name):name is string=>typeof name==='string'&&GEO_RESOURCE.test(name));
    if(geo.length!==countries.length)throw fail('Ülkelerden biri Google Ads konum listesinde bulunamadı.',409);
    const budget=this.resource(await this.call('campaignBudgets:mutate',{operations:[{create:{name:`${plan.name} · ${plan.id.slice(-8)}`,amountMicros:String(Math.round(plan.daily_budget_minor/minorUnit*1_000_000)),deliveryMethod:'STANDARD',explicitlyShared:false}}]}),BUDGET_RESOURCE);
    const campaign=this.resource(await this.call('campaigns:mutate',{operations:[{create:{name:plan.name,status:'PAUSED',advertisingChannelType:'SEARCH',campaignBudget:budget,targetSpend:{},
      networkSettings:{targetGoogleSearch:true,targetSearchNetwork:false,targetContentNetwork:false,targetPartnerSearchNetwork:false},startDateTime:`${plan.start_date} 00:00:00`,endDateTime:`${plan.end_date} 23:59:59`,containsEuPoliticalAdvertising:'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING'}}]}),CAMPAIGN_RESOURCE);
    try{await this.call('campaignCriteria:mutate',{operations:geo.map(geoTargetConstant=>({create:{campaign,location:{geoTargetConstant}}}))});}
    catch{return {campaignId:campaign,groupId:budget,partial:'Kampanya oluşturuldu ancak ülke hedefleri eklenemedi; kampanya Google Ads’te duraklatılmış duruyor.'};}
    return {campaignId:campaign,groupId:budget,partial:null};
  }
  // An App campaign (installs at a target cost per install) for the plan's app, its own budget and countries, PAUSED.
  // Its assets (texts, images, videos) are added by the team in Google Ads.
  private async createApp(plan:ProviderPlan,minorUnit:number){
    const app=planApp(plan);if(!app||!app.targetCostMinor)throw fail('Google App kampanyası için uygulama ve yükleme başına hedef maliyet gerekli.',409);
    const countries=JSON.parse(plan.countries_json) as string[],geo=(await this.search(`SELECT geo_target_constant.resource_name, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.country_code IN (${countries.map(code=>`'${code}'`).join(',')}) AND geo_target_constant.target_type = 'Country' AND geo_target_constant.status = 'ENABLED'`)).map(row=>row.geoTargetConstant?.resourceName).filter((name):name is string=>typeof name==='string'&&GEO_RESOURCE.test(name));
    if(geo.length!==countries.length)throw fail('Ülkelerden biri Google Ads konum listesinde bulunamadı.',409);
    const budget=this.resource(await this.call('campaignBudgets:mutate',{operations:[{create:{name:`${plan.name} · ${plan.id.slice(-8)}`,amountMicros:String(Math.round(plan.daily_budget_minor/minorUnit*1_000_000)),deliveryMethod:'STANDARD',explicitlyShared:false}}]}),BUDGET_RESOURCE);
    const campaign=this.resource(await this.call('campaigns:mutate',{operations:[{create:{name:plan.name,status:'PAUSED',advertisingChannelType:'MULTI_CHANNEL',advertisingChannelSubType:'APP_CAMPAIGN',campaignBudget:budget,
      appCampaignSetting:{appId:app.appId,appStore:app.store==='apple'?'APPLE_APP_STORE':'GOOGLE_APP_STORE',biddingStrategyGoalType:'OPTIMIZE_INSTALLS_TARGET_INSTALL_COST'},targetCpa:{targetCpaMicros:String(Math.round(app.targetCostMinor/minorUnit*1_000_000))},
      startDateTime:`${plan.start_date} 00:00:00`,endDateTime:`${plan.end_date} 23:59:59`,containsEuPoliticalAdvertising:'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING'}}]}),CAMPAIGN_RESOURCE);
    try{await this.call('campaignCriteria:mutate',{operations:geo.map(geoTargetConstant=>({create:{campaign,location:{geoTargetConstant}}}))});}
    catch{return {campaignId:campaign,groupId:budget,partial:'App kampanyası oluşturuldu ancak ülke hedefleri eklenemedi; kampanya Google Ads’te duraklatılmış duruyor.'};}
    return {campaignId:campaign,groupId:budget,partial:null};
  }
  async status(plan:ProviderPlan,status:'ENABLED'|'PAUSED'){if(!plan.provider_campaign_id||!CAMPAIGN_RESOURCE.test(plan.provider_campaign_id))throw new Error('no campaign');await this.call('campaigns:mutate',{operations:[{update:{resourceName:plan.provider_campaign_id,status},updateMask:'status'}]});}
  async spend(plan:ProviderPlan,minorUnit:number):Promise<ProviderSpend>{
    if(!plan.provider_campaign_id||!CAMPAIGN_RESOURCE.test(plan.provider_campaign_id))throw new Error('no campaign');
    const metrics=(await this.search(`SELECT metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign WHERE campaign.resource_name = '${plan.provider_campaign_id}'`))[0]?.metrics;
    if(!metrics)return {spendMinor:0,impressions:0,clicks:0};
    const micros=count(metrics.costMicros);if(micros===null)throw new Error('no cost');
    return {spendMinor:Math.round(micros/1_000_000*minorUnit),impressions:count(metrics.impressions),clicks:count(metrics.clicks)};
  }
  async dailySpend(plan:ProviderPlan,minorUnit:number,from:string,to:string):Promise<ProviderDailySpend>{
    if(!plan.provider_campaign_id||!CAMPAIGN_RESOURCE.test(plan.provider_campaign_id)||!DAY.test(from)||!DAY.test(to))throw new Error('no campaign');
    const rows=await this.search(`SELECT segments.date, metrics.cost_micros FROM campaign WHERE campaign.resource_name = '${plan.provider_campaign_id}' AND segments.date BETWEEN '${from}' AND '${to}'`);
    return rows.flatMap(row=>{const day=row.segments?.date,micros=count(row.metrics?.costMicros);return typeof day==='string'&&DAY.test(day)&&micros!==null?[{day,spendMinor:Math.round(micros/1_000_000*minorUnit)}]:[];});
  }
}

// LinkedIn Marketing API (versioned REST, Rest.li 2.0). Campaigns are text ads with automatic bidding, created PAUSED
// inside their own PAUSED campaign group. Locations come from LinkedIn's own location facet, matched by country name.
const linkedInVersion=()=>{const value=process.env.PLATFORM_LINKEDIN_ADS_VERSION||'202610';return /^20\d{4}$/.test(value)?value:'202610';};
export const linkedInAccountId=(value:unknown)=>{const id=typeof value==='string'?value.trim().replace(/^urn:li:sponsoredAccount:/,''):'';return /^\d{5,15}$/.test(id)?id:null;};
const LI_ID=/^\d{1,20}$/;
export class LinkedInAdsClient{
  constructor(public http:AdHttp,public accountId:string,public token:string){}
  private headers(extra:Record<string,string>={}){return {Authorization:`Bearer ${this.token}`,'Linkedin-Version':linkedInVersion(),'X-Restli-Protocol-Version':'2.0.0','Content-Type':'application/json',...extra};}
  private async request(method:'GET'|'POST',path:string,body?:object,extra:Record<string,string>={}){
    const result=await this.http({method,url:`https://api.linkedin.com/rest/${path}`,headers:this.headers(extra),body:body?JSON.stringify(body):undefined});
    if(result.status<200||result.status>=300)throw new Error(`linkedin_${result.status}`);return result;
  }
  async account():Promise<ProviderAccount>{
    const {payload}=await this.request('GET',`adAccounts/${this.accountId}`);
    if(typeof payload.currency!=='string'||!/^[A-Z]{3}$/.test(payload.currency))throw new Error('no account');
    return {name:String(payload.name||this.accountId).slice(0,120),currency:payload.currency,status:typeof payload.status==='string'?payload.status:null,timezone:null};
  }
  private async geo(countries:string[]){
    const {payload}=await this.request('GET','adTargetingEntities?q=adTargetingFacet&queryVersion=QUERY_USES_URNS&facet=urn%3Ali%3AadTargetingFacet%3Alocations');
    const names=new Intl.DisplayNames(['en'],{type:'region'}),elements=(Array.isArray(payload.elements)?payload.elements:[]) as Record<string,unknown>[];
    // Country names change over time (Turkey → Türkiye); both spellings are accepted, nothing else is guessed.
    const aliases:Record<string,string[]>={TR:['turkey','türkiye','turkiye']};
    return countries.map(code=>{const want=[(names.of(code)||'').toLowerCase(),...(aliases[code]||[])],match=elements.find(item=>typeof item.name==='string'&&want.includes(item.name.toLowerCase())&&typeof item.urn==='string'&&/^urn:li:geo:\d{1,15}$/.test(item.urn));return match?.urn as string|undefined;});
  }
  private id(result:{header:(name:string)=>string|null}){const raw=(result.header('x-restli-id')||result.header('x-linkedin-id')||'').replace(/^urn:li:sponsored(Campaign|CampaignGroup):/,'');if(!LI_ID.test(raw))throw new Error('no id');return raw;}
  async create(plan:ProviderPlan,minorUnit:number,language:'tr'|'en'){
    const countries=JSON.parse(plan.countries_json) as string[],geo=await this.geo(countries);
    if(geo.some(item=>!item))throw fail('Ülkelerden biri LinkedIn konum listesinde bulunamadı.',409);
    const account=`urn:li:sponsoredAccount:${this.accountId}`,start=Date.parse(`${plan.start_date}T00:00:00Z`),end=Date.parse(`${plan.end_date}T23:59:59Z`)+1000;
    const group=this.id(await this.request('POST',`adAccounts/${this.accountId}/adCampaignGroups`,{account,name:plan.name,status:'PAUSED',runSchedule:{start,end}}));
    const awareness=plan.objective==='OUTCOME_AWARENESS',amount=(plan.daily_budget_minor/minorUnit).toFixed(minorUnit===1?0:2);
    let campaign:string;
    try{campaign=this.id(await this.request('POST',`adAccounts/${this.accountId}/adCampaigns`,{account,campaignGroup:`urn:li:sponsoredCampaignGroup:${group}`,name:plan.name,type:'TEXT_AD',
      objectiveType:awareness?'BRAND_AWARENESS':'WEBSITE_VISITS',costType:awareness?'CPM':'CPC',optimizationTargetType:awareness?'MAX_IMPRESSION':'MAX_CLICK',dailyBudget:{amount,currencyCode:plan.currency},
      locale:language==='tr'?{country:'TR',language:'tr'}:{country:'US',language:'en'},offsiteDeliveryEnabled:false,runSchedule:{start,end},
      targetingCriteria:{include:{and:[{or:{'urn:li:adTargetingFacet:locations':geo}}]}},status:'PAUSED'}));}
    catch{return {campaignId:null,groupId:group,partial:'Kampanya grubu oluşturuldu ancak kampanya oluşturulamadı; grup LinkedIn’de duraklatılmış duruyor.'};}
    return {campaignId:campaign,groupId:group,partial:null};
  }
  private async set(kind:'adCampaigns'|'adCampaignGroups',id:string,status:'ACTIVE'|'PAUSED'){if(!LI_ID.test(id))throw new Error('no id');await this.request('POST',`adAccounts/${this.accountId}/${kind}/${id}`,{patch:{$set:{status}}},{'X-RestLi-Method':'PARTIAL_UPDATE'});}
  async status(plan:ProviderPlan,status:'ACTIVE'|'PAUSED'){
    if(!plan.provider_campaign_id||!plan.provider_adset_id)throw new Error('no campaign');
    if(status==='ACTIVE'){await this.set('adCampaignGroups',plan.provider_adset_id,'ACTIVE');await this.set('adCampaigns',plan.provider_campaign_id,'ACTIVE');}
    else await this.set('adCampaigns',plan.provider_campaign_id,'PAUSED');
  }
  async spend(plan:ProviderPlan,minorUnit:number):Promise<ProviderSpend>{
    if(!plan.provider_campaign_id||!LI_ID.test(plan.provider_campaign_id))throw new Error('no campaign');
    const [year,month,day]=plan.start_date.split('-').map(Number);
    const {payload}=await this.request('GET',`adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL&dateRange=(start:(year:${year},month:${month},day:${day}))&campaigns=List(urn%3Ali%3AsponsoredCampaign%3A${plan.provider_campaign_id})&fields=costInLocalCurrency,impressions,clicks`);
    const first=(Array.isArray(payload.elements)?payload.elements:[])[0] as Record<string,unknown>|undefined;if(!first)return {spendMinor:0,impressions:0,clicks:0};
    const cost=typeof first.costInLocalCurrency==='string'&&/^\d+(\.\d+)?$/.test(first.costInLocalCurrency)?Number(first.costInLocalCurrency):null;if(cost===null)throw new Error('no cost');
    return {spendMinor:Math.round(cost*minorUnit),impressions:count(first.impressions),clicks:count(first.clicks)};
  }
  async dailySpend(plan:ProviderPlan,minorUnit:number,from:string,to:string):Promise<ProviderDailySpend>{
    if(!plan.provider_campaign_id||!LI_ID.test(plan.provider_campaign_id)||!DAY.test(from)||!DAY.test(to))throw new Error('no campaign');
    const [fy,fm,fd]=from.split('-').map(Number),[ty,tm,td]=to.split('-').map(Number);
    const {payload}=await this.request('GET',`adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY&dateRange=(start:(year:${fy},month:${fm},day:${fd}),end:(year:${ty},month:${tm},day:${td}))&campaigns=List(urn%3Ali%3AsponsoredCampaign%3A${plan.provider_campaign_id})&fields=costInLocalCurrency,dateRange`);
    return (Array.isArray(payload.elements)?payload.elements:[]).flatMap(value=>{
      const item=value as Record<string,unknown>,start=(item.dateRange as {start?:{year?:number;month?:number;day?:number}}|undefined)?.start;
      const cost=typeof item.costInLocalCurrency==='string'&&/^\d+(\.\d+)?$/.test(item.costInLocalCurrency)?Number(item.costInLocalCurrency):null;
      if(!start||!Number.isInteger(start.year)||!Number.isInteger(start.month)||!Number.isInteger(start.day)||cost===null)return [];
      return [{day:`${start.year}-${String(start.month).padStart(2,'0')}-${String(start.day).padStart(2,'0')}`,spendMinor:Math.round(cost*minorUnit)}];
    });
  }
}

// The promoted app of an app-install plan: the store, the store's app id (Apple's numeric id or the Android package),
// its store address, Meta's app id (Meta plans) and a target cost per install (Google App campaigns).
export type PlanApp={store:'apple'|'google';appId:string;storeUrl:string;metaApplicationId?:string;targetCostMinor?:number};
export const planApp=(plan:{app_json?:string|null})=>plan.app_json?JSON.parse(plan.app_json) as PlanApp:null;

// TikTok Marketing API (v1.3). The campaign is created DISABLE with its daily budget; ad groups and ads are added by
// the team in TikTok Ads Manager. The token is a long-lived Business API access token for the advertiser.
const TT_ID=/^\d{1,25}$/;
const TT_OBJECTIVE:Record<ProviderPlan['objective'],string>={OUTCOME_AWARENESS:'REACH',OUTCOME_TRAFFIC:'TRAFFIC',OUTCOME_APP_PROMOTION:'APP_PROMOTION'};
export const tiktokAdvertiserId=(value:unknown)=>{const id=typeof value==='string'?value.trim():'';return TT_ID.test(id)?id:null;};
export class TikTokAdsClient{
  constructor(public http:AdHttp,public advertiserId:string,public token:string){}
  private async request(method:'GET'|'POST',path:string,data:Record<string,unknown>={}){
    const url=new URL(`https://business-api.tiktok.com/open_api/v1.3/${path}`);
    if(method==='GET')for(const [key,value] of Object.entries(data))url.searchParams.set(key,typeof value==='string'?value:JSON.stringify(value));
    const result=await this.http({method,url:url.href,headers:{'Access-Token':this.token,'Content-Type':'application/json'},body:method==='POST'?JSON.stringify(data):undefined});
    if(result.status!==200||result.payload.code!==0)throw new Error(`tiktok_${result.status}_${String(result.payload.code)}`);
    return (result.payload.data||{}) as Record<string,unknown>;
  }
  async account():Promise<ProviderAccount>{
    const row=((await this.request('GET','advertiser/info/',{advertiser_ids:[this.advertiserId]})).list as Record<string,unknown>[]|undefined)?.[0];
    if(!row||typeof row.currency!=='string'||!/^[A-Z]{3}$/.test(row.currency))throw new Error('no advertiser');
    return {name:String(row.name||this.advertiserId).slice(0,120),currency:row.currency,status:typeof row.status==='string'?row.status:null,timezone:typeof row.timezone==='string'?row.timezone.slice(0,60):null};
  }
  async create(plan:ProviderPlan,minorUnit:number){
    const data=await this.request('POST','campaign/create/',{advertiser_id:this.advertiserId,campaign_name:plan.name,objective_type:TT_OBJECTIVE[plan.objective],budget_mode:'BUDGET_MODE_DAY',budget:plan.daily_budget_minor/minorUnit,operation_status:'DISABLE',...(plan.objective==='OUTCOME_APP_PROMOTION'?{app_promotion_type:'APP_INSTALL'}:{})});
    const id=String(data.campaign_id||'');if(!TT_ID.test(id))throw new Error('no campaign');
    // The campaign is its own "group" here: TikTok's ad groups are made in Ads Manager.
    return {campaignId:id,groupId:id,partial:null};
  }
  async status(plan:ProviderPlan,status:'ENABLE'|'DISABLE'){if(!plan.provider_campaign_id||!TT_ID.test(plan.provider_campaign_id))throw new Error('no campaign');await this.request('POST','campaign/status/update/',{advertiser_id:this.advertiserId,campaign_ids:[plan.provider_campaign_id],operation_status:status});}
  private async report(plan:ProviderPlan,daily:boolean,from:string,to:string){
    if(!plan.provider_campaign_id||!TT_ID.test(plan.provider_campaign_id))throw new Error('no campaign');
    return ((await this.request('GET','report/integrated/get/',{advertiser_id:this.advertiserId,report_type:'BASIC',data_level:'AUCTION_CAMPAIGN',dimensions:daily?['campaign_id','stat_time_day']:['campaign_id'],metrics:['spend','impressions','clicks'],
      ...(daily?{start_date:from,end_date:to}:{query_lifetime:true}),filtering:[{field_name:'campaign_ids',filter_type:'IN',filter_value:JSON.stringify([plan.provider_campaign_id])}],page_size:100})).list||[]) as {dimensions?:Record<string,unknown>;metrics?:Record<string,unknown>}[];
  }
  async spend(plan:ProviderPlan,minorUnit:number):Promise<ProviderSpend>{
    const row=(await this.report(plan,false,'',''))[0]?.metrics;if(!row)return {spendMinor:0,impressions:0,clicks:0};
    const spend=typeof row.spend==='string'&&/^\d+(\.\d+)?$/.test(row.spend)?Number(row.spend):null;if(spend===null)throw new Error('no spend');
    return {spendMinor:Math.round(spend*minorUnit),impressions:count(row.impressions),clicks:count(row.clicks)};
  }
  async dailySpend(plan:ProviderPlan,minorUnit:number,from:string,to:string):Promise<ProviderDailySpend>{
    if(!DAY.test(from)||!DAY.test(to))throw new Error('no range');
    return (await this.report(plan,true,from,to)).flatMap(row=>{const day=String(row.dimensions?.stat_time_day||'').slice(0,10),spend=row.metrics?.spend;
      return DAY.test(day)&&typeof spend==='string'&&/^\d+(\.\d+)?$/.test(spend)?[{day,spendMinor:Math.round(Number(spend)*minorUnit)}]:[];});
  }
}

// Apple Search Ads Campaign Management API (v5). The team creates an API user in Apple's tool and enters its client id,
// team id, key id and EC private key; Ryzevo signs a short client secret (ES256) and takes a one-hour token for each
// request. The token is never stored. The campaign is created PAUSED; ad groups and keywords are added in Apple's tool.
export type AppleSearchCredentials={clientId:string;teamId:string;keyId:string;privateKey:string};
export function normalizeAppleSearch(raw:Record<string,unknown>):AppleSearchCredentials{
  const field=(key:string,pattern:RegExp)=>{const value=typeof raw[key]==='string'?(raw[key] as string).trim():'';if(!pattern.test(value))throw fail('Apple Search Ads API bilgileri eksik veya biçimi hatalı.',400);return value;};
  const privateKey=typeof raw.privateKey==='string'?raw.privateKey.trim():'';
  try{const key=createPrivateKey(privateKey);if(key.asymmetricKeyType!=='ec')throw new Error();}catch{throw fail('Apple Search Ads özel anahtarı (EC, PEM) okunamadı.',400);}
  return {clientId:field('clientId',/^SEARCHADS\.[A-Za-z0-9-]{8,80}$/),teamId:field('teamId',/^SEARCHADS\.[A-Za-z0-9-]{8,80}$/),keyId:field('keyId',/^[A-Za-z0-9-]{8,80}$/),privateKey};
}
export async function appleSearchToken(http:AdHttp,credentials:AppleSearchCredentials){
  const now=Math.floor(Date.now()/1000),encode=(value:object)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=`${encode({alg:'ES256',kid:credentials.keyId,typ:'JWT'})}.${encode({iss:credentials.teamId,sub:credentials.clientId,aud:'https://appleid.apple.com',iat:now,exp:now+3600})}`;
  const signature=createSign('SHA256').update(unsigned).sign({key:createPrivateKey(credentials.privateKey),dsaEncoding:'ieee-p1363'}).toString('base64url');
  const result=await http({method:'POST',url:'https://appleid.apple.com/auth/oauth2/token',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:credentials.clientId,client_secret:`${unsigned}.${signature}`,scope:'searchadsorg'}).toString()});
  const token=result.payload.access_token;if(result.status!==200||typeof token!=='string'||!token||token.length>8192)throw new Error('apple_token');
  return token;
}
const AS_ID=/^\d{1,20}$/;
export class AppleSearchAdsClient{
  constructor(public http:AdHttp,public orgId:string,public token:string){}
  private async request(method:'GET'|'POST'|'PUT',path:string,body?:object){
    const result=await this.http({method,url:`https://api.searchads.apple.com/api/v5/${path}`,headers:{Authorization:`Bearer ${this.token}`,'X-AP-Context':`orgId=${this.orgId}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    if(result.status<200||result.status>=300)throw new Error(`apple_${result.status}`);return result.payload;
  }
  async account():Promise<ProviderAccount>{
    const row=((await this.request('GET','acls')).data as Record<string,unknown>[]|undefined)?.find(item=>String(item.orgId)===this.orgId);
    if(!row||typeof row.currency!=='string'||!/^[A-Z]{3}$/.test(row.currency))throw new Error('no org');
    return {name:String(row.orgName||this.orgId).slice(0,120),currency:row.currency,status:typeof row.paymentModel==='string'?row.paymentModel:null,timezone:typeof row.timeZone==='string'?row.timeZone.slice(0,60):null};
  }
  async create(plan:ProviderPlan,minorUnit:number){
    const app=planApp(plan);if(plan.objective!=='OUTCOME_APP_PROMOTION'||app?.store!=='apple'||!/^\d{5,15}$/.test(app.appId))throw fail('Apple Search Ads yalnız App Store uygulaması için uygulama yükleme planı kabul eder.',409);
    const amount={amount:(plan.daily_budget_minor/minorUnit).toFixed(minorUnit===1?0:2),currency:plan.currency};
    const data=(await this.request('POST','campaigns',{orgId:Number(this.orgId),name:plan.name,adamId:Number(app.appId),countriesOrRegions:JSON.parse(plan.countries_json),dailyBudgetAmount:amount,
      supplySources:['APPSTORE_SEARCH_RESULTS'],adChannelType:'SEARCH',billingEvent:'TAPS',startTime:`${plan.start_date}T00:00:00.000`,endTime:`${plan.end_date}T23:59:59.000`,status:'PAUSED'})).data as Record<string,unknown>|undefined;
    const id=String(data?.id||'');if(!AS_ID.test(id))throw new Error('no campaign');
    return {campaignId:id,groupId:id,partial:null};
  }
  async status(plan:ProviderPlan,status:'ENABLED'|'PAUSED'){if(!plan.provider_campaign_id||!AS_ID.test(plan.provider_campaign_id))throw new Error('no campaign');await this.request('PUT',`campaigns/${plan.provider_campaign_id}`,{campaign:{status}});}
  private async report(plan:ProviderPlan,from:string,to:string,daily:boolean){
    if(!plan.provider_campaign_id||!AS_ID.test(plan.provider_campaign_id))throw new Error('no campaign');
    const payload=await this.request('POST','reports/campaigns',{startTime:from,endTime:to,...(daily?{granularity:'DAILY'}:{}),selector:{conditions:[{field:'campaignId',operator:'EQUALS',values:[plan.provider_campaign_id]}],orderBy:[{field:'campaignId',sortOrder:'ASCENDING'}],pagination:{offset:0,limit:10}},returnRowTotals:!daily,returnRecordsWithNoMetrics:true});
    return ((((payload.data as Record<string,unknown>|undefined)?.reportingDataResponse as Record<string,unknown>|undefined)?.row||[]) as Record<string,unknown>[])[0];
  }
  async spend(plan:ProviderPlan,minorUnit:number):Promise<ProviderSpend>{
    const row=await this.report(plan,plan.start_date,new Date().toISOString().slice(0,10),false),total=(row?.total||{}) as Record<string,unknown>,spend=Number((total.localSpend as {amount?:unknown}|undefined)?.amount);
    if(!row)return {spendMinor:0,impressions:0,clicks:0};if(!Number.isFinite(spend)||spend<0)throw new Error('no spend');
    return {spendMinor:Math.round(spend*minorUnit),impressions:count(total.impressions),clicks:count(total.taps)};
  }
  async dailySpend(plan:ProviderPlan,minorUnit:number,from:string,to:string):Promise<ProviderDailySpend>{
    if(!DAY.test(from)||!DAY.test(to))throw new Error('no range');
    return (((await this.report(plan,from,to,true))?.granularity||[]) as Record<string,unknown>[]).flatMap(item=>{const day=String(item.date||'').slice(0,10),spend=Number((item.localSpend as {amount?:unknown}|undefined)?.amount);return DAY.test(day)&&Number.isFinite(spend)&&spend>=0?[{day,spendMinor:Math.round(spend*minorUnit)}]:[];});
  }
}
