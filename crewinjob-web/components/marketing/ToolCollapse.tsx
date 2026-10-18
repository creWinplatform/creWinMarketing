'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Brand from '@/components/platform/Brand';

// "Bir sürü sekme değil": dağınık araç sekmeleri görünüme girince tek bir Ryzevo çerçevesine çöker.
const TABS: Array<{ name: string; note: string; x: number; y: number; r: number; mx: number; my: number }> = [
  { name: 'Doküman aracı', note: 'taslaklar', x: -150, y: -120, r: -9, mx: -95, my: -110 },
  { name: 'Tablo', note: 'ölçümler', x: 140, y: -150, r: 7, mx: 90, my: -130 },
  { name: 'Planlayıcı', note: 'sosyal', x: -190, y: 40, r: 5, mx: -110, my: 10 },
  { name: 'E-posta aracı', note: 'gönderim', x: 170, y: 20, r: -6, mx: 100, my: 0 },
  { name: 'SEO aracı', note: 'bulgular', x: -60, y: 150, r: 8, mx: -50, my: 120 },
  { name: 'Görev listesi', note: 'kim, ne zaman', x: 120, y: 160, r: -4, mx: 80, my: 130 },
];

export default function ToolCollapse() {
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
        <div key={t.name} className="rm-tab" style={{ '--x': `${t.x}px`, '--y': `${t.y}px`, '--r': `${t.r}deg`, '--mx': `${t.mx}px`, '--my': `${t.my}px` } as CSSProperties}>{t.name}<i>{t.note}</i></div>
      ))}
      <div className="rm-frame">
        <div className="rm-frame-top"><span className="rm-brand-l"><Brand compact /></span><span className="rm-brand-d"><Brand compact inverse /></span><span>Northstar · tek çalışma alanı</span></div>
        <div className="rm-frame-mod"><span>Çalışma alanı</span><span>Hedefler</span><span>İçerik</span><span>Kampanyalar</span><span>Sosyal</span><span>E-posta</span><span>SEO</span><span>Takvim</span><span className="g">Ölçüm: hedefe bağlı, tarihli, kaynağı belli</span></div>
      </div>
    </div>
  );
}
