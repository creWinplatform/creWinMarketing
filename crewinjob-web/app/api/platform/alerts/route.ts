import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { TeamAlerts } from '@/lib/platform/team-alerts';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic='force-dynamic',maxDuration=15;
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getRyzevoAccess();if(!access)return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    const service=new TeamAlerts(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId});
    if(request.method==='GET')return NextResponse.json(service.read(),{headers});
    if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz istek.');
    if(input.action==='subscribe')return NextResponse.json(service.subscribe(input),{headers});
    if(input.action==='unsubscribe')return NextResponse.json(service.unsubscribe(),{headers});
    throw new MarketingStoreError('Geçersiz işlem.');
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Uyarılar alınamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
