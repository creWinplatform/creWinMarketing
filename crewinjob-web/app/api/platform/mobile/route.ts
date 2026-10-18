import { NextRequest,NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readBoundedJsonBytes } from '@/lib/platform/request-json';
import { MarketingStoreError } from '@/lib/platform/errors';
import { MobileGrowth } from '@/lib/platform/mobile-store';
import { MobileDelivery } from '@/lib/platform/mobile-delivery';
import { mobileReport } from '@/lib/platform/mobile-report';
import { mobileRecord } from '@/lib/platform/mobile-validation';
export const dynamic='force-dynamic';
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    if(request.method!=='GET'&&!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const scope={subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},service=new MobileGrowth(platformDatabase(),scope,credentialEncryptionKey()),delivery=new MobileDelivery(service);service.authorize();
    if(request.method==='GET'){
      const apps=service.apps(),selected=request.nextUrl.searchParams.get('appId')?service.app(request.nextUrl.searchParams.get('appId')!):apps[0]||null,canManage=service.repo.can(scope.subject,...service.args(),'connections.manage'),canWrite=service.repo.can(scope.subject,...service.args(),'content.write');
      return NextResponse.json({apps,selected,integrations:selected?service.integrations(selected.id):[],stores:selected?service.stores(selected.id):[],links:selected?service.links(selected.id):[],messages:selected?delivery.list(selected.id):[],contacts:selected&&canManage?delivery.contacts(selected.id):[],costs:selected?service.costs(selected.id):[],report:selected?mobileReport(service,selected.id,request.nextUrl.searchParams.get('from'),request.nextUrl.searchParams.get('to')):null,campaigns:service.store.listCampaigns().map(item=>({id:item.id,name:item.name})),canManage,canWrite,canDispatch:['connections.manage','campaign.dispatch','campaign.approve'].every(permission=>service.repo.can(scope.subject,...service.args(),permission as 'campaign.dispatch')),canAllowlist:service.repo.can(scope.subject,...service.args(),'recipients.manage'),sendEnabled:process.env.PLATFORM_MOBILE_SEND_ENABLED==='1',linksEnabled:process.env.PLATFORM_MOBILE_LINKS_ENABLED==='1'},{headers});
    }
    const raw=mobileRecord(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedJsonBytes(request,65536))));let result:unknown;
    switch(raw.action){
      case 'saveApp':result=service.saveApp(raw);break;
      case 'source':result=service.setSource(String(raw.appId),raw.enabled as boolean);break;
      case 'saveIntegration':result=service.saveIntegration(raw);break;
      case 'probe':result=await service.probe(String(raw.id));break;
      case 'revoke':result=service.revoke(String(raw.id));break;
      case 'auditStore':result=await service.auditStore(raw);break;
      case 'asoTask':result=service.asoTask(String(raw.appId),String(raw.snapshotId),String(raw.code));break;
      case 'saveCost':result=service.saveCost(raw);break;
      case 'createLink':result=await service.createLink(raw);break;
      case 'associations':result=service.associations(String(raw.appId),String(raw.teamId),String(raw.fingerprint));break;
      case 'pilot':result=delivery.setPilot(String(raw.appId),String(raw.id),raw.enabled as boolean);break;
      case 'preview':result=delivery.preview(raw);break;
      case 'enqueue':result=delivery.enqueue(raw);break;
      case 'process':result=await delivery.process(String(raw.id));break;
      case 'cancel':result=delivery.cancel(String(raw.id));break;
      default:throw new MarketingStoreError('Geçersiz mobil işlem.');
    }
    return NextResponse.json(result,{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Mobil işlem tamamlanamadı. Ayarları kontrol edip yeniden deneyin.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
