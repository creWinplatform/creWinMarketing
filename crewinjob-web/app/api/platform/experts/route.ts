import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readBoundedJsonBytes } from '@/lib/platform/request-json';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { Experts, partnerDirectory } from '@/lib/platform/experts';
export const dynamic = 'force-dynamic';

// "Ask an expert": GET the project's requests (and, for a partner home, its profile and incoming work); GET
// ?directory=1[&service=] lists partners. POST actions (small JSON); delivery files go up in parts through ./file.
const scopeOf = async () => { const access = await getRyzevoAccess(); return access ? { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId } : null; };
const headers = { 'Cache-Control': 'private, no-store' };
const fail = (error: unknown) => NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Uzman talebi işlemi tamamlanamadı.' }, { status: error instanceof MarketingStoreError ? error.status : 500, headers });
export async function GET(request: NextRequest) {
  try {
    const scope = await scopeOf(); if (!scope) return NextResponse.json({ error: 'Proje oturumu gerekli.' }, { status: 403, headers });
    const url = new URL(request.url), db = platformDatabase();
    if (url.searchParams.get('directory') === '1') return NextResponse.json({ partners: await partnerDirectory(db, scope, url.searchParams.get('service')) }, { headers });
    return NextResponse.json(await new Experts(db, scope).snapshot(), { headers });
  } catch (error) { return fail(error); }
}
export async function POST(request: NextRequest) {
  try {
    const scope = await scopeOf(); if (!scope) return NextResponse.json({ error: 'Proje oturumu gerekli.' }, { status: 403, headers });
    if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403, headers });
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedJsonBytes(request, 98304))); } catch { throw new MarketingStoreError('Geçersiz istek.'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MarketingStoreError('Geçersiz istek.');
    const experts = new Experts(platformDatabase(), scope);
    switch (raw.action) {
      case 'brief-draft': return NextResponse.json(await experts.briefDraft(), { headers });
      case 'create': return NextResponse.json(await experts.create(raw), { headers });
      case 'cancel': return NextResponse.json(await experts.cancel(raw), { headers });
      case 'review': return NextResponse.json(await experts.review(raw), { headers });
      case 'profile': return NextResponse.json(await experts.saveProfile(raw), { headers });
      case 'decide': return NextResponse.json(await experts.decide(raw), { headers });
      case 'start-file': return NextResponse.json(await experts.startFile(raw), { headers });
      case 'finish-file': return NextResponse.json(await experts.finishFile(raw), { headers });
      case 'remove-file': return NextResponse.json(await experts.removeFile(raw), { headers });
      case 'deliver': return NextResponse.json(await experts.deliver(raw), { headers });
    }
    throw new MarketingStoreError('Geçersiz uzman talebi işlemi.');
  } catch (error) { return fail(error); }
}
