import type { Db } from '../db/client';
import path from 'path';
import type Database from 'better-sqlite3';
import { crewinDataDir, records, timeOf } from './file-summary';
import { readStore, storeSummary, webStore } from '../legacy-store';
// What the growth coach counts as the team's activity. Standard projects keep their drafts in the platform tables. The
// Crewin workspace keeps its content library and published posts in its own stores (data/content-history.json and
// data/post-history.json — or their legacy_records stores with PLATFORM_DATABASE_PROVIDER=mssql — mirrored to the Crewin
// backend), so the coach reads those instead of the empty platform tables.
const crewinStore = (file: string, shape: 'array' | 'object' = 'array') => webStore(file, shape, { file: path.join(crewinDataDir(), file) });
type Scope = readonly [organizationId: string, projectId: string];
const packOf = async (db: Db, [organizationId, projectId]: Scope) => (await db.prepare('SELECT product_pack FROM platform_projects WHERE organization_id=? AND id=?').get(organizationId, projectId) as { product_pack: string } | undefined)?.product_pack;
export const isCrewinProject = async (db: Db, scope: Scope) => await packOf(db, scope) === 'crewin';

// Crewin content: one row per draft, with its platform and time (the prompt marks ads and messaging drafts, which are not
// channel posts).
type Draft = { platform: string; at: number };
const crewinDrafts = () => storeSummary(crewinStore('content-history.json'), [] as Draft[], data => records(data)
  .filter(item => !/^(Reklam Kampanyası|Ad Campaign)/.test(String(item.prompt || '')))
  .map(item => ({ platform: String(item.platform || '').toLowerCase(), at: timeOf(item.timestamp) })).filter(item => item.platform && item.at), 'coach');
type Post = { platform: string; at: number; url: string | null; title: string };
const crewinPostRows = () => storeSummary(crewinStore('post-history.json'), [] as Post[], data => records(data)
  .map(item => ({ platform: String(item.platform || '').toLowerCase(), at: timeOf(item.publishedAt), url: typeof item.postUrl === 'string' && /^https:\/\//.test(item.postUrl) ? item.postUrl : null, title: String(item.content || '').replace(/\s+/g, ' ').trim().slice(0, 80) }))
  .filter(item => item.platform && item.at), 'coach-posts');
const crewinPosts = async () => (await crewinPostRows()).map(item => item.at);

/** Drafts per platform since `since` (ms). */
export async function draftsByPlatform(db: Db, scope: Scope, since: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (await isCrewinProject(db, scope)) { for (const item of await crewinDrafts()) if (item.at >= since) out[item.platform] = (out[item.platform] || 0) + 1; return out; }
  for (const item of await db.prepare("SELECT json_extract(payload,'$.platform') platform FROM platform_content_history WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.timestamp')>=?").all(...scope, since) as { platform: string | null }[])
    if (item.platform) out[item.platform] = (out[item.platform] || 0) + 1;
  return out;
}
/** All drafts the project has (content and campaign drafts). */
export async function draftTotal(db: Db, scope: Scope): Promise<number> {
  if (await isCrewinProject(db, scope)) return (await crewinDrafts()).length;
  const count = async (table: string) => (await db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE organization_id=? AND project_id=?`).get(...scope) as { n: number }).n;
  return await count('platform_content_history') + await count('platform_campaigns');
}
/** Crewin's published posts in [from, to): what its own tools recorded (no engagement or site figures). */
export async function crewinPostsIn(from: string, to: string): Promise<Post[]> {
  const a = Date.parse(from), b = Date.parse(to); return (await crewinPostRows()).filter(item => item.at >= a && item.at < b).sort((x, y) => x.at - y.at);
}
/** Crewin's drafts in [from, to). */
export async function crewinDraftsIn(from: string, to: string): Promise<number> {
  const a = Date.parse(from), b = Date.parse(to); return (await crewinDrafts()).filter(item => item.at >= a && item.at < b).length;
}
/** Posts actually published between two ISO times. */
export async function crewinPublishedBetween(from: string, to: string): Promise<number> {
  const a = Date.parse(from), b = Date.parse(to); return (await crewinPosts()).filter(at => at >= a && at <= b).length;
}

// Channels the Crewin workspace already reaches with its own tools (legacy social tokens, env credentials). A connection
// step is done for them; the coach must not send the team to Ryzevo's connection screen for a channel Crewin already posts to.
export async function crewinConnectedChannels(env: Record<string, string | undefined> = process.env): Promise<Set<string>> {
  let tokens: Record<string, { accessToken?: string; expiresAt?: number; refreshToken?: string } | undefined> = {};
  try { tokens = await readStore(crewinStore('social-tokens.json', 'object')) as typeof tokens; } catch { tokens = {}; }
  const live = (name: string) => { const token = tokens?.[name]; return Boolean(token?.accessToken && !(token.expiresAt && token.expiresAt < Date.now() && !token.refreshToken)); };
  const out = new Set<string>();
  if (live('linkedin') || env.LINKEDIN_ACCESS_TOKEN) out.add('linkedin');
  if (live('facebook') || env.FACEBOOK_PAGE_ACCESS_TOKEN || env.FACEBOOK_ACCESS_TOKEN) out.add('facebook');
  if (live('instagram') || env.INSTAGRAM_ACCESS_TOKEN || env.FACEBOOK_PAGE_ACCESS_TOKEN) out.add('instagram');
  if (live('twitter') || env.TWITTER_ACCESS_TOKEN) out.add('twitter');
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM_EMAIL) out.add('email');
  if (env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN) out.add('whatsapp');
  if (env.META_ADS_ACCOUNT_ID || env.GOOGLE_ADS_CUSTOMER_ID || env.LINKEDIN_ADS_ACCOUNT_ID) out.add('ads');
  return out;
}
