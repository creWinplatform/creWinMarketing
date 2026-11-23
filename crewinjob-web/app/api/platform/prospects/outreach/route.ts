import { NextRequest } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { panelOrigin } from '@/lib/platform/request-origin';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProspectOutreach } from '@/lib/platform/prospect-outreach';
import { coachBody, coachGemini, coachRoute } from '../../coach/shared';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
// Sales assistant, reaching out: email sequences (draft, approval, sending), replies, the pipeline and LinkedIn /
// WhatsApp touches a person sends from their own account.
const handle = coachRoute(async (scope, request: NextRequest) => {
  const outreach = new ProspectOutreach(platformDatabase(), scope, credentialEncryptionKey());
  if (request.method === 'GET') return await outreach.read();
  const raw = await coachBody(request);
  switch (raw.action) {
    case 'draft': return await outreach.draft(raw, raw.mode === 'template' ? undefined : coachGemini(3000));
    case 'save': return await outreach.save(raw);
    case 'approve': return await outreach.approve(raw, panelOrigin(request));
    case 'cancel': return await outreach.cancel(raw);
    case 'reply': return await outreach.reply(raw, coachGemini(1500));
    case 'dismiss-reminder': return await outreach.dismissReminder(raw);
    case 'stage': return await outreach.stage(raw);
    case 'touch': return await outreach.touch(raw);
    case 'assign': return await outreach.assign(raw);
    case 'settings': return await outreach.saveSettings(raw);
    case 'check-domain': return await outreach.checkDomain();
    case 'resume': return await outreach.resume(raw);
  }
  throw new MarketingStoreError('Geçersiz satış asistanı işlemi.');
});
export const GET = handle, POST = handle;
