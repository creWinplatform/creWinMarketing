import { NextRequest, NextResponse } from 'next/server';
import { PlatformAccounts, consumeLoginAttempt } from '@/lib/platform/account';
import { platformDatabase } from '@/lib/platform/database';
import { platformRepository } from '@/lib/platform/workspace-server';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';
export async function POST(request: NextRequest) {
  if (!hasSameRequestOrigin(request))
    return NextResponse.json(
      { error: 'İstek kaynağı geçersiz.' },
      { status: 403 },
    );
  try {
    const input = await readAuthenticationJson(request);
    if (typeof input.token !== 'string' || input.token.length > 100)
      throw new Error();
    if (!consumeLoginAttempt(platformDatabase(), 'enroll:' + input.token))
      return NextResponse.json(
        { error: 'Çok fazla deneme. Daha sonra tekrar deneyin.' },
        { status: 429 },
      );
    platformRepository();
    if (input.action === 'inspect')
      return NextResponse.json(
        new PlatformAccounts(platformDatabase()).invitation(input.token),
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    new PlatformAccounts(platformDatabase()).redeem(input.token, input);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      {
        error:
          'Davet geçersiz, süresi dolmuş veya hesap bilgileri uygun değil. Şifre en az 12 karakter olmalı.',
      },
      { status: 400 },
    );
  }
}
