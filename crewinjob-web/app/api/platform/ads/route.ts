import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectAds } from '@/lib/platform/ad-manager';
import { adAlertSettings,adWarnings,saveAdAlertSettings } from '@/lib/platform/ad-alerts';
import type { AdsSnapshot } from '@/lib/platform/ad-types';
import type { AdProvider } from '@/lib/platform/ad-providers';
import { coachBody,coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
// Ad management: plans are approved, created on Meta as PAUSED and started only after a second explicit go-ahead.
const handle=coachRoute(async(scope,request)=>{
  // Every answer carries this provider's spend warnings and the thresholds; only ad managers see them.
  const db=platformDatabase(),withAlerts=async(value:AdsSnapshot|Promise<AdsSnapshot>)=>{const snapshot=await value;if(!snapshot.canManage||!snapshot.canApprove)return snapshot;
    return {...snapshot,alerts:{warnings:adWarnings(db,scope).filter(item=>item.provider===snapshot.provider).map(({provider:_,name:__,...item})=>item),settings:adAlertSettings(db,scope),canEdit:true}};};
  const pick=(value:unknown):AdProvider=>value==='google'||value==='linkedin'||value==='tiktok'||value==='apple_search'?value:'meta';
  if(request.method==='GET')return withAlerts(new ProjectAds(db,scope,credentialEncryptionKey(),undefined,pick(new URL(request.url).searchParams.get('provider'))).read());
  const raw=await coachBody(request),ads=new ProjectAds(db,scope,credentialEncryptionKey(),undefined,pick(raw.provider));
  if(raw.action==='alerts'){saveAdAlertSettings(db,scope,raw);return withAlerts(ads.read());}
  if(raw.action==='connect')return withAlerts(ads.connect(raw));
  if(raw.action==='policy')return withAlerts(ads.setPolicy(raw));
  if(raw.action==='save')return withAlerts(ads.savePlan(raw));
  if(raw.action==='approve')return withAlerts(ads.approve(raw));
  if(raw.action==='create')return withAlerts(ads.create(raw));
  if(raw.action==='start')return withAlerts(ads.start(raw));
  if(raw.action==='pause')return withAlerts(ads.pause(raw));
  if(raw.action==='spend')return withAlerts(ads.refreshSpend(raw));
  throw new MarketingStoreError('Geçersiz reklam işlemi.');
});
export const GET=handle,POST=handle;
