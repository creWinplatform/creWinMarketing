import 'server-only';
import { createHash } from 'node:crypto';
import { metaConfiguration } from './meta-client';
import { readSocialJson, readSocialResponse } from './social-connection';
import type { PublishCheck, PublishTransport, PublishResult } from './linkedin-publishing';
import type { PublicationImage } from './publication-image';

export function facebookPublishingConfiguration() {
  const config = metaConfiguration();
  return { ...config, revision: createHash('sha256').update(JSON.stringify([config.clientId, config.clientSecret, config.graphVersion])).digest('hex') };
}
export const validFacebookPost = (id: unknown, accountId: string): id is string => typeof id === 'string' && /^\d{1,30}_\d{1,30}$/.test(id) && id.split('_')[0] === accountId;

export const checkMetaPublishing: PublishCheck = async (token, accountId, credentials) => {
  const config = facebookPublishingConfiguration(), grant = credentials?.metaPublishing;
  const instagram = credentials?.social?.platform === 'instagram', pageId = instagram ? credentials?.social?.pageId : accountId;
  if (!/^\d{1,30}$/.test(accountId) || !pageId || !/^\d{1,30}$/.test(pageId) || !token || /[\r\n\x00]/.test(token) || !grant || grant.appId !== config.clientId || !grant.userAccessToken || /[\r\n\x00]/.test(grant.userAccessToken) || !['facebook','instagram'].includes(credentials?.social?.platform || '') || credentials?.social?.accountId !== accountId || credentials.social.graphVersion !== config.graphVersion || !credentials.expiresAt || credentials.expiresAt <= Date.now() + 60000) throw new Error('Reconnect with Meta publishing authorization.');
  // A Page identity check alone is not proof of the user's current publishing task.
  const signal = AbortSignal.timeout(instagram ? 12000 : 20000), base = `https://graph.facebook.com/${config.graphVersion}`;
  const permissions = await readSocialJson(`${base}/me/permissions`, grant.userAccessToken, { signal });
  if (!Array.isArray(permissions.data) || permissions.data.length > 200) throw new Error('Invalid permissions.');
  const granted = new Set(permissions.data.filter(item => item && typeof item === 'object' && item.status === 'granted').map(item => item.permission));
  if (!(instagram ? ['pages_show_list','pages_read_engagement','instagram_basic','instagram_content_publish'] : ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts']).every(permission => granted.has(permission))) throw new Error('Publishing permission missing.');
  const seen = new Set<string>(); let cursor: string | undefined;
  for (let page = 0; page < 4; page++) {
    const url = new URL(`${base}/me/accounts`);
    url.searchParams.set('fields', `id,access_token,tasks${instagram ? ',instagram_business_account{id}' : ''}`); url.searchParams.set('limit', '50');
    if (cursor) url.searchParams.set('after', cursor);
    const response = await readSocialJson(url.href, grant.userAccessToken, { signal });
    if (!Array.isArray(response.data) || response.data.length > 50) throw new Error('Invalid Page list.');
    const selected = response.data.find(item => item && typeof item === 'object' && item.id === pageId);
    if (selected) {
      if (selected.access_token !== token || !Array.isArray(selected.tasks) || !selected.tasks.some((task: unknown) => task === 'CREATE_CONTENT' || task === 'PROFILE_PLUS_CREATE_CONTENT')) throw new Error('Page publishing task changed.');
      if (instagram && selected.instagram_business_account?.id !== accountId) throw new Error('Instagram association changed.');
      const identity = await readSocialJson(`${base}/me?fields=${instagram ? 'id,instagram_business_account{id}' : 'id'}`, token, { signal });
      if (identity.id !== pageId || instagram && (identity.instagram_business_account as {id?:string}|undefined)?.id !== accountId) throw new Error('Page identity changed.');
      return { expiresAt: credentials.expiresAt };
    }
    const paging = response.paging as { next?: string; cursors?: { after?: string } } | undefined;
    if (!paging?.next) break;
    cursor = paging.cursors?.after;
    if (typeof cursor !== 'string' || !cursor || cursor.length > 2048 || /[\r\n\x00]/.test(cursor) || seen.has(cursor)) throw new Error('Invalid cursor.');
    seen.add(cursor);
  }
  throw new Error('Selected Page is no longer accessible.');
};
export const checkFacebookPublishing: PublishCheck = (token, accountId, credentials) => {
  if (credentials?.social?.platform !== 'facebook') return Promise.reject(new Error('Facebook account required.'));
  return checkMetaPublishing(token,accountId,credentials);
};

// Persist the attempt before the mutating request; ambiguous outcomes are never retried.
export const publishFacebookText: PublishTransport = async (token, accountId, text, reserve) => {
  const { graphVersion } = facebookPublishingConfiguration();
  if (!/^\d{1,30}$/.test(accountId) || !text.trim() || text.length > 3000 || !token || /[\r\n\x00]/.test(token) || /\{\{[\s\S]*?\}\}|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return { state: 'blocked', postId: null };
  if (!reserve()) return { state: 'blocked', postId: null };
  try {
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${accountId}/feed`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ message: text }).toString(), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      try { await response.body?.cancel(); } catch {}
      return { state: [400,401,403,404,405,409,422,429].includes(response.status) ? 'rejected' : 'uncertain', postId: null };
    }
    const reader = response.body?.getReader(); if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 65536) throw new Error(); chunks.push(part.value); } }
    finally { try { await reader.cancel(); } catch {} }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return data && !data.error && validFacebookPost(data.id, accountId) ? { state: 'accepted', postId: data.id } : { state: 'uncertain', postId: null };
  } catch { return { state: 'uncertain', postId: null }; }
};

export async function publishFacebookImage(token:string,accountId:string,text:string,image:PublicationImage,reserve:()=>boolean):Promise<PublishResult> {
  const {graphVersion}=facebookPublishingConfiguration();
  if(!/^\d{1,30}$/.test(accountId)||!text.trim()||text.length>3000||!token||/[\r\n\x00]/.test(token)||image.bytes>1024*1024||Buffer.from(image.data,'base64').length!==image.bytes) return {state:'blocked',postId:null};
  const body=new FormData();body.set('caption',text);body.set('published','true');body.set('source',new Blob([new Uint8Array(Buffer.from(image.data,'base64'))],{type:'image/jpeg'}),'publication.jpg');
  if(!reserve())return {state:'blocked',postId:null};
  try{
    const response=await fetch(`https://graph.facebook.com/${graphVersion}/${accountId}/photos`,{method:'POST',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},body,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok){await response.body?.cancel();return {state:[400,401,403,404,405,409,422,429].includes(response.status)?'rejected':'uncertain',postId:null};}
    const payload=await readSocialResponse(response);
    return !payload.error&&validFacebookPost(payload.post_id,accountId)?{state:'accepted',postId:payload.post_id}:{state:'uncertain',postId:null};
  }catch{return {state:'uncertain',postId:null};}
}
