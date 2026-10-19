import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { GrowthCoach } from '@/lib/platform/coach';
import { coachBody,coachGemini,coachRoute } from './shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
const handle=coachRoute(async(scope,request)=>{
  const coach=new GrowthCoach(platformDatabase(),scope);coach.authorize();
  if(request.method==='GET')return coach.read();
  const raw=await coachBody(request);
  if(raw.action==='diagnose')return coach.diagnose(raw,raw.mode==='ai'?coachGemini():undefined);
  if(raw.action==='save')return coach.saveDraft(raw);
  if(raw.action==='approve')return coach.approve(raw);
  if(raw.action==='act')return coach.act(raw);
  if(raw.action==='schedule')return coach.schedule(raw);
  throw new MarketingStoreError('Geçersiz büyüme koçu işlemi.');
});
export const GET=handle,POST=handle;
