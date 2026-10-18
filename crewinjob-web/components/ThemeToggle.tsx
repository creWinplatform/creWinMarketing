'use client';
import { useState, useEffect } from 'react';
import { useLang } from '@/lib/lang';
import { Sun,Moon } from 'lucide-react';

export default function ThemeToggle() {
  const { lang } = useLang();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    let stored:string|null=null;
    try{stored=localStorage.getItem('crewinjob_theme');}catch{}
    const isDark = stored === 'dark';
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try{localStorage.setItem('crewinjob_theme', next ? 'dark' : 'light');}catch{}
  };

  return (
    <button
      onClick={toggle}
      type="button"
      className="icon-button"
      aria-label={dark ? (lang === 'tr' ? 'Açık moda geç' : 'Switch to Light') : (lang === 'tr' ? 'Koyu moda geç' : 'Switch to Dark')}
      title={dark ? (lang === 'tr' ? 'Açık moda geç' : 'Switch to Light') : (lang === 'tr' ? 'Koyu moda geç' : 'Switch to Dark')}
    >
      {dark ? <Sun size={18}/> : <Moon size={18}/>}
    </button>
  );
}
