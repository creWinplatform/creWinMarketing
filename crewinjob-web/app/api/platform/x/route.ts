import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectXOAuth, X_BROWSER_COOKIE } from '@/lib/platform/x-oauth';
import { xConfiguration } from '@/lib/platform/x-client';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { readAuthenticationJson } from '@/lib/platform/request-json';

export const dynamic='force-dynamic';
export async function GET() {
  const access=await getPlatformAccess('connections.manage');
  if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje bağlantı yönetimi yetkisi gerekli.'},{status:403});
  let configured=false;try{xConfiguration();configured=true;}catch{}
  return NextResponse.json({configured},{headers:{'Cache-Control':'private, no-store'}});
}
export async function POST(request:NextRequest) {
  if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403});
  const access=await getPlatformAccess('connections.manage');
  if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje bağlantı yönetimi yetkisi gerekli.'},{status:403});
  try {
    const config=xConfiguration();
    if(request.headers.get('origin')!==new URL(config.redirectUri).origin)throw new MarketingStoreError('Panel adresi X dönüş adresiyle eşleşmiyor.');
    const input=await readAuthenticationJson(request),oauth=new ProjectXOAuth(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    const result=oauth.start({accountName:input.accountName,publishing:input.publishing});
    const response=NextResponse.json({authorizationUrl:result.authorizationUrl},{headers:{'Cache-Control':'private, no-store'}});
    response.cookies.set(X_BROWSER_COOKIE,result.browser,{httpOnly:true,sameSite:'lax',secure:new URL(config.redirectUri).protocol==='https:',path:'/api/platform/x/callback',maxAge:600});
    return response;
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'X OAuth sunucuda yapılandırılmalı.'},{status:error instanceof MarketingStoreError?error.status:503});}
}
