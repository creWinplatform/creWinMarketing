'use client';
import { useState, useEffect, useCallback } from 'react';
import Script from 'next/script';
import dynamic from 'next/dynamic';
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
const SocialTab = dynamic(() => import('@/components/tabs/SocialTab'), {
  loading: TabLoading,
});
const GrowthTab = dynamic(() => import('@/components/tabs/GrowthTab'), {
  loading: TabLoading,
});
const RetentionTab = dynamic(() => import('@/components/tabs/RetentionTab'), {
  loading: TabLoading,
});
const SeoTab = dynamic(() => import('@/components/tabs/SeoTab'), {
  loading: TabLoading,
});
const AdsTab = dynamic(() => import('@/components/tabs/AdsTab'), {
  loading: TabLoading,
});
const CampaignHubTab = dynamic(
  () => import('@/components/tabs/CampaignHubTab'),
  { loading: TabLoading },
);
const MessagingTab = dynamic(() => import('@/components/tabs/MessagingTab'), {
  loading: TabLoading,
});
const TelegramBotTab = dynamic(
  () => import('@/components/tabs/TelegramBotTab'),
  { loading: TabLoading },
);
const JobBotTab = dynamic(() => import('@/components/tabs/JobBotTab'), {
  loading: TabLoading,
});
const PipelineTab = dynamic(() => import('@/components/tabs/PipelineTab'), {
  loading: TabLoading,
});
const AnalyticsTab = dynamic(() => import('@/components/tabs/AnalyticsTab'), {
  loading: TabLoading,
});
const KpiTab = dynamic(() => import('@/components/tabs/KpiTab'), {
  loading: TabLoading,
});
const CalendarTab = dynamic(() => import('@/components/tabs/CalendarTab'), {
  loading: TabLoading,
});
const DashboardTab = dynamic(() => import('@/components/tabs/DashboardTab'), {
  loading: TabLoading,
});
const FirmaKrediTab = dynamic(() => import('@/components/tabs/FirmaKrediTab'), {
  loading: TabLoading,
});
const ContentLibraryTab = dynamic(
  () => import('@/components/tabs/ContentLibraryTab'),
  { loading: TabLoading },
);
const ProfileFillRatePanel = dynamic(
  () => import('@/components/ProfileFillRatePanel'),
  { loading: TabLoading },
);
const BreakdownPanel = dynamic(() => import('@/components/BreakdownPanel'), {
  loading: TabLoading,
});
const ProjectCampaignCenter=dynamic(()=>import('@/components/platform/ProjectCampaignCenter'),{loading:TabLoading});
const MobileGrowthCenter=dynamic(()=>import('@/components/platform/MobileGrowthCenter'),{loading:TabLoading});

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
    </WorkspaceShell>
    </JobGuideProvider>
    </GrowthCompassProvider>
  );
}
