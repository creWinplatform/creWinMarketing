import 'server-only';
import { createPrivateKey,createSign } from 'node:crypto';
import { mobileRecord as rec,mobileText } from './mobile-validation';
import { json as mobileJson,request as mobileRequest } from './mobile-http';
import type { MobileSecret,MobileTransport } from './mobile-providers';
import type { MobileApp } from './mobile-types';

// App Store search position, from Apple's public iTunes Search API: the order of the first 200 software results for a
// term in one country. It is close to, but not the same as, the App Store app's own ranking (personalisation, ads).
export const RANK_DEPTH=200;
export async function appStoreRank(app:MobileApp,term:string,country:string,read:MobileTransport=fetch){
  if(!app.appleId)throw new Error('Apple store ID missing.');
  const query=new URLSearchParams({term,country:country.toLowerCase(),entity:'software',limit:String(RANK_DEPTH)});
  const rows=(await mobileJson(await mobileRequest(read,`https://itunes.apple.com/search?${query}`))).results;if(!Array.isArray(rows))throw new Error('Invalid response.');
  const results=rows.map(rec).filter(row=>row.wrapperType==='software'||row.kind==='software');
  const index=results.findIndex(row=>String(row.trackId)===app.appleId);
  return {rank:index<0?null:index+1,resultCount:results.length,leaders:results.slice(0,3).map(row=>({id:String(row.trackId||''),name:String(row.trackName||'').replace(/[\x00-\x1f]/g,'').slice(0,120)}))};
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
export async function readSkanReport(config:Record<string,string>,secret:MobileSecret,from:string,to:string,read:MobileTransport=fetch){
  const response=await mobileRequest(read,`https://hq1.appsflyer.com/api/skadnetworks/v3/data/app/${config.externalAppId}?${new URLSearchParams({start_date:from,end_date:to,view_type:'unified'})}`,{headers:{Authorization:`Bearer ${secret.apiToken}`,Accept:'text/csv, text/plain'}});
  if(!response.ok){await response.body?.cancel();throw new Error(`appsflyer_${response.status}`);}
  const reader=response.body?.getReader();if(!reader)throw new Error('empty');let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>8*1024*1024)throw new Error('too_large');chunks.push(part.value);}}finally{await reader.cancel();}
  return parseSkanCsv(new TextDecoder('utf-8').decode(Buffer.concat(chunks)));
}
