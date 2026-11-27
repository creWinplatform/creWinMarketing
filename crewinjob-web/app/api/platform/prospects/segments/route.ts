import { NextRequest } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { ProspectSegments } from '@/lib/platform/prospect-segments';
import { coachBody, coachGemini, coachRoute } from '../../coach/shared';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
// Sales assistant, customer groups: suggestions (AI or from approved companies), the team's own groups, which group a
// company belongs to, and each group's results.
const handle = coachRoute(async (scope, request: NextRequest) => {
  const segments = new ProspectSegments(platformDatabase(), scope);
  if (request.method === 'GET') return await segments.read();
  const raw = await coachBody(request);
  switch (raw.action) {
    case 'suggest': return await segments.suggest(raw, raw.mode === 'template' ? undefined : coachGemini(2500));
    case 'save': return await segments.save(raw);
    case 'state': return await segments.state(raw);
    case 'remove': return await segments.remove(raw);
    case 'assign': return await segments.assign(raw);
  }
  throw new MarketingStoreError('Geçersiz satış asistanı işlemi.');
});
export const GET = handle, POST = handle;
