import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { ProjectGoogleOAuth, GOOGLE_BROWSER_COOKIE } from '@/lib/platform/google-oauth';
import { googleConfiguration } from '@/lib/platform/google-client';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';

export const dynamic = 'force-dynamic';
export async function GET() {
  const access = await getRyzevoAccess('connections.manage');
  if (!access) return NextResponse.json({ error: 'Proje bağlantı yönetimi yetkisi gerekli.' }, { status: 403 });
  let configured = false;
  try { googleConfiguration(); configured = true; } catch {}
  return NextResponse.json({ configured }, { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function POST(request: NextRequest) {
  if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403 });
  const access = await getRyzevoAccess('connections.manage');
  if (!access) return NextResponse.json({ error: 'Proje bağlantı yönetimi yetkisi gerekli.' }, { status: 403 });
  try {
    const configuration = googleConfiguration();
    if (request.headers.get('origin') !== new URL(configuration.redirectUri).origin) return NextResponse.json({ error: 'Panel adresi Google dönüş adresiyle eşleşmiyor.' }, { status: 400 });
    const input = await request.json();
    const oauth = new ProjectGoogleOAuth(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }, credentialEncryptionKey());
    const result = await oauth.start({ provider: input.provider, resource: input.resource, accountName: input.accountName });
    const response = NextResponse.json({ authorizationUrl: result.authorizationUrl }, { headers: { 'Cache-Control': 'private, no-store' } });
    response.cookies.set(GOOGLE_BROWSER_COOKIE, result.browser, { httpOnly: true, sameSite: 'lax', secure: new URL(configuration.redirectUri).protocol === 'https:', path: '/api/platform/google/callback', maxAge: 600 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'Google OAuth sunucuda yapılandırılmalı.' }, { status: error instanceof MarketingStoreError ? error.status : 503 });
  }
}
