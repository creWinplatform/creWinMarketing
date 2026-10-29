'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Building2, Plug, UsersRound, ArrowUpRight, Database, Gauge, Palette, Activity } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { localeTag } from '@/lib/i18n/shared';
import TeamAdministration from './TeamAdministration';
import ProjectConnections from './ProjectConnections';
import ProjectProfileEditor from './ProjectProfileEditor';
import AccountSettings from './AccountSettings';
import CoachBrandStudio from './CoachBrandStudio';
import { ryzevoFeature } from '@/lib/platform/ryzevo-features';
const ProductDataSources=dynamic(()=>import('./ProductDataSources'));
const ProjectPlan=dynamic(()=>import('./ProjectPlan'));
const ProjectBilling=dynamic(()=>import('./ProjectBilling'));
const LiveBilling=dynamic(()=>import('./LiveBilling'));
const ProjectAccountInvites=dynamic(()=>import('./ProjectAccountInvites'));
const AgencyLinksPanel=dynamic(()=>import('./AgencyLinksPanel'));
const OperatorConsole=dynamic(()=>import('./OperatorConsole'));
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
  // The Crewin workspace's single account gets Ryzevo's Google and Meta connections and the brand studio (ryzevoFeature);
  // product data and plan stay with standard projects.
  const crewin = project.productPack === 'crewin' && workspace.accessMode === 'legacy_single_account',
    brandOpen = (workspace.accessMode === 'platform_account' && project.productPack === 'standard') || (crewin && ryzevoFeature(project.productPack, 'brand'));
  const canConnections =
      (workspace.accessMode === 'platform_account' || crewin) &&
      workspace.permissions?.includes('connections.manage'),
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
    else if (canConnections && project.productPack==='standard' && requested==='data') setSection('data');
    else if(workspace.accessMode==='platform_account'&&project.productPack==='standard'&&requested==='plan')setSection('plan');
    else if(brandOpen&&requested==='brand')setSection('brand');
    else if (canOperate && requested === 'operations') setSection('operations');
    else if (
      requested === 'team' &&
      (canTeam || workspace.accessMode === 'platform_account')
    )
      setSection('team');
  }, [canConnections, canTeam, canOperate, brandOpen, workspace.accessMode, project.productPack]);
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
      <nav
        className="studio-settings-tabs"
        aria-label={tr ? 'Ayar bölümleri' : 'Settings sections'}
      >
        {[
          {
            id: 'profile',
            Icon: Building2,
            label: tr ? 'Ürün & hedefler' : 'Product & goals',
            visible: true,
          },
          {
            id: 'connections',
            Icon: Plug,
            label: tr ? 'Bağlantılar' : 'Connections',
            visible: canConnections,
          },
          {
            id: 'data',
            Icon: Database,
            label: tr ? 'Ürün verisi' : 'Product data',
            visible: canConnections && project.productPack==='standard',
          },
          {
            id:'brand',Icon:Palette,label:tr?'Marka dili & rakipler':'Brand voice & competitors',
            visible:brandOpen,
          },
          {
            id:'plan',Icon:Gauge,label:tr?'Plan & kullanım':'Plan & usage',
            visible:workspace.accessMode==='platform_account'&&project.productPack==='standard',
          },
          {
            id: 'operations',
            Icon: Activity,
            label: tr ? 'Operasyon' : 'Operations',
            visible: Boolean(canOperate),
          },
          {
            id: 'team',
            Icon: UsersRound,
            label: tr ? 'Ekip & erişim' : 'Team & access',
            visible: canTeam || workspace.accessMode === 'platform_account',
          },
        ]
          .filter((item) => item.visible)
          .map(({ id, Icon, label }) => (
            <button
              key={id}
              aria-current={section === id ? 'page' : undefined}
              onClick={() => {
                setSection(id);
                const url = new URL(window.location.href);
                url.searchParams.set('settings', id);
                window.history.replaceState({}, '', url);
              }}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
      </nav>
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
      {section === 'data' && canConnections && project.productPack==='standard' && <ProductDataSources key={project.id} lang={lang} />}
      {section==='brand'&&brandOpen&&<div className="mt-6"><CoachBrandStudio key={'brand-'+project.id} workspace={workspace} lang={lang} onUpdate={onUpdate}/></div>}
      {section==='plan'&&workspace.accessMode==='platform_account'&&project.productPack==='standard'&&<ProjectPlan key={'plan-'+project.id} lang={lang}/>}
      {section==='plan'&&workspace.accessMode==='platform_account'&&project.productPack==='standard'&&workspace.permissions?.includes('billing.manage')&&<AgencyLinksPanel key={'agency-links-'+project.id} lang={lang}/>}
      {section==='plan'&&workspace.accessMode==='platform_account'&&project.productPack==='standard'&&workspace.permissions?.includes('billing.manage')&&<LiveBilling key={'live-billing-'+project.id} lang={lang}/>}
      {section==='plan'&&workspace.accessMode==='platform_account'&&project.productPack==='standard'&&workspace.permissions?.includes('billing.manage')&&<ProjectBilling key={'billing-'+project.id} lang={lang}/>}
    </section>
  );
}
