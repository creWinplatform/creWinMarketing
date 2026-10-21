import {NextRequest,NextResponse} from 'next/server';
import {platformDatabase} from '@/lib/platform/database';
import {credentialEncryptionKey} from '@/lib/platform/credential-key';
import {readBoundedBodyBytes} from '@/lib/platform/request-json';
import {receiveWhatsAppHook,verifyWhatsAppHook} from '@/lib/platform/whatsapp';
import {MarketingStoreError} from '@/lib/platform/marketing-store';
export const dynamic='force-dynamic',runtime='nodejs',maxDuration=30;
// Meta's server calls this without a session: GET is the subscription check, POST carries signed delivery states and replies.
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
export async function GET(request:NextRequest,{params}:{params:Promise<{hookId:string}>}){
  const {hookId}=await params,challenge=verifyWhatsAppHook(platformDatabase(),hookId,request.nextUrl.searchParams);
  return challenge?new NextResponse(challenge,{status:200,headers:{...headers,'Content-Type':'text/plain'}}):NextResponse.json({error:'Doğrulama reddedildi.'},{status:403,headers});
}
export async function POST(request:NextRequest,{params}:{params:Promise<{hookId:string}>}){
  try{const {hookId}=await params,bytes=await readBoundedBodyBytes(request,262144);
    return NextResponse.json(receiveWhatsAppHook(platformDatabase(),credentialEncryptionKey(),hookId,bytes,request.headers.get('x-hub-signature-256')),{headers});}
  catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'WhatsApp bildirimi işlenemedi.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
