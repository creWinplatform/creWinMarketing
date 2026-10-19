'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, FolderOpen, Megaphone, Target, RefreshCw, Plus, CircleDashed, ArrowUpRight } from 'lucide-react';
import { CompassOverview } from './GrowthCompass';
import GrowthCoach from './GrowthCoach';
import CoachWeeklyReview from './CoachWeeklyReview';
import CoachRefresh from './CoachRefresh';
import CoachMyWork from './CoachMyWork';
import type { Locale, ModuleId, WorkspaceContext } from '@/lib/platform/catalog';
import type { WorkItem, MetricEntry } from '@/lib/platform/operations';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';

export type OperationsSummary = {
  campaigns: number; content: number; tasks: WorkItem[]; metrics: MetricEntry[];
  connections: string[]; activity: { operation: string; createdAt: string }[];
  usage: { ai: number }; limits: { ai: number; campaigns: number; content: number; tasks: number; members: number };
  plan: string; billingEnabled: boolean; aiConfigured: boolean; publishingEnabled: boolean;
};
export default function ProjectOverview({ workspace, lang, onNavigate }: { workspace: WorkspaceContext; lang: Locale; onNavigate: (id: ModuleId) => void }) {
  const tr = lang === 'tr', locale = localeTag(lang);
  const [data, setData] = useState<OperationsSummary | null>(null), [error, setError] = useState(''), [refreshing, setRefreshing] = useState(false);
  const request = useRef<AbortController | null>(null), [coachKey, setCoachKey] = useState(0);
  const load = () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setError(''); setRefreshing(true);
    projectRequest<OperationsSummary>('/api/platform/operations', { signal:controller.signal }).then(value => { if (!controller.signal.aborted) setData(value); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
  };
  useEffect(() => { load(); return () => request.current?.abort(); }, []);
  const enabled = (id: ModuleId) => workspace.modules.some(module => module.id === id);
  const canWrite = workspace.permissions?.includes('content.write');
  const tasks = data?.tasks.filter(item => ['planned','in_progress'].includes(item.status)) || [];
  const activityLabels: Record<string, [string,string]> = {
    'campaign.create':['Kampanya oluşturuldu','Campaign created'], 'campaign.update':['Kampanya güncellendi','Campaign updated'], 'campaign.delete':['Kampanya silindi','Campaign deleted'],
    'content.create':['İçerik kaydedildi','Content saved'], 'content.update':['İçerik güncellendi','Content updated'], 'content.delete':['İçerik silindi','Content deleted'],
    'plan.create':['İş planlandı','Task planned'], 'plan.update':['İş güncellendi','Task updated'], 'plan.delete':['İş kaldırıldı','Task removed'],
    'metric.record':['Ölçüm kaydedildi','Measurement recorded'], 'metric.delete':['Ölçüm kaldırıldı','Measurement removed'],
    'project.update':['Proje güncellendi','Project updated'], 'organization.provision':['Çalışma alanı oluşturuldu','Workspace created'],
    'membership.create':['Ekip üyesi eklendi','Team member added'], 'membership.update':['Üyelik güncellendi','Membership updated'],
    'connection.save':['Bağlantı kaydedildi','Connection saved'], 'connection.revoke':['Bağlantı kaldırıldı','Connection revoked'],
    'coach.answers':['Büyüme teşhisi yanıtlandı','Growth diagnosis answered'], 'coach.draft.ai':['AI strateji taslağı hazırlandı','AI strategy draft prepared'], 'coach.draft.template':['Başlangıç briefi hazırlandı','Starter brief prepared'], 'coach.draft.edit':['Brief taslağı düzenlendi','Brief draft edited'], 'coach.approve':['Strateji briefi onaylandı','Strategy brief approved'], 'coach.refresh.template':['Aylık yenileme önerildi','Monthly renewal proposed'], 'coach.refresh.ai':['AI aylık yenileme önerdi','AI proposed a monthly renewal'], 'coach.refresh.approve':['Aylık yenileme onaylandı','Monthly renewal approved'], 'coach.refresh.dismiss':['Aylık yenileme reddedildi','Monthly renewal dismissed'],
    'coach.review.generate':['Haftalık özet hazırlandı','Weekly review prepared'], 'coach.review.add':['Plana eylem eklendi','Action added to the plan'], 'coach.review.move':['Plan eylemi taşındı','Plan action moved'], 'coach.review.accept':['Plan önerisi kabul edildi','Plan proposal accepted'], 'coach.review.reject':['Plan önerisi reddedildi','Plan proposal rejected'],
    'coach.content.approve':['İçerik planı maddesi onaylandı','Content plan item approved'], 'coach.content.schedule':['Plan maddesi takvime eklendi','Plan item added to Calendar'], 'coach.content.template':['İçerik planı önerildi','Content plan suggested'], 'coach.content.ai':['AI içerik planı önerdi','AI suggested a content plan'], 'coach.seo.brief.approve':['SEO briefi onaylandı','SEO brief approved'],
    'coach.action.done':['Koç eylemi tamamlandı','Coach action done'], 'coach.action.skipped':['Koç eylemi ertelendi','Coach action skipped'], 'coach.action.open':['Koç eylemi yeniden açıldı','Coach action reopened'], 'coach.action.schedule':['Koç eylemi takvime eklendi','Coach action added to Calendar'], 'coach.assign':['Koç işine sorumlu atandı','Owner assigned to coach work'], 'coach.unassign':['Koç işinden atama kaldırıldı','Assignment removed from coach work'],
  };
  return (
    <section className="studio-overview">
      <header className="studio-page-heading">
        <div><p className="overview-intro-date">{new Date().toLocaleDateString(locale, { day:'numeric', month:'long', weekday:'long', timeZone:workspace.project.timezone })}</p><h1>{tr ? 'Çalışma merkezi' : 'Workspace overview'}</h1><p className="studio-subtitle">{tr ? 'Bugünün öncelikleri ve ürününüzün büyüme yolculuğu.' : 'Today’s priorities and your product’s growth journey.'}</p></div>
        <div className="overview-header-actions"><button className="icon-button" disabled={refreshing} title={tr ? 'Yenile' : 'Refresh'} aria-label={tr ? 'Yenile' : 'Refresh'} onClick={load}><RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} /></button>{enabled('campaigns') && canWrite && <button className="studio-primary" title={tr ? 'Yeni kampanya' : 'New campaign'} onClick={() => onNavigate('campaigns')}><Plus size={17} />{tr ? 'Yeni kampanya' : 'New campaign'}</button>}</div>
      </header>
      {error && <div className="studio-error" role="alert"><Msg text={error}/><button className="icon-button" title={tr ? 'Yeniden dene' : 'Retry'} aria-label={tr ? 'Yeniden dene' : 'Retry'} onClick={load}><RefreshCw size={17} /></button></div>}
      {!data && !error && <div className="studio-skeleton" role="status">{tr ? 'Çalışma alanı yükleniyor…' : 'Loading workspace…'}</div>}
      {data && <>
        <div className="ryz-focus-bar"><div><h2>{tasks.length ? (tr ? `${tasks.length} iş sıradaki adımını bekliyor.` : (tasks.length === 1 ? '1 task is ready for the next step.' : `${tasks.length} tasks are ready for the next step.`)) : (tr ? 'Bugünün yönünü sen belirle.' : 'Set the direction for today.')}</h2><p>{tasks.length ? tasks[0].title : (tr ? 'Bir taslakla başla veya büyüme hedefini netleştir.' : 'Start with a draft or refine your growth goal.')}</p></div><button className="studio-text-button" disabled={!enabled(tasks.length ? 'calendar' : 'project')} onClick={() => onNavigate(tasks.length ? 'calendar' : 'project')}>{tr ? 'Devam et' : 'Continue'}<ArrowRight size={15} /></button></div>
        <div className="studio-stats">{[
          { label: tr ? 'Kampanya taslağı' : 'Campaign drafts', value:data.campaigns, Icon:Megaphone, tab:'campaigns' },
          { label: tr ? 'İçerik kütüphanesi' : 'Content library', value:data.content, Icon:FolderOpen, tab:'library' },
          { label: tr ? 'Bekleyen iş' : 'Upcoming tasks', value:tasks.length, Icon:CalendarDays, tab:'calendar' },
          { label: tr ? 'Büyüme hedefi' : 'Growth goals', value:workspace.project.goals.length, Icon:Target, tab:'project' },
        ].map(item => <button key={item.tab} className="studio-stat" disabled={!enabled(item.tab as ModuleId)} onClick={() => onNavigate(item.tab as ModuleId)}><div><span>{item.label}</span><strong>{item.value.toLocaleString(locale)}</strong><small>{tr ? 'Projeye ait kayıtlar' : 'Project records'}</small></div><item.Icon size={18} /></button>)}</div>
        <div className="studio-overview-grid">
          <div>
            <GrowthCoach key={coachKey} workspace={workspace} lang={lang} onChange={load}/>
            <CoachWeeklyReview workspace={workspace} lang={lang} onChange={() => { load(); setCoachKey(value => value + 1); }}/>
            <CoachRefresh key={`refresh-${coachKey}`} workspace={workspace} lang={lang} onChange={() => { load(); setCoachKey(value => value + 1); }}/>
            {workspace.project.productPack === 'standard' && <CoachMyWork lang={lang}/>}
            <section className="studio-band">
              <div className="studio-section-title"><h2>{tr ? 'Sıradaki işler' : 'Next up'}</h2><button className="studio-text-button" disabled={!enabled('calendar')} onClick={() => onNavigate('calendar')}>{tr ? 'Tüm işler' : 'All tasks'}<ArrowUpRight size={15} /></button></div>
              {tasks.slice(0,4).map(item => <div className="overview-work-row" key={item.id}><div className="work-day"><strong>{new Date(item.dueAt).toLocaleDateString(locale,{day:'2-digit',timeZone:workspace.project.timezone})}</strong><small>{new Date(item.dueAt).toLocaleDateString(locale,{month:'short',timeZone:workspace.project.timezone})}</small></div><div><h3>{item.title}</h3><p>{new Date(item.dueAt).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',timeZone:workspace.project.timezone})}{item.note ? ` · ${item.note}` : ''}</p></div><span className="work-status">{item.status === 'in_progress' ? (tr ? 'Devam ediyor' : 'In progress') : (tr ? 'Planlandı' : 'Planned')}</span></div>)}
              {tasks.length === 0 && <div className="studio-empty"><CalendarDays size={26} /><p>{tr ? 'Sıradaki iş için yer hazır.' : 'Ready for your next task.'}</p>{enabled('calendar') && <button className="studio-text-button" onClick={() => onNavigate('calendar')}>{tr ? 'İlk işi planla' : 'Plan your first task'}<ArrowRight size={14} /></button>}</div>}
            </section>
            <section className="studio-band"><div className="studio-section-title"><h2>{tr ? 'Son hareketler' : 'Recent activity'}</h2>{enabled('project') && <button className="studio-text-button" onClick={() => onNavigate('project')}>{tr ? 'Proje ayarları' : 'Project settings'}<ArrowUpRight size={15} /></button>}</div>{data.activity.slice(0,5).map((item,index) => <div key={`${item.createdAt}-${index}`} className="ryz-activity-row"><span /><span title={item.operation}>{activityLabels[item.operation]?.[tr?0:1] || (tr?'Proje işlemi kaydedildi':'Project activity recorded')}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString(locale,{day:'numeric',month:'short',timeZone:workspace.project.timezone})}</time></div>)}{data.activity.length===0 && <div className="studio-empty"><p>{tr ? 'Henüz bir hareket kaydı yok.' : 'No activity recorded yet.'}</p></div>}</section>
            <section className="studio-band overview-growth">
              <div className="studio-section-title"><h2>{tr ? 'Büyüme hedefleri' : 'Growth goals'}</h2><button className="studio-text-button" disabled={!enabled('analytics')} onClick={() => onNavigate('analytics')}>{tr ? 'Raporu aç' : 'Open report'}<ArrowUpRight size={15} /></button></div>
              {workspace.project.goals.map(goal => <article key={goal.id} className="overview-goal"><div className="overview-goal-heading"><div><h3>{goal.label[lang]}</h3><p>{goal.audience[lang]}</p></div><span className="studio-badge">{tr ? 'Manuel ölçümler' : 'Manual measurements'}</span></div><ol className="overview-stages" tabIndex={0} aria-label={tr ? `${goal.label[lang]} aşamaları` : `${goal.label[lang]} stages`}>{goal.stages.map((stage,index) => {
                const latest = data.metrics.filter(metric => metric.goalId === goal.id && metric.stageIndex === index).sort((a,b) => b.observedAt.localeCompare(a.observedAt))[0];
                return <li key={index}><span>{stage[lang]}</span><strong>{latest ? latest.value.toLocaleString(locale) : '—'}</strong><small>{latest ? new Date(latest.observedAt).toLocaleDateString(locale,{day:'numeric',month:'short',timeZone:workspace.project.timezone}) : (tr ? 'Ölçüm yok' : 'No measurement')}</small></li>;
              })}</ol></article>)}
              {workspace.project.goals.length === 0 && <div className="studio-empty"><Target size={26} /><p>{tr ? 'Ürününüz için bir büyüme hedefi belirleyin.' : 'Set a growth goal for your product.'}</p><button className="studio-text-button" disabled={!enabled('project')} onClick={() => onNavigate('project')}>{tr ? 'Hedef ekle' : 'Add a goal'}<ArrowRight size={14} /></button></div>}
            </section>
          </div>
          <aside className="overview-rail">
            <CompassOverview lang={lang}/>
            <section><h2>{tr ? 'Hızlı başlangıç' : 'Quick start'}</h2>{[{tab:'library',Icon:FolderOpen,label:tr?'İçerik taslağı hazırla':'Prepare content'},{tab:'calendar',Icon:CalendarDays,label:tr?'Bir sonraki işi planla':'Plan your next task'},{tab:'seo',Icon:CircleDashed,label:tr?'Web sitenizi denetle':'Audit your website'}].filter(item => enabled(item.tab as ModuleId)).map(item => <button key={item.tab} className="overview-quick-action" onClick={() => onNavigate(item.tab as ModuleId)}><item.Icon size={17} /><span>{item.label}</span><ArrowUpRight size={14} /></button>)}</section>
          </aside>
        </div>
      </>}
    </section>
  );
}
