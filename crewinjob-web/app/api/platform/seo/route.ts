import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { SeoOperations } from '@/lib/platform/seo-operations';
import { coachBody,coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
export const maxDuration=60;
// SEO operations: scans of the project's own public site, persistent findings and Search Console opportunities.
const handle=coachRoute(async(scope,request)=>{
  const seo=new SeoOperations(platformDatabase(),scope);
  if(request.method==='GET'){const view=request.nextUrl.searchParams.get('view');return view==='opportunities'?await seo.opportunities():view==='llms'?await seo.llmsDraft():await seo.read();}
  const raw=await coachBody(request);
  if(raw.action==='start')return seo.start();
  if(raw.action==='step')return seo.step();
  if(raw.action==='cancel')return await seo.cancel();
  if(raw.action==='decide')return await seo.decide(raw);
  if(raw.action==='plan')return await seo.plan(raw);
  if(raw.action==='schedule')return await seo.schedule(raw);
  throw new MarketingStoreError('Geçersiz SEO işlemi.');
});
export const GET=handle,POST=handle;
