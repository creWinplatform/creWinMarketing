import { NextRequest, NextResponse } from 'next/server';
import { getRyzevoAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectMetaOAuth, META_BROWSER_COOKIE, META_SELECTION_COOKIE } from '@/lib/platform/meta-oauth';
import { metaConfiguration } from '@/lib/platform/meta-client';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: NextRequest) {
  const access = await getRyzevoAccess('connections.manage');
  if (!access) return json({ error: 'Proje bağlantı yönetimi yetkisi gerekli.' }, 403);
  let configured = false;
  try { metaConfiguration(); configured = true; } catch {}
  const cookie = request.cookies.get(META_SELECTION_COOKIE)?.value;
  if (!cookie) return json({ configured, selection: null });
  try {
    const oauth = new ProjectMetaOAuth(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }, credentialEncryptionKey());
    return json({ configured, selection: await oauth.list(cookie, request.nextUrl.searchParams.get('more') === 'true') });
  } catch (error) { return json({ configured, selection: null, error: error instanceof MarketingStoreError ? error.message : 'Meta sayfaları alınamadı.' }, error instanceof MarketingStoreError ? error.status : 400); }
}
export async function POST(request: NextRequest) {
  if (!hasSameRequestOrigin(request)) return json({ error: 'İstek kaynağı geçersiz.' }, 403);
  const access = await getRyzevoAccess('connections.manage');
  if (!access) return json({ error: 'Proje bağlantı yönetimi yetkisi gerekli.' }, 403);
  try {
    const input = await readAuthenticationJson(request);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MarketingStoreError('Geçersiz Meta isteği.');
    const oauth = new ProjectMetaOAuth(platformDatabase(), { subject: access.subject, organizationId: access.identity.organizationId, projectId: access.identity.projectId }, credentialEncryptionKey());
    if (input.action === 'select' || input.action === 'cancel') {
      const cookie = request.cookies.get(META_SELECTION_COOKIE)?.value || '';
      const result = input.action === 'select' ? await oauth.select(cookie, input.pageId) : (oauth.cancel(cookie), { ok: true });
      const response = json(result);
      response.cookies.set(META_SELECTION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', path: '/api/platform/meta', maxAge: 0 });
      return response;
    }
    if (input.action !== 'start') throw new MarketingStoreError('Geçerli Meta işlemi gerekli.');
    const configuration = metaConfiguration();
    if (request.headers.get('origin') !== new URL(configuration.redirectUri).origin) throw new MarketingStoreError('Panel adresi Meta dönüş adresiyle eşleşmiyor.');
    const result = oauth.start(input.target, input.publishing, input.inbox === undefined ? false : input.inbox);
    const response = json({ authorizationUrl: result.authorizationUrl });
    response.cookies.set(META_BROWSER_COOKIE, result.browser, { httpOnly: true, sameSite: 'lax', secure: new URL(configuration.redirectUri).protocol === 'https:', path: '/api/platform/meta/callback', maxAge: 600 });
    response.cookies.set(META_SELECTION_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: new URL(configuration.redirectUri).protocol === 'https:', path: '/api/platform/meta', maxAge: 0 });
    return response;
  } catch (error) { return json({ error: error instanceof MarketingStoreError ? error.message : 'Meta OAuth sunucuda yapılandırılmalı.' }, error instanceof MarketingStoreError ? error.status : 503); }
}
