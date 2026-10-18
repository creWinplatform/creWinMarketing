import {NextRequest,NextResponse} from 'next/server';
import {getPlatformAccess} from '@/lib/platform/workspace-server';
import {platformDatabase} from '@/lib/platform/database';
import {credentialEncryptionKey} from '@/lib/platform/credential-key';
import {EmailRecipients} from '@/lib/platform/email-recipients';
import {MarketingStoreError} from '@/lib/platform/marketing-store';
import {readAuthenticationJson} from '@/lib/platform/request-json';
import {hasSameRequestOrigin} from '@/lib/platform/request-origin';
export const dynamic='force-dynamic';
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess('recipients.manage');
    if(!access||access.identity.mode!=='platform')throw new MarketingStoreError('Alıcı yönetimi erişimi gerekli.',403);
    const recipients=new EmailRecipients(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    if(request.method==='GET')return NextResponse.json(recipients.list(request.nextUrl.searchParams.get('sourceId')||'',Number(request.nextUrl.searchParams.get('page')||1),Number(request.nextUrl.searchParams.get('blockPage')||1)),{headers});
    if(!hasSameRequestOrigin(request))throw new MarketingStoreError('İstek kaynağı geçersiz.',403);
    const input=await readAuthenticationJson(request);if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz alıcı isteği.');
    const result=input.action==='mapping'?recipients.saveMapping(input):input.action==='review'?recipients.review(input):input.action==='suppress'?recipients.suppress(input):input.action==='test_link'?recipients.testLink(input.sourceId,input.contactKey):null;
    if(!result)throw new MarketingStoreError('Geçersiz alıcı işlemi.');return NextResponse.json(result,{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Alıcı işlemi tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
