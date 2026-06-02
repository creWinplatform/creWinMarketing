import { NextRequest, NextResponse }                          from 'next/server';
import { validateCredentials, createSessionToken, COOKIE_NAME, SESSION_HOURS } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json() as { username?: string; password?: string };

  if (!username || !password) {
    return NextResponse.json({ error: 'Kullanıcı adı ve şifre gerekli' }, { status: 400 });
  }

  if (!validateCredentials(username, password)) {
    // Brute-force'u yavaşlat
    await new Promise(r => setTimeout(r, 800));
    return NextResponse.json({ error: 'Kullanıcı adı veya şifre hatalı' }, { status: 401 });
  }

  const token = createSessionToken(username);
  const res   = NextResponse.json({ ok: true, username });

  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    path:     '/',
    maxAge:   SESSION_HOURS * 60 * 60,
    secure:   req.nextUrl.protocol === 'https:',
  });

  return res;
}
