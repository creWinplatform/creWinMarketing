import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { hasSameRequestOrigin, panelOrigin } from '@/lib/platform/request-origin';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { MarketingStoreError } from '@/lib/platform/errors';
import { MediaVideos } from '@/lib/platform/media-videos';

// The networks fetch the video from this origin: PLATFORM_PUBLIC_ORIGIN when it is a public https origin, else the
// address this panel was opened from.
export function videoOrigin(request: NextRequest) {
  try {
    const url = new URL(process.env.PLATFORM_PUBLIC_ORIGIN || '');
    if (url.protocol === 'https:' && url.pathname === '/' && !url.search && !url.username) return url.origin;
  } catch { /* fall back to the panel address */ }
  return panelOrigin(request);
}
// Session, same-origin writes and error mapping for the design studio's video routes.
export function videoRoute(run: (videos: MediaVideos, request: NextRequest) => Promise<unknown>) {
  return async (request: NextRequest) => {
    const headers = { 'Cache-Control': 'private, no-store' };
    try {
      const access = await getRyzevoAccess();
      if (!access) return NextResponse.json({ error: 'Proje oturumu gerekli.' }, { status: 403, headers });
      if (request.method !== 'GET' && !hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
      const videos = new MediaVideos(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }, credentialEncryptionKey());
      return NextResponse.json(await run(videos, request), { headers });
    } catch (error) {
      // The reader gets a generic message; the server log keeps the cause (database, storage) without request data.
      if (!(error instanceof MarketingStoreError)) console.error('platform_media_video_failed', JSON.stringify({ name: error instanceof Error ? error.name : typeof error, message: String(error instanceof Error ? error.message : error).slice(0, 300) }));
      return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Video işlemi tamamlanamadı.' }, { status: error instanceof MarketingStoreError ? error.status : 400, headers });
    }
  };
}
