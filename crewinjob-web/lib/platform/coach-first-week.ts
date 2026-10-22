import 'server-only';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { HistoryItem } from '@/lib/content-history';
import { ProjectMarketingStore, type MarketingScope } from './marketing-store';
import { GrowthCoach } from './coach';
import { CoachContentPlan } from './coach-content';
import { coachDraftChannel, type CoachBrief, type CoachContentItem } from './coach-types';

// Ready first week: right after a brief is approved, this month's rule-based content plan is prepared (only if the
// month is still empty) and the first few plan items get drafts in the content library. The drafts are frames built
// from the approved brief: no invented facts, figures or promises, and nothing is published or scheduled. They carry `starter: true` until the team saves them, so the Compass and the coach's learning view do
// not count them as the team's own work.
const DRAFTS = 3;
const X_LIMIT = 280;

// A starter is a frame, not finished copy: the first line is a {{…}} prompt the team replaces with its own example,
// followed by the approved positioning and the website. Publishing refuses any text that still holds {{…}}, so an
// untouched starter can never go out.
export function coachStarterDraft(item: Pick<CoachContentItem, 'id' | 'channel' | 'title' | 'angle'>, brief: CoachBrief, website: string): HistoryItem {
  const tr = brief.language === 'tr', platform = coachDraftChannel(item.channel);
  const topic = item.title.replace(/^[^:]{1,40}:\s*/, '').trim() || item.title;
  const prompt = tr ? `{{${topic} — buraya kendi örneğinizi yazın}}` : `{{${topic} — write your own example here}}`;
  const link = /^https?:\/\//.test(website) ? `${tr ? 'Ayrıntılar' : 'Details'}: ${website}` : '';
  let positioning = brief.positioning.trim();
  if (platform === 'twitter') {
    const room = X_LIMIT - prompt.length - (link ? link.length + 2 : 0) - 2;
    if (positioning.length > room) positioning = room > 20 ? `${positioning.slice(0, room - 1).trimEnd()}…` : '';
  }
  const content = [prompt, positioning, link].filter(Boolean).join('\n\n');
  return { id: `starter_${randomUUID()}`, platform, language: brief.language, headline: item.title.slice(0, 200), content, prompt: item.angle.slice(0, 2000), timestamp: Date.now(), coachRef: `content:${item.id}`, starter: true };
}

export function seedCoachFirstWeek(db: Database.Database, scope: MarketingScope): { drafts: number } {
  const coach = new GrowthCoach(db, scope), { brief } = coach.approved();
  if (!brief || !coach.can('content.write')) return { drafts: 0 };
  // Earliest plan items first, spread over different topics and channels; repeats only when the plan has no others.
  const open = new CoachContentPlan(db, scope).seedStarter().filter(item => item.channel !== 'email'), items: typeof open = [];
  const topic = (item: (typeof open)[number]) => item.title.replace(/^[^:]{1,40}:\s*/, '');
  for (const fresh of [(item: (typeof open)[number]) => !items.some(other => topic(other) === topic(item) || other.channel === item.channel), (item: (typeof open)[number]) => !items.some(other => topic(other) === topic(item)), () => true])
    for (const item of open) if (items.length < DRAFTS && !items.includes(item) && fresh(item)) items.push(item);
  const store = new ProjectMarketingStore(db, scope), existing = new Set(store.history().map(item => item.coachRef).filter(Boolean));
  const website = coach.repo.workspace(scope.subject, scope.organizationId, scope.projectId)?.project.website || '';
  let drafts = 0;
  items.forEach(item => {
    if (existing.has(`content:${item.id}`)) return;
    try { store.saveContent(coachStarterDraft(item, brief, website), true); drafts++; } catch { /* content limit or trial end: the plan stays, drafts are optional */ }
  });
  return { drafts };
}
