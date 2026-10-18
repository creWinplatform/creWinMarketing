import 'server-only';
import { readSocialJson } from './social-connection';
import { facebookPublishingConfiguration, validFacebookPost } from './facebook-publishing';
import { instagramId } from './instagram-publishing';
import { checkXPublishing, xPostId } from './x-publishing';
import { introspectLinkedInToken, linkedinPublishingConfiguration } from './linkedin-publishing';
import { checkLinkedInOrganizationReadAccess } from './linkedin-organization-publishing';
import { linkedinHeaders } from './linkedin-organizations';
import type { StoredCredentials } from './credential-envelope';
import type { EngagementCounts } from './social-publication-types';

export type EngagementRequest = { platform:string; accountId:string; accountType?:string; postId:string; credentials:StoredCredentials };
export type EngagementReader = (input:EngagementRequest) => Promise<EngagementCounts>;
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const count=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=1e12?Number(value):undefined;
export function cleanEngagementCounts(raw:unknown):EngagementCounts {
  const result:EngagementCounts={};
  for(const name of ['likes','comments','shares','impressions','clicks','reach','bookmarks','quotes'] as const){
    const value=count(record(raw)[name]);if(value!==undefined)result[name]=value;
  }
  if(!Object.keys(result).length)throw new Error('No measured counters.');return result;
}

// Only persisted provider receipts are accepted. No client-supplied URL or author lookup.
export const readPublicationEngagement:EngagementReader=async input=>{
  const {platform,accountId,postId,credentials}=input,token=credentials.accessToken,signal=AbortSignal.timeout(25000);
  if(!token||/[\r\n\x00]/.test(token)||credentials.social?.accountId!==accountId||credentials.social.platform!==platform||!credentials.expiresAt||credentials.expiresAt<=Date.now()+60000)throw new Error('Account access expired.');
  const read=(url:string,headers?:Record<string,string>)=>readSocialJson(url,token,{method:'GET',headers,signal});
  if(platform==='facebook'||platform==='instagram'){
    const {graphVersion}=facebookPublishingConfiguration();
    if(credentials.social.graphVersion!==graphVersion)throw new Error('Provider configuration changed.');
    if(platform==='facebook'){
      if(!validFacebookPost(postId,accountId))throw new Error('Invalid Page post.');
      const value=await read(`https://graph.facebook.com/${graphVersion}/${postId}?fields=id,from{id},reactions.limit(0).summary(true),comments.limit(0).summary(true),shares`);
      if(value.id!==postId||record(value.from).id!==accountId)throw new Error('Post owner changed.');
      return cleanEngagementCounts({likes:record(record(value.reactions).summary).total_count,comments:record(record(value.comments).summary).total_count,shares:record(value.shares).count});
    }
    if(!instagramId(postId))throw new Error('Invalid Instagram post.');
    const value=await read(`https://graph.facebook.com/${graphVersion}/${postId}?fields=id,owner{id},like_count,comments_count`);
    if(value.id!==postId||record(value.owner).id!==accountId)throw new Error('Media owner changed.');
    return cleanEngagementCounts({likes:value.like_count,comments:value.comments_count});
  }
  if(platform==='twitter'){
    if(!xPostId(postId))throw new Error('Invalid X post.');
    await checkXPublishing(token,accountId,credentials);
    const value=record((await read(`https://api.x.com/2/tweets/${postId}?tweet.fields=author_id,public_metrics`)).data),metrics=record(value.public_metrics);
    if(value.id!==postId||value.author_id!==accountId)throw new Error('Post owner changed.');
    return cleanEngagementCounts({likes:metrics.like_count,comments:metrics.reply_count,shares:metrics.retweet_count,quotes:metrics.quote_count,bookmarks:metrics.bookmark_count,impressions:metrics.impression_count});
  }
  if(platform==='linkedin'&&input.accountType==='organization'){
    if(process.env.PLATFORM_LINKEDIN_ANALYTICS_ENABLED!=='1'||!/^urn:li:(share|ugcPost):\d{1,30}$/.test(postId))throw new Error('LinkedIn analytics access unavailable.');
    const {version}=linkedinPublishingConfiguration(),headers=linkedinHeaders(version);
    await introspectLinkedInToken(token,['r_organization_social'],signal);
    await checkLinkedInOrganizationReadAccess(token,accountId);
    const owner=`urn:li:organization:${accountId}`,post=await read(`https://api.linkedin.com/rest/posts/${encodeURIComponent(postId)}`,headers);
    if(post.author!==owner)throw new Error('Post owner changed.');
    const url=new URL('https://api.linkedin.com/rest/organizationalEntityShareStatistics');
    url.searchParams.set('q','organizationalEntity');url.searchParams.set('organizationalEntity',owner);url.searchParams.set(postId.includes(':ugcPost:')?'ugcPosts[0]':'shares[0]',postId);
    const payload=await read(url.href,headers);
    if(!Array.isArray(payload.elements)||payload.elements.length!==1)throw new Error('No unique post statistics.');
    const entry=record(payload.elements[0]),metrics=record(entry.totalShareStatistics);
    if(entry.organizationalEntity!==owner||(entry.share??entry.ugcPost)!==postId)throw new Error('Statistics owner changed.');
    return cleanEngagementCounts({likes:metrics.likeCount,comments:metrics.commentCount,shares:metrics.shareCount,impressions:metrics.impressionCount,clicks:metrics.clickCount,reach:metrics.uniqueImpressionsCount});
  }
  throw new Error('Analytics not supported for this account.');
};
