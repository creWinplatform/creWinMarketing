import { NextRequest, NextResponse } from 'next/server';
import { getToken }           from '@/lib/social-tokens';
import { buildOAuthHeader }   from '@/lib/oauth1';

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

// ── Twitter/X ────────────────────────────────────────────────────────────────
async function postTwitter(content: string): Promise<PostResult> {
  const tweet = content.slice(0, 280);

  // OAuth 1.0a (Free tier — ayda 1.500 tweet)
  const apiKey      = process.env.TWITTER_API_KEY;
  const apiSecret   = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN_V1 || process.env.TWITTER_ACCESS_TOKEN;
  const tokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;

  if (apiKey && apiSecret && accessToken && tokenSecret) {
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
          apiKey:       apiKey ? `${apiKey.slice(0, 6)}...` : 'MISSING',
          apiSecret:    apiSecret ? 'OK' : 'MISSING',
          accessToken:  accessToken ? `${accessToken.slice(0, 6)}...` : 'MISSING',
          tokenSecret:  tokenSecret ? 'OK' : 'MISSING',
        },
      });
      return { platform: 'twitter', success: false, error: parseTwitterError(res.status, data) };
    }
    const tweetId = (data.data as Record<string, string>)?.id;
    return { platform: 'twitter', success: true, url: tweetId ? `https://twitter.com/i/web/status/${tweetId}` : undefined };
  }

  // Fallback: OAuth 2.0 Bearer Token
  const token = getToken('twitter');
  if (!token?.accessToken) return { platform: 'twitter', success: false, error: 'Twitter bağlı değil. .env.local\'a TWITTER_API_KEY ekleyin.' };

  const res  = await fetch('https://api.twitter.com/2/tweets', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: tweet }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) return { platform: 'twitter', success: false, error: parseTwitterError(res.status, data) };
  const tweetId = (data.data as Record<string, string>)?.id;
  return { platform: 'twitter', success: true, url: tweetId ? `https://twitter.com/i/web/status/${tweetId}` : undefined };
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
          authorUrn = userId.startsWith('urn:') ? userId : `urn:li:person:${userId}`;
        }
      } else {
        authorUrn = userId.startsWith('urn:') ? userId : `urn:li:person:${userId}`;
      }
    } catch {
      authorUrn = userId.startsWith('urn:') ? userId : `urn:li:person:${userId}`;
    }
  }
  const headers   = {
    'Authorization':             `Bearer ${accessToken}`,
    'Content-Type':              'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  };

  // Görsel varsa önce yükle
  let assetUrn = '';
  if (imageData) {
    try {
      // 1. Upload kaydı başlat
      const regRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          registerUploadRequest: {
            recipes:              ['urn:li:digitalmediaRecipe:feedshare-image'],
            owner:                authorUrn,
            serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
          },
        }),
      });
      const regData = await regRes.json() as Record<string, unknown>;
      const uploadUrl = (regData.value as Record<string, unknown>)?.uploadMechanism as Record<string, unknown>;
      const httpUpload = uploadUrl?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'] as Record<string, unknown>;
      const putUrl     = httpUpload?.uploadUrl as string;
      assetUrn         = ((regData.value as Record<string, unknown>)?.asset as string) || '';

      // 2. Görseli binary olarak yükle (sharp JPEG çıktısı verir, mime'e göre belirle)
      if (putUrl && assetUrn) {
        const imgBuffer  = Buffer.from(imageData, 'base64');
        const mimeType   = imageData.startsWith('/9j/') ? 'image/jpeg' : 'image/png'; // JPEG magic bytes base64'te /9j/ ile başlar
        await fetch(putUrl, {
          method:  'PUT',
          headers: { 'Content-Type': mimeType },
          body:    imgBuffer,
        });
      } else {
        assetUrn = ''; // yükleme başarısız, text-only devam
      }
    } catch {
      assetUrn = ''; // hata varsa görselsiz devam
    }
  }

  // Post gövdesi — görsel varsa IMAGE kategorisi, yoksa NONE
  const shareContent = assetUrn
    ? {
        shareCommentary:    { text: content.slice(0, 3000) },
        shareMediaCategory: 'IMAGE',
        media: [{
          status:      'READY',
          description: { text: 'CrewinJob Post' },
          media:       assetUrn,
          title:       { text: 'CrewinJob' },
        }],
      }
    : {
        shareCommentary:    { text: content.slice(0, 3000) },
        shareMediaCategory: 'NONE',
      };

  const body = {
    author:          authorUrn,
    lifecycleState:  'PUBLISHED',
    specificContent: { 'com.linkedin.ugc.ShareContent': shareContent },
    visibility:      { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  console.log('[LinkedIn] POST body:', JSON.stringify({ author: body.author, hasImage: !!assetUrn }));
  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers,
    body:   JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json();
    console.error('[LinkedIn API Error]', { status: res.status, body: data });
    return { platform: 'linkedin', success: false, error: data.message || JSON.stringify(data) };
  }
  console.log('[LinkedIn] POST başarılı, status:', res.status);

  const resData = await res.json().catch(() => ({})) as Record<string, unknown>;
  const postId  = (resData.id as string) || '';
  return {
    platform: 'linkedin',
    success:  true,
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
    const ptRes  = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=access_token&access_token=${accessToken}`);
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
    form.append('access_token', pageToken);

    const res  = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
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
      url:      data.post_id ? `https://www.facebook.com/${data.post_id}` : undefined,
    };
  }

  // Görselsiz metin post
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ message: content, access_token: pageToken }),
  });
  const data = await res.json();

  if (!res.ok || data.error) {
    console.error('[Facebook API Error]', { status: res.status, body: data });
    return { platform: 'facebook', success: false, error: data.error?.message || JSON.stringify(data) };
  }

  return {
    platform: 'facebook',
    success:  true,
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
  const imgbbBody = new URLSearchParams();
  imgbbBody.append('key',   imgbbKey);
  imgbbBody.append('image', imageData);
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
  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ image_url: imageUrl, caption: content.slice(0, 2200), access_token: accessToken }),
    }
  );
  const containerData = await containerRes.json();
  if (!containerRes.ok || containerData.error) {
    console.error('[Instagram API Error - container]', { status: containerRes.status, body: containerData });
    return { platform: 'instagram', success: false, error: containerData.error?.message || JSON.stringify(containerData) };
  }

  // 3. Publish
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media_publish`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ creation_id: containerData.id, access_token: accessToken }),
    }
  );
  const publishData = await publishRes.json();
  if (!publishRes.ok || publishData.error) {
    console.error('[Instagram API Error - publish]', { status: publishRes.status, body: publishData });
    return { platform: 'instagram', success: false, error: publishData.error?.message || JSON.stringify(publishData) };
  }

  return { platform: 'instagram', success: true, url: 'https://www.instagram.com/' };
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
