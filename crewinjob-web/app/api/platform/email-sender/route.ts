import {NextRequest,NextResponse} from 'next/server';
import {getPlatformAccess} from '@/lib/platform/workspace-server';
import {platformDatabase} from '@/lib/platform/database';
import {credentialEncryptionKey} from '@/lib/platform/credential-key';
import {EmailSenders} from '@/lib/platform/email-sender';
import {MarketingStoreError} from '@/lib/platform/marketing-store';
import {hasSameRequestOrigin} from '@/lib/platform/request-origin';
import {readAuthenticationJson} from '@/lib/platform/request-json';
export const dynamic='force-dynamic';
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess('connections.manage');if(!access||access.identity.mode!=='platform')throw new MarketingStoreError('Proje gönderen erişimi gerekli.',403);
    const senders=new EmailSenders(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    if(request.method==='GET')return NextResponse.json(senders.get(),{headers});
    if(!hasSameRequestOrigin(request))throw new MarketingStoreError('İstek kaynağı geçersiz.',403);
    const input=await readAuthenticationJson(request);if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz gönderen isteği.');
    const value=input.action==='select'?senders.select(input):input.action==='renew'?senders.renew(input.expectedRevision):input.action==='verify'?await senders.verify(input.expectedRevision):input.action==='allow'?senders.allow(input):input.action==='remove'?senders.remove(input):null;
    if(!value)throw new MarketingStoreError('Geçersiz gönderen işlemi.');return NextResponse.json(value,{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Gönderen işlemi tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
