import {NextRequest,NextResponse} from 'next/server';
import {getPlatformAccess} from '@/lib/platform/workspace-server';
import {platformDatabase} from '@/lib/platform/database';
import {CampaignReviews} from '@/lib/platform/campaign-review';
import {MarketingStoreError} from '@/lib/platform/marketing-store';
import {readAuthenticationJson} from '@/lib/platform/request-json';
import {hasSameRequestOrigin} from '@/lib/platform/request-origin';
import {credentialEncryptionKey} from '@/lib/platform/credential-key';
export const dynamic='force-dynamic';
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess('read');
    if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje erişimi gerekli.'},{status:403,headers});
    const reviews=new CampaignReviews(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    if(request.method==='GET')return NextResponse.json(reviews.get(request.nextUrl.searchParams.get('id')||''),{headers});
    if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);
    if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz inceleme isteği.');
    if(input.action==='check')return NextResponse.json(reviews.check(input.id,input.expectedDigest),{headers});
    if(input.action==='decide')return NextResponse.json(reviews.decide(input.id,input),{headers});
    throw new MarketingStoreError('Geçersiz inceleme işlemi.');
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'İnceleme tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
