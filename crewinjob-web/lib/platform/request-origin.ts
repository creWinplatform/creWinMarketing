import type { NextRequest } from 'next/server';

export function hasSameRequestOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    // Next's internal URL may use localhost even when the browser uses 127.0.0.1.
    return parsed.host === request.headers.get('host') && parsed.protocol === request.nextUrl.protocol;
  } catch { return false; }
}

// The address the browser opened this panel from (behind a proxy, the forwarded host and scheme). OAuth providers send the
// browser back to the registered callback, so it has to sit on this same address.
export function panelOrigin(request: NextRequest): string {
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host).split(',')[0].trim();
  const proto = (request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '')).split(',')[0].trim();
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}
// Whether a configured callback address sits on this panel's address.
export function callbackOnPanel(request: NextRequest, callback: string): { callbackOrigin: string; originOk: boolean } {
  const callbackOrigin = (() => { try { return new URL(callback).origin; } catch { return ''; } })();
  return { callbackOrigin, originOk: Boolean(callbackOrigin) && callbackOrigin === panelOrigin(request) };
}
