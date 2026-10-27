import type { Metadata, Viewport } from 'next';
import './globals.css';
import '@fontsource-variable/manrope';
import './product-design.css';
import './ryzevo-tokens.css';
import './ryzevo.css';
import './mobile-growth.css';
import './growth-compass.css';
import './growth-coach.css';
import './accessibility.css';
import { LangProvider } from '@/lib/lang';
import { requestLang } from '@/lib/i18n/server';
import { pick } from '@/lib/i18n/shared';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await requestLang();
  return {
    title: { default:'Ryzevo', template:'%s | Ryzevo' },
    description: pick(lang, 'Projenize özel içerik, kampanya ve büyüme çalışma alanı.', 'A growth workspace for your product: content, campaigns and growth work in one place.'),
    // Opened from the iPhone Home Screen as its own app (needed for web push there).
    appleWebApp: { capable: true, title: 'Ryzevo', statusBarStyle: 'black' },
  };
}
export const viewport: Viewport = { themeColor: '#161817' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await requestLang();
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var t = localStorage.getItem('crewinjob_theme');
              document.documentElement.classList.toggle('dark', t === 'dark');
            } catch(e) { document.documentElement.classList.remove('dark'); }
          })();
        `}} />
      </head>
      <body><LangProvider initial={lang}>{children}</LangProvider></body>
    </html>
  );
}
