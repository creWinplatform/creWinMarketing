import 'server-only';
import { MarketingStoreError } from './marketing-store';

// Google Ads and LinkedIn ads clients for the ad manager. Fixed hosts, the token only in the Authorization header, and
// every object is created PAUSED. Creatives (ads, keywords) are added by the team in each provider's own tool.
export type AdProvider='meta'|'google'|'linkedin';
export const AD_PROVIDERS:AdProvider[]=['meta','google','linkedin'];
export const AD_CONNECTION:Record<AdProvider,'meta_ads'|'google_ads'|'linkedin_ads'>={meta:'meta_ads',google:'google_ads',linkedin:'linkedin_ads'};
export type AdHttp=(request:{method:'GET'|'POST';url:string;headers:Record<string,string>;body?:string})=>Promise<{status:number;header:(name:string)=>string|null;payload:Record<string,unknown>}>;
export const adHttp:AdHttp=async({method,url,headers,body})=>{
  const parsed=new URL(url);if(parsed.protocol!=='https:'||!['googleads.googleapis.com','api.linkedin.com'].includes(parsed.hostname)||parsed.username||parsed.password||parsed.searchParams.has('access_token'))throw new Error('Invalid ad host.');
  const response=await fetch(parsed,{method,headers:{Accept:'application/json',...headers},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  const text=await response.text();let payload:Record<string,unknown>={};try{payload=text?JSON.parse(text.slice(0,262144)):{};}catch{payload={};}
  return {status:response.status,header:name=>response.headers.get(name),payload};
};
export type ProviderAccount={name:string;currency:string;status:string|null;timezone:string|null};
export type ProviderPlan={id:string;name:string;objective:'OUTCOME_AWARENESS'|'OUTCOME_TRAFFIC';daily_budget_minor:number;currency:string;start_date:string;end_date:string;countries_json:string;link_url:string;provider_campaign_id:string|null;provider_adset_id:string|null};
export type ProviderSpend={spendMinor:number;impressions:number|null;clicks:number|null};
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
    if(plan.objective!=='OUTCOME_TRAFFIC')throw fail('Google Ads için yalnız site trafiği (Arama ağı) planları desteklenir.',409);
    const countries=JSON.parse(plan.countries_json) as string[],geo=(await this.search(`SELECT geo_target_constant.resource_name, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.country_code IN (${countries.map(code=>`'${code}'`).join(',')}) AND geo_target_constant.target_type = 'Country' AND geo_target_constant.status = 'ENABLED'`)).map(row=>row.geoTargetConstant?.resourceName).filter((name):name is string=>typeof name==='string'&&GEO_RESOURCE.test(name));
    if(geo.length!==countries.length)throw fail('Ülkelerden biri Google Ads konum listesinde bulunamadı.',409);
    const budget=this.resource(await this.call('campaignBudgets:mutate',{operations:[{create:{name:`${plan.name} · ${plan.id.slice(-8)}`,amountMicros:String(Math.round(plan.daily_budget_minor/minorUnit*1_000_000)),deliveryMethod:'STANDARD',explicitlyShared:false}}]}),BUDGET_RESOURCE);
    const campaign=this.resource(await this.call('campaigns:mutate',{operations:[{create:{name:plan.name,status:'PAUSED',advertisingChannelType:'SEARCH',campaignBudget:budget,targetSpend:{},
      networkSettings:{targetGoogleSearch:true,targetSearchNetwork:false,targetContentNetwork:false,targetPartnerSearchNetwork:false},startDateTime:`${plan.start_date} 00:00:00`,endDateTime:`${plan.end_date} 23:59:59`,containsEuPoliticalAdvertising:'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING'}}]}),CAMPAIGN_RESOURCE);
    try{await this.call('campaignCriteria:mutate',{operations:geo.map(geoTargetConstant=>({create:{campaign,location:{geoTargetConstant}}}))});}
    catch{return {campaignId:campaign,groupId:budget,partial:'Kampanya oluşturuldu ancak ülke hedefleri eklenemedi; kampanya Google Ads’te duraklatılmış duruyor.'};}
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
}
