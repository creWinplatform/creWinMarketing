import { NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { ProjectApprovals } from '@/lib/platform/approvals';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
export const dynamic='force-dynamic';
export async function GET(){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getRyzevoAccess();if(!access)return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    return NextResponse.json(new ProjectApprovals(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId}).read(),{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Onay listesi alınamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
