import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProductWebhooks } from '@/lib/platform/product-webhooks';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';

export const dynamic='force-dynamic';
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    // Team accounts, and the Crewin workspace's single account (its backend sends signed events).
    const access=await getRyzevoAccess('connections.manage');
    if(!access)return NextResponse.json({error:'Proje veri yönetimi yetkisi gerekli.'},{status:403,headers});
    if(request.method!=='GET'&&!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const webhooks=new ProductWebhooks(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId});await webhooks.authorize();
    if(request.method==='GET'){
      const id=request.nextUrl.searchParams.get('sourceId');
      const sourceCount=(await platformDatabase().prepare('SELECT COUNT(*) AS n FROM platform_product_sources WHERE organization_id=? AND project_id=?').get(access.identity.organizationId,access.identity.projectId) as {n:number}).n;
      return NextResponse.json({items:await webhooks.list(),sourceCount,events:id?await webhooks.events(id,Number(request.nextUrl.searchParams.get('page')||1)):{items:[],total:0,page:1}},{headers});
    }
    const input=await readAuthenticationJson(request);
    if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz webhook isteği.');
    let result:unknown;
    if(input.action==='save')result=await webhooks.save(input,credentialEncryptionKey());
    else{
      if(typeof input.id!=='string'||!/^[a-f0-9]{32}$/.test(input.id))throw new MarketingStoreError('Kaynak kimliği gerekli.');
      if(input.action==='preview')result=await webhooks.preview(input.id,input.payload);
      else if(['activate','pause','revoke'].includes(input.action))result=await webhooks.state(input.id,input.version,input.action);
      else throw new MarketingStoreError('Geçersiz webhook işlemi.');
    }
    return NextResponse.json(result,{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Webhook işlemi tamamlanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
