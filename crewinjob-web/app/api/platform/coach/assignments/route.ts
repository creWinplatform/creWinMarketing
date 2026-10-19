import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { CoachAssignments } from '@/lib/platform/coach-assignments';
import { coachBody,coachRoute } from '../shared';
export const dynamic='force-dynamic';
const handle=coachRoute(async(scope,request)=>{
  const assignments=new CoachAssignments(platformDatabase(),scope);
  if(request.method==='GET')return assignments.read();
  const raw=await coachBody(request);
  if(raw.action==='assign')return assignments.assign(raw);
  throw new MarketingStoreError('Geçersiz atama işlemi.');
});
export const GET=handle,POST=handle;
