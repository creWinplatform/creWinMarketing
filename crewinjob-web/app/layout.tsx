import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { LangProvider } from '@/lib/lang';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'crewinjob Marketing Agent',
  description: 'AI-powered maritime marketing content generator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var t = localStorage.getItem('crewinjob_theme');
              if (t === 'light') { document.documentElement.classList.remove('dark'); }
              else { document.documentElement.classList.add('dark'); }
            } catch(e) { document.documentElement.classList.add('dark'); }
          })();
        `}} />
      </head>
      <body className={inter.className}><LangProvider>{children}</LangProvider></body>
    </html>
  );
}
