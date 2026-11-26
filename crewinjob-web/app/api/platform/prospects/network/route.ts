import { NextRequest } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProspectNetwork } from '@/lib/platform/prospect-network';
import { coachBody, coachGemini, coachRoute } from '../../coach/shared';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
// Warm introductions: the team's LinkedIn connections matched with the companies on the list; messages are prepared,
// a person sends them from their own account.
const handle = coachRoute(async (scope, request: NextRequest) => {
  const network = new ProspectNetwork(platformDatabase(), scope, credentialEncryptionKey());
  if (request.method === 'GET') return await network.read({ q: request.nextUrl.searchParams.get('q') || '' });
  const raw = await coachBody(request);
  switch (raw.action) {
    case 'import': return await network.importCsv(raw);
    case 'clear': return await network.clear();
    case 'draft': return await network.draft(raw, raw.mode === 'template' ? undefined : coachGemini(1200));
    case 'mark': return await network.mark(raw);
    case 'add-company': return await network.addCompany(raw);
    case 'search': return await network.read(raw);
  }
  throw new MarketingStoreError('Geçersiz satış asistanı işlemi.');
});
export const GET = handle, POST = handle;
