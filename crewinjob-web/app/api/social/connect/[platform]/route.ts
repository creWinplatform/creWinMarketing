import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { saveOAuthState } from '@/lib/social-tokens';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3333';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  const state = crypto.randomBytes(16).toString('hex');

  switch (platform) {

    case 'twitter': {
      const clientId = process.env.TWITTER_CLIENT_ID;
      if (!clientId) return NextResponse.json({ error: '.env.local içinde TWITTER_CLIENT_ID eksik' }, { status: 400 });

      const codeVerifier  = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      saveOAuthState(state, 'twitter', codeVerifier);

      const url = new URL('https://twitter.com/i/oauth2/authorize');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', `${APP_URL}/api/social/callback/twitter`);
      url.searchParams.set('scope', 'tweet.write users.read offline.access');
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return NextResponse.redirect(url.toString());
    }

    case 'linkedin': {
      const clientId = process.env.LINKEDIN_CLIENT_ID;
      if (!clientId) return NextResponse.json({ error: '.env.local içinde LINKEDIN_CLIENT_ID eksik' }, { status: 400 });
      saveOAuthState(state, 'linkedin');

      const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', `${APP_URL}/api/social/callback/linkedin`);
      url.searchParams.set('scope', 'w_member_social profile openid email');
      url.searchParams.set('state', state);
      return NextResponse.redirect(url.toString());
    }

    case 'facebook':
    case 'instagram': {
      const appId = process.env.FACEBOOK_APP_ID;
      if (!appId) return NextResponse.json({ error: '.env.local içinde FACEBOOK_APP_ID eksik' }, { status: 400 });
      saveOAuthState(state, platform);

      const url = new URL('https://www.facebook.com/v19.0/dialog/oauth');
      url.searchParams.set('client_id', appId);
      url.searchParams.set('redirect_uri', `${APP_URL}/api/social/callback/facebook`);
      url.searchParams.set('scope', 'pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish');
      url.searchParams.set('state', state);
      return NextResponse.redirect(url.toString());
    }

    default:
      return NextResponse.json({ error: `Bilinmeyen platform: ${platform}` }, { status: 400 });
  }
}
