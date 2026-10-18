'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

export default function GrowthExperience() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<{ select: (index:number) => void; pause: (value:boolean) => void; dispose: () => void } | null>(null);
  const controls = useRef({ paused:false, selected:0 });
  const [selected, setSelected] = useState(0), [paused, setPaused] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPaused(reduced.matches);
    controls.current.paused = reduced.matches;
    import('./growth-scene').then(async ({ createGrowthScene }) => {
      await document.fonts.ready;
      if (disposed || !host.current) return;
      scene.current = createGrowthScene(host.current, controls.current.paused, index => { controls.current.selected = index; setSelected(index); });
      scene.current.select(controls.current.selected);
    }).catch(() => { if (!disposed) setFailed(true); });
    const motion = () => { controls.current.paused = reduced.matches; setPaused(reduced.matches); scene.current?.pause(reduced.matches); };
    reduced.addEventListener('change', motion);
    return () => { disposed = true; reduced.removeEventListener('change', motion); scene.current?.dispose(); scene.current = null; };
  }, []);
  return <div className="ryz-experience">
    <div className="ryz-scene-host" ref={host} aria-hidden="true" />
    {failed && <div className="ryz-scene-fallback" aria-hidden="true"><img src="/brand/ryzevo-brand-board.png" alt="" /></div>}
    <div className="ryz-scene-controls" aria-label="Büyüme aşamaları">
      <div role="group" aria-label="Aşama seçimi">{['Araştır', 'Üret', 'Büyüt'].map((label,index) => <button key={label} aria-pressed={selected===index} onClick={() => { controls.current.selected = index; setSelected(index); scene.current?.select(index); }}><span>0{index+1}</span>{label}</button>)}</div>
      <button className="ryz-scene-pause" title={paused ? 'Animasyonu başlat' : 'Animasyonu duraklat'} aria-label={paused ? 'Animasyonu başlat' : 'Animasyonu duraklat'} aria-pressed={paused} onClick={() => { controls.current.paused = !paused; setPaused(!paused); scene.current?.pause(!paused); }}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>
    </div>
  </div>;
}
