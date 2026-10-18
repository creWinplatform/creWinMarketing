import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectXOAuth, X_BROWSER_COOKIE } from '@/lib/platform/x-oauth';
import { xConfiguration } from '@/lib/platform/x-client';

export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  let redirect:URL;
  try{redirect=new URL('/',xConfiguration().redirectUri);}catch{return NextResponse.json({error:'X OAuth yapılandırılmadı.'},{status:503});}
  let result='failed';
  try {
    const access=await getPlatformAccess('connections.manage');
    if(!access||access.identity.mode!=='platform'||request.nextUrl.searchParams.has('error'))throw new Error();
    const oauth=new ProjectXOAuth(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    await oauth.complete(request.nextUrl.searchParams.get('state')||'',request.cookies.get(X_BROWSER_COOKIE)?.value||'',request.nextUrl.searchParams.get('code')||'');
    result='connected';
  }catch{ /* Never expose provider payloads, authorization codes or credentials. */ }
  redirect.searchParams.set('xConnection',result);redirect.searchParams.set('tab','project');redirect.searchParams.set('settings','connections');
  const response=NextResponse.redirect(redirect);
  response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');
  response.cookies.set(X_BROWSER_COOKIE,'',{httpOnly:true,sameSite:'lax',secure:redirect.protocol==='https:',path:'/api/platform/x/callback',maxAge:0});
  return response;
}
