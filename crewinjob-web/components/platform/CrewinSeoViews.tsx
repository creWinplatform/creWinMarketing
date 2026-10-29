'use client';
import dynamic from 'next/dynamic';
import { ArrowLeft } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';

const SeoOperations = dynamic(() => import('./SeoOperations'));
const SeoOpportunities = dynamic(() => import('./SeoOpportunities'));
const AiVisibilityPanel = dynamic(() => import('./AiVisibilityPanel'));
const CoachSeo = dynamic(() => import('./CoachSeo'));

// Ryzevo's SEO automation inside Crewin's SEO & Blog tab: scheduled scans with Search Console watch, search
// opportunities, AI assistant visibility and coach SEO topics. Crewin's own tools (blog, site audit…) stay as they are.
export const CREWIN_SEO_VIEWS = ['ops', 'opportunities', 'visibility', 'topics'] as const;
export type CrewinSeoView = typeof CREWIN_SEO_VIEWS[number];
export const crewinSeoLabels = (tr: boolean): Record<CrewinSeoView, string> => ({
  ops: tr ? 'Otomatik tarama' : 'Automatic scan', opportunities: tr ? 'Arama fırsatları' : 'Search opportunities',
  visibility: tr ? 'AI görünürlüğü' : 'AI visibility', topics: tr ? 'SEO konuları' : 'SEO topics',
});
export default function CrewinSeoViews({ view, workspace, lang, onView, onExit }: { view: CrewinSeoView; workspace: WorkspaceContext; lang: Locale; onView: (view: CrewinSeoView) => void; onExit: () => void }) {
  const tr = lang === 'tr', labels = crewinSeoLabels(tr);
  return <section className="crewin-seo-views">
    <div className="crewin-seo-nav">
      <button type="button" className="studio-text-button" onClick={onExit}><ArrowLeft size={14}/>{tr ? 'SEO araçlarına dön' : 'Back to SEO tools'}</button>
      <div className="publication-view-tabs" role="tablist" aria-label={tr ? 'SEO otomasyonu' : 'SEO automation'}>
        {CREWIN_SEO_VIEWS.map(id => <button key={id} type="button" role="tab" aria-selected={view === id} tabIndex={view === id ? 0 : -1} onClick={() => onView(id)}>{labels[id]}</button>)}
      </div>
    </div>
    {view === 'ops' && <SeoOperations workspace={workspace} lang={lang}/>}
    {view === 'opportunities' && <SeoOpportunities lang={lang}/>}
    {view === 'visibility' && <AiVisibilityPanel workspace={workspace} lang={lang}/>}
    {view === 'topics' && <CoachSeo lang={lang}/>}
  </section>;
}
