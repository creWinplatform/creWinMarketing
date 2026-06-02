import { NextRequest, NextResponse }                              from 'next/server';
import { getSessionFromRequest, createSessionToken, COOKIE_NAME, SESSION_HOURS } from '@/lib/auth';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout'];

function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/images/') ||
    pathname === '/favicon.ico' ||
    pathname === '/web.config' ||
    /\.(png|jpg|jpeg|gif|svg|ico|webp|css|js|woff|woff2|ttf)$/.test(pathname)
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isStaticAsset(pathname)) return NextResponse.next();
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const username = await getSessionFromRequest(req);

  if (!username) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Yetkisiz — lütfen giriş yapın' }, { status: 401 });
    }
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Oturum geçerli — sliding window yenile
  const res   = NextResponse.next();
  const fresh = await createSessionToken(username);
  res.cookies.set(COOKIE_NAME, fresh, {
    httpOnly: true,
    sameSite: 'strict',
    path:     '/',
    maxAge:   SESSION_HOURS * 60 * 60,
    secure:   req.nextUrl.protocol === 'https:',
  });
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
