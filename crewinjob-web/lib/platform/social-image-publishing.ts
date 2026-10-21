import 'server-only';
import { linkedinPublishingConfiguration, escapeLinkedInText, type PublishResult } from './linkedin-publishing';
import { readSocialResponse } from './social-connection';
import { xPostId } from './x-publishing';
import { xText } from './x-text';
import type { PublicationImage } from './publication-image';

// Single-image posts for LinkedIn (member or company page) and X. The image is uploaded first (that creates no post);
// only after the publication is reserved is the post itself created, and a lost answer is never retried.
export type ImagePublisher=(token:string,accountId:string,text:string,image:PublicationImage,reserve:()=>boolean)=>Promise<PublishResult>;
const unsafeText=(text:string)=>/\{\{[\s\S]*?\}\}|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text);
const badToken=(token:string)=>!token||token.length>16384||/[\r\n\x00]/.test(token);

function linkedInImagePublisher(accountType:'person'|'organization'):ImagePublisher{return async(token,accountId,text,image,reserve)=>{
  const {version}=linkedinPublishingConfiguration();
  if(!(accountType==='organization'?/^[1-9]\d{0,29}$/:/^[A-Za-z0-9_-]{1,128}$/).test(accountId)||!text.trim()||text.length>3000||unsafeText(text)||badToken(token))return {state:'blocked',postId:null};
  const owner=`urn:li:${accountType}:${accountId}`,headers={Authorization:`Bearer ${token}`,'LinkedIn-Version':version,'X-Restli-Protocol-Version':'2.0.0'};
  let imageUrn:string;
  try{
    const init=await fetch('https://api.linkedin.com/rest/images?action=initializeUpload',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({initializeUploadRequest:{owner}}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    if(init.status!==200){await init.body?.cancel();return {state:'blocked',postId:null};}
    const value=(await readSocialResponse(init)).value as Record<string,unknown>|undefined,uploadUrl=typeof value?.uploadUrl==='string'?new URL(value.uploadUrl):null;
    if(!uploadUrl||uploadUrl.protocol!=='https:'||!/(^|\.)linkedin\.com$/.test(uploadUrl.hostname)||typeof value?.image!=='string'||!/^urn:li:image:[A-Za-z0-9_-]{1,100}$/.test(value.image))return {state:'blocked',postId:null};
    imageUrn=value.image;
    const upload=await fetch(uploadUrl,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'image/jpeg'},body:Buffer.from(image.data,'base64'),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
    await upload.body?.cancel();if(upload.status<200||upload.status>=300)return {state:'blocked',postId:null};
  }catch{return {state:'blocked',postId:null};}
  if(!reserve())return {state:'blocked',postId:null};
  try{
    const response=await fetch('https://api.linkedin.com/rest/posts',{method:'POST',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({author:owner,commentary:escapeLinkedInText(text),visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},content:{media:{id:imageUrn}},lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false}),
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    const postId=response.headers.get('x-restli-id');try{await response.body?.cancel();}catch{}
    if(response.status===201&&postId&&/^urn:li:(share|ugcPost):\d{1,30}$/.test(postId))return {state:'accepted',postId};
    if([400,401,403,404,405,409,422,426,429].includes(response.status))return {state:'rejected',postId:null};
    return {state:'uncertain',postId:null};
  }catch{return {state:'uncertain',postId:null};}
};}
export const publishLinkedInImage=linkedInImagePublisher('person');
export const publishLinkedInOrganizationImage=linkedInImagePublisher('organization');

// X: one-shot media upload (media.write), then the post with that media id.
export const publishXImage:ImagePublisher=async(token,accountId,text,image,reserve)=>{
  if(!xPostId(accountId)||!xText(text).valid||unsafeText(text)||badToken(token)||image.bytes>5*1024*1024)return {state:'blocked',postId:null};
  let mediaId:string;
  try{
    const upload=await fetch('https://api.x.com/2/media/upload',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({media:image.data,media_category:'tweet_image',media_type:'image/jpeg'}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
    if(upload.status!==200&&upload.status!==201){await upload.body?.cancel();return {state:'blocked',postId:null};}
    const id=((await readSocialResponse(upload)).data as Record<string,unknown>|undefined)?.id;if(typeof id!=='string'||!/^\d{1,25}$/.test(id))return {state:'blocked',postId:null};mediaId=id;
  }catch{return {state:'blocked',postId:null};}
  if(!reserve())return {state:'blocked',postId:null};
  try{
    const response=await fetch('https://api.x.com/2/tweets',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({text,media:{media_ids:[mediaId]}}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    if([400,401,402,403,404,405,409,422,429].includes(response.status)){await response.body?.cancel();return {state:'rejected',postId:null};}
    if(response.status!==201){await response.body?.cancel();return {state:'uncertain',postId:null};}
    const payload=await readSocialResponse(response),id=(payload.data as Record<string,unknown>|undefined)?.id;
    return !payload.errors&&!payload.error&&xPostId(id)?{state:'accepted',postId:id}:{state:'uncertain',postId:null};
  }catch{return {state:'uncertain',postId:null};}
};
