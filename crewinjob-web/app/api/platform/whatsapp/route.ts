import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectWhatsApp } from '@/lib/platform/whatsapp';
import { coachBody,coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
// WhatsApp template sending: approved templates to contacts with WhatsApp consent, after approval and behind a server switch.
const handle=coachRoute(async(scope,request)=>{
  const whatsapp=new ProjectWhatsApp(platformDatabase(),scope,credentialEncryptionKey());
  if(request.method==='GET')return whatsapp.read();
  const raw=await coachBody(request);
  if(raw.action==='connect')return whatsapp.connect(raw);
  if(raw.action==='templates')return whatsapp.refreshTemplates();
  if(raw.action==='addContacts')return (whatsapp.addContacts(raw)).snapshot;
  if(raw.action==='optOut')return whatsapp.optOut(raw);
  if(raw.action==='removeContact')return whatsapp.removeContact(raw);
  if(raw.action==='save')return whatsapp.saveBatch(raw);
  if(raw.action==='approve')return whatsapp.approve(raw);
  if(raw.action==='queue')return whatsapp.queue(raw);
  if(raw.action==='deliver')return whatsapp.deliver(raw);
  if(raw.action==='cancel')return whatsapp.cancel(raw);
  throw new MarketingStoreError('Geçersiz WhatsApp işlemi.');
});
export const GET=handle,POST=handle;
