import { NextRequest, NextResponse } from 'next/server';
import { readBoundedBodyBytes } from '@/lib/platform/request-json';
import { LegacyWhatsAppError, receiveLegacyWhatsAppHook, verifyLegacyWhatsAppHook } from '@/lib/legacy-whatsapp-consent';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

// Crewin numarası için Meta'nın WhatsApp webhook'u; oturumsuz çağrılır (middleware'de tam yol istisnası).
// GET abonelik doğrulaması (WHATSAPP_WEBHOOK_VERIFY_TOKEN), POST imzalı olaylar (X-Hub-Signature-256, WHATSAPP_APP_SECRET).
// Yalnız STOP yanıtları ve pazarlama çıkışları kaydedilir; mesaj içeriği saklanmaz. Ayarlar yoksa her istek reddedilir.
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export async function GET(request: NextRequest) {
  const challenge = verifyLegacyWhatsAppHook(request.nextUrl.searchParams);
  return challenge
    ? new NextResponse(challenge, { status: 200, headers: { ...headers, 'Content-Type': 'text/plain' } })
    : NextResponse.json({ error: 'Doğrulama reddedildi.' }, { status: 403, headers });
}

export async function POST(request: NextRequest) {
  try {
    const bytes = await readBoundedBodyBytes(request, 262144);
    return NextResponse.json(await receiveLegacyWhatsAppHook(bytes, request.headers.get('x-hub-signature-256')), { headers });
  } catch (error) {
    const known = error instanceof LegacyWhatsAppError;
    return NextResponse.json({ error: known ? error.message : 'WhatsApp bildirimi işlenemedi.' }, { status: known ? error.status : 400, headers });
  }
}
