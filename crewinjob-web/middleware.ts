import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, COOKIE_NAME, SESSION_HOURS, createSessionToken } from '@/lib/auth';

// Kimlik doğrulama gerektirmeyen yollar
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
];

// Statik varlıklar — kontrol etme
function isStaticAsset(pathname: string): boolean {
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/images/') ||
    pathname === '/favicon.ico' ||
    pathname === '/web.config' ||
    /\.(png|jpg|jpeg|gif|svg|ico|webp|css|js|woff|woff2|ttf)$/.test(pathname)
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Statik varlıklar ve public yollar → geç
  if (isStaticAsset(pathname)) return NextResponse.next();
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const username = getSessionFromRequest(req);

  if (!username) {
    // API isteği → 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Yetkisiz — lütfen giriş yapın' }, { status: 401 });
    }
    // Sayfa isteği → login'e yönlendir
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Oturum geçerli — session yenile (sliding window)
  const res   = NextResponse.next();
  const fresh = createSessionToken(username);
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
  matcher: [
    /*
     * Şunları atla:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
