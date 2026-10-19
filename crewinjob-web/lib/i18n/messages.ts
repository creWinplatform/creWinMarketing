// Kullanıcıya gösterilen mesajları (sunucu hataları, denetim bulguları, arayüz bildirimleri) arayüz diline çevirir.
// İki yönlüdür: ekranda duran bir mesaj dil değişince karşılığına döner.
// Sözlükler: lib/i18n/messages-en.ts (sunucu, elle) ve lib/i18n/ui-pairs.ts (arayüz, otomatik üretilir).
import { MESSAGES_EN } from './messages-en';
import { UI_PAIRS } from './ui-pairs';
import type { Lang } from './shared';

type Pattern = { regex: RegExp; target: string };
type Direction = { exact: Map<string, string>; patterns: Pattern[] };
const cache: Partial<Record<Lang, Direction>> = {};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLACEHOLDER = /\{(\d+)\}/g;

function direction(lang: Lang): Direction {
  const ready = cache[lang];
  if (ready) return ready;
  const pairs = [...Object.entries(UI_PAIRS), ...Object.entries(MESSAGES_EN)];
  const oriented = lang === 'en' ? pairs : pairs.map(([tr, en]) => [en, tr] as [string, string]);
  const exact = new Map<string, string>();
  const patterns: Pattern[] = [];
  for (const [source, target] of oriented) {
    if (/\{\d+\}/.test(source)) {
      // "{0} bağlantı yanıt vermedi." → değişken kısmı yakalayan desen; sabit metni en uzun olan önce denenir.
      patterns.push({ regex: new RegExp(`^${escape(source).replace(/\\\{(\d+)\\\}/g, '(.+?)')}$`, 's'), target });
    } else if (!exact.has(source)) exact.set(source, target);
  }
  patterns.sort((a, b) => b.regex.source.replace(/\(\.\+\?\)/g, '').length - a.regex.source.replace(/\(\.\+\?\)/g, '').length);
  return (cache[lang] = { exact, patterns });
}

function translate(text: string, lang: Lang, depth: number): string {
  const { exact, patterns } = direction(lang);
  const trimmed = text.trim();
  const found = exact.get(trimmed);
  if (found !== undefined) return found;
  for (const { regex, target } of patterns) {
    const match = trimmed.match(regex);
    if (!match) continue;
    // Değişken parçalar da çevrilebilir bir mesaj olabilir ("Kaynak: Sayfa alınamadı.").
    return target.replace(PLACEHOLDER, (_, index: string) => {
      const part = match[Number(index) + 1] ?? '';
      return depth < 2 ? translate(part, lang, depth + 1) : part;
    });
  }
  // Birleştirilmiş mesajlar: "A. B." gibi cümle dizileri parça parça denenir.
  if (depth === 0 && /[.!?]\s+\S/.test(trimmed)) {
    const parts = trimmed.split(/(?<=[.!?])\s+/);
    if (parts.length > 1) {
      const translated = parts.map(part => translate(part, lang, depth + 1));
      if (translated.some((part, index) => part !== parts[index])) return translated.join(' ');
    }
  }
  return text;
}

export function translateMessage(text: string | null | undefined, lang: Lang): string {
  if (!text) return text ?? '';
  return translate(text, lang, 0);
}

/** Arayüz dilini okumadan çağrılabilen sürüm (fetch yardımcıları gibi React dışı kod için). */
export function translateForDocument(text: string | null | undefined): string {
  const lang: Lang = typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'tr';
  return translateMessage(text, lang);
}
