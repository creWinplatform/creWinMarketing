import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { SeoOperations } from '@/lib/platform/seo-operations';
import { coachBody,coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
export const maxDuration=60;
// SEO operations: scans of the project's own public site, persistent findings and Search Console opportunities.
const handle=coachRoute(async(scope,request)=>{
  const seo=new SeoOperations(platformDatabase(),scope);
  if(request.method==='GET')return request.nextUrl.searchParams.get('view')==='opportunities'?seo.opportunities():seo.read();
  const raw=await coachBody(request);
  if(raw.action==='start')return seo.start();
  if(raw.action==='step')return seo.step();
  if(raw.action==='cancel')return seo.cancel();
  if(raw.action==='decide')return seo.decide(raw);
  if(raw.action==='plan')return seo.plan(raw);
  throw new MarketingStoreError('Geçersiz SEO işlemi.');
});
export const GET=handle,POST=handle;
