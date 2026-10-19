import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { CoachContentPlan } from '@/lib/platform/coach-content';
import { coachBody,coachGemini,coachRoute } from '../shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
const handle=coachRoute(async(scope,request)=>{
  const plan=new CoachContentPlan(platformDatabase(),scope);
  if(request.method==='GET')return plan.read(request.nextUrl.searchParams.get('month')??undefined);
  const raw=await coachBody(request);
  if(raw.action==='generate')return plan.generate(raw,raw.mode==='ai'?coachGemini(8000):undefined);
  if(raw.action==='add')return plan.add(raw);
  if(raw.action==='update')return plan.update(raw);
  if(raw.action==='decide')return plan.decide(raw);
  if(raw.action==='schedule')return plan.schedule(raw);
  throw new MarketingStoreError('Geçersiz içerik planı işlemi.');
});
export const GET=handle,POST=handle;
