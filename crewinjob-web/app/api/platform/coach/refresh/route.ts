import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { CoachRenewal } from '@/lib/platform/coach-refresh';
import { coachBody,coachGemini,coachRoute } from '../shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
const handle=coachRoute(async(scope,request)=>{
  const renewal=new CoachRenewal(platformDatabase(),scope);
  if(request.method==='GET')return renewal.read();
  const raw=await coachBody(request);
  if(raw.action==='generate')return renewal.generate(raw,raw.mode==='ai'?coachGemini():undefined);
  if(raw.action==='approve')return renewal.approve(raw);
  if(raw.action==='dismiss')return renewal.dismiss(raw);
  throw new MarketingStoreError('Geçersiz aylık yenileme işlemi.');
});
export const GET=handle,POST=handle;
