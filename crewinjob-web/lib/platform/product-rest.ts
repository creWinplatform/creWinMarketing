import 'server-only';
import { resolvePublicAddress, requestPinned, readLimited } from '../site-audit';
import { normalizeProductSource, PRODUCT_SOURCE_LIMITS, productValue, type ProductSourceConfig } from './product-data-types';

export type ProductPage = { items:unknown[]; nextCursor:string|null };
export type ProductPageLoader = (config:ProductSourceConfig,token:string,cursor:string|null)=>Promise<ProductPage>;
export async function readProductPage(config:ProductSourceConfig,token:string,cursor:string|null,transport={resolve:resolvePublicAddress,request:requestPinned}):Promise<ProductPage> {
  config=normalizeProductSource(config);
  if (config.auth==='bearer' && (!token || token.length>16384 || /[\r\n\x00]/.test(token))) throw new Error('Kaynak erişim anahtarı gerekli.');
  const url=new URL(config.url);
  if (cursor) {
    if (!config.cursorParam || cursor.length>512) throw new Error('Kaynak cursor değeri geçersiz.');
    url.searchParams.set(config.cursorParam,cursor);
  }
  let timer:ReturnType<typeof setTimeout>|undefined;
  const pinned=await Promise.race([transport.resolve(url),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Kaynak DNS zaman aşımı.')),4000);})]).finally(()=>clearTimeout(timer));
  const response=await transport.request(url,pinned,'application/json',{'User-Agent':'RyzevoProductConnector/1.0','Accept-Encoding':'identity',...(config.auth==='bearer'?{Authorization:`Bearer ${token}`}:{})});
  if (!response.ok || !/^application\/(?:[a-z0-9.-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel().catch(()=>{});
    throw new Error('Kaynak başarılı JSON yanıtı vermedi.');
  }
  const payload=JSON.parse(await readLimited(response,PRODUCT_SOURCE_LIMITS.responseBytes));
  const items=productValue(payload,config.itemsPath);
  if (!Array.isArray(items) || items.length>PRODUCT_SOURCE_LIMITS.pageRecords) throw new Error('Kayıt dizisi bulunamadı veya sayfa 200 kayıt sınırını aşıyor.');
  const next=config.nextCursorPath?productValue(payload,config.nextCursorPath):null;
  if (next!==undefined && next!==null && next!=='' && (typeof next!=='string'||next.length>512)) throw new Error('Kaynak cursor yanıtı geçersiz.');
  return {items,nextCursor:typeof next==='string'&&next?next:null};
}
