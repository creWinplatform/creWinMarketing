import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { AgencyPackage } from '@/lib/platform/agency';
import { portfolio } from '@/lib/platform/portfolio';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic='force-dynamic',maxDuration=30;
// The agency acts from its own (home) project, named in the request; rights are checked there and in the target project.
export async function POST(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.homeOrganizationId!=='string'||typeof input.homeProjectId!=='string')throw new MarketingStoreError('Geçersiz ajans isteği.');
    const db=platformDatabase(),agency=new AgencyPackage(db,{subject:access.subject,organizationId:input.homeOrganizationId,projectId:input.homeProjectId});
    let created:{organizationId:string;projectId:string}|null=null;
    if(input.action==='create')created=agency.createProject(input);
    else if(input.action==='link')agency.requestLink(input);
    else if(input.action==='unlink')agency.removeLink(input);
    else throw new MarketingStoreError('Geçersiz ajans işlemi.');
    return NextResponse.json({created,portfolio:portfolio(db,access.subject,{organizationId:access.identity.organizationId,projectId:access.identity.projectId})},{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Ajans işlemi tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
