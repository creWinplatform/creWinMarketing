import 'server-only';
import { fetchPublic } from '../site-audit';
import { MarketingStoreError } from './errors';

// Videos are hosted by the team (their own https address); Ryzevo stores only the address. Before a publication is
// queued the address is checked with the SSRF-safe fetcher (no redirects, a video type and a known size), and the same
// check runs again before publishing: if the file changed, nothing is posted.
export const VIDEO_FORMATS={instagram:['reel','story'],facebook:['feed']} as const;
export type VideoFormat='reel'|'story'|'feed';
export type ContentVideo={url:string;format:VideoFormat};
export type PublicationVideo=ContentVideo&{bytes:number;contentType:string;etag:string|null;lastModified:string|null;checkedAt:string};
export const VIDEO_MAX_BYTES=300*1024*1024;
export type VideoReader=(url:URL)=>Promise<{status:number;headers:Headers;finalUrl:URL;cancel:()=>Promise<void>}>;
export const readVideoHeaders:VideoReader=async url=>{const {response,finalUrl}=await fetchPublic(url,'video/mp4,video/quicktime');return {status:response.status,headers:response.headers,finalUrl,cancel:async()=>{await response.body?.cancel().catch(()=>undefined);}};};
export function normalizeContentVideo(raw:unknown,platform:string):ContentVideo{
  const value=raw&&typeof raw==='object'?raw as Record<string,unknown>:{},formats=(VIDEO_FORMATS as Record<string,readonly string[]>)[platform];
  if(!formats)throw new MarketingStoreError('Video yalnız Instagram (Reels, Story) ve Facebook sayfası için destekleniyor.');
  if(typeof value.format!=='string'||!formats.includes(value.format))throw new MarketingStoreError('Bu kanal için geçerli bir video biçimi seçin.');
  let url:URL;try{url=new URL(String(value.url));}catch{throw new MarketingStoreError('Videonun https adresini girin.');}
  if(url.protocol!=='https:'||url.username||url.password||url.href.length>1000||url.hash)throw new MarketingStoreError('Videonun https adresini girin.');
  return {url:url.href,format:value.format as VideoFormat};
}
export async function checkPublicationVideo(video:ContentVideo,reader:VideoReader=readVideoHeaders):Promise<PublicationVideo>{
  let result;try{result=await reader(new URL(video.url));}catch{throw new MarketingStoreError('Video adresine ulaşılamadı. Adresin herkese açık ve https olduğunu kontrol edin.',409);}
  try{
    const type=(result.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),bytes=Number(result.headers.get('content-length'));
    if(result.status!==200||result.finalUrl.href!==video.url)throw new MarketingStoreError('Video adresi yönlendirme yapmadan doğrudan dosyayı vermeli.',409);
    if(!['video/mp4','video/quicktime'].includes(type))throw new MarketingStoreError('Video MP4 veya MOV olmalı.',409);
    if(!Number.isSafeInteger(bytes)||bytes<1||bytes>VIDEO_MAX_BYTES)throw new MarketingStoreError('Video boyutu bilinmiyor veya 300 MB sınırını aşıyor.',409);
    return {...video,bytes,contentType:type,etag:result.headers.get('etag')?.slice(0,200)||null,lastModified:result.headers.get('last-modified')?.slice(0,100)||null,checkedAt:new Date().toISOString()};
  }finally{await result.cancel();}
}
export const sameVideo=(a:PublicationVideo,b:PublicationVideo)=>a.url===b.url&&a.format===b.format&&a.bytes===b.bytes&&a.contentType===b.contentType&&a.etag===b.etag&&a.lastModified===b.lastModified;
