'use client';
import { useState, useEffect } from 'react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('crewinjob_theme');
    const isDark = stored !== 'light';
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('crewinjob_theme', next ? 'dark' : 'light');
  };

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all bg-white/10 hover:bg-white/20 text-white border border-white/20"
      title={dark ? 'Açık moda geç' : 'Koyu moda geç'}
    >
      {dark ? '☀️' : '🌙'}
      <span className="hidden sm:inline">{dark ? 'Açık' : 'Koyu'}</span>
    </button>
  );
}
