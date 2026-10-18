import { NextRequest, NextResponse } from 'next/server';
import { getToken, graphFetch, twitterOAuth1Creds } from '@/lib/social-tokens';
import { buildOAuthHeader } from '@/lib/oauth1';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

type Stats = { likes: number; comments: number; shares: number; views: number } | { error: string };

// ── Twitter / X metrikleri ───────────────────────────────────────────────────
async function getTwitterStats(postId: string): Promise<Stats> {
  if (!/^\d+$/.test(postId)) return { error: 'Geçersiz tweet ID' };
  const creds = twitterOAuth1Creds();
  if (!creds) return { error: 'Twitter API credentials eksik' };

  const baseUrl     = `https://api.twitter.com/2/tweets/${encodeURIComponent(postId)}`;
  const queryParams = { 'tweet.fields': 'public_metrics' };
  const url         = `${baseUrl}?${new URLSearchParams(queryParams)}`;

  // OAuth1 imzası ortak yardımcıdan — sorgu parametreleri imzaya dahil
  const header = buildOAuthHeader('GET', baseUrl, creds.apiKey, creds.apiSecret, creds.accessToken, creds.tokenSecret, queryParams);
  const res = await fetch(url, { headers: { 'Authorization': header } });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    return { error: (data as { detail?: string }).detail || 'Twitter API hatası' };
  }
  const metrics = ((data.data as Record<string, unknown>)?.public_metrics) as Record<string, number> | undefined;
  if (!metrics) return { error: 'Metrik bulunamadı' };
  return {
    likes:    metrics.like_count    || 0,
    comments: metrics.reply_count   || 0,
    shares:   (metrics.retweet_count || 0) + (metrics.quote_count || 0),
    views:    metrics.impression_count || 0,
  };
}

// ── Facebook metrikleri ──────────────────────────────────────────────────────
async function getFacebookStats(postId: string): Promise<Stats> {
  const oauth       = getToken('facebook');
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || oauth?.accessToken;
  if (!accessToken) return { error: 'Facebook token eksik' };

  if (/^pfbid/i.test(postId)) {
    return { error: 'pfbid biçimli bağlantılar Graph API ile çözümlenemiyor — gönderinin {sayfaId}_{gönderiId} biçimli ID\'sini veya API ile paylaşılan gönderiyi kullanın.' };
  }
  // Yalnızca gönderi numarası verildiyse sayfa ID'si ile tamamla ({pageId}_{postId})
  const pageId = process.env.FACEBOOK_PAGE_ID || oauth?.pageId;
  const id     = /^\d+$/.test(postId) && pageId ? `${pageId}_${postId}` : postId;

  const fields = 'reactions.summary(true),comments.summary(true),shares';
  const res    = await graphFetch(`${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`, accessToken);
  const data   = await res.json();
  if (!res.ok || data.error) return { error: data.error?.message || 'Facebook API hatası' };
  return {
    likes:    data.reactions?.summary?.total_count || 0,
    comments: data.comments?.summary?.total_count  || 0,
    shares:   data.shares?.count || 0,
    views:    0, // FB sayfa görüntülemesi ayrı endpoint
  };
}

// ── LinkedIn metrikleri ──────────────────────────────────────────────────────
async function getLinkedInStats(postUrn: string): Promise<Stats> {
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN || getToken('linkedin')?.accessToken;
  if (!accessToken) return { error: 'LinkedIn token eksik' };

  const url = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(postUrn)}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' },
  });
  const data = await res.json();
  if (!res.ok) return { error: data.message || 'LinkedIn API hatası' };
  return {
    likes:    data.likesSummary?.totalLikes      || 0,
    comments: data.commentsSummary?.totalComments || 0,
    shares:   0,
    views:    0,
  };
}

// ── Instagram metrikleri ─────────────────────────────────────────────────────
/**
 * Manuel takipte URL'den yalnızca kısa kod (shortcode, ör. "C9x…") gelir; Graph API medya ID'si ister.
 * Hesabın son gönderileri taranarak kısa kod medya ID'sine çevrilir.
 */
async function resolveInstagramMediaId(shortcode: string, accessToken: string): Promise<string | null> {
  const igUserId = process.env.INSTAGRAM_IG_USER_ID || getToken('instagram')?.igUserId;
  if (!igUserId) return null;
  const res  = await graphFetch(`${encodeURIComponent(igUserId)}/media?fields=id,shortcode&limit=100`, accessToken);
  const data = await res.json().catch(() => ({})) as { data?: { id: string; shortcode?: string }[] };
  return data.data?.find(m => m.shortcode === shortcode)?.id || null;
}

async function getInstagramStats(postId: string): Promise<Stats> {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || getToken('instagram')?.accessToken;
  if (!accessToken) return { error: 'Instagram token eksik' };

  let mediaId = postId;
  if (!/^\d+$/.test(postId)) {
    const resolved = await resolveInstagramMediaId(postId, accessToken).catch(() => null);
    if (!resolved) {
      return { error: 'Instagram kısa kodu (shortcode) medya ID\'sine çevrilemedi — gönderi bağlı hesabın son 100 gönderisinde değil. API ile paylaşılan gönderiler otomatik izlenir.' };
    }
    mediaId = resolved;
  }

  // "impressions" metriği Nisan 2025'te kaldırıldı → views
  const metrics = 'views,reach,likes,comments,saved,shares';
  const res  = await graphFetch(`${encodeURIComponent(mediaId)}/insights?metric=${metrics}`, accessToken);
  const data = await res.json();
  if (!res.ok || data.error) return { error: data.error?.message || 'Instagram API hatası' };

  const valueOf = (name: string) => {
    const item = (data.data as Record<string, unknown>[])?.find(d => (d as { name: string }).name === name);
    return ((item as { values?: { value: number }[] })?.values?.[0]?.value) || 0;
  };
  return {
    likes:    valueOf('likes'),
    comments: valueOf('comments'),
    shares:   valueOf('shares'),
    views:    valueOf('views') || valueOf('reach'),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const platform = searchParams.get('platform') || '';
  const postId   = (searchParams.get('postId') || '').trim();
  if (!platform || !postId) return NextResponse.json({ error: 'platform ve postId gerekli' }, { status: 400 });

  let result: Stats;
  switch (platform) {
    case 'twitter':   result = await getTwitterStats(postId);   break;
    case 'facebook':  result = await getFacebookStats(postId);  break;
    case 'linkedin':  result = await getLinkedInStats(postId);  break;
    case 'instagram': result = await getInstagramStats(postId); break;
    default:          return NextResponse.json({ error: 'Desteklenmeyen platform' }, { status: 400 });
  }

  if ('error' in result) return NextResponse.json(result, { status: 200 });
  return NextResponse.json({ ...result, fetchedAt: Date.now() });
}
