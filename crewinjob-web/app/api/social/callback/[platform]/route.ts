import { NextRequest, NextResponse } from 'next/server';
import { consumeOAuthState, graphFetch, graphUrl, setToken, twitterTokenRequest } from '@/lib/social-tokens';
import { getSessionFromRequest } from '@/lib/auth';
import { publicAppUrl } from '@/lib/internal-fetch';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// connect route'undaki redirect_uri ile birebir aynı olmalı (token değişiminde tekrar gönderilir)
const callbackUrl = (platform: string) => `${publicAppUrl()}/api/social/callback/${platform}`;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) return redirect(`?social_error=${encodeURIComponent(error)}`);
  if (!code || !state) return redirect('?social_error=Eksik+parametre');

  const stateData = consumeOAuthState(state);
  if (!stateData) return redirect('?social_error=Geçersiz+veya+süresi+dolmuş+state');

  // State yalnızca başlatıldığı platformun callback'inde geçerli (FB diyaloğu IG için de kullanılır)
  const expected = platform === 'facebook' ? ['facebook', 'instagram'] : [platform];
  if (!expected.includes(stateData.platform)) return redirect('?social_error=State+platform+uyuşmuyor');

  // Akışı başlatan oturumla aynı oturum olmalı (SameSite=Lax cookie callback'te gelir)
  const sessionUser = await getSessionFromRequest(req);
  if (stateData.user && stateData.user !== sessionUser) return redirect('?social_error=Oturum+uyuşmuyor');

  try {
    switch (platform) {

      case 'twitter': {
        const clientId = process.env.TWITTER_CLIENT_ID;
        if (!clientId) return redirect('?social_error=TWITTER_CLIENT_ID+tanımlı+değil');
        if (!stateData.codeVerifier) return redirect('?social_error=PKCE+doğrulayıcı+eksik');

        const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', twitterTokenRequest({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  callbackUrl('twitter'),
          code_verifier: stateData.codeVerifier,
        }));
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenData.error_description || JSON.stringify(tokenData));

        // Kullanıcı bilgisi al
        const meRes = await fetch('https://api.twitter.com/2/users/me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const me = await meRes.json();

        setToken('twitter', {
          accessToken:  tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt:    tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
          userId:       me.data?.id,
          username:     me.data?.username,
        });
        return redirect('?social_connected=twitter');
      }

      case 'linkedin': {
        const clientId     = process.env.LINKEDIN_CLIENT_ID;
        const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
        if (!clientId || !clientSecret) return redirect('?social_error=LINKEDIN_CLIENT_ID%2FSECRET+tanımlı+değil');

        const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type:    'authorization_code',
            code,
            redirect_uri:  callbackUrl('linkedin'),
            client_id:     clientId,
            client_secret: clientSecret,
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) throw new Error(tokenData.error_description || JSON.stringify(tokenData));

        // Profil bilgisi — userinfo endpoint (OpenID Connect)
        let userId      = '';
        let displayName = '';
        try {
          const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
          });
          if (profileRes.ok) {
            const profile = await profileRes.json();
            userId      = profile.sub || '';
            displayName = profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim();
          }
        } catch { /* profil alınamazsa boş bırak */ }

        setToken('linkedin', {
          accessToken:  tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt:    tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
          userId,
          displayName,
        });
        return redirect('?social_connected=linkedin');
      }

      case 'facebook': {
        const appId     = process.env.FACEBOOK_APP_ID;
        const appSecret = process.env.FACEBOOK_APP_SECRET;
        if (!appId || !appSecret) return redirect('?social_error=FACEBOOK_APP_ID%2FSECRET+tanımlı+değil');

        // Kısa ömürlü → uzun ömürlü token. client_secret ve kod URL'ye değil POST gövdesine yazılır.
        const shortRes = await fetch(graphUrl('oauth/access_token'), {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    new URLSearchParams({
            client_id:     appId,
            client_secret: appSecret,
            redirect_uri:  callbackUrl('facebook'),
            code,
          }),
        });
        const shortData = await shortRes.json();
        if (!shortRes.ok || shortData.error) throw new Error(shortData.error?.message || 'Token alınamadı');

        const longRes = await fetch(graphUrl('oauth/access_token'), {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    new URLSearchParams({
            grant_type:        'fb_exchange_token',
            client_id:         appId,
            client_secret:     appSecret,
            fb_exchange_token: shortData.access_token,
          }),
        });
        const longData = await longRes.json();
        const userToken = longData.access_token || shortData.access_token;

        // Sayfaları al — ilk sayfayı varsayılan yap
        const pagesRes  = await graphFetch('me/accounts?fields=id,name,access_token', userToken);
        const pagesData = await pagesRes.json();
        const page      = pagesData.data?.[0];

        setToken('facebook', {
          accessToken:  page?.access_token || userToken,
          pageId:       page?.id,
          pageName:     page?.name,
          expiresAt:    longData.expires_in ? Date.now() + longData.expires_in * 1000 : undefined,
        });

        // Instagram Business hesabı bağla (eğer varsa)
        if (page?.id) {
          const igRes  = await graphFetch(`${encodeURIComponent(page.id)}?fields=instagram_business_account`, page.access_token || userToken);
          const igData = await igRes.json();
          if (igData.instagram_business_account?.id) {
            setToken('instagram', {
              accessToken: page.access_token || userToken,
              igUserId:    igData.instagram_business_account.id,
              displayName: page.name + ' (Instagram)',
            });
          }
        }

        return redirect(`?social_connected=${stateData.platform || 'facebook'}`);
      }

      default:
        return redirect(`?social_error=Bilinmeyen+platform`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
    return redirect(`?social_error=${encodeURIComponent(msg)}`);
  }
}

function redirect(query: string) {
  return NextResponse.redirect(`${publicAppUrl()}/${query}`);
}
