import { NextRequest, NextResponse }                              from 'next/server';
import { verifySessionIdentity, createPlatformSessionToken, createSessionToken, COOKIE_NAME, SESSION_HOURS } from '@/lib/auth';
import { loginLocation } from '@/lib/platform/login-location';

// /api/track/* : e-posta alıcılarının tarayıcısı/mail istemcisi (açılma piksel'i + tıklama
// yönlendirmesi) ve AWS SNS webhook'u (bounce bildirimi) tarafından oturumsuz çağrılır —
// bunlar auth cookie'si taşıyamaz, /api/track/bounce ayrıca kendi SNS imza doğrulamasını yapar.
// /guide ve /legal/*: herkese açık kullanım rehberi ve satış sözleşmesi (ödeme öncesi okunabilmeli).
const PUBLIC_PATHS = ['/login', '/unsubscribe', '/guide', '/legal', '/api/health', '/api/auth/login', '/api/auth/logout', '/api/track/open', '/api/track/click', '/api/track/bounce', '/api/unsubscribe', '/api/campaigns/run-due', '/api/schedule/publish', '/api/platform/google/callback', '/api/platform/social/callback', '/api/platform/meta/callback'];

function isStaticAsset(pathname: string): boolean {
  if(pathname.startsWith('/api/')) return false;
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
  // Only this exact server-to-server route is cookie-free; it verifies its own HMAC.
  if (/^\/api\/platform\/product-events\/[a-f0-9]{32}$/.test(pathname)) return NextResponse.next();
  if (/^\/api\/platform\/mobile-hooks\/[a-f0-9]{32}$/.test(pathname)) return NextResponse.next();
  if (/^\/api\/platform\/email-feedback\/[a-f0-9]{32}$/.test(pathname)) return NextResponse.next();
  // Meta's WhatsApp webhook; the route verifies the app-secret signature (X-Hub-Signature-256) itself.
  if (/^\/api\/platform\/whatsapp\/hooks\/[a-f0-9]{32}$/.test(pathname)) return NextResponse.next();
  // Meta's Page/Instagram inbox webhook; the route verifies the app-secret signature (X-Hub-Signature-256) itself.
  if (pathname === '/api/platform/meta/hooks') return NextResponse.next();
  // Exact provider-only image route verifies its short-lived per-job HMAC itself.
  if (/^\/api\/platform\/publication-media\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(pathname)) return NextResponse.next();
  if (pathname === '/api/platform/x/callback') return NextResponse.next();
  // Exact PayTR notification route validates its provider HMAC and bound test order.
  if (pathname === '/api/platform/billing/paytr/notify') return NextResponse.next();
  if(['/recover','/register','/account/verify','/api/auth/identity'].includes(pathname))return NextResponse.next();
  if (['/welcome','/join','/api/auth/enroll','/api/platform/worker'].includes(pathname) || PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const identity = token ? await verifySessionIdentity(token) : null;
  const username = identity?.subject;

  if (!username) {
    // The bare address is the public landing for visitors; signed-in members get their workspace at the same URL.
    // Deep links into the workspace (/?tab=…) still go to sign-in.
    if (pathname === '/' && [...req.nextUrl.searchParams.keys()].every(key => key === 'lang')) {
      const landing = req.nextUrl.clone();
      landing.pathname = '/welcome';
      return NextResponse.rewrite(landing);
    }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Yetkisiz — lütfen giriş yapın' }, { status: 401 });
    }
    const loginUrl = loginLocation(req.url, req.headers.get('host'), process.env.PLATFORM_AUTH_ORIGIN);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Platform accounts must never fall through to the unscoped legacy Crewin APIs.
  if (identity?.mode === 'platform' && pathname.startsWith('/api/')
    && pathname !== '/api/workspace' && !pathname.startsWith('/api/platform/')
    && !['/api/campaigns', '/api/data/content-history', '/api/marketing/connections', '/api/marketing/automation'].includes(pathname)
    && !/^\/api\/campaigns\/cmp_[a-zA-Z0-9_]+$/.test(pathname)) {
    return NextResponse.json({ error: 'Bu araç için proje bağlantısı henüz yapılandırılmadı.' }, { status: 403 });
  }

  // Oturum geçerli — sliding window yenile
  const res   = NextResponse.next();
  const fresh = identity?.mode === 'platform' ? await createPlatformSessionToken(identity) : await createSessionToken(username);
  res.cookies.set(COOKIE_NAME, fresh, {
    httpOnly: true,
    // 'lax': OAuth sağlayıcısından dönüşteki (cross-site top-level GET) callback isteğinde cookie gelir;
    // POST/fetch istekleri cross-site'ta yine cookie taşımaz (CSRF koruması korunur).
    sameSite: 'lax',
    path:     '/',
    maxAge:   SESSION_HOURS * 60 * 60,
    secure:   req.nextUrl.protocol === 'https:',
  });
  return res;
}

export const config = {
  // Already-public auth handlers own CSRF/body deadlines. Middleware buffering
  // would otherwise wait for the entire body before those deadlines can start.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth/(?:login|enroll|identity)/?$).*)'],
};
