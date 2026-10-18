import {NextRequest,NextResponse} from 'next/server';
import {getPlatformAccess} from '@/lib/platform/workspace-server';
import {platformDatabase} from '@/lib/platform/database';
import {credentialEncryptionKey} from '@/lib/platform/credential-key';
import {ProjectBilling} from '@/lib/platform/billing';
import {MarketingStoreError} from '@/lib/platform/marketing-store';
import {hasSameRequestOrigin} from '@/lib/platform/request-origin';
import {readAuthenticationJson} from '@/lib/platform/request-json';
import {isIP} from 'node:net';
export const dynamic='force-dynamic',maxDuration=30;
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
  try{
    const access=await getPlatformAccess();
    if(!access)return NextResponse.json({error:'Giriş gerekli.'},{status:401,headers});
    if(access.identity.mode!=='platform')return NextResponse.json({error:'Bu alan Ryzevo proje hesaplarına açıktır.'},{status:403,headers});
    const service=new ProjectBilling(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    if(request.method==='GET')return NextResponse.json(service.read(),{headers});
    if(!request.headers.get('origin')||!hasSameRequestOrigin(request)||request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);
    if(input?.action==='check')return NextResponse.json(await service.check(input),{headers});
    if(input?.action!=='start')throw new MarketingStoreError('Geçersiz test ödeme işlemi.');
    // Deploy behind a trusted proxy that overwrites X-Forwarded-For, not an append-only chain.
    const forwarded=request.headers.get('x-forwarded-for')||'';
    if(!isIP(forwarded))throw new MarketingStoreError('Güvenilir istemci IP bilgisi gerekli.',503);
    return NextResponse.json(await service.start(input,forwarded),{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'PayTR test işlemi tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
