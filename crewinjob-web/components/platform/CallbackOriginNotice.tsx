'use client';
import { TriangleAlert } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';

// The provider sends the browser back to the registered callback; opened from another address the connection cannot
// finish, so the form is replaced by this notice with the address to use (and the setup guide for the team running it).
export default function CallbackOriginNotice({ lang, provider, callbackOrigin, setupHref }: { lang: Locale; provider: string; callbackOrigin: string; setupHref?: string }) {
  const tr = lang === 'tr', here = typeof window === 'undefined' ? '' : window.location.origin;
  const open = here && callbackOrigin ? `${callbackOrigin}${window.location.pathname}${window.location.search}` : '';
  return <p role="note" className="mt-2 flex items-start gap-2 text-sm text-amber-600 dark:text-amber-300"><TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span>
    {tr ? `${provider} dönüş adresi ${callbackOrigin} üzerinde kayıtlı, ama bu panel ${here} adresinden açık. Bu hâliyle bağlantı tamamlanmaz.` : `The ${provider} callback is registered on ${callbackOrigin}, but this panel is open from ${here}. The connection cannot finish like this.`}
    {open && <> <a href={open}>{tr ? 'Paneli kayıtlı adresten açın' : 'Open the panel from the registered address'}</a></>}
    {setupHref && <> · <a href={setupHref}>{tr ? 'Kurulum rehberi' : 'Setup guide'}</a></>}
  </span></p>;
}
