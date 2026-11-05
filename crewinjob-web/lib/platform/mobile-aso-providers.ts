import 'server-only';
import { createPrivateKey,createSign } from 'node:crypto';
import { mobileRecord as rec,mobileText } from './mobile-validation';
import { json as mobileJson,request as mobileRequest } from './mobile-http';
import type { MobileSecret,MobileTransport } from './mobile-providers';
import type { MobileApp } from './mobile-types';

// App Store search position, from Apple's public iTunes Search API: the order of the first 200 software results for a
// term in one country. It is close to, but not the same as, the App Store app's own ranking (personalisation, ads).
export const RANK_DEPTH=200;
export async function appStoreRank(app:MobileApp,term:string,country:string,read:MobileTransport=fetch,competitors:string[]=[]){
  if(!app.appleId)throw new Error('Apple store ID missing.');
  const query=new URLSearchParams({term,country:country.toLowerCase(),entity:'software',limit:String(RANK_DEPTH)});
  const rows=(await mobileJson(await mobileRequest(read,`https://itunes.apple.com/search?${query}`))).results;if(!Array.isArray(rows))throw new Error('Invalid response.');
  const results=rows.map(rec).filter(row=>row.wrapperType==='software'||row.kind==='software');
  const index=results.findIndex(row=>String(row.trackId)===app.appleId);
  const place=(id:string)=>{const found=results.findIndex(row=>String(row.trackId)===id);return found<0?null:found+1;};
  return {rank:index<0?null:index+1,resultCount:results.length,leaders:results.slice(0,3).map(row=>({id:String(row.trackId||''),name:String(row.trackName||'').replace(/[\x00-\x1f]/g,'').slice(0,120)})),competitors:Object.fromEntries(competitors.map(id=>[id,place(id)]))};
}
// A competitor's public store details for the daily watch: name, rating, rating count and the current version.
export async function appStoreDetails(id:string,country:string,read:MobileTransport=fetch){
  const rows=(await mobileJson(await mobileRequest(read,`https://itunes.apple.com/lookup?${new URLSearchParams({id,country:country.toLowerCase(),entity:'software'})}`))).results;
  const row=Array.isArray(rows)?rec(rows[0]):{};if(String(row.trackId)!==id||typeof row.trackName!=='string')throw new Error('Not found.');
  const clean=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').slice(0,max):null;
  const rating=Number(row.averageUserRating),ratings=Number(row.userRatingCount);
  return {name:clean(row.trackName,120)!,rating:Number.isFinite(rating)&&rating>=0&&rating<=5?Math.round(rating*100)/100:null,ratingCount:Number.isSafeInteger(ratings)&&ratings>=0?ratings:null,version:clean(row.version,40),releasedAt:clean(row.currentVersionReleaseDate,40),notes:clean(row.releaseNotes,1000)};
}
// The public name of an App Store app, to track it as a competitor.
export async function appStoreLookup(id:string,country:string,read:MobileTransport=fetch){
  const rows=(await mobileJson(await mobileRequest(read,`https://itunes.apple.com/lookup?${new URLSearchParams({id,country:country.toLowerCase(),entity:'software'})}`))).results;
  const row=Array.isArray(rows)?rec(rows[0]):{};if(String(row.trackId)!==id||typeof row.trackName!=='string')throw new Error('Not found.');
  return String(row.trackName).replace(/[\x00-\x1f]/g,'').slice(0,120);
}

// App Store Connect API: an API key (issuer id, key id, .p8 EC key) signs a 20-minute token per run; it is never stored.
export type AppStoreConnectConfig={issuerId:string;keyId:string};
export function appStoreConnectCredentials(value:Record<string,unknown>,secret:Record<string,unknown>){
  const issuerId=mobileText(value.issuerId,36),keyId=mobileText(value.keyId,10),privateKey=mobileText(secret.privateKey,4096);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issuerId)||!/^[A-Z0-9]{10}$/.test(keyId))throw new Error('Issuer and key id required.');
  if(createPrivateKey(privateKey).asymmetricKeyType!=='ec')throw new Error('EC key required.');
  return {config:{issuerId:issuerId.toLowerCase(),keyId},credentials:{privateKey}};
}
export function appStoreConnectToken(config:Record<string,string>,secret:MobileSecret,now=Math.floor(Date.now()/1000)){
  const encode=(value:object)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=`${encode({alg:'ES256',kid:config.keyId,typ:'JWT'})}.${encode({iss:config.issuerId,iat:now,exp:now+1200,aud:'appstoreconnect-v1'})}`;
  return `${unsigned}.${createSign('SHA256').update(unsigned).sign({key:createPrivateKey(String(secret.privateKey)),dsaEncoding:'ieee-p1363'}).toString('base64url')}`;
}
const ASC='https://api.appstoreconnect.apple.com/v1';
// Versions and app infos whose metadata App Store Connect still lets the team change.
const EDITABLE=new Set(['PREPARE_FOR_SUBMISSION','DEVELOPER_REJECTED','REJECTED','METADATA_REJECTED','INVALID_BINARY']);
const LIVE=new Set(['READY_FOR_SALE','READY_FOR_DISTRIBUTION']);
const stateOf=(row:Record<string,unknown>)=>{const value=rec(row.attributes);return String(value.appVersionState||value.appStoreState||value.state||'');};
// Exact locale first, then the same language (tr-TR ↔ tr).
const pickLocale=(rows:Record<string,unknown>[],locale:string)=>rows.find(row=>rec(row.attributes).locale===locale)||rows.find(row=>String(rec(row.attributes).locale).split('-')[0]===locale.split('-')[0]);
export const IOS_FIELDS={name:30,subtitle:30,keywords:100,promotionalText:170,description:4000,whatsNew:4000} as const;
export const ANDROID_FIELDS={title:30,shortDescription:80,fullDescription:4000} as const;
export type IosListing=Partial<Record<keyof typeof IOS_FIELDS,string>>;
export type AndroidListing=Partial<Record<keyof typeof ANDROID_FIELDS,string>>;
class AppStoreConnect{
  constructor(private read:MobileTransport,private token:string){}
  async get(path:string){return mobileJson(await mobileRequest(this.read,`${ASC}${path}`,{headers:{Authorization:`Bearer ${this.token}`}}));}
  async patch(path:string,type:string,id:string,attributes:Record<string,string>){
    return mobileJson(await mobileRequest(this.read,`${ASC}${path}`,{method:'PATCH',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify({data:{type,id,attributes}})}));
  }
  rows=(value:Record<string,unknown>)=>(Array.isArray(value.data)?value.data:[]).map(rec);
  async app(app:MobileApp){
    const row=rec((await this.get(`/apps/${app.appleId}?fields[apps]=bundleId,name`)).data);
    if(String(row.id)!==app.appleId||app.bundleId&&rec(row.attributes).bundleId!==app.bundleId)throw new Error('App mismatch.');
  }
  // The version and app info this run can change: an editable one, or the live version for promotional text alone.
  async targets(app:MobileApp,locale:string,promotionalOnly:boolean){
    await this.app(app);
    const versions=this.rows(await this.get(`/apps/${app.appleId}/appStoreVersions?filter[platform]=IOS&limit=10`));
    const version=versions.find(row=>EDITABLE.has(stateOf(row)))||(promotionalOnly?versions.find(row=>LIVE.has(stateOf(row))):undefined);
    const infos=this.rows(await this.get(`/apps/${app.appleId}/appInfos?limit=5`)),info=infos.find(row=>EDITABLE.has(stateOf(row)));
    const versionLocale=version?pickLocale(this.rows(await this.get(`/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`)),locale):undefined;
    const infoLocale=info?pickLocale(this.rows(await this.get(`/appInfos/${info.id}/appInfoLocalizations?limit=50`)),locale):undefined;
    return {version,versionLocale,infoLocale,liveVersion:Boolean(version&&LIVE.has(stateOf(version)))};
  }
}
const pick=<T extends Record<string,number>>(fields:T,attributes:Record<string,unknown>)=>Object.fromEntries(Object.keys(fields).filter(key=>typeof attributes[key]==='string').map(key=>[key,attributes[key] as string]));
export async function readAppStoreListing(app:MobileApp,locale:string,config:Record<string,string>,secret:MobileSecret,read:MobileTransport=fetch):Promise<{listing:IosListing;editable:boolean;locale:string}>{
  const client=new AppStoreConnect(read,appStoreConnectToken(config,secret)),target=await client.targets(app,locale,true);
  if(!target.versionLocale&&!target.infoLocale)throw new Error('Locale not found.');
  return {listing:{...pick({name:30,subtitle:30},rec(target.infoLocale?.attributes)),...pick({keywords:100,promotionalText:170,description:4000,whatsNew:4000},rec(target.versionLocale?.attributes))},editable:Boolean(target.version&&!target.liveVersion),locale:String(rec((target.versionLocale||target.infoLocale)!.attributes).locale)};
}
// Writes the approved fields to the editable version (and app info for name and subtitle). Nothing is submitted for
// review: the team does that in App Store Connect.
export async function writeAppStoreListing(app:MobileApp,locale:string,fields:IosListing,config:Record<string,string>,secret:MobileSecret,read:MobileTransport=fetch){
  const client=new AppStoreConnect(read,appStoreConnectToken(config,secret)),keys=Object.keys(fields) as (keyof IosListing)[],promotionalOnly=keys.every(key=>key==='promotionalText');
  const target=await client.targets(app,locale,promotionalOnly),info:Record<string,string>={},version:Record<string,string>={};
  for(const key of keys){if(key==='name'||key==='subtitle')info[key]=fields[key]!;else version[key]=fields[key]!;}
  if(Object.keys(version).length&&!target.versionLocale)throw new Error(target.version?'locale_missing':'no_editable_version');
  if(Object.keys(info).length&&!target.infoLocale)throw new Error(target.version?'locale_missing':'no_editable_version');
  if(Object.keys(info).length)await client.patch(`/appInfoLocalizations/${target.infoLocale!.id}`,'appInfoLocalizations',String(target.infoLocale!.id),info);
  if(Object.keys(version).length)await client.patch(`/appStoreVersionLocalizations/${target.versionLocale!.id}`,'appStoreVersionLocalizations',String(target.versionLocale!.id),version);
  return {version:String(rec(target.version?.attributes).versionString||''),locale:String(rec((target.versionLocale||target.infoLocale)!.attributes).locale)};
}

// Google Play listing through a Publisher API edit: read in a throwaway edit, write and commit in a new one.
const PLAY='https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
export async function writePlayListing(app:MobileApp,locale:string,fields:AndroidListing,secret:MobileSecret,getToken:(secret:MobileSecret,scope:string)=>Promise<string>,read:MobileTransport=fetch){
  if(!app.packageName)throw new Error('Android package required.');
  const token=await getToken(secret,'https://www.googleapis.com/auth/androidpublisher'),headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'},base=`${PLAY}/${app.packageName}/edits`;
  const edit=String((await mobileJson(await mobileRequest(read,base,{method:'POST',headers,body:'{}'}))).id||'');if(!/^[a-zA-Z0-9_-]{1,100}$/.test(edit))throw new Error('No edit.');
  try{
    const row=await mobileJson(await mobileRequest(read,`${base}/${edit}/listings/${locale}`,{method:'PATCH',headers,body:JSON.stringify({language:locale,...fields})}));if(row.language!==locale)throw new Error('Locale mismatch.');
    await mobileJson(await mobileRequest(read,`${base}/${edit}:commit`,{method:'POST',headers,body:'{}'}));
  }catch(error){await mobileRequest(read,`${base}/${edit}`,{method:'DELETE',headers}).then(response=>response.body?.cancel()).catch(()=>{});throw error;}
  return {edit,locale};
}

// AppsFlyer SKAN aggregated performance report (SKAN 4: /v3). It is a CSV; columns are matched by name because AppsFlyer
// adds in-app event columns and may change their order.
export function appsFlyerSkanCredentials(value:Record<string,unknown>,secret:Record<string,unknown>){
  const appId=mobileText(value.externalAppId,40),currency=mobileText(value.currency||'USD',3),apiToken=mobileText(secret.apiToken,4096);
  if(!/^id\d{5,15}$/.test(appId)||!/^[A-Z]{3}$/.test(currency)||apiToken.length<20||/\s/.test(apiToken))throw new Error('AppsFlyer app id and API token required.');
  return {config:{externalAppId:appId,currency},credentials:{apiToken}};
}
export type SkanRow={day:string;mediaSource:string;campaign:string;country:string;installs:number;clicks:number|null;impressions:number|null;revenue:number|null;cost:number|null;converted:number|null};
const header=(value:string)=>value.replace(/\(.*?\)/g,'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
export function csvRows(text:string){
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const char=text[i];
    if(quoted){if(char==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(char==='"')quoted=false;else cell+=char;continue;}
    if(char==='"')quoted=true;else if(char===','){row.push(cell);cell='';}else if(char==='\n'||char==='\r'){if(char==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(value=>value!==''))rows.push(row);row=[];}else cell+=char;}
  row.push(cell);if(row.some(value=>value!==''))rows.push(row);return rows;
}
export function parseSkanCsv(text:string):{rows:SkanRow[];columns:string[]}{
  const [head,...body]=csvRows(text.replace(/^﻿/,''));if(!head)throw new Error('empty');const columns=head.map(header),find=(...names:string[])=>columns.findIndex(name=>names.includes(name));
  const at={day:find('date','install_date','day'),media:find('media_source','pid'),campaign:find('campaign','c','campaign_name'),country:find('country','country_code','geo'),installs:find('installs','skad_installs','total_installs'),clicks:find('clicks'),impressions:find('impressions'),revenue:find('total_revenue','revenue'),cost:find('total_cost','cost'),converted:find('converted_users')};
  if(at.day<0||at.installs<0)throw new Error(`columns:${columns.slice(0,20).join(',')}`);
  const number=(row:string[],index:number)=>{if(index<0)return null;const value=(row[index]||'').trim();if(!value||value.toUpperCase()==='N/A'||value==='null')return null;const parsed=Number(value.replace(/,/g,''));return Number.isFinite(parsed)&&parsed>=0?parsed:null;};
  const text_=(row:string[],index:number,max:number)=>index<0?'':String(row[index]||'').trim().slice(0,max).replace(/[\x00-\x1f]/g,'');
  const rows=body.flatMap(row=>{const day=text_(row,at.day,10),installs=number(row,at.installs);if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||installs===null)return [];
    return [{day,mediaSource:text_(row,at.media,100)||'unknown',campaign:text_(row,at.campaign,200),country:text_(row,at.country,2).toUpperCase(),installs:Math.round(installs),clicks:number(row,at.clicks),impressions:number(row,at.impressions),revenue:number(row,at.revenue),cost:number(row,at.cost),converted:number(row,at.converted)}];});
  return {rows,columns};
}
// Google Play has no public search API. The team exports the "search terms" table of the Play Console store
// performance report (CSV) and uploads it; columns are matched by name in English or Turkish.
export type PlayTerm={term:string;visitors:number|null;installs:number|null;conversion:number|null};
export function parsePlayTermsCsv(text:string):PlayTerm[]{
  const rows=csvRows(text.replace(/^\uFEFF/,''));const headIndex=rows.findIndex(row=>row.some(cell=>/search term|arama terim|^term$|terim/i.test(cell.trim())));if(headIndex<0)throw new Error('columns');
  const head=rows[headIndex].map(cell=>cell.trim().toLowerCase()),find=(...patterns:RegExp[])=>head.findIndex(cell=>patterns.some(pattern=>pattern.test(cell)));
  const at={term:find(/search term/,/arama terim/,/^term$/,/terim/),visitors:find(/visitor/,/ziyaret/),installs:find(/acquisition/,/installer/,/edinim/,/yükleyen/,/yükleme/),conversion:find(/conversion/,/dönüşüm/)};
  if(at.term<0||at.visitors<0&&at.installs<0)throw new Error('columns');
  const number=(row:string[],index:number)=>{if(index<0)return null;const value=(row[index]||'').trim().replace(/%$/,'').replace(/\s/g,'');if(!value||value==='-')return null;const parsed=Number(value.includes(',')&&!value.includes('.')?value.replace(',','.'):value.replace(/,/g,''));return Number.isFinite(parsed)&&parsed>=0?parsed:null;};
  const seen=new Set<string>(),terms:PlayTerm[]=[];
  for(const row of rows.slice(headIndex+1)){const term=(row[at.term]||'').normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase().replace(/i̇/g,'i');if(!term||term.length>100||/[\x00-\x1f]/.test(term)||seen.has(term))continue;seen.add(term);
    const conversion=number(row,at.conversion);terms.push({term,visitors:number(row,at.visitors)===null?null:Math.round(number(row,at.visitors)!),installs:number(row,at.installs)===null?null:Math.round(number(row,at.installs)!),conversion:conversion===null?null:conversion>1?Math.round(conversion*100)/10000:conversion});if(terms.length>=500)break;}
  return terms;
}
export async function readSkanReport(config:Record<string,string>,secret:MobileSecret,from:string,to:string,read:MobileTransport=fetch){
  const response=await mobileRequest(read,`https://hq1.appsflyer.com/api/skadnetworks/v3/data/app/${config.externalAppId}?${new URLSearchParams({start_date:from,end_date:to,view_type:'unified'})}`,{headers:{Authorization:`Bearer ${secret.apiToken}`,Accept:'text/csv, text/plain'}});
  if(!response.ok){await response.body?.cancel();throw new Error(`appsflyer_${response.status}`);}
  const reader=response.body?.getReader();if(!reader)throw new Error('empty');let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8*1024*1024)throw new Error('too_large');chunks.push(part.value);}}finally{await reader.cancel();}
  return parseSkanCsv(new TextDecoder('utf-8').decode(Buffer.concat(chunks)));
}

// Store reviews. App Store Connect: the latest reviews with their published responses; one response per review, a new
// one replaces it. Google Play: reviews created or changed in the last week (the API's own window); replies up to 350.
export type StoreReview={providerId:string;rating:number;title:string;body:string;author:string;territory:string;language:string;appVersion:string;reviewedAt:string;storeReply:string|null;storeReplyAt:string|null};
export const REPLY_LIMITS={ios:5970,android:350} as const;
const clean=(value:unknown,max:number)=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').slice(0,max);
const iso=(value:unknown)=>{const time=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(time)?new Date(time).toISOString():null;};
export async function readAppStoreReviews(app:MobileApp,config:Record<string,string>,secret:MobileSecret,read:MobileTransport=fetch,limit=200):Promise<StoreReview[]>{
  if(!app.appleId)throw new Error('Apple store ID missing.');
  const token=appStoreConnectToken(config,secret),reviews:StoreReview[]=[];
  let url=`${ASC}/apps/${app.appleId}/customerReviews?sort=-createdDate&limit=100&include=response`;
  for(let page=0;page<Math.ceil(limit/100)&&url;page++){
    const value=await mobileJson(await mobileRequest(read,url,{headers:{Authorization:`Bearer ${token}`}})),included=(Array.isArray(value.included)?value.included:[]).map(rec);
    for(const row of (Array.isArray(value.data)?value.data:[]).map(rec)){
      const attributes=rec(row.attributes),link=rec(rec(rec(row.relationships).response).data),response=included.find(item=>item.type==='customerReviewResponses'&&item.id===link.id),reply=rec(response?.attributes);
      const rating=Number(attributes.rating),reviewedAt=iso(attributes.createdDate);if(!row.id||!Number.isInteger(rating)||rating<1||rating>5||!reviewedAt)continue;
      reviews.push({providerId:clean(row.id,100),rating,title:clean(attributes.title,300),body:clean(attributes.body,6000),author:clean(attributes.reviewerNickname,100),territory:clean(attributes.territory,3),language:'',appVersion:'',reviewedAt,storeReply:typeof reply.responseBody==='string'?clean(reply.responseBody,REPLY_LIMITS.ios):null,storeReplyAt:iso(reply.lastModifiedDate)});
    }
    const next=rec(value.links).next;url='';
    if(typeof next==='string'){const parsed=new URL(next);if(parsed.protocol==='https:'&&parsed.hostname==='api.appstoreconnect.apple.com')url=parsed.href;}
  }
  return reviews.slice(0,limit);
}
export async function replyAppStoreReview(reviewId:string,text:string,config:Record<string,string>,secret:MobileSecret,read:MobileTransport=fetch){
  const value=await mobileJson(await mobileRequest(read,`${ASC}/customerReviewResponses`,{method:'POST',headers:{Authorization:`Bearer ${appStoreConnectToken(config,secret)}`,'Content-Type':'application/json'},
    body:JSON.stringify({data:{type:'customerReviewResponses',attributes:{responseBody:text},relationships:{review:{data:{type:'customerReviews',id:reviewId}}}}})}));
  if(rec(value.data).type!=='customerReviewResponses')throw new Error('No response.');
}
const seconds=(value:unknown)=>{const raw=Number(rec(value).seconds);return Number.isFinite(raw)&&raw>0?new Date(raw*1000).toISOString():null;};
export async function readPlayReviews(app:MobileApp,secret:MobileSecret,getToken:(secret:MobileSecret,scope:string)=>Promise<string>,read:MobileTransport=fetch,limit=200):Promise<StoreReview[]>{
  if(!app.packageName)throw new Error('Android package required.');
  const token=await getToken(secret,'https://www.googleapis.com/auth/androidpublisher'),reviews:StoreReview[]=[];let pageToken='';
  for(let page=0;page<Math.ceil(limit/100);page++){
    const query=new URLSearchParams({maxResults:'100',...(pageToken?{token:pageToken}:{})});
    const value=await mobileJson(await mobileRequest(read,`${PLAY}/${app.packageName}/reviews?${query}`,{headers:{Authorization:`Bearer ${token}`}}));
    for(const row of (Array.isArray(value.reviews)?value.reviews:[]).map(rec)){
      const comments=(Array.isArray(row.comments)?row.comments:[]).map(rec),user=rec(comments.find(item=>item.userComment)?.userComment),developer=rec(comments.find(item=>item.developerComment)?.developerComment);
      const rating=Number(user.starRating),reviewedAt=seconds(user.lastModified);if(!row.reviewId||!Number.isInteger(rating)||rating<1||rating>5||!reviewedAt)continue;
      reviews.push({providerId:clean(row.reviewId,200),rating,title:'',body:clean(user.text,6000).trim(),author:clean(row.authorName,100),territory:'',language:clean(user.reviewerLanguage,10),appVersion:clean(user.appVersionName,40),reviewedAt,storeReply:typeof developer.text==='string'?clean(developer.text,REPLY_LIMITS.android):null,storeReplyAt:seconds(developer.lastModified)});
    }
    pageToken=typeof rec(value.tokenPagination).nextPageToken==='string'?String(rec(value.tokenPagination).nextPageToken):'';if(!pageToken)break;
  }
  return reviews.slice(0,limit);
}
export async function replyPlayReview(app:MobileApp,reviewId:string,text:string,secret:MobileSecret,getToken:(secret:MobileSecret,scope:string)=>Promise<string>,read:MobileTransport=fetch){
  const token=await getToken(secret,'https://www.googleapis.com/auth/androidpublisher');
  const value=await mobileJson(await mobileRequest(read,`${PLAY}/${app.packageName}/reviews/${encodeURIComponent(reviewId)}:reply`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({replyText:text})}));
  if(typeof rec(value.result).replyText!=='string')throw new Error('No reply.');
}
