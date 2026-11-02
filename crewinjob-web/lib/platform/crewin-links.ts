import 'server-only';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { LEGACY_SCOPE } from './access';
import { linkTag } from './link-tracking';
import { LINK_TAG } from './link-tracking-types';
import { crewinDataDir, fileSummary, records, timeOf } from './file-summary';
import { CREWIN_URL_PATTERN, crewinSource, isCrewinSite, tagCrewinLinks, tagCrewinShare } from './crewin-link-text';

export { crewinSource, isCrewinSite, tagCrewinLinks, tagCrewinShare };

// Crewin's own share and email tools tag their links to crewinjob.com with a Ryzevo tag (utm_campaign=rz_…), the same
// tag standard projects' posts carry, so the "Which work brought customers" report can name the post, campaign or email
// a sign-up came from. Campaign tags follow from data/campaigns.json; every other tag is registered with a title in
// data/crewin-link-tags.json when a tool sends it. The agent's Telegram posts register theirs in its own
// data/link-tags.jsonl (crewinjob-agent/modules/link-tags.js computes the same tags).
export type CrewinTagKind = 'campaign' | 'share' | 'email';
type Entry = { tag: string; kind: string; title: string; createdAt: string };
type Item = { kind: 'content' | 'campaign'; id: string; title: string };
const DAY = 86400000, REGISTRY = { entries: 3000, days: 400 };
const registryFile = () => path.join(crewinDataDir(), 'crewin-link-tags.json');
const agentRegistryFile = () => path.join(process.env.CREWINJOB_AGENT_DIR ? path.resolve(process.env.CREWINJOB_AGENT_DIR) : path.join(process.cwd(), '..', 'crewinjob-agent'), 'data', 'link-tags.jsonl');

export const crewinTag = (kind: string, id: string) => linkTag(LEGACY_SCOPE, kind, id);
// One tag per share action (all platforms of one post share it; utm_source tells them apart).
export const newCrewinShareTag = () => crewinTag('share', randomUUID());

// Instagram and TikTok captions are not clickable; the link people follow is the one on the profile. A fixed tag per
// profile lets the report count who came through it.
export const PROFILE_PLATFORMS = ['instagram', 'tiktok'] as const;
const PROFILE_TITLES: Record<string, string> = { instagram: 'Instagram profil linki', tiktok: 'TikTok profil linki' };
export const crewinProfileLink = (platform: typeof PROFILE_PLATFORMS[number]) =>
  `https://www.crewinjob.com/?utm_source=${platform}&utm_medium=social&utm_campaign=${crewinTag('profile', platform)}`;

const titleOf = (text: string) => text.replace(CREWIN_URL_PATTERN, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
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

// The agent appends one JSON line per new tag (and once more when a job's generic title gets its real one); a broken
// line is skipped, the last line for a tag wins.
function agentEntries(raw: string): Entry[] {
  const cutoff = Date.now() - REGISTRY.days * DAY;
  return raw.split('\n').flatMap(line => { try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; } })
    .filter(item => item && LINK_TAG.test(String(item.tag)) && timeOf(item.createdAt) >= cutoff) as Entry[];
}
function agentRegistry(): Entry[] {
  const file = agentRegistryFile();
  let stat: fs.Stats; try { stat = fs.statSync(file); } catch { return []; }
  const key = `${file}:${stat.mtimeMs}:${stat.size}`;
  if (agentCache.key !== key) { let raw = ''; try { raw = fs.readFileSync(file, 'utf8'); } catch { raw = ''; } agentCache.key = key; agentCache.value = agentEntries(raw); }
  return agentCache.value;
}
const agentCache: { key: string; value: Entry[] } = { key: '', value: [] };

// Every tag Crewin's tools have used, with the work it stands for. Later sources win: the agent's job posts and bot,
// then the panel's own registry, the profile links, and a campaign's own name.
export function crewinTaggedItems() {
  const registry = fileSummary(registryFile(), [] as Entry[], data => records(data).filter(item => LINK_TAG.test(String(item.tag))) as Entry[], 'crewin-link-tags');
  const campaigns = fileSummary(path.join(crewinDataDir(), 'campaigns.json'), [] as { id: string; name: string }[],
    data => records(data).map(item => ({ id: String(item.id || ''), name: String(item.name || '') })).filter(item => item.id), 'crewin-campaign-tags');
  const entry = (item: Entry) => [item.tag, { kind: ['share', 'job', 'bot'].includes(item.kind) ? 'content' as const : 'campaign' as const, id: item.tag, title: String(item.title || '') }] as const;
  return new Map<string, Item>([
    ...agentRegistry().map(entry),
    ...registry.map(entry),
    ...PROFILE_PLATFORMS.map(platform => [crewinTag('profile', platform), { kind: 'content' as const, id: `profile:${platform}`, title: PROFILE_TITLES[platform] }] as const),
    ...campaigns.map(item => [crewinTag('campaign', item.id), { kind: 'campaign' as const, id: item.id, title: item.name }] as const),
  ]);
}
