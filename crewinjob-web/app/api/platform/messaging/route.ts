import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectMessaging } from '@/lib/platform/messaging-sources';
import { coachBody,coachGemini,coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
// Messaging sources: Telegram channels the project's bot was added to, read into suggestions. Nothing is posted here.
const handle=coachRoute(async(scope,request)=>{
  const messaging=new ProjectMessaging(platformDatabase(),scope,credentialEncryptionKey());
  if(request.method==='GET')return messaging.read();
  const raw=await coachBody(request);
  if(raw.action==='addSource')return messaging.addSource(raw);
  if(raw.action==='autoRead')return messaging.setAutoRead(raw);
  if(raw.action==='removeSource')return messaging.removeSource(raw);
  if(raw.action==='read')return (await messaging.readNow()).snapshot;
  if(raw.action==='dictionary')return messaging.saveDictionary(raw);
  if(raw.action==='suggest')return messaging.suggest(raw);
  if(raw.action==='aiSuggest')return messaging.aiSuggest(raw,coachGemini(800));
  if(raw.action==='decide')return messaging.decide(raw);
  if(raw.action==='duty')return messaging.setDuty(raw);
  throw new MarketingStoreError('Geçersiz mesajlaşma işlemi.');
});
export const GET=handle,POST=handle;
