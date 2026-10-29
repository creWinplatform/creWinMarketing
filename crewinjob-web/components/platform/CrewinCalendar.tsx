'use client';
import { useState, type ReactNode } from 'react';
import ProjectPlanning from './ProjectPlanning';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';

// Crewin's Calendar: its own post calendar stays first; Ryzevo's work plan (tasks from the growth coach and SEO findings)
// and the coach's monthly content plan sit next to it. ?view=work / ?view=content or the coach's ?planning= links open them.
export default function CrewinCalendar({ workspace, lang, posts }: { workspace: WorkspaceContext; lang: Locale; posts: ReactNode }) {
  const tr = lang === 'tr';
  const [part, setPart] = useState<'posts' | 'plan'>(() => {
    if (typeof window === 'undefined') return 'posts';
    const query = new URLSearchParams(window.location.search);
    return ['work', 'content'].includes(query.get('view') || '') || query.has('planning') ? 'plan' : 'posts';
  });
  return <section className="crewin-calendar">
    <div className="publication-view-tabs" role="tablist" aria-label={tr ? 'Takvim' : 'Calendar'}>
      <button type="button" role="tab" aria-selected={part === 'posts'} tabIndex={part === 'posts' ? 0 : -1} onClick={() => setPart('posts')}>{tr ? 'Paylaşım takvimi' : 'Post calendar'}</button>
      <button type="button" role="tab" aria-selected={part === 'plan'} tabIndex={part === 'plan' ? 0 : -1} onClick={() => setPart('plan')}>{tr ? 'İş ve içerik planı' : 'Work and content plan'}</button>
    </div>
    {part === 'posts' ? posts : <ProjectPlanning workspace={workspace} lang={lang}/>}
  </section>;
}
