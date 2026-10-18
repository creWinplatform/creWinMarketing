import {NextRequest,NextResponse} from 'next/server';
import {getPlatformAccess} from '@/lib/platform/workspace-server';
import {platformDatabase} from '@/lib/platform/database';
import {EmailPilotQueue} from '@/lib/platform/email-pilots';
import {EmailSendJobs} from '@/lib/platform/email-send-jobs';
import {MarketingStoreError} from '@/lib/platform/marketing-store';
import {readAuthenticationJson} from '@/lib/platform/request-json';
import {hasSameRequestOrigin} from '@/lib/platform/request-origin';
import {credentialEncryptionKey} from '@/lib/platform/credential-key';
export const dynamic='force-dynamic',maxDuration=30;
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess('read');
    if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje erişimi gerekli.'},{status:403,headers});
    const queue=new EmailPilotQueue(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey());
    if(request.method==='GET')return NextResponse.json(request.nextUrl.searchParams.has('id')?queue.get(request.nextUrl.searchParams.get('id')||''):queue.list(request.nextUrl.searchParams.get('campaignId')||'',request.nextUrl.searchParams.get('mode')==='send'?'send':'rehearsal'),{headers});
    if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);
    if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz prova isteği.');
    if(input.action==='enqueue')return NextResponse.json(queue.enqueue(input),{headers});
    if(input.action==='enqueue_send')return NextResponse.json(queue.enqueue(input,'send'),{headers});
    if(input.action==='run_send')return NextResponse.json(await new EmailSendJobs(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},credentialEncryptionKey()).run(input.id),{headers});
    if(input.action==='cancel')return NextResponse.json(queue.cancel(input.id),{headers});
    if(input.action==='run')return NextResponse.json(await queue.run(input.id),{headers});
    throw new MarketingStoreError('Geçersiz prova işlemi.');
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Pilot provası tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
