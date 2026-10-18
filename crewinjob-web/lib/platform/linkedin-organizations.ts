import 'server-only';
import { readSocialResponse } from './social-connection';

export type LinkedInReader=(url:string,token:string,init?:RequestInit)=>Promise<Record<string,unknown>>;
export type LinkedInPage={id:string;name:string;roles:string[];available:boolean;canPublish:boolean;start:number};
export const organizationId=(id:unknown):id is string=>typeof id==='string'&&/^[1-9]\d{0,29}$/.test(id);
export const organicRole=(role:unknown)=>typeof role==='string'&&['ADMINISTRATOR','CONTENT_ADMINISTRATOR','CONTENT_ADMIN'].includes(role);
export const linkedinHeaders=(version:string)=>({'LinkedIn-Version':version,'X-Restli-Protocol-Version':'2.0.0'});

export const readLinkedInOrganizationJson:LinkedInReader=async(url,token,init={})=>{
  const parsed=new URL(url);
  if(parsed.origin!=='https://api.linkedin.com'||!['/v2/userinfo','/rest/organizationAcls','/rest/organizationsLookup'].includes(parsed.pathname)||parsed.username||parsed.password||parsed.hash||parsed.searchParams.has('access_token')||!token||/[\r\n\x00]/.test(token))throw new Error('Invalid LinkedIn request.');
  const headers=new Headers(init.headers);headers.set('Authorization',`Bearer ${token}`);headers.set('Accept','application/json');
  const timeout=AbortSignal.timeout(8000);
  const response=await fetch(url,{method:'GET',headers,cache:'no-store',redirect:'error',signal:init.signal?AbortSignal.any([init.signal,timeout]):timeout});
  if(!response.ok){await response.body?.cancel();throw new Error('LinkedIn access unavailable.');}
  return readSocialResponse(response);
};

export async function organizationRoles(read:LinkedInReader,token:string,version:string,start=0,signal?:AbortSignal){
  if(!Number.isSafeInteger(start)||start<0||start>=200)throw new Error('Organization page limit.');
  const url=new URL('https://api.linkedin.com/rest/organizationAcls');
  url.search=new URLSearchParams({q:'roleAssignee',state:'APPROVED',count:'25',start:String(start)}).toString();
  const payload=await read(url.href,token,{headers:linkedinHeaders(version),signal});
  const paging=payload.paging as {start?:number;count?:number;total?:number;links?:{rel?:string}[]}|undefined;
  if(!Array.isArray(payload.elements)||payload.elements.length>25||!paging||paging.start!==start||!Number.isSafeInteger(paging.count)||paging.count!<1||paging.count!>25||payload.elements.length>paging.count!)throw new Error('Invalid organization roles.');
  const rows=payload.elements.map(raw=>{
    if(!raw||typeof raw!=='object')throw new Error('Invalid role.');
    const row=raw as Record<string,unknown>,urn=row.organization??row.organizationTarget;
    if(typeof urn!=='string'||!/^urn:li:organization:[1-9]\d{0,29}$/.test(urn)||row.organization&&row.organizationTarget&&row.organization!==row.organizationTarget||typeof row.role!=='string'||row.role.length>80||typeof row.roleAssignee!=='string'||!/^urn:li:person:[A-Za-z0-9_-]{1,128}$/.test(row.roleAssignee))throw new Error('Invalid role.');
    return {id:urn.slice('urn:li:organization:'.length),role:row.role,approved:row.state==='APPROVED'};
  });
  const next=start+paging.count!;
  const hasMore=payload.elements.length===paging.count||Boolean(paging.links?.some(link=>link.rel==='next'));
  return {rows,next,hasMore,limitReached:hasMore&&next>=200};
}

export async function organizationPageBatch(read:LinkedInReader,token:string,version:string,start:number,signal?:AbortSignal){
  const batch=await organizationRoles(read,token,version,start,signal),roles=new Map<string,string[]>();
  for(const row of batch.rows)if(row.approved)roles.set(row.id,[...new Set([...(roles.get(row.id)||[]),row.role])]);
  if(!roles.size)return {...batch,pages:[] as LinkedInPage[]};
  const url=`https://api.linkedin.com/rest/organizationsLookup?ids=List(${[...roles.keys()].join(',')})`;
  const names=await read(url,token,{headers:linkedinHeaders(version),signal}),results=names.results as Record<string,{id?:string|number;localizedName?:string}>|undefined;
  if(!results||typeof results!=='object'||Array.isArray(results))throw new Error('Invalid organization names.');
  const pages=[...roles].map(([id,roles])=>{
    const record=results[id],validId=record&&String(record.id)===id,name=validId&&typeof record.localizedName==='string'?record.localizedName.trim().slice(0,160):'';
    return {id,name:name||`LinkedIn #${id}`,roles,available:Boolean(name),canPublish:roles.some(organicRole),start};
  });
  return {...batch,pages};
}

export async function hasOrganicRole(read:LinkedInReader,token:string,version:string,id:string,signal?:AbortSignal,publishing=true){
  for(let start=0;start<200;){
    const batch=await organizationRoles(read,token,version,start,signal);
    if(batch.rows.some(row=>row.id===id&&row.approved&&(!publishing||organicRole(row.role))))return true;
    if(!batch.hasMore||batch.limitReached)return false;
    start=batch.next;
  }
  return false;
}
