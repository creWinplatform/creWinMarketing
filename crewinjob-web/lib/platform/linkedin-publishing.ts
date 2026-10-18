import 'server-only';
import { createHash } from 'node:crypto';
import { linkedinConfiguration } from './linkedin-client';
import { readSocialJson } from './social-connection';
import type { StoredCredentials } from './credential-envelope';

export function linkedinPublishingConfiguration() {
  const config = linkedinConfiguration(), version = process.env.PLATFORM_LINKEDIN_API_VERSION || '';
  if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(version)) throw new Error('Configure an enabled LinkedIn API version.');
  return { ...config, version, revision: createHash('sha256').update(JSON.stringify([config.clientId, config.clientSecret, version])).digest('hex') };
}
export const socialPublishingEnabled = () => process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED === '1';
export type PublishAccess = { expiresAt: number };
export type PublishCheck = (token: string, accountId: string, credentials?: StoredCredentials) => Promise<PublishAccess>;
export type PublishResult = { state: 'accepted' | 'rejected' | 'uncertain' | 'blocked'; postId: string | null; postUrl?: string | null };
export type PublishTransport = (token: string, accountId: string, text: string, reserve: () => boolean) => Promise<PublishResult>;

async function boundedJson(response: Response) {
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty provider response.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 65536) throw new Error('Provider response too large.'); chunks.push(part.value); }
  } finally { await reader.cancel(); }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid provider response.'); return value;
}
export async function introspectLinkedInToken(token:string,requiredScopes:string[],signal?:AbortSignal){
  const config = linkedinPublishingConfiguration();
  if (!token || token.length>16384 || /[\r\n\x00]/.test(token)) throw new Error('Invalid token.');
  const response = await fetch('https://www.linkedin.com/oauth/v2/introspectToken', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, token }).toString(),
    cache: 'no-store', redirect: 'error', signal: signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Provider access unavailable.'); }
  const info = await boundedJson(response);
  if (info.active !== true || info.status !== 'active' || info.auth_type !== '3L' || info.client_id !== config.clientId || typeof info.scope !== 'string' || !requiredScopes.every(scope=>info.scope.split(/[,\s]+/).includes(scope)) || !Number.isSafeInteger(info.expires_at) || info.expires_at * 1000 <= Date.now() + 60000) throw new Error('Publishing grant unavailable.');
  return {expiresAt:info.expires_at*1000};
}
export const checkLinkedInPublishing: PublishCheck = async (token, accountId) => {
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(accountId))throw new Error('Invalid account.');
  const access=await introspectLinkedInToken(token,['w_member_social']);
  const profile = await readSocialJson('https://api.linkedin.com/v2/userinfo', token);
  if (profile.sub !== accountId) throw new Error('Account changed.');
  return access;
};
export const escapeLinkedInText = (text: string) => text.replace(/[\\|{}@\[\]()<>#*_~]/g, '\\$&');

// A request may have reached the provider even if its response is lost. Never retry it here.
function linkedInTextPublisher(accountType:'person'|'organization'):PublishTransport { return async (token, accountId, text, reserve) => {
  const { version } = linkedinPublishingConfiguration();
  if (!(accountType==='organization'?/^[1-9]\d{0,29}$/:/^[A-Za-z0-9_-]{1,128}$/).test(accountId) || !text.trim() || text.length > 3000 || !token || /[\r\n\x00]/.test(token)) return { state: 'blocked', postId: null };
  if (!reserve()) return { state: 'blocked', postId: null };
  try {
    const response = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'LinkedIn-Version': version, 'X-Restli-Protocol-Version': '2.0.0' },
      body: JSON.stringify({ author: `urn:li:${accountType}:${accountId}`, commentary: escapeLinkedInText(text), visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false }),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    const postId = response.headers.get('x-restli-id'); try { await response.body?.cancel(); } catch {}
    if (response.status === 201 && postId && /^urn:li:(share|ugcPost):\d{1,30}$/.test(postId)) return { state: 'accepted', postId };
    if ([400,401,403,404,405,409,422,426,429].includes(response.status)) return { state: 'rejected', postId: null };
    return { state: 'uncertain', postId: null };
  } catch { return { state: 'uncertain', postId: null }; }
}; }
export const publishLinkedInText=linkedInTextPublisher('person');
export const publishLinkedInOrganizationText=linkedInTextPublisher('organization');
