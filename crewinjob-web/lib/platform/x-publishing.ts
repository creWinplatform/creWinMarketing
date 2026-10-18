import 'server-only';
import { xConfiguration } from './x-client';
import { readSocialJson, readSocialResponse } from './social-connection';
import { xText } from './x-text';
import type { PublishCheck, PublishTransport } from './linkedin-publishing';

export const xPostId = (value:unknown):value is string => typeof value==='string'&&/^[1-9]\d{0,18}$/.test(value);
export const checkXPublishing:PublishCheck = async(token,accountId,credentials) => {
  const config=xConfiguration(),grant=credentials?.xPublishing;
  // Only the server OAuth exchange can supply scope provenance. Identity lookup alone is not write proof.
  if(!grant||grant.configurationRevision!==config.revision||!['tweet.read','users.read','tweet.write'].every(scope=>grant.scopes.includes(scope))||credentials?.social?.platform!=='twitter'||credentials.social.accountId!==accountId||credentials.accessToken!==token||!xPostId(accountId)||!Number.isSafeInteger(credentials.expiresAt)||credentials.expiresAt!<=Date.now()+60000)throw new Error('X publishing grant unavailable.');
  const profile=await readSocialJson('https://api.x.com/2/users/me',token,{signal:AbortSignal.timeout(8000)});
  if((profile.data as Record<string,unknown>|undefined)?.id!==accountId)throw new Error('X account changed.');
  return {expiresAt:credentials.expiresAt!};
};
export const publishXText:PublishTransport = async(token,accountId,text,reserve) => {
  if(!xPostId(accountId)||!xText(text).valid||/\{\{[\s\S]*?\}\}|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)||!token||token.length>16384||/[\r\n\x00]/.test(token))return {state:'blocked',postId:null};
  xConfiguration();
  if(!reserve())return {state:'blocked',postId:null};
  try {
    const response=await fetch('https://api.x.com/2/tweets',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({text}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    if([400,401,402,403,404,405,409,422,429].includes(response.status)){await response.body?.cancel();return {state:'rejected',postId:null};}
    if(response.status!==201){await response.body?.cancel();return {state:'uncertain',postId:null};}
    const payload=await readSocialResponse(response),id=(payload.data as Record<string,unknown>|undefined)?.id;
    return !payload.errors&&!payload.error&&xPostId(id)?{state:'accepted',postId:id}:{state:'uncertain',postId:null};
  }catch{return {state:'uncertain',postId:null};}
};
