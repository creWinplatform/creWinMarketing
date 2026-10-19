import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { BudgetPlanner } from '@/lib/platform/budget-planner';
import { coachBody,coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
// Budget and goal planner: saved scenarios and measured values; the calculation itself runs in the browser.
const handle=coachRoute(async(scope,request)=>{
  const planner=new BudgetPlanner(platformDatabase(),scope);
  if(request.method==='GET')return planner.read();
  const raw=await coachBody(request);
  if(raw.action==='save')return planner.save(raw);
  if(raw.action==='remove')return planner.remove(raw);
  throw new MarketingStoreError('Geçersiz bütçe planı işlemi.');
});
export const GET=handle,POST=handle;
