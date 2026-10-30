'use client';
// Copies text: the Clipboard API first; if the browser refuses (permission, embedded view), the older copy command; if
// that fails too, the target's text is selected on the page so Ctrl+C copies it. Returns whether the copy went through.
export async function copyText(value: string, target?: Element | null) {
  try { await navigator.clipboard.writeText(value); return true; } catch { /* fall back below */ }
  const area = document.createElement('textarea'); area.value = value; area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(area); area.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; } area.remove();
  if (!ok && target) { const range = document.createRange(); range.selectNodeContents(target); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
  return ok;
}
