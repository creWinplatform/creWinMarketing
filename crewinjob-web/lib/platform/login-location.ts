// Use only an exact operator-configured origin, never a client-supplied redirect host.
export function loginLocation(requestUrl: string, requestHost: string | null, configuredOrigin?: string): URL {
  const fallback = new URL('/login', requestUrl);
  if (!configuredOrigin) return fallback;
  try {
    const origin = new URL(configuredOrigin), request = new URL(requestUrl);
    const loopback = ['127.0.0.1', '127.0.0.2', 'localhost'].includes(origin.hostname);
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
      || !['https:', ...(loopback ? ['http:'] : [])].includes(origin.protocol)
      || origin.protocol !== request.protocol || origin.host !== requestHost?.toLowerCase()) return fallback;
    return new URL('/login', origin.origin);
  } catch { return fallback; }
}
