import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { platformDatabase } from '@/lib/platform/database';
import { operatorFunnel, operatorReadiness, probeGemini } from '@/lib/platform/operator';
import { serverSetup } from '@/lib/platform/server-setup';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
// Operator console: only the deployment administrator (the team running Ryzevo), never a customer session.
async function operator(permission?: 'members.manage') {
  const access = await getPlatformAccess(permission);
  return access && access.subject === 'legacy-admin' ? access : null;
}
export async function GET(request: NextRequest) {
  if (!await operator('members.manage')) return NextResponse.json({ error: 'Erişim reddedildi.' }, { status: 403, headers });
  const view = request.nextUrl.searchParams.get('view');
  // Setup guide: callback addresses are derived from the address this panel is opened from (the provider must send the
  // browser back to the same place).
  if (view === 'setup') {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host, proto = (request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '')).split(',')[0].trim();
    return NextResponse.json(serverSetup(platformDatabase(), `${proto === 'https' ? 'https' : 'http'}://${host}`), { headers });
  }
  if (view === 'funnel') {
    const days = Number(request.nextUrl.searchParams.get('days') || 90);
    return NextResponse.json(operatorFunnel(platformDatabase(), [30, 90, 365].includes(days) ? days : 90), { headers });
  }
  return NextResponse.json(operatorReadiness(platformDatabase()), { headers });
}
export async function POST(request: NextRequest) {
  if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
  if (!await operator('members.manage')) return NextResponse.json({ error: 'Erişim reddedildi.' }, { status: 403, headers });
  const body = await request.json().catch(() => ({})) as { action?: unknown; id?: unknown };
  if (body.action === 'probe' && body.id === 'gemini') return NextResponse.json(await probeGemini(), { headers });
  return NextResponse.json({ error: 'Geçersiz işlem.' }, { status: 400, headers });
}
