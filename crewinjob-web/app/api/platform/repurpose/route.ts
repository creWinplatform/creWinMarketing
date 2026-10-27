import { platformDatabase } from '@/lib/platform/database';
import { ContentRepurpose } from '@/lib/platform/content-repurpose';
import { coachBody,coachGemini,coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
// Adapts a saved draft for other channels; each version is saved as a separate draft, never published.
export const POST=coachRoute(async(scope,request)=>{
  const raw=await coachBody(request);
  return new ContentRepurpose(platformDatabase(),scope).repurpose(raw,raw.mode==='ai'?coachGemini(4000):undefined);
});
