/**
 * GET  /api/schedule          — Tüm zamanlanmış postları listele
 * POST /api/schedule          — Yeni zamanlanmış post oluştur
 */
import { NextRequest, NextResponse } from 'next/server';
import { createScheduledPost, listScheduledPosts } from '@/lib/scheduled-posts-backend';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function GET() {
  return NextResponse.json(await listScheduledPosts());
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    platforms:   string[];
    content:     string;
    imageData?:  string;
    imageMime?:  string;
    scheduledAt: string;
    note?:       string;
    campaignId?: string;
    deliveryId?: string;
    perPlatformContent?: Record<string, string>;
  };

  if (!body.platforms?.length)  return NextResponse.json({ error: 'Platform seçilmedi' }, { status: 400 });
  if (!body.content?.trim())    return NextResponse.json({ error: 'İçerik boş' },         { status: 400 });
  if (!body.scheduledAt)        return NextResponse.json({ error: 'Zamanlama tarihi eksik' }, { status: 400 });

  const scheduled = new Date(body.scheduledAt);
  if (isNaN(scheduled.getTime())) {
    return NextResponse.json({ error: 'Geçersiz tarih formatı' }, { status: 400 });
  }

  const post = await createScheduledPost({
    platforms:   body.platforms,
    content:     body.content,
    imageData:   body.imageData,
    imageMime:   body.imageMime,
    scheduledAt: scheduled.toISOString(),
    note:        body.note,
    campaignId:  body.campaignId,
    deliveryId:  body.deliveryId,
    perPlatformContent: body.perPlatformContent,
    timezone: process.env.APP_TIMEZONE || 'Europe/Istanbul',
    idempotencyKey: `schedule-${crypto.randomUUID()}`,
  });

  return NextResponse.json(post, { status: 201 });
}
