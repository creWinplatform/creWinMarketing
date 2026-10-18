import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { graphVersion, saveOAuthState } from '@/lib/social-tokens';
import { getSessionFromRequest } from '@/lib/auth';
import { publicAppUrl } from '@/lib/internal-fetch';

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

// Redirect URI sağlayıcı panelinde kayıtlı public adresle birebir aynı olmalı
const callbackUrl = (platform: string) => `${publicAppUrl()}/api/social/callback/${platform}`;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  const state = crypto.randomBytes(16).toString('hex');
  // State oturuma bağlanır: callback başka bir oturumda tamamlanamaz (login CSRF)
  const user  = (await getSessionFromRequest(req)) || undefined;

  switch (platform) {

    case 'twitter': {
      const clientId = process.env.TWITTER_CLIENT_ID;
      if (!clientId) return NextResponse.json({ error: '.env.local içinde TWITTER_CLIENT_ID eksik' }, { status: 400 });

      const codeVerifier  = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      saveOAuthState(state, 'twitter', codeVerifier, user);

      const url = new URL('https://twitter.com/i/oauth2/authorize');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', callbackUrl('twitter'));
      url.searchParams.set('scope', 'tweet.write tweet.read users.read offline.access');
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return NextResponse.redirect(url.toString());
    }

    case 'linkedin': {
      const clientId = process.env.LINKEDIN_CLIENT_ID;
      if (!clientId) return NextResponse.json({ error: '.env.local içinde LINKEDIN_CLIENT_ID eksik' }, { status: 400 });
      saveOAuthState(state, 'linkedin', undefined, user);

      const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', callbackUrl('linkedin'));
      url.searchParams.set('scope', 'w_member_social profile openid email');
      url.searchParams.set('state', state);
      return NextResponse.redirect(url.toString());
    }

    case 'facebook':
    case 'instagram': {
      const appId = process.env.FACEBOOK_APP_ID;
      if (!appId) return NextResponse.json({ error: '.env.local içinde FACEBOOK_APP_ID eksik' }, { status: 400 });
      saveOAuthState(state, platform, undefined, user);

      const url = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
      url.searchParams.set('client_id', appId);
      url.searchParams.set('redirect_uri', callbackUrl('facebook'));
      url.searchParams.set('scope', 'pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish');
      url.searchParams.set('state', state);
      return NextResponse.redirect(url.toString());
    }

    default:
      return NextResponse.json({ error: `Bilinmeyen platform: ${platform}` }, { status: 400 });
  }
}
