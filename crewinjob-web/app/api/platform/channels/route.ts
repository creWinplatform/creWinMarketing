import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { CHANNEL_BROWSER_COOKIE, ProjectChannelOAuth } from '@/lib/platform/channel-oauth';
import { CHANNEL_CALLBACK, CHANNEL_PLATFORMS, channelConfiguration, channelConfigured, isChannelPlatform } from '@/lib/platform/channel-publishing';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { readAuthenticationJson } from '@/lib/platform/request-json';

export const dynamic='force-dynamic';
// TikTok, Pinterest and YouTube: which ones this server is set up for, and starting an account connection.
export async function GET() {
  const access=await getPlatformAccess('connections.manage');
  if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje bağlantı yönetimi yetkisi gerekli.'},{status:403});
  return NextResponse.json({configured:Object.fromEntries(CHANNEL_PLATFORMS.map(platform=>[platform,channelConfigured(platform)]))},{headers:{'Cache-Control':'private, no-store'}});
}
export async function POST(request:NextRequest) {
  if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403});
  const access=await getPlatformAccess('connections.manage');
  if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje bağlantı yönetimi yetkisi gerekli.'},{status:403});
  try {
    const input=await readAuthenticationJson(request),platform=String(input.platform);
    if(!isChannelPlatform(platform))throw new MarketingStoreError('Kanal geçersiz.');
    let redirect:URL;try{redirect=new URL(channelConfiguration(platform).redirectUri);}catch{throw new MarketingStoreError('Bu kanal sunucuda yapılandırılmamış.',503);}
    if(request.headers.get('origin')!==redirect.origin)throw new MarketingStoreError('Panel adresi kanal dönüş adresiyle eşleşmiyor.');
    const result=new ProjectChannelOAuth(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey()).start({platform,accountName:input.accountName,boardId:input.boardId});
    const response=NextResponse.json({authorizationUrl:result.authorizationUrl},{headers:{'Cache-Control':'private, no-store'}});
    response.cookies.set(CHANNEL_BROWSER_COOKIE,result.browser,{httpOnly:true,sameSite:'lax',secure:redirect.protocol==='https:',path:CHANNEL_CALLBACK,maxAge:600});
    return response;
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Kanal bağlantısı başlatılamadı.'},{status:error instanceof MarketingStoreError?error.status:400});}
}
