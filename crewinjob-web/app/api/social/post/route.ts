import { NextRequest, NextResponse } from 'next/server';
import { getFreshTwitterOAuth2Token, getToken, graphFetch, twitterOAuth1Creds } from '@/lib/social-tokens';
import { buildOAuthHeader }   from '@/lib/oauth1';

// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

interface PostRequest {
  platforms:              string[];
  content:                string;
  perPlatformContent?:    Record<string, string>;  // platform → uyarlanmış metin
  perPlatformImageData?:  Record<string, string>;  // platform → uyarlanmış görsel
  imageData?:             string;
  imageMime?:             string;
}

interface PostResult {
  platform: string;
  success:  boolean;
  url?:     string;
  /** Platformun gerçek gönderi/medya ID'si (metrik takibi için — URL'den çıkarmaya gerek kalmaz) */
  postId?:  string;
  error?:   string;
}

// ── Twitter API hata mesajlarını anlamlı hale getir ──────────────────────────
function parseTwitterError(status: number, data: Record<string, unknown>): string {
  const raw   = (data.detail as string) || (data.title as string) || JSON.stringify(data);
  const lower = raw.toLowerCase();

  // 402 — Aylık tweet kotası dolmuş (Free tier: 1.500/ay)
  if (status === 402 || lower.includes('creditsdepleted') || lower.includes('credits depleted')) {
    return 'TWITTER_MONTHLY_LIMIT';
  }
  // Kredi / plan yetersizliği (diğer kredi hataları)
  if (lower.includes('credits') || lower.includes('enrollment')) {
    return 'TWITTER_NO_CREDITS';
  }
  if (status === 403) {
    return lower.includes('write') || lower.includes('permission')
      ? 'TWITTER_NO_WRITE'
      : 'TWITTER_FORBIDDEN';
  }
  if (status === 401) return 'TWITTER_AUTH_ERROR';
  if (status === 429) return 'TWITTER_RATE_LIMIT';
  if (status === 400 && lower.includes('duplicate')) return 'TWITTER_DUPLICATE';
  return raw;
}

// ── Twitter kısaltma ──────────────────────────────────────────────────────────
function truncateForTwitter(content: string): string {
  const LIMIT = 280;
  if (content.length <= LIMIT) return content;

  // Sondaki hashtag bloğunu ayır
  const hashtagMatch = content.match(/(\s*#[\wÀ-ɏ]+)+\s*$/);
  const hashtags     = hashtagMatch ? hashtagMatch[0].trim() : '';
  const body         = hashtagMatch ? content.slice(0, hashtagMatch.index).trim() : content;

  const suffix    = hashtags ? `\n\n${hashtags}` : '';
  const ellipsis  = '…';
  const available = LIMIT - suffix.length - ellipsis.length;

  if (available <= 0) {
    return content.slice(0, LIMIT - ellipsis.length) + ellipsis;
  }

  if (body.length <= available) {
    // Gövde zaten sığıyor — sadece hashtag ekle
    const combined = body + suffix;
    return combined.length <= LIMIT ? combined : body.slice(0, LIMIT - ellipsis.length) + ellipsis;
  }

  let truncated = body.slice(0, available);

  // Cümle sonunda kes (. ! ?)
  const sentenceEnd = truncated.search(/[.!?][^.!?]{0,10}$/);
  if (sentenceEnd > available * 0.55) {
    const cut = truncated.slice(0, sentenceEnd + 1);
    return (cut + suffix).length <= LIMIT ? cut + suffix : cut + ellipsis;
  }

  // Kelime sonunda kes
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > available * 0.6) truncated = truncated.slice(0, lastSpace);

  return truncated + ellipsis + suffix;
}

// ── Twitter/X ────────────────────────────────────────────────────────────────
async function postTwitter(content: string): Promise<PostResult> {
  const tweet = truncateForTwitter(content);

  // OAuth 1.0a (Free tier — ayda 1.500 tweet)
  const creds = twitterOAuth1Creds();

  if (creds) {
    const { apiKey, apiSecret, accessToken, tokenSecret } = creds;
    const url    = 'https://api.twitter.com/2/tweets';
    const header = buildOAuthHeader('POST', url, apiKey, apiSecret, accessToken, tokenSecret);

    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Authorization': header, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: tweet }),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      // Server console'a tam hata yazdır — teşhis için
      console.error('[Twitter API Error]', {
        status:  res.status,
        body:    data,
        keys:    {
          // Anahtar değerleri (kısmi de olsa) loglanmaz
          apiKey:       apiKey ? 'OK' : 'MISSING',
          apiSecret:    apiSecret ? 'OK' : 'MISSING',
          accessToken:  accessToken ? 'OK' : 'MISSING',
          tokenSecret:  tokenSecret ? 'OK' : 'MISSING',
        },
      });
      return { platform: 'twitter', success: false, error: parseTwitterError(res.status, data) };
    }
    const tweetId = (data.data as Record<string, string>)?.id;
    return { platform: 'twitter', success: true, postId: tweetId, url: tweetId ? `https://twitter.com/i/web/status/${tweetId}` : undefined };
  }

  // Fallback: OAuth 2.0 Bearer Token (OAuth akışıyla bağlanmış hesap) — süresi dolmuşsa yenilenir
  let token = await getFreshTwitterOAuth2Token();
  if (!token?.accessToken) return { platform: 'twitter', success: false, error: 'Twitter bağlı değil. .env.local\'a TWITTER_API_KEY ekleyin.' };

  const send = (accessToken: string) => fetch('https://api.twitter.com/2/tweets', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: tweet }),
  });
  let res = await send(token.accessToken);
  if (res.status === 401 && token.refreshToken) {
    // expiresAt bilinmiyorsa (env token) süre dolumu ancak 401 ile anlaşılır → bir kez yenile ve tekrar dene
    const refreshed = await getFreshTwitterOAuth2Token(true);
    if (refreshed?.accessToken && refreshed.accessToken !== token.accessToken) {
      token = refreshed;
      res   = await send(token.accessToken);
    }
  }
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) return { platform: 'twitter', success: false, error: parseTwitterError(res.status, data) };
  const tweetId = (data.data as Record<string, string>)?.id;
  return { platform: 'twitter', success: true, postId: tweetId, url: tweetId ? `https://twitter.com/i/web/status/${tweetId}` : undefined };
}

// ── LinkedIn "little text" kaçışı ─────────────────────────────────────────────
// Posts API commentary alanı "little text" formatındadır: ayrılmış karakterler kaçırılmazsa
// metin o noktada kesilir veya 422 döner. Önce ters bölü, sonra diğerleri.
function escapeLinkedInText(text: string): string {
  return text.replace(/[\\()[\]{}<>@|~_*]/g, ch => `\\${ch}`);
}

function linkedInHeaders(accessToken: string): Record<string, string> {
  return {
    'Authorization':             `Bearer ${accessToken}`,
    'Content-Type':              'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
    'Linkedin-Version':          process.env.LINKEDIN_API_VERSION || '202608',
  };
}

// ── LinkedIn ─────────────────────────────────────────────────────────────────
async function postLinkedIn(content: string, imageData?: string): Promise<PostResult> {
  // Önce statik env token (Twitter gibi kolay kurulum)
  const staticToken  = process.env.LINKEDIN_ACCESS_TOKEN;
  const staticUserId = process.env.LINKEDIN_USER_ID;

  const oauthToken = getToken('linkedin');
  const accessToken = staticToken || oauthToken?.accessToken;
  const userId      = staticUserId || oauthToken?.userId;

  if (!accessToken) return { platform: 'linkedin', success: false, error: 'LinkedIn bağlı değil. .env.local\'a LINKEDIN_ACCESS_TOKEN ekleyin.' };
  // userId sadece şirket sayfası yoksa gerekli — LINKEDIN_ORGANIZATION_ID varsa gerek yok
  const orgIdCheck = process.env.LINKEDIN_ORGANIZATION_ID;
  if (!userId && !orgIdCheck) return { platform: 'linkedin', success: false, error: 'LinkedIn kullanıcı ID bulunamadı. .env.local\'a LINKEDIN_USER_ID veya LINKEDIN_ORGANIZATION_ID ekleyin.' };

  // Şirket sayfası öncelikli — env'de varsa kullan, yoksa kişisel profil
  let authorUrn: string;
  const orgId = process.env.LINKEDIN_ORGANIZATION_ID;
  console.log('[LinkedIn] LINKEDIN_ORGANIZATION_ID =', orgId ? `"${orgId}"` : 'BOŞ/TANIMSIZ');
  if (orgId) {
    authorUrn = orgId.startsWith('urn:') ? orgId : `urn:li:organization:${orgId}`;
    console.log('[LinkedIn] Şirket URN kullanılıyor:', authorUrn);
  } else {
    // Env'de yoksa API'den admin olunan şirketi otomatik bul
    try {
      const orgRes = await fetch(
        'https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&count=1',
        { headers: { 'Authorization': `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0' } }
      );
      if (orgRes.ok) {
        const orgData = await orgRes.json() as Record<string, unknown>;
        const elements = (orgData.elements as Record<string, unknown>[]) || [];
        const firstOrg = elements[0]?.organization as string;
        if (firstOrg) {
          authorUrn = firstOrg; // zaten "urn:li:organization:xxx" formatında
          console.log('[LinkedIn] Şirket sayfasına post:', authorUrn);
        } else {
          const uid = userId ?? '';
          authorUrn = uid.startsWith('urn:') ? uid : `urn:li:person:${uid}`;
        }
      } else {
        const uid = userId ?? '';
        authorUrn = uid.startsWith('urn:') ? uid : `urn:li:person:${uid}`;
      }
    } catch {
      const uid = userId ?? '';
      authorUrn = uid.startsWith('urn:') ? uid : `urn:li:person:${uid}`;
    }
  }
  const headers = linkedInHeaders(accessToken);

  // Görsel varsa önce yükle (versiyonlu REST Images API)
  let imageUrn = '';
  if (imageData) {
    try {
      // 1. Yükleme başlat → uploadUrl + image URN
      const initRes = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
        method: 'POST',
        headers,
        body:   JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
      });
      const initData = await initRes.json().catch(() => ({})) as { value?: { uploadUrl?: string; image?: string }; message?: string };
      const putUrl   = initData.value?.uploadUrl;
      const urn      = initData.value?.image;
      if (!initRes.ok || !putUrl || !urn) {
        console.warn('[LinkedIn] initializeUpload başarısız:', initRes.status, initData.message || '');
      } else {
        // 2. Görseli binary olarak yükle — sonucu kontrol et (başarısızsa görselsiz devam)
        const imgBuffer = Buffer.from(imageData, 'base64');
        const mimeType  = imageData.startsWith('/9j/') ? 'image/jpeg' : 'image/png'; // JPEG magic bytes base64'te /9j/ ile başlar
        const putRes    = await fetch(putUrl, {
          method:  'PUT',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': mimeType },
          body:    imgBuffer,
        });
        if (putRes.ok) imageUrn = urn;
        else console.warn('[LinkedIn] Görsel yükleme (PUT) başarısız:', putRes.status);
      }
    } catch (e) {
      console.warn('[LinkedIn] Görsel yükleme hatası, görselsiz devam:', e);
      imageUrn = '';
    }
  }

  const body = {
    author:     authorUrn,
    commentary: escapeLinkedInText(content.slice(0, 3000)),
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution:               'MAIN_FEED',
      targetEntities:                 [],
      thirdPartyDistributionChannels: [],
    },
    ...(imageUrn ? { content: { media: { id: imageUrn } } } : {}),
    lifecycleState:            'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };

  console.log('[LinkedIn] POST body:', JSON.stringify({ author: body.author, hasImage: !!imageUrn }));
  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers,
    body:   JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    console.error('[LinkedIn API Error]', { status: res.status, body: data });
    return { platform: 'linkedin', success: false, error: (data.message as string) || JSON.stringify(data) };
  }
  console.log('[LinkedIn] POST başarılı, status:', res.status);

  // Posts API gövde döndürmez — ID x-restli-id başlığında (urn:li:share:… / urn:li:ugcPost:…)
  const postId = res.headers.get('x-restli-id') || '';
  return {
    platform: 'linkedin',
    success:  true,
    postId:   postId || undefined,
    url:      postId ? `https://www.linkedin.com/feed/update/${postId}` : 'https://www.linkedin.com/feed/',
  };
}

// ── Facebook ──────────────────────────────────────────────────────────────────
async function postFacebook(content: string, imageData?: string): Promise<PostResult> {
  // Önce statik env token
  const staticToken  = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const staticPageId = process.env.FACEBOOK_PAGE_ID;

  const oauthToken = getToken('facebook');
  const accessToken = staticToken || oauthToken?.accessToken;
  const pageId      = staticPageId || oauthToken?.pageId;

  if (!accessToken) return { platform: 'facebook', success: false, error: 'Facebook bağlı değil. .env.local\'a FACEBOOK_PAGE_ACCESS_TOKEN ekleyin.' };
  if (!pageId)      return { platform: 'facebook', success: false, error: 'Facebook Sayfa ID bulunamadı. .env.local\'a FACEBOOK_PAGE_ID ekleyin.' };

  // System User Token → Page Access Token dönüşümü
  // (System User token ile doğrudan post atılamaz, page token gerekir)
  let pageToken = accessToken;
  try {
    const ptRes  = await graphFetch(`${encodeURIComponent(pageId)}?fields=access_token`, accessToken);
    const ptData = await ptRes.json() as { access_token?: string };
    if (ptData.access_token) pageToken = ptData.access_token;
  } catch (_) { /* dönüşüm başarısız → mevcut token ile devam et */ }

  // Görsel varsa /photos endpoint'ine gönder (görsel + caption birlikte)
  if (imageData) {
    const form = new FormData();
    const imgBuffer = Buffer.from(imageData, 'base64');
    const mimeType  = imageData.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
    const fileName  = mimeType === 'image/jpeg' ? 'post.jpg' : 'post.png';
    const blob      = new Blob([imgBuffer], { type: mimeType });
    form.append('source',       blob,         fileName);
    form.append('message',      content);

    const res  = await graphFetch(`${encodeURIComponent(pageId)}/photos`, pageToken, {
      method: 'POST',
      body:   form,
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      console.error('[Facebook API Error - photo]', { status: res.status, body: data });
      return { platform: 'facebook', success: false, error: data.error?.message || JSON.stringify(data) };
    }
    return {
      platform: 'facebook',
      success:  true,
      postId:   data.post_id || undefined,
      url:      data.post_id ? `https://www.facebook.com/${data.post_id}` : undefined,
    };
  }

  // Görselsiz metin post
  const res = await graphFetch(`${encodeURIComponent(pageId)}/feed`, pageToken, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message: content }),
  });
  const data = await res.json();

  if (!res.ok || data.error) {
    console.error('[Facebook API Error]', { status: res.status, body: data });
    return { platform: 'facebook', success: false, error: data.error?.message || JSON.stringify(data) };
  }

  return {
    platform: 'facebook',
    success:  true,
    postId:   data.id || undefined,
    url:      data.id ? `https://www.facebook.com/${data.id}` : undefined,
  };
}

// ── Instagram ────────────────────────────────────────────────────────────────
async function postInstagram(content: string, imageData?: string): Promise<PostResult> {
  // Önce statik env token
  const staticToken    = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const staticIgUserId = process.env.INSTAGRAM_IG_USER_ID;

  const oauthToken = getToken('instagram');
  const accessToken = staticToken || oauthToken?.accessToken;
  const igUserId    = staticIgUserId || oauthToken?.igUserId;

  if (!accessToken) return { platform: 'instagram', success: false, error: 'Instagram bağlı değil. .env.local\'a INSTAGRAM_ACCESS_TOKEN ekleyin.' };
  if (!igUserId)    return { platform: 'instagram', success: false, error: 'Instagram Business hesap ID bulunamadı. .env.local\'a INSTAGRAM_IG_USER_ID ekleyin.' };
  if (!imageData)   return { platform: 'instagram', success: false, error: 'Instagram\'da görsel zorunlu. Önce görsel oluşturun.' };

  // Instagram Graph API: base64 değil, public URL gerekiyor.
  // Görseli ImgBB ücretsiz API'ye yükle → URL al → Instagram'a gönder
  const imgbbKey = process.env.IMGBB_API_KEY;
  if (!imgbbKey) {
    return {
      platform: 'instagram',
      success:  false,
      error:    'Instagram için IMGBB_API_KEY gerekli. imgbb.com/api → ücretsiz API key alın ve .env.local\'a ekleyin.',
    };
  }

  // 1. ImgBB'ye yükle (URLSearchParams — FormData sunucu taraflı Cloudflare bloğu yaşar)
  // Görsel yalnızca Instagram'ın çekmesi için gerekli → 24 saat sonra silinsin (blog yüklemeleri süresiz kalır)
  const imgbbBody = new URLSearchParams();
  imgbbBody.append('key',        imgbbKey);
  imgbbBody.append('image',      imageData);
  imgbbBody.append('expiration', '86400');
  const uploadRes  = await fetch('https://api.imgbb.com/1/upload', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':   'Mozilla/5.0 (compatible; CrewinJob/1.0)',
    },
    body: imgbbBody.toString(),
  });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.data?.url) {
    return { platform: 'instagram', success: false, error: `Görsel yüklenemedi: ${uploadData.error?.message || 'ImgBB hatası'}` };
  }
  const imageUrl = uploadData.data.url as string;

  // 2. Media container oluştur
  const containerRes = await graphFetch(`${encodeURIComponent(igUserId)}/media`, accessToken, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ image_url: imageUrl, caption: content.slice(0, 2200) }),
  });
  const containerData = await containerRes.json();
  if (!containerRes.ok || containerData.error) {
    console.error('[Instagram API Error - container]', { status: containerRes.status, body: containerData });
    return { platform: 'instagram', success: false, error: containerData.error?.message || JSON.stringify(containerData) };
  }
  const containerId = containerData.id as string;

  // 3. Container işlenene kadar bekle (maks 30s, 3s aralıkla)
  let statusCode = 'IN_PROGRESS';
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    const statusRes  = await graphFetch(`${encodeURIComponent(containerId)}?fields=status_code`, accessToken);
    const statusData = await statusRes.json() as { status_code?: string; error?: { message: string } };
    if (statusData.error) {
      return { platform: 'instagram', success: false, error: `Container durum hatası: ${statusData.error.message}` };
    }
    statusCode = statusData.status_code || 'IN_PROGRESS';
    if (statusCode === 'FINISHED') break;
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      return { platform: 'instagram', success: false, error: `Instagram görsel işleme başarısız (durum: ${statusCode})` };
    }
  }
  if (statusCode !== 'FINISHED') {
    return { platform: 'instagram', success: false, error: 'Instagram görseli 30 saniyede işlenemedi, lütfen tekrar dene.' };
  }

  // 4. Publish
  const publishRes = await graphFetch(`${encodeURIComponent(igUserId)}/media_publish`, accessToken, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ creation_id: containerId }),
  });
  const publishData = await publishRes.json();
  if (!publishRes.ok || publishData.error) {
    console.error('[Instagram API Error - publish]', { status: publishRes.status, body: publishData });
    return { platform: 'instagram', success: false, error: publishData.error?.message || JSON.stringify(publishData) };
  }

  // 5. Gerçek medya ID'si (metrikler için) + kalıcı bağlantı
  const mediaId = (publishData.id as string) || '';
  let permalink = '';
  if (mediaId) {
    try {
      const plRes  = await graphFetch(`${encodeURIComponent(mediaId)}?fields=permalink`, accessToken);
      const plData = await plRes.json() as { permalink?: string };
      permalink = plData.permalink || '';
    } catch { /* permalink alınamazsa genel profil bağlantısı */ }
  }

  return { platform: 'instagram', success: true, postId: mediaId || undefined, url: permalink || 'https://www.instagram.com/' };
}

// ── TikTok ───────────────────────────────────────────────────────────────────
async function postTikTok(content: string): Promise<PostResult> {
  const accessToken = process.env.TIKTOK_ACCESS_TOKEN || getToken('tiktok')?.accessToken;

  if (!accessToken) {
    return {
      platform: 'tiktok',
      success:  false,
      error:    'TikTok bağlı değil. .env.local\'a TIKTOK_ACCESS_TOKEN ekleyin veya Script Modu\'nu kullanın.',
    };
  }

  // TikTok Content Posting API v2 — Text Post
  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/text/init/', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type':  'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title:            content.slice(0, 2200),
        privacy_level:    'PUBLIC_TO_EVERYONE',
        disable_duet:     false,
        disable_comment:  false,
        disable_stitch:   false,
      },
      post_mode:  'DIRECT_POST',
      media_type: 'TEXT',
    }),
  });

  const data = await res.json() as Record<string, unknown>;

  if (!res.ok || (data.error as Record<string, unknown>)?.code !== 'ok') {
    const errorCode = (data.error as Record<string, unknown>)?.code as string || 'unknown';
    const errorMsg  = (data.error as Record<string, unknown>)?.message as string || JSON.stringify(data);
    console.error('[TikTok API Error]', { status: res.status, body: data });

    if (errorCode === 'access_token_invalid' || res.status === 401) {
      return { platform: 'tiktok', success: false, error: 'TikTok token geçersiz. TIKTOK_ACCESS_TOKEN değerini kontrol edin.' };
    }
    if (res.status === 403) {
      return { platform: 'tiktok', success: false, error: 'TikTok izin hatası. Uygulamanızın "post.publish.text" iznine sahip olduğundan emin olun.' };
    }
    if (errorCode === 'spam_risk_too_many_posts') {
      return { platform: 'tiktok', success: false, error: 'TikTok spam limiti: çok fazla gönderi denemesi. Biraz bekleyip tekrar deneyin.' };
    }
    return { platform: 'tiktok', success: false, error: errorMsg };
  }

  const publishId = ((data.data as Record<string, unknown>)?.publish_id as string) || '';
  return {
    platform: 'tiktok',
    success:  true,
    url:      publishId ? `https://www.tiktok.com/` : 'https://www.tiktok.com/',
  };
}

// ── Ana POST handler ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { platforms, content, perPlatformContent, perPlatformImageData, imageData, imageMime } = await req.json() as PostRequest;

  if (!platforms?.length) return NextResponse.json({ error: 'Platform seçilmedi' }, { status: 400 });
  if (!content?.trim())   return NextResponse.json({ error: 'İçerik boş' }, { status: 400 });

  const results: PostResult[] = await Promise.all(
    platforms.map(async (p) => {
      // Platform için uyarlanmış metin ve görsel — yoksa orijinali kullan
      const platformContent  = perPlatformContent?.[p]   || content;
      const platformImage    = perPlatformImageData?.[p] || imageData;
      try {
        switch (p) {
          case 'twitter':   return await postTwitter(platformContent);
          case 'linkedin':  return await postLinkedIn(platformContent, platformImage);
          case 'facebook':  return await postFacebook(platformContent, platformImage);
          case 'instagram': return await postInstagram(platformContent, platformImage);
          case 'tiktok':    return await postTikTok(platformContent);
          default:          return { platform: p, success: false, error: 'Desteklenmeyen platform' };
        }
      } catch (err: unknown) {
        return { platform: p, success: false, error: err instanceof Error ? err.message : 'Bilinmeyen hata' };
      }
    })
  );

  return NextResponse.json({ results });
}
