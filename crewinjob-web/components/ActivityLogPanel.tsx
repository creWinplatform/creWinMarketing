'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  getActivityLog,
  clearActivityLog,
  ACTIVITY_META,
  type ActivityEntry,
} from '@/lib/activity-log';
import { useLang } from '@/lib/lang';

function timeAgo(ts: number, lang: 'tr' | 'en'): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60)  return lang === 'tr' ? `${secs}s önce` : `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return lang === 'tr' ? `${mins}dk önce` : `${mins}min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return lang === 'tr' ? `${hrs}sa önce` : `${hrs}h ago`;
  return lang === 'tr' ? `${Math.floor(hrs / 24)}g önce` : `${Math.floor(hrs / 24)}d ago`;
}

export default function ActivityLogPanel() {
  const { lang } = useLang();
  const [open,    setOpen]    = useState(false);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);

  const reload = useCallback(() => {
    getActivityLog().then(setEntries).catch(() => {});
  }, []);

  // Açıldığında yenile (artık localStorage event'i yok — sunucu taraflı)
  useEffect(() => {
    reload();
  }, [reload]);

  // Panel açıkken otomatik yenile (15 sn)
  useEffect(() => {
    if (!open) return;
    reload();
    const id = setInterval(reload, 15_000);
    return () => clearInterval(id);
  }, [open, reload]);

  const handleClear = () => {
    clearActivityLog().then(() => setEntries([])).catch(() => {});
  };

  const unread = entries.length;

  return (
    <>
      {/* ── Trigger button ── */}
      <button
        onClick={() => { setOpen(v => !v); reload(); }}
        className="relative flex items-center gap-1.5 text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 px-3 py-1.5 rounded-lg transition-colors font-medium"
        title={lang === 'tr' ? 'Aktivite Günlüğü' : 'Activity Log'}
      >
        <span>🕐</span>
        <span className="hidden sm:inline">{lang === 'tr' ? 'Aktivite' : 'Activity'}</span>
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-ocean text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {/* ── Slide-over panel ── */}
      {open && (
        <>
          {/* backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* panel */}
          <div className="fixed right-0 top-0 bottom-0 z-50 w-80 bg-white dark:bg-slate-800 shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-700">
            {/* header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <span className="text-base">🕐</span>
                <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
                  {lang === 'tr' ? 'Aktivite Günlüğü' : 'Activity Log'}
                </h2>
                {entries.length > 0 && (
                  <span className="text-[10px] bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">
                    {entries.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {entries.length > 0 && (
                  <button
                    onClick={handleClear}
                    className="text-[11px] text-red-400 hover:text-red-600 transition-colors"
                    title={lang === 'tr' ? 'Günlüğü temizle' : 'Clear log'}
                  >
                    {lang === 'tr' ? 'Temizle' : 'Clear'}
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* entries */}
            <div className="flex-1 overflow-y-auto py-2">
              {entries.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 dark:text-slate-500">
                  <span className="text-4xl opacity-20">🕐</span>
                  <p className="text-xs text-center">
                    {lang === 'tr' ? 'Henüz aktivite yok.' : 'No activity yet.'}<br />
                    {lang === 'tr' ? 'İçerik üret veya paylaş.' : 'Generate or share content.'}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-slate-100 dark:divide-slate-700">
                  {entries.map(entry => {
                    const meta = ACTIVITY_META[entry.type];
                    return (
                      <div
                        key={entry.id}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                      >
                        <span className="text-base mt-0.5 shrink-0">{meta.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-700 dark:text-slate-200 leading-snug">
                            {entry.label}
                          </p>
                          {entry.detail && (
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
                              {entry.detail}
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 mt-0.5">
                          {timeAgo(entry.ts, lang)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* footer */}
            <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700 text-[10px] text-slate-400 dark:text-slate-500 flex items-center justify-between">
              <span>
                {lang === 'tr' ? `Son ${entries.length} / 50 kayıt` : `Last ${entries.length} / 50 records`}
              </span>
              <button onClick={reload} className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                ↻ {lang === 'tr' ? 'Yenile' : 'Refresh'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
