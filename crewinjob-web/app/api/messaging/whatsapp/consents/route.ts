import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { readBoundedBodyBytes } from '@/lib/platform/request-json';
import {
  LegacyWhatsAppError,
  legacyWhatsAppStatus,
  legacyWhatsAppSummary,
  recordLegacyWhatsAppConsent,
  recordLegacyWhatsAppOptOut,
} from '@/lib/legacy-whatsapp-consent';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

// Mesajlaşma → WA Bildirim Gönder → "WhatsApp izinleri": numara başına izin, çıkış ve durum sorgusu.
// Yalnız eski panel oturumu kullanır; Ryzevo hesapları middleware'de eski API'lere giremez.
export async function GET() {
  return NextResponse.json(legacyWhatsAppSummary());
}

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBodyBytes(request, 65536)));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body');
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
    }
    const actor = await getSessionFromRequest(request) || 'panel';
    if (body.action === 'consent') {
      const result = await recordLegacyWhatsAppConsent(body, actor);
      return NextResponse.json({ ...result, summary: legacyWhatsAppSummary() });
    }
    if (body.action === 'opt_out') {
      const result = await recordLegacyWhatsAppOptOut(body.numbers, 'team');
      return NextResponse.json({ ...result, summary: legacyWhatsAppSummary() });
    }
    if (body.action === 'check') return NextResponse.json({ items: legacyWhatsAppStatus(body.numbers) });
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  } catch (error) {
    if (error instanceof LegacyWhatsAppError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[whatsapp-consents]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'WhatsApp izin kaydı şu an güncellenemedi.' }, { status: 500 });
  }
}
