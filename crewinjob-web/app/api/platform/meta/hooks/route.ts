import {NextRequest,NextResponse} from 'next/server';
import {platformDatabase} from '@/lib/platform/database';
import {credentialEncryptionKey} from '@/lib/platform/credential-key';
import {readBoundedBodyBytes} from '@/lib/platform/request-json';
import {receiveMetaInboxHook,verifyMetaInboxHook} from '@/lib/platform/social-inbox';
import {MarketingStoreError} from '@/lib/platform/marketing-store';
export const dynamic='force-dynamic',runtime='nodejs',maxDuration=30;
// Meta's server calls this without a session: GET is the subscription check, POST carries signed comment and message events.
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
export async function GET(request:NextRequest){
  const challenge=verifyMetaInboxHook(request.nextUrl.searchParams);
  return challenge?new NextResponse(challenge,{status:200,headers:{...headers,'Content-Type':'text/plain'}}):NextResponse.json({error:'Doğrulama reddedildi.'},{status:403,headers});
}
export async function POST(request:NextRequest){
  try{const bytes=await readBoundedBodyBytes(request,262144);
    return NextResponse.json(receiveMetaInboxHook(platformDatabase(),credentialEncryptionKey(),bytes,request.headers.get('x-hub-signature-256')),{headers});}
  catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Meta bildirimi işlenemedi.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
