import { NextRequest, NextResponse } from 'next/server';
import { agentModule } from '@/lib/agent-bridge';
import { platformDatabase } from '@/lib/platform/database';
import { isRyzevoUnsubscribe,processRyzevoUnsubscribe } from '@/lib/platform/email-safety';
import { isLegacyUnsubscribe, processLegacyUnsubscribe } from '@/lib/legacy-unsubscribe';
import { readBoundedBodyBytes } from '@/lib/platform/request-json';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { queueIysUnsubscribe } from '@/lib/platform/email-recipients';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
const privateHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};

export const dynamic = 'force-dynamic';
// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

type Api = {
  growthAnalyticsPublicPost: (endpoint: string, body: Record<string, string>) => Promise<unknown>;
};

// İstemciye backend hata metni dönülmez; ayrıntı yalnızca sunucu loguna yazılır.
const INVALID_LINK = 'Bu bağlantı geçersiz veya süresi dolmuş. / This link is invalid or has expired.';
const GENERIC_ERROR = 'Abonelik iptali şu an işlenemedi, lütfen daha sonra tekrar deneyin. / Unsubscribe could not be processed right now, please try again later.';

// POST /api/unsubscribe
// - Sayfa (/unsubscribe): JSON gövde { token }
// - RFC 8058 one-click (List-Unsubscribe-Post): form gövde "List-Unsubscribe=One-Click", token query'de
export async function POST(request: NextRequest) {
  let ryzevo=false;
  try {
    let token = request.nextUrl.searchParams.get('token')?.trim() || '';
    ryzevo=isRyzevoUnsubscribe(token);let action='process';
    if ((request.headers.get('content-type') || '').includes('application/json')) {
      let body:{token?:unknown;action?:unknown};
      try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBodyBytes(request,8192)));if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();}
      catch{return NextResponse.json({error:INVALID_LINK},{status:400,headers:privateHeaders});}
      if (typeof body.token === 'string' && body.token.trim()) token = body.token.trim();
      ryzevo||=isRyzevoUnsubscribe(token);action=typeof body.action==='string'?body.action:'process';
    }
    if (!token) return NextResponse.json({ error: 'Token zorunludur. / Token is required.' }, { status: 400 });
    if(ryzevo){
      if(!isRyzevoUnsubscribe(token)||!['inspect','process'].includes(action))return NextResponse.json({error:INVALID_LINK},{status:400,headers:privateHeaders});
      if(!(request.headers.get('content-type')||'').includes('application/json')){
        if(!(request.headers.get('content-type')||'').startsWith('application/x-www-form-urlencoded'))return NextResponse.json({error:INVALID_LINK},{status:400,headers:privateHeaders});
        const form=new URLSearchParams(new TextDecoder().decode(await readBoundedBodyBytes(request,256)));
        if(form.get('List-Unsubscribe')!=='One-Click')return NextResponse.json({error:INVALID_LINK},{status:400,headers:privateHeaders});
      }
      const db=platformDatabase();
      return NextResponse.json(processRyzevoUnsubscribe(db,token,action==='inspect',item=>{queueIysUnsubscribe(db,item.scope,credentialEncryptionKey(),item.sourceId,item.entityKey,item.emailKey);}),{headers:privateHeaders});
    }

    // The legacy panel's own links (prospects, companies, manual addresses) are handled here, not by the backend.
    if (isLegacyUnsubscribe(token)) {
      try { return NextResponse.json(await processLegacyUnsubscribe(token), { headers: privateHeaders }); }
      catch { return NextResponse.json({ error: INVALID_LINK }, { status: 400, headers: privateHeaders }); }
    }

    const result = await agentModule<Api>('modules/api.js').growthAnalyticsPublicPost('ProcessUnsubscribe', {
      token,
      channel: 'email',
      reason: 'user_request',
    });
    return NextResponse.json({ result });
  } catch (error) {
    if(ryzevo){const invalid=error instanceof MarketingStoreError&&error.status===400;return NextResponse.json({error:invalid?INVALID_LINK:GENERIC_ERROR},{status:invalid?400:503,headers:privateHeaders});}
    const status = Number((error as { status?: number }).status || 0);
    console.error('[unsubscribe] ProcessUnsubscribe başarısız:', status || '-', error instanceof Error ? error.message : error);
    const clientError = status >= 400 && status < 500;
    return NextResponse.json(
      { error: clientError ? INVALID_LINK : GENERIC_ERROR },
      { status: clientError ? status : 502 },
    );
  }
}

// GET /api/unsubscribe?token= — List-Unsubscribe linkini tarayıcıda açan istemciler onay sayfasına gider
// (Göreli Location: proxy arkasında Host başlığından yanlış origin türetilmez)
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim();
  const location = token ? `/unsubscribe?${new URLSearchParams({ token }).toString()}` : '/unsubscribe';
  return new NextResponse(null, { status: 303, headers: { Location: location,...privateHeaders } });
}
