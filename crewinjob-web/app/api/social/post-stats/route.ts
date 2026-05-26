import { NextRequest, NextResponse } from 'next/server';
import { getToken } from '@/lib/social-tokens';
import crypto from 'crypto';

// ── OAuth 1.0a imza üretici (Twitter Free tier okuma için) ───────────────────
function oauthSign(method: string, url: string, params: Record<string, string>, consumerSecret: string, tokenSecret: string): string {
  const sorted = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  const base = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`;
  const key  = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return crypto.createHmac('sha1', key).update(base).digest('base64');
}

function buildOAuthHeader(method: string, url: string, queryParams: Record<string, string>, consumerKey: string, consumerSecret: string, accessToken: string, tokenSecret: string): string {
  const nonce     = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        timestamp,
    oauth_token:            accessToken,
    oauth_version:          '1.0',
  };
  // İmza için hem oauth params hem query params kullanılır
  const allParams = { ...oauthParams, ...queryParams };
  const signature = oauthSign(method, url, allParams, consumerSecret, tokenSecret);
  oauthParams.oauth_signature = signature;
  return 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');
}

// ── Twitter / X metrikleri ───────────────────────────────────────────────────
async function getTwitterStats(postId: string) {
  const apiKey      = process.env.TWITTER_API_KEY;
  const apiSecret   = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN_V1 || process.env.TWITTER_ACCESS_TOKEN;
  const tokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;

  const baseUrl     = `https://api.twitter.com/2/tweets/${postId}`;
  const queryParams = { 'tweet.fields': 'public_metrics' };
  const url         = `${baseUrl}?tweet.fields=public_metrics`;

  if (!apiKey || !apiSecret || !accessToken || !tokenSecret) {
    return { error: 'Twitter API credentials eksik' };
  }

  const header = buildOAuthHeader('GET', baseUrl, queryParams, apiKey, apiSecret, accessToken, tokenSecret);
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
async function getFacebookStats(postId: string) {
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || getToken('facebook')?.accessToken;
  if (!accessToken) return { error: 'Facebook token eksik' };

  const fields = 'reactions.summary(true),comments.summary(true),shares';
  const url    = `https://graph.facebook.com/v19.0/${postId}?fields=${fields}&access_token=${accessToken}`;
  const res    = await fetch(url);
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
async function getLinkedInStats(postUrn: string) {
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
async function getInstagramStats(postId: string) {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || getToken('instagram')?.accessToken;
  if (!accessToken) return { error: 'Instagram token eksik' };

  const url = `https://graph.facebook.com/v19.0/${postId}/insights?metric=engagement,impressions,reach,likes,comments&access_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) return { error: data.error?.message || 'Instagram API hatası' };

  const valueOf = (name: string) => {
    const item = (data.data as Record<string, unknown>[])?.find(d => (d as { name: string }).name === name);
    return ((item as { values?: { value: number }[] })?.values?.[0]?.value) || 0;
  };
  return {
    likes:    valueOf('likes'),
    comments: valueOf('comments'),
    shares:   0,
    views:    valueOf('impressions') || valueOf('reach'),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const platform = searchParams.get('platform') || '';
  const postId   = searchParams.get('postId')   || '';
  if (!platform || !postId) return NextResponse.json({ error: 'platform ve postId gerekli' }, { status: 400 });

  let result;
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
