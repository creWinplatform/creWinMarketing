import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectLinkedInOAuth, LINKEDIN_BROWSER_COOKIE } from '@/lib/platform/linkedin-oauth';
import { linkedinConfiguration } from '@/lib/platform/linkedin-client';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { readAuthenticationJson } from '@/lib/platform/request-json';
import { socialPublishingEnabled } from '@/lib/platform/linkedin-publishing';
export const dynamic = 'force-dynamic';
export async function GET() {
  const access = await getPlatformAccess('connections.manage');
  if (!access || access.identity.mode !== 'platform') return NextResponse.json({ error: 'Proje bağlantı yönetimi yetkisi gerekli.' }, { status: 403 });
  let linkedinConfigured = false;
  try { linkedinConfiguration(); linkedinConfigured = true; } catch {}
  return NextResponse.json({ linkedinConfigured, manualPlatforms: ['linkedin', 'twitter'], publishingEnabled: socialPublishingEnabled(), publishingPlatforms: ['linkedin'] }, { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function POST(request: NextRequest) {
  if (!hasSameRequestOrigin(request)) return NextResponse.json({ error: 'İstek kaynağı geçersiz.' }, { status: 403 });
  const access = await getPlatformAccess('connections.manage');
  if (!access || access.identity.mode !== 'platform') return NextResponse.json({ error: 'Proje bağlantı yönetimi yetkisi gerekli.' }, { status: 403 });
  try {
    const configuration = linkedinConfiguration();
    if (request.headers.get('origin') !== new URL(configuration.redirectUri).origin) return NextResponse.json({ error: 'Panel adresi LinkedIn dönüş adresiyle eşleşmiyor.' }, { status: 400 });
    const input = await readAuthenticationJson(request);
    if (input.platform !== 'linkedin') throw new MarketingStoreError('Bu akış yalnız LinkedIn için etkin.');
    const oauth = new ProjectLinkedInOAuth(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }, credentialEncryptionKey());
    const result = oauth.start({ accountName: input.accountName, accountId: input.accountId, publishing: input.publishing });
    const response = NextResponse.json({ authorizationUrl: result.authorizationUrl }, { headers: { 'Cache-Control': 'private, no-store' } });
    response.cookies.set(LINKEDIN_BROWSER_COOKIE, result.browser, { httpOnly: true, sameSite: 'lax', secure: new URL(configuration.redirectUri).protocol === 'https:', path: '/api/platform/social/callback', maxAge: 600 });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof MarketingStoreError ? error.message : 'LinkedIn OAuth sunucuda yapılandırılmalı.' }, { status: error instanceof MarketingStoreError ? error.status : 503 });
  }
}
