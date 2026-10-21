import 'server-only';
import { createHash } from 'node:crypto';
import { readSocialJson } from './social-connection';

export function xConfiguration() {
  const clientId = process.env.PLATFORM_X_CLIENT_ID || '', clientSecret = process.env.PLATFORM_X_CLIENT_SECRET || '', redirectUri = process.env.PLATFORM_X_REDIRECT_URI || '';
  if (!clientId || !clientSecret || clientId.length > 512 || clientSecret.length > 2048 || /[\r\n\x00]/.test(clientId + clientSecret)) throw new Error('X OAuth not configured.');
  const url = new URL(redirectUri);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/api/platform/x/callback') throw new Error('Invalid X callback.');
  return { clientId, clientSecret, redirectUri, revision: createHash('sha256').update(JSON.stringify([clientId,clientSecret,redirectUri])).digest('hex') };
}
export function xClient() {
  const config = xConfiguration();
  return {
    revision: config.revision,
    authorizationUrl(state: string, verifier: string, publishing: boolean) {
      const url = new URL('https://x.com/i/oauth2/authorize');
      url.search = new URLSearchParams({ response_type:'code', client_id:config.clientId, redirect_uri:config.redirectUri, state,
        scope:publishing ? 'tweet.read users.read tweet.write media.write' : 'tweet.read users.read',
        code_challenge:createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256' }).toString();
      return url.href;
    },
    async exchange(code: string, verifier: string) {
      const token = await readSocialJson('https://api.x.com/2/oauth2/token', '', { method:'POST',
        headers:{ Authorization:`Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString('base64')}`, 'Content-Type':'application/x-www-form-urlencoded' },
        body:new URLSearchParams({ grant_type:'authorization_code', code, redirect_uri:config.redirectUri, code_verifier:verifier }).toString(), signal:AbortSignal.timeout(8000) });
      if (typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 16384 || /[\r\n\x00]/.test(token.access_token) || token.token_type !== 'bearer' || typeof token.expires_in !== 'number' || !Number.isSafeInteger(token.expires_in) || token.expires_in < 120 || token.expires_in > 86400 || typeof token.scope !== 'string' || token.scope.length > 2000) throw new Error('Invalid X token.');
      const scopes = token.scope.split(/\s+/).filter(Boolean);
      if (!['tweet.read','users.read'].every(scope => scopes.includes(scope))) throw new Error('Missing X scopes.');
      return { accessToken:token.access_token, expiresAt:Date.now()+token.expires_in*1000, scopes };
    },
  };
}
