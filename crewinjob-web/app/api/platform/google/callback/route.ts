import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { ProjectGoogleOAuth, GOOGLE_BROWSER_COOKIE } from '@/lib/platform/google-oauth';
import { googleConfiguration } from '@/lib/platform/google-client';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  let redirect: URL;
  try { redirect = new URL('/', googleConfiguration().redirectUri); }
  catch { return NextResponse.json({ error: 'Google OAuth yapılandırılmadı.' }, { status: 503 }); }
  let result = 'failed';
  try {
    const access = await getRyzevoAccess('connections.manage');
    if (!access || request.nextUrl.searchParams.has('error')) throw new Error();
    const oauth = new ProjectGoogleOAuth(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }, credentialEncryptionKey());
    await oauth.complete(request.nextUrl.searchParams.get('state') || '', request.cookies.get(GOOGLE_BROWSER_COOKIE)?.value || '', request.nextUrl.searchParams.get('code') || '');
    result = 'connected';
  } catch { /* OAuth errors and authorization codes never enter the redirect or logs. */ }
  redirect.searchParams.set('googleConnection', result);
  redirect.searchParams.set('tab','project');redirect.searchParams.set('settings','connections');
  const response = NextResponse.redirect(redirect);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.set(GOOGLE_BROWSER_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: redirect.protocol === 'https:', path: '/api/platform/google/callback', maxAge: 0 });
  return response;
}
