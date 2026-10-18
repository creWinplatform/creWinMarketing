'use client';
import { useState } from 'react';
import { LayoutDashboard, Megaphone, ChartNoAxesCombined, ArrowUpRight } from 'lucide-react';

const views = [
  { id: 'overview', label: 'Çalışma merkezi', Icon: LayoutDashboard, description: 'Öncelikler, proje hedefleri ve sıradaki işler.', image: 'overview' },
  { id: 'campaigns', label: 'Kampanyalar', Icon: Megaphone, description: 'Hedefe bağlı, düzenlenebilir kampanya taslakları.', image: 'campaigns' },
  { id: 'reports', label: 'Ölçüm & raporlar', Icon: ChartNoAxesCombined, description: 'Tarihi ve kaynağı belli ölçümler. Uydurulmuş sonuçlar değil.', image: 'reports' },
];
export default function ProductShowcase() {
  const [active, setActive] = useState('overview');
  const view = views.find(item => item.id === active)!;
  return (
    <div className="launch-showcase">
      <div className="launch-showcase-toolbar">
        <div role="tablist" aria-label="Ürün ekranları">
          {views.map((item,index) => <button key={item.id} id={`showcase-${item.id}`} role="tab" tabIndex={item.id === active ? 0 : -1} aria-selected={item.id === active} aria-controls="product-screen" onClick={() => setActive(item.id)} onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? (index+1)%views.length : event.key === 'ArrowLeft' ? (index+views.length-1)%views.length : event.key === 'Home' ? 0 : event.key === 'End' ? views.length-1 : null;
            if (next !== null) { event.preventDefault(); setActive(views[next].id); document.getElementById(`showcase-${views[next].id}`)?.focus(); }
          }}><item.Icon size={17} />{item.label}</button>)}
        </div>
        <a href="/login">Panele geç <ArrowUpRight size={16} /></a>
      </div>
      <div id="product-screen" role="tabpanel" aria-labelledby={`showcase-${active}`}>
        <picture key={active}>
          <source media="(max-width:639px)" srcSet={`/images/product-${view.image}-mobile-v2.webp`} />
          <img src={`/images/product-${view.image}-v2.webp`} alt={`Crewin Marketing ${view.label} ekranı, örnek proje verileri`} width={1440} height={900} loading="lazy" />
        </picture>
        <div className="launch-screen-caption"><span>{view.description}</span><span>Örnek proje verileri</span></div>
      </div>
    </div>
  );
}
