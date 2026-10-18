import {NextRequest,NextResponse} from 'next/server';
import {getPlatformAccess} from '@/lib/platform/workspace-server';
import {platformDatabase} from '@/lib/platform/database';
import {ProductSegments} from '@/lib/platform/segments';
import {MarketingStoreError} from '@/lib/platform/marketing-store';
import {readAuthenticationJson} from '@/lib/platform/request-json';
import {hasSameRequestOrigin} from '@/lib/platform/request-origin';
export const dynamic='force-dynamic';
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess('read');
    if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje erişimi gerekli.'},{status:403,headers});
    const segments=new ProductSegments(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId});segments.authorize();
    const workspace=access.repository.workspace(access.subject,access.identity.organizationId,access.identity.projectId)!,canWrite=workspace.permissions!.includes('content.write');
    if(request.method==='GET'){
      const id=request.nextUrl.searchParams.get('id');
      return NextResponse.json(id?{versions:segments.versions(id)}:{items:segments.list(),sources:canWrite?segments.sources():[],goals:workspace.project.goals,timezone:workspace.project.timezone,canWrite},{headers});
    }
    if(!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const input=await readAuthenticationJson(request);
    if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz segment isteği.');
    let result:unknown;
    if(input.action==='save')result=segments.save(input);
    else if(input.action==='preview')result=segments.preview(input);
    else if(input.action==='archive'||input.action==='restore')result=segments.archive(input.id,input.version,input.action==='archive');
    else throw new MarketingStoreError('Geçersiz segment işlemi.');
    return NextResponse.json(result,{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Segment işlemi tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
