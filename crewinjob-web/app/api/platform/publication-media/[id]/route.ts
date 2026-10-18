import { NextRequest, NextResponse } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { providerPublicationImage } from '@/lib/platform/social-publications';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'};
  try{
    const q=request.nextUrl.searchParams;
    if(!q.has('signature')||q.size!==(q.has('index')?2:1))throw new Error();
    const image=providerPublicationImage(platformDatabase(),credentialEncryptionKey(),(await params).id,q.get('signature')||'',q.has('index')?Number(q.get('index')):0);
    return new NextResponse(new Uint8Array(Buffer.from(image.data,'base64')),{headers:{...headers,'Content-Type':'image/jpeg','Content-Length':String(image.bytes)}});
  }catch{return new NextResponse(null,{status:404,headers});}
}
