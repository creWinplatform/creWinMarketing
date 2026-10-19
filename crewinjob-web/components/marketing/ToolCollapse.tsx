'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Brand from '@/components/platform/Brand';
import type { Lang } from '@/lib/i18n/shared';

// "Bir sürü sekme değil": dağınık araç sekmeleri görünüme girince tek bir Ryzevo çerçevesine çöker.
type L = { tr: string; en: string };
const TABS: Array<{ name: L; note: L; x: number; y: number; r: number; mx: number; my: number }> = [
  { name: { tr: 'Doküman aracı', en: 'Docs tool' }, note: { tr: 'taslaklar', en: 'drafts' }, x: -150, y: -120, r: -9, mx: -95, my: -110 },
  { name: { tr: 'Tablo', en: 'Spreadsheet' }, note: { tr: 'ölçümler', en: 'metrics' }, x: 140, y: -150, r: 7, mx: 90, my: -130 },
  { name: { tr: 'Planlayıcı', en: 'Scheduler' }, note: { tr: 'sosyal', en: 'social' }, x: -190, y: 40, r: 5, mx: -110, my: 10 },
  { name: { tr: 'E-posta aracı', en: 'Email tool' }, note: { tr: 'gönderim', en: 'sending' }, x: 170, y: 20, r: -6, mx: 100, my: 0 },
  { name: { tr: 'SEO aracı', en: 'SEO tool' }, note: { tr: 'bulgular', en: 'findings' }, x: -60, y: 150, r: 8, mx: -50, my: 120 },
  { name: { tr: 'Görev listesi', en: 'Task list' }, note: { tr: 'kim, ne zaman', en: 'who, when' }, x: 120, y: 160, r: -4, mx: 80, my: 130 },
];

const MODS: L[] = [
  { tr: 'Çalışma alanı', en: 'Workspace' }, { tr: 'Hedefler', en: 'Goals' }, { tr: 'İçerik', en: 'Content' }, { tr: 'Kampanyalar', en: 'Campaigns' },
  { tr: 'Sosyal', en: 'Social' }, { tr: 'E-posta', en: 'Email' }, { tr: 'SEO', en: 'SEO' }, { tr: 'Takvim', en: 'Calendar' },
];

export default function ToolCollapse({ lang = 'tr' }: { lang?: Lang }) {
  const ref = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setDone(true); return; }
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setDone(true); io.disconnect(); } }, { threshold: 0.55 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className={`rm-scene${done ? ' done' : ''}`} ref={ref} aria-hidden="true">
      {TABS.map(t => (
        <div key={t.name.tr} className="rm-tab" style={{ '--x': `${t.x}px`, '--y': `${t.y}px`, '--r': `${t.r}deg`, '--mx': `${t.mx}px`, '--my': `${t.my}px` } as CSSProperties}>{t.name[lang]}<i>{t.note[lang]}</i></div>
      ))}
      <div className="rm-frame">
        <div className="rm-frame-top"><span className="rm-brand-l"><Brand compact /></span><span className="rm-brand-d"><Brand compact inverse /></span><span>{lang === 'en' ? 'Northstar · one workspace' : 'Northstar · tek çalışma alanı'}</span></div>
        <div className="rm-frame-mod">{MODS.map(m => <span key={m.tr}>{m[lang]}</span>)}<span className="g">{lang === 'en' ? 'Measurement: goal-linked, dated, sourced' : 'Ölçüm: hedefe bağlı, tarihli, kaynağı belli'}</span></div>
      </div>
    </div>
  );
}
