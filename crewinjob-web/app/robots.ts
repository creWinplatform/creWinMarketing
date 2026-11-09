import type { MetadataRoute } from 'next';

// Only the public pages are for search engines; the workspace and APIs are not. The legal texts carry their own
// noindex while they are drafts.
export default function robots(): MetadataRoute.Robots {
  const origin = process.env.PLATFORM_PUBLIC_ORIGIN || 'https://ryzevo.com';
  return {
    rules: [{ userAgent: '*', allow: ['/', '/welcome', '/guide'], disallow: ['/api/', '/login', '/register', '/recover', '/join', '/account', '/portfolio', '/report', '/unsubscribe'] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
