import {NextRequest,NextResponse} from 'next/server';
import {getPlatformAccess} from '@/lib/platform/workspace-server';
import {platformDatabase} from '@/lib/platform/database';
import {ProjectUsage} from '@/lib/platform/project-usage';
import {MarketingStoreError} from '@/lib/platform/marketing-store';
import {hasSameRequestOrigin} from '@/lib/platform/request-origin';
import {readAuthenticationJson} from '@/lib/platform/request-json';

export const dynamic='force-dynamic';
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess();
    if(!access)return NextResponse.json({error:'Giriş gerekli.'},{status:401,headers});
    const {organizationId,projectId}=access.identity;
    if(access.identity.mode!=='platform'||access.repository.workspace(access.subject,organizationId,projectId)?.project.productPack!=='standard')return NextResponse.json({error:'Bu alan Ryzevo proje hesaplarına açıktır.'},{status:403,headers});
    const service=new ProjectUsage(platformDatabase(),{subject:access.subject,organizationId,projectId});
    if(request.method==='GET')return NextResponse.json(service.read(),{headers});
    if(!request.headers.get('origin')||!hasSameRequestOrigin(request)||request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    if(!access.repository.can(access.subject,organizationId,projectId,'billing.manage'))return NextResponse.json({error:'Paket tercihini yalnız proje sahibi değiştirebilir.'},{status:403,headers});
    let input;try{input=await readAuthenticationJson(request);}catch{return NextResponse.json({error:'Geçersiz istek.'},{status:400,headers});}
    return NextResponse.json(service.savePreference(input),{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Plan bilgisi alınamadı.'},{status:error instanceof MarketingStoreError?error.status:500,headers});}
}
export const GET=handle,POST=handle;
