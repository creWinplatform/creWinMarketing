'use client';
import { useState } from 'react';
import { LayoutDashboard, Megaphone, ChartNoAxesCombined, ArrowUpRight } from 'lucide-react';
import { useLang } from '@/lib/lang';

const views = [
  { id: 'overview', label: ['Çalışma merkezi', 'Workspace overview'], Icon: LayoutDashboard, description: ['Öncelikler, proje hedefleri ve sıradaki işler.', 'Priorities, project goals and next tasks.'], image: 'overview' },
  { id: 'campaigns', label: ['Kampanyalar', 'Campaigns'], Icon: Megaphone, description: ['Hedefe bağlı, düzenlenebilir kampanya taslakları.', 'Editable campaign drafts tied to a goal.'], image: 'campaigns' },
  { id: 'reports', label: ['Ölçüm & raporlar', 'Measurement & reports'], Icon: ChartNoAxesCombined, description: ['Tarihi ve kaynağı belli ölçümler. Uydurulmuş sonuçlar değil.', 'Measurements with a known date and source. No invented results.'], image: 'reports' },
];
export default function ProductShowcase() {
  const { lang } = useLang();
  const idx = lang === 'en' ? 1 : 0;
  const [active, setActive] = useState('overview');
  const view = views.find(item => item.id === active)!;
  return (
    <div className="launch-showcase">
      <div className="launch-showcase-toolbar">
        <div role="tablist" aria-label={idx ? 'Product screens' : 'Ürün ekranları'}>
          {views.map((item,index) => <button key={item.id} id={`showcase-${item.id}`} role="tab" tabIndex={item.id === active ? 0 : -1} aria-selected={item.id === active} aria-controls="product-screen" onClick={() => setActive(item.id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index+1)%views.length : event.key === 'ArrowLeft' ? (index+views.length-1)%views.length : event.key === 'Home' ? 0 : event.key === 'End' ? views.length-1 : null;
            if (next !== null) { event.preventDefault(); setActive(views[next].id); document.getElementById(`showcase-${views[next].id}`)?.focus(); }
          }}><item.Icon size={17} />{item.label[idx]}</button>)}
        </div>
        <a href="/login">{idx ? 'Go to workspace' : 'Panele geç'} <ArrowUpRight size={16} /></a>
      </div>
      <div id="product-screen" role="tabpanel" aria-labelledby={`showcase-${active}`}>
        <picture key={active}>
          <source media="(max-width:639px)" srcSet={`/images/product-${view.image}-mobile-v2.webp`} />
          <img src={`/images/product-${view.image}-v2.webp`} alt={idx ? `Ryzevo ${view.label[1]} screen, sample project data` : `Ryzevo ${view.label[0]} ekranı, örnek proje verileri`} width={1440} height={900} loading="lazy" />
        </picture>
        <div className="launch-screen-caption"><span>{view.description[idx]}</span><span>{idx ? 'Sample project data' : 'Örnek proje verileri'}</span></div>
      </div>
    </div>
  );
}
