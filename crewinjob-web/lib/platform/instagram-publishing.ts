import 'server-only';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { facebookPublishingConfiguration, checkMetaPublishing } from './facebook-publishing';
import { readSocialJson } from './social-connection';
import type { PublishCheck, PublishResult } from './linkedin-publishing';

export const instagramId = (id: unknown): id is string => typeof id === 'string' && /^\d{1,30}$/.test(id);
export function instagramPublishingConfiguration() {
  const config = facebookPublishingConfiguration(), url = new URL(process.env.PLATFORM_PUBLIC_ORIGIN || '');
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || isIP(url.hostname) || !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(url.hostname) || url.origin !== new URL(config.redirectUri).origin) throw new Error('Configure the same public HTTPS origin and Meta callback.');
  return { ...config, origin:url.origin, revision:createHash('sha256').update(JSON.stringify([config.revision,url.origin,'instagram-image-v1'])).digest('hex') };
}
export const checkInstagramPublishing: PublishCheck = (token, id, credentials) => {
  if (credentials?.social?.platform !== 'instagram') return Promise.reject(new Error('Instagram account required.'));
  return checkMetaPublishing(token,id,credentials);
};
export function instagramPermalink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'www.instagram.com' && !u.username && !u.password && !u.port && !u.search && !u.hash && /^\/p\/[A-Za-z0-9_-]{1,100}\/$/.test(u.pathname) ? u.href : null; } catch { return null; }
}
export type InstagramPublisher = {
  create: (token:string,id:string,text:string,url:string) => Promise<string>;
  createCarousel?: (token:string,id:string,text:string,urls:string[],stillValid:()=>boolean) => Promise<string>;
  status: (token:string,id:string) => Promise<string>;
  publish: (token:string,id:string,container:string,reserve:()=>boolean) => Promise<PublishResult>;
};
async function post(token:string,id:string,edge:'media'|'media_publish',body:URLSearchParams,signal?:AbortSignal) {
  const {graphVersion}=instagramPublishingConfiguration();
  if(!instagramId(id)||!token||/[\r\n\x00]/.test(token))throw new Error('Invalid Instagram request.');
  const response=await fetch(`https://graph.facebook.com/${graphVersion}/${id}/${edge}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:body.toString(),redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
  if(!response.ok){try{await response.body?.cancel();}catch{}return {status:response.status,id:null};}
  const reader=response.body?.getReader();if(!reader)throw new Error();const parts:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)throw new Error();parts.push(part.value);}}
  finally{try{await reader.cancel();}catch{}}
  const payload=JSON.parse(Buffer.concat(parts).toString('utf8'));
  return {status:response.status,id:payload&&!payload.error&&instagramId(payload.id)?payload.id:null};
}
export const instagramPublisher: InstagramPublisher = {
  async createCarousel(token,id,text,urls,stillValid){
    const config=instagramPublishingConfiguration(),signal=AbortSignal.timeout(20000);
    if(text.length>2200||urls.length<2||urls.length>5)throw new Error('Invalid carousel.');
    const parsed=urls.map(value=>new URL(value));
    if(parsed.some((u,index)=>u.origin!==config.origin||!/^\/api\/platform\/publication-media\/[a-f0-9-]{36}$/.test(u.pathname)||!new RegExp(`^\\?signature=[a-f0-9]{64}&index=${index}$`).test(u.search)))throw new Error('Invalid carousel image.');
    const children:string[]=[];
    for(const url of parsed){
      if(!stillValid())throw new Error('Preparation cancelled.');
      const result=await post(token,id,'media',new URLSearchParams({image_url:url.href,is_carousel_item:'true'}),signal);
      if(!result.id)throw new Error('Child container outcome unavailable.');children.push(result.id);
    }
    if(!stillValid())throw new Error('Preparation cancelled.');
    const result=await post(token,id,'media',new URLSearchParams({media_type:'CAROUSEL',children:children.join(','),caption:text}),signal);
    if(!result.id)throw new Error('Carousel outcome unavailable.');return result.id;
  },
  async create(token,id,text,url){
    const config=instagramPublishingConfiguration(),image=new URL(url);
    if(text.length>2200||image.origin!==config.origin||!/^\/api\/platform\/publication-media\/[a-f0-9-]{36}$/.test(image.pathname)||!/^\?signature=[a-f0-9]{64}$/.test(image.search))throw new Error('Invalid Instagram image request.');
    const result=await post(token,id,'media',new URLSearchParams({image_url:image.href,caption:text}));
    if(!result.id)throw new Error('Container creation outcome unavailable.');return result.id;
  },
  async status(token,id){
    if(!instagramId(id))throw new Error();const {graphVersion}=instagramPublishingConfiguration();
    const value=await readSocialJson(`https://graph.facebook.com/${graphVersion}/${id}?fields=id,status_code`,token,{signal:AbortSignal.timeout(6000)});
    if(value.id!==id||!['FINISHED','IN_PROGRESS','ERROR','EXPIRED','PUBLISHED'].includes(String(value.status_code)))throw new Error('Invalid container status.');return String(value.status_code);
  },
  async publish(token,id,container,reserve){
    if(!instagramId(id)||!instagramId(container)||!reserve())return {state:'blocked',postId:null};
    try{
      const result=await post(token,id,'media_publish',new URLSearchParams({creation_id:container}));
      if(result.id){
        let postUrl:string|null=null;
        try{const {graphVersion}=instagramPublishingConfiguration(),receipt=await readSocialJson(`https://graph.facebook.com/${graphVersion}/${result.id}?fields=id,permalink`,token,{signal:AbortSignal.timeout(4000)});if(receipt.id===result.id)postUrl=instagramPermalink(receipt.permalink);}catch{}
        return {state:'accepted',postId:result.id,postUrl};
      }
      return {state:[400,401,403,404,405,409,422,429].includes(result.status)?'rejected':'uncertain',postId:null};
    }catch{return {state:'uncertain',postId:null};}
  },
};
