import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { readBoundedBodyBytes } from '@/lib/platform/request-json';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { crewinIys } from '@/lib/crewin-iys';
import {
  LegacyWhatsAppError,
  isTurkishNumber,
  legacyWhatsAppStatus,
  legacyWhatsAppSummary,
  normalizeWhatsAppNumber,
  recordLegacyWhatsAppConsent,
  recordLegacyWhatsAppOptOut,
} from '@/lib/legacy-whatsapp-consent';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Mesajlaşma → WA Bildirim Gönder → "WhatsApp izinleri": numara başına izin, çıkış ve durum sorgusu.
// Yalnız eski panel oturumu kullanır; Ryzevo hesapları middleware'de eski API'lere giremez.
// İYS (lib/crewin-iys.ts): beyan ve bağlantı durumu gösterilir; +90 izin ve çıkışları İYS'ye bildirilmek üzere kuyruğa girer.
const iys = () => crewinIys(platformDatabase(), credentialEncryptionKey());
const summary = () => { const service = iys(); return { ...legacyWhatsAppSummary(), iys: { scope: service.scope(), connected: service.connected() } }; };

export async function GET() {
  try { return NextResponse.json(summary()); }
  catch (error) {
    // The consent list stays readable even when the platform store cannot be opened; İYS then shows as unknown.
    console.error('[whatsapp-consents] iys', error instanceof Error ? error.message : error);
    return NextResponse.json({ ...legacyWhatsAppSummary(), iys: null });
  }
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
      const result = await recordLegacyWhatsAppConsent(body, actor, undefined, iys());
      return NextResponse.json({ ...result, summary: summary() });
    }
    if (body.action === 'opt_out') {
      const result = await recordLegacyWhatsAppOptOut(body.numbers, 'team', undefined, iys(), actor);
      return NextResponse.json({ ...result, summary: summary() });
    }
    if (body.action === 'check') return NextResponse.json({ items: legacyWhatsAppStatus(body.numbers) });
    // Asks İYS about the typed Turkish numbers (at most 50); nothing is sent to them.
    if (body.action === 'iys_check') {
      const phones = (Array.isArray(body.numbers) ? body.numbers : []).map(normalizeWhatsAppNumber).filter((phone): phone is string => Boolean(phone && isTurkishNumber(phone)));
      if (!phones.length) return NextResponse.json({ error: 'İYS’de sorgulanacak +90 numara girin.' }, { status: 400 });
      return NextResponse.json({ ...await iys().query(phones), summary: summary() });
    }
    return NextResponse.json({ error: 'Geçersiz istek.' }, { status: 400 });
  } catch (error) {
    if (error instanceof LegacyWhatsAppError || error instanceof MarketingStoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[whatsapp-consents]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'WhatsApp izin kaydı şu an güncellenemedi.' }, { status: 500 });
  }
}
