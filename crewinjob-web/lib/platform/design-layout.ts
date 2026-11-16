// Design studio layout: turns a template, its text and the brand kit into drawing operations for one canvas size.
// Pure (no DOM): the browser renderer measures text with canvas and draws the operations; tests use an estimate.
// Every size gets a layout for its shape — strip (728×90), wide (16:9, covers), square (1:1, 4:5) or tall (9:16, 160×600)
// — so one design can be exported to every ad placement without text running off the canvas.
import { FONT_STACKS, contrast, inkOn, type BrandKitInput } from './brand-kit-types';

export type DesignTemplate = 'announce' | 'quote' | 'tips' | 'stat' | 'photo' | 'event' | 'avatar' | 'cover' | 'highlight';
export type DesignTheme = 'primary' | 'light' | 'dark' | 'accent';
export type DesignContent = { headline: string; body: string; items: string[]; stat: string; statLabel: string; cta: string; date: string; author: string };
export type DesignOptions = {
  template: DesignTemplate; w: number; h: number; kit: BrandKitInput; hasLogo: boolean; hasPhoto: boolean; theme: DesignTheme;
  slide?: { index: number; total: number }; safe?: { x: number; y: number; w: number; h: number };
};
export type DrawOp =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string; radius?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; color: string }
  | { kind: 'photo'; x: number; y: number; w: number; h: number }
  | { kind: 'shade'; x: number; y: number; w: number; h: number; color: string; from: number; to: number }
  | { kind: 'logo'; x: number; y: number; w: number; h: number; align: 'left' | 'center' | 'right' }
  | { kind: 'text'; x: number; y: number; w: number; lines: string[]; size: number; lineHeight: number; weight: number; color: string; align: 'left' | 'center' | 'right'; font: string };
export type Measure = (text: string, font: string) => number;
export const EMPTY_CONTENT: DesignContent = { headline: '', body: '', items: [], stat: '', statLabel: '', cta: '', date: '', author: '' };
// Rough width for tests and server-side checks: average glyph about 0.56 em.
export const estimateMeasure: Measure = (text, font) => text.length * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || 16) * 0.56;

const fontOf = (weight: number, size: number, family: string) => `${weight} ${Math.round(size * 10) / 10}px ${family}`;
export function rgba(hex: string, alpha: number) { return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`; }

// Greedy word wrap; a word longer than the line is split by characters.
export function wrap(text: string, maxWidth: number, font: string, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, font) <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      if (measure(word, font) <= maxWidth) { line = word; continue; }
      let part = '';
      for (const char of word) { if (measure(part + char, font) > maxWidth && part) { lines.push(part); part = char; } else part += char; }
      line = part;
    }
    lines.push(line);
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines;
}
// Largest size (between min and max) at which the text fits the box in at most maxLines; at the minimum size the last
// line is cut with an ellipsis instead of overflowing.
export function fit(text: string, box: { w: number; h: number }, opts: { max: number; min: number; weight: number; family: string; lineHeight?: number; maxLines?: number }, measure: Measure) {
  const ratio = opts.lineHeight ?? 1.15, maxLines = opts.maxLines ?? 12;
  if (!text.trim() || box.w <= 0 || box.h <= 0) return { size: opts.min, lines: [] as string[], height: 0 };
  for (let size = Math.max(opts.max, opts.min); size >= opts.min; size = size > opts.min && size * 0.94 < opts.min ? opts.min : size * 0.94) {
    const font = fontOf(opts.weight, size, opts.family), lines = wrap(text, box.w, font, measure);
    // A word broken in the middle ("Hakkı / mızda") is a last resort: first try smaller sizes that keep every word whole.
    const broken = text.split(/\s+/).some(word => word && measure(word, font) > box.w);
    if (!broken && lines.length <= maxLines && lines.length * size * ratio <= box.h + 0.5) return { size, lines, height: lines.length * size * ratio };
    if (size === opts.min) break;
  }
  // Even the smallest size cannot keep every word whole: take the largest size that fits with broken words.
  for (let size = Math.max(opts.max, opts.min); size > opts.min; size *= 0.94) {
    const font = fontOf(opts.weight, size, opts.family), lines = wrap(text, box.w, font, measure);
    if (lines.length <= maxLines && lines.length * size * ratio <= box.h + 0.5 && text.split(/\s+/).some(word => word && measure(word, fontOf(opts.weight, opts.min, opts.family)) > box.w)) return { size, lines, height: lines.length * size * ratio };
  }
  const size = opts.min, font = fontOf(opts.weight, size, opts.family), all = wrap(text, box.w, font, measure);
  const room = Math.max(1, Math.min(maxLines, Math.floor((box.h + 0.5) / (size * ratio)))), lines = all.slice(0, room);
  if (all.length > room) { let last = lines[room - 1]; while (last && measure(last + '…', font) > box.w) last = last.slice(0, -1).trimEnd(); lines[room - 1] = last + '…'; }
  return { size, lines, height: lines.length * size * ratio };
}

export function shapeOf(w: number, h: number): 'strip' | 'wide' | 'square' | 'tall' {
  const r = w / h;
  return r >= 3.2 ? 'strip' : r >= 1.3 ? 'wide' : r > 0.75 ? 'square' : 'tall';
}
function palette(kit: BrandKitInput, theme: DesignTheme, hasPhoto: boolean) {
  const c = kit.colors, bg = hasPhoto ? c.dark : theme === 'light' ? c.light : theme === 'dark' ? c.dark : theme === 'accent' ? c.accent : c.primary;
  const ink = hasPhoto ? c.light : inkOn(bg, c);
  // The accent is used for marks only when it stands out from the background; otherwise marks take the text colour.
  const mark = theme === 'accent' ? (contrast(c.primary, bg) >= 2 ? c.primary : ink) : contrast(c.accent, bg) >= 1.8 ? c.accent : ink;
  return { bg, ink, mark, muted: rgba(ink.startsWith('#') ? ink : '#000000', 0.78), onMark: inkOn(mark, c) };
}

export function layoutDesign(content: DesignContent, o: DesignOptions, measure: Measure = estimateMeasure): DrawOp[] {
  const { w, h, kit } = o, family = FONT_STACKS[kit.font], photoMode = o.template === 'photo' && o.hasPhoto, p = palette(kit, o.theme, photoMode), shape = shapeOf(w, h);
  const ops: DrawOp[] = [{ kind: 'rect', x: 0, y: 0, w, h, color: p.bg }];
  const text = (value: string, x: number, y: number, box: { w: number; h: number }, opt: { max: number; min: number; weight: number; color: string; align?: 'left' | 'center' | 'right'; lineHeight?: number; maxLines?: number; valign?: 'top' | 'middle' | 'bottom' }) => {
    const f = fit(value, box, { ...opt, family }, measure);
    if (!f.lines.length) return 0;
    const top = opt.valign === 'middle' ? y + (box.h - f.height) / 2 : opt.valign === 'bottom' ? y + box.h - f.height : y;
    ops.push({ kind: 'text', x, y: top, w: box.w, lines: f.lines, size: f.size, lineHeight: f.size * (opt.lineHeight ?? 1.15), weight: opt.weight, color: opt.color, align: opt.align || 'left', font: family });
    return f.height;
  };
  const pill = (label: string, x: number, y: number, maxW: number, height: number, align: 'left' | 'center' | 'right' = 'left') => {
    if (!label.trim()) return 0;
    const size = height * 0.42, font = fontOf(700, size, family), labelW = Math.min(maxW - height * 0.8, measure(label, font)), pw = labelW + height * 0.8;
    const px = align === 'center' ? x + (maxW - pw) / 2 : align === 'right' ? x + maxW - pw : x;
    ops.push({ kind: 'rect', x: px, y, w: pw, h: height, color: p.mark, radius: height / 2 });
    text(label, px + height * 0.4, y, { w: labelW + 1, h: height }, { max: size, min: size * 0.7, weight: 700, color: p.onMark, maxLines: 1, valign: 'middle', lineHeight: 1 });
    return height;
  };
  // Footer: logo (or the handle) on one side, slide counter on the other.
  const footer = (x: number, y: number, fw: number, fh: number, align: 'left' | 'center' = 'left') => {
    let used = 0;
    if (o.hasLogo) { ops.push({ kind: 'logo', x, y, w: Math.min(fw * 0.4, fh * 4), h: fh, align }); used = Math.min(fw * 0.4, fh * 4) + fh * 0.4; }
    if (kit.handle) text(kit.handle, align === 'center' && !o.hasLogo ? x : x + used, y, { w: align === 'center' && !o.hasLogo ? fw : fw * 0.55 - used, h: fh }, { max: fh * 0.5, min: fh * 0.3, weight: 600, color: p.muted, maxLines: 1, valign: 'middle', align: align === 'center' && !o.hasLogo ? 'center' : 'left' });
    if (o.slide && o.slide.total > 1) text(`${o.slide.index + 1}/${o.slide.total}`, x + fw * 0.6, y, { w: fw * 0.4, h: fh }, { max: fh * 0.45, min: fh * 0.3, weight: 700, color: p.muted, align: 'right', maxLines: 1, valign: 'middle' });
  };
  const c = content;

  // Profile pictures, covers and highlight covers.
  if (o.template === 'avatar') {
    if (o.hasLogo) ops.push({ kind: 'logo', x: w * 0.18, y: h * 0.18, w: w * 0.64, h: h * 0.64, align: 'center' });
    else text(initials(kit.handle || c.headline), w * 0.1, h * 0.1, { w: w * 0.8, h: h * 0.8 }, { max: h * 0.45, min: h * 0.15, weight: 800, color: p.ink, align: 'center', maxLines: 1, valign: 'middle', lineHeight: 1 });
    return ops;
  }
  if (o.template === 'highlight') {
    const r = w * 0.3;
    ops.push({ kind: 'circle', cx: w / 2, cy: h / 2, r, color: p.mark });
    text(c.headline || '★', w / 2 - r * 0.72, h / 2 - r * 0.72, { w: r * 1.44, h: r * 1.44 }, { max: r * 0.75, min: r * 0.2, weight: 800, color: p.onMark, align: 'center', maxLines: 2, valign: 'middle', lineHeight: 1.05 });
    return ops;
  }
  if (o.template === 'cover') {
    const s = o.safe || { x: w * 0.08, y: h * 0.12, w: w * 0.84, h: h * 0.76 };
    ops.push({ kind: 'rect', x: 0, y: h - Math.max(4, h * 0.04), w, h: Math.max(4, h * 0.04), color: p.mark });
    const logoW = o.hasLogo ? Math.min(s.w * 0.3, s.h * 2.2) : 0;
    if (o.hasLogo) ops.push({ kind: 'logo', x: s.x, y: s.y + s.h * 0.15, w: logoW, h: s.h * 0.7, align: 'left' });
    const tx = s.x + (logoW ? logoW + s.w * 0.05 : 0), tw = s.w - (tx - s.x);
    text(c.headline || kit.tagline, tx, s.y, { w: tw, h: s.h * (c.body ? 0.62 : 1) }, { max: s.h * 0.34, min: s.h * 0.12, weight: 800, color: p.ink, maxLines: 2, valign: c.body ? 'bottom' : 'middle', lineHeight: 1.08 });
    if (c.body) text(c.body, tx, s.y + s.h * 0.66, { w: tw, h: s.h * 0.34 }, { max: s.h * 0.16, min: s.h * 0.08, weight: 500, color: p.muted, maxLines: 2 });
    return ops;
  }

  if (photoMode) ops.push({ kind: 'photo', x: 0, y: 0, w, h }, { kind: 'shade', x: 0, y: shape === 'strip' || shape === 'wide' ? 0 : h * 0.3, w, h: shape === 'strip' || shape === 'wide' ? h : h * 0.7, color: kit.colors.dark, from: shape === 'strip' || shape === 'wide' ? 0.45 : 0, to: 0.86 });

  // Strip banners (728×90, 320×50, 970×250…): logo · headline · button in one row.
  if (shape === 'strip') {
    const pad = h * 0.14, logoW = o.hasLogo ? Math.min(h * 2.4, w * 0.18) : 0, ctaW = c.cta && w >= h * 5 ? Math.min(w * 0.24, h * 2.6) : 0;
    if (o.hasLogo) ops.push({ kind: 'logo', x: pad, y: pad, w: logoW, h: h - pad * 2, align: 'left' });
    const tx = pad + (logoW ? logoW + pad : 0), tw = w - tx - pad - (ctaW ? ctaW + pad : 0), lead = c.headline || c.stat || c.body;
    const tall = h >= 120;
    text(lead, tx, pad, { w: tw, h: (h - pad * 2) * (tall && c.body && c.headline ? 0.6 : 1) }, { max: h * (tall ? 0.24 : 0.4), min: Math.max(9, h * 0.16), weight: 800, color: p.ink, maxLines: 2, valign: tall && c.body && c.headline ? 'bottom' : 'middle', lineHeight: 1.05 });
    if (tall && c.body && c.headline) text(c.body, tx, pad + (h - pad * 2) * 0.64, { w: tw, h: (h - pad * 2) * 0.36 }, { max: h * 0.12, min: Math.max(9, h * 0.07), weight: 500, color: p.muted, maxLines: 2 });
    if (ctaW) pill(c.cta, w - pad - ctaW, h / 2 - Math.min(h * 0.5, 64) / 2, ctaW, Math.min(h * 0.5, 64), 'right');
    return ops;
  }

  const u = Math.min(w, h), pad = u * (shape === 'tall' && w < 400 ? 0.09 : 0.075), footH = Math.max(14, u * 0.07);
  // Wide (16:9, 1.91:1): text on the left, a mark (logo, number or date) on the right.
  if (shape === 'wide') {
    const colW = (w - pad * 3) * 0.6, rightX = pad * 2 + colW, rightW = w - rightX - pad, innerH = h - pad * 2 - footH - pad * 0.5;
    let y = pad;
    if (o.template === 'announce' || o.template === 'event' || o.template === 'photo') ops.push({ kind: 'rect', x: pad, y, w: u * 0.1, h: Math.max(3, u * 0.014), color: p.mark }), y += u * 0.05;
    if (o.template === 'quote') { text('“', pad, y - u * 0.04, { w: u * 0.3, h: u * 0.22 }, { max: u * 0.3, min: u * 0.1, weight: 800, color: p.mark, maxLines: 1, lineHeight: 1 }); y += u * 0.16; }
    const lead = o.template === 'quote' ? c.body || c.headline : c.headline;
    const leadH = text(lead, pad, y, { w: colW, h: innerH * (c.body && o.template !== 'quote' ? 0.58 : 0.8) - (y - pad) }, { max: u * 0.13, min: u * 0.05, weight: o.template === 'quote' ? 650 : 800, color: p.ink, maxLines: 4, lineHeight: 1.08 });
    y += leadH + u * 0.03;
    if (o.template === 'tips' && c.items.length) y += list(c.items.slice(0, 3), pad, y, colW, pad + innerH - y);
    else if (o.template === 'quote' ? c.author : c.body) y += text(o.template === 'quote' ? `— ${c.author}` : c.body, pad, y, { w: colW, h: Math.max(0, pad + innerH - y - (c.cta ? u * 0.12 : 0)) }, { max: u * 0.05, min: u * 0.03, weight: 500, color: p.muted, maxLines: 4, lineHeight: 1.3 }) + u * 0.03;
    if (c.cta && o.template !== 'quote') pill(c.cta, pad, Math.min(y, pad + innerH - u * 0.1), colW, u * 0.1);
    // Right column.
    if (o.template === 'stat' && c.stat) {
      text(c.stat, rightX, pad, { w: rightW, h: innerH * 0.7 }, { max: u * 0.38, min: u * 0.1, weight: 800, color: p.mark, align: 'center', maxLines: 1, valign: 'middle', lineHeight: 1 });
      text(c.statLabel, rightX, pad + innerH * 0.7, { w: rightW, h: innerH * 0.3 }, { max: u * 0.06, min: u * 0.035, weight: 600, color: p.ink, align: 'center', maxLines: 2 });
    } else if (o.template === 'event' && c.date) {
      ops.push({ kind: 'rect', x: rightX, y: pad, w: rightW, h: innerH, color: p.mark, radius: u * 0.04 });
      text(c.date, rightX + u * 0.04, pad, { w: rightW - u * 0.08, h: innerH }, { max: u * 0.16, min: u * 0.05, weight: 800, color: p.onMark, align: 'center', maxLines: 3, valign: 'middle', lineHeight: 1.05 });
    } else if (o.hasLogo && o.template !== 'photo') ops.push({ kind: 'logo', x: rightX + rightW * 0.1, y: pad + innerH * 0.15, w: rightW * 0.8, h: innerH * 0.7, align: 'center' });
    else if (o.template !== 'photo') ops.push({ kind: 'circle', cx: rightX + rightW / 2, cy: pad + innerH / 2, r: Math.min(rightW, innerH) * 0.38, color: p.mark });
    footer(pad, h - pad - footH, w - pad * 2, footH, 'left');
    return ops;
  }

  // Square (1:1, 4:5) and tall (9:16, 2:3, skyscrapers): one column, footer at the bottom.
  const cw = w - pad * 2, bottom = h - pad - footH - pad * 0.6, small = w < 400;
  const lead = (shape === 'tall' ? 0.13 : 0.105) * w, body = (small ? 0.075 : 0.046) * w;
  let y = pad + (shape === 'tall' && !small ? h * 0.06 : 0);
  if (photoMode) y = Math.max(y, h * 0.5);
  const markBar = () => { ops.push({ kind: 'rect', x: pad, y, w: w * 0.12, h: Math.max(3, w * 0.012), color: p.mark }); y += w * 0.05; };
  if (o.template === 'announce' || o.template === 'photo') {
    markBar();
    const reserve = (c.body ? body * 3.4 : 0) + (c.cta ? w * 0.13 : 0);
    y += text(c.headline, pad, y, { w: cw, h: Math.max(lead, bottom - y - reserve) }, { max: lead, min: w * (small ? 0.08 : 0.05), weight: 800, color: p.ink, maxLines: small ? 6 : 5, lineHeight: 1.06 }) + w * 0.035;
    y += text(c.body, pad, y, { w: cw, h: Math.max(0, bottom - y - (c.cta ? w * 0.13 : 0)) }, { max: body, min: body * 0.7, weight: 500, color: p.muted, maxLines: small ? 6 : 6, lineHeight: 1.32 }) + w * 0.04;
    if (c.cta) pill(c.cta, pad, Math.min(y, bottom - w * 0.1), cw, w * (small ? 0.14 : 0.1));
  } else if (o.template === 'quote') {
    text('“', pad - w * 0.01, y - w * 0.04, { w: w * 0.3, h: w * 0.24 }, { max: w * 0.32, min: w * 0.1, weight: 800, color: p.mark, maxLines: 1, lineHeight: 1 });
    y += w * 0.2;
    y += text(c.body || c.headline, pad, y, { w: cw, h: Math.max(lead, bottom - y - (c.author ? body * 2 : 0)) }, { max: w * 0.08, min: w * 0.042, weight: 650, color: p.ink, maxLines: 9, lineHeight: 1.22 }) + w * 0.04;
    if (c.author) text(`— ${c.author}`, pad, y, { w: cw, h: body * 2.6 }, { max: body, min: body * 0.75, weight: 600, color: p.muted, maxLines: 2 });
  } else if (o.template === 'tips') {
    markBar();
    y += text(c.headline, pad, y, { w: cw, h: (bottom - y) * 0.34 }, { max: lead * 0.85, min: w * 0.05, weight: 800, color: p.ink, maxLines: 3, lineHeight: 1.06 }) + w * 0.05;
    list(c.items.slice(0, shape === 'tall' ? 5 : 4), pad, y, cw, bottom - y);
  } else if (o.template === 'stat') {
    if (c.headline) y += text(c.headline, pad, y, { w: cw, h: (bottom - y) * 0.22 }, { max: w * 0.06, min: w * 0.035, weight: 700, color: p.muted, maxLines: 2 }) + w * 0.03;
    y += text(c.stat || '—', pad, y, { w: cw, h: (bottom - y) * 0.45 }, { max: w * 0.32, min: w * 0.1, weight: 800, color: p.mark, maxLines: 1, lineHeight: 1 }) + w * 0.02;
    y += text(c.statLabel, pad, y, { w: cw, h: (bottom - y) * 0.45 }, { max: w * 0.075, min: w * 0.04, weight: 700, color: p.ink, maxLines: 3, lineHeight: 1.12 }) + w * 0.03;
    text(c.body, pad, y, { w: cw, h: bottom - y }, { max: body, min: body * 0.7, weight: 500, color: p.muted, maxLines: 4, lineHeight: 1.3 });
  } else if (o.template === 'event') {
    if (c.date) { const dh = w * 0.2; ops.push({ kind: 'rect', x: pad, y, w: cw * 0.62, h: dh, color: p.mark, radius: w * 0.025 }); text(c.date, pad + w * 0.03, y, { w: cw * 0.62 - w * 0.06, h: dh }, { max: w * 0.075, min: w * 0.04, weight: 800, color: p.onMark, maxLines: 2, valign: 'middle', lineHeight: 1.05 }); y += dh + w * 0.06; }
    y += text(c.headline, pad, y, { w: cw, h: Math.max(lead, bottom - y - (c.body ? body * 3.4 : 0) - (c.cta ? w * 0.13 : 0)) }, { max: lead, min: w * 0.05, weight: 800, color: p.ink, maxLines: 5, lineHeight: 1.06 }) + w * 0.035;
    y += text(c.body, pad, y, { w: cw, h: Math.max(0, bottom - y - (c.cta ? w * 0.13 : 0)) }, { max: body, min: body * 0.7, weight: 500, color: p.muted, maxLines: 5, lineHeight: 1.32 }) + w * 0.04;
    if (c.cta) pill(c.cta, pad, Math.min(y, bottom - w * 0.1), cw, w * (small ? 0.14 : 0.1));
  } else {
    y += text(c.headline, pad, y, { w: cw, h: bottom - y }, { max: lead, min: w * 0.05, weight: 800, color: p.ink, maxLines: 6, lineHeight: 1.06 });
  }
  footer(pad, h - pad - footH, cw, footH);
  return ops;

  // Numbered list (tips): a marked number, then the item. Returns the height used.
  function list(items: string[], x: number, top: number, width: number, height: number) {
    const clean = items.map(item => item.trim()).filter(Boolean);
    if (!clean.length || height <= 0) return 0;
    const gap = u * 0.025, row = (height - gap * (clean.length - 1)) / clean.length, dot = Math.min(row * 0.8, u * 0.085);
    clean.forEach((item, index) => {
      const ry = top + index * (row + gap);
      ops.push({ kind: 'circle', cx: x + dot / 2, cy: ry + Math.min(dot / 2, row / 2), r: dot / 2, color: p.mark });
      text(String(index + 1), x, ry + Math.min(dot / 2, row / 2) - dot / 2, { w: dot, h: dot }, { max: dot * 0.55, min: dot * 0.3, weight: 800, color: p.onMark, align: 'center', maxLines: 1, valign: 'middle', lineHeight: 1 });
      text(item, x + dot + u * 0.03, ry, { w: width - dot - u * 0.03, h: row }, { max: u * 0.052, min: u * 0.03, weight: 600, color: p.ink, maxLines: 3, lineHeight: 1.22, valign: row > dot * 1.6 ? 'top' : 'middle' });
    });
    return height;
  }
}
export function initials(value: string) {
  const words = value.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || 'R').slice(0, 2)).toLocaleUpperCase('tr');
}

// Carousel: a cover, one slide per point and a closing call to action; at most `max` images (Instagram/TikTok: 5).
export function carouselSlides(content: DesignContent, max = 5): { template: DesignTemplate; content: DesignContent }[] {
  const items = content.items.map(item => item.trim()).filter(Boolean), closing = Boolean(content.cta.trim());
  const room = Math.max(0, max - 1 - (closing ? 1 : 0)), slides: { template: DesignTemplate; content: DesignContent }[] = [{ template: 'announce', content: { ...content, cta: items.length ? '' : content.cta } }];
  items.slice(0, room).forEach((item, index) => slides.push({ template: 'stat', content: { ...content, headline: content.headline, stat: String(index + 1).padStart(2, '0'), statLabel: item, body: '', cta: '' } }));
  if (closing && items.length && slides.length < max) slides.push({ template: 'announce', content: { ...content, headline: content.cta, body: '', cta: '' } });
  return slides;
}
