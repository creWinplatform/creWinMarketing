import { everySeries } from '../../../../lib/db/async-array';
import { NextRequest,NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readBoundedJsonBytes } from '@/lib/platform/request-json';
import { MarketingStoreError } from '@/lib/platform/errors';
import { MobileGrowth } from '@/lib/platform/mobile-store';
import { MobileDelivery,mobileBroadcastEnabled,mobilePushPerDay } from '@/lib/platform/mobile-delivery';
import { ProductSegments } from '@/lib/platform/segments';
import { mobileReport } from '@/lib/platform/mobile-report';
import { mobileRecord } from '@/lib/platform/mobile-validation';
import { MobileAso,listingPublishEnabled } from '@/lib/platform/mobile-aso';
import { MobileReviews } from '@/lib/platform/mobile-reviews';
import { coachGemini } from '../coach/shared';
export const dynamic='force-dynamic';
async function handle(request:NextRequest){
  const headers={'Cache-Control':'private, no-store'};
  try{
    const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    if(request.method!=='GET'&&!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    const scope={subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},service=new MobileGrowth(platformDatabase(),scope,credentialEncryptionKey()),delivery=new MobileDelivery(service),aso=new MobileAso(service),reviews=new MobileReviews(service);await service.authorize();
    if(request.method==='GET'){
      const apps=await service.apps(),selected=request.nextUrl.searchParams.get('appId')?await service.app(request.nextUrl.searchParams.get('appId')!):apps[0]||null,canManage=await service.repo.can(scope.subject,...service.args(),'connections.manage'),canWrite=await service.repo.can(scope.subject,...service.args(),'content.write');
      return NextResponse.json({playTerms:selected?await aso.playTerms(selected.id):null,competitors:selected?await aso.competitors(selected.id):[],reviews:selected?await reviews.snapshot(selected.id,request.nextUrl.searchParams.get('reviewFilter')||'all'):null,keywords:selected?await aso.keywords(selected.id):[],skan:selected?await aso.skan(selected.id,request.nextUrl.searchParams.get('skanFrom'),request.nextUrl.searchParams.get('skanTo')):null,listings:selected?await aso.listings(selected.id):[],canApprove:await service.repo.can(scope.subject,...service.args(),'campaign.approve'),listingPublishEnabled:listingPublishEnabled(),apps,selected,integrations:selected?await service.integrations(selected.id):[],stores:selected?await service.stores(selected.id):[],links:selected?await service.links(selected.id):[],messages:selected?await delivery.list(selected.id):[],contacts:selected&&canManage?await delivery.contacts(selected.id):[],costs:selected?await service.costs(selected.id):[],adPlans:selected&&canWrite?await service.adPlans():[],report:selected?await mobileReport(service,selected.id,request.nextUrl.searchParams.get('from'),request.nextUrl.searchParams.get('to')):null,campaigns:(await service.store.listCampaigns()).map(item=>({id:item.id,name:item.name})),canManage,canWrite,canDispatch:await everySeries(['connections.manage','campaign.dispatch','campaign.approve'], async permission=>await service.repo.can(scope.subject,...service.args(),permission as 'campaign.dispatch')),canAllowlist:await service.repo.can(scope.subject,...service.args(),'recipients.manage'),sendEnabled:process.env.PLATFORM_MOBILE_SEND_ENABLED==='1',broadcastEnabled:mobileBroadcastEnabled(),pushPerDay:mobilePushPerDay(),segments:canWrite?await (async ()=>{try{return (await new ProductSegments(platformDatabase(),scope).list()).filter(item=>!item.archived).map(item=>({id:item.id,name:item.name,version:item.version}));}catch{return [];}})():[],linksEnabled:process.env.PLATFORM_MOBILE_LINKS_ENABLED==='1'},{headers});
    }
    const raw=mobileRecord(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedJsonBytes(request,2_200_000))));let result:unknown;
    switch(raw.action){
      case 'saveApp':result=await service.saveApp(raw);break;
      case 'source':result=await service.setSource(String(raw.appId),raw.enabled as boolean);break;
      case 'saveIntegration':result=await service.saveIntegration(raw);break;
      case 'probe':result=await service.probe(String(raw.id));break;
      case 'revoke':result=await service.revoke(String(raw.id));break;
      case 'auditStore':result=await service.auditStore(raw);break;
      case 'asoTask':result=await service.asoTask(String(raw.appId),String(raw.snapshotId),String(raw.code));break;
      case 'syncReviews':result=await reviews.sync(raw);break;
      case 'reviewList':result=await reviews.snapshot(String(raw.appId),raw.filter);break;
      case 'saveReviewReply':result=await reviews.saveReply(raw);break;
      case 'deleteReviewReply':result=await reviews.deleteReply(raw);break;
      case 'approveReviewReply':result=await reviews.approveReply(raw);break;
      case 'aiReviewReply':result=await reviews.aiReply(raw,coachGemini(600));break;
      case 'sendReviewReply':result=await reviews.sendReply(raw);break;
      case 'reviewTopics':result=await reviews.generateTopics(raw,coachGemini(2000));break;
      case 'reviewTopicTask':result=await reviews.topicTask(raw);break;
      case 'importPlayTerms':result=await aso.importPlayTerms(raw);break;
      case 'addCompetitor':result=await aso.addCompetitor(raw);break;
      case 'removeCompetitor':result=await aso.removeCompetitor(String(raw.appId),String(raw.appleId));break;
      case 'addKeyword':result=await aso.addKeyword(raw);break;
      case 'removeKeyword':result=await aso.removeKeyword(String(raw.appId),String(raw.id));break;
      case 'checkRanks':result=await aso.checkRanks(String(raw.appId));break;
      case 'syncSkan':result=await aso.syncSkan(raw);break;
      case 'currentListing':result=await aso.currentListing(raw);break;
      case 'suggestListing':result=await aso.suggestListing(raw,coachGemini(1200));break;
      case 'saveListing':result=await aso.saveListing(raw);break;
      case 'approveListing':result=await aso.approveListing(raw);break;
      case 'deleteListing':result=await aso.deleteListing(String(raw.appId),String(raw.id));break;
      case 'publishListing':result=await aso.publishListing(raw);break;
      case 'saveCost':result=await service.saveCost(raw);break;
      case 'syncAdSpend':result=await service.syncAdSpend(raw);break;
      case 'createLink':result=await service.createLink(raw);break;
      case 'associations':result=await service.associations(String(raw.appId),String(raw.teamId),String(raw.fingerprint));break;
      case 'pilot':result=await delivery.setPilot(String(raw.appId),String(raw.id),raw.enabled as boolean);break;
      case 'preview':result=await delivery.preview(raw);break;
      case 'enqueue':result=await delivery.enqueue(raw);break;
      case 'process':result=await delivery.process(String(raw.id));break;
      case 'cancel':result=await delivery.cancel(String(raw.id));break;
      default:throw new MarketingStoreError('Geçersiz mobil işlem.');
    }
    return NextResponse.json(result,{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Mobil işlem tamamlanamadı. Ayarları kontrol edip yeniden deneyin.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
export const GET=handle,POST=handle;
