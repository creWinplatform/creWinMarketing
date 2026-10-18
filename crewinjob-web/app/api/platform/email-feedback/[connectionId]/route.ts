import {NextRequest,NextResponse} from 'next/server';
import {platformDatabase} from '@/lib/platform/database';
import {credentialEncryptionKey} from '@/lib/platform/credential-key';
import {readBoundedBodyBytes} from '@/lib/platform/request-json';
import {receiveSesFeedback} from '@/lib/platform/ses-feedback';
import {MarketingStoreError} from '@/lib/platform/marketing-store';
export const dynamic='force-dynamic',runtime='nodejs',maxDuration=30;
export async function POST(request:NextRequest,{params}:{params:Promise<{connectionId:string}>}){
  const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
  try{const {connectionId}=await params;if(!/^[a-f0-9]{32}$/.test(connectionId))throw new MarketingStoreError('Geçersiz bağlantı.',404);const bytes=await readBoundedBodyBytes(request,131072),payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return NextResponse.json(await receiveSesFeedback(platformDatabase(),connectionId,payload,credentialEncryptionKey()),{headers});}
  catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'SNS bildirimi doğrulanamadı.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}
}
