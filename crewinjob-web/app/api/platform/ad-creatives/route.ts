import { NextRequest,NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readBoundedJsonBytes } from '@/lib/platform/request-json';
import { MarketingStoreError } from '@/lib/platform/errors';
import { AdCreatives } from '@/lib/platform/ad-creatives';
import type { AdProvider } from '@/lib/platform/ad-providers';
export const dynamic='force-dynamic';
export const maxDuration=60;
// Ad images of a created plan: saved and approved here, sent to Meta or TikTok only on an explicit go-ahead.
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getRyzevoAccess();if(!access)return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    if(request.method!=='GET'&&!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const scope={subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId};
    const pick=(value:unknown):AdProvider=>value==='tiktok'?'tiktok':'meta';
    if(request.method==='GET'){const query=request.nextUrl.searchParams;return NextResponse.json(new AdCreatives(platformDatabase(),scope,credentialEncryptionKey(),pick(query.get('provider'))).list(query.get('planId')),{headers});}
    let raw:Record<string,unknown>;try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedJsonBytes(request,8*1024*1024)));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();raw=value;}catch{throw new MarketingStoreError('Geçersiz istek.');}
    const creatives=new AdCreatives(platformDatabase(),scope,credentialEncryptionKey(),pick(raw.provider));let result:unknown;
    switch(raw.action){
      case 'save':result=await creatives.save(raw);break;
      case 'approve':result=creatives.approve(raw);break;
      case 'delete':result=creatives.remove(raw);break;
      case 'upload':result=await creatives.upload(raw);break;
      default:throw new MarketingStoreError('Geçersiz reklam görseli işlemi.');
    }
    return NextResponse.json(result,{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Reklam görseli işlemi tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
