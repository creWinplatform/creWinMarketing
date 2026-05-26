/**
 * OAuth 1.0a imza yardımcıları (Twitter v1.1 / v2 OAuth1 kimlik doğrulama)
 */
import crypto from 'crypto';

export function oauthSign(
  method:        string,
  url:           string,
  params:        Record<string, string>,
  consumerSecret: string,
  tokenSecret:   string,
): string {
  const sorted = Object.keys(params).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  const base = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sorted)}`;
  const key  = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return crypto.createHmac('sha1', key).update(base).digest('base64');
}

export function buildOAuthHeader(
  method:        string,
  url:           string,
  consumerKey:   string,
  consumerSecret: string,
  accessToken:   string,
  tokenSecret:   string,
): string {
  const nonce     = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key:     consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        timestamp,
    oauth_token:            accessToken,
    oauth_version:          '1.0',
  };

  const signature = oauthSign(method, url, oauthParams, consumerSecret, tokenSecret);
  oauthParams.oauth_signature = signature;

  return 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');
}
