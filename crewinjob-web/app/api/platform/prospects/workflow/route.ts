import { NextRequest } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { panelOrigin } from '@/lib/platform/request-origin';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProspectBooking, ProspectProposals } from '@/lib/platform/prospect-workflow';
import { coachBody, coachGemini, coachRoute } from '../../coach/shared';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
// Sales assistant, after the first answer: the team's booking page and proposal drafts with shareable links.
const handle = coachRoute(async (scope, request: NextRequest) => {
  const db = platformDatabase(), booking = new ProspectBooking(db, scope, credentialEncryptionKey()), proposals = new ProspectProposals(db, scope);
  if (request.method === 'GET') return await booking.read();
  const raw = await coachBody(request);
  switch (raw.action) {
    case 'booking-settings': return await booking.save(raw);
    case 'booking-cancel': return await booking.cancel(raw);
    case 'proposal': return await proposals.read(raw);
    case 'proposal-draft': return await proposals.draft(raw, raw.mode === 'template' ? undefined : coachGemini(3000));
    case 'proposal-save': return await proposals.save(raw);
    case 'proposal-share': return await proposals.share(raw, panelOrigin(request));
    case 'proposal-revoke': return await proposals.revoke(raw);
  }
  throw new MarketingStoreError('Geçersiz satış asistanı işlemi.');
});
export const GET = handle, POST = handle;
