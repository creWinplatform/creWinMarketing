import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectAutomations } from '@/lib/platform/automations';
import { coachBody,coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
// Lifecycle automation rules; real sends only through the existing email pilot gates, after a person approves.
const handle=coachRoute(async(scope,request)=>{
  const automations=new ProjectAutomations(platformDatabase(),scope,credentialEncryptionKey());
  if(request.method==='GET')return automations.read();
  const raw=await coachBody(request);
  if(raw.action==='save')return automations.save(raw);
  if(raw.action==='state')return automations.setState(raw);
  if(raw.action==='evaluate')return automations.evaluate(raw);
  if(raw.action==='approve')return automations.approve(raw);
  throw new MarketingStoreError('Geçersiz otomasyon işlemi.');
});
export const GET=handle,POST=handle;
