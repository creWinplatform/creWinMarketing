import { translateForDocument } from '../i18n/messages';
// A request that runs out of time says so in plain words, never the browser's raw "signal timed out".
export const REQUEST_TIMEOUT_MESSAGE='Sunucu zamanında yanıt vermedi. Biraz sonra yeniden deneyin.';
export const isTimeout=(error:unknown)=>error instanceof Error&&error.name==='TimeoutError';
export async function projectRequest<T>(url:string,init:RequestInit={}):Promise<T>{
  let response:Response;
  try{response=await fetch(url,{...init,cache:'no-store',signal:init.signal || AbortSignal.timeout(35000),headers:{'Content-Type':'application/json',...init.headers}});}
  catch(error){if(isTimeout(error))throw Object.assign(new Error(translateForDocument(REQUEST_TIMEOUT_MESSAGE)),{name:'TimeoutError'});throw error;}
  const data=await response.json();
  if(!response.ok)throw new Error(translateForDocument(data.error || 'İstek tamamlanamadı.'));
  return data as T;
}
export function searchText(value:string,locale:'tr'|'en'){
  return value.toLocaleLowerCase(locale).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
}
export function projectDateKey(date:Date,timeZone:string){
  const parts=new Intl.DateTimeFormat('en',{timeZone,calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const value=(type:string)=>parts.find(part=>part.type===type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
