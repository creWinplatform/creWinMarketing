import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';

export const dynamic = 'force-dynamic';
export async function GET() {
  const access = await getPlatformAccess('members.manage');
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  return NextResponse.json({ items: access.repository.members(access.subject, access.identity.organizationId, access.identity.projectId) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function PATCH(request: NextRequest) {
  if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 });
  const access = await getPlatformAccess('members.manage');
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  try {
    const body = await request.json();
    access.repository.updateMember(access.subject, access.identity.organizationId, access.identity.projectId, body.userId, body.role, body.active);
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: 'Membership update denied; check scope, role and last-owner protection.' }, { status: 400 }); }
}

export async function POST(request: NextRequest) {
  if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 });
  const access = await getPlatformAccess('members.manage');
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  try {
    const result = access.repository.addMember(access.subject, access.identity.organizationId, access.identity.projectId, await request.json());
    return NextResponse.json(result, { status: 201 });
  } catch { return NextResponse.json({ error: 'A unique username, valid role and password of at least 12 characters are required.' }, { status: 400 }); }
}
