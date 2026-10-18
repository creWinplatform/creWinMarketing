import { NextRequest, NextResponse } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { authenticateProductWebhook, ProductWebhookError } from '@/lib/platform/product-webhooks';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { readBoundedJsonBytes } from '@/lib/platform/request-json';
import { WEBHOOK_LIMITS } from '@/lib/platform/product-webhook-types';

export const dynamic='force-dynamic',maxDuration=15;
export async function POST(request:NextRequest,context:{params:Promise<{sourceId:string}>}){
  const headers={'Cache-Control':'no-store'};
  try{
    const {sourceId}=await context.params;
    if(request.headers.has('origin'))return NextResponse.json({error:'Yalnız sunucudan sunucuya imzalı istek kabul edilir.',code:'server_only'},{status:403,headers});
    if(!/^[a-f0-9]{32}$/.test(sourceId))throw new ProductWebhookError('signature','Webhook doğrulanamadı.',401);
    const receive=authenticateProductWebhook(platformDatabase(),sourceId,request.headers,credentialEncryptionKey());
    let bytes:Uint8Array;
    try{bytes=await readBoundedJsonBytes(request,WEBHOOK_LIMITS.bodyBytes);}catch{throw new ProductWebhookError('body_limit','UTF-8 JSON, 64 KiB ve 5 saniye sınırını kontrol edin.',413);}
    return NextResponse.json(receive(bytes),{status:200,headers});
  }catch(error){
    return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Webhook kabul edilemedi.',code:error instanceof ProductWebhookError?error.code:'invalid_event'},{status:error instanceof MarketingStoreError?error.status:400,headers:{...headers,...(error instanceof MarketingStoreError&&error.status===429?{'Retry-After':'60'}:{})}});
  }
}
export function GET(){return NextResponse.json({error:'POST gerekli.'},{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});}
