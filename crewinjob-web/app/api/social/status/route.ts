import { NextResponse } from 'next/server';
import { getToken, twitterOAuth1Creds } from '@/lib/social-tokens';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

const CONFIGURED: Record<string, () => boolean> = {
  // Configured = ya OAuth Client ID var ya da statik access token var
  twitter:   () => !!(process.env.TWITTER_CLIENT_ID || twitterOAuth1Creds() || process.env.TWITTER_ACCESS_TOKEN),
  linkedin:  () => !!(process.env.LINKEDIN_ACCESS_TOKEN || (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET)),
  facebook:  () => !!(process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN || (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET)),
  instagram: () => !!(process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET)),
  // TikTok: OAuth akışı YOK — yalnızca statik TIKTOK_ACCESS_TOKEN API modunu açar.
  // TIKTOK_CLIENT_KEY tek başına bağlantı sağlamaz → Script Modu.
  tiktok:    () => !!process.env.TIKTOK_ACCESS_TOKEN,
};

export async function GET() {
  const now = Date.now();

  const platforms = ['twitter', 'linkedin', 'facebook', 'instagram', 'tiktok'] as const;

  const status = Object.fromEntries(
    platforms.map((platform) => {
      const token     = getToken(platform);           // dosya + env fallback
      // Twitter OAuth 1.0a (env) kendi başına bağlantıdır — getToken onu OAuth2 token'ı saymaz
      const oauth1    = platform === 'twitter' && !!twitterOAuth1Creds();
      const connected = oauth1 || !!(token?.accessToken);
      // Twitter OAuth2 token'ı süresi dolsa da refresh_token ile yenilenebilir
      const refreshable = platform === 'twitter' && !!token?.refreshToken && !!process.env.TWITTER_CLIENT_ID;
      const expired   = !oauth1 && !refreshable && token?.expiresAt ? token.expiresAt < now : false;
      const scriptOnly = platform === 'tiktok' && !connected;
      return [platform, {
        configured: CONFIGURED[platform](),
        connected:  connected && !expired,
        expired,
        username:   (oauth1 ? process.env.TWITTER_USERNAME : null) || token?.username || token?.displayName || token?.pageName || null,
        // TikTok'un Script Modu her zaman kullanılabilir; API modu yalnızca TIKTOK_ACCESS_TOKEN ile
        scriptOnly,
        mode:       platform === 'tiktok' ? (scriptOnly ? 'script' : 'api') : (connected ? 'api' : 'none'),
      }];
    })
  );

  return NextResponse.json(status);
}
