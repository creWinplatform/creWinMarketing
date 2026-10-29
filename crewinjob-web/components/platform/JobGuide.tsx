'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, BarChart3, Briefcase, Building2, Check, ChevronDown, CircleAlert, FolderOpen, LockKeyhole, Mail, Megaphone, MessagesSquare, Search, Send, Shuffle, Sparkles, UserPlus, UserRoundCheck, Wallet, X } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest, searchText } from '@/lib/platform/client';
import type { JobGuideItem, JobGuideView, JobId } from '@/lib/platform/job-guide-types';
import Msg from '@/components/Msg';

const ICONS: Record<JobId, typeof Send> = { social_post: Send, inbox: MessagesSquare, google: Search, ai_answers: Sparkles, email: Mail, ads: Megaphone, results: BarChart3, team: UserPlus, repurpose: Shuffle,
  crewin_jobs: Briefcase, crewin_profiles: UserRoundCheck, crewin_social: Send, crewin_leads: Building2, crewin_campaign: Mail, crewin_seo: Search, crewin_results: BarChart3, crewin_credits: Wallet,
  crewin_growth: Sparkles, crewin_ai: Sparkles, crewin_search: Search, crewin_inbox: MessagesSquare };
// The Crewin workspace has its own jobs; only the search examples differ.
const EXAMPLES = { ryzevo: { tr: 'Ör. instagram, rapor, google, reklam…', en: 'E.g. instagram, report, google, ads…' }, crewin: { tr: 'Ör. ilan, lead, profil, rapor, havale…', en: 'E.g. job ad, lead, profile, report, transfer…' } };
// open(query, focus): the dialog, optionally filtered or with one job already open.
type Context = { data: JobGuideView | null; error: string; loading: boolean; refresh: () => void; open: (query?: string, focus?: JobId) => void; variant: keyof typeof EXAMPLES };
const JobGuideContext = createContext<Context | null>(null);

// One snapshot for the overview list and the global dialog (Ctrl/⌘+K). It is read again when the tab regains focus, so a
// step finished on another screen is ticked on return.
export function JobGuideProvider({ enabled, lang, variant = 'ryzevo', children }: { enabled: boolean; lang: Locale; variant?: keyof typeof EXAMPLES; children: ReactNode }) {
  const tr = lang === 'tr';
  const [data, setData] = useState<JobGuideView | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [opened, setOpened] = useState(false), [query, setQuery] = useState(''), [focus, setFocus] = useState<JobId | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), previousFocus = useRef<HTMLElement | null>(null), request = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    if (!enabled) return; request.current?.abort(); const controller = new AbortController(); request.current = controller; setLoading(true);
    projectRequest<JobGuideView>('/api/platform/job-guide', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) }).then(value => { if (!controller.signal.aborted) { setData(value); setError(''); } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [enabled]);
  useEffect(() => { refresh(); const onFocus = () => { if (document.visibilityState === 'visible') refresh(); }; window.addEventListener('focus', onFocus); return () => { request.current?.abort(); window.removeEventListener('focus', onFocus); }; }, [refresh]);
  const open = useCallback((value = '', job?: JobId) => { setQuery(value); setFocus(job ?? null); setOpened(true); refresh(); }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    // Not over another dialog (the diagnosis, the Compass): the member is in the middle of something there.
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { if ([...document.querySelectorAll('dialog[open]')].some(item => item !== dialog.current)) return; event.preventDefault(); open(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [enabled, open]);
  useEffect(() => {
    const element = dialog.current; if (!element) return;
    if (opened && !element.open) { previousFocus.current = document.activeElement as HTMLElement; element.showModal(); requestAnimationFrame(() => element.querySelector<HTMLInputElement>('input[type=search]')?.focus()); }
    if (!opened && element.open) { element.close(); previousFocus.current?.focus(); }
  }, [opened]);
  const value: Context = { data, error, loading, refresh, open, variant };
  if (!enabled) return <>{children}</>;
  return <JobGuideContext.Provider value={value}>{children}
    <dialog ref={dialog} className="growth-compass job-guide-dialog" aria-labelledby="job-guide-dialog-title" onCancel={event => { event.preventDefault(); setOpened(false); }} onClick={event => { if (event.target === dialog.current) setOpened(false); }}>
      <header className="compass-header"><span className="compass-symbol"><Search size={21} /></span><div><p>{tr ? 'İş rehberi' : 'Job guide'}</p><h2 id="job-guide-dialog-title">{tr ? 'Ne yapmak istiyorsunuz?' : 'What would you like to do?'}</h2></div><button type="button" className="icon-button" aria-label={tr ? 'Kapat' : 'Close'} title={tr ? 'Kapat' : 'Close'} onClick={() => setOpened(false)}><X size={19} /></button></header>
      <div className="compass-scroll">{opened && <JobGuideBody lang={lang} initialQuery={query} initialExpanded={focus} showAll onNavigate={() => setOpened(false)} />}</div>
    </dialog>
  </JobGuideContext.Provider>;
}
export function useJobGuide() { return useContext(JobGuideContext); }

export function JobGuideLauncher({ lang }: { lang: Locale }) {
  const guide = useJobGuide(); if (!guide) return null; const tr = lang === 'tr';
  return <button type="button" className="compass-launcher job-guide-launcher" onClick={() => guide.open()} title={tr ? 'Ne yapmak istiyorsunuz? (Ctrl+K)' : 'What would you like to do? (Ctrl+K)'} aria-label={tr ? 'Ne yapmak istiyorsunuz? İş rehberini aç' : 'What would you like to do? Open the job guide'} aria-keyshortcuts="Control+K Meta+K"><Search size={17} /><span>{tr ? 'Ne yapmak istiyorsunuz?' : 'What to do?'}</span><kbd>Ctrl K</kbd></button>;
}

// The list: search, the most relevant jobs first and, for each job, the steps to its outcome with the next one to do.
// limit: how many jobs show before “All jobs”; moreInDialog: “All jobs” opens the dialog instead of growing the page.
export function JobGuideBody({ lang, initialQuery = '', initialExpanded = null, showAll = false, limit = 5, moreInDialog = false, onNavigate }: { lang: Locale; initialQuery?: string; initialExpanded?: JobId | null; showAll?: boolean; limit?: number; moreInDialog?: boolean; onNavigate?: () => void }) {
  const tr = lang === 'tr', guide = useJobGuide();
  const [query, setQuery] = useState(initialQuery), [expanded, setExpanded] = useState<JobId | null>(initialExpanded), [all, setAll] = useState(showAll);
  const jobs = useMemo(() => {
    const list = guide?.data?.jobs || [], words = searchText(query, lang).split(/\s+/).filter(Boolean);
    if (!words.length) return list;
    return list.filter(job => { const text = searchText([job.title.tr, job.title.en, job.outcome[lang], ...job.keywords, ...job.steps.map(item => item.label[lang])].join(' '), lang); return words.every(word => text.includes(word)); });
  }, [guide?.data, query, lang]);
  useEffect(() => { if (query && jobs.length === 1) setExpanded(jobs[0].id); }, [query, jobs]);
  if (!guide) return null;
  if (!guide.data) return guide.error ? <p role="alert" className="studio-error"><Msg text={guide.error} /></p> : <p className="studio-skeleton" role="status">{tr ? 'İşler hazırlanıyor…' : 'Preparing your jobs…'}</p>;
  const shown = all || query ? jobs : jobs.slice(0, limit);
  return <div className="job-guide-body">
    <label className="job-guide-search"><Search size={15} aria-hidden="true" /><span className="sr-only">{tr ? 'İş ara' : 'Search jobs'}</span>
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={EXAMPLES[guide.variant][lang]} /></label>
    {shown.length === 0 ? <p className="coach-muted">{tr ? 'Bu aramayla eşleşen bir iş yok. Başka bir kelime deneyin ya da menüden ilgili ekranı açın.' : 'No job matches this search. Try another word or open the screen from the menu.'}</p>
      : <ul className="job-guide-list">{shown.map(job => <JobRow key={job.id} job={job} lang={lang} expanded={expanded === job.id} onToggle={() => setExpanded(expanded === job.id ? null : job.id)} onNavigate={onNavigate} />)}</ul>}
    {!all && !query && jobs.length > limit && <button type="button" className="studio-text-button" onClick={() => moreInDialog ? guide.open() : setAll(true)}>{tr ? `Tüm işler (${jobs.length})` : `All jobs (${jobs.length})`}<ChevronDown size={14} /></button>}
    {guide.data.unavailable?.map(note => <p key={note.en} className="job-guide-unavailable" role="note"><CircleAlert size={13} aria-hidden="true" />{note[lang]}</p>)}
  </div>;
}

function JobRow({ job, lang, expanded, onToggle, onNavigate }: { job: JobGuideItem; lang: Locale; expanded: boolean; onToggle: () => void; onNavigate?: () => void }) {
  const tr = lang === 'tr', Icon = ICONS[job.id] || FolderOpen, next = job.steps.find(item => item.id === job.nextStepId), id = `job-${job.id}`;
  return <li className={`job-guide-item${job.complete ? ' complete' : ''}${expanded ? ' expanded' : ''}`}>
    <button type="button" className="job-guide-head" aria-expanded={expanded} aria-controls={id} onClick={onToggle}>
      <Icon size={17} aria-hidden="true" />
      <span className="job-guide-title"><strong>{job.title[lang]}</strong>
        <small>{job.complete ? (tr ? 'Tamamlandı — her adım kayıtlarda görünüyor.' : 'Done — every step shows in the records.') : next ? `${tr ? 'Sıradaki' : 'Next'}: ${next.label[lang]}` : ''}</small></span>
      {job.badge ? <span className="job-guide-badge">{job.badge.count} {job.badge.label[lang]}</span> : <span className="job-guide-progress" aria-label={tr ? `${job.total} adımdan ${job.done} tamam` : `${job.done} of ${job.total} steps done`}>{job.complete ? <Check size={14} /> : `${job.done}/${job.total}`}</span>}
      <ChevronDown size={15} className="job-guide-chevron" aria-hidden="true" />
    </button>
    {expanded && <div id={id} className="job-guide-steps">
      <p className="job-guide-outcome"><strong>{tr ? 'Sonuç: ' : 'Outcome: '}</strong>{job.outcome[lang]}</p>
      <ol>{job.steps.map((item, index) => {
        const current = item.id === job.nextStepId;
        return <li key={item.id} className={`job-step ${item.state}${current ? ' current' : ''}`} aria-current={current ? 'step' : undefined}>
          <span className="job-step-mark" aria-hidden="true">{item.state === 'done' ? <Check size={13} /> : item.state === 'blocked' ? <LockKeyhole size={12} /> : index + 1}</span>
          <div><h3>{item.label[lang]}<span className="sr-only"> — {item.state === 'done' ? (tr ? 'tamam' : 'done') : item.state === 'blocked' ? (tr ? 'başkası yapmalı' : 'someone else must do it') : (tr ? 'yapılacak' : 'to do')}</span>{item.state === 'done' && <a className="job-step-review" href={item.href} onClick={onNavigate}>{tr ? 'Aç' : 'Open'}<ArrowRight size={12} /></a>}</h3>
            {item.evidence && <p className="job-step-evidence">{item.evidence[lang]}</p>}
            {(current || item.state !== 'done') && <p>{item.detail[lang]}</p>}
            {item.reason && <p className="job-step-reason"><LockKeyhole size={12} aria-hidden="true" />{item.reason[lang]}</p>}
            {item.setupHref && <a className={current ? 'studio-primary' : 'studio-text-button'} href={item.setupHref} onClick={onNavigate}>{tr ? 'Kurulum rehberini aç' : 'Open the setup guide'}<ArrowRight size={current ? 15 : 13} /></a>}
            {current && item.canAct && <a className="studio-primary" href={item.href} onClick={onNavigate}>{tr ? 'Bu adımı yap' : 'Do this step'}<ArrowRight size={15} /></a>}
            {!current && item.state === 'todo' && item.canAct && <a className="studio-text-button" href={item.href} onClick={onNavigate}>{tr ? 'Şimdi yap' : 'Do it now'}<ArrowRight size={13} /></a>}
          </div>
        </li>;
      })}</ol>
      <p className="coach-muted">{tr ? 'Bir adımı bitirip buraya döndüğünüzde işaretlenir; tıklamak tek başına tamamlamaz.' : 'A step is ticked when you finish it and come back; clicking alone does not complete it.'}</p>
    </div>}
  </li>;
}

// Overview rail: the same guide, top jobs only. compact: four jobs, and “All jobs” opens the dialog (the page stays short).
export function JobGuidePanel({ lang, compact = false }: { lang: Locale; compact?: boolean }) {
  const guide = useJobGuide(); if (!guide) return null; const tr = lang === 'tr';
  return <section id="task-launcher" className="task-launcher job-guide-panel" aria-labelledby="job-guide-title">
    <div className="job-guide-panel-head"><h2 id="job-guide-title">{tr ? 'Ne yapmak istiyorsunuz?' : 'What would you like to do?'}</h2><kbd title={tr ? 'Her ekrandan açılır' : 'Opens from every screen'}>Ctrl K</kbd></div>
    <p className="coach-muted">{tr ? 'Bir iş seçin; sonuca kadar hangi adımların kaldığını ve sıradakini gösteririz.' : 'Pick a job; we show which steps remain to the outcome and the next one.'}</p>
    <JobGuideBody lang={lang} limit={compact ? 4 : 5} moreInDialog={compact} />
  </section>;
}

// One line under the page heading: what is waiting right now (orders, leads in review, empty profiles…). Each item opens
// its job in the guide; the figures stay in view right below.
export function JobGuideHighlights({ lang, max = 3 }: { lang: Locale; max?: number }) {
  const guide = useJobGuide(), tr = lang === 'tr', locale = tr ? 'tr-TR' : 'en-US';
  const waiting = (guide?.data?.jobs || []).filter(job => job.badge && !job.complete).slice(0, max);
  if (!guide || !waiting.length) return null;
  return <nav className="job-guide-highlights" aria-label={tr ? 'Şu an bekleyenler' : 'Waiting right now'}>
    <span className="job-guide-highlights-label">{tr ? 'Bekleyenler:' : 'Waiting:'}</span>
    {waiting.map(job => { const Icon = ICONS[job.id] || FolderOpen; return <button key={job.id} type="button" className="job-guide-highlight" onClick={() => guide.open('', job.id)} title={job.title[lang]}>
      <Icon size={14} aria-hidden="true" /><strong>{job.badge!.count.toLocaleString(locale)}</strong> {job.badge!.label[lang]}</button>; })}
    <button type="button" className="studio-text-button" onClick={() => guide.open()}>{tr ? 'Ne yapmak istiyorsunuz?' : 'What would you like to do?'}<ArrowRight size={13} /></button>
  </nav>;
}
