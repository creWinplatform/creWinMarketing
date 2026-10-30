import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { ProjectAttribution } from '@/lib/platform/attribution';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic='force-dynamic',maxDuration=30;
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    const service=new ProjectAttribution(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId});
    if(request.method==='GET'){
      const view=request.nextUrl.searchParams.get('view');
      return NextResponse.json(view==='settings'?service.settings():service.report(request.nextUrl.searchParams.get('days')||30),{headers});
    }
    if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz istek.');
    if(input.action==='save_settings')return NextResponse.json(service.saveSettings(input),{headers});
    throw new MarketingStoreError('Geçersiz işlem.');
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Kaynak atfı okunamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
