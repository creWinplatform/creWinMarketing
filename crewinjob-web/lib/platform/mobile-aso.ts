import 'server-only';
import { createHash,randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { MarketingStoreError } from './errors';
import { assertProjectDelivery,assertProjectWork,projectEntitlement } from './entitlements';
import { mobileDay,mobileId,mobileRecord } from './mobile-validation';
import { mobileGoogleAccess,readPlayListing,type MobileSecret,type MobileTransport } from './mobile-providers';
import { ANDROID_FIELDS,IOS_FIELDS,appStoreLookup,appStoreRank,readAppStoreListing,readSkanReport,writeAppStoreListing,writePlayListing,type SkanRow } from './mobile-aso-providers';
import { mobileRevision,type MobileGrowth } from './mobile-store';
import { maskPersonal } from './messaging-sources';
import { COACH_BANNED,coachClip,coachObject,type CoachGenerator } from './coach';
import { parseCoachJson,runCoachAi } from './coach-ai';
import type { MobileApp,MobileKeyword,MobileListingDraft,MobileSkanReport } from './mobile-types';

export const ASO_LIMITS={keywords:30,checksPerRun:10,skanDays:90,drafts:20,historyDays:400,competitors:5} as const;
export const listingPublishEnabled=()=>process.env.PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED==='1';
const today=()=>new Date().toISOString().slice(0,10);
// Provider clients throw plain errors whose message is a code; read it without relying on the Error realm.
const errorCode=(error:unknown)=>typeof (error as {message?:unknown})?.message==='string'?(error as {message:string}).message:'';
const dayOffset=(days:number)=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
type KeywordRow={id:string;term:string;country:string;checked_on:string|null};
type DraftRow={id:string;app_id:string;store:'ios'|'android';locale:string;fields_json:string;digest:string;state:MobileListingDraft['state'];revision:number;approved_digest:string|null;approved_at:string|null;published_at:string|null;last_error:string|null;created_at:string;updated_at:string};
type Rank={rank:number|null;resultCount:number;leaders:{id:string;name:string}[];competitors?:Record<string,number|null>};
const competitorIds=(db:Database.Database,appId:string)=>(db.prepare('SELECT apple_id FROM platform_mobile_competitors WHERE app_id=? ORDER BY created_at,apple_id').all(appId) as {apple_id:string}[]).map(row=>row.apple_id);

export function normalizeTerm(value:unknown){
  const term=typeof value==='string'?value.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('tr'):'';
  if(!term||[...term].length>100||/[\x00-\x1f]/.test(term))throw new MarketingStoreError('Anahtar kelime 1–100 karakter olmalı.');return term;
}
function recordRank(db:Database.Database,keywordId:string,result:Rank|null){
  const now=new Date().toISOString(),day=now.slice(0,10);
  if(result)db.prepare('INSERT INTO platform_mobile_keyword_ranks(keyword_id,day,rank,result_count,leaders_json,checked_at,competitors_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(keyword_id,day) DO UPDATE SET rank=excluded.rank,result_count=excluded.result_count,leaders_json=excluded.leaders_json,checked_at=excluded.checked_at,competitors_json=excluded.competitors_json').run(keywordId,day,result.rank,result.resultCount,JSON.stringify(result.leaders),now,JSON.stringify(result.competitors||{}));
  db.prepare('UPDATE platform_mobile_keywords SET checked_on=? WHERE id=?').run(day,keywordId);
  db.prepare('DELETE FROM platform_mobile_keyword_ranks WHERE keyword_id=? AND day<?').run(keywordId,dayOffset(-ASO_LIMITS.historyDays));
}
// The worker checks a few terms per tick, once a day each. A failed check is not retried that day.
export async function refreshDueKeywordRanks(db:Database.Database,read:MobileTransport=fetch,limit=5){
  const due=db.prepare("SELECT k.id,k.app_id,k.term,k.country,k.organization_id,k.project_id,a.config_json FROM platform_mobile_keywords k JOIN platform_mobile_apps a ON a.id=k.app_id AND a.organization_id=k.organization_id AND a.project_id=k.project_id JOIN platform_projects p ON p.id=k.project_id AND p.organization_id=k.organization_id AND p.product_pack='standard' WHERE k.checked_on IS NULL OR k.checked_on<? ORDER BY k.checked_on IS NOT NULL,k.checked_on,k.id LIMIT ?").all(today(),limit) as {id:string;app_id:string;term:string;country:string;organization_id:string;project_id:string;config_json:string}[];
  let checked=0;
  for(const row of due){
    let result:Rank|null=null;
    try{if(projectEntitlement(db,{organizationId:row.organization_id,projectId:row.project_id}).active)result=await appStoreRank(JSON.parse(row.config_json) as MobileApp,row.term,row.country,read,competitorIds(db,row.app_id));}catch{result=null;}
    recordRank(db,row.id,result);if(result)checked++;
  }
  return checked;
}
const fieldLimits=(store:'ios'|'android'):Record<string,number>=>store==='ios'?IOS_FIELDS:ANDROID_FIELDS;
const LONG=new Set(['description','whatsNew','promotionalText','fullDescription']);
// Only the fields the team filled in are written; an empty field leaves the store's text as it is.
export function normalizeListing(store:'ios'|'android',raw:unknown){
  const value=mobileRecord(raw),limits=fieldLimits(store),fields:Record<string,string>={};
  for(const [key,limit] of Object.entries(limits)){
    if(value[key]===undefined||value[key]===null)continue;if(typeof value[key]!=='string')throw new MarketingStoreError('Mağaza alanları metin olmalı.');
    let text=(value[key] as string).normalize('NFC').replace(/\r\n/g,'\n').trim();if(!text)continue;
    if(key==='keywords')text=[...new Set(text.split(',').map(item=>item.trim()).filter(Boolean))].join(',');
    if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)||!LONG.has(key)&&text.includes('\n'))throw new MarketingStoreError('Mağaza alanlarında kontrol karakteri olamaz; satır sonu yalnız uzun metinlerde kullanılabilir.');
    if([...text].length>limit)throw new MarketingStoreError(`Mağaza alanı sınırı aşıldı: ${key} en çok ${limit} karakter.`);
    fields[key]=text;
  }
  if(!Object.keys(fields).length)throw new MarketingStoreError('En az bir mağaza alanını doldurun.');
  return fields;
}
// ASO checks on the draft text. They are observations, not ranking promises.
export function listingChecks(store:'ios'|'android',fields:Record<string,string>){
  const checks:{code:string;evidence:string}[]=[],words=(value='')=>value.toLocaleLowerCase('tr').split(/[^\p{L}\p{N}]+/u).filter(item=>item.length>1);
  if(store==='ios'){
    const keywords=(fields.keywords||'').split(',').filter(Boolean),shown=new Set([...words(fields.name),...words(fields.subtitle)]);
    const repeated=keywords.filter(item=>words(item).every(word=>shown.has(word)));if(repeated.length&&(fields.name||fields.subtitle))checks.push({code:'aso.keyword_repeats_title',evidence:repeated.join(', ')});
    if(fields.keywords&&[...fields.keywords].length<80)checks.push({code:'aso.keyword_space',evidence:String(100-[...fields.keywords].length)});
  }else{
    if(fields.fullDescription&&[...fields.fullDescription].length<300)checks.push({code:'aso.description_short',evidence:String([...fields.fullDescription].length)});
    if(fields.title&&fields.shortDescription&&words(fields.shortDescription).filter(word=>words(fields.title).includes(word)).length===words(fields.shortDescription).length)checks.push({code:'aso.short_repeats_title',evidence:''});
  }
  const title=fields.name||fields.title;if(title&&[...title].length<15)checks.push({code:'aso.title_short',evidence:String([...title].length)});
  return checks;
}
const digestOf=(store:string,locale:string,fields:Record<string,string>)=>createHash('sha256').update(JSON.stringify([store,locale,Object.keys(fields).sort().map(key=>[key,fields[key]])])).digest('hex');

export class MobileAso{
  db:Database.Database;
  constructor(public mobile:MobileGrowth){this.db=mobile.db;}
  args(){return this.mobile.args();}
  keywords(appId:string):MobileKeyword[]{
    this.mobile.rawApp(appId);
    const rivals=this.competitors(appId);
    return (this.db.prepare('SELECT id,term,country,checked_on FROM platform_mobile_keywords WHERE app_id=? AND organization_id=? AND project_id=? ORDER BY created_at,id').all(appId,...this.args()) as KeywordRow[]).map(row=>{
      const ranks=this.db.prepare('SELECT day,rank,result_count,leaders_json,competitors_json FROM platform_mobile_keyword_ranks WHERE keyword_id=? ORDER BY day DESC LIMIT 30').all(row.id) as {day:string;rank:number|null;result_count:number;leaders_json:string;competitors_json:string|null}[];
      const positions=JSON.parse(ranks[0]?.competitors_json||'{}') as Record<string,number|null>;
      return {id:row.id,term:row.term,country:row.country,checkedOn:row.checked_on,rank:ranks[0]?.rank??null,previousRank:ranks[1]?.rank??null,resultCount:ranks[0]?.result_count??null,leaders:ranks[0]?JSON.parse(ranks[0].leaders_json):[],history:ranks.map(item=>({day:item.day,rank:item.rank})).reverse(),competitors:rivals.map(rival=>({id:rival.id,name:rival.name,rank:rival.id in positions?positions[rival.id]:undefined})).filter(item=>item.rank!==undefined) as {id:string;name:string;rank:number|null}[]};
    });
  }
  competitors(appId:string){this.mobile.rawApp(appId);return (this.db.prepare('SELECT apple_id id,name FROM platform_mobile_competitors WHERE app_id=? AND organization_id=? AND project_id=? ORDER BY created_at,apple_id').all(appId,...this.args()) as {id:string;name:string}[]);}
  // Up to five competitor apps; their positions are read in the same searches as the app's own terms (no extra request).
  async addCompetitor(raw:Record<string,unknown>,read?:MobileTransport){
    this.mobile.authorize('content.write');assertProjectWork(this.db,this.mobile.scope);const app=this.mobile.app(String(raw.appId)),id=typeof raw.appleId==='string'?raw.appleId.trim():'';
    if(!/^[1-9]\d{4,14}$/.test(id))throw new MarketingStoreError('Rakip için App Store kimliğini (yalnız rakam) girin.');if(id===app.appleId)throw new MarketingStoreError('Kendi uygulamanız rakip olarak eklenemez.');
    if(this.competitors(app.id).length>=ASO_LIMITS.competitors)throw new MarketingStoreError('En çok beş rakip uygulama takip edilebilir.',429);
    this.db.transaction(()=>this.mobile.quota('mobile_rank',150)).immediate();
    let name:string;try{name=await appStoreLookup(id,app.country,read);}catch{throw new MarketingStoreError('Bu App Store kimliğiyle uygulama bulunamadı.',404);}
    return this.db.transaction(()=>{this.mobile.authorize('content.write');
      if(this.db.prepare('INSERT INTO platform_mobile_competitors VALUES(?,?,?,?,?,?,?) ON CONFLICT(app_id,apple_id) DO NOTHING').run(...this.args(),app.id,id,name,this.mobile.scope.subject,new Date().toISOString()).changes===0)throw new MarketingStoreError('Bu rakip zaten takip ediliyor.',409);
      this.mobile.audit('mobile.aso.competitor.add');return {competitors:this.competitors(app.id),keywords:this.keywords(app.id)};}).immediate();
  }
  removeCompetitor(appId:string,appleId:string){
    this.mobile.authorize('content.write');this.mobile.rawApp(appId);
    return this.db.transaction(()=>{if(this.db.prepare('DELETE FROM platform_mobile_competitors WHERE app_id=? AND apple_id=? AND organization_id=? AND project_id=?').run(appId,String(appleId),...this.args()).changes===0)throw new MarketingStoreError('Rakip bulunamadı.',404);this.mobile.audit('mobile.aso.competitor.remove');return {competitors:this.competitors(appId),keywords:this.keywords(appId)};}).immediate();
  }
  addKeyword(raw:Record<string,unknown>){
    this.mobile.authorize('content.write');assertProjectWork(this.db,this.mobile.scope);const app=this.mobile.app(String(raw.appId));
    if(!app.appleId)throw new MarketingStoreError('Sıra takibi için uygulamanın App Store kimliği gerekli.',409);
    const term=normalizeTerm(raw.term),country=raw.country===undefined||raw.country===''?app.country:String(raw.country).toUpperCase();if(!/^[A-Z]{2}$/.test(country))throw new MarketingStoreError('İki harfli ülke kodu girin (ör. TR).');
    return this.db.transaction(()=>{
      this.mobile.authorize('content.write');
      if((this.db.prepare('SELECT COUNT(*) n FROM platform_mobile_keywords WHERE app_id=?').get(app.id) as {n:number}).n>=ASO_LIMITS.keywords)throw new MarketingStoreError('Bir uygulama için en çok 30 anahtar kelime takip edilebilir.',429);
      if(this.db.prepare('INSERT INTO platform_mobile_keywords(id,organization_id,project_id,app_id,country,term,created_by,created_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(app_id,country,term) DO NOTHING').run(randomUUID(),...this.args(),app.id,country,term,this.mobile.scope.subject,new Date().toISOString()).changes===0)throw new MarketingStoreError('Bu anahtar kelime bu ülkede zaten takip ediliyor.',409);
      this.mobile.audit('mobile.aso.keyword.add');return this.keywords(app.id);
    }).immediate();
  }
  removeKeyword(appId:string,id:string){
    this.mobile.authorize('content.write');this.mobile.rawApp(appId);
    return this.db.transaction(()=>{const row=this.db.prepare('SELECT id FROM platform_mobile_keywords WHERE id=? AND app_id=? AND organization_id=? AND project_id=?').get(mobileId(id),appId,...this.args());if(!row)throw new MarketingStoreError('Anahtar kelime bulunamadı.',404);
      this.db.prepare('DELETE FROM platform_mobile_keyword_ranks WHERE keyword_id=?').run(id);this.db.prepare('DELETE FROM platform_mobile_keywords WHERE id=?').run(id);this.mobile.audit('mobile.aso.keyword.remove');return this.keywords(appId);}).immediate();
  }
  // Checks the terms not checked today, at most 10 per click (Apple limits its public search API).
  async checkRanks(appId:string,read?:MobileTransport){
    this.mobile.authorize('content.write');assertProjectWork(this.db,this.mobile.scope);const app=this.mobile.app(appId);if(!app.appleId)throw new MarketingStoreError('Sıra takibi için uygulamanın App Store kimliği gerekli.',409);
    const due=this.db.prepare('SELECT id,term,country,checked_on FROM platform_mobile_keywords WHERE app_id=? AND organization_id=? AND project_id=? AND (checked_on IS NULL OR checked_on<?) ORDER BY checked_on IS NOT NULL,checked_on,id LIMIT ?').all(app.id,...this.args(),today(),ASO_LIMITS.checksPerRun) as KeywordRow[];
    let checked=0,failed=0;
    for(const row of due){
      this.db.transaction(()=>this.mobile.quota('mobile_rank',150)).immediate();
      let result:Rank|null=null;try{result=await appStoreRank(app,row.term,row.country,read,competitorIds(this.db,app.id));}catch{result=null;}
      this.mobile.authorize('content.write');recordRank(this.db,row.id,result);if(result)checked++;else failed++;
    }
    this.mobile.audit('mobile.aso.rank');return {checked,failed,remaining:Math.max(0,(this.db.prepare('SELECT COUNT(*) n FROM platform_mobile_keywords WHERE app_id=? AND (checked_on IS NULL OR checked_on<?)').get(app.id,today()) as {n:number}).n),keywords:this.keywords(app.id)};
  }
  private connection(appId:string,kind:string){
    const row=this.db.prepare('SELECT connection_id FROM platform_mobile_integrations WHERE app_id=? AND kind=? AND organization_id=? AND project_id=?').get(appId,kind,...this.args()) as {connection_id:string}|undefined;
    const integration=row?this.mobile.integration(row.connection_id):null;
    if(!integration?.active)throw new MarketingStoreError(kind==='appsflyer_skan'?'Önce Entegrasyonlar bölümünden AppsFlyer SKAN bağlantısını kurun.':kind==='app_store_connect'?'Önce Entegrasyonlar bölümünden App Store Connect bağlantısını kurun.':'Önce Entegrasyonlar bölümünden Google Play bağlantısını kurun.',409);
    return integration;
  }
  // SKAN totals from AppsFlyer, by install date. The whole range is replaced, so a second pull never double counts.
  async syncSkan(raw:Record<string,unknown>,read?:MobileTransport){
    this.mobile.authorize('content.write');assertProjectWork(this.db,this.mobile.scope);const app=this.mobile.app(String(raw.appId)),integration=this.connection(app.id,'appsflyer_skan'),revision=mobileRevision(integration.encrypted_credentials);
    const to=raw.to?mobileDay(raw.to):dayOffset(-3),from=raw.from?mobileDay(raw.from):new Date(Date.parse(to)-29*86400000).toISOString().slice(0,10);
    if(from>to||to>dayOffset(-1)||from<'2020-11-01'||(Date.parse(to)-Date.parse(from))/86400000+1>ASO_LIMITS.skanDays)throw new MarketingStoreError('SKAN aralığı en çok 90 gün olmalı ve dünden önce bitmeli.');
    this.db.transaction(()=>this.mobile.quota('mobile_skan',10)).immediate();
    const config=JSON.parse(integration.config_json) as Record<string,string>;let rows:SkanRow[];
    try{rows=(await readSkanReport(config,this.mobile.secret(integration),from,to,read)).rows;}
    catch(error){throw new MarketingStoreError(errorCode(error).startsWith('columns:')?'AppsFlyer raporunda tarih veya yükleme sütunu bulunamadı.':'AppsFlyer SKAN raporu okunamadı. Uygulama kimliğini ve API anahtarını kontrol edin.',502);}
    this.mobile.authorize('content.write');const now=this.mobile.integration(integration.connection_id);if(!now.active||mobileRevision(now.encrypted_credentials)!==revision)throw new MarketingStoreError('Rapor okunurken bağlantı değişti.',409);
    const merged=new Map<string,SkanRow>(),add=(a:number|null,b:number|null)=>a===null&&b===null?null:(a||0)+(b||0);
    for(const row of rows){if(row.day<from||row.day>to)continue;const key=JSON.stringify([row.day,row.mediaSource,row.campaign,row.country]),old=merged.get(key);
      merged.set(key,old?{...old,installs:old.installs+row.installs,clicks:add(old.clicks,row.clicks),impressions:add(old.impressions,row.impressions),revenue:add(old.revenue,row.revenue),cost:add(old.cost,row.cost),converted:add(old.converted,row.converted)}:row);}
    const stamp=new Date().toISOString();
    this.db.transaction(()=>{
      this.db.prepare('DELETE FROM platform_mobile_skan WHERE app_id=? AND organization_id=? AND project_id=? AND day BETWEEN ? AND ?').run(app.id,...this.args(),from,to);
      const insert=this.db.prepare('INSERT INTO platform_mobile_skan VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      for(const row of merged.values())insert.run(...this.args(),app.id,row.day,row.mediaSource,row.campaign,row.country,row.installs,row.clicks,row.impressions,row.revenue,row.cost,row.converted,config.currency,stamp);
      this.db.prepare('DELETE FROM platform_mobile_skan WHERE app_id=? AND day<?').run(app.id,dayOffset(-ASO_LIMITS.historyDays));
      this.db.prepare("UPDATE platform_mobile_integrations SET status='report_read',checked_at=?,checked_revision=? WHERE connection_id=?").run(stamp,revision,integration.connection_id);
      this.mobile.audit('mobile.skan.sync');
    }).immediate();
    return {rows:merged.size,from,to,skan:this.skan(app.id)};
  }
  skan(appId:string,fromRaw?:string|null,toRaw?:string|null):MobileSkanReport|null{
    this.mobile.rawApp(appId);const last=(this.db.prepare('SELECT MAX(day) day,MAX(synced_at) synced FROM platform_mobile_skan WHERE app_id=? AND organization_id=? AND project_id=?').get(appId,...this.args()) as {day:string|null;synced:string|null});if(!last.day)return null;
    const to=toRaw&&/^\d{4}-\d{2}-\d{2}$/.test(toRaw)?toRaw:last.day,from=fromRaw&&/^\d{4}-\d{2}-\d{2}$/.test(fromRaw)?fromRaw:new Date(Date.parse(to)-29*86400000).toISOString().slice(0,10);
    const rows=this.db.prepare('SELECT media_source,campaign,currency,SUM(installs) installs,SUM(clicks) clicks,COUNT(clicks) clicks_n,SUM(revenue) revenue,COUNT(revenue) revenue_n,SUM(cost) cost,COUNT(cost) cost_n FROM platform_mobile_skan WHERE app_id=? AND organization_id=? AND project_id=? AND day BETWEEN ? AND ? GROUP BY media_source,campaign,currency ORDER BY installs DESC,media_source,campaign LIMIT 50').all(appId,...this.args(),from,to) as {media_source:string;campaign:string;currency:string;installs:number;clicks:number|null;clicks_n:number;revenue:number|null;revenue_n:number;cost:number|null;cost_n:number}[];
    const round=(value:number)=>Math.round(value*100)/100,sum=(key:'revenue'|'cost')=>rows.some(row=>row[`${key}_n`])?round(rows.reduce((total,row)=>total+(row[key]||0),0)):null;
    return {from,to,currency:rows[0]?.currency||'USD',syncedAt:last.synced,installs:rows.reduce((total,row)=>total+row.installs,0),revenue:sum('revenue'),cost:sum('cost'),
      rows:rows.map(row=>({mediaSource:row.media_source,campaign:row.campaign,installs:row.installs,clicks:row.clicks_n?row.clicks:null,revenue:row.revenue_n?round(row.revenue||0):null,cost:row.cost_n?round(row.cost||0):null,ecpi:row.cost_n&&row.installs>0?round((row.cost||0)/row.installs):null}))};
  }
  private draftRow(appId:string,id:unknown){const row=this.db.prepare('SELECT * FROM platform_mobile_listing_drafts WHERE id=? AND app_id=? AND organization_id=? AND project_id=?').get(mobileId(id),appId,...this.args()) as DraftRow|undefined;if(!row)throw new MarketingStoreError('Mağaza kaydı taslağı bulunamadı.',404);return row;}
  listings(appId:string):MobileListingDraft[]{
    this.mobile.rawApp(appId);
    return (this.db.prepare('SELECT * FROM platform_mobile_listing_drafts WHERE app_id=? AND organization_id=? AND project_id=? ORDER BY updated_at DESC LIMIT ?').all(appId,...this.args(),ASO_LIMITS.drafts) as DraftRow[]).map(row=>{const fields=JSON.parse(row.fields_json) as Record<string,string>;
      return {id:row.id,store:row.store,locale:row.locale,fields,state:row.state,approved:row.state==='approved'&&row.approved_digest===row.digest,revision:row.revision,approvedAt:row.approved_at,publishedAt:row.published_at,lastError:row.last_error,checks:listingChecks(row.store,fields),createdAt:row.created_at,updatedAt:row.updated_at};});
  }
  private store(app:MobileApp,value:unknown){
    const store=value==='ios'||value==='android'?value:null;if(!store)throw new MarketingStoreError('Mağaza seçin.');
    if(store==='ios'&&(!app.appleId||app.platform==='android')||store==='android'&&(!app.packageName||app.platform==='ios'))throw new MarketingStoreError(store==='ios'?'Bu uygulamanın App Store kimliği yok.':'Bu uygulamanın Android paket adı yok.',409);return store;
  }
  private locale(app:MobileApp,value:unknown){const locale=value===undefined||value===''?app.locale:String(value);if(!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale))throw new MarketingStoreError('Dil kodu geçersiz (ör. tr-TR).');return locale;}
  // Drafts are written by the team; editing clears the approval. A written listing stays as history.
  saveListing(raw:Record<string,unknown>){
    this.mobile.authorize('content.write');assertProjectWork(this.db,this.mobile.scope);const app=this.mobile.app(String(raw.appId)),store=this.store(app,raw.store),locale=this.locale(app,raw.locale),fields=normalizeListing(store,raw.fields),digest=digestOf(store,locale,fields);
    return this.db.transaction(()=>{
      this.mobile.authorize('content.write');const now=new Date().toISOString();
      if(raw.id===undefined){
        this.db.prepare("INSERT INTO platform_mobile_listing_drafts(id,organization_id,project_id,app_id,store,locale,fields_json,digest,state,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'draft',?,?,?)").run(randomUUID(),...this.args(),app.id,store,locale,JSON.stringify(fields),digest,this.mobile.scope.subject,now,now);
        this.db.prepare(`DELETE FROM platform_mobile_listing_drafts WHERE app_id=? AND state IN ('published','failed') AND id NOT IN (SELECT id FROM platform_mobile_listing_drafts WHERE app_id=? ORDER BY updated_at DESC LIMIT ${ASO_LIMITS.drafts})`).run(app.id,app.id);
        if((this.db.prepare("SELECT COUNT(*) n FROM platform_mobile_listing_drafts WHERE app_id=? AND state IN ('draft','approved')").get(app.id) as {n:number}).n>ASO_LIMITS.drafts)throw new MarketingStoreError('Bu uygulamada çok fazla açık taslak var.',429);
      }else{
        const row=this.draftRow(app.id,raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Taslak başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
        if(!['draft','approved','failed'].includes(row.state))throw new MarketingStoreError('Mağazaya yazılmış veya yazılmakta olan bir taslak düzenlenemez.',409);
        this.db.prepare("UPDATE platform_mobile_listing_drafts SET store=?,locale=?,fields_json=?,digest=?,state='draft',approved_by=NULL,approved_digest=NULL,approved_at=NULL,last_error=NULL,revision=revision+1,updated_at=? WHERE id=?").run(store,locale,JSON.stringify(fields),digest,now,row.id);
      }
      this.mobile.audit('mobile.listing.save');return this.listings(app.id);
    }).immediate();
  }
  approveListing(raw:Record<string,unknown>){
    this.mobile.authorize('campaign.approve');const appId=String(raw.appId);this.mobile.rawApp(appId);
    return this.db.transaction(()=>{this.mobile.authorize('campaign.approve');const row=this.draftRow(appId,raw.id);
      if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Taslak başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);if(row.state!=='draft')throw new MarketingStoreError('Yalnız taslak durumundaki kayıt onaylanabilir.',409);
      this.db.prepare("UPDATE platform_mobile_listing_drafts SET state='approved',approved_by=?,approved_digest=?,approved_at=?,revision=revision+1,updated_at=? WHERE id=?").run(this.mobile.scope.subject,row.digest,new Date().toISOString(),new Date().toISOString(),row.id);
      this.mobile.audit('mobile.listing.approve');return this.listings(appId);}).immediate();
  }
  deleteListing(appId:string,id:string){
    this.mobile.authorize('content.write');this.mobile.rawApp(appId);
    return this.db.transaction(()=>{const row=this.draftRow(appId,id);if(row.state==='publishing')throw new MarketingStoreError('Mağazaya yazılmakta olan taslak silinemez.',409);this.db.prepare('DELETE FROM platform_mobile_listing_drafts WHERE id=?').run(row.id);this.mobile.audit('mobile.listing.delete');return this.listings(appId);}).immediate();
  }
  // AI proposes listing text from the app, the current text and the tracked App Store positions (with the apps ranking
  // above). The proposal fills the form only; it is saved, approved and written like any draft.
  async suggestListing(raw:Record<string,unknown>,generator?:CoachGenerator){
    this.mobile.authorize('content.write');assertProjectWork(this.db,this.mobile.scope);if(!generator)throw new MarketingStoreError('Bu platform için AI sağlayıcısı ve model henüz yapılandırılmadı.',503);
    const app=this.mobile.app(String(raw.appId)),store=this.store(app,raw.store),locale=this.locale(app,raw.locale),limits=fieldLimits(store),project=this.mobile.repo.workspace(this.mobile.scope.subject,...this.args())!.project;
    let current:Record<string,string>={};try{current=raw.current===undefined?{}:normalizeListing(store,raw.current);}catch{current={};}
    const keywords=this.keywords(app.id).slice(0,30).map(item=>({term:item.term,country:item.country,position:item.rank,above:item.leaders.map(leader=>leader.name).slice(0,3)}));
    const keys=Object.keys(limits),language=locale.startsWith('en')?'English':locale.startsWith('tr')?'Turkish':`the language of locale ${locale}`;
    const prompt=`You write ${store==='ios'?'App Store':'Google Play'} listing text in ${language} for the app "${app.name}" (website ${app.website}). Brand voice: ${(project.brandVoice||'clear, warm, practical').slice(0,300)}.
Return only JSON with these keys and character limits: ${keys.map(key=>`${key} (max ${limits[key]})`).join(', ')}.${store==='ios'?' The keywords field is comma separated without spaces and must not repeat words already in name or subtitle.':''}
Rules: describe only what the current text and the facts say the app does; do not invent features, awards, prices, discounts, rankings, user numbers or reviews; no guarantees, superlatives like "best" or "#1", links, emails or phone numbers; do not use competitor or other app names.
Current text (JSON, may be partial): ${JSON.stringify(current).slice(0,5000)}
Tracked App Store search terms with the app's current position (null = not in the top 200) and the apps above it (for context only, never name them): ${JSON.stringify(keywords).slice(0,3000)}`;
    return runCoachAi(this.db,this.mobile.scope,generator,prompt,output=>{
      const fail=()=>new MarketingStoreError('AI önerisi kurallara uymadı (bağlantı, vaat, kişisel bilgi veya başka uygulama adı). Metni kendiniz yazabilirsiniz.',422);
      let value:Record<string,unknown>;try{value=coachObject(parseCoachJson(output));}catch{throw fail();}
      const proposal:Record<string,string>={};for(const key of keys)if(typeof value[key]==='string'&&(value[key] as string).trim())proposal[key]=coachClip((value[key] as string).trim(),limits[key]);
      let fields:Record<string,string>;try{fields=normalizeListing(store,proposal);}catch{throw fail();}
      if(store==='ios'&&fields.keywords){const shown=new Set(`${fields.name||''} ${fields.subtitle||''}`.toLocaleLowerCase('tr').split(/[^\p{L}\p{N}]+/u).filter(Boolean));fields.keywords=fields.keywords.split(',').filter(item=>!item.toLocaleLowerCase('tr').split(/\s+/).every(word=>shown.has(word))).join(',');if(!fields.keywords)delete fields.keywords;}
      const text=JSON.stringify(fields),rivals=keywords.flatMap(item=>item.above).filter(name=>name&&name.toLocaleLowerCase('tr')!==app.name.toLocaleLowerCase('tr')&&name.length>3);
      if(!Object.keys(fields).length||COACH_BANNED.test(text)||/https?:\/\/|www\./i.test(text)||maskPersonal(text)!==text||rivals.some(name=>text.toLocaleLowerCase('tr').includes(name.toLocaleLowerCase('tr'))))throw fail();
      return fields;
    },fields=>{this.mobile.authorize('content.write');this.mobile.audit('mobile.listing.ai');return {store,locale,fields,checks:listingChecks(store,fields)};});
  }
  // Reads the store's current text into the form. Nothing is saved.
  async currentListing(raw:Record<string,unknown>,read?:MobileTransport,getToken:(secret:MobileSecret,scope:string)=>Promise<string>=mobileGoogleAccess){
    this.mobile.authorize('content.write');assertProjectWork(this.db,this.mobile.scope);const app=this.mobile.app(String(raw.appId)),store=this.store(app,raw.store),locale=this.locale(app,raw.locale);
    const integration=this.connection(app.id,store==='ios'?'app_store_connect':'google_play');this.db.transaction(()=>this.mobile.quota('mobile_aso',20)).immediate();
    try{
      if(store==='ios'){const value=await readAppStoreListing(app,locale,JSON.parse(integration.config_json),this.mobile.secret(integration),read);return {store,locale:value.locale,fields:value.listing,editable:value.editable};}
      const value=await readPlayListing(app,JSON.parse(integration.config_json),this.mobile.secret(integration),read,getToken,locale);return {store,locale,fields:{title:value.title,shortDescription:value.subtitle,fullDescription:value.description},editable:true};
    }catch(error){if(error instanceof MarketingStoreError)throw error;throw new MarketingStoreError(store==='ios'?'App Store Connect kaydı okunamadı. API anahtarını, uygulama kimliğini ve dili kontrol edin.':'Google Play kaydı okunamadı. Hizmet hesabının yetkisini, paket adını ve dili kontrol edin.',502);}
  }
  // Writes an approved draft to the store: the server switch, an explicit acknowledgement and an unchanged approval.
  // App Store: the editable version is changed, nothing is submitted for review. Google Play: an edit is committed.
  async publishListing(raw:Record<string,unknown>,read?:MobileTransport,getToken:(secret:MobileSecret,scope:string)=>Promise<string>=mobileGoogleAccess){
    this.mobile.authorize('connections.manage');assertProjectDelivery(this.db,this.mobile.scope);const app=this.mobile.app(String(raw.appId)),row=this.draftRow(app.id,raw.id);
    if(!listingPublishEnabled())throw new MarketingStoreError('Mağaza kaydına yazma bu sunucuda kapalı (PLATFORM_MOBILE_LISTING_PUBLISH_ENABLED).',409);
    if(raw.acknowledged!==true)throw new MarketingStoreError('Mağaza kaydını değiştirmek için açık onay gerekli.');
    const fields=JSON.parse(row.fields_json) as Record<string,string>;
    if(row.state!=='approved'||row.approved_digest!==row.digest||digestOf(row.store,row.locale,fields)!==row.digest)throw new MarketingStoreError('Taslak onaylı ve onaydan sonra değişmemiş olmalı.',409);
    const integration=this.connection(app.id,row.store==='ios'?'app_store_connect':'google_play');
    const claimed=this.db.transaction(()=>{this.mobile.authorize('connections.manage');this.mobile.quota('mobile_listing',10);return this.db.prepare("UPDATE platform_mobile_listing_drafts SET state='publishing',updated_at=? WHERE id=? AND state='approved' AND digest=?").run(new Date().toISOString(),row.id,row.digest).changes;}).immediate();
    if(!claimed)throw new MarketingStoreError('Taslak şu anda yazılıyor veya onaydan sonra değişti. Sayfayı yenileyin.',409);
    let error:string|null=null;
    try{
      if(row.store==='ios')await writeAppStoreListing(app,row.locale,fields,JSON.parse(integration.config_json),this.mobile.secret(integration),read);
      else await writePlayListing(app,row.locale,fields,this.mobile.secret(integration),getToken,read);
    }catch(reason){const code=errorCode(reason);
      error=code==='no_editable_version'?'App Store Connect’te düzenlenebilir bir sürüm yok. Önce yeni bir sürüm hazırlayın; tanıtım metni tek başına canlı sürümde değişebilir.':code==='locale_missing'?'Bu dil App Store Connect’te tanımlı değil. Önce dili orada ekleyin.':row.store==='ios'?'App Store Connect kaydı güncellenemedi. Alanların bir kısmı yazılmış olabilir; App Store Connect’te kontrol edin.':'Google Play kaydı güncellenemedi; değişiklik kaydedilmedi.';}
    return this.db.transaction(()=>{const now=new Date().toISOString();
      this.db.prepare("UPDATE platform_mobile_listing_drafts SET state=?,last_error=?,published_at=?,revision=revision+1,updated_at=? WHERE id=? AND state='publishing'").run(error?'failed':'published',error,error?null:now,now,row.id);
      this.mobile.audit(error?'mobile.listing.failed':'mobile.listing.published');return this.listings(app.id);}).immediate();
  }
}
