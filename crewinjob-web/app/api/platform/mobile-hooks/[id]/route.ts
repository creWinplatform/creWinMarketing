import { NextRequest,NextResponse } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { readBoundedJsonBytes } from '@/lib/platform/request-json';
import { MarketingStoreError } from '@/lib/platform/errors';
import { authenticateMobileHook } from '@/lib/platform/mobile-ingestion';
import { MobileDelivery } from '@/lib/platform/mobile-delivery';
import { mobileRecord,mobileText } from '@/lib/platform/mobile-validation';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const headers={'Cache-Control':'no-store'};
  try{
    const {id}=await params;if(!/^[a-f0-9]{32}$/.test(id))throw new MarketingStoreError('Mobil webhook doğrulanamadı.',401);
    const hook=authenticateMobileHook(platformDatabase(),id,request.headers,credentialEncryptionKey()),raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedJsonBytes(request,65536)));
    hook.assertCurrent();const input=mobileRecord(raw);let result:unknown;
    if(hook.row.kind==='bridge'&&['feed','feedback'].includes(String(input.action))){
      if(input.appId!==hook.app.id)throw new MarketingStoreError('Uygulama eşleşmedi.');
      const delivery=new MobileDelivery(hook.service),entityId=mobileText(input.entityId,160);
      result=input.action==='feed'?delivery.feed(hook.app.id,entityId):delivery.feedback(hook.app.id,entityId,mobileText(input.messageId,80),mobileText(input.event,20));
    }else result=hook.commit(raw);
    return NextResponse.json(result,{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Mobil webhook isteği kabul edilmedi.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
