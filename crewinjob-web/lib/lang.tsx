'use client';
import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type Lang = 'tr' | 'en';
const LANG_KEY = 'crewinjob_lang';

interface LangCtx { lang: Lang; setLang: (l: Lang) => void; }
const LangContext = createContext<LangCtx>({ lang: 'tr', setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('tr');

  useEffect(() => {
    try { const saved = localStorage.getItem(LANG_KEY) as Lang; if (saved) setLangState(saved); } catch {}
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
      className="flex items-center gap-1 text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1.5 rounded-lg transition-colors font-medium"
      title={lang === 'tr' ? 'Switch to English' : "Türkçe'ye geç"}
    >
      {lang === 'tr' ? '🇬🇧 EN' : '🇹🇷 TR'}
    </button>
  );
}
