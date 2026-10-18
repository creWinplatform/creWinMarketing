import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { PlatformAccounts } from '@/lib/platform/account';
import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/marketing-store';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { COOKIE_NAME } from '@/lib/auth';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export async function POST(request: NextRequest) {
  try {
    if (!hasSameRequestOrigin(request))
      return NextResponse.json(
        { error: 'İstek kaynağı geçersiz.' },
        { status: 403 },
      );
    const access = await getPlatformAccess();
    if (!access)
      return NextResponse.json({ error: 'Giriş gerekli.' }, { status: 401 });
    const input = await readAuthenticationJson(request),
      scope = {
        subject: access.subject,
        organizationId: access.identity.organizationId,
        projectId: access.identity.projectId,
      },
      accounts = new PlatformAccounts(platformDatabase());
    if (input.action === 'invite')
      return NextResponse.json(accounts.invite(scope, input));
    if (input.action === 'password' && access.identity.mode === 'platform') {
      accounts.changePassword(scope, input.currentPassword, input.nextPassword);
      const response = NextResponse.json({ ok: true });
      response.cookies.set(COOKIE_NAME, '', {
        httpOnly: true,
        path: '/',
        maxAge: 0,
      });
      return response;
    }
    throw new MarketingStoreError('Geçersiz hesap işlemi.');
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof MarketingStoreError
            ? error.message
            : 'Hesap işlemi tamamlanamadı.',
      },
      { status: error instanceof MarketingStoreError ? error.status : 400 },
    );
  }
}
