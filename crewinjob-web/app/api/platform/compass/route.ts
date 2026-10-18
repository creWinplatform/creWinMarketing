import { NextRequest,NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
import { MarketingStoreError } from '@/lib/platform/errors';
import { GrowthCompass } from '@/lib/platform/guidance';
import type { GuideId } from '@/lib/platform/guidance-catalog';
export const dynamic='force-dynamic';
async function handle(request:NextRequest){const headers={'Cache-Control':'private, no-store'};try{
  const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
  if(request.method!=='GET'&&!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
  const compass=new GrowthCompass(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());compass.authorize();
  if(request.method==='GET')return NextResponse.json(compass.read(),{headers});
  const raw=await readAuthenticationJson(request);let result:unknown;
  if(raw.action==='save')result=compass.save(raw);
  else if(raw.action==='defer')result=compass.defer(raw.expectedRevision);
  else if(raw.action==='handoff')result=compass.handoff(raw.provider as GuideId);
  else throw new MarketingStoreError('Geçersiz pusula işlemi.');
  return NextResponse.json(result,{headers});
}catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Pusula şu anda yüklenemedi. Mevcut araçlarınız kullanılmaya devam edebilir.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}}
export const GET=handle,POST=handle;
