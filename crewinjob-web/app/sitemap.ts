import type { MetadataRoute } from 'next';
import { privacyReady, salesTermsReady } from '@/lib/platform/sales-terms';

// Public pages in both languages; the legal texts join once they are filled in and reviewed.
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = process.env.PLATFORM_PUBLIC_ORIGIN || 'https://ryzevo.com';
  const pages = ['/', '/guide', ...(salesTermsReady() ? ['/legal/sales'] : []), ...(privacyReady() ? ['/legal/privacy'] : [])];
  return pages.map(page => ({
    url: `${origin}${page}`,
    changeFrequency: 'weekly' as const,
    alternates: { languages: { tr: `${origin}${page}?lang=tr`, en: `${origin}${page}?lang=en` } },
  }));
}
