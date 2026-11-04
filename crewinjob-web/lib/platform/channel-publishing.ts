import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { decryptCredentials, encryptCredentials, type StoredCredentials } from './credential-envelope';
import { readSocialResponse } from './social-connection';
import { fetchPublic } from '../site-audit';
import type { PublishResult } from './linkedin-publishing';
import type { PublicationImage } from './publication-image';
import type { PublicationVideo } from './social-video';

// TikTok (Content Posting API), Pinterest (API v5 pins) and YouTube (Data API, Shorts) for standard projects' approved
// publications. Each project connects its own account with OAuth; the app credentials come from the server. Access
// tokens are short-lived: a fresh one is taken from the stored refresh token when needed and kept only in memory, so the
// connection's encrypted envelope (and the approval tied to it) does not change. A provider that rotates the refresh
// token gets the new one in platform_channel_tokens.
export const CHANNEL_PLATFORMS = ['tiktok', 'pinterest', 'youtube'] as const;
export type ChannelPlatform = typeof CHANNEL_PLATFORMS[number];
export const isChannelPlatform = (platform: string): platform is ChannelPlatform => (CHANNEL_PLATFORMS as readonly string[]).includes(platform);
export const CHANNEL_NAMES: Record<ChannelPlatform, string> = { tiktok: 'TikTok', pinterest: 'Pinterest', youtube: 'YouTube' };
export const CHANNEL_CALLBACK = '/api/platform/channels/callback';
export const CHANNEL_TEXT_LIMITS: Record<ChannelPlatform, number> = { tiktok: 2200, pinterest: 500, youtube: 5000 };
export type ChannelGrant = { configurationRevision: string; scopes: string[]; accessExpiresAt: number };

const ENV: Record<ChannelPlatform, [string, string, string]> = {
  tiktok: ['PLATFORM_TIKTOK_CLIENT_KEY', 'PLATFORM_TIKTOK_CLIENT_SECRET', 'PLATFORM_TIKTOK_REDIRECT_URI'],
  pinterest: ['PLATFORM_PINTEREST_CLIENT_ID', 'PLATFORM_PINTEREST_CLIENT_SECRET', 'PLATFORM_PINTEREST_REDIRECT_URI'],
  youtube: ['PLATFORM_YOUTUBE_CLIENT_ID', 'PLATFORM_YOUTUBE_CLIENT_SECRET', 'PLATFORM_YOUTUBE_REDIRECT_URI'],
};
const SCOPES: Record<ChannelPlatform, string[]> = {
  tiktok: ['user.info.basic', 'video.publish'],
  pinterest: ['boards:read', 'pins:read', 'pins:write', 'user_accounts:read'],
  youtube: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
};
const TOKEN_URL: Record<ChannelPlatform, string> = { tiktok: 'https://open.tiktokapis.com/v2/oauth/token/', pinterest: 'https://api.pinterest.com/v5/oauth/token', youtube: 'https://oauth2.googleapis.com/token' };
const HOSTS = ['open.tiktokapis.com', 'api.pinterest.com', 'oauth2.googleapis.com', 'www.googleapis.com'];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const DAY = 86400000;

export function channelConfiguration(platform: ChannelPlatform) {
  const [idKey, secretKey, redirectKey] = ENV[platform], clientId = process.env[idKey] || '', clientSecret = process.env[secretKey] || '', redirectUri = process.env[redirectKey] || '';
  if (!clientId || !clientSecret || clientId.length > 512 || clientSecret.length > 2048 || /[\r\n\x00]/.test(clientId + clientSecret)) throw new Error(`${platform} OAuth not configured.`);
  const url = new URL(redirectUri);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== CHANNEL_CALLBACK) throw new Error(`Invalid ${platform} callback.`);
  return { clientId, clientSecret, redirectUri, revision: hash(JSON.stringify([platform, clientId, clientSecret, redirectUri])) };
}
export const channelConfigured = (platform: ChannelPlatform) => { try { return Boolean(channelConfiguration(platform)); } catch { return false; } };
// TikTok's default: only the creator sees the post until the app passes TikTok's audit. Override per server.
const tiktokPrivacy = () => ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'].includes(process.env.PLATFORM_TIKTOK_PRIVACY || '') ? process.env.PLATFORM_TIKTOK_PRIVACY! : 'SELF_ONLY';
// Unverified Google projects can only upload private videos; a verified project may set public or unlisted.
const youtubePrivacy = () => ['public', 'unlisted', 'private'].includes(process.env.PLATFORM_YOUTUBE_PRIVACY || '') ? process.env.PLATFORM_YOUTUBE_PRIVACY! : 'private';

export function channelAuthorizationUrl(platform: ChannelPlatform, state: string, verifier: string) {
  const config = channelConfiguration(platform);
  if (platform === 'tiktok') {
    const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
    url.search = new URLSearchParams({ client_key: config.clientId, scope: SCOPES.tiktok.join(','), response_type: 'code', redirect_uri: config.redirectUri, state }).toString();
    return url.href;
  }
  if (platform === 'pinterest') {
    const url = new URL('https://www.pinterest.com/oauth/');
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: SCOPES.pinterest.join(','), state }).toString();
    return url.href;
  }
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: SCOPES.youtube.join(' '), state, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return url.href;
}
export const newChannelVerifier = () => randomBytes(32).toString('base64url');

export type ChannelHttp = (url: string, init: RequestInit) => Promise<Response>;
export const channelHttp: ChannelHttp = (url, init) => fetch(url, init);
// One JSON call to a channel provider: fixed hosts, no redirects, a bounded response. TikTok answers every call with an
// "error" object whose code is "ok" on success.
export async function channelJson(url: string, token: string, init: RequestInit = {}, http: ChannelHttp = channelHttp) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !HOSTS.includes(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw new Error('Invalid channel URL.');
  const headers = new Headers(init.headers); headers.set('Accept', 'application/json'); if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await http(url, { ...init, headers, cache: 'no-store', redirect: 'error', signal: init.signal || AbortSignal.timeout(12000) });
  const payload = response.body ? await readSocialResponse(response).catch(() => ({} as Record<string, unknown>)) : {};
  const error = payload.error as { code?: unknown } | string | undefined;
  if (!response.ok || error && !(typeof error === 'object' && error.code === 'ok')) { const failure = new Error('Channel request failed.') as Error & { status?: number }; failure.status = response.status; throw failure; }
  return payload;
}
type Token = { accessToken: string; expiresAt: number; refreshToken: string; refreshExpiresAt: number; scopes: string[]; openId?: string };
function token(platform: ChannelPlatform, payload: Record<string, unknown>, previousRefresh = ''): Token {
  const access = payload.access_token, expires = payload.expires_in, refresh = typeof payload.refresh_token === 'string' && payload.refresh_token ? payload.refresh_token : previousRefresh;
  if (typeof access !== 'string' || !access || access.length > 16384 || /[\r\n\x00]/.test(access) || typeof expires !== 'number' || !Number.isSafeInteger(expires) || expires < 60 || !refresh || refresh.length > 16384 || /[\r\n\x00]/.test(refresh)) throw new Error('Invalid channel token.');
  const refreshIn = typeof payload.refresh_expires_in === 'number' ? payload.refresh_expires_in : typeof payload.refresh_token_expires_in === 'number' ? payload.refresh_token_expires_in : null;
  // Google does not state a refresh lifetime; the connection is re-checked before every send anyway.
  const refreshExpiresAt = Date.now() + (refreshIn && Number.isSafeInteger(refreshIn) && refreshIn > 0 ? refreshIn * 1000 : 180 * DAY);
  const scopes = String(payload.scope || '').split(/[\s,]+/).filter(Boolean).slice(0, 30);
  return { accessToken: access, expiresAt: Date.now() + expires * 1000, refreshToken: refresh, refreshExpiresAt, scopes, ...(typeof payload.open_id === 'string' ? { openId: payload.open_id } : {}) };
}
async function tokenRequest(platform: ChannelPlatform, fields: Record<string, string>, http: ChannelHttp) {
  const config = channelConfiguration(platform), body = new URLSearchParams(fields), headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (platform === 'pinterest') headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`;
  else if (platform === 'tiktok') { body.set('client_key', config.clientId); body.set('client_secret', config.clientSecret); }
  else { body.set('client_id', config.clientId); body.set('client_secret', config.clientSecret); }
  return channelJson(TOKEN_URL[platform], '', { method: 'POST', headers, body: body.toString(), signal: AbortSignal.timeout(8000) }, http);
}
export async function exchangeChannelCode(platform: ChannelPlatform, code: string, verifier: string, http: ChannelHttp = channelHttp) {
  const config = channelConfiguration(platform);
  const result = token(platform, await tokenRequest(platform, { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, ...(platform === 'youtube' ? { code_verifier: verifier } : {}) }, http));
  // Pinterest and TikTok list the granted scopes; Google lists them too. Every scope publishing needs must be there.
  if (!SCOPES[platform].filter(scope => platform !== 'pinterest' || scope !== 'pins:read').every(scope => result.scopes.includes(scope))) throw new Error('Missing channel scopes.');
  return { ...result, revision: config.revision };
}
// The account the token belongs to: TikTok's open_id, the Pinterest board the team chose (it must be theirs), the
// YouTube channel.
export async function readChannelAccount(platform: ChannelPlatform, accessToken: string, input: { boardId?: string; openId?: string }, http: ChannelHttp = channelHttp) {
  if (platform === 'tiktok') {
    const payload = await channelJson('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', accessToken, {}, http), user = ((payload.data as Record<string, unknown> | undefined)?.user || {}) as Record<string, unknown>;
    const id = typeof user.open_id === 'string' ? user.open_id : input.openId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(id)) throw new Error('Invalid TikTok account.');
    return { accountId: id };
  }
  if (platform === 'pinterest') {
    if (!input.boardId || !/^\d{1,30}$/.test(input.boardId)) throw new Error('Pinterest board required.');
    const board = await channelJson(`https://api.pinterest.com/v5/boards/${input.boardId}`, accessToken, {}, http);
    if (String(board.id) !== input.boardId) throw new Error('Invalid Pinterest board.');
    return { accountId: input.boardId };
  }
  const payload = await channelJson('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true', accessToken, {}, http), item = (Array.isArray(payload.items) ? payload.items[0] : undefined) as Record<string, unknown> | undefined;
  if (typeof item?.id !== 'string' || !/^UC[A-Za-z0-9_-]{22}$/.test(item.id)) throw new Error('Invalid YouTube channel.');
  return { accountId: item.id };
}

// A fresh access token for the connection: the stored one while it is valid, otherwise from the refresh token.
const cache = new Map<string, { token: string; expiresAt: number; revision: string }>();
export async function channelAccess(db: Database.Database, args: readonly [string, string], key: string, connection: { id: string; encrypted_credentials: string }, credentials: StoredCredentials, http: ChannelHttp = channelHttp) {
  const platform = credentials.social?.platform, revision = hash(connection.encrypted_credentials), grant = credentials.channelPublishing;
  if (!platform || !isChannelPlatform(platform) || !grant) throw new Error('Not a channel connection.');
  const hit = cache.get(connection.id);
  if (hit && hit.revision === revision && hit.expiresAt > Date.now() + 120000) return { token: hit.token, expiresAt: hit.expiresAt };
  if (!hit && grant.accessExpiresAt > Date.now() + 120000) return { token: credentials.accessToken, expiresAt: grant.accessExpiresAt };
  const stored = db.prepare('SELECT encrypted_refresh FROM platform_channel_tokens WHERE connection_id=? AND organization_id=? AND project_id=? AND revision=?').get(connection.id, ...args, revision) as { encrypted_refresh: string } | undefined;
  const refresh = stored ? decryptCredentials<{ refreshToken: string }>(stored.encrypted_refresh, key, ...args, `channel-refresh:${connection.id}`).refreshToken : credentials.refreshToken;
  const fresh = token(platform, await tokenRequest(platform, { grant_type: 'refresh_token', refresh_token: refresh }, http), refresh);
  if (fresh.refreshToken !== refresh) db.prepare('INSERT INTO platform_channel_tokens(connection_id,organization_id,project_id,revision,encrypted_refresh,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET revision=excluded.revision,encrypted_refresh=excluded.encrypted_refresh,updated_at=excluded.updated_at')
    .run(connection.id, ...args, revision, encryptCredentials({ refreshToken: fresh.refreshToken }, key, ...args, `channel-refresh:${connection.id}`), new Date().toISOString());
  cache.set(connection.id, { token: fresh.accessToken, expiresAt: fresh.expiresAt, revision });
  return { token: fresh.accessToken, expiresAt: fresh.expiresAt };
}

// The publishing right, checked right before approval and before each send: TikTok's creator info (and the privacy
// level this server uses), the Pinterest board, the YouTube channel.
export async function checkChannelPublishing(platform: ChannelPlatform, accessToken: string, accountId: string, http: ChannelHttp = channelHttp) {
  if (platform === 'tiktok') {
    const payload = await channelJson('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', accessToken, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: '{}' }, http);
    const options = (payload.data as { privacy_level_options?: unknown } | undefined)?.privacy_level_options;
    if (!Array.isArray(options) || !options.includes(tiktokPrivacy())) throw new Error('TikTok privacy level not allowed.');
  } else if (platform === 'pinterest') {
    const board = await channelJson(`https://api.pinterest.com/v5/boards/${accountId}`, accessToken, {}, http);
    if (String(board.id) !== accountId) throw new Error('Pinterest board changed.');
  } else if ((await readChannelAccount('youtube', accessToken, {}, http)).accountId !== accountId) throw new Error('YouTube channel changed.');
}

const outcome = (error: unknown): PublishResult => ({ state: typeof (error as { status?: number })?.status === 'number' && (error as { status: number }).status >= 400 && (error as { status: number }).status < 500 ? 'rejected' : 'uncertain', postId: null });
// TikTok pulls the approved file from the team's address (its domain must be verified in the TikTok app). The publish
// id is what TikTok returns; the post itself appears after TikTok processes it.
export async function publishTikTokVideo(accessToken: string, text: string, video: PublicationVideo, reserve: () => boolean, http: ChannelHttp = channelHttp): Promise<PublishResult> {
  if (!reserve()) return { state: 'blocked', postId: null };
  try {
    const payload = await channelJson('https://open.tiktokapis.com/v2/post/publish/video/init/', accessToken, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ post_info: { title: text.slice(0, 2200), privacy_level: tiktokPrivacy(), disable_comment: false, disable_duet: false, disable_stitch: false }, source_info: { source: 'PULL_FROM_URL', video_url: video.url } }), signal: AbortSignal.timeout(20000) }, http);
    const id = (payload.data as { publish_id?: unknown } | undefined)?.publish_id;
    return typeof id === 'string' && tiktokPublishId(id) ? { state: 'accepted', postId: id } : { state: 'uncertain', postId: null };
  } catch (error) { return outcome(error); }
}
export const tiktokPublishId = (value: string) => /^[A-Za-z0-9_.~:-]{1,200}$/.test(value);
// One pin on the connected board: the approved image, the first line as title, the text as description and the first
// link to the team's site (already tagged) as the pin's link.
export async function publishPinterestPin(accessToken: string, boardId: string, title: string, text: string, image: PublicationImage, reserve: () => boolean, http: ChannelHttp = channelHttp): Promise<PublishResult> {
  const link = text.match(/https:\/\/[^\s<>"'`]+/)?.[0]?.replace(/[.,;:!?)\]}»”’]+$/, '');
  if (!reserve()) return { state: 'blocked', postId: null };
  try {
    const payload = await channelJson('https://api.pinterest.com/v5/pins', accessToken, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: boardId, title: title.slice(0, 100), description: text.slice(0, 500), ...(link ? { link } : {}), media_source: { source_type: 'image_base64', content_type: 'image/jpeg', data: image.data } }), signal: AbortSignal.timeout(20000) }, http);
    return typeof payload.id === 'string' && pinterestPinId(payload.id) ? { state: 'accepted', postId: payload.id } : { state: 'uncertain', postId: null };
  } catch (error) { return outcome(error); }
}
export const pinterestPinId = (value: string) => /^\d{1,30}$/.test(value);
// A Short: the approved file is streamed from the team's address (SSRF-safe fetcher) into YouTube's resumable upload.
// The title is the first line (with #Shorts when it fits), the description the whole text.
export async function publishYouTubeShort(accessToken: string, text: string, video: PublicationVideo, reserve: () => boolean, http: ChannelHttp = channelHttp, source: typeof fetchPublic = fetchPublic): Promise<PublishResult> {
  const first = text.split('\n').find(line => line.trim())?.trim() || 'Short', title = (first.length <= 91 ? `${first} #Shorts` : first).slice(0, 100);
  let upload: string;
  try {
    const init = await http('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': video.contentType, 'X-Upload-Content-Length': String(video.bytes) },
      body: JSON.stringify({ snippet: { title, description: text.slice(0, 5000), categoryId: '22' }, status: { privacyStatus: youtubePrivacy(), selfDeclaredMadeForKids: false } }) });
    await init.body?.cancel().catch(() => undefined);
    const location = init.headers.get('location') || '';
    if (!init.ok || new URL(location).hostname !== 'www.googleapis.com') return { state: init.status >= 400 && init.status < 500 ? 'rejected' : 'uncertain', postId: null };
    upload = location;
  } catch { return { state: 'uncertain', postId: null }; }
  let file: Response;
  try { file = (await source(new URL(video.url), 'video/mp4,video/quicktime')).response; } catch { return { state: 'blocked', postId: null }; }
  if (file.status !== 200 || Number(file.headers.get('content-length')) !== video.bytes || !file.body) { await file.body?.cancel().catch(() => undefined); return { state: 'blocked', postId: null }; }
  if (!reserve()) { await file.body.cancel().catch(() => undefined); return { state: 'blocked', postId: null }; }
  try {
    const response = await http(upload, { method: 'PUT', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(14 * 60000), headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': video.contentType, 'Content-Length': String(video.bytes) }, body: file.body, duplex: 'half' } as RequestInit);
    const payload = response.body ? await readSocialResponse(response).catch(() => ({} as Record<string, unknown>)) : {};
    if (!response.ok) return { state: response.status >= 400 && response.status < 500 ? 'rejected' : 'uncertain', postId: null };
    return typeof payload.id === 'string' && youtubeVideoId(payload.id) ? { state: 'accepted', postId: payload.id } : { state: 'uncertain', postId: null };
  } catch { return { state: 'uncertain', postId: null }; }
}
export const youtubeVideoId = (value: string) => /^[A-Za-z0-9_-]{11}$/.test(value);
export const channelPostUrl = (platform: ChannelPlatform, postId: string) => platform === 'pinterest' ? `https://www.pinterest.com/pin/${postId}/` : platform === 'youtube' ? `https://www.youtube.com/shorts/${postId}` : null;
export const channelPostId = (platform: ChannelPlatform, postId: string) => platform === 'pinterest' ? pinterestPinId(postId) : platform === 'youtube' ? youtubeVideoId(postId) : tiktokPublishId(postId);
