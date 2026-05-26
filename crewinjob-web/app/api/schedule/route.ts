/**
 * GET  /api/schedule          — Tüm zamanlanmış postları listele
 * POST /api/schedule          — Yeni zamanlanmış post oluştur
 */
import { NextRequest, NextResponse } from 'next/server';
import { loadPosts, createPost }     from '@/lib/scheduled-posts';

export async function GET() {
  const posts = loadPosts().sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
  );
  return NextResponse.json(posts);
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    platforms:   string[];
    content:     string;
    imageData?:  string;
    imageMime?:  string;
    scheduledAt: string;
    note?:       string;
  };

  if (!body.platforms?.length)  return NextResponse.json({ error: 'Platform seçilmedi' }, { status: 400 });
  if (!body.content?.trim())    return NextResponse.json({ error: 'İçerik boş' },         { status: 400 });
  if (!body.scheduledAt)        return NextResponse.json({ error: 'Zamanlama tarihi eksik' }, { status: 400 });

  const scheduled = new Date(body.scheduledAt);
  if (isNaN(scheduled.getTime())) {
    return NextResponse.json({ error: 'Geçersiz tarih formatı' }, { status: 400 });
  }

  const post = createPost({
    platforms:   body.platforms,
    content:     body.content,
    imageData:   body.imageData,
    imageMime:   body.imageMime,
    scheduledAt: scheduled.toISOString(),
    note:        body.note,
  });

  return NextResponse.json(post, { status: 201 });
}
