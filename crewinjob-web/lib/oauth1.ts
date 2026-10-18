/**
 * OAuth 1.0a imza yardımcıları (Twitter v1.1 / v2 OAuth1 kimlik doğrulama)
 */
import crypto from 'crypto';

/** RFC 3986 percent-encoding (encodeURIComponent ! ' ( ) * karakterlerini kodlamaz) */
function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function oauthSign(
  method:        string,
  url:           string,
  params:        Record<string, string>,
  consumerSecret: string,
  tokenSecret:   string,
): string {
  const sorted = Object.keys(params).sort()
    .map(k => `${pct(k)}=${pct(params[k])}`)
    .join('&');
  const base = `${method}&${pct(url)}&${pct(sorted)}`;
  const key  = `${pct(consumerSecret)}&${pct(tokenSecret)}`;
  return crypto.createHmac('sha1', key).update(base).digest('base64');
}

/**
 * `url` sorgu dizesi İÇERMEMELİ; GET sorgu parametreleri `queryParams` ile verilir
 * (imzaya dahil edilmeleri zorunlu — aksi halde 401).
 */
export function buildOAuthHeader(
  method:        string,
  url:           string,
  consumerKey:   string,
  consumerSecret: string,
  accessToken:   string,
  tokenSecret:   string,
  queryParams:   Record<string, string> = {},
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

  const signature = oauthSign(method, url, { ...queryParams, ...oauthParams }, consumerSecret, tokenSecret);
  oauthParams.oauth_signature = signature;

  return 'OAuth ' + Object.keys(oauthParams).sort()
    .map(k => `${pct(k)}="${pct(oauthParams[k])}"`)
    .join(', ');
}
