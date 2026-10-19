import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { CoachWeeklyReview } from '@/lib/platform/coach-review';
import { coachBody,coachRoute } from '../shared';
export const dynamic='force-dynamic';
const handle=coachRoute(async(scope,request)=>{
  const review=new CoachWeeklyReview(platformDatabase(),scope);
  if(request.method==='GET')return review.read();
  const raw=await coachBody(request);
  if(raw.action==='generate')return review.generate();
  if(raw.action==='decide')return review.decide(raw);
  throw new MarketingStoreError('Geçersiz haftalık özet işlemi.');
});
export const GET=handle,POST=handle;
