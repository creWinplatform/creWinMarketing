import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { WebPush } from '@/lib/platform/web-push';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic='force-dynamic',maxDuration=15;
// Phone notifications: the browser's push address is sent in the body only, never in the URL.
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    const service=new WebPush(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    if(request.method==='GET')return NextResponse.json(service.read(),{headers});
    if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz istek.');
    if(input.action==='status')return NextResponse.json(service.read(input),{headers});
    if(input.action==='subscribe')return NextResponse.json(service.subscribe(input),{headers});
    if(input.action==='unsubscribe')return NextResponse.json(service.unsubscribe(input),{headers});
    throw new MarketingStoreError('Geçersiz işlem.');
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Bildirim ayarı alınamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
