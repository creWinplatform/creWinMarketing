import { NextRequest, NextResponse }                                             from 'next/server';
import { preferredWorkspace } from '@/lib/platform/user-preferences';
import { validateCredentials, createSessionToken, createPlatformSessionToken, authConfigured, COOKIE_NAME, SESSION_HOURS } from '@/lib/auth';
import { platformRepository } from '@/lib/platform/workspace-server';
import { consumeLoginAttempt, securityVersion } from '@/lib/platform/account';
import { platformDatabase } from '@/lib/platform/database';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readAuthenticationJson } from '@/lib/platform/request-json';

// Next 14 route içindeki fetch'leri (agent modülleri dahil) veri önbelleğine alabilir → bayat login token'ı; kapat.
export const fetchCache = 'force-no-store';

export async function POST(req: NextRequest) {
  if(!hasSameRequestOrigin(req)) return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403});
  if (!authConfigured()) {
    return NextResponse.json({ error: 'Sunucu yapılandırması eksik: AUTH_SECRET (≥16 karakter), ADMIN_USERNAME ve ADMIN_PASSWORD tanımlanmalı.' }, { status: 503 });
  }

  let username: string | undefined;
  let password: string | undefined;
  try {
    ({ username, password } = await readAuthenticationJson(req) as { username?: string; password?: string });
  } catch {
    return NextResponse.json({ error: 'Geçersiz istek' }, { status: 400 });
  }

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password || username.length > 160 || password.length > 256) {
    return NextResponse.json({ error: 'Kullanıcı adı ve şifre gerekli' }, { status: 400 });
  }

  const legacy = validateCredentials(username, password);
  const repository = platformRepository();
  if(!consumeLoginAttempt(platformDatabase(),username)) return NextResponse.json({error:'Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.'},{status:429});
  const user = legacy ? null : repository.authenticate(username, password);
  // The project the person opened last, else the first one they belong to.
  const workspace = user ? preferredWorkspace(platformDatabase(), repository, user.id) : null;
  if (!legacy && (!user || !workspace)) {
    await new Promise(r => setTimeout(r, 800)); // brute-force yavaşlatma
    return NextResponse.json({ error: 'Kullanıcı adı veya şifre hatalı' }, { status: 401 });
  }

  const token = legacy ? await createSessionToken(username) : await createPlatformSessionToken({ subject: user!.id, organizationId: workspace!.organization.id, projectId: workspace!.project.id,securityVersion:securityVersion(platformDatabase(),user!.id) });
  const res   = NextResponse.json({ ok: true, username });

  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path:     '/',
    maxAge:   SESSION_HOURS * 60 * 60,
    secure:   req.nextUrl.protocol === 'https:',
  });

  return res;
}
