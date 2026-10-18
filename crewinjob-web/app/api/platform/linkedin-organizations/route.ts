import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { LinkedInOrganizationOAuth, LINKEDIN_ORGANIZATION_SELECTION_COOKIE } from '@/lib/platform/linkedin-organization-oauth';
import { LINKEDIN_BROWSER_COOKIE } from '@/lib/platform/linkedin-oauth';
import { linkedinOrganizationConfiguration } from '@/lib/platform/linkedin-organization-publishing';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';

export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(request:NextRequest){
  const access=await getPlatformAccess('connections.manage');
  if(!access||access.identity.mode!=='platform')return json({error:'Proje bağlantı yönetimi yetkisi gerekli.'},403);
  let configured=false;try{linkedinOrganizationConfiguration();configured=true;}catch{}
  const cookie=request.cookies.get(LINKEDIN_ORGANIZATION_SELECTION_COOKIE)?.value;
  if(!cookie)return json({configured,selection:null});
  try{
    const oauth=new LinkedInOrganizationOAuth(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    return json({configured,selection:await oauth.list(cookie,request.nextUrl.searchParams.get('more')==='true')});
  }catch(error){return json({configured,selection:null,error:error instanceof MarketingStoreError?error.message:'LinkedIn şirket sayfaları alınamadı.'},error instanceof MarketingStoreError?error.status:400);}
}
export async function POST(request:NextRequest){
  if(!hasSameRequestOrigin(request))return json({error:'İstek kaynağı geçersiz.'},403);
  const access=await getPlatformAccess('connections.manage');
  if(!access||access.identity.mode!=='platform')return json({error:'Proje bağlantı yönetimi yetkisi gerekli.'},403);
  try{
    const input=await readAuthenticationJson(request),oauth=new LinkedInOrganizationOAuth(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    if(input.action==='select'||input.action==='cancel'){
      const cookie=request.cookies.get(LINKEDIN_ORGANIZATION_SELECTION_COOKIE)?.value||'';
      const result=input.action==='select'?await oauth.select(cookie,input.pageId):(oauth.cancel(cookie),{ok:true}),response=json(result);
      response.cookies.set(LINKEDIN_ORGANIZATION_SELECTION_COOKIE,'',{httpOnly:true,sameSite:'lax',secure:request.nextUrl.protocol==='https:',path:'/api/platform/linkedin-organizations',maxAge:0});
      return response;
    }
    if(input.action!=='start')throw new MarketingStoreError('Geçerli LinkedIn şirket işlemi gerekli.');
    const config=linkedinOrganizationConfiguration();
    if(request.headers.get('origin')!==new URL(config.redirectUri).origin)throw new MarketingStoreError('Panel adresi LinkedIn dönüş adresiyle eşleşmiyor.');
    const result=oauth.start(input.publishing),response=json({authorizationUrl:result.authorizationUrl});
    response.cookies.set(LINKEDIN_BROWSER_COOKIE,result.browser,{httpOnly:true,sameSite:'lax',secure:new URL(config.redirectUri).protocol==='https:',path:'/api/platform/social/callback',maxAge:600});
    response.cookies.set(LINKEDIN_ORGANIZATION_SELECTION_COOKIE,'',{httpOnly:true,sameSite:'lax',secure:new URL(config.redirectUri).protocol==='https:',path:'/api/platform/linkedin-organizations',maxAge:0});
    return response;
  }catch(error){return json({error:error instanceof MarketingStoreError?error.message:'LinkedIn şirket bağlantısı için uygulama ve API sürümü yapılandırılmalı.'},error instanceof MarketingStoreError?error.status:503);}
}
