'use client';
import { useState, useEffect } from 'react';
import { getEvents, addEvent, removeEvent, togglePublished, CalendarEvent } from '@/lib/calendar-store';
import { logActivity } from '@/lib/activity-log';
import { useLang } from '@/lib/lang';

const PLATFORM_ICONS: Record<string, string> = {
  instagram: '📸',
  facebook:  '👥',
  twitter:   '🐦',
  linkedin:  '💼',
  tiktok:    '🎵',
};

const DAYS_OF_WEEK_TR = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const DAYS_OF_WEEK_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function timeAgo(ts: number, lang: 'tr' | 'en'): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return lang === 'tr' ? 'az önce' : 'just now';
  if (mins < 60) return lang === 'tr' ? `${mins} dk önce` : `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return lang === 'tr' ? `${hrs} sa önce` : `${hrs} h ago`;
  return lang === 'tr' ? `${Math.floor(hrs / 24)} gün önce` : `${Math.floor(hrs / 24)} days ago`;
}

export default function CalendarTab() {
  const { lang } = useLang();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [currentYear, setCurrentYear] = useState(0);
  const [currentMonth, setCurrentMonth] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addContent, setAddContent] = useState('');
  const [addPlatform, setAddPlatform] = useState('instagram');
  const [addDate, setAddDate] = useState('');
  const [addLanguage, setAddLanguage] = useState<'tr' | 'en'>('tr');

  // ── Otomatik yayın (scheduler) ──────────────────────────────────────────────
  const [schedLoading, setSchedLoading] = useState(false);
  const [schedResult,  setSchedResult]  = useState<{
    published: number; failed: number;
    results: { eventId: string; platform: string; success: boolean; url?: string; error?: string }[];
    message?: string;
  } | null>(null);

  useEffect(() => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
    setAddDate(formatDateKey(now.getFullYear(), now.getMonth(), now.getDate()));
    getEvents().then(setEvents).catch(() => {});
  }, []);

  const navigateMonth = (dir: -1 | 1) => {
    let m = currentMonth + dir;
    let y = currentYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setCurrentMonth(m);
    setCurrentYear(y);
  };

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => {
    // Monday-based: 0=Mon ... 6=Sun
    const d = new Date(year, month, 1).getDay();
    return d === 0 ? 6 : d - 1;
  };

  const handleAddEvent = async () => {
    if (!addContent.trim() || !addDate) return;
    const updated = await addEvent({
      date: addDate,
      platform: addPlatform,
      content: addContent,
      language: addLanguage,
      published: false,
    });
    setEvents(updated);
    setAddContent('');
    setShowAddForm(false);
    logActivity('calendar_added', 'Takvime içerik eklendi', `${addPlatform} · ${addDate}`);
  };

  const handleDelete = async (id: string) => {
    setEvents(await removeEvent(id));
  };

  const handleToggle = async (id: string) => {
    setEvents(await togglePublished(id));
  };

  const runScheduler = async () => {
    setSchedLoading(true);
    setSchedResult(null);
    try {
      const res = await fetch('/api/scheduler/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ events }),
      });
      const data = await res.json();
      setSchedResult(data);
      if (data.published !== undefined) {
        logActivity('scheduler_run', `Scheduler çalıştı: ${data.published} yayınlandı, ${data.failed} başarısız`);
      }
      // Başarılı gönderilenleri yayınlandı olarak işaretle
      if (data.results) {
        let updated = [...events];
        for (const r of (data.results as { eventId: string; success: boolean }[])) {
          if (r.success) {
            updated = await togglePublished(r.eventId);
          }
        }
        setEvents(updated);
      }
    } catch (e: unknown) {
      setSchedResult({ published: 0, failed: 1, results: [], message: e instanceof Error ? e.message : 'Error' });
    } finally {
      setSchedLoading(false);
    }
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  const eventsForDay = (dateKey: string) => events.filter(e => e.date === dateKey);
  const selectedDayEvents = selectedDay ? eventsForDay(selectedDay) : [];

  const todayKey = (() => {
    const now = new Date();
    return formatDateKey(now.getFullYear(), now.getMonth(), now.getDate());
  })();

  const MONTH_NAMES_TR = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
  ];
  const MONTH_NAMES_EN = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const MONTH_NAMES = lang === 'tr' ? MONTH_NAMES_TR : MONTH_NAMES_EN;
  const DAYS_OF_WEEK = lang === 'tr' ? DAYS_OF_WEEK_TR : DAYS_OF_WEEK_EN;

  if (currentYear === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        <div className="w-6 h-6 border-2 border-slate-300 border-t-transparent rounded-full animate-spin mr-2" />
        {lang === 'tr' ? 'Takvim yükleniyor...' : 'Loading calendar...'}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Calendar */}
      <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => navigateMonth(-1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
          >←</button>
          <h2 className="font-bold text-slate-800 dark:text-slate-100 text-base">
            {MONTH_NAMES[currentMonth]} {currentYear}
          </h2>
          <button
            onClick={() => navigateMonth(1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
          >→</button>
        </div>

        {/* Days of week header */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS_OF_WEEK.map(d => (
            <div key={d} className="text-center text-[11px] font-semibold text-slate-400 dark:text-slate-500 py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {/* Empty cells before first day */}
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}
          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateKey = formatDateKey(currentYear, currentMonth, day);
            const dayEvents = eventsForDay(dateKey);
            const isToday = dateKey === todayKey;
            const isSelected = selectedDay === dateKey;

            return (
              <button
                key={day}
                onClick={() => setSelectedDay(isSelected ? null : dateKey)}
                className={`aspect-square rounded-lg p-1 flex flex-col items-center transition-all border-2 ${
                  isSelected
                    ? 'border-ocean bg-ocean/5'
                    : isToday
                    ? 'border-ocean/40 bg-ocean/5'
                    : 'border-transparent hover:border-slate-200 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <span className={`text-xs font-medium leading-none mb-0.5 ${
                  isToday ? 'text-ocean font-bold' : 'text-slate-700 dark:text-slate-200'
                }`}>
                  {day}
                </span>
                {dayEvents.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 justify-center">
                    {dayEvents.slice(0, 3).map((ev, idx) => (
                      <span key={idx} className="text-[10px] leading-none" title={ev.platform}>
                        {PLATFORM_ICONS[ev.platform] || '📌'}
                      </span>
                    ))}
                    {dayEvents.length > 3 && (
                      <span className="text-[9px] text-slate-400">+{dayEvents.length - 3}</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Add form */}
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700">
          {!showAddForm ? (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full py-2 border-2 border-dashed border-ocean/30 hover:border-ocean/60 text-ocean text-sm font-medium rounded-xl transition-colors hover:bg-ocean/5"
            >
              📌 {lang === 'tr' ? 'Bugüne Ekle' : 'Add to Today'}
            </button>
          ) : (
            <div className="flex flex-col gap-3 bg-slate-50 dark:bg-slate-700 rounded-xl p-4 border border-slate-200 dark:border-slate-600">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                📅 {lang === 'tr' ? 'Takvime İçerik Ekle' : 'Add Content to Calendar'}
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">
                    {lang === 'tr' ? 'Tarih' : 'Date'}
                  </label>
                  <input
                    type="date"
                    value={addDate}
                    onChange={e => setAddDate(e.target.value)}
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ocean/50 bg-white dark:bg-slate-600 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">
                    {lang === 'tr' ? 'Platform' : 'Platform'}
                  </label>
                  <select
                    value={addPlatform}
                    onChange={e => setAddPlatform(e.target.value)}
                    className="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ocean/50 bg-white dark:bg-slate-600 dark:text-slate-100"
                  >
                    {Object.entries(PLATFORM_ICONS).map(([k, icon]) => (
                      <option key={k} value={k}>{icon} {k.charAt(0).toUpperCase() + k.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">
                  {lang === 'tr' ? 'Dil' : 'Language'}
                </label>
                <div className="flex gap-2">
                  {(['tr', 'en'] as const).map(l => (
                    <button
                      key={l}
                      onClick={() => setAddLanguage(l)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium border-2 transition-colors ${
                        addLanguage === l ? 'border-ocean bg-ocean text-white' : 'border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-ocean/50'
                      }`}
                    >
                      {l === 'tr' ? '🇹🇷 Türkçe' : '🇬🇧 English'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-1 block">
                  {lang === 'tr' ? 'İçerik' : 'Content'}
                </label>
                <textarea
                  value={addContent}
                  onChange={e => setAddContent(e.target.value)}
                  placeholder={lang === 'tr' ? 'İçeriği buraya yapıştır veya yaz...' : 'Paste or type content here...'}
                  rows={3}
                  className="w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ocean/50 resize-none bg-white dark:bg-slate-600 dark:text-slate-100 dark:placeholder:text-slate-400"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="flex-1 py-2 border border-slate-200 dark:border-slate-600 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                >
                  {lang === 'tr' ? 'İptal' : 'Cancel'}
                </button>
                <button
                  onClick={handleAddEvent}
                  disabled={!addContent.trim()}
                  className="flex-1 py-2 bg-ocean hover:bg-ocean-dark disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {lang === 'tr' ? 'Ekle' : 'Add'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Day detail panel */}
      <div className="lg:col-span-1 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex flex-col gap-4">
        {selectedDay ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm">
                📅 {new Date(selectedDay + 'T12:00:00').toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })}
              </h3>
              <button
                onClick={() => setSelectedDay(null)}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-sm"
              >✕</button>
            </div>

            {selectedDayEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400 gap-2">
                <span className="text-3xl opacity-30">📭</span>
                <p className="text-xs text-center">
                  {lang === 'tr' ? 'Bu gün için içerik yok' : 'No content for this day'}
                </p>
                <button
                  onClick={() => {
                    setAddDate(selectedDay);
                    setShowAddForm(true);
                  }}
                  className="mt-1 text-xs text-ocean font-medium hover:underline"
                >
                  + {lang === 'tr' ? 'Ekle' : 'Add'}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 overflow-y-auto" style={{ maxHeight: '500px' }}>
                {selectedDayEvents.map(ev => (
                  <div
                    key={ev.id}
                    className={`rounded-xl border p-3 ${ev.published ? 'border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20' : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-700'}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base">{PLATFORM_ICONS[ev.platform] || '📌'}</span>
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 capitalize">{ev.platform}</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">{ev.language === 'tr' ? '🇹🇷' : '🇬🇧'}</span>
                      {ev.published && (
                        <span className="ml-auto text-[10px] bg-green-600 text-white px-1.5 py-0.5 rounded-full font-semibold">
                          ✓ {lang === 'tr' ? 'Yayınlandı' : 'Published'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed line-clamp-3 mb-2">
                      {ev.content}
                    </p>
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 mb-2">
                      {timeAgo(ev.createdAt, lang)}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleToggle(ev.id)}
                        className={`flex-1 text-[11px] py-1 rounded-lg font-medium transition-colors ${
                          ev.published
                            ? 'bg-slate-100 dark:bg-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-500'
                            : 'bg-green-600 text-white hover:bg-green-700'
                        }`}
                      >
                        {ev.published
                          ? (lang === 'tr' ? '↩ Geri Al' : '↩ Undo')
                          : (lang === 'tr' ? '✓ Yayınlandı İşaretle' : '✓ Mark Published')}
                      </button>
                      <button
                        onClick={() => handleDelete(ev.id)}
                        className="px-2 py-1 text-[11px] bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-4 h-full">
            {/* Header */}
            <div className="flex flex-col items-center pt-4 text-slate-400 gap-1">
              <span className="text-4xl opacity-20">📅</span>
              <p className="text-sm text-center text-slate-500 dark:text-slate-400 font-medium">
                {lang === 'tr' ? 'İçerik Takvimi' : 'Content Calendar'}
              </p>
              <p className="text-xs text-center text-slate-400 dark:text-slate-500">
                {lang === 'tr' ? 'Bir güne tıkla ve o günün içeriklerini yönet' : 'Click a day to manage its content'}
              </p>
            </div>

            {/* Stats */}
            <div className="w-full bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{lang === 'tr' ? 'Toplam İçerik' : 'Total Content'}</span>
                <span className="font-semibold text-slate-700 dark:text-slate-200">{events.length}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{lang === 'tr' ? 'Yayınlanan' : 'Published'}</span>
                <span className="font-semibold text-green-600 dark:text-green-400">{events.filter(e => e.published).length}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{lang === 'tr' ? 'Bekleyen' : 'Pending'}</span>
                <span className="font-semibold text-orange-500">{events.filter(e => !e.published).length}</span>
              </div>
              {(() => {
                const todayPending = events.filter(e => e.date === todayKey && !e.published).length;
                return todayPending > 0 ? (
                  <div className="flex items-center justify-between text-xs mt-0.5 pt-1.5 border-t border-slate-200 dark:border-slate-600">
                    <span className="text-orange-500 font-medium">
                      🕐 {lang === 'tr' ? 'Bugün bekleyen' : 'Pending today'}
                    </span>
                    <span className="font-bold text-orange-500">{todayPending}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs mt-0.5 pt-1.5 border-t border-slate-200 dark:border-slate-600 text-green-600 dark:text-green-400">
                    <span>✓</span>
                    <span>{lang === 'tr' ? 'Bugün için bekleyen yok' : 'Nothing pending today'}</span>
                  </div>
                );
              })()}
            </div>

            {/* Scheduler button */}
            <div className="flex flex-col gap-2">
              <button
                onClick={runScheduler}
                disabled={schedLoading || events.filter(e => e.date === todayKey && !e.published).length === 0}
                className="w-full py-2.5 bg-ocean hover:bg-ocean-dark disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {schedLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {lang === 'tr' ? 'Yayınlanıyor...' : 'Publishing...'}
                  </>
                ) : (
                  <>
                    🚀 {lang === 'tr' ? 'Bugünü Otomatik Yayınla' : 'Auto-Publish Today'}
                  </>
                )}
              </button>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
                {lang === 'tr'
                  ? 'Bugünün bekleyen etkinlikleri sosyal medyaya gönderilir'
                  : "Today's pending events will be sent to social media"}
              </p>
            </div>

            {/* Scheduler result */}
            {schedResult && (
              <div className={`rounded-xl border p-3 text-xs ${
                schedResult.message && schedResult.published === 0
                  ? 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700'
                  : schedResult.failed > 0
                  ? 'border-orange-200 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20'
                  : 'border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
              }`}>
                {schedResult.message ? (
                  <p className="text-slate-500 dark:text-slate-400 font-medium">{schedResult.message}</p>
                ) : (
                  <>
                    <div className="flex items-center gap-3 mb-2 font-semibold">
                      <span className="text-green-600 dark:text-green-400">
                        ✓ {schedResult.published} {lang === 'tr' ? 'yayınlandı' : 'published'}
                      </span>
                      {schedResult.failed > 0 && (
                        <span className="text-red-500">
                          ✗ {schedResult.failed} {lang === 'tr' ? 'başarısız' : 'failed'}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                      {schedResult.results.map(r => (
                        <div key={r.eventId} className="flex items-center gap-1.5">
                          <span>{r.success ? '✓' : '✗'}</span>
                          <span className="capitalize text-slate-600 dark:text-slate-300">{PLATFORM_ICONS[r.platform] || '📌'} {r.platform}</span>
                          {r.url && (
                            <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-ocean hover:underline truncate max-w-[100px]">
                              link
                            </a>
                          )}
                          {r.error && <span className="text-red-400 truncate">{r.error}</span>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
