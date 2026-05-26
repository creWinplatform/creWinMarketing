/**
 * POST /api/schedule/publish
 *
 * Zamanı gelmiş tüm pending postları otomatik yayınlar.
 * Bu endpoint cron ile tetiklenebilir (harici servis veya VPS cron).
 *
 * Vercel Cron örneği (vercel.json):
 *   { "crons": [{ "path": "/api/schedule/publish", "schedule": "0 * * * *" }] }
 *
 * VPS cron örneği (crontab -e):
 *   0 * * * * curl -X POST https://marketing.crewin.org/api/schedule/publish
 */
import { NextRequest, NextResponse }                from 'next/server';
import { getDuePosts, updatePost, ScheduledPost }   from '@/lib/scheduled-posts';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3333';

// İsteğe bağlı secret — cron endpoint'ini korumak için
const CRON_SECRET = process.env.CRON_SECRET;

export async function POST(req: NextRequest) {
  // Güvenlik: CRON_SECRET set edilmişse header kontrol et
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization') || req.headers.get('x-cron-secret');
    const provided = auth?.replace('Bearer ', '');
    if (provided !== CRON_SECRET) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 401 });
    }
  }

  const duePosts = getDuePosts();

  if (duePosts.length === 0) {
    return NextResponse.json({
      published: 0, failed: 0, skipped: 0,
      message:   'Şu an için zamanlanmış bekleyen post yok.',
    });
  }

  const results: Array<{
    postId:    string;
    platforms: string[];
    success:   boolean;
    results?:  ScheduledPost['results'];
    error?:    string;
  }> = [];

  for (const post of duePosts) {
    try {
      const res = await fetch(`${APP_URL}/api/social/post`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          platforms: post.platforms,
          content:   post.content,
          imageData: post.imageData,
          imageMime: post.imageMime,
        }),
      });

      const data        = await res.json();
      const postResults = data.results as ScheduledPost['results'];
      const allOk       = postResults?.every(r => r.success) ?? false;

      // Post durumunu güncelle
      updatePost(post.id, {
        status:      allOk ? 'published' : 'failed',
        publishedAt: new Date().toISOString(),
        results:     postResults,
      });

      results.push({ postId: post.id, platforms: post.platforms, success: allOk, results: postResults });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
      updatePost(post.id, { status: 'failed', results: [{ platform: 'system', success: false, error: message }] });
      results.push({ postId: post.id, platforms: post.platforms, success: false, error: message });
    }
  }

  const published = results.filter(r => r.success).length;
  const failed    = results.filter(r => !r.success).length;

  console.log(`[Schedule Publish] ${published} yayınlandı, ${failed} başarısız — ${new Date().toISOString()}`);

  return NextResponse.json({ published, failed, total: duePosts.length, results });
}

// GET — kaç pending post var (monitoring için)
export async function GET() {
  const duePosts = getDuePosts();
  return NextResponse.json({
    duePosts:   duePosts.length,
    nextAt:     duePosts[0]?.scheduledAt || null,
    checkedAt:  new Date().toISOString(),
  });
}
