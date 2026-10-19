'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';
import { LANG_COOKIE, LEGACY_LANG_KEY, isLang, type Lang } from '@/lib/i18n/shared';

export type { Lang };

interface LangCtx { lang: Lang; setLang: (l: Lang) => void; }
const LangContext = createContext<LangCtx>({ lang: 'tr', setLang: () => {} });

// Seçim çereze (sunucu ilk yüklemede doğru dili basar) ve eski localStorage anahtarına yazılır.
function persist(lang: Lang) {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {}
  try { localStorage.setItem(LEGACY_LANG_KEY, lang); } catch {}
}

export function LangProvider({ children, initial = 'tr' }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const router = useRouter();

  useEffect(() => {
    // Paylaşılan bağlantıdaki ?lang= seçimi kalıcı olur; çerez yoksa eski kayıt taşınır.
    let next: Lang | null = null;
    try { const query = new URLSearchParams(window.location.search).get('lang'); if (isLang(query)) next = query; } catch {}
    if (!next && !document.cookie.split('; ').some(part => part.startsWith(`${LANG_COOKIE}=`))) {
      try { const saved = localStorage.getItem(LEGACY_LANG_KEY); if (isLang(saved)) next = saved; } catch {}
    }
    if (!next) return;
    persist(next);
    if (next !== initial) { setLangState(next); router.refresh(); }
    // Yalnızca ilk yüklemede çalışır.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    persist(l);
    // Sunucu bileşenleri (landing, sayfa başlıkları) yeni dille yeniden çizilir. Adreste ?lang= varsa
    // sunucu onu çerezden önce okur; bu yüzden parametre de güncellenir.
    const url = new URL(window.location.href);
    if (url.searchParams.has('lang')) { url.searchParams.set('lang', l); router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false }); }
    else router.refresh();
  }, [router]);

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang(): LangCtx { return useContext(LangContext); }

/** t('Türkçe', 'English') — bileşen içi kısa çeviri. */
export function useT() {
  const { lang } = useLang();
  return useCallback((tr: string, en: string) => (lang === 'en' ? en : tr), [lang]);
}

/** TR/EN toggle butonu */
export function LangToggle({ className = 'studio-secondary flex items-center gap-1 text-xs px-2 py-1.5' }: { className?: string }) {
  const { lang, setLang } = useLang();
  const label = lang === 'tr' ? 'Switch to English' : "Türkçe'ye geç";
  return (
    <button
      onClick={() => setLang(lang === 'tr' ? 'en' : 'tr')}
      type="button"
      className={className}
      title={label}
      aria-label={label}
      lang={lang === 'tr' ? 'en' : 'tr'}
    >
      <Languages size={15} aria-hidden="true" />{lang === 'tr' ? 'EN' : 'TR'}
    </button>
  );
}
