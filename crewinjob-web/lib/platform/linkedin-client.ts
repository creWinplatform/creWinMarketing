import 'server-only';
import { AuthorizationCode } from 'simple-oauth2';
export function linkedinConfiguration() {
  const clientId = process.env.PLATFORM_LINKEDIN_CLIENT_ID, clientSecret = process.env.PLATFORM_LINKEDIN_CLIENT_SECRET, redirectUri = process.env.PLATFORM_LINKEDIN_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new Error('LinkedIn OAuth not configured.');
  const url = new URL(redirectUri);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/platform/social/callback') throw new Error('Invalid LinkedIn callback configuration.');
  return { clientId, clientSecret, redirectUri };
}
export function linkedinClient() {
  const configuration = linkedinConfiguration();
  const client = new AuthorizationCode({ client: { id: configuration.clientId, secret: configuration.clientSecret },
    auth: { tokenHost: 'https://www.linkedin.com', tokenPath: '/oauth/v2/accessToken', authorizeHost: 'https://www.linkedin.com', authorizePath: '/oauth/v2/authorization' },
    options: { authorizationMethod: 'body', bodyFormat: 'form' }, http: { timeout: 12000, redirects: false, maxBytes: 65536 } });
  return {
    authorizationUrl: (state: string, publishing = false, target: 'person' | 'organization' = 'person') => client.authorizeURL({ redirect_uri: configuration.redirectUri, scope: target === 'organization' ? `openid profile r_organization_admin${publishing ? ' w_organization_social' : ''}${process.env.PLATFORM_LINKEDIN_ANALYTICS_ENABLED==='1'?' r_organization_social':''}` : publishing ? `openid profile w_member_social${process.env.PLATFORM_LINKEDIN_MEMBER_COMMENTS_ENABLED==='1'?' r_member_social':''}` : 'openid profile', state }),
    exchange: async (code: string) => {
      const result = await client.getToken({ code, redirect_uri: configuration.redirectUri });
      const token = result.token;
      if (typeof token.access_token !== 'string' || typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 31536000) throw new Error('Invalid LinkedIn token.');
      return { accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
    },
  };
}
