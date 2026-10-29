'use client';
import { useState } from 'react';
import GrowthCoach from './GrowthCoach';
import CoachWeeklyReview from './CoachWeeklyReview';
import CoachRefresh from './CoachRefresh';
import CoachMyWork from './CoachMyWork';
import TeamAlerts from './TeamAlerts';
import ProjectApprovals from './ProjectApprovals';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';

// Ryzevo's growth features on the Crewin overview: what needs attention, decisions waiting, and the growth coach with its
// weekly review and monthly refresh. The coach reads Crewin's own content and posts (lib/platform/coach-activity.ts).
// part 'attention' sits under the heading (alerts, approvals); part 'coach' follows the Crewin figures.
export default function CrewinGrowthPanel({ workspace, lang, part }: { workspace: WorkspaceContext; lang: Locale; part: 'attention' | 'coach' }) {
  const [coachKey, setCoachKey] = useState(0), changed = () => setCoachKey(value => value + 1);
  if (part === 'attention') return <div className="crewin-growth"><TeamAlerts lang={lang}/><ProjectApprovals lang={lang}/></div>;
  return <div className="crewin-growth">
    <GrowthCoach key={coachKey} workspace={workspace} lang={lang} onChange={changed}/>
    <CoachWeeklyReview workspace={workspace} lang={lang} onChange={changed}/>
    <CoachRefresh key={`refresh-${coachKey}`} workspace={workspace} lang={lang} onChange={changed}/>
    <CoachMyWork lang={lang}/>
  </div>;
}
