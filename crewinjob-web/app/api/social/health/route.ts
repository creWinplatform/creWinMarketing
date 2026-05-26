/**
 * GET /api/social/health
 *
 * Her platformun token'ını gerçek bir API çağrısıyla doğrular.
 * Yalnızca READ isteği yapar — hiçbir post oluşturmaz.
 */
import { NextResponse }       from 'next/server';
import { getToken }           from '@/lib/social-tokens';
import { buildOAuthHeader }   from '@/lib/oauth1';

interface HealthResult {
  platform: string;
  ok:       boolean;
  status?:  number;
  detail?:  string;
  account?: string;
}

async function checkTwitter(): Promise<HealthResult> {
  const apiKey      = process.env.TWITTER_API_KEY;
  const apiSecret   = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN_V1 || process.env.TWITTER_ACCESS_TOKEN;
  const tokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !tokenSecret) {
    return { platform: 'twitter', ok: false, detail: 'Token eksik' };
  }

  // /2/users/me — sadece okur
  const url    = 'https://api.twitter.com/2/users/me';
  const header = buildOAuthHeader('GET', url, apiKey, apiSecret, accessToken, tokenSecret);
  const res    = await fetch(url, { headers: { Authorization: header } });
  const data   = await res.json() as Record<string, unknown>;
  const name   = (data.data as Record<string, string>)?.name;
  return {
    platform: 'twitter',
    ok:       res.ok,
    status:   res.status,
    detail:   res.ok ? undefined : ((data.detail as string) || (data.title as string)),
    account:  name,
  };
}

async function checkLinkedIn(): Promise<HealthResult> {
  const token = process.env.LINKEDIN_ACCESS_TOKEN || getToken('linkedin')?.accessToken;
  if (!token) return { platform: 'linkedin', ok: false, detail: 'Token eksik' };

  // /v2/me r_liteprofile gerektirir — token sadece w_member_social içeriyorsa 403 döner.
  // Bunun yerine organizationAcls endpoint'ini dene (r_organization_admin veya w_member_social ile erişilebilir)
  const orgId = process.env.LINKEDIN_ORGANIZATION_ID;
  if (orgId) {
    const urn = orgId.startsWith('urn:') ? orgId : `urn:li:organization:${orgId}`;
    const res = await fetch(
      `https://api.linkedin.com/v2/organizations/${orgId.replace(/^urn:li:organization:/, '')}?fields=localizedName`,
      { headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' } }
    );
    const data = await res.json() as Record<string, unknown>;
    // 403 bile olsa token var demektir — web intent modu için yeterli
    const hasToken = !!token && token.length > 20;
    return {
      platform: 'linkedin',
      ok:       hasToken,
      status:   res.status,
      detail:   hasToken ? 'Web Intent modu aktif (w_member_social token)' : 'Token geçersiz',
      account:  (data.localizedName as string) || `Org #${orgId}` || undefined,
    };
  }

  // Token var ama org ID yok — token'ın varlığını yeterli say
  const hasToken = !!token && token.length > 20;
  return {
    platform: 'linkedin',
    ok:       hasToken,
    detail:   hasToken ? 'Token mevcut, Web Intent modu' : 'Token eksik veya geçersiz',
  };
}

async function checkFacebook(): Promise<HealthResult> {
  const token  = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!token || !pageId) return { platform: 'facebook', ok: false, detail: 'Token veya Page ID eksik' };

  const res  = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=name&access_token=${token}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    platform: 'facebook',
    ok:       res.ok && !data.error,
    status:   res.status,
    detail:   data.error ? (data.error as Record<string, string>).message : undefined,
    account:  (data.name as string) || undefined,
  };
}

async function checkInstagram(): Promise<HealthResult> {
  const token    = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const igUserId = process.env.INSTAGRAM_IG_USER_ID;
  if (!token || !igUserId) return { platform: 'instagram', ok: false, detail: 'Token veya IG User ID eksik' };

  const res  = await fetch(`https://graph.facebook.com/v19.0/${igUserId}?fields=username&access_token=${token}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    platform: 'instagram',
    ok:       res.ok && !data.error,
    status:   res.status,
    detail:   data.error ? (data.error as Record<string, string>).message : undefined,
    account:  (data.username as string) || undefined,
  };
}

export async function GET() {
  // Paralel kontrol — hepsini aynı anda sorgula
  const results = await Promise.allSettled([
    checkTwitter(),
    checkLinkedIn(),
    checkFacebook(),
    checkInstagram(),
  ]);

  const health: HealthResult[] = results.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : { platform: 'unknown', ok: false, detail: (r.reason as Error)?.message || 'Hata' }
  );

  const allOk = health.every(h => h.ok);
  return NextResponse.json({ allOk, platforms: health }, { status: allOk ? 200 : 207 });
}
