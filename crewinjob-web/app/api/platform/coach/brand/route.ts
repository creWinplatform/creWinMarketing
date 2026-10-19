import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { CoachBrand } from '@/lib/platform/coach-brand';
import { coachBody,coachGemini,coachRoute } from '../shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
const handle=coachRoute(async(scope,request)=>{
  const brand=new CoachBrand(platformDatabase(),scope);
  if(request.method==='GET')return brand.read();
  const raw=await coachBody(request);
  if(raw.action==='voice')return brand.draftVoice(raw,raw.mode==='ai'?coachGemini(2000):undefined);
  if(raw.action==='edit-voice')return brand.editVoice(raw);
  if(raw.action==='apply-voice')return brand.applyVoice(raw);
  if(raw.action==='competitors')return brand.saveCompetitors(raw);
  if(raw.action==='analyze')return brand.analyze(raw,raw.mode==='ai'?coachGemini(3000):undefined);
  if(raw.action==='apply-positioning')return brand.applyPositioning(raw);
  throw new MarketingStoreError('Geçersiz marka çalışması işlemi.');
});
export const GET=handle,POST=handle;
