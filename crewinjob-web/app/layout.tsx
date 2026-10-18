import type { Metadata } from 'next';
import './globals.css';
import '@fontsource-variable/manrope';
import './product-design.css';
import './ryzevo-tokens.css';
import './ryzevo.css';
import './mobile-growth.css';
import './growth-compass.css';
import './accessibility.css';
import { LangProvider } from '@/lib/lang';

export const metadata: Metadata = {
  title: { default:'Ryzevo', template:'%s | Ryzevo' },
  description: 'Projenize özel içerik, kampanya ve büyüme çalışma alanı.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
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
      <body><LangProvider>{children}</LangProvider></body>
    </html>
  );
}
