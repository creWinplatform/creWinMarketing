import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { GrowthCoach } from '@/lib/platform/coach';
import { seedCoachFirstWeek } from '@/lib/platform/coach-first-week';
import { coachBody,coachGemini,coachRoute } from './shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
const handle=coachRoute(async(scope,request)=>{
  const coach=new GrowthCoach(platformDatabase(),scope);coach.authorize();
  if(request.method==='GET')return coach.read();
  const raw=await coachBody(request);
  if(raw.action==='diagnose')return coach.diagnose(raw,raw.mode==='ai'?coachGemini():undefined);
  if(raw.action==='save')return coach.saveDraft(raw);
  // After approval the first week is ready: this month's starter plan and a few drafts to edit. Nothing is published.
  if(raw.action==='approve'){coach.approve(raw);try{seedCoachFirstWeek(platformDatabase(),scope);}catch{/* the approval stands without starter drafts */}return coach.read();}
  if(raw.action==='act')return coach.act(raw);
  if(raw.action==='schedule')return coach.schedule(raw);
  throw new MarketingStoreError('Geçersiz büyüme koçu işlemi.');
});
export const GET=handle,POST=handle;
