import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { platformDatabase } from '@/lib/platform/database';
import { ManagedOperator, managedReady } from '@/lib/platform/managed-sending';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
// Managed sales service, the operator's side (the deployment administrator only): the pilot list, credits and the
// managed domains.
async function operator() { const access = await getPlatformAccess('members.manage'); return access && access.subject === 'legacy-admin' ? access : null; }
export async function GET() {
  if (!await operator()) return NextResponse.json({ error: 'Erişim reddedildi.' }, { status: 403, headers });
  const db = platformDatabase();
  if (!await managedReady(db)) return NextResponse.json({ error: 'Yönetimli gönderim tabloları henüz yok (db:upgrade).' }, { status: 409, headers });
  return NextResponse.json(await new ManagedOperator(db, 'legacy-admin').read(), { headers });
}
export async function POST(request: NextRequest) {
  if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
  const access = await operator(); if (!access) return NextResponse.json({ error: 'Erişim reddedildi.' }, { status: 403, headers });
  const raw = await request.json().catch(() => ({})) as Record<string, unknown>, managed = new ManagedOperator(platformDatabase(), access.subject);
  try {
    switch (raw.action) {
      case 'pilot': return NextResponse.json(await managed.savePilot(raw), { headers });
      case 'pilot-state': return NextResponse.json(await managed.setPilotState(raw), { headers });
      case 'credits': return NextResponse.json(await managed.grant(raw), { headers });
      case 'domain-add': return NextResponse.json(await managed.addDomain(raw), { headers });
      case 'domain-check': return NextResponse.json(await managed.checkDomain(raw), { headers });
      case 'domain-assign': return NextResponse.json(await managed.assignDomain(raw), { headers });
      case 'domain-release': return NextResponse.json(await managed.releaseDomain(raw), { headers });
    }
    return NextResponse.json({ error: 'Geçersiz işlem.' }, { status: 400, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'İşlem tamamlanamadı.' }, { status: error instanceof MarketingStoreError ? error.status : 500, headers });
  }
}
