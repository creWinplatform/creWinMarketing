import { cookies, headers } from 'next/headers';
import { LANG_COOKIE, isLang, langFromAcceptLanguage, type Lang } from './shared';

/** Sunucu bileşenleri için dil: açık seçim (?lang=) > çerez > Accept-Language > Türkçe. */
export async function requestLang(explicit?: string | string[] | null): Promise<Lang> {
  const query = Array.isArray(explicit) ? explicit[0] : explicit;
  if (isLang(query)) return query;
  const saved = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(saved)) return saved;
  return langFromAcceptLanguage((await headers()).get('accept-language'));
}
