import type { Db } from '../db/client';
import 'server-only';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { ryzevoFeature } from './ryzevo-features';
import { POSTING_SLOTS, type PostingSlot, type PostingTimesView } from './posting-times-types';

// When the team's own posts did best: live posts of the last 180 days with measured engagement, grouped per channel
// by weekday and time slot in the project's time zone, compared by the median of interactions. With fewer than 8
// measured posts on a channel, or fewer than 3 in a slot, nothing is suggested. An observation, not a rule.
const DAY = 86400000, MIN_POSTS = 8, MIN_SLOT = 3;
const INTERACTIONS = ['likes', 'comments', 'shares', 'clicks', 'bookmarks', 'quotes'];
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2); return sorted.length ? sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 : 0; };
export const postingSlot = (hour: number): PostingSlot => hour >= 6 && hour < 11 ? 'morning' : hour >= 11 && hour < 14 ? 'noon' : hour >= 14 && hour < 18 ? 'afternoon' : hour >= 18 && hour < 23 ? 'evening' : 'night';
export function localWhen(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.find(part => part.type === 'weekday')!.value);
  return { weekday, slot: postingSlot(Number(parts.find(part => part.type === 'hour')!.value)) };
}
// Pure: the suggestion per channel from (channel, posted at, interactions) rows.
export function postingTimes(rows: { platform: string; at: string; interactions: number }[], timeZone: string): PostingTimesView['channels'] {
  const byPlatform = new Map<string, typeof rows>();
  for (const row of rows) byPlatform.set(row.platform, [...(byPlatform.get(row.platform) || []), row]);
  return [...byPlatform.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([platform, list]) => {
    if (list.length < MIN_POSTS) return { platform, posts: list.length, needed: MIN_POSTS, best: null, weekdays: null, overall: median(list.map(item => item.interactions)) };
    const when = list.map(item => ({ ...localWhen(item.at, timeZone), interactions: item.interactions })), overall = median(when.map(item => item.interactions));
    const slots = POSTING_SLOTS.map(slot => { const values = when.filter(item => item.slot === slot).map(item => item.interactions); return { slot, posts: values.length, median: median(values) }; }).filter(item => item.posts >= MIN_SLOT);
    const best = slots.sort((a, b) => b.median - a.median || b.posts - a.posts)[0];
    // Weekday or weekend, only when both have enough posts and one is clearly ahead.
    const group = (weekend: boolean) => when.filter(item => (item.weekday >= 5) === weekend).map(item => item.interactions);
    const weekday = group(false), weekend = group(true);
    const weekdays: 'weekdays' | 'weekend' | null = weekday.length >= MIN_SLOT && weekend.length >= MIN_SLOT && median(weekday) !== median(weekend) ? (median(weekday) > median(weekend) ? 'weekdays' : 'weekend') : null;
    return { platform, posts: list.length, needed: MIN_POSTS, best: best && best.median > overall ? best : null, weekdays, overall };
  });
}

export class PostingTimes {
  private repo: PlatformRepository;
  constructor(private db: Db, private scope: MarketingScope) { this.repo = new PlatformRepository(db); }
  async view(now = Date.now()): Promise<PostingTimesView> {
    const project = await this.repo.can(this.scope.subject, this.scope.organizationId, this.scope.projectId, 'read') ? (await this.repo.workspace(this.scope.subject, this.scope.organizationId, this.scope.projectId))?.project : undefined;
    if (!project || !ryzevoFeature(project.productPack, 'coach')) throw new MarketingStoreError('Paylaşım zamanı önerisi için proje erişimi gerekli.', 403);
    const rows = (await this.db.prepare(`SELECT s.platform,COALESCE(p.submitted_at,p.scheduled_at) at,e.counts_json FROM platform_social_publications p
      JOIN platform_social_engagement e ON e.job_id=p.job_id JOIN platform_jobs j ON j.id=p.job_id AND j.organization_id=p.organization_id AND j.project_id=p.project_id
      JOIN platform_social_accounts s ON s.connection_id=j.connection_id
      WHERE p.organization_id=? AND p.project_id=? AND p.mode='publish' AND p.state='accepted' AND e.state='ready' AND e.observed_at IS NOT NULL AND COALESCE(p.submitted_at,p.scheduled_at)>=?`)
      .all(this.scope.organizationId, this.scope.projectId, new Date(now - 180 * DAY).toISOString()) as { platform: string; at: string; counts_json: string }[])
      .map(row => { let counts: Record<string, unknown> = {}; try { counts = JSON.parse(row.counts_json); } catch { counts = {}; } return { platform: row.platform, at: row.at, interactions: INTERACTIONS.reduce((sum, key) => sum + (Number.isSafeInteger(counts[key]) && (counts[key] as number) >= 0 ? counts[key] as number : 0), 0) }; });
    return { timeZone: project.timezone, days: 180, channels: postingTimes(rows, project.timezone) };
  }
}
