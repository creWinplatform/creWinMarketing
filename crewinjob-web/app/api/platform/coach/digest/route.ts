import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { CoachDigest } from '@/lib/platform/coach-digest';
import { coachBody,coachRoute } from '../shared';
export const dynamic='force-dynamic';
const handle=coachRoute(async(scope,request)=>{
  const digest=new CoachDigest(platformDatabase(),scope);
  if(request.method==='GET')return await digest.read(request.nextUrl.searchParams.get('lang'));
  const raw=await coachBody(request);
  if(raw.action==='subscribe')return await digest.subscribe(raw);
  if(raw.action==='unsubscribe')return await digest.unsubscribe();
  if(raw.action==='send')return await digest.send(raw);
  throw new MarketingStoreError('Geçersiz e-posta özeti işlemi.');
});
export const GET=handle,POST=handle;
