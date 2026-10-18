import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectMetaOAuth, META_BROWSER_COOKIE, META_SELECTION_COOKIE } from '@/lib/platform/meta-oauth';
import { metaConfiguration } from '@/lib/platform/meta-client';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  let redirect: URL;
  try { redirect = new URL('/', metaConfiguration().redirectUri); }
  catch { return NextResponse.json({ error: 'Meta OAuth yapılandırılmadı.' }, { status: 503 }); }
  let selection: string | undefined;
  try {
    const access = await getPlatformAccess('connections.manage');
    if (!access || access.identity.mode !== 'platform' || request.nextUrl.searchParams.has('error')) throw new Error();
    const oauth = new ProjectMetaOAuth(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }, credentialEncryptionKey());
    selection = await oauth.complete(request.nextUrl.searchParams.get('state') || '', request.cookies.get(META_BROWSER_COOKIE)?.value || '', request.nextUrl.searchParams.get('code') || '');
  } catch { /* Provider errors and credentials never enter redirects or logs. */ }
  redirect.searchParams.set('metaConnection', selection ? 'select' : 'failed');
  redirect.searchParams.set('tab','project');redirect.searchParams.set('settings','connections');
  const response = NextResponse.redirect(redirect);
  response.headers.set('Cache-Control', 'no-store'); response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.set(META_BROWSER_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: redirect.protocol === 'https:', path: '/api/platform/meta/callback', maxAge: 0 });
  response.cookies.set(META_SELECTION_COOKIE, selection || '', { httpOnly: true, sameSite: 'lax', secure: redirect.protocol === 'https:', path: '/api/platform/meta', maxAge: selection ? 600 : 0 });
  return response;
}
