import type { Metadata } from 'next';
import { requestLang } from '@/lib/i18n/server';
import { pick } from '@/lib/i18n/shared';

export async function generateMetadata(): Promise<Metadata> {
  const lang = await requestLang();
  return { title: pick(lang, 'Giriş yap', 'Sign in'), robots:{index:false,follow:false} };
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
