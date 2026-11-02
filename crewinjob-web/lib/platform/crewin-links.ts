import 'server-only';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { LEGACY_SCOPE } from './access';
import { linkTag } from './link-tracking';
import { LINK_SOURCES, LINK_TAG } from './link-tracking-types';
import { crewinDataDir, fileSummary, records, timeOf } from './file-summary';

// Crewin's own share and email tools tag their links to crewinjob.com with a Ryzevo tag (utm_campaign=rz_…), the same
// tag standard projects' posts carry, so the "Which work brought customers" report can name the post, campaign or email
// a sign-up came from. Campaign tags follow from data/campaigns.json; every other tag is registered with a title in
// data/crewin-link-tags.json when a tool sends it.
export type CrewinTagKind = 'campaign' | 'share' | 'email';
type Entry = { tag: string; kind: CrewinTagKind; title: string; createdAt: string };
const HOST = 'crewinjob.com', URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g, DAY = 86400000;
const REGISTRY = { entries: 3000, days: 400 };
const registryFile = () => path.join(crewinDataDir(), 'crewin-link-tags.json');

export const crewinTag = (kind: CrewinTagKind, id: string) => linkTag(LEGACY_SCOPE, kind, id);
// One tag per share action (all platforms of one post share it; utm_source tells them apart).
export const newCrewinShareTag = () => crewinTag('share', randomUUID());
export const isCrewinSite = (url: URL) => { const name = url.hostname.toLowerCase(); return name === HOST || name.endsWith(`.${HOST}`); };
// GA4 and the report name a channel the way standard posts do (twitter → x).
export const crewinSource = (source: string) => LINK_SOURCES[source] || source;

// Adds utm_source/utm_medium/utm_campaign to crewinjob.com links that carry no utm_ parameter yet; other links stay as
// written. In HTML, a link with an & is left alone: re-serialising "&amp;" would break it.
export function tagCrewinLinks(text: string, tag: string, source: string, medium: string, html = false) {
  if (!text || !LINK_TAG.test(tag)) return { text, tagged: 0 };
  let tagged = 0;
  const output = text.replace(URL_PATTERN, match => {
    const trail = match.match(/[.,;:!?)\]}»”’]+$/)?.[0] || '', raw = match.slice(0, match.length - trail.length);
    let url: URL;
    try { url = new URL(raw); } catch { return match; }
    if (!isCrewinSite(url) || url.username || url.password || html && raw.includes('&') || [...url.searchParams.keys()].some(key => key.toLowerCase().startsWith('utm_'))) return match;
    url.searchParams.set('utm_source', crewinSource(source)); url.searchParams.set('utm_medium', medium); url.searchParams.set('utm_campaign', tag);
    tagged++; return url.toString() + trail;
  });
  return { text: output, tagged };
}

const titleOf = (text: string) => text.replace(URL_PATTERN, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
// Remembers what a tag stands for. The first registration wins; entries older than 400 days and beyond 3,000 drop.
// Writes are synchronous, so two requests in this process cannot interleave.
export function registerCrewinTag(tag: string, kind: CrewinTagKind, title: string, now = Date.now()) {
  if (!LINK_TAG.test(tag)) return false;
  const file = registryFile();
  let list: Entry[] = [];
  try { list = records(JSON.parse(fs.readFileSync(file, 'utf8'))) as Entry[]; } catch { list = []; }
  if (list.some(entry => entry.tag === tag)) return false;
  const cutoff = now - REGISTRY.days * DAY;
  const next = [{ tag, kind, title: titleOf(title), createdAt: new Date(now).toISOString() }, ...list.filter(entry => LINK_TAG.test(String(entry.tag)) && timeOf(entry.createdAt) >= cutoff)].slice(0, REGISTRY.entries);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next)); fs.renameSync(temp, file);
  return true;
}

// Every tag Crewin's tools have used, with the work it stands for; a campaign's name wins over its registered title.
export function crewinTaggedItems() {
  const registry = fileSummary(registryFile(), [] as Entry[], data => records(data).filter(item => LINK_TAG.test(String(item.tag))) as Entry[], 'crewin-link-tags');
  const campaigns = fileSummary(path.join(crewinDataDir(), 'campaigns.json'), [] as { id: string; name: string }[],
    data => records(data).map(item => ({ id: String(item.id || ''), name: String(item.name || '') })).filter(item => item.id), 'crewin-campaign-tags');
  return new Map<string, { kind: 'content' | 'campaign'; id: string; title: string }>([
    ...registry.map(entry => [entry.tag, { kind: entry.kind === 'share' ? 'content' as const : 'campaign' as const, id: entry.tag, title: String(entry.title || '') }] as const),
    ...campaigns.map(item => [crewinTag('campaign', item.id), { kind: 'campaign' as const, id: item.id, title: item.name }] as const),
  ]);
}
