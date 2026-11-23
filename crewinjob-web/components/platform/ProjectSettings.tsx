'use client';
import { useEffect, useState } from 'react';
import { lazyTab } from '@/components/lazy-tab';
import { Building2, Plug, UsersRound, ArrowUpRight, Database, Gauge, Palette, Activity, ShieldCheck, Rocket, Shapes, Handshake } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { localeTag } from '@/lib/i18n/shared';
import GroupedTabs, { type TabItem } from './GroupedTabs';
import TeamAdministration from './TeamAdministration';
import ProjectConnections from './ProjectConnections';
import ProjectProfileEditor from './ProjectProfileEditor';
import AccountSettings from './AccountSettings';
import CoachBrandStudio from './CoachBrandStudio';
import IysPanel from './IysPanel';
import GoLivePanel from './GoLivePanel';
import { iysEnabled } from '@/lib/platform/iys-types';
import { ryzevoFeature } from '@/lib/platform/ryzevo-features';
const BrandKitPanel=lazyTab(() => import('./BrandKitPanel'));
const ProductDataSources=lazyTab(() => import('./ProductDataSources'));
const ProjectPlan=lazyTab(() => import('./ProjectPlan'));
const ProjectBilling=lazyTab(() => import('./ProjectBilling'));
const LiveBilling=lazyTab(() => import('./LiveBilling'));
const ProjectAccountInvites=lazyTab(() => import('./ProjectAccountInvites'));
const AgencyLinksPanel=lazyTab(() => import('./AgencyLinksPanel'));
const ExpertRequests=lazyTab(() => import('./ExpertRequests'));
const OperatorConsole=lazyTab(() => import('./OperatorConsole'));
export default function ProjectSettings({
  workspace,
  lang,
  onUpdate,
}: {
  workspace: WorkspaceContext;
  lang: Locale;
  onUpdate?: (workspace: WorkspaceContext) => void;
}) {
  const tr = lang === 'tr',
    project = workspace.project,
    [section, setSection] = useState('profile');
  // The Crewin workspace's single account gets Ryzevo's Google and Meta connections, the brand studio and signed product
  // events (ryzevoFeature); REST data sources and the plan stay with standard projects.
  const crewin = project.productPack === 'crewin' && workspace.accessMode === 'legacy_single_account',
    brandOpen = (workspace.accessMode === 'platform_account' && project.productPack === 'standard') || (crewin && ryzevoFeature(project.productPack, 'brand')),
    // Crewin declares and connects İYS for its own WhatsApp sender.
    iysOpen = iysEnabled() && ((workspace.accessMode === 'platform_account' && project.productPack === 'standard') || (crewin && ryzevoFeature(project.productPack, 'iys')));
  const canConnections =
      (workspace.accessMode === 'platform_account' || crewin) &&
      workspace.permissions?.includes('connections.manage'),
    dataOpen = canConnections && (project.productPack === 'standard' || (crewin && ryzevoFeature(project.productPack, 'product_events'))),
    // The go-live panel: connection managers of standard projects.
    goLiveOpen = Boolean(canConnections) && workspace.accessMode === 'platform_account' && project.productPack === 'standard',
    canTeam = workspace.permissions?.includes('members.manage'),
    // The deployment administrator (the team running Ryzevo) also gets the operator console.
    canOperate = workspace.accessMode === 'legacy_single_account' && canTeam;
  useEffect(() => {
    const url = new URL(window.location.href),
      requested = url.searchParams.get('settings');
    if (
      canConnections &&
      (requested === 'connections' ||
        ['googleConnection', 'socialConnection', 'metaConnection', 'linkedinOrganizationConnection', 'xConnection'].some((key) =>
          url.searchParams.has(key),
        ))
    )
      setSection('connections');
    else if (dataOpen && requested==='data') setSection('data');
    else if(workspace.accessMode==='platform_account'&&project.productPack==='standard'&&requested==='plan')setSection('plan');
    else if(workspace.accessMode==='platform_account'&&project.productPack==='standard'&&requested==='experts')setSection('experts');
    else if(brandOpen&&requested==='brand')setSection('brand');
    else if(brandOpen&&requested==='brandkit')setSection('brandkit');
    else if(goLiveOpen&&requested==='golive')setSection('golive');
    else if(iysOpen&&requested==='iys')setSection('iys');
    else if (canOperate && requested === 'operations') setSection('operations');
    else if (
      requested === 'team' &&
      (canTeam || workspace.accessMode === 'platform_account')
    )
      setSection('team');
  }, [canConnections, canTeam, canOperate, brandOpen, iysOpen, workspace.accessMode, project.productPack]);
  return (
    <section className="min-w-0">
      <header className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">
            {workspace.organization.name.toLocaleUpperCase(localeTag(lang))}
          </p>
          <h1>{tr ? 'Proje ayarları' : 'Project settings'}</h1>
          <p className="studio-subtitle">
            {project.name} · {project.timezone}
          </p>
        </div>
        <a
          className="studio-secondary"
          href={project.website}
          target="_blank"
          rel="noreferrer"
        >
          {tr ? 'Web sitesini aç' : 'Open website'}
          <ArrowUpRight size={15} />
        </a>
      </header>
      {(() => {
        // The sections in five plain groups; a section the member cannot open is left out, and so is an empty group.
        const show = (id: string) => ({ profile: true, connections: canConnections, data: dataOpen, brand: brandOpen, brandkit: brandOpen, golive: goLiveOpen, iys: iysOpen,
          plan: workspace.accessMode === 'platform_account' && project.productPack === 'standard', experts: workspace.accessMode === 'platform_account' && project.productPack === 'standard',
          operations: Boolean(canOperate), team: canTeam || workspace.accessMode === 'platform_account' } as Record<string, boolean>)[id];
        const item = (id: string, Icon: TabItem<string>['Icon'], label: string) => show(id) ? [{ id, Icon, label }] : [];
        return <GroupedTabs name="settings" label={tr ? 'Ayar bölümleri' : 'Settings sections'} value={section} onChange={id => { setSection(id); const url = new URL(window.location.href); url.searchParams.set('settings', id); window.history.replaceState({}, '', url); }} groups={[
          { id: 'project', Icon: Building2, label: tr ? 'Ürün ve marka' : 'Product & brand', hint: tr ? 'Ürününüzü, hedeflerinizi, marka dilinizi ve logo-renklerinizi tanımlayın; AI taslakları ve tasarımlar buradan beslenir.' : 'Describe your product, goals, brand voice, logo and colours; AI drafts and designs use them.',
            items: [...item('profile', Building2, tr ? 'Ürün & hedefler' : 'Product & goals'), ...item('brand', Palette, tr ? 'Marka dili & rakipler' : 'Brand voice & competitors'), ...item('brandkit', Shapes, tr ? 'Marka kiti' : 'Brand kit')] },
          { id: 'connections', Icon: Plug, label: tr ? 'Bağlantılar ve izinler' : 'Connections & consent', hint: tr ? 'Sosyal hesaplar, Google, e-posta ve ürün verisi bağlantıları; Türkiye’deki alıcılar için İYS izinleri.' : 'Social accounts, Google, email and product data connections; İYS consents for recipients in Turkey.',
            items: [...item('connections', Plug, tr ? 'Hesap bağlantıları' : 'Account connections'), ...item('data', Database, tr ? 'Ürün verisi' : 'Product data'), ...item('iys', ShieldCheck, tr ? 'Gönderim izinleri (İYS)' : 'Sending consents (IYS)')] },
          { id: 'team', Icon: UsersRound, label: tr ? 'Ekip ve plan' : 'Team & plan', hint: tr ? 'Ekip arkadaşlarını rolleriyle davet edin; planınızı, kullanımınızı ve ödemeyi yönetin.' : 'Invite teammates with their roles; manage your plan, usage and payment.',
            items: [...item('team', UsersRound, tr ? 'Ekip & erişim' : 'Team & access'), ...item('plan', Gauge, tr ? 'Plan & kullanım' : 'Plan & usage')] },
          { id: 'golive', Icon: Rocket, label: tr ? 'Kurulum' : 'Setup', hint: tr ? 'Gerçek gönderim ve yayından önce eksikleri tek listede görün.' : 'See what is missing before real sending and publishing, in one list.',
            items: [...item('golive', Rocket, tr ? 'Canlıya geçiş' : 'Go-live'), ...item('operations', Activity, tr ? 'Operasyon' : 'Operations')] },
          { id: 'experts', Icon: Handshake, label: tr ? 'Uzman iste' : 'Ask an expert', hint: tr ? 'Tasarım, reklam veya içerik için ajans ve uzmanlardan iş isteyin.' : 'Ask agencies and experts for design, ads or content work.',
            items: item('experts', Handshake, tr ? 'Uzman iste' : 'Ask an expert') },
        ]} />;
      })()}
      {section === 'profile' && (
        <div className="space-y-7 mt-6">
          <dl className="studio-project-profile">
            {[
              [
                tr ? 'Organizasyon' : 'Organization',
                workspace.organization.name,
              ],
              [tr ? 'Ürün' : 'Product', project.name],
              [tr ? 'Web sitesi' : 'Website', project.website],
              [
                tr ? 'İçerik dili' : 'Content language',
                project.language === 'en' ? 'English' : 'Türkçe',
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {project.productPack === 'standard' &&
            workspace.permissions?.includes('connections.manage') && (
              <ProjectProfileEditor
                key={project.id}
                workspace={workspace}
                lang={lang}
                onUpdate={onUpdate}
              />
            )}
          <section className="studio-band">
            <div className="studio-section-title">
              <h2>{tr ? 'Büyüme hedefleri' : 'Growth goals'}</h2>
            </div>
            {project.goals.map((goal) => (
              <article key={goal.id} className="studio-goal-row">
                <div>
                  <strong>{goal.label[lang]}</strong>
                  <p>{goal.audience[lang]}</p>
                </div>
                <ol>
                  {goal.stages.map((stage, index) => (
                    <li key={index}>
                      <span>{index + 1}</span>
                      {stage[lang]}
                    </li>
                  ))}
                </ol>
              </article>
            ))}
            {project.goals.length === 0 && (
              <p className="studio-note">
                {tr
                  ? 'Henüz büyüme hedefi yok. Ürün ayarlarından ekleyin.'
                  : 'No growth goals yet. Add them in product settings.'}
              </p>
            )}
          </section>
          <section className="studio-band">
            <div className="studio-section-title">
              <h2>{tr ? 'Etkin araçlar' : 'Enabled tools'}</h2>
            </div>
            <div className="studio-table-scroll" tabIndex={0} role="region" aria-label={tr ? 'Etkin araçlar tablosu' : 'Enabled tools table'}>
              <table className="studio-table">
                <thead>
                  <tr>
                    <th>{tr ? 'Araç' : 'Tool'}</th>
                    <th>{tr ? 'Kapsam' : 'Scope'}</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.modules.map((module) => (
                    <tr key={module.id}>
                      <td>{module.label[lang]}</td>
                      <td>
                        {module.scope === 'crewin'
                          ? tr
                            ? 'Crewin ürün paketi'
                            : 'Crewin product pack'
                          : tr
                            ? 'Ortak çalışma alanı'
                            : 'Shared workspace'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
      {section === 'connections' && canConnections && (
        <div className="mt-6">
          <ProjectConnections lang={lang} crewin={crewin} />
        </div>
      )}
      {section === 'operations' && canOperate && <div className="mt-6"><OperatorConsole lang={lang} /></div>}
      {section === 'team' && (
        <div className="mt-6">
          {canTeam && (
            <TeamAdministration
              lang={lang}
              canProvision={workspace.accessMode === 'legacy_single_account'}
              inviteOnly
            />
          )}
          {canTeam && workspace.project.productPack === 'standard' && <ProjectAccountInvites lang={lang} isOwner={workspace.permissions?.includes('billing.manage') || false} />}
          <AccountSettings workspace={workspace} lang={lang} />
        </div>
      )}
      {section === 'data' && dataOpen && <ProductDataSources key={project.id} lang={lang} webhookOnly={crewin} />}
      {section==='golive'&&goLiveOpen&&<div className="mt-6"><GoLivePanel key={'golive-'+project.id} lang={lang}/></div>}
      {section==='iys'&&iysOpen&&<div className="mt-6"><IysPanel key={'iys-'+project.id} lang={lang} crewin={crewin}/></div>}
      {section==='brandkit'&&brandOpen&&<div className="mt-6"><BrandKitPanel key={'brandkit-'+project.id} lang={lang} projectName={project.name} projectId={project.id}/></div>}
      {section==='brand'&&brandOpen&&<div className="mt-6"><CoachBrandStudio key={'brand-'+project.id} workspace={workspace} lang={lang} onUpdate={onUpdate}/></div>}
      {section==='experts'&&workspace.accessMode==='platform_account'&&project.productPack==='standard'&&<div className="mt-6"><ExpertRequests key={'experts-'+project.id} lang={lang}/></div>}
      {section==='plan'&&workspace.accessMode==='platform_account'&&project.productPack==='standard'&&<ProjectPlan key={'plan-'+project.id} lang={lang}/>}
      {section==='plan'&&workspace.accessMode==='platform_account'&&project.productPack==='standard'&&workspace.permissions?.includes('billing.manage')&&<AgencyLinksPanel key={'agency-links-'+project.id} lang={lang}/>}
      {section==='plan'&&workspace.accessMode==='platform_account'&&project.productPack==='standard'&&workspace.permissions?.includes('billing.manage')&&<LiveBilling key={'live-billing-'+project.id} lang={lang}/>}
      {section==='plan'&&workspace.accessMode==='platform_account'&&project.productPack==='standard'&&workspace.permissions?.includes('billing.manage')&&<ProjectBilling key={'billing-'+project.id} lang={lang}/>}
    </section>
  );
}
