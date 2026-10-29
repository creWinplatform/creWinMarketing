import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { crewinDataDir, fileSummary, records, timeOf } from './file-summary';
// What the growth coach counts as the team's activity. Standard projects keep their drafts in the platform tables. The
// Crewin workspace keeps its content library and published posts in its own stores (data/content-history.json and
// data/post-history.json, mirrored to the Crewin backend), so the coach reads those instead of the empty platform tables.
type Scope = readonly [organizationId: string, projectId: string];
const packOf = (db: Database.Database, [organizationId, projectId]: Scope) => (db.prepare('SELECT product_pack FROM platform_projects WHERE organization_id=? AND id=?').get(organizationId, projectId) as { product_pack: string } | undefined)?.product_pack;
export const isCrewinProject = (db: Database.Database, scope: Scope) => packOf(db, scope) === 'crewin';

// Crewin content: one row per draft, with its platform and time (the prompt marks ads and messaging drafts, which are not
// channel posts).
type Draft = { platform: string; at: number };
const crewinDrafts = () => fileSummary(path.join(crewinDataDir(), 'content-history.json'), [] as Draft[], data => records(data)
  .filter(item => !/^(Reklam Kampanyası|Ad Campaign)/.test(String(item.prompt || '')))
  .map(item => ({ platform: String(item.platform || '').toLowerCase(), at: timeOf(item.timestamp) })).filter(item => item.platform && item.at), 'coach');
type Post = { platform: string; at: number; url: string | null; title: string };
const crewinPostRows = () => fileSummary(path.join(crewinDataDir(), 'post-history.json'), [] as Post[], data => records(data)
  .map(item => ({ platform: String(item.platform || '').toLowerCase(), at: timeOf(item.publishedAt), url: typeof item.postUrl === 'string' && /^https:\/\//.test(item.postUrl) ? item.postUrl : null, title: String(item.content || '').replace(/\s+/g, ' ').trim().slice(0, 80) }))
  .filter(item => item.platform && item.at), 'coach-posts');
const crewinPosts = () => crewinPostRows().map(item => item.at);

/** Drafts per platform since `since` (ms). */
export function draftsByPlatform(db: Database.Database, scope: Scope, since: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (isCrewinProject(db, scope)) { for (const item of crewinDrafts()) if (item.at >= since) out[item.platform] = (out[item.platform] || 0) + 1; return out; }
  for (const item of db.prepare("SELECT json_extract(payload,'$.platform') platform FROM platform_content_history WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.timestamp')>=?").all(...scope, since) as { platform: string | null }[])
    if (item.platform) out[item.platform] = (out[item.platform] || 0) + 1;
  return out;
}
/** All drafts the project has (content and campaign drafts). */
export function draftTotal(db: Database.Database, scope: Scope): number {
  if (isCrewinProject(db, scope)) return crewinDrafts().length;
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE organization_id=? AND project_id=?`).get(...scope) as { n: number }).n;
  return count('platform_content_history') + count('platform_campaigns');
}
/** Crewin's published posts in [from, to): what its own tools recorded (no engagement or site figures). */
export function crewinPostsIn(from: string, to: string): Post[] {
  const a = Date.parse(from), b = Date.parse(to); return crewinPostRows().filter(item => item.at >= a && item.at < b).sort((x, y) => x.at - y.at);
}
/** Crewin's drafts in [from, to). */
export function crewinDraftsIn(from: string, to: string): number {
  const a = Date.parse(from), b = Date.parse(to); return crewinDrafts().filter(item => item.at >= a && item.at < b).length;
}
/** Posts actually published between two ISO times. */
export function crewinPublishedBetween(from: string, to: string): number {
  const a = Date.parse(from), b = Date.parse(to); return crewinPosts().filter(at => at >= a && at <= b).length;
}

// Channels the Crewin workspace already reaches with its own tools (legacy social tokens, env credentials). A connection
// step is done for them; the coach must not send the team to Ryzevo's connection screen for a channel Crewin already posts to.
export function crewinConnectedChannels(env: Record<string, string | undefined> = process.env): Set<string> {
  let tokens: Record<string, { accessToken?: string; expiresAt?: number; refreshToken?: string } | undefined> = {};
  try { tokens = JSON.parse(fs.readFileSync(path.join(crewinDataDir(), 'social-tokens.json'), 'utf8')); } catch { tokens = {}; }
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
