'use client';
import { useState, useEffect, useMemo } from 'react';
import OutputPanel from '../OutputPanel';
import { getTextModel } from '../ModelPicker';
import { logActivity } from '@/lib/activity-log';
import { useLang } from '@/lib/lang';
import type { StatsResponse } from '@/lib/types';

type SubTab = 'whatsapp' | 'telegram_channel' | 'telegram_bot' | 'notify_wa' | 'notify_tg' | 'notify_email' | 'notify_job_match';

interface Props {
  stats?: StatsResponse;
}

// ── E-posta re-aktivasyon ────────────────────────────────────────────────────
const EMAIL_BUCKETS = [
  { value: 'zero', labelTr: '🚫 Hiç Başlamamış (%0)',   labelEn: '🚫 Never Started (0%)',   color: 'bg-red-500' },
  { value: 'low',   labelTr: '⚠️ Eksik Profil (%1–49)', labelEn: '⚠️ Incomplete Profile (1–49%)', color: 'bg-amber-500' },
  { value: 'mid',   labelTr: '🔶 Aktivasyona Yakın (%50–79)', labelEn: '🔶 Near Activation (50–79%)', color: 'bg-yellow-500' },
] as const;

interface JobListing {
  jobId:      number | null;
  title:      string;
  company:    string;
  vesselType: string;
  duration:   string;
  salary:     string;
  location:   string;
  postedAt:   string | null;
  applyUrl:   string;
}

// "Size Uygun İlanlar" kampanyasında tüm profil doluluklarını hedefleyebiliriz
const JOB_MATCH_BUCKETS = [
  { value: 'zero', labelTr: '🚫 Hiç Başlamamış (%0)',             labelEn: '🚫 Never Started (0%)',         color: 'bg-red-500' },
  { value: 'low',  labelTr: '⚠️ Yarım Bırakmış (%1–49)',          labelEn: '⚠️ Started Incomplete (1–49%)',  color: 'bg-amber-500' },
  { value: 'mid',  labelTr: '🔶 Aktivasyona Yakın (%50–79)',       labelEn: '🔶 Near Activation (50–79%)',    color: 'bg-yellow-500' },
  { value: 'high', labelTr: '✅ Activated Seafarer (%80+)',         labelEn: '✅ Activated Seafarer (80%+)',  color: 'bg-emerald-500' },
] as const;

interface EmailRecipient {
  email:           string;
  userId?:         number | null;
  fullName?:       string;
  fillRate:        number;
  lastActiveAt:    string | null;
  unsubscribeUrl?: string | null;
  nationality?:    string | null;
  emailOptOut?:    boolean;
  include:         boolean;
}

type EmailLang = 'tr' | 'en' | 'tl' | 'uk' | 'ru' | 'ka' | 'az' | 'id' | 'hi' | 'ro' | 'pl';

// ISO-2 → e-posta dili. retention.js'deki NATIONALITY_TO_LANGUAGE_CODE ile birebir eşleşir.
const NATIONALITY_LANG: Partial<Record<string, EmailLang>> = {
  TR: 'tr', PH: 'tl', UA: 'uk', RU: 'ru', GE: 'ka', AZ: 'az',
  ID: 'id', IN: 'hi', RO: 'ro', PL: 'pl',
  // GB, US, AU, CA, NZ ve diğerleri → 'en' (default)
};
function langFromNationality(nat: string | null | undefined): EmailLang | null {
  if (!nat) return null;
  return NATIONALITY_LANG[nat.trim().toUpperCase()] ?? 'en';
}

// Denizcilik sektöründe en yaygın uyruklar — retention.js'deki LANGUAGE_BY_CODE ile birebir eşleşir.
// nationality alanı backend'den gelince kişi başı otomatik dil seçimi için kullanılacak.
const EMAIL_LANGUAGES: { value: EmailLang; flag: string; label: string }[] = [
  { value: 'tr', flag: '🇹🇷', label: 'Türkçe' },
  { value: 'en', flag: '🇬🇧', label: 'English' },
  { value: 'tl', flag: '🇵🇭', label: 'Filipino' },
  { value: 'uk', flag: '🇺🇦', label: 'Українська' },
  { value: 'ru', flag: '🇷🇺', label: 'Русский' },
  { value: 'ka', flag: '🇬🇪', label: 'ქართული' },
  { value: 'az', flag: '🇦🇿', label: 'Azərbaycan' },
  { value: 'id', flag: '🇮🇩', label: 'Indonesia' },
  { value: 'hi', flag: '🇮🇳', label: 'हिन्दी' },
  { value: 'ro', flag: '🇷🇴', label: 'Română' },
  { value: 'pl', flag: '🇵🇱', label: 'Polski' },
];

function daysAgo(iso: string | null, lang: 'tr' | 'en'): string {
  if (!iso) return lang === 'tr' ? 'bilinmiyor' : 'unknown';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return lang === 'tr' ? 'bugün' : 'today';
  return lang === 'tr' ? `${d} gün önce` : `${d}d ago`;
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────
const WA_AUDIENCES = [
  { value: 'seafarer_global', labelTr: '🌍 Global Seafarers',                  labelEn: '🌍 Global Seafarers' },
  { value: 'seafarer_tr',     labelTr: '🇹🇷 Türk Gemi Adamları',               labelEn: '🇹🇷 Turkish Seafarers' },
  { value: 'shipowner',       labelTr: '🚢 Armatörler & Crew Manager',          labelEn: '🚢 Shipowners & Crew Manager' },
  { value: 'cadet',           labelTr: '🎓 Cadet & Genç Denizci',              labelEn: '🎓 Cadet & Young Seafarer' },
];

const WA_OBJECTIVES = [
  { value: 'registration',    labelTr: '📝 Yeni Seafarer Kaydı',               labelEn: '📝 New Seafarer Registration' },
  { value: 'job_apply',       labelTr: '💼 İlan Başvurusu',                    labelEn: '💼 Job Application' },
  { value: 'company_signup',  labelTr: '🏢 Firma / Armatör Kaydı (B2B)',       labelEn: '🏢 Company / Shipowner Signup (B2B)' },
];

const WA_PLATFORMS = [
  { value: 'facebook',   labelTr: '📘 Facebook',           labelEn: '📘 Facebook' },
  { value: 'instagram',  labelTr: '📸 Instagram',          labelEn: '📸 Instagram' },
  { value: 'both',       labelTr: '📘📸 Her İkisi',         labelEn: '📘📸 Both' },
];

// ── Telegram Kanal ────────────────────────────────────────────────────────────
const TG_CONTENT_TYPES = [
  { value: 'weekly_plan',      labelTr: '📅 Haftalık İçerik Takvimi',           labelEn: '📅 Weekly Content Calendar' },
  { value: 'daily_post',       labelTr: '📢 Günlük İlan Post Şablonları',       labelEn: '📢 Daily Job Post Templates' },
  { value: 'sponsored_post',   labelTr: '🤝 Sponsorlu Post Şablonları',         labelEn: '🤝 Sponsored Post Templates' },
  { value: 'channel_strategy', labelTr: '🚀 Kanal Büyütme Stratejisi',          labelEn: '🚀 Channel Growth Strategy' },
  { value: 'growth_plan',      labelTr: '📈 90 Günlük Büyüme Planı',           labelEn: '📈 90-Day Growth Plan' },
];

const TG_NICHES = [
  { value: 'all',       labelTr: '⚓ Tüm Seafarerlar',   labelEn: '⚓ All Seafarers' },
  { value: 'officers',  labelTr: '🎖️ Deck Officers',    labelEn: '🎖️ Deck Officers' },
  { value: 'engineers', labelTr: '⚙️ Engine Officers',  labelEn: '⚙️ Engine Officers' },
  { value: 'cadets',    labelTr: '🎓 Cadetler',          labelEn: '🎓 Cadets' },
  { value: 'offshore',  labelTr: '🛢️ Offshore',         labelEn: '🛢️ Offshore' },
];

const TG_CHANNEL_LANGS = [
  { value: 'multi', labelTr: '🌍 Çok Dilli (EN ana)',   labelEn: '🌍 Multilingual (EN main)' },
  { value: 'en',    labelTr: '🇬🇧 English only',        labelEn: '🇬🇧 English only' },
  { value: 'tr',    labelTr: '🇹🇷 Türkçe',              labelEn: '🇹🇷 Turkish' },
  { value: 'ph',    labelTr: '🇵🇭 Filipino / Tagalog', labelEn: '🇵🇭 Filipino / Tagalog' },
];

// ── Telegram Bot ──────────────────────────────────────────────────────────────
const BOT_TYPES = [
  { value: 'registration', labelTr: '📝 Kayıt Botu (Yeni Kullanıcı)',  labelEn: '📝 Registration Bot (New User)' },
  { value: 'job_search',   labelTr: '🔍 İş Arama Botu',                labelEn: '🔍 Job Search Bot' },
  { value: 'company',      labelTr: '🏢 Firma / B2B Lead Botu',        labelEn: '🏢 Company / B2B Lead Bot' },
  { value: 'full',         labelTr: '⚡ Tam Özellikli Bot (Hepsi)',     labelEn: '⚡ Full-Featured Bot (All)' },
];

const BOT_FEATURES = [
  { value: 'job_search',  labelTr: '🔍 İlan Arama',            labelEn: '🔍 Job Search' },
  { value: 'cv_tips',     labelTr: '📄 CV Tavsiyeleri',         labelEn: '📄 CV Tips' },
  { value: 'salary_info', labelTr: '💰 Maaş Rehberi',          labelEn: '💰 Salary Guide' },
  { value: 'alerts',      labelTr: '🔔 Uyarı/Bildirim Sistemi',labelEn: '🔔 Alert/Notification System' },
  { value: 'stcw',        labelTr: '📋 STCW Bilgisi',          labelEn: '📋 STCW Info' },
  { value: 'multilang',   labelTr: '🌍 Çok Dil Desteği',       labelEn: '🌍 Multi-Language Support' },
];

export default function MessagingTab({ stats }: Props) {
  const { lang } = useLang();
  const [subTab,   setSubTab]   = useState<SubTab>('whatsapp');
  const [language, setLanguage] = useState<'tr' | 'en'>('en');
  const [output,   setOutput]   = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // ── E-posta state ───────────────────────────────────────────────
  const [emailBucket,     setEmailBucket]     = useState<'zero' | 'low' | 'mid'>('zero');
  const [emailLanguage,   setEmailLanguage]   = useState<EmailLang>('tr');
  const [emailSubject,    setEmailSubject]    = useState('');
  const [emailHtml,       setEmailHtml]       = useState('');
  const [emailCtaPath,    setEmailCtaPath]    = useState('');
  const [emailGenLoading, setEmailGenLoading] = useState(false);
  const [emailGenError,   setEmailGenError]   = useState('');
  const [emailRecipients, setEmailRecipients] = useState(''); // manuel yapıştırma (fallback)
  const [recipientDetails,setRecipientDetails]= useState<EmailRecipient[]>([]); // segmentten yüklenen — doluluk + son güncelleme
  const [minStaleDays,    setMinStaleDays]    = useState(0); // sadece X günden uzun süredir güncellenmeyenleri hedefle
  const [emailSendResult, setEmailSendResult] = useState<{ sent?: number; failed?: number; success?: boolean; error?: string } | null>(null);
  const [emailSendLoading,setEmailSendLoading]= useState(false);
  const [emailSendProgress, setEmailSendProgress] = useState<{ done: number; total: number } | null>(null);
  const [segmentLoading,  setSegmentLoading]  = useState(false);
  const [segmentError,    setSegmentError]    = useState('');
  const [segmentProgress, setSegmentProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const [batchProgress,   setBatchProgress]   = useState<Record<string, { status: 'idle' | 'generating' | 'sending' | 'done' | { error: string }; sent?: number; failed?: number }> | null>(null);
  const [batchLoading,    setBatchLoading]    = useState(false);

  // ── İş Eşleşme state ───────────────────────────────────────────
  const [jobMatchBucket,      setJobMatchBucket]      = useState<'zero' | 'low' | 'mid' | 'high'>('zero');
  const [jobMatchLang,        setJobMatchLang]        = useState<EmailLang>('tr');
  const [jobListings,         setJobListings]         = useState<JobListing[]>([]);
  const [jobListLoading,      setJobListLoading]      = useState(false);
  const [jobListError,        setJobListError]        = useState('');
  const [jobMatchHtml,        setJobMatchHtml]        = useState('');
  const [jobMatchSubject,     setJobMatchSubject]     = useState('');
  const [jobMatchRenderLoading, setJobMatchRenderLoading] = useState(false);
  const [jobMatchRecipients,  setJobMatchRecipients]  = useState<EmailRecipient[]>([]);
  const [jobMatchSegLoading,  setJobMatchSegLoading]  = useState(false);
  const [jobMatchSegProgress, setJobMatchSegProgress] = useState<{ loaded: number; total: number | null } | null>(null);
  const [jobMatchSegError,    setJobMatchSegError]    = useState('');
  const [jobMatchSendResult,  setJobMatchSendResult]  = useState<{ sent?: number; failed?: number; success?: boolean; error?: string } | null>(null);
  const [jobMatchSendLoading, setJobMatchSendLoading] = useState(false);

  const bucketCount = stats?.seafarers?.fillRateBuckets?.[emailBucket] ?? 0;

  // Yüklenen alıcıların nationality → dil dağılımı. Nationality bilinmiyorsa 'en' grubuna düşer.
  const langDistribution = useMemo(() => {
    if (recipientDetails.length === 0) return [];
    const counts: Partial<Record<EmailLang, number>> = {};
    for (const r of recipientDetails) {
      const l: EmailLang = langFromNationality(r.nationality) ?? 'en';
      counts[l] = (counts[l] ?? 0) + 1;
    }
    return (Object.entries(counts) as [EmailLang, number][])
      .sort((a, b) => b[1] - a[1])
      .map(([l, count]) => ({
        lang: l,
        count,
        pct: Math.round((count / recipientDetails.length) * 100),
        info: EMAIL_LANGUAGES.find(x => x.value === l),
      }));
  }, [recipientDetails]);

  const toggleRecipient = (email: string) =>
    setRecipientDetails(prev => prev.map(r => r.email === email ? { ...r, include: !r.include } : r));

  const visibleRecipients = recipientDetails.filter(r => {
    if (!r.lastActiveAt) return minStaleDays === 0;
    const days = Math.floor((Date.now() - new Date(r.lastActiveAt).getTime()) / 86_400_000);
    return days >= minStaleDays;
  });

  // Gönderilecek nihai e-posta listesi: segmentten yüklendiyse işaretli+görünür satırlar (userId + backend'in
  // ürettiği unsubscribeUrl ile), aksi halde manuel textarea (userId/unsubscribeUrl yok, event/unsub atlanır)
  const effectiveRecipients: { email: string; userId?: number | null; unsubscribeUrl?: string | null }[] = recipientDetails.length > 0
    ? visibleRecipients.filter(r => r.include).map(r => ({ email: r.email, userId: r.userId, unsubscribeUrl: r.unsubscribeUrl }))
    : emailRecipients.split('\n').map(s => s.trim()).filter(Boolean).map(email => ({ email }));

  const generateEmail = async () => {
    setEmailGenLoading(true);
    setEmailGenError('');
    setEmailSendResult(null);
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'reactivation_email', bucket: emailBucket, language: emailLanguage, textModel: getTextModel() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEmailSubject(data.subject ?? '');
      setEmailHtml(data.html ?? '');
      setEmailCtaPath(data.ctaPath ?? '');
    } catch (e: unknown) {
      setEmailGenError(e instanceof Error ? e.message : lang === 'tr' ? 'Hata oluştu' : 'An error occurred');
    } finally {
      setEmailGenLoading(false);
    }
  };

  const loadSegmentRecipients = async () => {
    setSegmentLoading(true);
    setSegmentError('');
    setSegmentProgress(null);
    setRecipientDetails([]);
    setBatchProgress(null);

    const PAGE_SIZE = 200;
    const all: EmailRecipient[] = [];
    let page = 1;
    let totalCount: number | null = null;

    try {
      while (true) {
        const res = await fetch(
          `/api/activation/seafarers-by-bucket?bucket=${emailBucket}&page=${page}&size=${PAGE_SIZE}`,
        );
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);

        const items: EmailRecipient[] = (data.items ?? [])
          // Güvenlik: emailOptOut=true kayıtları frontend'de de filtrele
          .filter((r: EmailRecipient) => !r.emailOptOut)
          .map((r: EmailRecipient) => ({ ...r, include: true }));

        if (totalCount === null && data.totalCount != null) totalCount = data.totalCount;
        all.push(...items);
        setSegmentProgress({ loaded: all.length, total: totalCount });

        // Son sayfa: boş döndü veya sayfa boyutundan az kayıt
        if (items.length === 0 || items.length < PAGE_SIZE) break;
        page++;
      }

      setRecipientDetails(all);

      // Nationality mevcut ve tek bir dil hakimse e-posta dilini otomatik ayarla
      const langs = all.map(r => langFromNationality(r.nationality)).filter(Boolean) as EmailLang[];
      if (langs.length > 0) {
        const freq = langs.reduce<Partial<Record<EmailLang, number>>>((acc, l) => {
          acc[l] = (acc[l] ?? 0) + 1; return acc;
        }, {});
        const dominant = (Object.entries(freq) as [EmailLang, number][])
          .sort((a, b) => b[1] - a[1])[0][0];
        // Dominant dil %60+ ise otomatik seç
        if ((freq[dominant]! / langs.length) >= 0.6) setEmailLanguage(dominant);
      }
    } catch (e: unknown) {
      setSegmentError(e instanceof Error ? e.message : lang === 'tr' ? 'Hata oluştu' : 'An error occurred');
    } finally {
      setSegmentLoading(false);
    }
  };

  const loadJobListings = async () => {
    setJobListLoading(true);
    setJobListError('');
    try {
      const res  = await fetch('/api/activation/job-listings?limit=6');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setJobListings(data.jobs ?? []);
    } catch (e: unknown) {
      setJobListError(e instanceof Error ? e.message : lang === 'tr' ? 'Hata oluştu' : 'An error occurred');
    } finally {
      setJobListLoading(false);
    }
  };

  const buildJobMatchEmail = async () => {
    if (jobListings.length === 0) return;
    setJobMatchRenderLoading(true);
    try {
      const res  = await fetch('/api/messaging/email/render-job-match', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ jobs: jobListings, lang: jobMatchLang }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setJobMatchSubject(data.subject ?? '');
      setJobMatchHtml(data.html ?? '');
    } catch (e: unknown) {
      setJobListError(e instanceof Error ? e.message : lang === 'tr' ? 'Hata oluştu' : 'An error occurred');
    } finally {
      setJobMatchRenderLoading(false);
    }
  };

  const loadJobMatchRecipients = async () => {
    setJobMatchSegLoading(true);
    setJobMatchSegError('');
    setJobMatchSegProgress(null);
    setJobMatchRecipients([]);
    const PAGE_SIZE = 200;
    const all: EmailRecipient[] = [];
    let page = 1;
    let totalCount: number | null = null;
    try {
      while (true) {
        const res  = await fetch(`/api/activation/seafarers-by-bucket?bucket=${jobMatchBucket}&page=${page}&size=${PAGE_SIZE}`);
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
        const items: EmailRecipient[] = (data.items ?? [])
          .filter((r: EmailRecipient) => !r.emailOptOut)
          .map((r: EmailRecipient)   => ({ ...r, include: true }));
        if (totalCount === null && data.totalCount != null) totalCount = data.totalCount;
        all.push(...items);
        setJobMatchSegProgress({ loaded: all.length, total: totalCount });
        if (items.length === 0 || items.length < PAGE_SIZE) break;
        page++;
      }
      setJobMatchRecipients(all);
    } catch (e: unknown) {
      setJobMatchSegError(e instanceof Error ? e.message : lang === 'tr' ? 'Hata oluştu' : 'An error occurred');
    } finally {
      setJobMatchSegLoading(false);
    }
  };

  const sendJobMatchCampaign = async () => {
    setJobMatchSendLoading(true);
    setJobMatchSendResult(null);
    const CHUNK = 100; // Route başına max 100 alıcı gönder (timeout önlemi)
    const included = jobMatchRecipients.filter(r => r.include);
    const chunks: EmailRecipient[][] = [];
    for (let i = 0; i < included.length; i += CHUNK) chunks.push(included.slice(i, i + CHUNK));
    let totalSent = 0, totalFailed = 0;
    try {
      for (const chunk of chunks) {
        const recipients = chunk.map(r => ({
          email:          r.email,
          userId:         r.userId ?? null,
          nationality:    r.nationality ?? null,  // dil kişi başı nationality'den otomatik çözülür
          unsubscribeUrl: r.unsubscribeUrl ?? null,
        }));
        const res = await fetch('/api/messaging/email/send-job-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Her alıcı için: backend'den kişisel ilan + nationality'den dil belirlenir
          body: JSON.stringify({ recipients, lang: jobMatchLang, campaign: `job-match-${jobMatchBucket}` }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        totalSent   += data.sent   ?? 0;
        totalFailed += data.failed ?? 0;
      }
      const result = { sent: totalSent, failed: totalFailed };
      setJobMatchSendResult(result);
      logActivity('email_sent', `${lang === 'tr' ? 'İş eşleşme maili gönderildi' : 'Job match email sent'} (${jobMatchBucket})`, `${totalSent} sent`);
    } catch (e: unknown) {
      setJobMatchSendResult({ error: e instanceof Error ? e.message : lang === 'tr' ? 'Hata oluştu' : 'An error occurred' });
    } finally {
      setJobMatchSendLoading(false);
    }
  };

  // Route istek başına en fazla 500 alıcı kabul eder → istemcide 200'lük parçalar halinde, ilerlemeyle gönder
  const sendEmailCampaign = async () => {
    const CHUNK = 200;
    const recipients = effectiveRecipients;
    setEmailSendLoading(true);
    setEmailSendResult(null);
    setEmailSendProgress({ done: 0, total: recipients.length });
    let totalSent = 0, totalFailed = 0;
    try {
      for (let i = 0; i < recipients.length; i += CHUNK) {
        const chunk = recipients.slice(i, i + CHUNK);
        const res = await fetch('/api/messaging/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'broadcast', recipients: chunk, subject: emailSubject, html: emailHtml, campaign: `reactivation-${emailBucket}`, ctaPath: emailCtaPath || undefined }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          const sentSoFar = lang === 'tr'
            ? ` (${totalSent} gönderildi, ${recipients.length - i} alıcı gönderilmedi)`
            : ` (${totalSent} sent, ${recipients.length - i} recipients not sent)`;
          throw new Error(`${data.error || `HTTP ${res.status}`}${i > 0 ? sentSoFar : ''}`);
        }
        totalSent   += data.sent   ?? 0;
        totalFailed += data.failed ?? 0;
        setEmailSendProgress({ done: Math.min(i + CHUNK, recipients.length), total: recipients.length });
      }
      setEmailSendResult({ sent: totalSent, failed: totalFailed });
      logActivity('email_sent', `${lang === 'tr' ? 'E-posta kampanyası gönderildi' : 'Email campaign sent'} (${emailBucket})`, emailSubject);
    } catch (e: unknown) {
      setEmailSendResult({ sent: totalSent, failed: totalFailed, error: e instanceof Error ? e.message : lang === 'tr' ? 'Hata oluştu' : 'An error occurred' });
    } finally {
      setEmailSendLoading(false);
      setEmailSendProgress(null);
    }
  };

  // ── Dil bazlı toplu gönderim — her dil grubuna ayrı AI emaili üret + gönder ────
  const sendByLanguageBatch = async () => {
    // Alıcıları nationality → dile göre grupla
    const groups: Partial<Record<EmailLang, { email: string; userId?: number | null; unsubscribeUrl?: string | null }[]>> = {};
    for (const r of visibleRecipients.filter(r => r.include)) {
      const l: EmailLang = langFromNationality(r.nationality) ?? 'en';
      if (!groups[l]) groups[l] = [];
      groups[l]!.push({ email: r.email, userId: r.userId, unsubscribeUrl: r.unsubscribeUrl });
    }
    if (Object.keys(groups).length === 0) return;

    const initial: Record<string, { status: 'idle' }> = {};
    for (const l of Object.keys(groups)) initial[l] = { status: 'idle' };
    setBatchProgress(initial);
    setBatchLoading(true);
    setEmailSendResult(null);

    let totalSent = 0, totalFailed = 0;

    for (const [groupLang, groupRecipients] of Object.entries(groups)) {
      const l = groupLang as EmailLang;

      // 1. AI içerik üret
      setBatchProgress(prev => ({ ...prev!, [l]: { status: 'generating' } }));
      let subject = '', html = '', groupCtaPath = '';
      try {
        const genRes = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'reactivation_email', bucket: emailBucket, language: l, textModel: getTextModel() }),
        });
        const genData = await genRes.json();
        if (genData.error) throw new Error(genData.error);
        subject      = genData.subject  ?? '';
        html         = genData.html     ?? '';
        groupCtaPath = genData.ctaPath  ?? '';
      } catch (e) {
        setBatchProgress(prev => ({ ...prev!, [l]: { status: { error: e instanceof Error ? e.message : 'AI generation failed' } } }));
        continue;
      }

      // 2. Gruba gönder (100'lük parçalar halinde)
      setBatchProgress(prev => ({ ...prev!, [l]: { status: 'sending' } }));
      const CHUNK = 100;
      let groupSent = 0, groupFailed = 0;
      try {
        for (let i = 0; i < groupRecipients!.length; i += CHUNK) {
          const chunk = groupRecipients!.slice(i, i + CHUNK);
          const res   = await fetch('/api/messaging/email/send', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'broadcast', recipients: chunk, subject, html, campaign: `reactivation-${emailBucket}`, ctaPath: groupCtaPath || undefined }),
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          groupSent   += data.sent   ?? 0;
          groupFailed += data.failed ?? 0;
        }
        totalSent   += groupSent;
        totalFailed += groupFailed;
        setBatchProgress(prev => ({ ...prev!, [l]: { status: 'done', sent: groupSent, failed: groupFailed } }));
      } catch (e) {
        setBatchProgress(prev => ({ ...prev!, [l]: { status: { error: e instanceof Error ? e.message : 'Send failed' } } }));
      }
    }

    setBatchLoading(false);
    setEmailSendResult({ sent: totalSent, failed: totalFailed });
    logActivity('email_sent', `${lang === 'tr' ? 'Dil bazlı toplu e-posta gönderildi' : 'Language-based batch email sent'} (${emailBucket})`, `${totalSent} sent`);
  };

  // ── Send state ──────────────────────────────────────────────────
  const [msgText,      setMsgText]      = useState('');
  const [msgNumbers,   setMsgNumbers]   = useState('');
  const [msgChatIds,   setMsgChatIds]   = useState('');
  const [msgMode,      setMsgMode]      = useState<'single'|'broadcast'|'channel'>('channel');
  const [sendLoading,  setSendLoading]  = useState(false);
  const [sendResult,   setSendResult]   = useState<{ sent?: number; failed?: number; success?: boolean; error?: string } | null>(null);

  // ── WA/TG/Email config status ───────────────────────────────────────────────
  const [msgConfig, setMsgConfig] = useState<{ whatsapp: { configured: boolean }; telegram: { configured: boolean }; email: { configured: boolean } } | null>(null);
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
    { id: 'notify_email',     icon: '📧', label: lang === 'tr' ? 'E-posta Re-aktivasyon'  : 'Email Reactivation',  color: 'bg-amber-600',   group_tr: 'Mevcut Kullanıcı (Gönder)', group_en: 'Existing User (Send)' },
    { id: 'notify_job_match', icon: '💼', label: lang === 'tr' ? 'İş Eşleşme Maili'       : 'Job Match Email',      color: 'bg-teal-600',    group_tr: 'Mevcut Kullanıcı (Gönder)', group_en: 'Existing User (Send)' },
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
                  {(t.id === 'notify_email' || t.id === 'notify_job_match') && msgConfig && (
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      msgConfig.email.configured ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                    }`}>{msgConfig.email.configured ? '●' : '○'}</span>
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
                {WA_AUDIENCES.map(a => <option key={a.value} value={a.value}>{lang === 'tr' ? a.labelTr : a.labelEn}</option>)}
              </select>
            </Field>

            <Field label={lang === 'tr' ? 'Kampanya Amacı' : 'Campaign Objective'}>
              <select value={waObjective} onChange={e => setWaObjective(e.target.value)} className={selectClass}>
                {WA_OBJECTIVES.map(o => <option key={o.value} value={o.value}>{lang === 'tr' ? o.labelTr : o.labelEn}</option>)}
              </select>
            </Field>

            <Field label={lang === 'tr' ? 'Reklam Platformu' : 'Ad Platform'}>
              <div className="grid grid-cols-3 gap-1.5">
                {WA_PLATFORMS.map(p => (
                  <button key={p.value} onClick={() => setWaAdPlatform(p.value)}
                    className={`text-xs py-2 px-2 rounded-lg font-medium transition-colors ${
                      waAdPlatform === p.value ? 'bg-green-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}>
                    {lang === 'tr' ? p.labelTr : p.labelEn}
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
                {TG_CONTENT_TYPES.map(c => <option key={c.value} value={c.value}>{lang === 'tr' ? c.labelTr : c.labelEn}</option>)}
              </select>
            </Field>

            <Field label={lang === 'tr' ? 'Hedef Kitle (Niche)' : 'Target Audience (Niche)'}>
              <div className="grid grid-cols-2 gap-1.5">
                {TG_NICHES.map(n => (
                  <button key={n.value} onClick={() => setTgNiche(n.value)}
                    className={`text-xs py-2 px-2 rounded-lg font-medium transition-colors text-left ${
                      tgNiche === n.value ? 'bg-sky-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}>
                    {lang === 'tr' ? n.labelTr : n.labelEn}
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
                    {lang === 'tr' ? l.labelTr : l.labelEn}
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
                {BOT_TYPES.map(b => <option key={b.value} value={b.value}>{lang === 'tr' ? b.labelTr : b.labelEn}</option>)}
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
                    {lang === 'tr' ? f.labelTr : f.labelEn}
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
                <p className="leading-relaxed mt-1 font-medium">
                  {lang === 'tr'
                    ? '⚠️ Serbest metin yalnızca son 24 saat içinde size yazmış kullanıcılara ulaşır. Pazarlama/duyuru mesajları için Meta onaylı WhatsApp template gerekir.'
                    : '⚠️ Free-text messages only reach users who messaged you in the last 24 hours. Marketing/announcement messages require Meta-approved WhatsApp templates.'}
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

            <Field label={lang === 'tr' ? 'Mesaj (düz metin)' : 'Message (plain text)'}>
              <textarea value={msgText} onChange={e => setMsgText(e.target.value)}
                placeholder={"Yeni ilanlar! crewinjob.com'da arama yapın 👇\nhttps://crewinjob.com"}
                rows={5} className={`${selectClass} resize-none font-mono text-xs`} />
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {lang === 'tr'
                  ? 'Metin olduğu gibi gönderilir; <, > ve & karakterleri güvenle kaçışlanır. Linkler Telegram\'da otomatik tıklanabilir olur.'
                  : 'Text is sent as-is; <, > and & are safely escaped. Links become clickable automatically in Telegram.'}
              </p>
            </Field>
          </>
        )}

        {/* ── E-posta Re-aktivasyon ── */}
        {subTab === 'notify_email' && (
          <>
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300 flex gap-2">
              <span className="text-base shrink-0">📧</span>
              <div>
                <p className="font-semibold mb-1">{lang === 'tr' ? 'E-posta Re-aktivasyon Kampanyası' : 'Email Reactivation Campaign'}</p>
                <p className="leading-relaxed">
                  {lang === 'tr'
                    ? <>Profili yarım bırakan kullanıcılara AI ile içerik üretip SMTP üzerinden gönderir. Önce <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code>, <code>SMTP_FROM_EMAIL</code> ayarlayın.</>
                    : <>Generates AI content for users who left their profile incomplete and sends via SMTP. First set <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code>, <code>SMTP_FROM_EMAIL</code>.</>}
                </p>
              </div>
            </div>

            {msgConfig && !msgConfig.email.configured && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3 text-xs text-red-700 dark:text-red-300">
                ⚠️ <strong>.env.local</strong> {lang === 'tr' ? 'içinde' : ':'} <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code>, <code>SMTP_FROM_EMAIL</code> {lang === 'tr' ? 'tanımlanmamış.' : 'not configured.'}
              </div>
            )}

            <Field label={lang === 'tr' ? 'Hedef Segment' : 'Target Segment'}>
              <div className="flex flex-col gap-1.5">
                {EMAIL_BUCKETS.map(b => (
                  <button key={b.value}
                    onClick={() => { setEmailBucket(b.value); setEmailSubject(''); setEmailHtml(''); setEmailCtaPath(''); setEmailRecipients(''); setRecipientDetails([]); setMinStaleDays(0); setEmailSendResult(null); setSegmentError(''); }}
                    className={`flex items-center justify-between text-xs py-2.5 px-3 rounded-lg font-medium transition-colors text-left ${
                      emailBucket === b.value ? `${b.color} text-white` : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}>
                    <span>{lang === 'tr' ? b.labelTr : b.labelEn}</span>
                    {stats?.seafarers?.fillRateBuckets && (
                      <span className="font-bold">{(stats.seafarers.fillRateBuckets[b.value] ?? 0).toLocaleString('tr-TR')}</span>
                    )}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={lang === 'tr' ? 'İçerik Dili' : 'Content Language'}>
              <div className="grid grid-cols-3 gap-1.5">
                {EMAIL_LANGUAGES.map(l => (
                  <button key={l.value} onClick={() => setEmailLanguage(l.value)}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-medium transition-colors border-2 ${
                      emailLanguage === l.value
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-amber-400'
                    }`}>
                    <span>{l.flag}</span>
                    <span className="truncate">{l.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {lang === 'tr'
                  ? 'Segment yüklenince uyruğa göre baskın dil otomatik seçilir. Manuel değiştirebilirsiniz.'
                  : 'After loading the segment, the dominant language is auto-selected from nationality. You can override it.'}
              </p>
            </Field>

            <button onClick={generateEmail} disabled={emailGenLoading}
              className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
              {emailGenLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {emailGenLoading ? (lang === 'tr' ? 'Üretiliyor...' : 'Generating...') : (lang === 'tr' ? '✨ E-posta İçeriği Üret' : '✨ Generate Email Content')}
            </button>
            {emailGenError && (
              <p className="text-xs text-red-600 dark:text-red-400">{emailGenError}</p>
            )}

            <Field label={lang === 'tr' ? 'Konu' : 'Subject'}>
              <input type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)}
                placeholder={lang === 'tr' ? 'AI ile üret veya elle yaz' : 'Generate with AI or write manually'}
                className={selectClass} />
            </Field>

            <Field label={lang === 'tr' ? `Alıcılar — ${bucketCount.toLocaleString('tr-TR')} kişilik segment` : `Recipients — ${bucketCount.toLocaleString('tr-TR')}-person segment`}>
              <div className="flex items-center gap-2 mb-1.5">
                <button onClick={loadSegmentRecipients} disabled={segmentLoading}
                  className="text-[11px] px-2.5 py-1.5 rounded-lg font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 flex items-center gap-1.5">
                  {segmentLoading && <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />}
                  {segmentLoading
                    ? (segmentProgress
                        ? `${segmentProgress.loaded.toLocaleString('tr-TR')}${segmentProgress.total ? ' / ' + segmentProgress.total.toLocaleString('tr-TR') : ''} ${lang === 'tr' ? 'yüklendi' : 'loaded'}`
                        : (lang === 'tr' ? 'Yükleniyor...' : 'Loading...'))
                    : (lang === 'tr' ? '📥 Segmentten Yükle' : '📥 Load from Segment')}
                </button>
                {recipientDetails.length > 0 && !segmentLoading && (
                  <button onClick={() => { setRecipientDetails([]); setMinStaleDays(0); setSegmentProgress(null); setBatchProgress(null); }}
                    className="text-[11px] px-2 py-1.5 rounded-lg font-medium text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300">
                    {lang === 'tr' ? 'Temizle' : 'Clear'}
                  </button>
                )}
              </div>
              {segmentError && (
                <p className="text-[10px] text-red-600 dark:text-red-400 mb-1.5 leading-relaxed">
                  ⚠️ {segmentError}
                </p>
              )}

              {recipientDetails.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {lang === 'tr' ? 'En az' : 'At least'}
                    </label>
                    <input type="number" min={0} value={minStaleDays}
                      onChange={e => setMinStaleDays(Math.max(0, Number(e.target.value) || 0))}
                      className="w-16 border border-slate-200 dark:border-slate-600 rounded px-1.5 py-1 text-xs bg-white dark:bg-slate-700 dark:text-slate-100" />
                    <label className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {lang === 'tr' ? 'gündür güncellenmemiş' : 'days since last update'}
                    </label>
                  </div>

                  <div className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden">
                    <div className="max-h-56 overflow-y-auto">
                      {visibleRecipients.map(r => (
                        <label key={r.email} className="flex items-center gap-2 px-2.5 py-1.5 text-xs border-b border-slate-100 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer">
                          <input type="checkbox" checked={r.include} onChange={() => toggleRecipient(r.email)}
                            className="w-3.5 h-3.5 accent-amber-600 shrink-0" />
                          <span className="flex-1 truncate text-slate-700 dark:text-slate-200">{r.fullName || r.email}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 shrink-0">%{Math.round(r.fillRate)}</span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 w-16 text-right">{daysAgo(r.lastActiveAt, lang)}</span>
                        </label>
                      ))}
                      {visibleRecipients.length === 0 && (
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-3 text-center">
                          {lang === 'tr' ? 'Bu filtreye uyan kimse yok.' : 'Nobody matches this filter.'}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">
                    {visibleRecipients.filter(r => r.include).length} / {visibleRecipients.length} {lang === 'tr' ? 'işaretli — gönderim bu listeye gidecek' : 'checked — sending goes to this list'}
                  </p>
                </div>
              ) : (
                <>
                  <textarea value={emailRecipients} onChange={e => setEmailRecipients(e.target.value)}
                    placeholder="ali@example.com&#10;veli@example.com&#10;..."
                    rows={5} className={`${selectClass} resize-none font-mono text-xs`} />
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">
                    {emailRecipients.split('\n').map(s => s.trim()).filter(Boolean).length} {lang === 'tr' ? 'alıcı — her satıra bir e-posta' : 'recipients — one email per line'}
                  </p>
                </>
              )}
            </Field>

            {/* Dil dağılımı — nationality verisine göre */}
            {recipientDetails.length > 0 && langDistribution.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  🌍 {lang === 'tr' ? 'Dil Dağılımı (nationality)' : 'Language Distribution (nationality)'}
                </p>
                <div className="flex flex-col gap-1">
                  {langDistribution.map(({ lang: l, count, pct, info }) => (
                    <div key={l} className="flex items-center gap-2 text-[11px]">
                      <span className="w-5 text-center shrink-0">{info?.flag ?? '🌐'}</span>
                      <div className="flex-1 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-2 bg-amber-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-slate-500 dark:text-slate-400 w-8 text-right">{pct}%</span>
                      <span className="text-slate-400 dark:text-slate-500 w-8 text-right">{count}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  {lang === 'tr'
                    ? 'Nationality bilinmiyorsa İngilizce (en) grubuna düşer. "Dil Bazlı Gönder" her gruba ayrı mail üretir.'
                    : 'Unknown nationality falls into English (en). "Send by Language" generates a separate email per group.'}
                </p>
              </div>
            )}
          </>
        )}

        {/* ── İş Eşleşme Maili ── */}
        {subTab === 'notify_job_match' && (
          <>
            <div className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg p-3 text-xs text-teal-800 dark:text-teal-300 flex gap-2">
              <span className="text-base shrink-0">💼</span>
              <div>
                <p className="font-semibold mb-1">{lang === 'tr' ? 'Size Uygun İlanlar Maili' : 'Matching Job Listings Email'}</p>
                <p className="leading-relaxed">
                  {lang === 'tr'
                    ? 'Güncel iş ilanlarını seçili segmente mail olarak gönderir. Kişisel eşleşme için backend\'de userId desteği gerekir.'
                    : 'Sends current job listings to the selected segment. Personalized matching requires userId support in the backend.'}
                </p>
              </div>
            </div>

            {msgConfig && !msgConfig.email.configured && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-3 text-xs text-red-700 dark:text-red-300">
                ⚠️ SMTP yapılandırması eksik.
              </div>
            )}

            {/* 1 — İlanları yükle */}
            <Field label={lang === 'tr' ? '1. İş İlanlarını Yükle' : '1. Load Job Listings'}>
              <button onClick={loadJobListings} disabled={jobListLoading}
                className="w-full text-sm px-3 py-2.5 rounded-lg font-medium bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white flex items-center justify-center gap-2">
                {jobListLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {jobListLoading ? (lang === 'tr' ? 'Yükleniyor...' : 'Loading...') : (lang === 'tr' ? '🔄 İlanları Çek' : '🔄 Fetch Listings')}
              </button>
              {jobListError && <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">{jobListError}</p>}
              {jobListings.length > 0 && (
                <div className="border border-slate-200 dark:border-slate-600 rounded-lg overflow-hidden mt-1.5">
                  {jobListings.map((j, i) => (
                    <div key={i} className="flex items-start gap-2 px-3 py-2.5 border-b border-slate-100 dark:border-slate-700 last:border-b-0 text-xs">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 flex items-center justify-center font-bold text-[10px]">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">{j.title || '—'}</p>
                        <p className="text-slate-500 dark:text-slate-400 truncate">{[j.company, j.vesselType, j.location].filter(Boolean).join(' • ')}</p>
                        {j.salary && <p className="text-teal-600 dark:text-teal-400 font-medium">{j.salary}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Field>

            {/* 2 — Dil + önizleme oluştur */}
            {jobListings.length > 0 && (
              <>
                <Field label={lang === 'tr' ? '2. E-posta Dili' : '2. Email Language'}>
                  <div className="grid grid-cols-3 gap-1.5">
                    {EMAIL_LANGUAGES.map(l => (
                      <button key={l.value} onClick={() => setJobMatchLang(l.value)}
                        className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-medium transition-colors border-2 ${
                          jobMatchLang === l.value
                            ? 'bg-teal-600 text-white border-teal-600'
                            : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-teal-400'
                        }`}>
                        <span>{l.flag}</span>
                        <span className="truncate">{l.label}</span>
                      </button>
                    ))}
                  </div>
                </Field>

                <button onClick={buildJobMatchEmail} disabled={jobMatchRenderLoading}
                  className="w-full bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
                  {jobMatchRenderLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                  {jobMatchRenderLoading ? (lang === 'tr' ? 'Oluşturuluyor...' : 'Rendering...') : (lang === 'tr' ? '✉️ E-posta Önizlemesi Oluştur' : '✉️ Build Email Preview')}
                </button>
              </>
            )}

            {/* 3 — Alıcıları yükle */}
            {jobMatchHtml && (
              <Field label={lang === 'tr' ? '3. Hedef Segment' : '3. Target Segment'}>
                <div className="flex flex-col gap-1.5 mb-1.5">
                  {JOB_MATCH_BUCKETS.map(b => (
                    <button key={b.value} onClick={() => { setJobMatchBucket(b.value); setJobMatchRecipients([]); setJobMatchSegProgress(null); }}
                      className={`flex items-center justify-between text-xs py-2.5 px-3 rounded-lg font-medium transition-colors text-left ${
                        jobMatchBucket === b.value ? `${b.color} text-white` : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}>
                      <span>{lang === 'tr' ? b.labelTr : b.labelEn}</span>
                      {stats?.seafarers?.fillRateBuckets && (
                        <span className="font-bold">{(stats.seafarers.fillRateBuckets[b.value] ?? 0).toLocaleString('tr-TR')}</span>
                      )}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={loadJobMatchRecipients} disabled={jobMatchSegLoading}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 flex items-center gap-1.5">
                    {jobMatchSegLoading && <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />}
                    {jobMatchSegLoading
                      ? (jobMatchSegProgress
                          ? `${jobMatchSegProgress.loaded.toLocaleString('tr-TR')}${jobMatchSegProgress.total ? ' / ' + jobMatchSegProgress.total.toLocaleString('tr-TR') : ''} ${lang === 'tr' ? 'yüklendi' : 'loaded'}`
                          : (lang === 'tr' ? 'Yükleniyor...' : 'Loading...'))
                      : (lang === 'tr' ? '📥 Segmentten Yükle' : '📥 Load from Segment')}
                  </button>
                  {jobMatchRecipients.length > 0 && !jobMatchSegLoading && (
                    <button onClick={() => { setJobMatchRecipients([]); setJobMatchSegProgress(null); }}
                      className="text-[11px] px-2 py-1.5 rounded-lg font-medium text-slate-400 hover:text-slate-600">
                      {lang === 'tr' ? 'Temizle' : 'Clear'}
                    </button>
                  )}
                </div>
                {jobMatchSegError && <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">⚠️ {jobMatchSegError}</p>}
                {jobMatchRecipients.length > 0 && (
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                    {jobMatchRecipients.filter(r => r.include).length.toLocaleString('tr-TR')} {lang === 'tr' ? 'alıcı hazır' : 'recipients ready'}
                  </p>
                )}
              </Field>
            )}
          </>
        )}

        {/* Output language — only for content generation tabs (email has its own extended selector) */}
        {!['notify_wa', 'notify_tg', 'notify_email', 'notify_job_match'].includes(subTab) && (
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
        {!['notify_wa', 'notify_tg', 'notify_email', 'notify_job_match'].includes(subTab) && (
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

        {/* Send email button(s) */}
        {subTab === 'notify_email' && (
          <div className="flex flex-col gap-2 mt-auto">
            {/* Dil bazlı gönder — segment yüklendi ve 2+ dil varsa göster */}
            {recipientDetails.length > 0 && langDistribution.length > 1 && (
              <button
                onClick={sendByLanguageBatch}
                disabled={batchLoading || emailSendLoading || effectiveRecipients.length === 0}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                {batchLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                🌍 {lang === 'tr' ? 'Dil Bazlı Toplu Gönder' : 'Send by Language Groups'}
              </button>
            )}
            <button
              onClick={sendEmailCampaign}
              disabled={emailSendLoading || batchLoading || !emailSubject.trim() || !emailHtml.trim() || effectiveRecipients.length === 0}
              className="w-full bg-amber-700 hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
            >
              {emailSendLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {lang === 'tr' ? '📧 Kampanyayı Gönder (tek dil)' : '📧 Send Campaign (single language)'}
            </button>
          </div>
        )}

        {/* Send job match email button */}
        {subTab === 'notify_job_match' && (
          <div className="mt-auto space-y-2">
            {/* Kişiselleştirilmiş gönderim notu */}
            {jobMatchRecipients.filter(r => r.include).length > 0 && !jobMatchSendLoading && (
              <p className="text-xs text-teal-700 dark:text-teal-400 text-center">
                🎯 {lang === 'tr'
                  ? 'Her seafarer kendi profiline uygun ilanlarla kişisel mail alır'
                  : 'Each seafarer receives personalized job matches based on their profile'}
              </p>
            )}
            <button
              onClick={sendJobMatchCampaign}
              disabled={jobMatchSendLoading || !jobMatchHtml.trim() || jobMatchRecipients.filter(r => r.include).length === 0}
              className="w-full bg-teal-700 hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
              {jobMatchSendLoading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {jobMatchSendLoading
                ? (lang === 'tr' ? 'Kişiselleştirip gönderiliyor…' : 'Personalizing & sending…')
                : (lang === 'tr' ? '💼 İş Eşleşme Mailini Gönder' : '💼 Send Job Match Email')}
            </button>
          </div>
        )}
      </div>

      {/* Right panel — output or send result */}
      <div className="lg:col-span-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6">
        {/* Content generation panel */}
        {!['notify_wa', 'notify_tg', 'notify_email', 'notify_job_match'].includes(subTab) && (
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

        {/* Email preview + send result panel */}
        {subTab === 'notify_email' && (
          <div className="flex flex-col gap-4">
            <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
              <span>📧</span> {lang === 'tr' ? 'E-posta Önizleme' : 'Email Preview'}
            </h3>

            {emailGenLoading && (
              <div className="flex items-center gap-3 py-10 text-slate-400 dark:text-slate-500 text-sm justify-center">
                <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                {lang === 'tr' ? 'AI içerik üretiyor...' : 'AI is generating content...'}
              </div>
            )}

            {!emailGenLoading && emailHtml && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="bg-slate-50 dark:bg-slate-700/50 px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{lang === 'tr' ? 'Konu: ' : 'Subject: '}</span>
                  {emailSubject}
                </div>
                <div className="p-4 bg-white dark:bg-slate-900 max-h-[420px] overflow-auto text-sm text-slate-800 dark:text-slate-100"
                  dangerouslySetInnerHTML={{ __html: emailHtml
                    .replace(/cid:crewinjob-logo/g, '/email-logo.png')
                    .replace(/\{\{CTA_URL\}\}/g, 'https://www.crewinjob.com/account/login')
                    .replace(/\{\{UNSUBSCRIBE_URL\}\}/g, '#')
                  }} />
              </div>
            )}

            {!emailGenLoading && !emailHtml && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-300 dark:text-slate-600">
                <span className="text-5xl">📧</span>
                <p className="text-xs text-center">
                  {lang === 'tr' ? 'Sol taraftan segment seçip "E-posta İçeriği Üret" butonuna tıklayın' : 'Select a segment on the left and click "Generate Email Content"'}
                </p>
              </div>
            )}

            {/* Dil bazlı toplu gönderim durumu */}
            {batchProgress && (
              <div className="rounded-xl p-4 border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 flex flex-col gap-2">
                <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                  🌍 {lang === 'tr' ? 'Dil Bazlı Gönderim' : 'Language Group Send'}
                  {batchLoading
                    ? <span className="font-normal text-indigo-500">&nbsp;— {lang === 'tr' ? 'devam ediyor...' : 'in progress...'}</span>
                    : <span className="font-normal text-indigo-500">&nbsp;— {lang === 'tr' ? 'tamamlandı' : 'complete'}</span>}
                </p>
                <div className="flex flex-col gap-1.5">
                  {Object.entries(batchProgress).map(([l, state]) => {
                    const info = EMAIL_LANGUAGES.find(x => x.value === l);
                    const s = state.status;
                    return (
                      <div key={l} className="flex items-center gap-2 text-xs">
                        <span className="w-5 text-center shrink-0">{info?.flag ?? '🌐'}</span>
                        <span className="flex-1 text-slate-700 dark:text-slate-200 font-medium">{info?.label ?? l}</span>
                        {s === 'idle' && <span className="text-slate-400">—</span>}
                        {s === 'generating' && (
                          <span className="text-amber-600 flex items-center gap-1">
                            <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                            {lang === 'tr' ? 'üretiyor' : 'generating'}
                          </span>
                        )}
                        {s === 'sending' && (
                          <span className="text-blue-600 flex items-center gap-1">
                            <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            {lang === 'tr' ? 'gönderiyor' : 'sending'}
                          </span>
                        )}
                        {s === 'done' && (
                          <span className="text-green-600 font-medium">
                            ✓ {state.sent} {lang === 'tr' ? 'gönderildi' : 'sent'}
                            {(state.failed ?? 0) > 0 && <span className="text-amber-600"> · {state.failed} {lang === 'tr' ? 'hata' : 'failed'}</span>}
                          </span>
                        )}
                        {typeof s === 'object' && 'error' in s && (
                          <span className="text-red-600 truncate max-w-[140px]" title={s.error}>❌ {s.error}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {emailSendLoading && (
              <div className="flex items-center gap-3 py-4 text-slate-400 dark:text-slate-500 text-sm">
                <div className="w-5 h-5 border-2 border-amber-700 border-t-transparent rounded-full animate-spin" />
                {lang === 'tr' ? 'Gönderiliyor...' : 'Sending...'}
                {emailSendProgress && emailSendProgress.total > 0 && (
                  <span className="text-xs">{emailSendProgress.done}/{emailSendProgress.total}</span>
                )}
              </div>
            )}

            {emailSendResult && !emailSendLoading && (
              <div className={`rounded-xl p-5 border ${
                emailSendResult.error
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
                  : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700'
              }`}>
                {emailSendResult.error ? (
                  <div className="flex gap-2 items-start text-red-700 dark:text-red-300">
                    <span className="text-lg">❌</span>
                    <div>
                      <p className="font-semibold text-sm">{lang === 'tr' ? 'Gönderim başarısız' : 'Send failed'}</p>
                      <p className="text-xs mt-1 opacity-80">{emailSendResult.error}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 items-start text-green-700 dark:text-green-300">
                    <span className="text-lg">✅</span>
                    <div>
                      <p className="font-semibold text-sm">{lang === 'tr' ? 'Gönderim tamamlandı' : 'Send complete'}</p>
                      {emailSendResult.sent !== undefined && (
                        <div className="mt-2 flex gap-4 text-xs">
                          <span>✓ {lang === 'tr' ? 'Gönderilen' : 'Sent'}: <strong>{emailSendResult.sent}</strong></span>
                          {(emailSendResult.failed ?? 0) > 0 && (
                            <span className="text-amber-600 dark:text-amber-400">✗ {lang === 'tr' ? 'Başarısız' : 'Failed'}: <strong>{emailSendResult.failed}</strong></span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Job match preview + send result panel */}
        {subTab === 'notify_job_match' && (
          <div className="flex flex-col gap-4">
            <h3 className="font-medium text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
              <span>💼</span> {lang === 'tr' ? 'İş Eşleşme E-postası Önizleme' : 'Job Match Email Preview'}
            </h3>

            {(jobMatchRenderLoading) && (
              <div className="flex items-center gap-3 py-10 text-slate-400 dark:text-slate-500 text-sm justify-center">
                <div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                {lang === 'tr' ? 'E-posta oluşturuluyor...' : 'Building email...'}
              </div>
            )}

            {!jobMatchRenderLoading && jobMatchHtml && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="bg-slate-50 dark:bg-slate-700/50 px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{lang === 'tr' ? 'Konu: ' : 'Subject: '}</span>
                  {jobMatchSubject}
                </div>
                <div className="p-4 bg-white dark:bg-slate-900 max-h-[420px] overflow-auto text-sm text-slate-800 dark:text-slate-100"
                  dangerouslySetInnerHTML={{ __html: jobMatchHtml
                    .replace(/cid:crewinjob-logo/g, '/email-logo.png')
                    .replace(/\{\{UNSUBSCRIBE_URL\}\}/g, '#')
                  }} />
              </div>
            )}

            {!jobMatchRenderLoading && !jobMatchHtml && (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-300 dark:text-slate-600">
                <span className="text-5xl">💼</span>
                <p className="text-xs text-center max-w-xs">
                  {lang === 'tr'
                    ? '1. İlanları çek → 2. Dili seç → 3. E-posta önizlemesi oluştur'
                    : '1. Fetch listings → 2. Select language → 3. Build email preview'}
                </p>
              </div>
            )}

            {jobMatchSendLoading && (
              <div className="flex items-center gap-3 py-4 text-slate-400 dark:text-slate-500 text-sm">
                <div className="w-5 h-5 border-2 border-teal-700 border-t-transparent rounded-full animate-spin" />
                {lang === 'tr' ? 'Gönderiliyor...' : 'Sending...'}
              </div>
            )}

            {jobMatchSendResult && !jobMatchSendLoading && (
              <div className={`rounded-xl p-5 border ${
                jobMatchSendResult.error
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700'
                  : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700'
              }`}>
                {jobMatchSendResult.error ? (
                  <div className="flex gap-2 items-start text-red-700 dark:text-red-300">
                    <span className="text-lg">❌</span>
                    <div>
                      <p className="font-semibold text-sm">{lang === 'tr' ? 'Gönderim başarısız' : 'Send failed'}</p>
                      <p className="text-xs mt-1 opacity-80">{jobMatchSendResult.error}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 items-start text-green-700 dark:text-green-300">
                    <span className="text-lg">✅</span>
                    <div>
                      <p className="font-semibold text-sm">{lang === 'tr' ? 'Gönderim tamamlandı' : 'Send complete'}</p>
                      {jobMatchSendResult.sent !== undefined && (
                        <div className="mt-2 flex gap-4 text-xs">
                          <span>✓ {lang === 'tr' ? 'Gönderilen' : 'Sent'}: <strong>{jobMatchSendResult.sent}</strong></span>
                          {(jobMatchSendResult.failed ?? 0) > 0 && (
                            <span className="text-amber-600 dark:text-amber-400">✗ {lang === 'tr' ? 'Başarısız' : 'Failed'}: <strong>{jobMatchSendResult.failed}</strong></span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
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
                      <li>Mesaj düz metin olarak gönderilir (&lt; &gt; &amp; kaçışlanır); linkler otomatik tıklanabilir olur</li>
                    </>
                  ) : (
                    <>
                      <li>Create bot with @BotFather → get <code>TELEGRAM_BOT_TOKEN</code></li>
                      <li>Add bot as admin to your channel</li>
                      <li><code>TELEGRAM_CHANNEL_ID</code> = @crewinjob_jobs or -100... numeric ID</li>
                      <li>Mode: <strong>Channel</strong> = auto from env; <strong>Single</strong> = enter chat_id; <strong>Broadcast</strong> = line-by-line chat_id list</li>
                      <li>Messages are sent as plain text (&lt; &gt; &amp; are escaped); links become clickable automatically</li>
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
