import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedWorkspace, getPlatformAccess } from '@/lib/platform/workspace-server';
import { createPlatformSessionToken, createSessionToken, COOKIE_NAME, SESSION_HOURS } from '@/lib/auth';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { platformDatabase } from '@/lib/platform/database';
import { rememberProject } from '@/lib/platform/user-preferences';

export const dynamic = 'force-dynamic';

export async function GET() {
  const workspace = await getAuthorizedWorkspace();
  if (!workspace) return NextResponse.json({ error: 'Workspace access denied.' }, { status: 401 });
  return NextResponse.json(workspace, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: NextRequest) {
  if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 });
  const access = await getPlatformAccess();
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  try {
    const { organizationId, projectId } = await request.json();
    if (typeof organizationId !== 'string' || typeof projectId !== 'string') return NextResponse.json({ error: 'Valid scope required.' }, { status: 400 });
    const workspace = access.repository.workspace(access.subject, organizationId, projectId);
    if (!workspace) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    const token = access.subject === 'legacy-admin' && organizationId === 'crewin' && projectId === 'crewinjob'
      ? await createSessionToken(process.env.ADMIN_USERNAME!)
      : await createPlatformSessionToken({ subject: access.subject, organizationId, projectId, securityVersion: access.identity.securityVersion || 0 });
    if (access.identity.mode === 'platform') rememberProject(platformDatabase(), access.subject, organizationId, projectId);
    const response = NextResponse.json(workspace);
    response.cookies.set(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', path: '/', maxAge: SESSION_HOURS * 3600 });
    return response;
  } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
}

export async function PATCH(request: NextRequest) {
  if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'Invalid origin.' }, { status: 403 });
  const access = await getPlatformAccess('connections.manage');
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  try {
    const workspace = access.repository.updateProject(access.subject, access.identity.organizationId, access.identity.projectId, await request.json());
    return NextResponse.json(workspace, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Proje ayarları geçersiz. Ad, web sitesi, saat dilimi, dil ve hedefleri kontrol edin.' }, { status: 400 }); }
}
