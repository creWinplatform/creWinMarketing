'use client';
import { useEffect } from 'react';

// The landing's mobile menu is a CSS checkbox toggle; a tap on one of its links must close it, or the page scrolls
// behind the open menu and nothing seems to happen.
export default function MobileMenuClose({ toggle, menu }: { toggle: string; menu: string }) {
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(`${menu} a`)) return;
      const input = document.getElementById(toggle);
      if (input instanceof HTMLInputElement) input.checked = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [toggle, menu]);
  return null;
}
