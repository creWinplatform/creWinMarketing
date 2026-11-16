import { NextRequest, NextResponse } from 'next/server';
import { readBoundedBodyBytes, readBoundedJsonBytes } from '@/lib/platform/request-json';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { MarketingStoreError } from '@/lib/platform/errors';
import { VIDEO_PART_BYTES, publicVideo } from '@/lib/platform/media-videos';
import { videoOrigin, videoRoute } from '../shared';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };

// Signed public read (Instagram, Facebook and TikTok fetch the file): GET and HEAD, with single byte ranges.
async function serve(request: NextRequest, id: string, head: boolean) {
  const headers: Record<string, string> = { 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Accept-Ranges': 'bytes' };
  const q = request.nextUrl.searchParams;
  const video = q.size === 1 ? await publicVideo(platformDatabase(), credentialEncryptionKey(), id, q.get('signature') || '').catch(() => null) : null;
  if (!video) return new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  Object.assign(headers, { 'Content-Type': 'video/mp4', ETag: `"${video.sha256}"`, 'Last-Modified': new Date(video.readyAt).toUTCString() });
  const size = video.file.length, range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2])), end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return new NextResponse(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    return new NextResponse(head ? null : new Uint8Array(video.file.subarray(start, end + 1)), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
  }
  return new NextResponse(head ? null : new Uint8Array(video.file), { headers: { ...headers, 'Content-Length': String(size) } });
}
export async function GET(request: NextRequest, { params }: Context) {
  const id = (await params).id;
  if (request.nextUrl.searchParams.has('signature')) return serve(request, id, false);
  return new NextResponse(null, { status: 404 });
}
export async function HEAD(request: NextRequest, { params }: Context) { return serve(request, (await params).id, true); }

// Session routes: PUT ?part=N uploads one part (binary body); POST {action:'finish'} checks and publishes the file;
// DELETE removes it.
export async function PUT(request: NextRequest, context: Context) {
  const id = (await context.params).id;
  return videoRoute(async videos => {
    const part = Number(request.nextUrl.searchParams.get('part'));
    let data: Uint8Array;
    try { data = await readBoundedBodyBytes(request, VIDEO_PART_BYTES); } catch { throw new MarketingStoreError('Video parçası okunamadı veya çok büyük.', 413); }
    return await videos.part(id, part, data);
  })(request);
}
export async function POST(request: NextRequest, context: Context) {
  const id = (await context.params).id;
  return videoRoute(async videos => {
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedJsonBytes(request, 1024))); } catch { throw new MarketingStoreError('Geçersiz istek.'); }
    if (body.action !== 'finish') throw new MarketingStoreError('Geçersiz video işlemi.');
    return await videos.finish(id, videoOrigin(request));
  })(request);
}
export async function DELETE(request: NextRequest, context: Context) {
  const id = (await context.params).id;
  return videoRoute(async videos => await videos.remove(id))(request);
}
