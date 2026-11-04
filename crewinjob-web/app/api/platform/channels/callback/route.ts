import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { CHANNEL_BROWSER_COOKIE, ProjectChannelOAuth } from '@/lib/platform/channel-oauth';
import { CHANNEL_CALLBACK, CHANNEL_PLATFORMS, channelConfiguration } from '@/lib/platform/channel-publishing';

export const dynamic='force-dynamic';
// One callback for TikTok, Pinterest and YouTube; the stored OAuth request says which provider it was.
export async function GET(request:NextRequest) {
  let redirect:URL|null=null;
  for(const platform of CHANNEL_PLATFORMS){try{redirect=new URL('/',channelConfiguration(platform).redirectUri);break;}catch{}}
  if(!redirect)return NextResponse.json({error:'Kanal OAuth yapılandırılmadı.'},{status:503});
  let result='failed';
  try {
    const access=await getPlatformAccess('connections.manage');
    if(!access||access.identity.mode!=='platform'||request.nextUrl.searchParams.has('error'))throw new Error();
    const oauth=new ProjectChannelOAuth(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    const done=await oauth.complete(request.nextUrl.searchParams.get('state')||'',request.cookies.get(CHANNEL_BROWSER_COOKIE)?.value||'',request.nextUrl.searchParams.get('code')||'');
    result=`${done.platform}:connected`;
  }catch{ /* Never expose provider payloads, authorization codes or credentials. */ }
  redirect.searchParams.set('channelConnection',result);redirect.searchParams.set('tab','project');redirect.searchParams.set('settings','connections');
  const response=NextResponse.redirect(redirect);
  response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');
  response.cookies.set(CHANNEL_BROWSER_COOKIE,'',{httpOnly:true,sameSite:'lax',secure:redirect.protocol==='https:',path:CHANNEL_CALLBACK,maxAge:0});
  return response;
}
