/**
 * POST /api/schedule/publish
 *
 * Zamanı gelmiş tüm pending (ve kısmen yayınlanmış) postları otomatik yayınlar.
 * Bu endpoint cron ile tetiklenebilir (harici servis veya VPS cron).
 * Middleware'de public'tir → yetki burada kontrol edilir: geçerli oturum VEYA CRON_SECRET başlığı.
 *
 * VPS cron örneği (crontab -e) — başlık zorunlu, yoksa 401:
 *   0 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://marketing.crewin.org/api/schedule/publish
 *
 * Çift yayın koruması: zamanı gelen postlar kilit altında önce 'publishing' durumuna alınır;
 * aynı anda çalışan cron + "Şimdi Yayınla" aynı postu iki kez göndermez.
 * Kısmi başarı → 'partial' (yalnızca başarısız platformlar sonraki çalıştırmada yeniden denenir).
 */
import { NextRequest, NextResponse }                from 'next/server';
import { claimDuePosts, getDuePosts, updatePost, SCHEDULED_POSTS_LOCK, ScheduledPost } from '@/lib/scheduled-posts';
import { publishToSocial, recordPublishedPosts }   from '@/lib/scheduled-posts-backend';
import { getSessionFromRequest, hasValidCronSecret } from '@/lib/auth';
import { withFileLock }                            from '@/lib/json-store';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

async function authorized(req: NextRequest): Promise<boolean> {
  return hasValidCronSecret(req) || Boolean(await getSessionFromRequest(req));
}

type PostResults = NonNullable<ScheduledPost['results']>;

/** Önceki denemelerin başarılı sonuçlarını korur, yeni denemenin sonuçlarıyla birleştirir. */
function mergeResults(previous: PostResults, latest: PostResults): PostResults {
  const byPlatform = new Map(previous.filter(r => r.success).map(r => [r.platform, r]));
  for (const r of latest) byPlatform.set(r.platform, r);
  return Array.from(byPlatform.values());
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 401 });
  }

  // Sahiplenme: kilit altında 'publishing' işaretle — ikinci çağrı aynı postları göremez
  const duePosts = await withFileLock(SCHEDULED_POSTS_LOCK, () => claimDuePosts());

  if (duePosts.length === 0) {
    return NextResponse.json({
      published: 0, partial: 0, failed: 0, skipped: 0,
      message:   'Şu an için zamanlanmış bekleyen post yok.',
    });
  }

  const results: Array<{
    postId:    string;
    platforms: string[];
    success:   boolean;
    status:    ScheduledPost['status'];
    results?:  ScheduledPost['results'];
    error?:    string;
  }> = [];

  for (const post of duePosts) {
    const previous = post.results || [];
    // Kısmi yayında yalnızca henüz başarılı olmamış platformlar denenir
    const alreadyDone = new Set(previous.filter(r => r.success).map(r => r.platform));
    const platforms   = post.platforms.filter(p => !alreadyDone.has(p));

    try {
      const latest  = platforms.length
        ? await publishToSocial({
            platforms,
            content:   post.content,
            imageData: post.imageData,
            imageMime: post.imageMime,
            perPlatformContent: post.perPlatformContent,
          }, 'schedule-runner')
        : [];
      const merged  = mergeResults(previous, latest);
      const okCount = post.platforms.filter(p => merged.some(r => r.platform === p && r.success)).length;
      const status: ScheduledPost['status'] =
        okCount === post.platforms.length ? 'published' : okCount > 0 ? 'partial' : 'failed';

      await withFileLock(SCHEDULED_POSTS_LOCK, () => updatePost(post.id, {
        status,
        publishedAt: okCount > 0 ? new Date().toISOString() : post.publishedAt,
        results:     merged,
      }));

      // Başarılı yeni paylaşımlar paylaşım geçmişine (SharePanel ile aynı kayıt mantığı)
      await recordPublishedPosts(latest, {
        contentFor: p => post.perPlatformContent?.[p] || post.content,
        imageData:  post.imageData,
        campaignId: post.campaignId,
        deliveryId: post.deliveryId,
        actor:      'schedule-runner',
      });

      results.push({ postId: post.id, platforms: post.platforms, success: status === 'published', status, results: merged });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Bilinmeyen hata';
      // Hiçbir platform denenemedi: önceki başarılar varsa partial (yeniden denenir), yoksa failed
      const status: ScheduledPost['status'] = alreadyDone.size > 0 ? 'partial' : 'failed';
      await withFileLock(SCHEDULED_POSTS_LOCK, () => updatePost(post.id, {
        status,
        results: [...previous.filter(r => r.success), { platform: 'system', success: false, error: message }],
      }));
      results.push({ postId: post.id, platforms: post.platforms, success: false, status, error: message });
    }
  }

  const published = results.filter(r => r.status === 'published').length;
  const partial   = results.filter(r => r.status === 'partial').length;
  const failed    = results.filter(r => r.status === 'failed').length;

  console.log(`[Schedule Publish] ${published} yayınlandı, ${partial} kısmi, ${failed} başarısız — ${new Date().toISOString()}`);

  return NextResponse.json({ published, partial, failed, total: duePosts.length, results });
}

// GET — kaç pending post var (monitoring için)
export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 401 });
  }
  const duePosts = getDuePosts();
  return NextResponse.json({
    duePosts:   duePosts.length,
    nextAt:     duePosts[0]?.scheduledAt || null,
    checkedAt:  new Date().toISOString(),
  });
}
