import {NextRequest,NextResponse} from 'next/server';
import {getPlatformAccess} from '@/lib/platform/workspace-server';
import {PlatformIdentity} from '@/lib/platform/identity';
import {platformDatabase} from '@/lib/platform/database';
import {credentialEncryptionKey} from '@/lib/platform/credential-key';
import {hasSameRequestOrigin} from '@/lib/platform/request-origin';
import {readAuthenticationJson} from '@/lib/platform/request-json';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){
  const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Giriş gerekli.'},{status:401,headers});
  return NextResponse.json(new PlatformIdentity(platformDatabase(),credentialEncryptionKey()).account(access.subject),{headers});
}
export async function POST(request:NextRequest){
  if(!request.headers.get('origin')||!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
  const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Giriş gerekli.'},{status:401,headers});
  try{
    const input=await readAuthenticationJson(request);
    new PlatformIdentity(platformDatabase(),credentialEncryptionKey()).requestVerification(access.subject,input.email,input.currentPassword,input.language);
    return NextResponse.json({ok:true},{headers});
  }catch{return NextResponse.json({error:'Doğrulama başlatılamadı. Mevcut şifreyi, e-posta adresini ve gönderim ayarını kontrol edin. Çok sayıda istekte bir saat bekleyin.'},{status:400,headers});}
}
