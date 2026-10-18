import {NextRequest,NextResponse} from 'next/server';
import {PlatformIdentity} from '@/lib/platform/identity';
import {platformDatabase} from '@/lib/platform/database';
import {credentialEncryptionKey} from '@/lib/platform/credential-key';
import {consumeLoginAttempt} from '@/lib/platform/account';
import {hasSameRequestOrigin} from '@/lib/platform/request-origin';
import {readAuthenticationJson} from '@/lib/platform/request-json';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
export async function GET(){
  return NextResponse.json(new PlatformIdentity(platformDatabase(),credentialEncryptionKey()).capabilities(),{headers});
}
export async function POST(request:NextRequest){
  if(!request.headers.get('origin')||!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
  try{
    const input=await readAuthenticationJson(request),identity=new PlatformIdentity(platformDatabase(),credentialEncryptionKey());
    if(input.action==='request-reset'||input.action==='request-signup'){
      // Return the same result for unknown, unavailable, rate-limited and known mailboxes.
      try{identity.request(input.action==='request-reset'?'reset':'signup',input.email,input.language);}catch{}
      return NextResponse.json({ok:true},{headers});
    }
    if(typeof input.token!=='string'||input.token.length!==43||!consumeLoginAttempt(platformDatabase(),`identity-proof:${input.token}`))throw new Error('Invalid proof.');
    if(input.action==='inspect'&&['verify','reset','signup'].includes(input.kind))identity.inspect(input.token,input.kind);
    else if(input.action==='verify')identity.verify(input.token);
    else if(input.action==='reset')identity.reset(input.token,input.password);
    else if(input.action==='register')identity.register(input.token,input);
    else throw new Error('Invalid action.');
    return NextResponse.json({ok:true},{headers});
  }catch{
    return NextResponse.json({error:'Bağlantı geçersiz, kullanılmış veya süresi dolmuş. Bilgilerinizi kontrol edip yeni bağlantı isteyin.'},{status:400,headers});
  }
}
