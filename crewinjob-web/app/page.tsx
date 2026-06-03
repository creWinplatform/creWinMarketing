'use client';
import { useState, useEffect } from 'react';
import SocialTab from '@/components/tabs/SocialTab';
import GrowthTab from '@/components/tabs/GrowthTab';
import RetentionTab from '@/components/tabs/RetentionTab';
import SeoTab from '@/components/tabs/SeoTab';
import AdsTab from '@/components/tabs/AdsTab';
import MessagingTab from '@/components/tabs/MessagingTab';
import KpiTab from '@/components/tabs/KpiTab';
import CalendarTab from '@/components/tabs/CalendarTab';
import DashboardTab from '@/components/tabs/DashboardTab';
import ContentLibraryTab from '@/components/tabs/ContentLibraryTab';
import ModelPicker from '@/components/ModelPicker';
import ThemeToggle from '@/components/ThemeToggle';
import ProfileFillRatePanel from '@/components/ProfileFillRatePanel';
import BreakdownPanel from '@/components/BreakdownPanel';
import ActivityLogPanel from '@/components/ActivityLogPanel';
import { LangToggle, useLang } from '@/lib/lang';
import type { StatsResponse } from '@/lib/types';

type Tab = 'dashboard' | 'social' | 'library' | 'growth' | 'retention' | 'seo' | 'ads' | 'messaging' | 'kpi' | 'calendar';

const TAB_LABELS: Record<Tab, { tr: string; en: string }> = {
  dashboard: { tr: 'Dashboard',           en: 'Dashboard' },
  social:    { tr: 'Sosyal Medya',        en: 'Social Media' },
  library:   { tr: 'İçerik Kütüphanesi', en: 'Content Library' },
  growth:    { tr: 'Seafarer Büyüme',     en: 'Seafarer Growth' },
  retention: { tr: 'Retention',           en: 'Retention' },
  seo:       { tr: 'SEO & Blog',          en: 'SEO & Blog' },
  ads:       { tr: 'Reklam',              en: 'Ads' },
  messaging: { tr: 'WA & Telegram',       en: 'WA & Telegram' },
  kpi:       { tr: 'KPI & Raporlar',      en: 'KPI & Reports' },
  calendar:  { tr: 'Takvim',              en: 'Calendar' },
};

const TAB_ICONS: Record<Tab, string> = {
  dashboard: '📈', social: '📱', library: '🗂️', growth: '👥',
  retention: '🔄', seo: '🔍', ads: '📣', messaging: '💬', kpi: '📊', calendar: '📅',
};

function StatCard({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <span className="text-xl">{icon}</span>
      <div>
        <div className="font-bold text-slate-900 dark:text-slate-100 text-sm leading-tight">{value}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      </div>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const { lang } = useLang();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(d => setStats(d))
      .catch(() => setStats({ error: 'API bağlantısı kurulamadı' }))
      .finally(() => setStatsLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-900">
      {/* ── Header ── */}
      <header className="bg-navy text-white px-6 py-4 flex items-center gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚓</span>
          <div>
            <h1 className="font-bold text-base leading-tight">crewinjob Marketing Agent</h1>
            <p className="text-slate-400 text-xs">The Right Job, The Right Talent</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {!statsLoading && stats && (
            <span
              title={stats.isRealData
                ? `api.crewin.org · ${stats.fetchedAt ? new Date(stats.fetchedAt).toLocaleTimeString('tr-TR') : ''}`
                : 'API token eksik veya bağlantı yok — .env.local içinde CREWINJOB_API_KEY ayarlayın'}
              className={`text-xs px-2.5 py-1 rounded-full font-medium cursor-help ${
                stats.isRealData
                  ? 'bg-green-500/20 text-green-300'
                  : 'bg-yellow-500/20 text-yellow-300'
              }`}
            >
              {stats.isRealData ? '● Gerçek API (api.crewin.org)' : '◐ Mock Veri (token eksik)'}
            </span>
          )}
          <ActivityLogPanel />
          <LangToggle />
          <ThemeToggle />
          <ModelPicker />
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.href = '/login';
            }}
            className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-red-700 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors font-medium"
            title={lang === 'tr' ? 'Çıkış Yap' : 'Log Out'}
          >
            🚪 {lang === 'tr' ? 'Çıkış' : 'Logout'}
          </button>
        </div>
      </header>

      {/* ── Stats Bar ── */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
        {statsLoading ? (
          <div className="px-6 py-3 flex items-center gap-2 text-slate-400 dark:text-slate-500 text-sm">
            <div className="w-4 h-4 border-2 border-slate-300 dark:border-slate-600 border-t-transparent rounded-full animate-spin" />
            Veriler yükleniyor...
          </div>
        ) : stats && !stats.error ? (
          <div className="px-4 flex flex-wrap divide-x divide-slate-100 dark:divide-slate-700">
            <StatCard
              icon="👥"
              value={stats.seafarers?.total?.toLocaleString('tr-TR') || '–'}
              label="Seafarers"
            />
            <StatCard
              icon="🆕"
              value={`+${stats.seafarers?.newThisWeek?.toLocaleString('tr-TR') || 0}`}
              label={lang === 'tr' ? 'Son 7 Gün Kayıt' : 'Last 7 Days'}
            />
            <StatCard
              icon="📋"
              value={stats.jobs?.total?.toLocaleString('tr-TR') || '–'}
              label={lang === 'tr' ? 'İlanlar' : 'Jobs'}
            />
            <StatCard
              icon="🏢"
              value={stats.jobs?.companies?.toLocaleString('tr-TR') || '–'}
              label={lang === 'tr' ? `Firmalar (+${stats.jobs?.newCompaniesThisWeek ?? 0} bu hafta)` : `Companies (+${stats.jobs?.newCompaniesThisWeek ?? 0} this week)`}
            />
            <StatCard
              icon="📊"
              value={`%${stats.seafarers?.profileCompletion || 0}`}
              label={lang === 'tr' ? 'Ort. Profil Doluluk' : 'Avg. Profile Completion'}
            />
            <StatCard
              icon="✅"
              value={stats.seafarers?.fillRateBuckets?.high?.toLocaleString('tr-TR') || '–'}
              label={lang === 'tr' ? 'Profil %60+ (Tamamlanmış)' : 'Profile 60%+ (Complete)'}
            />
          </div>
        ) : (
          <div className="px-6 py-3 text-sm text-red-500">
            ⚠️ {stats?.error || 'İstatistikler yüklenemedi'}
          </div>
        )}
      </div>

      {/* ── Profil Doluluk Dağılımı Paneli ── */}
      {!statsLoading && stats?.seafarers?.fillRateBuckets && (
        <ProfileFillRatePanel
          buckets={stats.seafarers.fillRateBuckets}
          average={stats.seafarers.profileCompletion || 0}
        />
      )}

      {/* ── Ülke & Pozisyon Dağılımı ── */}
      <BreakdownPanel />

      {/* ── Tab Navigation ── */}
      <div className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
        <nav className="px-6 flex gap-0 overflow-x-auto">
          {(Object.keys(TAB_LABELS) as Tab[]).map(id => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 whitespace-nowrap transition-all ${
                activeTab === id
                  ? 'border-ocean text-ocean'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              <span>{TAB_ICONS[id]}</span>
              <span>{TAB_LABELS[id][lang]}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* ── Main Content ── */}
      <main className="flex-1 p-6 max-w-screen-xl mx-auto w-full">
        {activeTab === 'dashboard' && <DashboardTab />}
        {activeTab === 'social'    && <SocialTab />}
        {activeTab === 'library'   && <ContentLibraryTab />}
        {activeTab === 'growth'    && <GrowthTab />}
        {activeTab === 'retention' && <RetentionTab segments={stats?.incomplete?.segments} />}
        {activeTab === 'seo'       && <SeoTab />}
        {activeTab === 'ads'       && <AdsTab />}
        {activeTab === 'messaging' && <MessagingTab />}
        {activeTab === 'kpi'       && <KpiTab stats={stats || undefined} />}
        {activeTab === 'calendar'  && <CalendarTab />}
      </main>

      {/* ── Footer ── */}
      <footer className="bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 px-6 py-3 text-xs text-slate-400 dark:text-slate-500 flex items-center justify-between">
        <span>⚓ crewinjob Marketing Agent — Powered by Gemini AI</span>
        <span>crewinjob.com</span>
      </footer>
    </div>
  );
}
