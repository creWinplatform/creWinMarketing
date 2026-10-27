import { NextRequest, NextResponse } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { openSharedReport } from '@/lib/platform/monthly-report';
import { consumeLoginAttempt } from '@/lib/platform/account';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic='force-dynamic';
// Public, cookie-free: the report page posts the token it read from its own URL fragment, so the token never appears in a
// request URL, a server log or a Referer header. Unknown, expired, revoked and rate-limited links get the same answer.
const headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
export async function POST(request:NextRequest){
  if(!request.headers.get('origin')||!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
  try{
    const input=await readAuthenticationJson(request),db=platformDatabase(),token=input&&typeof input==='object'?(input as {token?:unknown}).token:undefined;
    const report=typeof token==='string'&&token.length===43&&consumeLoginAttempt(db,`report-view:${token}`)?openSharedReport(db,token):null;
    if(!report)throw new Error('Unavailable.');
    return NextResponse.json(report,{headers});
  }catch{return NextResponse.json({error:'Bu rapor bağlantısı geçersiz, süresi dolmuş veya kapatılmış.'},{status:404,headers});}
}
