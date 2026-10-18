import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { ProductDataSources } from '@/lib/platform/product-data';
import { ConnectionJobs } from '@/lib/platform/connection-jobs';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';

export const dynamic='force-dynamic',maxDuration=60;
async function handle(request:NextRequest) {
  const headers={'Cache-Control':'private, no-store'};
  try {
    const access=await getPlatformAccess('connections.manage');
    if (!access || access.identity.mode!=='platform') return NextResponse.json({error:'Proje veri yönetimi yetkisi gerekli.'},{status:403,headers});
    if (request.method!=='GET' && !hasSameRequestOrigin(request)) return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const scope={subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId};
    const db=platformDatabase(),sources=new ProductDataSources(db,scope),jobs=new ConnectionJobs(db,scope);
    sources.authorize();
    if (request.method==='GET') {
      const id=request.nextUrl.searchParams.get('sourceId');
      const sourceCount=(db.prepare('SELECT COUNT(*) AS n FROM platform_product_sources WHERE organization_id=? AND project_id=?').get(scope.organizationId,scope.projectId) as {n:number}).n;
      return NextResponse.json({items:sources.list(),sourceCount,jobs:jobs.list().filter(job=>job.jobType==='product.sync'),records:id?sources.records(id):[]},{headers});
    }
    // Reuse the existing bounded JSON reader; source configuration fits its 16KB limit.
    const input=await readAuthenticationJson(request);
    if (!input || typeof input!=='object' || Array.isArray(input)) throw new MarketingStoreError('Geçersiz kaynak isteği.');
    let result:unknown;
    const id=input.id;
    if (input.action==='save') result=sources.save(input,credentialEncryptionKey());
    else {
      if (typeof id!=='string' || id.length>100 || !id) throw new MarketingStoreError('Kaynak veya iş kimliği gerekli.');
      if (input.action==='preview') result=await sources.preview(id,credentialEncryptionKey());
      else if (input.action==='revoke') result=sources.revoke(id,input.version);
      else if (input.action==='activate' || input.action==='pause') result=sources.setEnabled(id,input.version,input.action==='activate');
      else if (input.action==='sync') result=jobs.enqueue(id,input.idempotencyKey,'product.sync');
      else if (input.action==='run' || input.action==='cancel') {
        if (jobs.list(id).jobType!=='product.sync') throw new MarketingStoreError('Kaynak senkronizasyon işi gerekli.');
        result=input.action==='run'?await jobs.run(id,credentialEncryptionKey()):jobs.cancel(id);
      } else throw new MarketingStoreError('Geçersiz kaynak işlemi.');
    }
    return NextResponse.json(result,{headers});
  } catch(error) {
    return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Kaynak işlemi tamamlanamadı. Ayarları ve sunucu yapılandırmasını kontrol edin.'},{status:error instanceof MarketingStoreError?error.status:400,headers});
  }
}
export const GET=handle,POST=handle;
