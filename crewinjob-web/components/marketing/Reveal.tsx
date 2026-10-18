'use client';
import { useEffect } from 'react';

// [data-reveal] öğeleri görünüme girince yumuşakça belirir. JS yoksa veya hareket azaltma açıksa
// hiçbir şey gizlenmez: öğeler dinlenme hâlinde tam görünürdür (CSS yalnızca .rm-reveal-armed altında başlangıç durumu verir).
export default function Reveal() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.visibilityState !== 'visible') return;
    const root = document.querySelector('.ryz-map');
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!root || items.length === 0) return;
    root.classList.add('rm-reveal-armed');
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
    items.forEach(el => io.observe(el));
    return () => { io.disconnect(); root.classList.remove('rm-reveal-armed'); };
  }, []);
  return null;
}
