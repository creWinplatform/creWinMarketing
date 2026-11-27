import { NextRequest } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProspectSources } from '@/lib/platform/prospect-sources';
import { coachBody, coachRoute } from '../../coach/shared';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
// Sales assistant, advanced sources: a company list the team brings, person addresses from the team's own Hunter
// account or a guess, and companies visiting the project's site. Each needs the owner's acceptance first.
const handle = coachRoute(async (scope, request: NextRequest) => {
  const sources = new ProspectSources(platformDatabase(), scope, credentialEncryptionKey());
  if (request.method === 'GET') return await sources.read();
  const raw = await coachBody(request);
  switch (raw.action) {
    case 'accept-terms': return await sources.acceptTerms(raw);
    case 'revoke-terms': return await sources.revokeTerms(raw);
    case 'import': return await sources.importList(raw);
    case 'hunter-key': return await sources.saveHunterKey(raw);
    case 'hunter-remove': return await sources.removeHunterKey();
    case 'hunter': return await sources.hunter(raw);
    case 'guess': return await sources.guess(raw);
    case 'people': return await sources.people(raw);
    case 'pick-person': return await sources.pickPerson(raw);
    case 'remove-contact': return await sources.removeExtra(raw);
    case 'visitors': return await sources.setVisitors(raw);
    case 'add-visitor': return await sources.addVisitor(raw);
  }
  throw new MarketingStoreError('Geçersiz satış asistanı işlemi.');
});
export const GET = handle, POST = handle;
