'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLang } from '@/lib/lang';

interface GroupInfo {
  id:       string;
  title:    string;
  username: string | null;
  members:  number;
  type:     'group' | 'channel';
}

interface BotStatus {
  running:     boolean;
  hasSession:  boolean;
  channels:    string[];
  botUsername: string;
  logs:        string[];
  stats:       { joined: number; dms: number; jobs: number };
  groups:      GroupInfo[];
}

const POLL_MS = 3000;

export default function TelegramBotTab() {
  const { lang } = useLang();
  const t = (tr: string, en: string) => lang === 'tr' ? tr : en;

  const [status,       setStatus]       = useState<BotStatus | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [actionBusy,   setActionBusy]   = useState(false);
  const [session,      setSession]      = useState('');
  const [newChannel,   setNewChannel]   = useState('');
  const [msg,          setMsg]          = useState('');
  const [msgOk,        setMsgOk]        = useState(true);
  const [showSession,  setShowSession]  = useState(false);
  const [groupSearch,  setGroupSearch]  = useState('');
  const [groupFilter,  setGroupFilter]  = useState<'all' | 'group' | 'channel'>('all');
  const [showLogs,     setShowLogs]     = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/userbot');
      if (res.ok) setStatus(await res.json());
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  useEffect(() => {
    if (showLogs && logsRef.current)
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [status?.logs, showLogs]);

  const call = async (body: object) => {
    setActionBusy(true);
    setMsg('');
    try {
      const res  = await fetch('/api/userbot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setMsgOk(data.ok ?? true);
      setMsg(data.message || '');
      await fetchStatus();
    } catch (e: unknown) {
      setMsgOk(false);
      setMsg(String(e));
    } finally {
      setActionBusy(false);
    }
  };

  const normalizeChannel = (ch: string) => {
    const m = ch.match(/t\.me\/([^?/\s]+)/);
    if (m) return `@${m[1]}`;
    if (ch && !ch.startsWith('@') && !ch.startsWith('-') && !/^\d/.test(ch)) return `@${ch}`;
    return ch;
  };

  const addChannel = async () => {
    const ch = normalizeChannel(newChannel.trim());
    if (!ch || !status) return;
    const channels = [...status.channels];
    if (!channels.includes(ch)) channels.push(ch);
    await call({ action: 'set_channels', channels });
    setNewChannel('');
  };

  const removeChannel = (ch: string) => {
    if (!status) return;
    call({ action: 'set_channels', channels: status.channels.filter(c => c !== ch) });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
        {t('Yükleniyor...', 'Loading...')}
      </div>
    );
  }

  const running    = status?.running    ?? false;
  const hasSession = status?.hasSession ?? false;
  const groups     = status?.groups     ?? [];
  const stats      = status?.stats      ?? { joined: 0, dms: 0, jobs: 0 };

  const filteredGroups = groups.filter(g => {
    const matchType = groupFilter === 'all' || g.type === groupFilter;
    const matchSearch = !groupSearch || g.title.toLowerCase().includes(groupSearch.toLowerCase()) ||
      (g.username?.toLowerCase().includes(groupSearch.toLowerCase()) ?? false);
    return matchType && matchSearch;
  });

  return (
    <div className="max-w-5xl mx-auto space-y-4 pb-10">

      {/* ── HEADER ── */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Sol: durum */}
          <div className="flex items-center gap-3 flex-1">
            <div className="relative">
              <span className="text-3xl">🤖</span>
              <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-800 ${running ? 'bg-green-500' : 'bg-slate-400'}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-slate-900 dark:text-slate-100">Telegram Userbot</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${running
                  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                  {running ? t('● Aktif', '● Active') : t('○ Durduruldu', '○ Stopped')}
                </span>
                {!hasSession && (
                  <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300 px-2 py-0.5 rounded-full">
                    {t('Oturum gerekli', 'Session required')}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('Gruplara katılım · İlan tespiti · Kullanıcı iletişimi', 'Group joining · Job detection · User outreach')}
              </p>
            </div>
          </div>

          {/* Sağ: butonlar */}
          <div className="flex items-center gap-2">
            {!running ? (
              <button onClick={() => call({ action: 'start' })}
                disabled={actionBusy || !hasSession}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-medium transition">
                <span>▶</span>{actionBusy ? t('Başlatılıyor...', 'Starting...') : t('Başlat', 'Start')}
              </button>
            ) : (
              <>
                <button onClick={() => call({ action: 'restart' })}
                  disabled={actionBusy}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium transition">
                  🔄 {actionBusy ? '...' : t('Yeniden Başlat', 'Restart')}
                </button>
                <button onClick={() => call({ action: 'stop' })}
                  disabled={actionBusy}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium transition">
                  ■ {t('Durdur', 'Stop')}
                </button>
              </>
            )}
          </div>
        </div>

        {msg && (
          <div className={`mt-3 text-xs px-3 py-2 rounded-lg ${msgOk
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
            {msg}
          </div>
        )}
      </div>

      {/* ── İSTATİSTİKLER ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: '👥', label: t('İzlenen Grup', 'Groups Monitored'), value: groups.length,   color: 'text-blue-600 dark:text-blue-400',   bg: 'bg-blue-50 dark:bg-blue-900/20'   },
          { icon: '🔗', label: t('Bu Oturumda Katıldı', 'Joined This Session'), value: stats.joined, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-900/20' },
          { icon: '📋', label: t('Tespit Edilen İlan', 'Jobs Detected'),  value: stats.jobs,   color: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-50 dark:bg-amber-900/20'  },
          { icon: '📨', label: t('Gönderilen DM', 'DMs Sent'),       value: stats.dms,    color: 'text-green-600 dark:text-green-400',  bg: 'bg-green-50 dark:bg-green-900/20'  },
        ].map(s => (
          <div key={s.icon} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center text-base mb-3`}>{s.icon}</div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-tight">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── ANA GRID: Gruplar + Ayarlar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* SOL: Grup listesi (3/5) */}
        <div className="lg:col-span-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
              👥 {t('İzlenen Gruplar & Kanallar', 'Monitored Groups & Channels')}
            </h3>
            {groups.length > 0 && (
              <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
                {filteredGroups.length} / {groups.length}
              </span>
            )}
          </div>

          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <span className="text-4xl mb-3">💬</span>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {running
                  ? t('Gruplar yükleniyor...', 'Loading groups...')
                  : t('Botu başlat — üye olduğun gruplar burada görünür', 'Start the bot — your groups will appear here')}
              </p>
            </div>
          ) : (
            <>
              {/* Arama + filtre */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={groupSearch}
                  onChange={e => setGroupSearch(e.target.value)}
                  placeholder={t('Grup ara...', 'Search groups...')}
                  className="flex-1 text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-slate-50 dark:bg-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 text-xs">
                  {(['all', 'group', 'channel'] as const).map(f => (
                    <button key={f}
                      onClick={() => setGroupFilter(f)}
                      className={`px-2.5 py-1.5 transition ${groupFilter === f
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600'}`}>
                      {f === 'all' ? t('Tümü', 'All') : f === 'group' ? t('Grup', 'Groups') : t('Kanal', 'Channels')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Liste */}
              <div className="max-h-72 overflow-y-auto space-y-1 pr-0.5">
                {filteredGroups.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">{t('Sonuç bulunamadı', 'No results')}</p>
                ) : (
                  filteredGroups.map(g => {
                    const target    = g.username || g.id;
                    const inTargets = (status?.channels ?? []).includes(target);
                    return (
                    <div key={g.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/60 transition">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-sm shrink-0">
                        {g.type === 'group' ? '👥' : '📢'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">{g.title}</div>
                        {g.username && (
                          <div className="text-xs text-slate-400 truncate">{g.username}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {g.members > 0 && (
                          <span className="text-xs text-slate-400">
                            {g.members >= 1000 ? `${(g.members / 1000).toFixed(1)}k` : g.members}
                            {' '}{t('üye', 'members')}
                          </span>
                        )}
                        <span className={`text-xs px-1.5 py-0.5 rounded-md ${g.type === 'group'
                          ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                          : 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'}`}>
                          {g.type === 'group' ? t('Grup', 'Group') : t('Kanal', 'Channel')}
                        </span>
                        <button
                          title={inTargets ? t('Hedeflerde mevcut', 'Already in targets') : t('Katılım hedefine ekle', 'Add to join targets')}
                          disabled={actionBusy || inTargets}
                          onClick={() => {
                            const channels = [...(status?.channels ?? [])];
                            if (!channels.includes(target)) channels.push(target);
                            call({ action: 'set_channels', channels });
                          }}
                          className={`w-6 h-6 rounded-md flex items-center justify-center text-xs transition
                            ${inTargets
                              ? 'bg-green-100 dark:bg-green-900/30 text-green-500 cursor-default'
                              : 'bg-slate-100 dark:bg-slate-600 text-slate-500 dark:text-slate-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 hover:text-blue-600 dark:hover:text-blue-400'}`}>
                          {inTargets ? '✓' : '+'}
                        </button>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* SAĞ: Ayarlar (2/5) */}
        <div className="lg:col-span-2 space-y-3">

          {/* Oturum */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">🔑 {t('Oturum', 'Session')}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${hasSession
                ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'}`}>
                {hasSession ? '✓ ' + t('Tanımlı', 'Set') : '✗ ' + t('Eksik', 'Missing')}
              </span>
            </div>

            {!hasSession && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-300 space-y-1.5">
                <p className="font-medium">{t('Kimlik doğrulama:', 'Authentication:')}</p>
                <div className="font-mono bg-amber-100 dark:bg-amber-900/40 rounded px-2 py-1 text-amber-800 dark:text-amber-200">
                  node userbot-auth.js
                </div>
                <p>{t('Çıkan TG_SESSION= değerini aşağıya yapıştır.', 'Paste the TG_SESSION= value below.')}</p>
              </div>
            )}

            <button onClick={() => setShowSession(v => !v)}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
              {showSession ? t('↑ Gizle', '↑ Hide') : hasSession ? t('↻ Güncelle', '↻ Update') : t('+ Oturum ekle', '+ Add session')}
            </button>

            {showSession && (
              <div className="space-y-2">
                <input
                  type="text"
                  name="tg-session-unique"
                  autoComplete="off"
                  data-lpignore="true"
                  data-1p-ignore="true"
                  value={session}
                  onChange={e => setSession(e.target.value)}
                  placeholder={t('1BAA... ile başlayan session değeri', 'Session value starting with 1BAA...')}
                  className="w-full text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-transparent dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
                />
                <button
                  onClick={async () => { await call({ action: 'save_session', session }); setSession(''); setShowSession(false); }}
                  disabled={actionBusy || !session.trim()}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs rounded-lg transition font-medium">
                  {t('Kaydet', 'Save')}
                </button>
              </div>
            )}
          </div>

          {/* Hedef Kanallar */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
              📡 {t('Katılım Hedefleri', 'Join Targets')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('Bot bunlara başlarken katılır.', 'Bot joins these on startup.')}
              {running && <span className="text-amber-500"> {t('Değiştirince 🔄 bas.', 'Restart after changes.')}</span>}
            </p>

            <div className="flex flex-wrap gap-1.5">
              {(status?.channels ?? []).length === 0
                ? <span className="text-xs text-slate-400">{t('Hedef eklenmedi', 'No targets')}</span>
                : (status?.channels ?? []).map(ch => (
                  <span key={ch} className="flex items-center gap-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs px-2 py-1 rounded-full border border-blue-200 dark:border-blue-800">
                    {ch}
                    <button onClick={() => removeChannel(ch)} className="text-blue-400 hover:text-red-500 transition leading-none ml-0.5">×</button>
                  </span>
                ))
              }
            </div>

            <div className="flex gap-1.5">
              <input
                type="text"
                value={newChannel}
                onChange={e => setNewChannel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addChannel()}
                placeholder={t('@kanal veya t.me/...', '@channel or t.me/...')}
                className="flex-1 text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-slate-50 dark:bg-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={addChannel}
                disabled={actionBusy || !newChannel.trim()}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs rounded-lg transition">
                +
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── LOGLAR (açılır-kapanır) ── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
        <button
          onClick={() => setShowLogs(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition">
          <div className="flex items-center gap-2">
            <span className="text-sm">📟</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
              {t('Canlı Loglar', 'Live Logs')}
            </span>
            {(status?.logs ?? []).length > 0 && (
              <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-500 px-1.5 py-0.5 rounded-full">
                {(status?.logs ?? []).length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {showLogs && (
              <button onClick={e => { e.stopPropagation(); call({ action: 'clear_logs' }); }}
                className="text-xs text-slate-400 hover:text-red-500 transition">
                {t('Temizle', 'Clear')}
              </button>
            )}
            <span className="text-slate-400 text-xs">{showLogs ? '▲' : '▼'}</span>
          </div>
        </button>

        {showLogs && (
          <div
            ref={logsRef}
            className="h-72 overflow-y-auto bg-slate-950 p-4 font-mono text-xs space-y-0.5 border-t border-slate-200 dark:border-slate-700">
            {(status?.logs ?? []).length === 0 ? (
              <span className="text-slate-600">{t('Henüz log yok. Botu başlat.', 'No logs yet. Start the bot.')}</span>
            ) : (
              (status?.logs ?? []).map((line, i) => (
                <div key={i} className={
                  line.includes('✅') || line.includes('Config JSON') ? 'text-green-400' :
                  line.includes('❌') || line.includes('⚠') || line.includes('Fatal') ? 'text-red-400' :
                  line.includes('📨') ? 'text-cyan-400' :
                  line.includes('📋') || line.includes('İlan') ? 'text-yellow-300' :
                  line.includes('▶') || line.includes('🔄') ? 'text-blue-400' :
                  line.includes('■') ? 'text-slate-500' :
                  'text-slate-400'
                }>{line}</div>
              ))
            )}
          </div>
        )}
      </div>

    </div>
  );
}
