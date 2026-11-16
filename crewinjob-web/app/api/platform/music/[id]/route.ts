import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { musicTrack } from '@/lib/platform/music-library';
export const dynamic = 'force-dynamic';

// One library track's audio, for signed-in project members only (the licence covers use in their videos, not
// redistribution of the file).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await getRyzevoAccess();
    if (!access) return NextResponse.json({ error: 'Proje oturumu gerekli.' }, { status: 403 });
    const track = await musicTrack(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }, (await params).id);
    return new NextResponse(new Uint8Array(track.data), { headers: { 'Content-Type': track.mime, 'Content-Length': String(track.data.length), 'Cache-Control': 'private, max-age=86400', ETag: `"${track.sha256}"`, 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Parça yüklenemedi.' }, { status: error instanceof MarketingStoreError ? error.status : 500 });
  }
}
