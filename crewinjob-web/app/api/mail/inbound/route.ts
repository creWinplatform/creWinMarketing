import { NextRequest, NextResponse } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { readBoundedBodyBytes } from '@/lib/platform/request-json';
import { inboundFromJson, receiveInboundReply, verifyInboundSignature } from '@/lib/platform/outreach-inbound';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
export const dynamic = 'force-dynamic', runtime = 'nodejs', maxDuration = 30;
// Managed sales service, any provider: a received reply as signed JSON (see verifyInboundSignature). Unsigned or old
// requests are refused; a reply that matches no sequence is dropped without being stored.
export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  try {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBodyBytes(request, 262144));
    if (!verifyInboundSignature(body, request.headers.get('x-ryzevo-timestamp'), request.headers.get('x-ryzevo-signature'))) return NextResponse.json({ error: 'İmza doğrulanamadı.' }, { status: 401, headers });
    return NextResponse.json(await receiveInboundReply(platformDatabase(), credentialEncryptionKey(), inboundFromJson(JSON.parse(body))), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Yanıt okunamadı.' }, { status: error instanceof MarketingStoreError ? error.status : 400, headers });
  }
}
