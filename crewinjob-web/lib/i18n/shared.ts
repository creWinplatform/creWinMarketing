// Ryzevo arayüz dili: Türkçe (varsayılan) ve İngilizce. Hem sunucu hem istemci kullanır.
// Terminoloji ve yazım kuralları: docs/RYZEVO-I18N.md

export type Lang = 'tr' | 'en';
export const LANGS: readonly Lang[] = ['tr', 'en'];
export const DEFAULT_LANG: Lang = 'tr';
/** Sunucunun okuduğu tercih (sayfa ilk yüklemede doğru dille gelir). */
export const LANG_COOKIE = 'ryzevo_lang';
/** Eski istemci anahtarı; mevcut kullanıcıların seçimini taşımak için okunur ve güncel tutulur. */
export const LEGACY_LANG_KEY = 'crewinjob_lang';

export const isLang = (value: unknown): value is Lang => value === 'tr' || value === 'en';

/** Tarih ve sayı biçimleri için BCP 47 etiketi. */
export const localeTag = (lang: Lang) => (lang === 'en' ? 'en-GB' : 'tr-TR');

/** Kısa çeviri yardımcısı: pick(lang, 'Türkçe', 'English'). */
export const pick = <T,>(lang: Lang, tr: T, en: T): T => (lang === 'en' ? en : tr);

/**
 * Accept-Language başlığından tercih. Türkçe, İngilizceden önce ya da eşit öncelikte geliyorsa Türkçe;
 * başlık var ama Türkçe istenmiyorsa İngilizce; başlık yoksa varsayılan (Türkçe).
 */
export function langFromAcceptLanguage(header: string | null | undefined): Lang {
  if (!header) return DEFAULT_LANG;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { base: tag.split('-')[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter(item => item.base && item.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  if (!ranked.length) return DEFAULT_LANG;
  const tr = ranked.findIndex(item => item.base === 'tr');
  const en = ranked.findIndex(item => item.base === 'en');
  if (tr === -1) return 'en';
  if (en === -1) return 'tr';
  return tr <= en ? 'tr' : 'en';
}
