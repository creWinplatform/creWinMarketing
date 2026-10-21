import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectSocialInbox } from '@/lib/platform/social-inbox';
import { coachBody,coachGemini,coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
// Social inbox: comments on the project's own posts and Page/Instagram messages, answered only after approval.
const handle=coachRoute(async(scope,request)=>{
  const inbox=new ProjectSocialInbox(platformDatabase(),scope,credentialEncryptionKey());
  if(request.method==='GET')return inbox.read();
  const raw=await coachBody(request);
  if(raw.action==='sync')return (await inbox.sync(raw)).snapshot;
  if(raw.action==='reply')return inbox.saveReply(raw);
  if(raw.action==='aiReply')return inbox.aiReply(raw,coachGemini(600));
  if(raw.action==='decide')return inbox.decide(raw);
  if(raw.action==='send')return inbox.send(raw);
  if(raw.action==='autoRead')return inbox.setAutoRead(raw);
  if(raw.action==='live')return inbox.subscribeLive(raw);
  throw new MarketingStoreError('Geçersiz gelen kutusu işlemi.');
});
export const GET=handle,POST=handle;
