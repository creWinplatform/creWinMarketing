import type { MetadataRoute } from 'next';

// Makes Ryzevo installable. On iPhone, web push only reaches a site added to the Home Screen as a standalone web app,
// which needs this manifest; Android and desktop browsers use it for the install prompt and the app icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Ryzevo',
    short_name: 'Ryzevo',
    description: 'Projenize özel içerik, kampanya ve büyüme çalışma alanı.',
    lang: 'tr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#161817',
    theme_color: '#161817',
    icons: [
      { src: '/brand/ryzevo-app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/ryzevo-app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/ryzevo-app-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
