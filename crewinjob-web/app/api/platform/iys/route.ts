import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectIys } from '@/lib/platform/iys';
import { isLegacyScope } from '@/lib/platform/access';
import { crewinKnownIysPhones } from '@/lib/crewin-iys';
import { crewinEmailMode, crewinPendingCount, setCrewinEmailMode } from '@/lib/crewin-iys-email';
import type { IysView } from '@/lib/platform/iys-types';
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
    // Crewin also sees its email mode (measure or enforce) and the addresses waiting for an İYS check (lib/crewin-iys-email.ts).
    const crewin=isLegacyScope(scope.organizationId,scope.projectId);
    const withCrewin=(view:IysView):IysView=>crewin?{...view,crewinEmail:{...crewinEmailMode(),pending:crewinPendingCount()}}:view;
    if(request.method==='GET')return NextResponse.json(withCrewin(service.view()),{headers});
    if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz istek.');
    if(input.action==='declare')return NextResponse.json(withCrewin(service.declare(input)),{headers});
    if(input.action==='connect')return NextResponse.json(withCrewin(await service.connect(input)),{headers});
    if(input.action==='revoke')return NextResponse.json(withCrewin(service.revoke()),{headers});
    if(input.action==='retry')return NextResponse.json(withCrewin(service.retry(input)),{headers});
    if(input.action==='crewin_email_mode'){
      if(!crewin||!access.repository.can(access.subject,scope.organizationId,scope.projectId,'connections.manage'))throw new MarketingStoreError('İYS ayarlarına erişim reddedildi.',403);
      if(input.mode!=='measure'&&input.mode!=='enforce')throw new MarketingStoreError('Geçersiz işlem.');
      await setCrewinEmailMode(input.mode,access.subject);
      return NextResponse.json(withCrewin(service.view()),{headers});
    }
    // Crewin keeps only one-way keys of its numbers: it re-checks the numbers İYS already reported on.
    if(input.action==='query'&&isLegacyScope(scope.organizationId,scope.projectId))return NextResponse.json(await service.query(crewinKnownIysPhones(db,key).map(value=>({channel:'MESAJ' as const,value}))),{headers});
    if(input.action==='query')return NextResponse.json(await service.query([...allowlistedEmails(db,scope,key).map(value=>({channel:'EPOSTA' as const,value})),...whatsAppContactPhones(db,scope,key).map(value=>({channel:'MESAJ' as const,value}))]),{headers});
    throw new MarketingStoreError('Geçersiz işlem.');
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'İYS işlemi tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
