'use client';
import { useLang } from '@/lib/lang';
import { translateMessage } from '@/lib/i18n/messages';

/** Ekranda duran bir mesajı (hata, bildirim) o anki arayüz dilinde gösterir; dil değişince yeniden çevrilir. */
export default function Msg({ text }: { text: string | null | undefined }) {
  const { lang } = useLang();
  return <>{translateMessage(text, lang)}</>;
}
