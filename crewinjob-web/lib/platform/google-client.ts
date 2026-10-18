import 'server-only';
import { OAuth2Client } from 'google-auth-library';
import type { StoredCredentials } from './credential-envelope';

export const GOOGLE_SCOPES: Record<string, string> = {
  ga4: 'https://www.googleapis.com/auth/analytics.readonly',
  search_console: 'https://www.googleapis.com/auth/webmasters.readonly',
};
export function googleConfiguration() {
  const clientId = process.env.PLATFORM_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.PLATFORM_GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.PLATFORM_GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new Error('Google OAuth is not configured.');
  const url = new URL(redirectUri);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/api/platform/google/callback') throw new Error('Invalid Google callback configuration.');
  return { clientId, clientSecret, redirectUri };
}
export function googleClient() {
  return new OAuth2Client({ ...googleConfiguration(), transporterOptions: { timeout: 12000, retry: false, maxRedirects: 0 } });
}
export async function refreshGoogleCredentials(credentials: StoredCredentials, clientFactory = googleClient): Promise<StoredCredentials> {
  if (!credentials.googleOAuth || (credentials.expiresAt && credentials.expiresAt > Date.now() + 60000)) return credentials;
  if (!credentials.refreshToken) throw new Error('Google reconnect required.');
  const client = clientFactory();
  client.setCredentials({ refresh_token: credentials.refreshToken });
  const { credentials: refreshed } = await client.refreshAccessToken();
  if (!refreshed.access_token || !refreshed.expiry_date) throw new Error('Invalid Google token response.');
  return { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token || credentials.refreshToken, googleOAuth: true, expiresAt: refreshed.expiry_date };
}
