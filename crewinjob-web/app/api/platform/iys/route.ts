import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectIys } from '@/lib/platform/iys';
import { isLegacyScope } from '@/lib/platform/access';
import { crewinKnownIysPhones } from '@/lib/crewin-iys';
import { allowlistedEmails } from '@/lib/platform/email-recipients';
import { whatsAppContactPhones } from '@/lib/platform/whatsapp';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic='force-dynamic',maxDuration=60;
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    // Ryzevo projects, and the Crewin workspace for its own WhatsApp sender (lib/crewin-iys.ts).
    const access=await getRyzevoAccess();if(!access)return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    const db=platformDatabase(),key=credentialEncryptionKey(),scope={subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},service=new ProjectIys(db,scope,key);
    if(request.method==='GET')return NextResponse.json(service.view(),{headers});
    if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz istek.');
    if(input.action==='declare')return NextResponse.json(service.declare(input),{headers});
    if(input.action==='connect')return NextResponse.json(await service.connect(input),{headers});
    if(input.action==='revoke')return NextResponse.json(service.revoke(),{headers});
    if(input.action==='retry')return NextResponse.json(service.retry(input),{headers});
    // Crewin keeps only one-way keys of its numbers: it re-checks the numbers İYS already reported on.
    if(input.action==='query'&&isLegacyScope(scope.organizationId,scope.projectId))return NextResponse.json(await service.query(crewinKnownIysPhones(db,key).map(value=>({channel:'MESAJ' as const,value}))),{headers});
    if(input.action==='query')return NextResponse.json(await service.query([...allowlistedEmails(db,scope,key).map(value=>({channel:'EPOSTA' as const,value})),...whatsAppContactPhones(db,scope,key).map(value=>({channel:'MESAJ' as const,value}))]),{headers});
    throw new MarketingStoreError('Geçersiz işlem.');
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'İYS işlemi tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
