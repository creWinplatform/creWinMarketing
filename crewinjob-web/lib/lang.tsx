'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Languages } from 'lucide-react';

export type Lang = 'tr' | 'en';
const LANG_KEY = 'crewinjob_lang';

interface LangCtx { lang: Lang; setLang: (l: Lang) => void; }
const LangContext = createContext<LangCtx>({ lang: 'tr', setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('tr');

  useEffect(() => {
    try { const saved = localStorage.getItem(LANG_KEY); if (saved==='tr' || saved==='en') setLangState(saved); } catch {}
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch {}
  };

  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang(): LangCtx { return useContext(LangContext); }

/** TR/EN toggle butonu */
export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <button
      onClick={() => setLang(lang === 'tr' ? 'en' : 'tr')}
      type="button"
      className="studio-secondary flex items-center gap-1 text-xs px-2 py-1.5"
      title={lang === 'tr' ? 'Switch to English' : "Türkçe'ye geç"}
    >
      <Languages size={15}/>{lang === 'tr' ? 'EN' : 'TR'}
    </button>
  );
}
