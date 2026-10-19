import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { ProjectProspects } from '@/lib/platform/prospects';
import { coachBody,coachGemini,coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
// B2B prospects: the team's own company list, checked against each company's public page. Nothing is sent.
const handle=coachRoute(async(scope,request)=>{
  const prospects=new ProjectProspects(platformDatabase(),scope);
  if(request.method==='GET')return prospects.read();
  const raw=await coachBody(request);
  if(raw.action==='add')return prospects.add(raw);
  if(raw.action==='update')return prospects.update(raw);
  if(raw.action==='check')return prospects.check(raw);
  if(raw.action==='suggest')return prospects.suggest(raw,coachGemini(1500));
  if(raw.action==='decide')return prospects.decide(raw);
  if(raw.action==='plan')return prospects.plan(raw);
  if(raw.action==='remove')return prospects.remove(raw);
  throw new MarketingStoreError('Geçersiz aday işlemi.');
});
export const GET=handle,POST=handle;
