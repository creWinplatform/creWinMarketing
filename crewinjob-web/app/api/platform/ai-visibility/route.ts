import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { AiVisibility } from '@/lib/platform/ai-visibility';
import { coachBody,coachRoute,visibilityGemini } from '../coach/shared';
export const dynamic='force-dynamic';
export const maxDuration=45;
// AI search visibility: the team's questions, asked to a search-grounded assistant one at a time.
const handle=coachRoute(async(scope,request)=>{
  const service=new AiVisibility(platformDatabase(),scope),provider=visibilityGemini()?'Gemini':null;
  if(request.method==='GET')return await service.read(provider);
  const raw=await coachBody(request);
  if(raw.action==='add')return await service.add(raw);
  if(raw.action==='remove')return await service.remove(raw);
  if(raw.action==='weekly')return await service.weekly(raw);
  if(raw.action==='ask')return service.ask(raw,visibilityGemini());
  throw new MarketingStoreError('Geçersiz işlem.');
});
export const GET=handle,POST=handle;
