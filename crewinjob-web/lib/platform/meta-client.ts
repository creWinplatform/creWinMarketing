import 'server-only';
import { AuthorizationCode } from 'simple-oauth2';
import { readSocialJson } from './social-connection';
export function metaConfiguration() {
  const clientId = process.env.PLATFORM_META_APP_ID, clientSecret = process.env.PLATFORM_META_APP_SECRET, redirectUri = process.env.PLATFORM_META_REDIRECT_URI, graphVersion = process.env.PLATFORM_META_GRAPH_VERSION;
  if (!clientId || !clientSecret || !redirectUri || !graphVersion || !/^v\d{1,3}\.0$/.test(graphVersion)) throw new Error('Meta OAuth not configured.');
  const url = new URL(redirectUri);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/platform/meta/callback') throw new Error('Invalid Meta callback configuration.');
  return { clientId, clientSecret, redirectUri, graphVersion };
}
export function metaClient() {
  const configuration = metaConfiguration();
  const client = new AuthorizationCode({ client: { id: configuration.clientId, secret: configuration.clientSecret },
    auth: { tokenHost: 'https://graph.facebook.com', tokenPath: `/${configuration.graphVersion}/oauth/access_token`, authorizeHost: 'https://www.facebook.com', authorizePath: `/${configuration.graphVersion}/dialog/oauth` },
    options: { authorizationMethod: 'body', bodyFormat: 'form' }, http: { timeout: 12000, redirects: false, maxBytes: 65536 } });
  return {
    appId: configuration.clientId,
    graphVersion: configuration.graphVersion,
    // inbox: the comment and message permissions the social inbox reads and replies with.
    authorizationUrl: (state: string, target: string, publishing = false, inbox = false) => client.authorizeURL({ redirect_uri: configuration.redirectUri, scope: target === 'instagram' ? `pages_show_list,pages_read_engagement,instagram_basic${publishing ? ',instagram_content_publish' : ''}${inbox ? ',pages_manage_metadata,instagram_manage_comments,instagram_manage_messages' : ''}` : `pages_show_list,pages_read_engagement${publishing ? ',pages_manage_posts' : ''}${inbox ? ',pages_read_user_content,pages_messaging,pages_manage_metadata' : ''}`, state }),
    exchange: async (code: string) => {
      const short = await client.getToken({ code, redirect_uri: configuration.redirectUri });
      if (typeof short.token.access_token !== 'string' || !short.token.access_token) throw new Error('Invalid Meta token.');
      const long = await readSocialJson(`https://graph.facebook.com/${configuration.graphVersion}/oauth/access_token`, '', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: configuration.clientId, client_secret: configuration.clientSecret, fb_exchange_token: short.token.access_token }) });
      if (typeof long.access_token !== 'string' || !long.access_token || long.access_token.length > 16384 || /[\r\n\x00]/.test(long.access_token) || typeof long.expires_in !== 'number' || !Number.isSafeInteger(long.expires_in) || long.expires_in <= 0 || long.expires_in > 31536000) throw new Error('Invalid Meta token exchange.');
      return { accessToken: long.access_token, expiresAt: Date.now() + long.expires_in * 1000 };
    },
  };
}
