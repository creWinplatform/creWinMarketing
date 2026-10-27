import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { portfolio } from '@/lib/platform/portfolio';
import { decideInvite } from '@/lib/platform/member-invites';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic='force-dynamic',maxDuration=30;
// The signed-in person's projects; accepting an invitation adds a membership, and switching stays with /api/workspace.
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    const db=platformDatabase(),current={organizationId:access.identity.organizationId,projectId:access.identity.projectId};
    if(request.method==='GET')return NextResponse.json(portfolio(db,access.subject,current),{headers});
    if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz istek.');
    if(input.action==='decide'){const result=decideInvite(db,access.subject,input);return NextResponse.json({...result,portfolio:portfolio(db,access.subject,current)},{headers});}
    throw new MarketingStoreError('Geçersiz işlem.');
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Portföy alınamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
