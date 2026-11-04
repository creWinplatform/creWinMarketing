import 'server-only';
import type { MobileTransport } from './mobile-providers';

// Bounded JSON reads and requests without redirects, shared by the mobile provider clients.
export async function json(response:Response){
  if(!response.ok){await response.body?.cancel();throw new Error('Provider unavailable.');}
  const reader=response.body?.getReader();if(!reader)throw new Error();let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>512*1024)throw new Error();chunks.push(part.value);}}finally{await reader.cancel();}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid response.');return value as Record<string,unknown>;
}
export const request=(read:MobileTransport,url:string,init:RequestInit={})=>read(url,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)});
