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
