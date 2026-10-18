import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { SocialPublications } from '@/lib/platform/social-publications';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest){
  const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  try{
    const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    const service=new SocialPublications(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey()),q=request.nextUrl.searchParams;
    const index=q.has('index')?Number(q.get('index')):0;
    const image=q.has('jobId')?service.previewJobImage(q.get('jobId')!,index):await service.previewImage(q.get('kind')||'',q.get('id')||'',q.get('digest')||'',q.get('platform')||'instagram',index);
    return new NextResponse(new Uint8Array(Buffer.from(image.data,'base64')),{headers:{...headers,'Content-Type':'image/jpeg','Content-Length':String(image.bytes)}});
  }catch(error){return NextResponse.json({error:'Görsel önizlenemedi.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
