'use client';
import { useState, useEffect, useCallback } from 'react';
import Script from 'next/script';
import { lazyTab } from '@/components/lazy-tab';
import TabErrorBoundary from '@/components/TabErrorBoundary';
import ModelPicker from '@/components/ModelPicker';
import ActivityLogPanel from '@/components/ActivityLogPanel';
import { useLang } from '@/lib/lang';
import Msg from '@/components/Msg';
import { localeTag } from '@/lib/i18n/shared';
import type { StatsResponse } from '@/lib/types';
import { type ModuleId, type WorkspaceContext } from '@/lib/platform/catalog';
import ProjectSettings from '@/components/platform/ProjectSettings';
import ProjectDrafts from '@/components/platform/ProjectDrafts';
import WorkspaceShell from '@/components/platform/WorkspaceShell';
import ProjectOverview from '@/components/platform/ProjectOverview';
import ProjectPlanning from '@/components/platform/ProjectPlanning';
import ProjectReports from '@/components/platform/ProjectReports';
import ProjectAudit from '@/components/platform/ProjectAudit';
import { GrowthCompassProvider, CompassLauncher } from '@/components/platform/GrowthCompass';
import { JobGuideProvider, JobGuideLauncher, JobGuidePanel, JobGuideHighlights } from '@/components/platform/JobGuide';
import CrewinGrowthPanel from '@/components/platform/CrewinGrowthPanel';
import CrewinReportsPanel from '@/components/platform/CrewinReportsPanel';
import CrewinCalendar from '@/components/platform/CrewinCalendar';

function TabLoading() {
  const { lang } = useLang();
  return (
    <div className="studio-skeleton" role="status">
      {lang === 'tr' ? 'Yükleniyor…' : 'Loading…'}
    </div>
  );
}
const SocialTab = lazyTab(() => import('@/components/tabs/SocialTab'), TabLoading);
const GrowthTab = lazyTab(() => import('@/components/tabs/GrowthTab'), TabLoading);
const RetentionTab = lazyTab(() => import('@/components/tabs/RetentionTab'), TabLoading);
const SeoTab = lazyTab(() => import('@/components/tabs/SeoTab'), TabLoading);
const AdsTab = lazyTab(() => import('@/components/tabs/AdsTab'), TabLoading);
const CampaignHubTab = lazyTab(() => import('@/components/tabs/CampaignHubTab'), TabLoading);
const MessagingTab = lazyTab(() => import('@/components/tabs/MessagingTab'), TabLoading);
const TelegramBotTab = lazyTab(() => import('@/components/tabs/TelegramBotTab'), TabLoading);
const JobBotTab = lazyTab(() => import('@/components/tabs/JobBotTab'), TabLoading);
const PipelineTab = lazyTab(() => import('@/components/tabs/PipelineTab'), TabLoading);
const AnalyticsTab = lazyTab(() => import('@/components/tabs/AnalyticsTab'), TabLoading);
const KpiTab = lazyTab(() => import('@/components/tabs/KpiTab'), TabLoading);
const CalendarTab = lazyTab(() => import('@/components/tabs/CalendarTab'), TabLoading);
const DashboardTab = lazyTab(() => import('@/components/tabs/DashboardTab'), TabLoading);
const FirmaKrediTab = lazyTab(() => import('@/components/tabs/FirmaKrediTab'), TabLoading);
const ContentLibraryTab = lazyTab(() => import('@/components/tabs/ContentLibraryTab'), TabLoading);
const ProfileFillRatePanel = lazyTab(() => import('@/components/ProfileFillRatePanel'), TabLoading);
const BreakdownPanel = lazyTab(() => import('@/components/BreakdownPanel'), TabLoading);
const ProjectCampaignCenter=lazyTab(() => import('@/components/platform/ProjectCampaignCenter'), TabLoading);
const MobileGrowthCenter=lazyTab(() => import('@/components/platform/MobileGrowthCenter'), TabLoading);

export default function Home() {
  const { lang } = useLang(),
    tr = lang === 'tr';
  const [activeTab, setActiveTab] = useState<ModuleId>('dashboard'),
    [workspace, setWorkspace] = useState<WorkspaceContext | null>(null),
    [workspaceError, setWorkspaceError] = useState(''),
    [stats, setStats] = useState<StatsResponse | null>(null),
    [statsLoading, setStatsLoading] = useState(false);
  const isCrewin =
    workspace?.accessMode === 'legacy_single_account' &&
    workspace.project.productPack === 'crewin';
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/workspace', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<WorkspaceContext>;
      })
      .then((context) => {
        setWorkspace(context);
        const requested = new URLSearchParams(window.location.search).get(
          'tab',
        );
        setActiveTab(
          context.modules.some((module) => module.id === requested)
            ? (requested as ModuleId)
            : (context.modules[0].id as ModuleId),
        );
      })
      .catch((error) => {
        if (error.name !== 'AbortError')
          setWorkspaceError(
            tr
              ? 'Proje erişimi doğrulanamadı. Yeniden giriş yapın.'
              : 'Could not verify project access. Please sign in again.',
          );
      });
    return () => controller.abort();
  }, [tr]);
  useEffect(() => {
    if (!workspace) return;
    const back = () => {
      const id = new URLSearchParams(window.location.search).get('tab');
      setActiveTab(
        workspace.modules.some((module) => module.id === id)
          ? (id as ModuleId)
          : (workspace.modules[0].id as ModuleId),
      );
    };
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [workspace]);
  const navigate = useCallback(
    (tab: ModuleId) => {
      if (!workspace?.modules.some((module) => module.id === tab)) return;
      setActiveTab(tab);
      const url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      // A sub-view chosen by a link belongs to the tab it was opened for.
      for (const key of ['view', 'section', 'planning', 'seoView', 'campaignView', 'settings']) url.searchParams.delete(key);
      window.history.pushState({}, '', url);
      window.scrollTo({ top: 0 });
    },
    [workspace],
  );
  useEffect(() => {
    if (!isCrewin) return;
    const controller = new AbortController();
    setStatsLoading(true);
    fetch('/api/stats', { signal: controller.signal })
      .then((response) => response.json())
      .then(setStats)
      .catch((error) => {
        if (error.name !== 'AbortError')
          setStats({ error: 'connection_failed', isRealData: false });
      })
      .finally(() => setStatsLoading(false));
    return () => controller.abort();
  }, [isCrewin]);
  // While the workspace loads, the page's shape is drawn (menu, heading, first cards) instead of an empty spinner.
  if (!workspace && !workspaceError)
    return (
      <main className="workspace-skeleton" aria-busy="true">
        <div className="workspace-skeleton-side" aria-hidden="true"><span /><span /><span /><span /><span /><span /></div>
        <div className="workspace-skeleton-main" aria-hidden="true"><span className="ws-bar" /><span className="ws-title" /><span className="ws-card" /><span className="ws-row"><span /><span /><span /></span></div>
        <p role="status" className="sr-only">{tr ? 'Çalışma alanı yükleniyor…' : 'Loading workspace…'}</p>
      </main>
    );
  if (!workspace)
    return (
      <main className="workspace-loading">
        <span className="studio-loader" />
        <p role="status">
          {workspaceError ? <Msg text={workspaceError} /> :
            (tr ? 'Çalışma alanı yükleniyor…' : 'Loading workspace…')}
        </p>
        {workspaceError && (
          <a href="/login" className="studio-primary">
            {tr ? 'Giriş yap' : 'Sign in'}
          </a>
        )}
      </main>
    );
  return (
    <GrowthCompassProvider key={workspace.project.id} enabled={!isCrewin} lang={lang}>
    <JobGuideProvider key={`jobs-${workspace.project.id}`} enabled lang={lang} variant={isCrewin ? 'crewin' : 'ryzevo'}>
    <WorkspaceShell
      workspace={workspace}
      activeTab={activeTab}
      onNavigate={navigate}
      lang={lang}
      guidance={!isCrewin ? <><JobGuideLauncher lang={lang}/><CompassLauncher lang={lang}/></> : <JobGuideLauncher lang={lang}/>}
      tools={
        isCrewin ? (
          <>
            <ActivityLogPanel />
            <ModelPicker />
          </>
        ) : undefined
      }
    >
    {/* A tab that crashes or whose code fails to download shows a card in its own area; the menu keeps working. */}
    <TabErrorBoundary resetKey={activeTab}>
      {isCrewin && (
        <>
          <Script
            src="https://www.googletagmanager.com/gtag/js?id=G-D6XC0PVB32"
            strategy="afterInteractive"
          />
          <Script
            id="crewin-workspace-analytics"
            strategy="afterInteractive"
          >{`window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date()); gtag('config', 'G-D6XC0PVB32');`}</Script>
        </>
      )}
      {isCrewin && activeTab === 'dashboard' && (
        <>
          <DashboardTab onNavigate={navigate} focus={<JobGuideHighlights lang={lang} />} guide={<div className="crewin-overview-actions"><CrewinGrowthPanel workspace={workspace} lang={lang} part="attention" /><JobGuidePanel lang={lang} compact /></div>} />
          <CrewinGrowthPanel workspace={workspace} lang={lang} part="coach" />
          <details className="crewin-detail-disclosure"><summary>{tr ? 'Profil ve şirket verileri: detaylı dağılım' : 'Profile and company data: detailed breakdown'}</summary>
          {statsLoading ? (
            <p className="studio-data-notice" role="status">
              {tr ? 'Crewin verileri yükleniyor…' : 'Loading Crewin data…'}
            </p>
          ) : stats?.error ? (
            <p className="studio-error" role="alert">
              {tr
                ? 'Crewin istatistikleri yüklenemedi. API bağlantısını kontrol edin.'
                : 'Could not load Crewin statistics. Check the API connection.'}
            </p>
          ) : (
            stats && (
              <>
                <div className="studio-data-notice">
                  <span
                    className={`status-dot ${stats.partial ? 'status-dot-amber' : ''}`}
                  />
                  <span>
                    {stats.isRealData
                      ? tr
                        ? 'Crewin canlı verisi'
                        : 'Crewin live data'
                      : tr
                        ? 'Veri doğrulanmadı'
                        : 'Data not verified'}
                    {stats.partial &&
                      ` · ${tr ? 'Kısmi yanıt' : 'Partial response'}`}
                  </span>
                </div>
                <div className="studio-stats crewin-stats">
                  {[
                    [
                      tr ? 'Gemi adamları' : 'Seafarers',
                      stats.seafarers?.total,
                    ],
                    [
                      tr ? 'Son 7 gün kayıt' : 'Registrations / 7d',
                      stats.seafarers?.newThisWeek,
                    ],
                    [tr ? 'İlanlar' : 'Jobs', stats.jobs?.total],
                    [tr ? 'Firmalar' : 'Companies', stats.jobs?.companies],
                  ].map(([label, value]) => (
                    <div className="studio-stat" key={String(label)}>
                      <div>
                        <span>{label}</span>
                        <strong>
                          {typeof value === 'number'
                            ? value.toLocaleString(localeTag(lang))
                            : '—'}
                        </strong>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          )}
          {!statsLoading && stats?.seafarers?.fillRateBuckets && (
            <ProfileFillRatePanel
              buckets={stats.seafarers.fillRateBuckets}
              average={stats.seafarers.profileCompletion || 0}
              isExact={stats.seafarers.profileCompletionIsExact}
            />
          )}
          <BreakdownPanel />
          </details>
        </>
      )}
      {!isCrewin ? (
        <>
          {activeTab === 'dashboard' && (
            <ProjectOverview
              workspace={workspace}
              lang={lang}
              onNavigate={navigate}
            />
          )}
          {activeTab === 'campaigns' && <ProjectCampaignCenter key={workspace.project.id} workspace={workspace} lang={lang}/>}
          {activeTab === 'mobile' && <MobileGrowthCenter key={workspace.project.id} lang={lang}/>}
          {activeTab === 'library' && (
            <ProjectDrafts
              key={`${workspace.project.id}-${activeTab}`}
              kind="content"
              lang={lang}
              contentLanguage={workspace.project.language}
              canWrite={
                workspace.permissions?.includes('content.write') || false
              }
              goals={workspace.project.goals}
            />
          )}
          {activeTab === 'calendar' && (
            <ProjectPlanning workspace={workspace} lang={lang} />
          )}
          {activeTab === 'analytics' && (
            <ProjectReports workspace={workspace} lang={lang} />
          )}
          {activeTab === 'seo' && (
            <ProjectAudit workspace={workspace} lang={lang} />
          )}
          {activeTab === 'project' && (
            <ProjectSettings
              workspace={workspace}
              lang={lang}
              onUpdate={setWorkspace}
            />
          )}
        </>
      ) : (
        <>
          {activeTab === 'project' && (
            <ProjectSettings workspace={workspace} lang={lang} />
          )}
          {activeTab === 'social' && <SocialTab />}
          {activeTab === 'library' && <ContentLibraryTab />}
          {activeTab === 'growth' && <GrowthTab />}
          {activeTab === 'retention' && (
            <RetentionTab segments={stats?.incomplete?.segments} />
          )}
          {activeTab === 'seo' && <SeoTab workspace={workspace} />}
          {activeTab === 'ads' && <AdsTab />}
          {activeTab === 'campaigns' && <CampaignHubTab />}
          {activeTab === 'messaging' && (
            <MessagingTab stats={stats || undefined} />
          )}
          {activeTab === 'telegrambot' && <TelegramBotTab />}
          {activeTab === 'jobbot' && <JobBotTab />}
          {activeTab === 'pipeline' && <PipelineTab />}
          {activeTab === 'analytics' && <><AnalyticsTab /><CrewinReportsPanel workspace={workspace} lang={lang} /></>}
          {activeTab === 'kpi' && <KpiTab stats={stats || undefined} />}
          {activeTab === 'calendar' && <CrewinCalendar workspace={workspace} lang={lang} posts={<CalendarTab />} />}
          {activeTab === 'firma_kredi' && <FirmaKrediTab />}
        </>
      )}
    </TabErrorBoundary>
    </WorkspaceShell>
    </JobGuideProvider>
    </GrowthCompassProvider>
  );
}
