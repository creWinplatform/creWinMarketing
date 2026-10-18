import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { SocialPublications } from '@/lib/platform/social-publications';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic='force-dynamic',maxDuration=45;
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    const service=new SocialPublications(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    if(request.method==='GET')return NextResponse.json(request.nextUrl.searchParams.has('id')?service.get(request.nextUrl.searchParams.get('id')!):service.workspace(Number(request.nextUrl.searchParams.get('page')||1)),{headers});
    if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz yayın isteği.');
    if(input.action==='check')return NextResponse.json(await service.check(input.connectionId),{headers});
    if(input.action==='metrics')return NextResponse.json(await service.refreshEngagement(input.id),{headers});
    if(input.action==='enqueue')return NextResponse.json(await service.create(input),{headers});
    if(input.action==='run')return NextResponse.json(await service.run(input.id),{headers});
    if(input.action==='cancel')return NextResponse.json(service.cancel(input.id),{headers});
    throw new MarketingStoreError('Geçersiz yayın işlemi.');
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Sosyal yayın tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
