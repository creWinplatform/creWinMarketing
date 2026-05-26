import { NextResponse } from 'next/server';
import { getToken } from '@/lib/social-tokens';

const CONFIGURED: Record<string, () => boolean> = {
  // Configured = ya OAuth Client ID var ya da statik access token var
  twitter:   () => !!(process.env.TWITTER_CLIENT_ID  || process.env.TWITTER_ACCESS_TOKEN),
  linkedin:  () => !!(process.env.LINKEDIN_ACCESS_TOKEN || (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET)),
  facebook:  () => !!(process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN || (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET)),
  instagram: () => !!(process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET)),
  // TikTok: statik token varsa API modu, yoksa Script Modu olarak görünür
  tiktok:    () => !!(process.env.TIKTOK_ACCESS_TOKEN || process.env.TIKTOK_CLIENT_KEY),
};

export async function GET() {
  const now = Date.now();

  const platforms = ['twitter', 'linkedin', 'facebook', 'instagram', 'tiktok'] as const;

  const status = Object.fromEntries(
    platforms.map((platform) => {
      const token     = getToken(platform);           // dosya + env fallback
      const connected = !!(token?.accessToken);
      const expired   = token?.expiresAt ? token.expiresAt < now : false;
      return [platform, {
        configured: CONFIGURED[platform](),
        connected:  connected && !expired,
        expired,
        username:   token?.username || token?.displayName || token?.pageName || null,
        // TikTok'un Script Modu her zaman kullanılabilir
        scriptOnly: platform === 'tiktok' ? !connected : false,
      }];
    })
  );

  return NextResponse.json(status);
}
