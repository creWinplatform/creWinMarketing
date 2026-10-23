import {NextRequest,NextResponse} from 'next/server';
import {isIP} from 'node:net';
import {getPlatformAccess} from '@/lib/platform/workspace-server';
import {platformDatabase} from '@/lib/platform/database';
import {credentialEncryptionKey} from '@/lib/platform/credential-key';
import {ProjectLiveBilling} from '@/lib/platform/billing-live';
import {MarketingStoreError} from '@/lib/platform/marketing-store';
import {hasSameRequestOrigin} from '@/lib/platform/request-origin';
import {readAuthenticationJson} from '@/lib/platform/request-json';
export const dynamic='force-dynamic',maxDuration=30;
// Live plan purchase (prepaid periods). Owner only; behind PLATFORM_PAYTR_LIVE_ENABLED and a public terms page.
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
  try{
    const access=await getPlatformAccess();
    if(!access)return NextResponse.json({error:'Giriş gerekli.'},{status:401,headers});
    if(access.identity.mode!=='platform')return NextResponse.json({error:'Bu alan Ryzevo proje hesaplarına açıktır.'},{status:403,headers});
    const service=new ProjectLiveBilling(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    if(request.method==='GET'){
      const order=request.nextUrl.searchParams.get('contract');
      if(order){const contract=service.contract(order);return new NextResponse(contract.text,{headers:{...headers,'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="${contract.filename}"`,'X-Content-Type-Options':'nosniff'}});}
      return NextResponse.json(service.read(),{headers});
    }
    if(!request.headers.get('origin')||!hasSameRequestOrigin(request)||request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);
    if(input?.action!=='start')throw new MarketingStoreError('Geçersiz ödeme işlemi.');
    // Deploy behind a trusted proxy that overwrites X-Forwarded-For, not an append-only chain.
    const forwarded=request.headers.get('x-forwarded-for')||'';
    if(!isIP(forwarded))throw new MarketingStoreError('Güvenilir istemci IP bilgisi gerekli.',503);
    return NextResponse.json(await service.start(input,forwarded),{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Ödeme işlemi tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
