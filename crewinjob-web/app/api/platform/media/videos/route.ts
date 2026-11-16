import { readBoundedJsonBytes } from '@/lib/platform/request-json';
import { MarketingStoreError } from '@/lib/platform/errors';
import { videoRoute } from './shared';
export const dynamic = 'force-dynamic';

// GET: the project's ready videos. POST: start an upload ({bytes, sha256, width, height, durationMs}).
const handle = videoRoute(async (videos, request) => {
  if (request.method === 'GET') return await videos.list();
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedJsonBytes(request, 4096))); } catch { throw new MarketingStoreError('Geçersiz istek.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new MarketingStoreError('Geçersiz istek.');
  return await videos.start(body as Record<string, unknown>);
});
export const GET = handle, POST = handle;
