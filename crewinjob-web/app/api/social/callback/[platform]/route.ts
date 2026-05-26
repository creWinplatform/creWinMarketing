import { NextRequest, NextResponse } from 'next/server';
import { consumeOAuthState, setToken } from '@/lib/social-tokens';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3333';

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

  try {
    switch (platform) {

      case 'twitter': {
        const clientId = process.env.TWITTER_CLIENT_ID;
        if (!clientId) return redirect('?social_error=TWITTER_CLIENT_ID+tanımlı+değil');
        const codeVerifier = stateData.codeVerifier!;

        const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type':  'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(`${clientId}:`).toString('base64')}`,
          },
          body: new URLSearchParams({
            grant_type:    'authorization_code',
            code,
            redirect_uri:  `${APP_URL}/api/social/callback/twitter`,
            code_verifier: codeVerifier,
          }),
        });
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
        const clientId     = process.env.LINKEDIN_CLIENT_ID!;
        const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!;

        const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type:    'authorization_code',
            code,
            redirect_uri:  `${APP_URL}/api/social/callback/linkedin`,
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
          expiresAt:    tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
          userId,
          displayName,
        });
        return redirect('?social_connected=linkedin');
      }

      case 'facebook': {
        const appId     = process.env.FACEBOOK_APP_ID!;
        const appSecret = process.env.FACEBOOK_APP_SECRET!;

        // Kısa ömürlü → uzun ömürlü token
        const shortRes = await fetch(
          `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${APP_URL}/api/social/callback/facebook&client_secret=${appSecret}&code=${code}`
        );
        const shortData = await shortRes.json();
        if (!shortRes.ok || shortData.error) throw new Error(shortData.error?.message || 'Token alınamadı');

        const longRes = await fetch(
          `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortData.access_token}`
        );
        const longData = await longRes.json();
        const userToken = longData.access_token || shortData.access_token;

        // Sayfaları al — ilk sayfayı varsayılan yap
        const pagesRes  = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${userToken}`);
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
          const igRes  = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token || userToken}`);
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
  return NextResponse.redirect(`${APP_URL}/${query}`);
}
