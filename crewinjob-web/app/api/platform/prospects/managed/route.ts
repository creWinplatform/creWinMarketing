import { NextRequest } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ManagedSending } from '@/lib/platform/managed-sending';
import { coachBody, coachRoute } from '../../coach/shared';
export const dynamic = 'force-dynamic';
// Managed sales service, the customer's side: the stages, the assigned domain, credits, results and replies, and the
// owner's approval to send on the company's behalf.
const handle = coachRoute(async (scope, request: NextRequest) => {
  const managed = new ManagedSending(platformDatabase(), scope, credentialEncryptionKey());
  if (request.method === 'GET') return await managed.read();
  const raw = await coachBody(request);
  if (raw.action === 'approve') return await managed.approve(raw);
  throw new MarketingStoreError('Geçersiz satış asistanı işlemi.');
});
export const GET = handle, POST = handle;
