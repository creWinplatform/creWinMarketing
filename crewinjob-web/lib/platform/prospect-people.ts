// Sales assistant: finding the decision maker at a company. Names come only from what is already there: the people
// the company's own site names with a title (its about or team page, or its structured data), the team's own LinkedIn
// connections at that company, and the team's own Hunter results. Nothing is bought or scraped from elsewhere. The
// work address is the company's usual pattern (learned from an address it already uses) or the most common one.
// Pure functions, shared by the server and the tests.
import { DECISION, fold } from './prospect-contacts';

export type PersonCandidate = {
  key: string; name: string; position: string; decisionMaker: boolean; origin: 'site' | 'network' | 'hunter';
  sourceUrl: string | null; email: string | null; emailKind: 'found' | 'pattern' | 'guess'; contactId: string | null;
};
export type PeopleResult = { candidates: PersonCandidate[]; domain: string; mail: 'ok' | 'none' | 'unknown'; pattern: string | null; pagesRead: number };
export const PEOPLE_LIMITS = { perDay: 20, pages: 2, fromSite: 8 } as const;

// The usual company address patterns, the most common first (the same order as the guesses).
export const PATTERNS = ['ad.soyad', 'ad', 'asoyad', 'adsoyad', 'ad_soyad'] as const;
export function patternAddress(first: string, last: string, domain: string, pattern: number) {
  const f = fold(first).replace(/[^a-z]/g, ''), l = fold(last.split(/\s+/).pop() || '').replace(/[^a-z]/g, '');
  if (f.length < 2 || l.length < 2 || !domain) return null;
  return `${[`${f}.${l}`, f, `${f[0]}${l}`, `${f}${l}`, `${f}_${l}`][pattern] || `${f}.${l}`}@${domain}`;
}
export const splitName = (name: string) => { const parts = name.trim().split(/\s+/); return { first: parts[0] || '', last: parts.slice(1).join(' ') }; };
// Which pattern the company uses, from addresses it already has with a known name ("Ayşe Kaya · Genel Müdür").
export function inferPattern(known: { value: string; note: string }[], domain: string) {
  const votes = new Map<number, number>();
  for (const item of known) {
    const { first, last } = splitName(item.note.split(' · ')[0] || ''); if (!first || !last || !item.value.endsWith(`@${domain}`)) continue;
    const index = PATTERNS.findIndex((_, position) => patternAddress(first, last, domain, position) === item.value);
    if (index >= 0) votes.set(index, (votes.get(index) || 0) + 1);
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// ---- The company's own pages ----
const TEAM_LINK = /(hakk[ıi]m[ıi]zda|hakk[ıi]nda|about|ekib|ekip|team|kurucu|y[öo]netim|biz-kimiz|kimiz|kadro|management|leadership|hekim|doktor|avukat|uzman|people|founders?)/i;
export function teamPageLinks(html: string, base: string, limit: number = PEOPLE_LIMITS.pages) {
  let origin: URL; try { origin = new URL(base); } catch { return []; }
  const out: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    let url: URL; try { url = new URL(match[1], origin); } catch { continue; }
    if (url.hostname.replace(/^www\./, '') !== origin.hostname.replace(/^www\./, '') || !/^https?:$/.test(url.protocol)) continue;
    if (!TEAM_LINK.test(url.pathname) && !TEAM_LINK.test(match[2].replace(/<[^>]+>/g, ' '))) continue;
    const clean = `${url.origin}${url.pathname}`;
    if (clean.replace(/\/$/, '') !== `${origin.origin}${origin.pathname}`.replace(/\/$/, '') && !out.includes(clean)) out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}
const TITLE = /\b(kurucu ortak|kurucu|co-?founder|founder|genel m[üu]d[üu]r|ceo|coo|cmo|cto|cfo|y[öo]netim kurulu ba[şs]kan[ıi]|managing director|direkt[öo]r[üu]?|director|i[şs]letme sahibi|sahibi|owner|ba[şs]hekim|mesul m[üu]d[üu]r|sorumlu m[üu]d[üu]r|m[üu]d[üu]r[üu]?|partner|ortak|ba[şs]kan|president|head of [a-z]+)\b/i;
const HONORIFIC = '(?:(?:Prof\\.|Do[çc]\\.|Dr\\.|Dt\\.|Uzm\\.|Op\\.|Av\\.|Mim\\.|M[üu]h\\.|Psk\\.|Dyt\\.)\\s*)*';
const WORD = "[A-ZÇĞİÖŞÜ][a-zçğıöşüâîûA-ZÇĞİÖŞÜ'’-]+";
const NAME = new RegExp(`${HONORIFIC}(${WORD}(?:\\s+${WORD}){1,2})`, 'u');
// Words that start with a capital letter on such pages but are not names.
const NOT_NAME = new Set(['hakkimizda', 'ekibimiz', 'ekip', 'kurucu', 'kurucumuz', 'ortak', 'genel', 'mudur', 'muduru', 'yonetim', 'kurulu', 'baskani', 'baskan', 'our', 'team', 'about', 'the', 'founder', 'co', 'managing', 'director', 'direktor', 'sahibi', 'owner', 'bashekim', 'sorumlu', 'mesul', 'iletisim', 'contact', 'biz', 'kimiz', 'misyon', 'vizyon', 'ceo', 'cto', 'coo', 'cmo', 'cfo', 'head', 'of', 'meet', 'partner', 'president', 'ana', 'sayfa', 'home', 'hizmetler', 'hizmetlerimiz', 'blog', 'kariyer', 'randevu', 'klinik', 'kliniği', 'klinigi', 'ltd', 'sti', 'as',
  // Job titles and professions that follow a title word ("Kurucu Diş Hekimi").
  'dis', 'hekimi', 'hekim', 'uzmani', 'uzman', 'doktor', 'doktoru', 'avukat', 'avukati', 'muhendis', 'muhendisi', 'mimar', 'mimari', 'asistan', 'asistani', 'sekreter', 'hemsire', 'satis', 'pazarlama', 'muhasebe', 'koordinator', 'koordinatoru', 'sorumlusu', 'yoneticisi', 'yonetici', 'temsilcisi', 'danisman', 'danismani', 'egitmen', 'ogretmen', 'operasyon', 'insan', 'kaynaklari', 'finans', 'idari', 'isler', 'teknik', 'proje', 'marka', 'sanat', 'yaratici', 'kreatif', 'senior', 'junior', 'chief', 'officer', 'manager', 'specialist', 'assistant', 'lead', 'dentist', 'doctor', 'lawyer', 'engineer']);
function plainName(value: string) {
  const words = value.trim().split(/\s+/);
  if (words.length < 2 || words.length > 3 || words.some(word => NOT_NAME.has(fold(word).replace(/[^a-z]/g, '')) || word.length < 2)) return null;
  // ALL CAPS surnames ("Ayşe KAYA") read better in title case.
  return words.map(word => word === word.toLocaleUpperCase('tr') ? word.charAt(0) + word.slice(1).toLocaleLowerCase('tr') : word).join(' ');
}
const decode = (value: string) => value.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/&ccedil;/g, 'ç').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
function pageLines(html: string) {
  return decode(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|li|h[1-6]|td|tr|section|article|span|strong|b|em|figcaption|a)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line && line.length <= 160);
}
// People the page names together with a title: the structured data first, then a name and a title on the same or
// the neighbouring line (team cards). Only names that really appear on the page.
export function extractPeople(html: string, url: string, limit: number = PEOPLE_LIMITS.fromSite) {
  const found = new Map<string, { name: string; position: string; sourceUrl: string }>();
  const add = (rawName: string, position: string) => {
    const name = plainName(rawName.replace(new RegExp(`^${HONORIFIC}`, 'u'), '')); if (!name || found.size >= limit) return false;
    const key = fold(name).replace(/[^a-z ]/g, ''); if (!found.has(key)) found.set(key, { name, position: position.replace(/\s+/g, ' ').trim().slice(0, 80), sourceUrl: url });
    return true;
  };
  for (const block of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown; try { data = JSON.parse(block[1]); } catch { continue; }
    const walk = (value: unknown, role: string) => {
      if (Array.isArray(value)) { value.forEach(item => walk(item, role)); return; }
      if (!value || typeof value !== 'object') return;
      const item = value as Record<string, unknown>;
      if (item['@type'] === 'Person' && typeof item.name === 'string') add(item.name, typeof item.jobTitle === 'string' ? item.jobTitle : role);
      for (const [field, label] of [['founder', 'Kurucu'], ['founders', 'Kurucu'], ['employee', ''], ['member', ''], ['@graph', '']] as const) if (field in item) walk(item[field], label);
    };
    walk(data, '');
  }
  const lines = pageLines(html);
  lines.forEach((line, index) => {
    const title = TITLE.exec(line); if (!title) return;
    const own = NAME.exec(line.replace(title[0], ' '));
    if (own && add(own[1], title[0])) return;
    for (const near of [lines[index - 1], lines[index + 1]]) { const match = near && NAME.exec(near); if (match && match[0].length >= near.length - 12 && add(match[1], line.length <= 60 ? line : title[0])) return; }
  });
  // Decision makers first.
  return [...found.values()].sort((a, b) => Number(DECISION.test(b.position)) - Number(DECISION.test(a.position)));
}
