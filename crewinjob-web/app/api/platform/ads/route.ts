import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectAds } from '@/lib/platform/ad-manager';
import { coachBody,coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
// Ad management: plans are approved, created on Meta as PAUSED and started only after a second explicit go-ahead.
const handle=coachRoute(async(scope,request)=>{
  const ads=new ProjectAds(platformDatabase(),scope,credentialEncryptionKey());
  if(request.method==='GET')return ads.read();
  const raw=await coachBody(request);
  if(raw.action==='connect')return ads.connect(raw);
  if(raw.action==='policy')return ads.setPolicy(raw);
  if(raw.action==='save')return ads.savePlan(raw);
  if(raw.action==='approve')return ads.approve(raw);
  if(raw.action==='create')return ads.create(raw);
  if(raw.action==='start')return ads.start(raw);
  if(raw.action==='pause')return ads.pause(raw);
  if(raw.action==='spend')return ads.refreshSpend(raw);
  throw new MarketingStoreError('Geçersiz reklam işlemi.');
});
export const GET=handle,POST=handle;
