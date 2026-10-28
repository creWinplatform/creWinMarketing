'use client';
import { ArrowRight, ArrowUpRight, BarChart3, CalendarClock, Check, Compass, FolderOpen, HelpCircle, LockKeyhole, Mail, Megaphone, MessagesSquare, Search, ShieldCheck, UserPlus } from 'lucide-react';
import type { Locale, ModuleId, WorkspaceContext } from '@/lib/platform/catalog';
import { useCompassState } from './GrowthCompass';

// One answer to "what do I do now?": the growth diagnosis, then approving the strategy, then the Compass path's next
// verified step. Progress comes from project records (the Compass), never from a click here.
export function useGuidedStage() {
  const compass = useCompassState(), data = compass?.data;
  if (!compass || !data) return { compass, data, stage: null as null };
  const stage = !data.coach.hasBrief ? (data.coach.hasDraft ? 'approve' : data.coach.canDiagnose ? 'diagnose' : 'waiting') : !data.preferences ? 'path' : data.nextStepId ? 'step' : 'done';
  return { compass, data, stage: stage as 'diagnose' | 'approve' | 'waiting' | 'path' | 'step' | 'done' };
}
const openCoach = () => window.dispatchEvent(new Event('ryzevo:coach-open'));

export function NextStepCard({ lang }: { lang: Locale }) {
  const tr = lang === 'tr', { compass, data, stage } = useGuidedStage();
  if (!compass) return null;
  if (!data) return <section className="guided-start" aria-busy={compass.loading}><p role="status">{compass.error ? (tr ? 'Rehber şu an yüklenemedi; araçları menüden kullanabilirsiniz.' : 'The guide could not load; you can use the tools from the menu.') : (tr ? 'Sıradaki adımınız hazırlanıyor…' : 'Preparing your next step…')}</p></section>;
  const next = data.steps.find(item => item.id === data.nextStepId);
  // Diagnosis and approval come before the Compass path; they are counted in the same progress line.
  const done = (data.coach.hasDraft || data.coach.hasBrief ? 1 : 0) + (data.coach.hasBrief ? 1 : 0) + (data.preferences ? data.completed : 0);
  const total = 2 + (data.preferences ? data.total : 0);
  const body = {
    diagnose: { eyebrow: tr ? 'Adım 1 · yaklaşık 5 dakika' : 'Step 1 · about 5 minutes', title: tr ? 'Önce ürününüzü tanıyalım' : 'First, tell us about your product', text: tr ? 'Ana hedefinizi seçip 11 kısa soruyu yanıtlayın. Ryzevo yanıtlarınızdan ideal müşteri, öncelikli kanallar ve 30 günlük bir plan içeren strateji taslağı hazırlar; siz inceleyip onaylarsınız.' : 'Pick your main goal and answer 11 short questions. Ryzevo drafts a strategy with your ideal customer, priority channels and a 30-day plan; you review and approve it.' },
    approve: { eyebrow: tr ? 'Adım 2' : 'Step 2', title: tr ? 'Strateji taslağınız hazır' : 'Your strategy draft is ready', text: tr ? 'Taslağı okuyun, istediğiniz satırı düzeltin ve onaylayın. Onaydan sonra rotanız ve ilk haftanın işleri burada görünür.' : 'Read the draft, edit any line and approve it. After approval your path and the first week’s work appear here.' },
    waiting: { eyebrow: tr ? 'Kurulum' : 'Setup', title: tr ? 'Strateji henüz hazırlanmadı' : 'No strategy yet', text: tr ? 'Teşhisi içerik yetkisi olan bir ekip üyesi başlatır. Strateji onaylanınca rotanız burada görünecek; o zamana kadar aşağıdaki araçları inceleyebilirsiniz.' : 'A teammate with content permission starts the diagnosis. Once the strategy is approved your path appears here; meanwhile you can look around the tools below.' },
    path: { eyebrow: tr ? 'Adım 3' : 'Step 3', title: tr ? 'Rotanızı oluşturun' : 'Build your path', text: tr ? 'Strateji onaylandı. Pusula, seçtiğiniz hedefe göre hesap bağlama, ilk içerik, prova ve ölçüm adımlarını sıralar.' : 'The strategy is approved. The Compass orders the steps for your goal: connecting accounts, first content, rehearsal and measurement.' },
    step: { eyebrow: tr ? 'Sıradaki adımınız' : 'Your next step', title: next?.label[lang] || '', text: next?.reason?.[lang] || next?.detail[lang] || '' },
    done: { eyebrow: tr ? 'Kurulum tamamlandı' : 'Setup complete', title: tr ? 'Rotanızın bütün adımları doğrulandı' : 'Every step of your path is verified', text: tr ? 'Bundan sonra burada dikkat isteyen konular, onayınızı bekleyen işler ve bu haftanın planı öne çıkar.' : 'From now on, items that need attention, decisions waiting for you and this week’s plan come first here.' },
  }[stage!];
  const primary = stage === 'diagnose' ? <button type="button" className="studio-primary" onClick={openCoach}>{tr ? 'Teşhise başla' : 'Start the diagnosis'}<ArrowRight size={16} /></button>
    : stage === 'approve' ? <button type="button" className="studio-primary" onClick={openCoach}>{tr ? 'Taslağı incele' : 'Review the draft'}<ArrowRight size={16} /></button>
    : stage === 'path' ? <button type="button" className="studio-primary" onClick={compass.open}>{tr ? 'Rotamı oluştur' : 'Build my path'}<ArrowRight size={16} /></button>
    : stage === 'step' && next ? (next.id === 'goal' || next.id === 'channels' ? <button type="button" className="studio-primary" onClick={compass.open}>{tr ? 'Seçimi yap' : 'Make the choice'}<ArrowRight size={16} /></button>
      : next.canAct ? <a className="studio-primary" href={next.href}>{tr ? 'Bu adıma git' : 'Go to this step'}<ArrowRight size={16} /></a>
      : <span className="guided-start-blocked"><LockKeyhole size={14} />{tr ? 'Bu adımı yetkili bir ekip üyesi yapmalı.' : 'An authorized teammate must do this step.'}</span>)
    : null;
  return <section className={`guided-start guided-start-${stage}`} aria-labelledby="guided-start-title">
    <div className="guided-start-copy">
      <p className="guided-start-eyebrow">{stage === 'done' ? <Check size={14} /> : <Compass size={14} />}{body.eyebrow}</p>
      <h2 id="guided-start-title">{body.title}</h2>
      <p>{body.text}</p>
      <div className="guided-start-actions">
        {primary}
        {stage === 'step' && next?.provider && <button type="button" className="studio-text-button" onClick={() => compass.guide(next.provider!)}><HelpCircle size={14} />{tr ? 'Hesap / izin rehberi' : 'Account / access guide'}</button>}
        {(stage === 'step' || stage === 'done') && <a className="studio-text-button guided-start-other" href="#task-launcher">{tr ? 'Başka bir iş yapacağım' : 'I want to do something else'}<ArrowRight size={14} /></a>}
        {(stage === 'step' || stage === 'done') && <button type="button" className="studio-text-button" onClick={compass.open}>{stage === 'done' ? (tr ? 'Rotayı veya hedefi değiştir' : 'Change path or goal') : (tr ? 'Bütün rotayı gör' : 'See the whole path')}<ArrowRight size={14} /></button>}
      </div>
    </div>
    <div className="guided-start-progress">
      <strong>{done}<small> / {total}</small></strong>
      <span>{tr ? 'kurulum adımı' : 'setup steps'}</span>
      <progress max={total} value={done} aria-label={tr ? 'Doğrulanmış kurulum adımları' : 'Verified setup steps'} />
      <small className="guided-start-safety"><ShieldCheck size={13} />{tr ? 'Hiçbir şey kendiliğinden yayınlanmaz veya gönderilmez.' : 'Nothing is published or sent automatically.'}</small>
    </div>
  </section>;
}

type Task = { id: string; tab: ModuleId; href: string; Icon: typeof FolderOpen; label: [string, string]; hint: [string, string]; permission?: string; needs?: { ok: boolean; label: [string, string]; href: string; permission: string } };
// Common jobs with the screen that does them. A missing prerequisite (an account to connect) is named first, with a
// link to where it is set up, so nobody lands on a screen that cannot do the job yet.
export function TaskLauncher({ workspace, lang, connections }: { workspace: WorkspaceContext; lang: Locale; connections: string[] }) {
  const tr = lang === 'tr', idx = tr ? 0 : 1, can = (permission?: string) => !permission || Boolean(workspace.permissions?.includes(permission as never));
  const enabled = (id: ModuleId) => workspace.modules.some(module => module.id === id), has = (...providers: string[]) => providers.some(provider => connections.includes(provider));
  const social = { ok: has('social', 'x'), label: ['Önce bir sosyal hesap bağlayın', 'Connect a social account first'] as [string, string], href: '/?tab=project&settings=connections', permission: 'connections.manage' };
  const tasks: Task[] = [
    { id: 'content', tab: 'library', href: '/?tab=library', Icon: FolderOpen, label: ['Paylaşım hazırla', 'Prepare a post'], hint: ['Kendiniz yazın veya AI ile taslak çıkarın; başka kanallara da uyarlayabilirsiniz.', 'Write it yourself or draft it with AI; adapt it for other channels too.'], permission: 'content.write' },
    { id: 'publish', tab: 'calendar', href: '/?tab=calendar&planning=social', Icon: CalendarClock, label: ['Paylaşımı planla ve yayınla', 'Schedule and publish'], hint: ['Onaylı taslağı takvime koyun; önce prova, sonra gerçek yayın.', 'Put an approved draft on the calendar; rehearse first, then publish.'], needs: social },
    { id: 'inbox', tab: 'campaigns', href: '/?tab=campaigns&campaignView=inbox', Icon: MessagesSquare, label: ['Mesaj ve yorumları yanıtla', 'Answer messages and comments'], hint: ['Gelen kutusu tek yerde; yanıtlar onaydan sonra gider.', 'One inbox; replies go only after approval.'], needs: social },
    { id: 'search', tab: 'seo', href: '/?tab=seo', Icon: Search, label: ['Google’da ve AI aramalarında görün', 'Be found on Google and in AI answers'], hint: has('search_console', 'google') ? ['Site taraması, Search Console fırsatları ve içerik konuları.', 'Site scan, Search Console opportunities and content topics.'] : ['Site taramasıyla başlayın; Search Console bağlarsanız gerçek arama verisi de gelir.', 'Start with a site scan; connect Search Console for real search data.'] },
    { id: 'email', tab: 'campaigns', href: '/?tab=campaigns', Icon: Mail, label: ['E-posta kampanyası', 'Email campaign'], hint: ['Kitleyi seçin, içeriği onaylayın, önce sınırlı pilotla gönderin.', 'Choose the audience, approve the content, send a bounded pilot first.'], needs: { ok: has('email'), label: ['Önce gönderen e-posta hesabını bağlayın', 'Connect a sender account first'], href: '/?tab=campaigns&campaignView=sender', permission: 'connections.manage' } },
    { id: 'ads', tab: 'campaigns', href: '/?tab=campaigns&campaignView=ads', Icon: Megaphone, label: ['Reklam planla', 'Plan an ad'], hint: ['Bütçe tavanıyla plan; kampanya duraklatılmış oluşturulur, başlatmak ayrıca onaylanır.', 'A plan with a spend cap; campaigns are created paused and starting needs separate approval.'], permission: 'campaign.approve' },
    { id: 'results', tab: 'analytics', href: '/?tab=analytics', Icon: BarChart3, label: ['Sonuçları gör', 'See results'], hint: has('google') ? ['Ölçümler, gönderilerden gelen ziyaretler ve aylık rapor.', 'Measurements, visits from posts and the monthly report.'] : ['Google Analytics bağlarsanız sonuçlar kendiliğinden gelir.', 'Connect Google Analytics and results arrive on their own.'] },
    { id: 'team', tab: 'project', href: '/?tab=project&settings=team', Icon: UserPlus, label: ['Ekip arkadaşı davet et', 'Invite a teammate'], hint: ['Rolü siz seçersiniz; her rol yalnız kendi işini görür.', 'You choose the role; each role sees only its own work.'], permission: 'members.manage' },
  ];
  const visible = tasks.filter(task => enabled(task.tab) && can(task.permission));
  if (!visible.length) return null;
  return <section id="task-launcher" className="task-launcher" aria-labelledby="task-launcher-title">
    <h2 id="task-launcher-title">{tr ? 'Ne yapmak istiyorsunuz?' : 'What would you like to do?'}</h2>
    <ul>{visible.map(task => {
      const blocked = task.needs && !task.needs.ok;
      return <li key={task.id}>
        <a className="task-launcher-item" href={blocked && can(task.needs!.permission) ? task.needs!.href : task.href}>
          <task.Icon size={17} aria-hidden="true" />
          <span><strong>{task.label[idx]}</strong><small>{blocked ? (can(task.needs!.permission) ? task.needs!.label[idx] : (tr ? 'Önce yetkili bir ekip üyesi hesap bağlamalı.' : 'An authorized teammate must connect an account first.')) : task.hint[idx]}</small></span>
          {blocked ? <span className="task-launcher-needs">{tr ? 'Ön koşul' : 'Needs setup'}</span> : <ArrowUpRight size={14} aria-hidden="true" />}
        </a>
      </li>;
    })}</ul>
  </section>;
}
