import { NextRequest } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { panelOrigin } from '@/lib/platform/request-origin';
import { ProspectFinder } from '@/lib/platform/prospect-finder';
import { coachBody, coachRoute } from '../../coach/shared';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
// Sales assistant: company search, site scan (signals and published contact addresses), score settings, the data
// provider terms and mini analysis links. Nothing here sends a message to anyone.
const handle = coachRoute(async (scope, request: NextRequest) => {
  const finder = new ProspectFinder(platformDatabase(), scope);
  if (request.method === 'GET') return await finder.read();
  const raw = await coachBody(request);
  switch (raw.action) {
    case 'discover': return await finder.discover(raw);
    case 'scan': return await finder.scan(raw);
    case 'settings': return await finder.saveSettings(raw);
    case 'accept-terms': return await finder.acceptTerms(raw);
    case 'revoke-terms': return await finder.revokeTerms();
    case 'remove-contact': return await finder.removeContact(raw);
    case 'report': return await finder.createReport(raw, panelOrigin(request));
    case 'revoke-report': return await finder.revokeReport(raw);
  }
  throw new MarketingStoreError('Geçersiz satış asistanı işlemi.');
});
export const GET = handle, POST = handle;
