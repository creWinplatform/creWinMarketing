'use client';
import { useState, useEffect } from 'react';
import OutputPanel from '../OutputPanel';
import { getTextModel } from '../ModelPicker';
import { logActivity } from '@/lib/activity-log';
import { useLang } from '@/lib/lang';

type SubTab = 'whatsapp' | 'telegram_channel' | 'telegram_bot' | 'notify_wa' | 'notify_tg';

// ── WhatsApp ──────────────────────────────────────────────────────────────────
const WA_AUDIENCES = [
  { value: 'seafarer_global', label: '🌍 Global Seafarers' },
  { value: 'seafarer_tr',     label: '🇹🇷 Türk Gemi Adamları' },
  { value: 'shipowner',       label: '🚢 Armatörler & Crew Manager' },
  { value: 'cadet',           label: '🎓 Cadet & Genç Denizci' },
];

const WA_OBJECTIVES = [
  { value: 'registration',    label: '📝 Yeni Seafarer Kaydı' },
  { value: 'job_apply',       label: '💼 İlan Başvurusu' },
  { value: 'company_signup',  label: '🏢 Firma / Armatör Kaydı (B2B)' },
];

const WA_PLATFORMS = [
  { value: 'facebook',   label: '📘 Facebook' },
  { value: 'instagram',  label: '📸 Instagram' },
  { value: 'both',       label: '📘📸 Her İkisi' },
];

// ── Telegram Kanal ────────────────────────────────────────────────────────────
const TG_CONTENT_TYPES = [
  { value: 'weekly_plan',      label: '📅 Haftalık İçerik Takvimi' },
  { value: 'daily_post',       label: '📢 Günlük İlan Post Şablonları' },
  { value: 'sponsored_post',   label: '🤝 Sponsorlu Post Şablonları' },
  { value: 'channel_strategy', label: '🚀 Kanal Büyütme Stratejisi' },
  { value: 'growth_plan',      label: '📈 90 Günlük Büyüme Planı' },
];

const TG_NICHES = [
  { value: 'all',       label: '⚓ Tüm Seafarerlar' },
  { value: 'officers',  label: '🎖️ Deck Officers' },
  { value: 'engineers', label: '⚙️ Engine Officers' },
  { value: 'cadets',    label: '🎓 Cadetler' },
  { value: 'offshore',  label: '🛢️ Offshore' },
];

const TG_CHANNEL_LANGS = [
  { value: 'multi', label: '🌍 Çok Dilli (EN ana)' },
  { value: 'en',    label: '🇬🇧 English only' },
  { value: 'tr',    label: '🇹🇷 Türkçe' },
  { value: 'ph',    label: '🇵🇭 Filipino / Tagalog' },
];

// ── Telegram Bot ──────────────────────────────────────────────────────────────
const BOT_TYPES = [
  { value: 'registration', label: '📝 Kayıt Botu (Yeni Kullanıcı)' },
  { value: 'job_search',   label: '🔍 İş Arama Botu' },
  { value: 'company',      label: '🏢 Firma / B2B Lead Botu' },
  { value: 'full',         label: '⚡ Tam Özellikli Bot (Hepsi)' },
];

const BOT_FEATURES = [
  { value: 'job_search',  label: '🔍 İlan Arama' },
  { value: 'cv_tips',     label: '📄 CV Tavsiyeleri' },
  { value: 'salary_info', label: '💰 Maaş Rehberi' },
  { value: 'alerts',      label: '🔔 Uyarı/Bildirim Sistemi' },
  { value: 'stcw',        label: '📋 STCW Bilgisi' },
  { value: 'multilang',   label: '🌍 Çok Dil Desteği' },
];

export default function MessagingTab() {
  const { lang } = useLang();
  const [subTab,   setSubTab]   = useState<SubTab>('whatsapp');
  const [language, setLanguage] = useState<'tr' | 'en'>('en');
  const [output,   setOutput]   = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // ── Send state ──────────────────────────────────────────────────
  const [msgText,      setMsgText]      = useState('');
  const [msgNumbers,   setMsgNumbers]   = useState('');
  const [msgChatIds,   setMsgChatIds]   = useState('');
  const [msgMode,      setMsgMode]      = useState<'single'|'broadcast'|'channel'>('channel');
  const [sendLoading,  setSendLoading]  = useState(false);
  const [sendResult,   setSendResult]   = useState<{ sent?: number; failed?: number; success?: boolean; error?: string } | null>(null);

  // ── WA/TG config status ────────────────────────────────────────────────────
  const [msgConfig, setMsgConfig] = useState<{ whatsapp: { configured: boolean }; telegram: { configured: boolean } } | null>(null);
  useEffect(() => {
    fetch('/api/messaging/config').then(r => r.json()).then(setMsgConfig).catch(() => null);
  }, []);

  // WhatsApp state
  const [waAudience,   setWaAudience]   = useState('seafarer_global');
  const [waObjective,  setWaObjective]  = useState('registration');
  const [waAdPlatform, setWaAdPlatform] = useState('both');
  const [waNumber,     setWaNumber]     = useState('');
  const [waCustomGoal, setWaCustomGoal] = useState('');

  // Telegram Channel state
  const [tgContentType, setTgContentType] = useState('weekly_plan');
  const [tgNiche,       setTgNiche]       = useState('all');
  const [tgChannelLang, setTgChannelLang] = useState('multi');
  const [tgHandle,      setTgHandle]      = useState('');

  // Telegram Bot state
  const [botType,    setBotType]    = useState('registration');
  const [botHandle,  setBotHandle]  = useState('');
  const [botFeatures,setBotFeatures]= useState<string[]>(['job_search', 'alerts']);

  const toggleFeature = (v: string) =>
    setBotFeatures(prev => prev.includes(v) ? prev.filter(f => f !== v) : [...prev, v]);

  // ── Send real message ──────────────────────────────────────────────────
  const sendMessage = async () => {
    setSendLoading(true);
    setSendResult(null);
    try {
      if (subTab === 'notify_wa') {
        const numbers = msgMode === 'broadcast'
          ? msgNumbers.split('\n').map(s => s.trim()).filter(Boolean)
          : undefined;
        const to = msgMode === 'single' ? msgNumbers.trim() : undefined;
        const res = await fetch('/api/messaging/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: msgMode === 'channel' ? 'single' : msgMode, to, numbers, text: msgText }),
        });
        const waData = await res.json();
        setSendResult(waData);
        if (!waData.error) logActivity('wa_sent', `WhatsApp ${lang === 'tr' ? 'mesajı gönderildi' : 'message sent'} (${msgMode})`, `${msgText.slice(0, 60)}…`);
      } else {
        const chatIds = msgMode === 'broadcast'
          ? msgChatIds.split('\n').map(s => s.trim()).filter(Boolean)
          : undefined;
        const chatId = msgMode === 'single' ? msgChatIds.trim() : undefined;
        const res = await fetch('/api/messaging/telegram/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: msgMode, chatId, chatIds, text: msgText, parseMode: 'HTML' }),
        });
        const tgData = await res.json();
        setSendResult(tgData);
        if (!tgData.error) logActivity('tg_sent', `Telegram ${lang === 'tr' ? 'mesajı gönderildi' : 'message sent'} (${msgMode})`, `${msgText.slice(0, 60)}…`);
      }
    } catch (e: unknown) {
      setSendResult({ error: e instanceof Error ? e.message : lang === 'tr' ? 'Hata oluştu' : 'An error occurred' });
    } finally {
      setSendLoading(false);
    }
  };

  const generate = async () => {
    setLoading(true);
    setError('');
    setOutput('');
    try {
      let body: Record<string, unknown>;

      if (subTab === 'whatsapp') {
        body = {
          type:          'click_to_whatsapp',
          audience:      waAudience,
          objective:     waObjective,
          adPlatform:    waAdPlatform,
          whatsappNumber: waNumber,
          customGoal:    waCustomGoal,
          language,
        };
      } else if (subTab === 'telegram_channel') {
        body = {
          type:          'telegram_channel',
          contentType:   tgContentType,
          niche:         tgNiche,
          channelLang:   tgChannelLang,
          telegramHandle: tgHandle,
          language,
        };
      } else {
        body = {
          type:       'telegram_bot',
          botType,
          botHandle,
          features:   botFeatures,
          language,
        };
      }

      const res = await fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...body, textModel: getTextModel() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOutput(data.content);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : lang === 'tr' ? 'Hata oluştu' : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const generateLabel = () => {
    if (loading) return lang === 'tr' ? 'Üretiliyor...' : 'Generating...';
    if (subTab === 'whatsapp')         return lang === 'tr' ? '📲 WhatsApp Kampanyası Üret' : '📲 Generate WhatsApp Campaign';
    if (subTab === 'telegram_channel') return lang === 'tr' ? '📢 Telegram İçeriği Üret'   : '📢 Generate Telegram Content';
    return lang === 'tr' ? '🤖 Telegram Bot Tasarımı Üret' : '🤖 Generate Telegram Bot Design';
  };

  const SUB_TABS: { id: SubTab; icon: string; label: string; color: string; group_tr: string; group_en: string }[] = [
    { id: 'whatsapp',         icon: '📲', label: 'Click-to-WhatsApp',                               color: 'bg-green-500',   group_tr: 'Yeni Kullanıcı (İçerik)', group_en: 'New User (Content)' },
    { id: 'telegram_channel', icon: '📢', label: lang === 'tr' ? 'Telegram Kanal' : 'Telegram Channel', color: 'bg-sky-500',     group_tr: 'Yeni Kullanıcı (İçerik)', group_en: 'New User (Content)' },
    { id: 'telegram_bot',     icon: '🤖', label: 'Telegram Bot',                                    color: 'bg-indigo-500',  group_tr: 'Yeni Kullanıcı (İçerik)', group_en: 'New User (Content)' },
    { id: 'notify_wa',        icon: '📩', label: lang === 'tr' ? 'WA Bildirim Gönder' : 'Send WA Notification', color: 'bg-emerald-600', group_tr: 'Mevcut Kullanıcı (Gönder)', group_en: 'Existing User (Send)' },
    { id: 'notify_tg',        icon: '✈️', label: lang === 'tr' ? 'TG Kanal Gönder'   : 'Send TG Channel',        color: 'bg-cyan-600',    group_tr: 'Mevcut Kullanıcı (Gönder)', group_en: 'Existing User (Send)' },
  ];

  const groups = lang === 'tr'
    ? ['Yeni Kullanıcı (İçerik)', 'Mevcut Kullanıcı (Gönder)'] as const
    : ['New User (Content)', 'Existing User (Send)'] as const;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Left panel */}
      <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 flex flex-col gap-5">

        {/* Header */}
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-base mb-1 flex items-center gap-2">
            <span>💬</span> WhatsApp & Telegram
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            {lang === 'tr'
              ? 'Yeni kullanıcılara ulaşmak için Click-to-WA reklamları, Telegram kanal içerikleri ve bot akışları üretir.'
              : 'Generates Click-to-WA ads, Telegram channel content, and bot flows to reach new users.'}
          </p>
        </div>

        {/* Sub-tabs */}
        <div className="flex flex-col gap-1">
          {groups.map(group => (
            <div key={group}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1 mb-1 mt-2 first:mt-0">
                {group}
              </p>
              {SUB_TABS.filter(t => (lang === 'tr' ? t.group_tr : t.group_en) === group).map(t => (
                <button
                  key={t.id}
                  onClick={() => { setSubTab(t.id); setOutput(''); setError(''); setSendResult(null); }}
                  className={`w-full flex items-center gap-2.5 py-2.5 px-3 rounded-lg text-sm font-medium transition-colors text-left mb-1 ${
                    subTab === t.id
                      ? `${t.color} text-white shadow-sm`
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  <span className="text-base">{t.icon}</span>
                  <span>{t.label}</span>
                  {/* Config badge */}
                  {t.id === 'notify_wa' && msgConfig && (
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      msgConfig.whatsapp.configured ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                    }`}>{msgConfig.whatsapp.configured ? '●' : '○'}</span>
                  )}
                  {t.id === 'notify_tg' && msgConfig && (
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      msgConfig.telegram.configured ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                    }`}>{msgConfig.telegram.configured ? '●' : '○'}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* ── WhatsApp Form ── */}
        {subTab === 'whatsapp' && (
          <>
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-lg p-3 text-xs text-green-800 dark:text-green-300 flex gap-2">
              <span className="text-base shrink-0">📲</span>
              <div>
                <p className="font-semibold mb-1">Click-to-WhatsApp Ads</p>
                <p className="leading-relaxed">
                  {lang === 'tr'
                    ? 'Facebook/Instagram reklamında "WhatsApp\'ta Yaz" butonu → kullanıcı kendi isteğiyle başlatıyor → bot karşılıyor → crewinjob.com\'a kayıt.'
                    : 'Facebook/Instagram ad "Message on WhatsApp" button → user initiates voluntarily → bot greets → registration on crewinjob.com.'}
                </p>
              </div>
            </div>

            <Field label={lang === 'tr' ? 'Hedef Kitle' : 'Target Audience'}>
              <select value={waAudience} onChange={e => setWaAudience(e.target.value)} className={selectClass}>
                {WA_AUDIENCES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </Field>

            <Field label={lang === 'tr' ? 'Kampanya Amacı' : 'Campaign Objective'}>
              <select value={waObjective} onChange={e => setWaObjective(e.target.value)} className={selectClass}>
                {WA_OBJECTIVES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>

            <Field label={lang === 'tr' ? 'Reklam Platformu' : 'Ad Platform'}>
              <div className="grid grid-cols-3 gap-1.5">
                {WA_PLATFORMS.map(p => (
                  <button key={p.value} onClick={() => setWaAdPlatform(p.value)}
                    className={`text-xs py-2 px-2 rounded-lg font-medium transition-colors ${
                      waAdPlatform === p.value ? 'bg-green-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={lang === 'tr' ? 'WhatsApp Numarası' : 'WhatsApp Number'}>
              <input type="text" value={waNumber} onChange={e => setWaNumber(e.target.value)}
                placeholder="+90 XXX XXX XX XX"
                className={selectClass} />
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {lang === 'tr' ? 'Bot karşılama mesajlarında ve reklamlarda kullanılır.' : 'Used in bot greeting messages and ads.'}
              </p>
            </Field>

            <Field label={lang === 'tr' ? 'Özel Hedef (opsiyonel)' : 'Custom Goal (optional)'}>
              <textarea value={waCustomGoal} onChange={e => setWaCustomGoal(e.target.value)}
                placeholder={lang === 'tr' ? 'Örn: 500 yeni Filipino seafarer kaydı, CPL < $1' : 'E.g.: 500 new Filipino seafarer registrations, CPL < $1'}
                rows={2} className={`${selectClass} resize-none`} />
            </Field>
          </>
        )}

        {/* ── Telegram Channel Form ── */}
        {subTab === 'telegram_channel' && (
          <>
            <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-700 rounded-lg p-3 text-xs text-sky-800 dark:text-sky-300 flex gap-2">
              <span className="text-base shrink-0">📢</span>
              <div>
                <p className="font-semibold mb-1">{lang === 'tr' ? 'Telegram Kanal Stratejisi' : 'Telegram Channel Strategy'}</p>
                <p className="leading-relaxed">
                  {lang === 'tr'
                    ? 'Günlük ilan akışı, sponsorlu postlar ve 0→10K abone büyüme planı. Tamamen ücretsiz broadcast.'
                    : 'Daily job feed, sponsored posts, and 0→10K subscriber growth plan. Completely free broadcast.'}
                </p>
              </div>
            </div>

            <Field label={lang === 'tr' ? 'İçerik Tipi' : 'Content Type'}>
              <select value={tgContentType} onChange={e => setTgContentType(e.target.value)} className={selectClass}>
                {TG_CONTENT_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>

            <Field label={lang === 'tr' ? 'Hedef Kitle (Niche)' : 'Target Audience (Niche)'}>
              <div className="grid grid-cols-2 gap-1.5">
                {TG_NICHES.map(n => (
                  <button key={n.value} onClick={() => setTgNiche(n.value)}
                    className={`text-xs py-2 px-2 rounded-lg font-medium transition-colors text-left ${
                      tgNiche === n.value ? 'bg-sky-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}>
                    {n.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={lang === 'tr' ? 'Kanal Dili' : 'Channel Language'}>
              <div className="grid grid-cols-2 gap-1.5">
                {TG_CHANNEL_LANGS.map(l => (
                  <button key={l.value} onClick={() => setTgChannelLang(l.value)}
                    className={`text-xs py-2 px-2 rounded-lg font-medium transition-colors ${
                      tgChannelLang === l.value ? 'bg-sky-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}>
                    {l.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={lang === 'tr' ? 'Kanal Adresi (opsiyonel)' : 'Channel Handle (optional)'}>
              <input type="text" value={tgHandle} onChange={e => setTgHandle(e.target.value)}
                placeholder="@crewinjob_jobs"
                className={selectClass} />
            </Field>
          </>
        )}

        {/* ── Telegram Bot Form ── */}
        {subTab === 'telegram_bot' && (
          <>
            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg p-3 text-xs text-indigo-800 dark:text-indigo-300 flex gap-2">
              <span className="text-base shrink-0">🤖</span>
              <div>
                <p className="font-semibold mb-1">{lang === 'tr' ? 'Telegram Bot Tasarımı' : 'Telegram Bot Design'}</p>
                <p className="leading-relaxed">
                  {lang === 'tr'
                    ? 'Kullanıcı botu açar → rütbe/gemi tipi soruları → kişiselleştirilmiş ilan özeti → crewinjob.com kayıt linki. Tam diyalog scripti + teknik dokümantasyon.'
                    : 'User opens bot → rank/vessel type questions → personalized job summary → crewinjob.com registration link. Full dialogue script + technical documentation.'}
                </p>
              </div>
            </div>

            <Field label={lang === 'tr' ? 'Bot Tipi' : 'Bot Type'}>
              <select value={botType} onChange={e => setBotType(e.target.value)} className={selectClass}>
                {BOT_TYPES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
            </Field>

            <Field label={lang === 'tr' ? 'Bot Adresi (opsiyonel)' : 'Bot Handle (optional)'}>
              <input type="text" value={botHandle} onChange={e => setBotHandle(e.target.value)}
                placeholder="@CrewinJobsBot"
                className={selectClass} />
            </Field>

            <Field label={lang === 'tr' ? 'Ek Özellikler' : 'Additional Features'}>
              <div className="grid grid-cols-2 gap-1.5">
                {BOT_FEATURES.map(f => (
                  <button key={f.value} onClick={() => toggleFeature(f.value)}
                    className={`text-xs py-2 px-2 rounded-lg font-medium transition-colors text-left ${
                      botFeatures.includes(f.value)
                        ? 'bg-indigo-500 text-white'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}>
                    {f.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {lang === 'tr' ? 'Seçilenler bot tasarımına dahil edilir.' : 'Selected features are included in the bot design.'}
              </p>
            </Field>
          </>
        )}

        {/* ── WA Notification Send ── */}
        {subTab === 'notify_wa' && (
          <>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-lg p-3 text-xs text-emerald-800 dark:text-emerald-300 flex gap-2">
              <span className="text-base shrink-0">📩</span>
              <div>
                <p className="font-semibold mb-1">{lang === 'tr' ? 'WhatsApp Bildirim Gönder' : 'Send WhatsApp Notification'}</p>
                <p className="leading-relaxed">
                  {lang === 'tr'
                    ? <>Mevcut kullanıcılara doğrudan WhatsApp mesajı. Önce <code>WHATSAPP_PHONE_NUMBER_ID</code> ve <code>WHATSAPP_ACCESS_TOKEN</code> ayarlayın.</>
                    : <>Direct WhatsApp message to existing users. First set <code>WHATSAPP_PHONE_NUMBER_ID</code> and <code>WHATSAPP_ACCESS_TOKEN</code>.</>}
                </p>
              </div>
            </div>

            {msgConfig && !msgConfig.whatsapp.configured && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3 text-xs text-red-700 dark:text-red-300">
                ⚠️ <strong>.env.local</strong> {lang === 'tr' ? 'içinde' : ':'} <code>WHATSAPP_PHONE_NUMBER_ID</code> {lang === 'tr' ? 've' : 'and'} <code>WHATSAPP_ACCESS_TOKEN</code> {lang === 'tr' ? 'tanımlanmamış.' : 'not configured.'}
              </div>
            )}

            <Field label={lang === 'tr' ? 'Gönderim Modu' : 'Send Mode'}>
              <div className="grid grid-cols-2 gap-1.5">
                {([['single', lang === 'tr' ? 'Tekli' : 'Single'], ['broadcast', lang === 'tr' ? 'Toplu' : 'Broadcast']] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setMsgMode(v)}
                    className={`text-xs py-2 rounded-lg font-medium transition-colors ${
                      msgMode === v ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}>
                    {v === 'single' ? '👤 ' : '👥 '}{l}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={msgMode === 'broadcast'
              ? (lang === 'tr' ? 'Telefon Numaraları (her satıra bir tane)' : 'Phone Numbers (one per line)')
              : (lang === 'tr' ? 'Telefon Numarası' : 'Phone Number')}>
              <textarea value={msgNumbers} onChange={e => setMsgNumbers(e.target.value)}
                placeholder={msgMode === 'broadcast' ? '+905XXXXXXXXX\n+905XXXXXXXXX\n...' : '+905XXXXXXXXX'}
                rows={msgMode === 'broadcast' ? 5 : 2}
                className={`${selectClass} resize-none font-mono text-xs`} />
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {lang === 'tr' ? 'E.164 format — ülke kodu dahil (+90...)' : 'E.164 format — include country code (+90...)'}
              </p>
            </Field>

            <Field label={lang === 'tr' ? 'Mesaj' : 'Message'}>
              <textarea value={msgText} onChange={e => setMsgText(e.target.value)}
                placeholder={lang === 'tr' ? "Merhaba! crewinjob.com'da yeni ilanlar sizi bekliyor. Hemen bakın: crewinjob.com" : "Hello! New job listings are waiting for you on crewinjob.com. Check now: crewinjob.com"}
                rows={4} className={`${selectClass} resize-none`} />
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {msgText.length} {lang === 'tr' ? 'karakter — WhatsApp limiti 4096' : 'characters — WhatsApp limit 4096'}
              </p>
            </Field>
          </>
        )}

        {/* ── Telegram Channel Send ── */}
        {subTab === 'notify_tg' && (
          <>
            <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-700 rounded-lg p-3 text-xs text-cyan-800 dark:text-cyan-300 flex gap-2">
              <span className="text-base shrink-0">✈️</span>
              <div>
                <p className="font-semibold mb-1">{lang === 'tr' ? 'Telegram Gönder' : 'Send Telegram'}</p>
                <p className="leading-relaxed">
                  {lang === 'tr'
                    ? <>{`Kanala, gruba veya tek kullanıcıya mesaj. `}<code>TELEGRAM_BOT_TOKEN</code>{` ve `}<code>TELEGRAM_CHANNEL_ID</code>{` gerekli.`}</>
                    : <>Message to channel, group, or individual user. <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHANNEL_ID</code> required.</>}
                </p>
              </div>
            </div>

            {msgConfig && !msgConfig.telegram.configured && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3 text-xs text-red-700 dark:text-red-300">
                ⚠️ <strong>.env.local</strong> {lang === 'tr' ? 'içinde' : ':'} <code>TELEGRAM_BOT_TOKEN</code> {lang === 'tr' ? 'tanımlanmamış.' : 'not configured.'}
              </div>
            )}

            <Field label={lang === 'tr' ? 'Gönderim Modu' : 'Send Mode'}>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  ['channel',   lang === 'tr' ? 'Kanal'  : 'Channel'],
                  ['single',    lang === 'tr' ? 'Tekli'  : 'Single'],
                  ['broadcast', lang === 'tr' ? 'Toplu'  : 'Broadcast'],
                ] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setMsgMode(v)}
                    className={`text-xs py-2 rounded-lg font-medium transition-colors ${
                      msgMode === v ? 'bg-cyan-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}>
                    {v === 'channel' ? '📢 ' : v === 'single' ? '👤 ' : '👥 '}{l}
                  </button>
                ))}
              </div>
              {msgMode === 'channel' && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  {lang === 'tr' ? 'TELEGRAM_CHANNEL_ID env değeri kullanılır.' : 'Uses the TELEGRAM_CHANNEL_ID env value.'}
                </p>
              )}
            </Field>

            {(msgMode === 'single' || msgMode === 'broadcast') && (
              <Field label={msgMode === 'broadcast'
                ? (lang === 'tr' ? "Chat ID'ler (her satıra bir tane)" : 'Chat IDs (one per line)')
                : (lang === 'tr' ? 'Chat ID veya @handle' : 'Chat ID or @handle')}>
                <textarea value={msgChatIds} onChange={e => setMsgChatIds(e.target.value)}
                  placeholder={msgMode === 'broadcast' ? '-1001234567890\n-1009876543210\n...' : '@crewinjob veya -1001234567890'}
                  rows={msgMode === 'broadcast' ? 5 : 2}
                  className={`${selectClass} resize-none font-mono text-xs`} />
              </Field>
            )}

            <Field label={lang === 'tr' ? 'Mesaj (HTML destekler)' : 'Message (supports HTML)'}>
              <textarea value={msgText} onChange={e => setMsgText(e.target.value)}
                placeholder="<b>Yeni ilanlar!</b> crewinjob.com'da arama yapın 👇&#10;<a href='https://crewinjob.com'>crewinjob.com</a>"
                rows={5} className={`${selectClass} resize-none font-mono text-xs`} />
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {lang === 'tr' ? 'Etiketler: ' : 'Tags: '}&lt;b&gt;, &lt;i&gt;, &lt;a href&gt;, &lt;code&gt;
              </p>
            </Field>
          </>
        )}

        {/* Output language — only for content generation tabs */}
        {!['notify_wa', 'notify_tg'].includes(subTab) && (
          <Field label={lang === 'tr' ? 'Çıktı Dili' : 'Output Language'}>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'tr', flag: '🇹🇷', label: 'Türkçe' },
                { value: 'en', flag: '🇬🇧', label: 'English' },
              ] as { value: 'tr' | 'en'; flag: string; label: string }[]).map(l => (
                <button key={l.value} onClick={() => setLanguage(l.value)}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors border-2 ${
                    language === l.value
                      ? 'bg-ocean text-white border-ocean'
                      : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-ocean/50'
                  }`}>
                  <span className="text-base">{l.flag}</span>
                  <span>{l.label}</span>
                </button>
              ))}
            </div>
          </Field>
        )}

        {/* Generate content button */}
        {!['notify_wa', 'notify_tg'].includes(subTab) && (
          <button onClick={generate} disabled={loading}
            className="w-full bg-ocean hover:bg-ocean-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-auto">
            {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {generateLabel()}
          </button>
        )}

        {/* Send message button */}
        {['notify_wa', 'notify_tg'].includes(subTab) && (
          <button onClick={sendMessage} disabled={sendLoading || !msgText.trim()}
            className={`w-full disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-auto ${
              subTab === 'notify_wa' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-cyan-600 hover:bg-cyan-700'
            }`}>
            {sendLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {subTab === 'notify_wa'
              ? (lang === 'tr' ? '📩 WhatsApp Gönder' : '📩 Send WhatsApp')
              : (lang === 'tr' ? '✈️ Telegram Gönder' : '✈️ Send Telegram')}
          </button>
        )}
      </div>

      {/* Right panel — output or send result */}
      <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        {/* Content generation panel */}
        {!['notify_wa', 'notify_tg'].includes(subTab) && (
          <>
            <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm mb-4 flex items-center gap-2">
              {subTab === 'whatsapp'         && <><span>📲</span> {lang === 'tr' ? 'Click-to-WhatsApp Kampanya Paketi' : 'Click-to-WhatsApp Campaign Package'}</>}
              {subTab === 'telegram_channel' && <><span>📢</span> {lang === 'tr' ? 'Telegram Kanal İçeriği' : 'Telegram Channel Content'}</>}
              {subTab === 'telegram_bot'     && <><span>🤖</span> {lang === 'tr' ? 'Telegram Bot Tasarım Dokümanı' : 'Telegram Bot Design Document'}</>}
            </h3>
            <OutputPanel
              content={output}
              loading={loading}
              error={error}
              platform={subTab === 'whatsapp' ? 'facebook' : 'instagram'}
              contentType={
                subTab === 'whatsapp'         ? 'click_to_whatsapp' :
                subTab === 'telegram_channel' ? 'telegram_channel'  :
                'telegram_bot'
              }
              autoSaveHistory={{ prompt: `${lang === 'tr' ? 'Mesajlaşma' : 'Messaging'} · ${subTab}`, language }}
            />
          </>
        )}

        {/* Send result panel */}
        {['notify_wa', 'notify_tg'].includes(subTab) && (
          <div className="flex flex-col gap-4">
            <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
              {subTab === 'notify_wa'
                ? <><span>📩</span> {lang === 'tr' ? 'WhatsApp Gönderim Durumu' : 'WhatsApp Send Status'}</>
                : <><span>✈️</span> {lang === 'tr' ? 'Telegram Gönderim Durumu' : 'Telegram Send Status'}</>}
            </h3>

            {/* Info box */}
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-5 text-sm text-slate-600 dark:text-slate-300 flex flex-col gap-3">
              <p className="font-semibold text-slate-700 dark:text-slate-200">
                {lang === 'tr' ? 'Nasıl çalışır?' : 'How does it work?'}
              </p>
              {subTab === 'notify_wa' ? (
                <ol className="list-decimal list-inside space-y-1.5 text-xs leading-relaxed">
                  {lang === 'tr' ? (
                    <>
                      <li><strong>.env.local</strong> içine <code>WHATSAPP_PHONE_NUMBER_ID</code> ve <code>WHATSAPP_ACCESS_TOKEN</code> yazın</li>
                      <li>Meta Business Manager → WhatsApp → API Setup adresinden Phone Number ID ve System User token alın</li>
                      <li>Solda alıcı numaraları ve mesaj metnini girin</li>
                      <li><strong>"WhatsApp Gönder"</strong> butonuna tıklayın</li>
                      <li>Sonuç buraya yansıyacak (gönderilen / hatalı sayısı)</li>
                    </>
                  ) : (
                    <>
                      <li>Add <code>WHATSAPP_PHONE_NUMBER_ID</code> and <code>WHATSAPP_ACCESS_TOKEN</code> to <strong>.env.local</strong></li>
                      <li>Get Phone Number ID and System User token from Meta Business Manager → WhatsApp → API Setup</li>
                      <li>Enter recipient numbers and message text on the left</li>
                      <li>Click the <strong>"Send WhatsApp"</strong> button</li>
                      <li>Result will appear here (sent / failed count)</li>
                    </>
                  )}
                </ol>
              ) : (
                <ol className="list-decimal list-inside space-y-1.5 text-xs leading-relaxed">
                  {lang === 'tr' ? (
                    <>
                      <li>@BotFather ile bot oluşturun → <code>TELEGRAM_BOT_TOKEN</code> alın</li>
                      <li>Botu kanalınıza admin olarak ekleyin</li>
                      <li><code>TELEGRAM_CHANNEL_ID</code> = @crewinjob_jobs veya -100... sayısal ID</li>
                      <li>Mod: <strong>Kanal</strong> = env'den channel ID otomatik; <strong>Tekli</strong> = chat_id girin; <strong>Toplu</strong> = satır satır chat_id listesi</li>
                      <li>HTML etiketleri desteklenir: &lt;b&gt;, &lt;i&gt;, &lt;a href&gt;</li>
                    </>
                  ) : (
                    <>
                      <li>Create bot with @BotFather → get <code>TELEGRAM_BOT_TOKEN</code></li>
                      <li>Add bot as admin to your channel</li>
                      <li><code>TELEGRAM_CHANNEL_ID</code> = @crewinjob_jobs or -100... numeric ID</li>
                      <li>Mode: <strong>Channel</strong> = auto from env; <strong>Single</strong> = enter chat_id; <strong>Broadcast</strong> = line-by-line chat_id list</li>
                      <li>HTML tags supported: &lt;b&gt;, &lt;i&gt;, &lt;a href&gt;</li>
                    </>
                  )}
                </ol>
              )}
            </div>

            {/* Send result */}
            {sendLoading && (
              <div className="flex items-center gap-3 py-6 text-slate-400 dark:text-slate-500 text-sm">
                <div className="w-5 h-5 border-2 border-ocean border-t-transparent rounded-full animate-spin" />
                {lang === 'tr' ? 'Gönderiliyor...' : 'Sending...'}
              </div>
            )}

            {sendResult && !sendLoading && (
              <div className={`rounded-xl p-5 border ${
                sendResult.error
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
                  : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700'
              }`}>
                {sendResult.error ? (
                  <div className="flex gap-2 items-start text-red-700 dark:text-red-300">
                    <span className="text-lg">❌</span>
                    <div>
                      <p className="font-semibold text-sm">{lang === 'tr' ? 'Gönderim başarısız' : 'Send failed'}</p>
                      <p className="text-xs mt-1 opacity-80">{sendResult.error}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 items-start text-green-700 dark:text-green-300">
                    <span className="text-lg">✅</span>
                    <div>
                      <p className="font-semibold text-sm">{lang === 'tr' ? 'Gönderim tamamlandı' : 'Send complete'}</p>
                      {sendResult.sent !== undefined && (
                        <div className="mt-2 flex gap-4 text-xs">
                          <span>✓ {lang === 'tr' ? 'Gönderilen' : 'Sent'}: <strong>{sendResult.sent}</strong></span>
                          {(sendResult.failed ?? 0) > 0 && (
                            <span className="text-amber-600 dark:text-amber-400">✗ {lang === 'tr' ? 'Başarısız' : 'Failed'}: <strong>{sendResult.failed}</strong></span>
                          )}
                        </div>
                      )}
                      {sendResult.success && sendResult.sent === undefined && (
                        <p className="text-xs mt-1">{lang === 'tr' ? 'Mesaj başarıyla iletildi.' : 'Message delivered successfully.'}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!sendResult && !sendLoading && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-300 dark:text-slate-600">
                <span className="text-5xl">{subTab === 'notify_wa' ? '📩' : '✈️'}</span>
                <p className="text-xs text-center">
                  {lang === 'tr' ? 'Mesajı doldurup gönder butonuna tıklayın' : 'Fill in the message and click the send button'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const selectClass = 'w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-ocean/50 focus:border-ocean placeholder:text-slate-400 dark:placeholder:text-slate-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>
      {children}
    </div>
  );
}
