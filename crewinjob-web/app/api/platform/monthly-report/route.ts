import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { MonthlyReports } from '@/lib/platform/monthly-report';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic='force-dynamic',maxDuration=20;
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getRyzevoAccess();if(!access)return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    const service=new MonthlyReports(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId});
    if(request.method==='GET'){const month=request.nextUrl.searchParams.get('month');return NextResponse.json(await service.read(month===null?undefined:month),{headers});}
    if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz rapor isteği.');
    if(input.action==='note')return NextResponse.json(await service.saveNote(input),{headers});
    if(input.action==='approve')return NextResponse.json(await service.approve(input),{headers});
    if(input.action==='reopen')return NextResponse.json(await service.reopen(input),{headers});
    if(input.action==='share')return NextResponse.json(await service.share(input),{headers});
    if(input.action==='revoke')return NextResponse.json(await service.revoke(input),{headers});
    throw new MarketingStoreError('Geçersiz rapor işlemi.');
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Rapor işlemi tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
