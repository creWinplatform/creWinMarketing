import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';

export const dynamic = 'force-dynamic';
export async function GET() {
  const access = await getPlatformAccess();
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  return NextResponse.json({ items: access.repository.workspaces(access.subject) }, { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function POST(request: NextRequest) {
  if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 });
  const access = await getPlatformAccess('members.manage');
  if (!access || access.subject !== 'legacy-admin') return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  try {
    const result = access.repository.provision(access.subject, await request.json());
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const duplicate = /UNIQUE constraint/.test(String(error));
    return NextResponse.json({ error: duplicate ? 'Username is already in use.' : 'Valid organization, project, website and credentials are required.' }, { status: duplicate ? 409 : 400 });
  }
}
