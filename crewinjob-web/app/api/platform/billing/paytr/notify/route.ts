import {NextRequest,NextResponse} from 'next/server';
import {platformDatabase} from '@/lib/platform/database';
import {receivePaytrNotification} from '@/lib/platform/billing';
import {isLiveNotification,receivePaytrLiveNotification} from '@/lib/platform/billing-live';
import {readBoundedBodyBytes} from '@/lib/platform/request-json';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){
  const headers={'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'};
  try{
    if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/x-www-form-urlencoded')return new NextResponse('Invalid notification',{status:415,headers});
    const body=new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBodyBytes(request,8192));
    // RZLIVE orders are live payments; everything else stays on the sandbox path.
    if(isLiveNotification(body))receivePaytrLiveNotification(platformDatabase(),body);
    else receivePaytrNotification(platformDatabase(),body);
    return new NextResponse('OK',{headers});
  }catch{return new NextResponse('Notification not accepted',{status:400,headers});}
}
