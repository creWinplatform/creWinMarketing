import { NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { musicTracks } from '@/lib/platform/music-library';
export const dynamic = 'force-dynamic';

// The licensed music library (titles, moods and licence text; the audio is at /api/platform/music/<id>).
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const access = await getRyzevoAccess();
    if (!access) return NextResponse.json({ error: 'Proje oturumu gerekli.' }, { status: 403, headers });
    return NextResponse.json({ tracks: await musicTracks(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }) }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Müzik kütüphanesi yüklenemedi.' }, { status: error instanceof MarketingStoreError ? error.status : 500, headers });
  }
}
