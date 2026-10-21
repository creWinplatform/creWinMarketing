'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLang } from '@/lib/lang';
import { localeTag, type Lang } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';
import { onTabKeys } from '@/components/platform/tab-keys';

// ── Tipler ────────────────────────────────────────────────────────────────────
interface TgGroup {
  id: string; title: string; username: string | null; members: number; type: 'group' | 'channel';
}
interface PostedJob {
  ilanId: number; ilanUrl: string; sourceChat: string;
  jobData: Record<string, unknown>; postedAt: string;
  broadcastedAt: string | null; broadcastedTo: number;
  qualityScore?: number; applicationCount?: number;
}
interface ReviewItem {
  id: string; score: number; sourceChat: string; sourceText: string;
  jobData: Record<string, unknown>; queuedAt: string; status: string;
  needsPositionReview?: boolean; reason?: string;
}
interface GroupStat {
  chatId: string; chatTitle: string;
  scraped: number; queued: number; posted: number; rejected: number; qualityRatio: number;
}
interface Position { id: number; name: string; trName: string; }
interface MarketingAutomationStatus {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
}

function fmt(n: number, lang: Lang) { return n >= 1000 ? `${(n / 1000).toLocaleString(localeTag(lang), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k` : n.toLocaleString(localeTag(lang)); }
function scoreColor(s: number) {
  if (s >= 75) return 'text-green-500';
  if (s >= 50) return 'text-yellow-500';
  return 'text-red-500';
}

// ── Ana bileşen ───────────────────────────────────────────────────────────────
export default function PipelineTab() {
  const { lang } = useLang();
  const t = (tr: string, en: string) => (lang === 'tr' ? tr : en);
  const locale = localeTag(lang);
  const [groups,      setGroups]       = useState<TgGroup[]>([]);
  const [postedJobs,   setPostedJobs]   = useState<PostedJob[]>([]);
  const [reviewQueue,  setReviewQueue]  = useState<ReviewItem[]>([]);
  const [groupStats,   setGroupStats]   = useState<GroupStat[]>([]);
  const [logs,         setLogs]         = useState<string[]>([]);
  const [running,      setRunning]      = useState<string | null>(null);
  const [backendBusy,  setBackendBusy]  = useState<string | null>(null);
  const [msg,          setMsg]          = useState('');
  const [msgOk,        setMsgOk]        = useState(true);
  const [activePanel,  setActivePanel]  = useState<'review' | 'groups' | 'stats' | 'jobs'>('review');
  // Pozisyon seçimi (needsPositionReview ilanları için)
  const [positions,    setPositions]    = useState<Position[]>([]);
  const [posSelections, setPosSelections] = useState<Record<string, number>>({});
  const [posSearches,  setPosSearches]  = useState<Record<string, string>>({});
  // Çoklu seçim
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  // Maliyet & config
  const [usage,        setUsage]        = useState<Record<string, { inputTokens: number; outputTokens: number; calls: number; filtered: number; costUsd: number }>>({});
  const [agentConfig,  setAgentConfig]  = useState<{ autoApproveThreshold: number; qualityThreshold: number; reviewAllItems: boolean; alertQueueSize: number } | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [scheduler,    setScheduler]    = useState<{ running: boolean; pid: number | null; startedAt: string | null; uptime: number | null } | null>(null);
  const [marketingJobs, setMarketingJobs] = useState<MarketingAutomationStatus | null>(null);
  const [schedBusy,    setSchedBusy]    = useState(false);
  const logBoxRef   = useRef<HTMLDivElement>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const schedRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // İşlem aktif mi? (lokal buton VEYA arka planda süren işlem)
  const busy = running || backendBusy;

  // ── Durum polling: arka planda süren işlemi yakala (tab değişse de) ──────────
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const d = await (await fetch('/api/job-bot?action=pipeline_status')).json();
        if (d.ok) {
          setBackendBusy(prev => {
            // Arka plandaki işlem yeni bittiyse verileri tazele
            if (prev && !d.running) loadAll();
            return d.running || null;
          });
        }
      } catch {}
    };
    checkStatus();
    statusRef.current = setInterval(checkStatus, 3000);
    return () => { if (statusRef.current) clearInterval(statusRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scheduler durum polling ───────────────────────────────────────────────────
  const loadScheduler = useCallback(async () => {
    try {
      const d = await (await fetch('/api/scheduler')).json();
      if (d.ok) setScheduler({ running: d.running, pid: d.pid, startedAt: d.startedAt, uptime: d.uptime });
    } catch {}
  }, []);

  useEffect(() => {
    loadScheduler();
    schedRef.current = setInterval(loadScheduler, 5000);
    return () => { if (schedRef.current) clearInterval(schedRef.current); };
  }, [loadScheduler]);

  const loadMarketingJobs = useCallback(async () => {
    try {
      const response = await fetch('/api/marketing/automation?summary=true', { cache: 'no-store' });
      if (!response.ok) return;
      const raw = await response.json() as Record<string, unknown>;
      setMarketingJobs({
        total: Number(raw.totalJobs ?? raw.total ?? raw.totalCount ?? 0),
        queued: Number(raw.queuedJobs ?? raw.queued ?? raw.queuedCount ?? 0),
        running: Number(raw.runningJobs ?? raw.running ?? raw.runningCount ?? 0),
        completed: Number(raw.completedJobs ?? raw.completed ?? raw.completedCount ?? 0),
        failed: Number(raw.failedJobs ?? raw.failed ?? raw.failedCount ?? 0),
      });
    } catch { /* backend özeti ana pipeline'ı engellemez */ }
  }, []);

  useEffect(() => {
    void loadMarketingJobs();
    const timer = setInterval(loadMarketingJobs, 10000);
    return () => clearInterval(timer);
  }, [loadMarketingJobs]);

  const schedulerAction = async (action: 'start' | 'stop') => {
    setSchedBusy(true);
    try {
      const r = await fetch('/api/scheduler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const d = await r.json();
      showMsg(d.ok ? `✅ ${d.message}` : d.message, d.ok);
      await loadScheduler();
    } catch (e) { showMsg((e as Error).message, false); }
    finally { setSchedBusy(false); }
  };

  // ── Log polling: herhangi bir işlem sürerken her 2s güncelle ─────────────────
  useEffect(() => {
    if (!busy) { if (pollRef.current) clearInterval(pollRef.current); return; }
    const poll = async () => {
      try {
        const r = await fetch('/api/job-bot?action=pipeline_logs');
        const d = await r.json();
        if (d.ok && d.lines?.length) {
          setLogs(d.lines);
          requestAnimationFrame(() => {
            if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
          });
        }
      } catch {}
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [busy]);

  // ── Veri yükleme ──────────────────────────────────────────────────────────
  const loadGroups = useCallback(async () => {
    try { const d = await (await fetch('/api/job-bot?action=discovered_groups')).json(); if (d.ok) setGroups(d.groups || []); } catch {}
  }, []);
  const loadPostedJobs = useCallback(async () => {
    try { const d = await (await fetch('/api/job-bot?action=posted_jobs')).json(); if (d.ok) setPostedJobs((d.jobs || []).slice().reverse()); } catch {}
  }, []);
  const loadReviewQueue = useCallback(async () => {
    try { const d = await (await fetch('/api/job-bot?action=review_queue')).json(); if (d.ok) setReviewQueue(d.queue || []); } catch {}
  }, []);
  const loadGroupStats = useCallback(async () => {
    try { const d = await (await fetch('/api/job-bot?action=group_stats')).json(); if (d.ok) setGroupStats(d.stats || []); } catch {}
  }, []);

  const loadPositions = useCallback(async () => {
    if (positions.length > 0) return;
    try { const d = await (await fetch('/api/job-bot?action=positions')).json(); if (d.ok) setPositions(d.positions || []); } catch {}
  }, [positions.length]);

  const loadUsageAndConfig = useCallback(async () => {
    try {
      const [u, c] = await Promise.all([
        fetch('/api/job-bot?action=api_usage').then(r => r.json()),
        fetch('/api/job-bot?action=agent_config').then(r => r.json()),
      ]);
      if (u.ok) setUsage(u.usage || {});
      if (c.ok) setAgentConfig(c.config);
    } catch {}
  }, []);

  const saveConfig = async (patch: Record<string, unknown>) => {
    setConfigSaving(true);
    try {
      const res = await fetch('/api/job-bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set_config', ...patch }) });
      const d = await res.json();
      if (d.ok) setAgentConfig(d.config);
    } catch {} finally { setConfigSaving(false); }
  };

  const loadAll = useCallback(() => {
    loadGroups(); loadPostedJobs(); loadReviewQueue(); loadGroupStats(); loadUsageAndConfig();
  }, [loadGroups, loadPostedJobs, loadReviewQueue, loadGroupStats, loadUsageAndConfig]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Review paneline geçildiğinde pozisyon listesi hazır olsun
  useEffect(() => {
    if (activePanel === 'review') loadPositions();
  }, [activePanel, loadPositions]);

  // ── Mesaj ─────────────────────────────────────────────────────────────────
  const showMsg = (text: string, ok = true) => {
    setMsg(text); setMsgOk(ok);
    setTimeout(() => setMsg(''), 8000);
  };

  // ── Action çalıştırıcı ────────────────────────────────────────────────────
  const runAction = async (action: string, body: Record<string, unknown> = {}, label = '') => {
    setRunning(action); setLogs([]);
    try {
      const r = await fetch('/api/job-bot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      });
      const d = await r.json();
      if (d.ok) { showMsg(t(`✅ ${label} tamamlandı.`, `✅ ${label} completed.`)); loadAll(); }
      else showMsg(d.message || d.error || t(`${label} başarısız`, `${label} failed`), false);
    } catch (e) {
      showMsg(t('Bağlantı hatası: ', 'Connection error: ') + (e as Error).message, false);
    } finally { setRunning(null); }
  };

  const isRunning = (k: string) => running === k;

  // ── Review işlemleri ──────────────────────────────────────────────────────
  const approveItem = async (id: string, overridePositionId?: number) => {
    setRunning(`approve_${id}`);
    try {
      const r = await fetch('/api/job-bot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_review', id, positionId: overridePositionId ?? null }),
      });
      const d = await r.json();
      if (d.ok) { showMsg(t('✅ İlan onaylandı ve yayınlandı!', '✅ Job posting approved and published!')); loadAll(); }
      else showMsg(d.message || t('Hata', 'Error'), false);
    } catch (e) { showMsg((e as Error).message, false); }
    finally { setRunning(null); }
  };

  const rejectItem = async (id: string) => {
    setRunning(`reject_${id}`);
    try {
      await fetch('/api/job-bot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject_review', id }),
      });
      showMsg(t('❌ İlan reddedildi.', '❌ Job posting rejected.')); loadAll();
    } catch (e) { showMsg((e as Error).message, false); }
    finally { setRunning(null); }
  };

  const bulkReject = async (ids: string[]) => {
    setRunning('bulk_reject');
    try {
      const r = await fetch('/api/job-bot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_reject', ids }),
      });
      const d = await r.json();
      if (d.ok) { showMsg(t(`🗑️ ${d.count} ilan silindi.`, `🗑️ ${d.count} job postings deleted.`)); setSelected(new Set()); loadAll(); }
      else showMsg(d.message || t('Hata', 'Error'), false);
    } catch (e) { showMsg((e as Error).message, false); }
    finally { setRunning(null); }
  };

  const clearQueue = async () => {
    if (!confirm(t('Kuyruktaki tüm bekleyen ilanlar silinecek. Emin misin?', 'All pending job postings in the queue will be deleted. Are you sure?'))) return;
    setRunning('clear_queue');
    try {
      const r = await fetch('/api/job-bot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_queue' }),
      });
      const d = await r.json();
      if (d.ok) { showMsg(t(`🗑️ Kuyruk temizlendi (${d.count} ilan).`, `🗑️ Queue cleared (${d.count} job postings).`)); setSelected(new Set()); loadAll(); }
      else showMsg(d.message || t('Hata', 'Error'), false);
    } catch (e) { showMsg((e as Error).message, false); }
    finally { setRunning(null); }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

      {/* ── Başlık ─────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">{t('⚙️ Otomasyon Pipeline', '⚙️ Automation pipeline')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {t("Telegram'dan ilan topla → crewinjob.com'a yayınla → gruplara paylaş", 'Collect jobs from Telegram → publish to crewinjob.com → share to groups')}
        </p>
      </div>

      {/* ── Scheduler Kontrol ──────────────────────────────────────────── */}
      {(() => {
        const isRunning = scheduler?.running ?? false;
        const fmtUptime = (s: number) => {
          if (s < 60) return `${s}s`;
          if (s < 3600) return t(`${Math.floor(s/60)}dk ${s%60}s`, `${Math.floor(s/60)}m ${s%60}s`);
          const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
          return t(`${h}sa ${m}dk`, `${h}h ${m}m`);
        };
        // Bir sonraki çalışma saati (UTC 00,04,08,12,16,20)
        const now = new Date();
        const utcH = now.getUTCHours();
        const nextUtcH = [0,4,8,12,16,20].find(h => h > utcH) ?? 24;
        const nextRun = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), nextUtcH % 24));
        if (nextUtcH === 24) nextRun.setUTCDate(nextRun.getUTCDate() + 1);
        const diffMin = Math.round((nextRun.getTime() - Date.now()) / 60000);
        return (
          <div className={`rounded-xl border p-4 flex flex-wrap items-center gap-4 justify-between ${
            isRunning
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
              : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}>
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full shrink-0 ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-slate-400'}`} />
              <div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {isRunning ? t('🤖 Scheduler Çalışıyor', '🤖 Scheduler running') : t('🤖 Scheduler Durduruldu', '🤖 Scheduler stopped')}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex flex-wrap gap-3">
                  {isRunning && scheduler?.pid   && <span>PID: {scheduler.pid}</span>}
                  {isRunning && scheduler?.uptime != null && <span>{t('Çalışma süresi', 'Uptime')}: {fmtUptime(scheduler.uptime)}</span>}
                  {isRunning && <span>{t('Sonraki çalışma', 'Next run')}: ~{diffMin}{t('dk', 'm')} ({nextRun.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })} {t('yerel', 'local')})</span>}
                  {!isRunning && <span>{t('Başlatmak için butona bas', 'Press the button to start')}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isRunning ? (
                <button
                  onClick={() => schedulerAction('stop')}
                  disabled={schedBusy}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                  {schedBusy ? t('⏳ Durduruluyor…', '⏳ Stopping…') : t('⏹ Durdur', '⏹ Stop')}
                </button>
              ) : (
                <button
                  onClick={() => schedulerAction('start')}
                  disabled={schedBusy}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                  {schedBusy ? t('⏳ Başlatılıyor…', '⏳ Starting…') : t('▶ Başlat', '▶ Start')}
                </button>
              )}
              <button onClick={loadScheduler} aria-label={t('Scheduler durumunu yenile', 'Refresh scheduler status')} title={t('Yenile', 'Refresh')} className="p-2 text-slate-600 hover:text-slate-600 dark:hover:text-slate-200 text-sm">↻</button>
            </div>
          </div>
        );
      })()}

      {marketingJobs && (
        <section className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4" aria-label={t('Marketing otomasyon kuyruğu', 'Marketing automation queue')}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('Marketing işlem kuyruğu', 'Marketing job queue')}</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('Backend worker işlerinin canlı özeti', 'Live summary of backend worker jobs')}</p>
            </div>
            <button type="button" onClick={loadMarketingJobs} className="text-xs text-ocean hover:text-ocean-dark">{t('Yenile', 'Refresh')}</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              [t('Toplam', 'Total'), marketingJobs.total],
              [t('Kuyrukta', 'Queued'), marketingJobs.queued],
              [t('Çalışıyor', 'Running'), marketingJobs.running],
              [t('Tamamlandı', 'Completed'), marketingJobs.completed],
              [t('Hatalı', 'Failed'), marketingJobs.failed],
            ].map(([label, value]) => (
              <div key={String(label)} className="border border-slate-200 dark:border-slate-700 px-3 py-2 min-w-0">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{label}</p>
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{Number(value).toLocaleString(locale)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Mesaj banner ───────────────────────────────────────────────── */}
      {msg && (
        <div role={msgOk ? 'status' : 'alert'} className={`px-4 py-3 rounded-lg text-sm font-medium ${
          msgOk ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-700'
                : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-700'
        }`}><Msg text={msg} /></div>
      )}

      {/* ── Gemini Maliyet & Agent Config ──────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Maliyet Takibi */}
        {(() => {
          const today = new Date().toISOString().slice(0, 10);
          const todayData = usage[today];
          const last7 = Object.entries(usage)
            .filter(([k]) => k >= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
            .reduce((acc, [, v]) => ({ cost: acc.cost + v.costUsd, calls: acc.calls + v.calls, filtered: acc.filtered + v.filtered }), { cost: 0, calls: 0, filtered: 0 });
          return (
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('💰 Gemini API Maliyeti', '💰 Gemini API cost')}</span>
                <button onClick={loadUsageAndConfig} aria-label={t('Maliyeti yenile', 'Refresh cost')} title={t('Yenile', 'Refresh')} className="text-xs text-slate-600 hover:text-slate-600 dark:hover:text-slate-200">↻</button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100">${(todayData?.costUsd ?? 0).toLocaleString(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</div>
                  <div className="text-xs text-slate-600">{t('Bugün', 'Today')}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100">${last7.cost.toLocaleString(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</div>
                  <div className="text-xs text-slate-600">{t('Son 7 gün', 'Last 7 days')}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600">{last7.filtered.toLocaleString(locale)}</div>
                  <div className="text-xs text-slate-600">{t('Regex filtreli', 'Regex filtered')}</div>
                </div>
              </div>
              {todayData && (
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <span>{t('AI çağrısı (bugün)', 'AI calls (today)')}: <b className="text-slate-700 dark:text-slate-300">{todayData.calls}</b></span>
                  <span>{t('Giriş token', 'Input tokens')}: <b className="text-slate-700 dark:text-slate-300">{todayData.inputTokens.toLocaleString(locale)}</b></span>
                  <span>{t('Çıkış token', 'Output tokens')}: <b className="text-slate-700 dark:text-slate-300">{todayData.outputTokens.toLocaleString(locale)}</b></span>
                  <span>{t('Filtreli (bugün)', 'Filtered (today)')}: <b className="text-green-600">{todayData.filtered}</b></span>
                </div>
              )}
            </div>
          );
        })()}

        {/* Agent Config */}
        {agentConfig && (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{t('⚙️ Pipeline Ayarları', '⚙️ Pipeline settings')}</span>
              {configSaving && <span role="status" className="text-xs text-slate-600 animate-pulse">{t('Kaydediliyor…', 'Saving…')}</span>}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-300">{t('Tümünü İncele Modu', 'Review all mode')}</div>
                  <div className="text-xs text-slate-600">{t('Her ilanı review kuyruğuna at', 'Send every job to the review queue')}</div>
                </div>
                <button onClick={() => saveConfig({ reviewAllItems: !agentConfig.reviewAllItems })}
                  role="switch" aria-checked={agentConfig.reviewAllItems} aria-label={t('Tümünü İncele Modu', 'Review all mode')}
                  className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${agentConfig.reviewAllItems ? 'bg-blue-500' : 'bg-slate-200 dark:bg-slate-600'}`}>
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${agentConfig.reviewAllItems ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-slate-600 dark:text-slate-400">{t('Oto-onay eşiği', 'Auto-approve threshold')}</span>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{agentConfig.autoApproveThreshold}/100</span>
                </div>
                <input type="range" min={65} max={100} value={agentConfig.autoApproveThreshold} aria-label={t('Oto-onay eşiği', 'Auto-approve threshold')}
                  onChange={e => setAgentConfig(c => c ? { ...c, autoApproveThreshold: +e.target.value } : c)}
                  onMouseUp={e => saveConfig({ autoApproveThreshold: +(e.target as HTMLInputElement).value })}
                  onTouchEnd={e => saveConfig({ autoApproveThreshold: +(e.target as HTMLInputElement).value })}
                  className="w-full h-1.5 accent-blue-500" />
                <div className="flex justify-between text-xs text-slate-600 mt-0.5"><span>65</span><span>100</span></div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-slate-600 dark:text-slate-400">{t('Kuyruk uyarı limiti', 'Queue alert limit')}</span>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{agentConfig.alertQueueSize} {t('ilan', 'job postings')}</span>
                </div>
                <input type="range" min={5} max={100} step={5} value={agentConfig.alertQueueSize} aria-label={t('Kuyruk uyarı limiti', 'Queue alert limit')}
                  onChange={e => setAgentConfig(c => c ? { ...c, alertQueueSize: +e.target.value } : c)}
                  onMouseUp={e => saveConfig({ alertQueueSize: +(e.target as HTMLInputElement).value })}
                  onTouchEnd={e => saveConfig({ alertQueueSize: +(e.target as HTMLInputElement).value })}
                  className="w-full h-1.5 accent-orange-500" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Aksiyon kartları ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ActionCard icon="🔍" title={t('Grup Keşfi', 'Group discovery')}    desc={t('Grupları ara ve katıl', 'Search and join groups')}           color="blue"   loading={isRunning('discover_groups')}  disabled={!!busy} onClick={() => runAction('discover_groups', {}, t('Grup keşfi', 'Group discovery'))} />
        <ActionCard icon="📋" title={t('İlan Pipeline', 'Job posting pipeline')} desc={t('Çek → AI → crewinjob.com', 'Fetch → AI → crewinjob.com')}        color="green"  loading={isRunning('run_pipeline')}     disabled={!!busy} onClick={() => runAction('run_pipeline', { maxJobs: 15 }, 'Pipeline')} />
        <ActionCard icon="📢" title={t('Paylaş', 'Share')}        desc={t("Yeni ilanları Telegram'da duyur", 'Announce new jobs on Telegram')}  color="purple" loading={isRunning('broadcast_jobs')}   disabled={!!busy} onClick={() => runAction('broadcast_jobs', { maxJobs: 5 }, 'Broadcast')} />
        <ActionCard icon="🔄" title={t('Tam Döngü', 'Full cycle')}     desc={t('Keşif + Pipeline + Broadcast', 'Discovery + pipeline + broadcast')}    color="orange" loading={isRunning('full_cycle')}       disabled={!!busy}
          onClick={async () => {
            setRunning('full_cycle'); setLogs([]);
            for (const [act, body, lbl] of [
              ['discover_groups', {}, ''], ['run_pipeline', { maxJobs: 15 }, ''], ['broadcast_jobs', { maxJobs: 5 }, '']
            ] as [string, Record<string, unknown>, string][]) {
              if (!running) { /* devam */ }
              setRunning(act);
              try {
                const r = await fetch('/api/job-bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: act, ...body }) });
                await r.json();
              } catch {}
            }
            showMsg(t('✅ Tam döngü tamamlandı.', '✅ Full cycle completed.')); loadAll(); setRunning(null);
          }}
        />
      </div>

      {/* ── İkinci sıra: yardımcı aksiyonlar ───────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniCard icon="⏳" title={t('Expiry Kontrolü', 'Expiry check')}   loading={isRunning('manage_expiry')}     disabled={!!busy} onClick={() => runAction('manage_expiry', {}, t('Expiry kontrolü', 'Expiry check'))} />
        <MiniCard icon="📊" title={t('Günlük Rapor', 'Daily report')}      loading={isRunning('send_daily_report')} disabled={!!busy} onClick={() => runAction('send_daily_report', {}, t('Rapor', 'Report'))} />
        <MiniCard icon="📥" title={t('Başvuru Takibi', 'Application tracking')}    loading={isRunning('track_applications')} disabled={!!busy} onClick={() => runAction('track_applications', {}, t('Başvuru takibi', 'Application tracking'))} />
        <MiniCard icon="👋" title={t('Üye Onboarding', 'Member onboarding')}    loading={isRunning('onboard_members')}   disabled={!!busy} onClick={() => runAction('onboard_members', { maxDms: 20 }, 'Onboarding')} />
      </div>

      {/* ── Canlı Log ──────────────────────────────────────────────────── */}
      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-gray-300 text-sm font-mono font-semibold">{t('📟 Canlı Log', '📟 Live log')}</span>
            {busy && <span className="flex items-center gap-1.5 text-xs text-green-400"><span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"/>{backendBusy && !running ? t('arka planda çalışıyor…', 'running in background…') : t('çalışıyor…', 'running…')}</span>}
          </div>
          <button onClick={() => setLogs([])} className="text-xs text-slate-300 hover:text-white">{t('temizle', 'clear')}</button>
        </div>
        <div ref={logBoxRef} className="px-4 py-3 h-44 overflow-y-auto font-mono text-xs text-gray-300 space-y-0.5">
          {logs.length === 0
            ? <span className="text-slate-300">{busy ? t('Bekleniyor…', 'Waiting…') : t('Bir aksiyon başlat — loglar burada görünür.', 'Start an action — logs will appear here.')}</span>
            : logs.map((line, i) => (
              <div key={i} className={
                line.includes('✅') ? 'text-green-400' : line.includes('❌') ? 'text-red-400' :
                line.includes('⚠️') ? 'text-yellow-400' : line.includes('════') ? 'text-blue-400 font-bold' : 'text-gray-300'
              }>{line}</div>
            ))
          }
        </div>
      </div>

      {/* ── Panel seçici ────────────────────────────────────────────────── */}
      <div role="tablist" aria-label={t('Pipeline panelleri', 'Pipeline panels')} onKeyDown={onTabKeys} className="flex gap-2 border-b border-gray-200 dark:border-slate-700 overflow-x-auto overscroll-x-contain">
        {([
          { key: 'review', label: t('🔍 İnceleme Kuyruğu', '🔍 Review queue'), badge: reviewQueue.length },
          { key: 'groups', label: t('🤝 Gruplar', '🤝 Groups'), badge: groups.length },
          { key: 'stats',  label: t('📊 Grup Kalite', '📊 Group quality'), badge: groupStats.length },
          { key: 'jobs',   label: t('✅ Yayınlananlar', '✅ Published'), badge: postedJobs.length },
        ] as { key: typeof activePanel; label: string; badge: number }[]).map(p => (
          <button key={p.key} type="button" role="tab" aria-selected={activePanel === p.key} tabIndex={activePanel === p.key ? 0 : -1} onClick={() => setActivePanel(p.key)}
            className={`shrink-0 px-4 py-2 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
              activePanel === p.key
                ? 'border-ocean text-ocean'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}>
            {p.label}
            {p.badge > 0 && <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
              p.key === 'review' && p.badge > 0 ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-400'
            }`}>{p.badge}</span>}
          </button>
        ))}
      </div>

      {/* ── Panel: İnceleme Kuyruğu ─────────────────────────────────────── */}
      {activePanel === 'review' && (
        <div className="space-y-3">
          {/* Araç çubuğu */}
          {reviewQueue.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setSelected(prev => prev.size === reviewQueue.length ? new Set() : new Set(reviewQueue.map(i => i.id)))}
                className="px-3 py-1.5 text-xs border border-gray-300 dark:border-slate-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700"
              >
                {selected.size === reviewQueue.length ? t('☐ Seçimi Kaldır', '☐ Deselect all') : t('☑ Tümünü Seç', '☑ Select all')}
              </button>
              {selected.size > 0 && (
                <button
                  onClick={() => bulkReject(Array.from(selected))}
                  disabled={!!running}
                  className="px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50"
                >
                  {t('🗑️ Seçilenleri Sil', '🗑️ Delete selected')} ({selected.size})
                </button>
              )}
              <button
                onClick={clearQueue}
                disabled={!!running}
                className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 ml-auto"
              >
                {t('🗑️ Tümünü Temizle', '🗑️ Clear all')} ({reviewQueue.length})
              </button>
            </div>
          )}
          {reviewQueue.length === 0 ? (
            <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl py-12 text-center text-gray-400 dark:text-gray-500">
              <div className="text-3xl mb-2" aria-hidden="true">✅</div>
              <div className="text-sm">{t('İnceleme kuyruğu boş — tüm ilanlar kalite eşiğini geçti', 'Review queue is empty — all job postings passed the quality threshold')}</div>
            </div>
          ) : [...reviewQueue].sort((a, b) => new Date(b.queuedAt).getTime() - new Date(a.queuedAt).getTime()).map(item => {
            const d   = item.jobData || {};
            const pos = String(d._positionName || d.positionName || '—');
            const needsPos = item.needsPositionReview === true;
            const selPosId = posSelections[item.id] ?? null;
            const search   = posSearches[item.id] ?? '';
            const filteredPos = positions.filter(p =>
              !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.trName.toLowerCase().includes(search.toLowerCase())
            );
            return (
              <div key={item.id} className={`bg-white dark:bg-slate-800 border rounded-xl p-4 ${selected.has(item.id) ? 'border-ocean' : needsPos ? 'border-yellow-300 dark:border-yellow-600' : 'border-gray-200 dark:border-slate-700'}`}>
                <div className="flex flex-wrap sm:flex-nowrap items-start gap-4">
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => setSelected(prev => { const s = new Set(prev); s.has(item.id) ? s.delete(item.id) : s.add(item.id); return s; })}
                    aria-label={t('İlanı seç', 'Select job posting')}
                    className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer accent-ocean"
                  />
                  {/* Skor */}
                  <div className="flex-shrink-0 text-center">
                    <div className={`text-2xl font-bold ${scoreColor(item.score)}`}>{item.score}</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">/100</div>
                  </div>
                  {/* Detay */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800 dark:text-gray-100">{pos}</span>
                      {needsPos && (
                        <span className="text-xs bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded-full font-medium">
                          {t('⚠️ Pozisyon Atanacak', '⚠️ Position needed')}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">
                        📡 {item.sourceChat}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                        {new Date(item.queuedAt).toLocaleString(locale)}
                      </span>
                    </div>
                    {item.reason && (
                      <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">⚠️ <Msg text={item.reason} /></p>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 line-clamp-3 whitespace-pre-wrap">
                      {item.sourceText}
                    </p>
                    {/* Parsed alanlar */}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {d.shipType     ? <Tag>{String(d.shipType)}</Tag>     : null}
                      {d.country      ? <Tag>{String(d.country)}</Tag>      : null}
                      {d.contractType ? <Tag>{String(d.contractType)}</Tag> : null}
                      {(d.minPrice || d.maxPrice) ? <Tag>💰 {String(d.minPrice ?? '?')}–{String(d.maxPrice ?? '?')} {String(d.currency ?? 'USD')}</Tag> : null}
                    </div>
                    {/* Pozisyon seçici (sadece needsPositionReview ilanları için) */}
                    {needsPos && (
                      <div className="mt-3 border border-yellow-200 dark:border-yellow-700 rounded-lg p-3 bg-yellow-50 dark:bg-yellow-900/10">
                        <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400 mb-2">
                          {t('Pozisyon seçilmeden ilan yayınlanamaz. AI tahmini:', "The job posting can't be published without a position. AI guess:")} <em>&ldquo;{String(d.positionName || '?')}&rdquo;</em>
                        </p>
                        <input
                          type="text"
                          placeholder={t('Pozisyon ara… (örn: Chief, Captain)', 'Search position… (e.g. Chief, Captain)')}
                          aria-label={t('Pozisyon ara', 'Search position')}
                          value={search}
                          onChange={e => setPosSearches(prev => ({ ...prev, [item.id]: e.target.value }))}
                          className="w-full text-xs border border-gray-300 dark:border-slate-600 rounded px-2 py-1.5 mb-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100 placeholder-gray-400"
                        />
                        <select
                          size={Math.min(5, filteredPos.length || 1)}
                          aria-label={t('Pozisyon', 'Position')}
                          value={selPosId ?? ''}
                          onChange={e => setPosSelections(prev => ({ ...prev, [item.id]: Number(e.target.value) }))}
                          className="w-full text-xs border border-gray-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100"
                        >
                          {filteredPos.length === 0
                            ? <option disabled value="">{t('Sonuç yok', 'No results')}</option>
                            : filteredPos.map(p => (
                              <option key={p.id} value={p.id}>{p.name} — {p.trName}</option>
                            ))
                          }
                        </select>
                        {selPosId != null && (
                          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                            {t('✅ Seçilen:', '✅ Selected:')} {positions.find(p => p.id === selPosId)?.name}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Butonlar */}
                  <div className="flex w-full flex-row flex-wrap gap-2 sm:w-auto sm:flex-col sm:flex-shrink-0">
                    <button
                      onClick={() => {
                        if (needsPos && !selPosId) {
                          showMsg(t('Lütfen önce bir pozisyon seçin', 'Please select a position first'), false);
                          return;
                        }
                        approveItem(item.id, selPosId ?? undefined);
                      }}
                      disabled={!!running || (needsPos && selPosId == null)}
                      className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg font-medium disabled:opacity-50 transition-colors"
                    >
                      {running === `approve_${item.id}` ? '…' : t('✅ Onayla', '✅ Approve')}
                    </button>
                    <button
                      onClick={() => rejectItem(item.id)}
                      disabled={!!running}
                      className="px-4 py-1.5 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 text-sm rounded-lg font-medium disabled:opacity-50 transition-colors"
                    >
                      {running === `reject_${item.id}` ? '…' : t('❌ Reddet', '❌ Reject')}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Panel: Gruplar ──────────────────────────────────────────────── */}
      {activePanel === 'groups' && (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-700">
            <h3 className="font-semibold text-gray-700 dark:text-gray-200">{t('🤝 Katılınan Gruplar', '🤝 Joined groups')} <span className="text-xs font-normal text-gray-400">({groups.length})</span></h3>
            <button onClick={loadGroups} className="text-xs text-blue-500 hover:underline">{t('Yenile', 'Refresh')}</button>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-slate-700 max-h-96 overflow-y-auto">
            {groups.length === 0
              ? <div className="py-8 text-center text-gray-400 dark:text-gray-500 text-sm">{t('Henüz grup yok — "Grup Keşfi" çalıştır', 'No groups yet — run "Group discovery"')}</div>
              : groups.map(g => (
                <div key={g.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-lg" role="img" aria-label={g.type === 'channel' ? t('Kanal', 'Channel') : t('Grup', 'Group')}>{g.type === 'channel' ? '📡' : '👥'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{g.title}</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">{g.username && <span className="mr-2">{g.username}</span>}{fmt(g.members, lang)} {t('üye', 'members')}</div>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ── Panel: Grup Kalite İstatistikleri ───────────────────────────── */}
      {activePanel === 'stats' && (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-700">
            <h3 className="font-semibold text-gray-700 dark:text-gray-200">{t('📊 Kaynak Grup Kalitesi', '📊 Source group quality')}</h3>
            <button onClick={loadGroupStats} className="text-xs text-blue-500 hover:underline">{t('Yenile', 'Refresh')}</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-700/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
                  <th className="px-4 py-2 text-left">{t('Grup', 'Group')}</th>
                  <th className="px-3 py-2 text-center">{t('Taranan', 'Scraped')}</th>
                  <th className="px-3 py-2 text-center">{t('Kuyruğa', 'Queued')}</th>
                  <th className="px-3 py-2 text-center">{t('Yayınlanan', 'Published')}</th>
                  <th className="px-3 py-2 text-center">{t('Kalite', 'Quality')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-700">
                {groupStats.length === 0
                  ? <tr><td colSpan={5} className="py-8 text-center text-gray-400 dark:text-gray-500">{t('Henüz veri yok — pipeline çalıştır', 'No data yet — run the pipeline')}</td></tr>
                  : groupStats.map(g => (
                    <tr key={g.chatId} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                      <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-100 truncate max-w-[200px]">{g.chatTitle}</td>
                      <td className="px-3 py-2.5 text-center text-gray-600 dark:text-gray-400">{g.scraped.toLocaleString(locale)}</td>
                      <td className="px-3 py-2.5 text-center text-yellow-600">{g.queued.toLocaleString(locale)}</td>
                      <td className="px-3 py-2.5 text-center text-green-600">{g.posted.toLocaleString(locale)}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`font-semibold ${scoreColor(Math.round(g.qualityRatio * 100))}`}>
                          {lang === 'tr' ? `%${Math.round(g.qualityRatio * 100)}` : `${Math.round(g.qualityRatio * 100)}%`}
                        </span>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Panel: Yayınlanan İlanlar ────────────────────────────────────── */}
      {activePanel === 'jobs' && (
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-700">
            <h3 className="font-semibold text-gray-700 dark:text-gray-200">{t('✅ Otomatik Yayınlananlar', '✅ Auto-published')} <span className="text-xs font-normal text-gray-400">({postedJobs.length})</span></h3>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  showMsg(t('📥 Başvuru sayıları çekiliyor…', '📥 Fetching application counts…'));
                  try {
                    const d = await (await fetch('/api/job-bot?action=job_stats')).json();
                    if (d.ok) { showMsg(t('✅ Başvuru sayıları güncellendi.', '✅ Application counts updated.')); loadPostedJobs(); }
                    else showMsg('❌ ' + (d.error || t('Hata', 'Error')), false);
                  } catch { showMsg(t('❌ Bağlantı hatası', '❌ Connection error'), false); }
                }}
                className="text-xs text-purple-500 hover:underline"
              >{t('📥 Başvuruları Güncelle', '📥 Update applications')}</button>
              <button onClick={loadPostedJobs} className="text-xs text-blue-500 hover:underline">{t('Yenile', 'Refresh')}</button>
            </div>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-slate-700 max-h-96 overflow-y-auto">
            {postedJobs.length === 0
              ? <div className="py-8 text-center text-gray-400 dark:text-gray-500 text-sm">{t('Henüz ilan yok — "İlan Pipeline" çalıştır', 'No job postings yet — run "Job posting pipeline"')}</div>
              : postedJobs.map((job, i) => {
                const d   = job.jobData || {};
                const pos = String(d._positionName || `#${job.ilanId}`);
                return (
                  <div key={i} className="flex items-start gap-3 px-4 py-2.5">
                    <span className="text-lg mt-0.5" aria-hidden="true">🚢</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{pos}</span>
                        {job.qualityScore && <span className={`text-xs font-semibold ${scoreColor(job.qualityScore)}`}>{job.qualityScore}p</span>}
                        {job.applicationCount ? <span className="text-xs text-blue-500">📥 {job.applicationCount} {t('başvuru', 'applications')}</span> : null}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 flex-wrap mt-0.5">
                        {String(d._countryName || '') && <span>{String(d._countryName)}</span>}
                        <span>{new Date(job.postedAt).toLocaleDateString(locale)}</span>
                        {job.broadcastedAt
                          ? <span className="text-green-500">📢 {t(`${job.broadcastedTo} gruba paylaşıldı`, `shared to ${job.broadcastedTo} groups`)}</span>
                          : <span className="text-yellow-500">{t('⏳ paylaşılmadı', '⏳ not shared')}</span>}
                      </div>
                      <a href={job.ilanUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:underline truncate block">{job.ilanUrl}</a>
                    </div>
                  </div>
                );
              })
            }
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
        {t('Uzun işlemler (keşif, pipeline, broadcast) 5–10 dakika sürebilir. Log alanı otomatik güncellenir.', 'Long operations (discovery, pipeline, broadcast) can take 5–10 minutes. The log area updates automatically.')}
      </p>
    </div>
  );
}

// ── Yardımcı bileşenler ───────────────────────────────────────────────────────
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-xs bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">{children}</span>;
}

function ActionCard({ icon, title, desc, color, loading, disabled, onClick }: {
  icon: string; title: string; desc: string;
  color: 'blue' | 'green' | 'purple' | 'orange';
  loading: boolean; disabled: boolean; onClick: () => void;
}) {
  const { lang } = useLang();
  const border = { blue: 'border-blue-200 dark:border-blue-700', green: 'border-green-200 dark:border-green-700', purple: 'border-purple-200 dark:border-purple-700', orange: 'border-orange-200 dark:border-orange-700' };
  const btn    = { blue: 'bg-blue-600 hover:bg-blue-700', green: 'bg-green-600 hover:bg-green-700', purple: 'bg-purple-600 hover:bg-purple-700', orange: 'bg-orange-500 hover:bg-orange-600' };
  return (
    <div className={`border-2 rounded-xl p-4 flex flex-col gap-3 bg-white dark:bg-slate-800 transition-all ${border[color]} ${disabled ? 'opacity-60' : ''}`}>
      <div className="text-2xl" aria-hidden="true">{icon}</div>
      <div>
        <div className="font-semibold text-sm text-gray-800 dark:text-gray-100">{title}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{desc}</div>
      </div>
      <button type="button" onClick={onClick} disabled={disabled}
        aria-label={`${loading ? (lang === 'tr' ? 'Çalışıyor…' : 'Running…') : (lang === 'tr' ? 'Başlat' : 'Start')}: ${title}`}
        className={`mt-auto w-full py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors ${btn[color]}`}>
        {loading ? <><svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>{lang === 'tr' ? 'Çalışıyor…' : 'Running…'}</> : (lang === 'tr' ? 'Başlat' : 'Start')}
      </button>
    </div>
  );
}

function MiniCard({ icon, title, loading, disabled, onClick }: {
  icon: string; title: string; loading: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-gray-400 dark:hover:border-slate-500 disabled:opacity-50 transition-all">
      {loading ? <svg className="animate-spin h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> : <span aria-hidden="true">{icon}</span>}
      <span className="truncate">{title}</span>
    </button>
  );
}
