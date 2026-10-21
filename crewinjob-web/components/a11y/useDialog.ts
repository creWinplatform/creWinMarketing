'use client';
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';

const FOCUSABLE = 'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),iframe,[contenteditable=true],[tabindex]:not([tabindex="-1"])';

// Accessible modal dialog (WAI-ARIA dialog pattern): focus moves into the dialog when it opens, Tab stays inside,
// Escape closes it and focus returns to the element that opened it. Spread `dialogProps` on the dialog panel and put
// `titleId` on its heading.
export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null), titleId = useId(), close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = ref.current;
    (panel?.querySelector<HTMLElement>('[data-autofocus]') || panel?.querySelector<HTMLElement>(FOCUSABLE) || panel)?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [open]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); close.current(); return; }
    if (event.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(item => item.offsetParent !== null || item === document.activeElement);
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return { titleId, dialogProps: { ref, role: 'dialog' as const, 'aria-modal': true as const, 'aria-labelledby': titleId, tabIndex: -1, onKeyDown } };
}
