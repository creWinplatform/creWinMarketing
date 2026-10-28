'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import CampaignManagerTab from '@/components/tabs/CampaignManagerTab';
import LifecycleDraftPanel from '@/components/tabs/LifecycleDraftPanel';
import ProspectFinderPanel from '@/components/prospects/ProspectFinderPanel';
import { useLang } from '@/lib/lang';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';
import { onTabKeys } from '@/components/platform/tab-keys';
import type {
  CampaignAudience,
  CampaignAudienceType,
  CampaignObjective,
  CampaignStatus,
  FillBucket,
  ProspectSource,
  UnifiedCampaign,
} from '@/lib/campaigns';
import type { SavedAudience } from '@/lib/saved-audiences';
import type { AdPlatform } from '@/lib/ads-types';
import { urlView } from '@/lib/url-view';

type View = 'flows' | 'paid' | 'lifecycle' | 'prospects';

interface AudiencePreviewDistribution {
  profileCompletion: Array<{ name: string; count: number }>;
  countries: Array<{ name: string; count: number }>;
  nationalities: Array<{ name: string; count: number }>;
  positions: Array<{ name: string; count: number }>;
  activity: { active: number; inactive: number; unknown: number };
  channelReachability: { email: number; whatsapp: number; telegram: number; push: number };
  source: 'aggregate';
}

interface CampaignConversionMetrics {
  totalQueued?: number;
  totalSent?: number;
  delivered?: number;
  uniqueDelivered?: number;
  opens?: number;
  uniqueOpened?: number;
  clicks?: number;
  uniqueClicked?: number;
  bounced?: number;
  complained?: number;
  failed?: number;
  unsubscribed?: number;
  registrations?: number;
  activatedSeafarers?: number;
  completedProfiles?: number;
  activationRate?: number;
  openRate?: number;
  clickRate?: number;
  deliveryRate?: number;
  clickToOpenRate?: number;
  registrationRate?: number;
}

interface CampaignConversionResult extends CampaignConversionMetrics {
  summary?: CampaignConversionMetrics;
  dataNote?: string;
}

interface CampaignConversionResponse {
  available: boolean;
  reason?: 'backend_not_ready' | 'backend_error' | 'permission_denied' | 'authentication_required' | 'rate_limited';
  error?: string;
  result?: CampaignConversionResult;
}

interface BackendTemplate {
  id: string;
  name: string;
  channel: string;
  subject?: string | null;
  language?: string | null;
  content?: string;
}

interface BackendIntegration {
  id: string;
  name: string;
  channel: string;
  provider?: string;
  isConfigured?: boolean;
  senderAddressMasked?: string | null;
}

const SOCIAL = ['twitter', 'linkedin', 'facebook', 'instagram', 'tiktok'];
const PAID: AdPlatform[] = ['meta', 'linkedin', 'google'];
const BUCKETS: Array<{ id: FillBucket; tr: string; en: string }> = [
  { id: 'zero', tr: '%0 boş profil', en: '0% empty profile' },
  { id: 'low', tr: '%1–49 eksik profil', en: '1–49% incomplete profile' },
  { id: 'mid', tr: '%50–79 aktivasyona yakın', en: '50–79% near activation' },
  { id: 'high', tr: '%80+ Activated Seafarer', en: '80%+ Activated Seafarer' },
];

// lib/campaign-dispatch.ts → bucketsAreContiguous ile aynı kural (sunucu modülü client'a import edilemez).
// Backend dispatch tek bir profileMin-profileMax aralığı gönderir; bitişik olmayan seçim reddedilir.
function bucketsAreContiguous(selected: FillBucket[]): boolean {
  const indexes = Array.from(new Set(selected)).map(bucket => BUCKETS.findIndex(item => item.id === bucket)).filter(index => index >= 0).sort((a, b) => a - b);
  return indexes.every((value, i) => i === 0 || value === indexes[i - 1] + 1);
}

// lib/campaign-dispatch.ts → PILOT_INTEGRATION_ID: pilot dispatch'leri backend'de bu kimlikle kaydedilir.
const PILOT_INTEGRATION_ID = 'pilot-test-email';

function isRemoteOnly(campaign: UnifiedCampaign): boolean {
  return Boolean(campaign.remoteOnly) || campaign.id.startsWith('cmp_remote_');
}

type ObjectiveOption = {
  id: CampaignObjective;
  icon: string;
  group: 'seafarer' | 'business' | 'brand';
  tr: string;
  en: string;
  descTr: string;
  descEn: string;
  kpiTr: string;
  kpiEn: string;
};

type ProspectRecord = {
  companyName: string;
  email: string;
  country?: string;
  companyType?: string;
  website?: string;
};

function normalizeCsvHeader(value: string): string {
  return value.trim().toLocaleLowerCase('tr-TR').replace(/[\s_-]+/g, '');
}

function parseProspectCsv(value: string): { rows: ProspectRecord[]; invalid: number } {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], invalid: 0 };
  const separator = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const cells = (line: string) => line.split(separator).map(cell => cell.trim().replace(/^"|"$/g, ''));
  const headers = cells(lines[0]).map(normalizeCsvHeader);
  const hasHeader = headers.some(header => ['email', 'emailaddress', 'eposta', 'companyname', 'firmadi'].includes(header));
  const data = hasHeader ? lines.slice(1) : lines;
  const indexOf = (names: string[], fallback: number) => {
    const index = headers.findIndex(header => names.includes(header));
    return index >= 0 ? index : fallback;
  };
  const emailIndex = hasHeader ? indexOf(['email', 'emailaddress', 'eposta', 'mail'], 1) : 1;
  const nameIndex = hasHeader ? indexOf(['companyname', 'firmadi', 'company', 'firma'], 0) : 0;
  const countryIndex = hasHeader ? indexOf(['country', 'ulke', 'countrycode'], 2) : 2;
  const typeIndex = hasHeader ? indexOf(['companytype', 'firmatipi', 'type', 'tip'], 3) : 3;
  const websiteIndex = hasHeader ? indexOf(['website', 'websitesi', 'url', 'site'], 4) : 4;
  let invalid = 0;
  const rows: ProspectRecord[] = [];
  for (const line of data) {
    const values = cells(line);
    const email = values[emailIndex]?.toLowerCase() || '';
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      invalid += 1;
      continue;
    }
    rows.push({
      companyName: values[nameIndex] || email.split('@')[1] || 'Unnamed company',
      email,
      country: values[countryIndex] || undefined,
      companyType: values[typeIndex] || undefined,
      website: values[websiteIndex] || undefined,
    });
  }
  const unique = Array.from(new Map(rows.map(row => [row.email, row])).values());
  return { rows: unique, invalid };
}

const OBJECTIVE_OPTIONS: ObjectiveOption[] = [
  { id: 'profile_completion', icon: '🧭', group: 'seafarer', tr: 'Profil doluluğunu artır', en: 'Increase profile completion', descTr: 'Eksik profilleri %80 aktivasyon eşiğine taşı.', descEn: 'Move incomplete profiles toward the 80% activation threshold.', kpiTr: 'KPI: %80+ aktif profil', kpiEn: 'KPI: 80%+ activated profiles' },
  { id: 'job_application', icon: '⚓', group: 'seafarer', tr: 'İlan başvurusu artır', en: 'Increase job applications', descTr: 'Doğru gemi adamlarını uygun ilanlara yönlendir.', descEn: 'Drive relevant seafarers to suitable jobs.', kpiTr: 'KPI: Nitelikli başvuru', kpiEn: 'KPI: Qualified applications' },
  { id: 'registration', icon: '📝', group: 'seafarer', tr: 'Yeni gemi adamı kaydı', en: 'Acquire seafarers', descTr: 'Uluslararası ve yerel gemi adamlarını platforma getir.', descEn: 'Bring local and international seafarers to the platform.', kpiTr: 'KPI: Yeni kayıt / CAC', kpiEn: 'KPI: New registrations / CAC' },
  { id: 'reactivation', icon: '🔄', group: 'seafarer', tr: 'Gemi adamı geri kazanımı', en: 'Reactivate seafarers', descTr: 'Uzun süredir dönmeyen kullanıcıları tekrar harekete geçir.', descEn: 'Bring inactive users back into the product.', kpiTr: 'KPI: Yeniden aktifleşme', kpiEn: 'KPI: Reactivation rate' },
  { id: 'company_acquisition', icon: '🏢', group: 'business', tr: 'Maritime business kazanımı', en: 'Acquire maritime businesses', descTr: 'Armatör, crewing ve maritime business şirketlerini sisteme dahil et.', descEn: 'Bring shipowners, crewing agencies and maritime businesses into the platform.', kpiTr: 'KPI: Nitelikli şirket lead’i', kpiEn: 'KPI: Qualified company leads' },
  { id: 'free_job_posting', icon: '📋', group: 'business', tr: 'Ücretsiz ilanı başlattır', en: 'Start free job posting', descTr: 'Şirketi ücretsiz ilan vermeye ikna et; ilk değeri hızlı göster.', descEn: 'Convert a company to its first free job post and show value quickly.', kpiTr: 'KPI: İlk ilan yayınlama', kpiEn: 'KPI: First job published' },
  { id: 'applicant_growth', icon: '📈', group: 'business', tr: 'İlana nitelikli başvuru getir', en: 'Grow qualified applicants', descTr: 'Ücretsiz ilanı daha fazla doğru adayla buluştur.', descEn: 'Bring more relevant candidates to a free job post.', kpiTr: 'KPI: İlan başına nitelikli başvuru', kpiEn: 'KPI: Qualified applicants per job' },
  { id: 'cv_unlock', icon: '🔓', group: 'business', tr: 'CV unlock satışı', en: 'Drive CV unlocks', descTr: 'Başvuran adayların ve shortlist’in CV görüntüleme değerini anlat.', descEn: 'Show the value of unlocking applicant and shortlisted CVs.', kpiTr: 'KPI: CV unlock / gelir', kpiEn: 'KPI: CV unlocks / revenue' },
  { id: 'bullseye_cv_unlock', icon: '🎯', group: 'business', tr: 'Bullseye ile CV unlock', en: 'Bullseye CV unlock', descTr: 'Teknik filtreleme ile bulunan adayların CV’lerini unlock ettir.', descEn: 'Convert technically filtered Bullseye profiles into paid CV unlocks.', kpiTr: 'KPI: Filtre → unlock dönüşümü', kpiEn: 'KPI: Filter-to-unlock conversion' },
  { id: 'traffic', icon: '↗', group: 'brand', tr: 'Site trafiği', en: 'Drive website traffic', descTr: 'Belirli bir landing page veya ürün sayfasına ziyaret getir.', descEn: 'Drive visits to a focused landing or product page.', kpiTr: 'KPI: Nitelikli ziyaret', kpiEn: 'KPI: Qualified visits' },
  { id: 'awareness', icon: '◉', group: 'brand', tr: 'Marka bilinirliği', en: 'Build brand awareness', descTr: 'Crewinjob’un denizcilik işe alımındaki konumunu güçlendir.', descEn: 'Strengthen Crewinjob’s maritime recruitment position.', kpiTr: 'KPI: Erişim / marka araması', kpiEn: 'KPI: Reach / branded search' },
];

const OBJECTIVE_GROUPS: Array<{ id: ObjectiveOption['group']; tr: string; en: string }> = [
  { id: 'business', tr: 'Gelir ve şirket büyümesi', en: 'Revenue and business growth' },
  { id: 'seafarer', tr: 'Gemi adamı büyümesi', en: 'Seafarer growth' },
  { id: 'brand', tr: 'Erişim ve keşif', en: 'Reach and discovery' },
];

const STATUS_STYLE: Record<CampaignStatus, string> = {
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  ready: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  scheduled: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  running: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  partial: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  cancelled: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
};

function splitLines(value: string): string[] {
  return value.split(/[\n,]/).map(item => item.trim()).filter(Boolean);
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer py-1">
      <input type="checkbox" checked={checked} onChange={onChange} className="w-4 h-4 accent-ocean" />
      <span>{label}</span>
    </label>
  );
}

function ObjectiveCard({ option, selected, lang, onSelect }: { option: ObjectiveOption; selected: boolean; lang: 'tr' | 'en'; onSelect: () => void }) {
  const title = lang === 'tr' ? option.tr : option.en;
  const description = lang === 'tr' ? option.descTr : option.descEn;
  const kpi = lang === 'tr' ? option.kpiTr : option.kpiEn;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`text-left w-full border p-3 transition-colors ${selected ? 'border-ocean bg-cyan-50/70 dark:bg-cyan-950/30 ring-1 ring-ocean' : 'border-slate-200 dark:border-slate-700 hover:border-cyan-300 dark:hover:border-cyan-800 bg-white dark:bg-slate-900/40'}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none" aria-hidden="true">{option.icon}</span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
          <span className="block text-xs leading-relaxed text-slate-500 dark:text-slate-400 mt-1">{description}</span>
          <span className={`block text-[11px] mt-2 font-medium ${selected ? 'text-ocean' : 'text-slate-600 dark:text-slate-400'}`}>{kpi}</span>
        </span>
      </div>
    </button>
  );
}

function toDateTimeLocal(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] || character));
}

function isHtmlContent(value: string) {
  return /<\/?(html|body|table|div|p|a|style|h[1-6])\b/i.test(value);
}

function objectiveLabel(value: CampaignObjective, lang: 'tr' | 'en') {
  const labels: Record<CampaignObjective, [string, string]> = {
    awareness: ['Marka bilinirliği', 'Brand awareness'], traffic: ['Site trafiği', 'Website traffic'],
    registration: ['Yeni gemi adamı kaydı', 'New seafarer registration'], job_application: ['İlana nitelikli başvuru', 'Qualified job applications'],
    reactivation: ['Gemi adamı geri kazanımı', 'Seafarer reactivation'], profile_completion: ['Profil doluluğunu artır', 'Improve profile completion'],
    company_acquisition: ['Maritime business kazanımı', 'Maritime business acquisition'], free_job_posting: ['Ücretsiz ilanı başlattır', 'Start a free job post'],
    applicant_growth: ['İlana nitelikli başvuru getir', 'Grow qualified applicants'], cv_unlock: ['CV unlock satışı', 'Sell CV unlocks'],
    bullseye_cv_unlock: ['Bullseye ile CV unlock', 'Bullseye CV unlocks'],
  };
  return labels[value]?.[lang === 'tr' ? 0 : 1] || value;
}

function statusLabel(value: CampaignStatus, lang: 'tr' | 'en') {
  const labels: Record<CampaignStatus, [string, string]> = {
    draft: ['Taslak', 'Draft'], ready: ['Hazır', 'Ready'], scheduled: ['Zamanlandı', 'Scheduled'], running: ['Çalışıyor', 'Running'],
    partial: ['Kısmi tamamlandı', 'Partially complete'], completed: ['Tamamlandı', 'Completed'], failed: ['Başarısız', 'Failed'], cancelled: ['Durduruldu', 'Cancelled'],
  };
  return labels[value]?.[lang === 'tr' ? 0 : 1] || value;
}

// Gönderim ve kanal durumları API'den enum olarak gelir; yalnızca ekrandaki etiket çevrilir
const RUN_STATUS_LABEL: Record<string, [string, string]> = {
  queued: ['Kuyrukta', 'Queued'], processing: ['İşleniyor', 'Processing'], completed: ['Tamamlandı', 'Completed'], cancelled: ['Durduruldu', 'Cancelled'], failed: ['Başarısız', 'Failed'],
  pending: ['Bekliyor', 'Pending'], running: ['Çalışıyor', 'Running'], succeeded: ['Başarılı', 'Succeeded'], skipped: ['Atlandı', 'Skipped'],
};
function runStatusLabel(value: string, lang: 'tr' | 'en') {
  return RUN_STATUS_LABEL[value]?.[lang === 'tr' ? 0 : 1] || value;
}
// Yüzde: Türkçede "%40", İngilizcede "40%"
function percentText(value: number, lang: 'tr' | 'en', digits = 0) {
  const number = value.toLocaleString(localeTag(lang), { maximumFractionDigits: digits });
  return lang === 'tr' ? `%${number}` : `${number}%`;
}

function emailPreviewSource(value: string) {
  const body = isHtmlContent(value)
    ? value
    : `<div class="plain-text">${escapeHtml(value).replace(/\r?\n/g, '<br />')}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>
    :root { color-scheme: light; } * { box-sizing: border-box; } body { margin: 0; padding: 16px; background: #f8fafc; color: #172033; font: 14px/1.6 Arial, sans-serif; } img { max-width: 100%; height: auto; } a { color: #007ea7; } table { max-width: 100%; } .plain-text { white-space: normal; background: white; border: 1px solid #dbe4ef; border-radius: 10px; padding: 16px; }
  </style></head><body>${body}</body></html>`;
}

function EmailPreview({ body, subject, lang }: { body: string; subject: string; lang: 'tr' | 'en' }) {
  return <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900">
    <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-100 text-sm dark:bg-cyan-950/50" aria-hidden="true">✉️</span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-600">{lang === 'tr' ? 'E-posta önizlemesi' : 'Email preview'}</p>
        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{subject}</p>
      </div>
    </div>
    <iframe title={lang === 'tr' ? 'E-posta önizlemesi' : 'Email preview'} sandbox="" srcDoc={emailPreviewSource(body)} className="h-[360px] w-full bg-slate-100 dark:bg-slate-900 sm:h-[420px]" />
  </div>;
}

export default function CampaignHubTab() {
  const { lang } = useLang();
  const t = useCallback((tr: string, en: string) => lang === 'tr' ? tr : en, [lang]);
  const fid = useId();
  const [view, setView] = useState<View>(() => urlView<View>(['flows', 'paid', 'lifecycle', 'prospects'], 'flows'));
  const [campaigns, setCampaigns] = useState<UnifiedCampaign[]>([]);
  const [savedAudiences, setSavedAudiences] = useState<SavedAudience[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<CampaignObjective>('registration');
  const [audienceType, setAudienceType] = useState<CampaignAudienceType>('seafarers');
  const [buckets, setBuckets] = useState<FillBucket[]>(['zero', 'low']);
  const [countries, setCountries] = useState('TR');
  const [nationalities, setNationalities] = useState('');
  const [positions, setPositions] = useState('');
  const [activity, setActivity] = useState<CampaignAudience['activity']>('all');
  const [reachableChannels, setReachableChannels] = useState<NonNullable<CampaignAudience['reachableChannels']>>([]);
  const [manualEmails, setManualEmails] = useState('');
  const [prospectSource, setProspectSource] = useState<ProspectSource>('manual');
  const [prospectCompanyTypes, setProspectCompanyTypes] = useState('');
  const [prospectRows, setProspectRows] = useState<ProspectRecord[]>([]);
  const [invalidProspectRows, setInvalidProspectRows] = useState(0);
  const [whatsappNumbers, setWhatsappNumbers] = useState('');
  const [telegramIds, setTelegramIds] = useState('');
  const [consent, setConsent] = useState(false);
  const [social, setSocial] = useState<string[]>(['linkedin', 'facebook']);
  const [email, setEmail] = useState(true);
  const [whatsapp, setWhatsapp] = useState(false);
  const [telegram, setTelegram] = useState(false);
  const [paid, setPaid] = useState<AdPlatform[]>([]);
  const [content, setContent] = useState('');
  const [subject, setSubject] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [templates, setTemplates] = useState<BackendTemplate[]>([]);
  const [integrations, setIntegrations] = useState<BackendIntegration[]>([]);
  const [templateCatalogAvailable, setTemplateCatalogAvailable] = useState(false);
  const [integrationCatalogAvailable, setIntegrationCatalogAvailable] = useState(false);
  const [integrationIds, setIntegrationIds] = useState<Record<string, string>>({});
  const [ctaUrl, setCtaUrl] = useState('https://www.crewinjob.com/account/login');
  const [launchAt, setLaunchAt] = useState('');
  const [pilotMode, setPilotMode] = useState(false);
  const [pilotMaxRecipients, setPilotMaxRecipients] = useState(5);
  const [dailyBudget, setDailyBudget] = useState(15);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [audienceIsEstimate, setAudienceIsEstimate] = useState(false);
  const [audienceDistribution, setAudienceDistribution] = useState<AudiencePreviewDistribution | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedAudienceId, setSelectedAudienceId] = useState('');
  const [audienceName, setAudienceName] = useState('');
  const [audienceBusy, setAudienceBusy] = useState(false);
  const [conversion, setConversion] = useState<CampaignConversionResponse | null>(null);
  const [conversionLoading, setConversionLoading] = useState(false);
  const [delivery, setDelivery] = useState<CampaignConversionResponse | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<BackendTemplate | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [campaignRes, audienceRes] = await Promise.all([
        fetch('/api/campaigns', { cache: 'no-store' }),
        fetch('/api/campaigns/audiences', { cache: 'no-store' }),
      ]);
      const [campaignData, audienceData] = await Promise.all([campaignRes.json(), audienceRes.json()]);
      if (!campaignRes.ok) throw new Error(campaignData.error || t('Kampanyalar yüklenemedi.', "Couldn't load campaigns."));
      if (!audienceRes.ok) throw new Error(audienceData.error || t('Kayıtlı kitleler yüklenemedi.', "Couldn't load saved audiences."));
      setCampaigns(campaignData.items || []);
      setSavedAudiences(audienceData.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Kampanyalar yüklenemedi.', "Couldn't load campaigns."));
    } finally {
      setLoading(false);
    }
    // Dil değişimi listeyi yeniden çekmez; mesaj <Msg> ile ekranda çevrilir
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/campaigns/templates', { cache: 'no-store' }).then(res => res.json()),
      fetch('/api/campaigns/integrations', { cache: 'no-store' }).then(res => res.json()),
    ]).then(([templateData, integrationData]) => {
      if (!active) return;
      setTemplates(Array.isArray(templateData.items) ? templateData.items : []);
      setIntegrations(Array.isArray(integrationData.items) ? integrationData.items : []);
      setTemplateCatalogAvailable(Boolean(templateData.available));
      setIntegrationCatalogAvailable(Boolean(integrationData.available));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const reportCampaign = campaigns.find(item => item.id === selected);
  const reportCampaignId = reportCampaign?.backendId;
  // Pilot dispatch'leri backend'de PILOT_INTEGRATION_ID ile kaydedilir; yerel kampanya kimliğiyle sorgu hiç eşleşmezdi.
  // Pilotlarda rapor pilot kimliği + backend kampanya kimliği + dispatch kimliğiyle sorgulanır.
  const reportPilotDispatchId = reportCampaign?.maxRecipients
    ? (reportCampaign.dispatch?.dispatchId || (reportCampaign.activeDispatchId != null ? String(reportCampaign.activeDispatchId) : '')) || undefined
    : undefined;

  useEffect(() => {
    if (!selected) { setConversion(null); setDelivery(null); return; }
    let active = true;
    setConversionLoading(true);
    const reportQuery = new URLSearchParams({ campaignIntegrationId: reportPilotDispatchId ? PILOT_INTEGRATION_ID : selected });
    if (reportCampaignId) reportQuery.set('campaignId', reportCampaignId);
    if (reportPilotDispatchId) reportQuery.set('dispatchId', reportPilotDispatchId);
    Promise.all([
      fetch(`/api/growth/campaign-conversion?${reportQuery}`).then(res => res.json() as Promise<CampaignConversionResponse>),
      fetch(`/api/growth/campaign-delivery?${reportQuery}`).then(res => res.json() as Promise<CampaignConversionResponse>),
    ]).then(([conversionData, deliveryData]) => { if (active) { setConversion(conversionData); setDelivery(deliveryData); } })
      .catch((err: Error) => { if (active) { setConversion({ available: false, reason: 'backend_error', error: err.message }); setDelivery(null); } })
      .finally(() => { if (active) setConversionLoading(false); });
    return () => { active = false; };
  }, [reportCampaignId, reportPilotDispatchId, selected]);

  const selectedCampaign = useMemo(
    () => campaigns.find(item => item.id === selected) || null,
    [campaigns, selected],
  );

  useEffect(() => {
    const templateId = selectedCampaign?.content.templateId;
    if (!templateId) { setSelectedTemplate(null); return; }
    let active = true;
    fetch('/api/campaigns/templates/' + encodeURIComponent(templateId), { cache: 'no-store' })
      .then(res => res.json())
      .then(data => { if (active) setSelectedTemplate(data.available ? data.item : null); })
      .catch(() => { if (active) setSelectedTemplate(null); });
    return () => { active = false; };
  }, [selectedCampaign?.content.templateId]);

  useEffect(() => {
    const canQueryStatus = selectedCampaign?.audience.audienceType === 'company_prospects'
      ? Boolean(selectedCampaign.dispatch?.dispatchId)
      : selectedCampaign?.activeDispatchId != null;
    if (!selected || !selectedCampaign?.dispatch || !canQueryStatus || ['completed', 'cancelled', 'failed'].includes(selectedCampaign.dispatch.status)) return;
    let active = true;
    const refresh = () => fetch(`/api/campaigns/${selected}/dispatch`, { cache: 'no-store' })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => { if (active && ok) setCampaigns(items => items.map(item => item.id === selected ? data : item)); })
      .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [selected, selectedCampaign?.activeDispatchId, selectedCampaign?.dispatch?.status]);

  const toggle = <T extends string>(items: T[], item: T, setter: (next: T[]) => void) => {
    setter(items.includes(item) ? items.filter(value => value !== item) : [...items, item]);
  };

  const currentAudience = useCallback((): CampaignAudience => ({
    fillBuckets: buckets,
    audienceType,
    prospectSource: audienceType === 'company_prospects' ? prospectSource : undefined,
    prospectCompanyTypes: audienceType === 'company_prospects' ? splitLines(prospectCompanyTypes) : undefined,
    countries: splitLines(countries).map(item => item.toUpperCase()),
    nationalities: splitLines(nationalities),
    positions: splitLines(positions),
    activity,
    reachableChannels,
    manualEmails: audienceType === 'company_prospects'
      ? Array.from(new Set([...splitLines(manualEmails), ...prospectRows.map(row => row.email)]))
      : splitLines(manualEmails),
    whatsappNumbers: splitLines(whatsappNumbers),
    telegramChatIds: splitLines(telegramIds),
    consentConfirmed: consent,
  }), [activity, audienceType, buckets, consent, countries, manualEmails, nationalities, positions, prospectCompanyTypes, prospectRows, prospectSource, reachableChannels, telegramIds, whatsappNumbers]);

  const clearAudiencePreview = () => {
    setAudienceCount(null);
    setAudienceIsEstimate(false);
    setAudienceDistribution(null);
  };

  const applySavedAudience = (id: string) => {
    setSelectedAudienceId(id);
    const saved = savedAudiences.find(item => item.id === id);
    if (!saved) return;
    setBuckets(saved.filters.fillBuckets);
    setAudienceType('seafarers');
    setCountries((saved.filters.countries || []).join(', '));
    setNationalities((saved.filters.nationalities || []).join(', '));
    setPositions((saved.filters.positions || []).join(', '));
    setActivity(saved.filters.activity || 'all');
    setReachableChannels(saved.filters.reachableChannels || []);
    setAudienceName(saved.name);
    clearAudiencePreview();
  };

  const saveCurrentAudience = async () => {
    setAudienceBusy(true); setError('');
    try {
      const audience = currentAudience();
      const res = await fetch('/api/campaigns/audiences', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: audienceName,
          estimatedRecipients: audienceCount ?? undefined,
          filters: { fillBuckets: audience.fillBuckets, countries: audience.countries, nationalities: audience.nationalities, positions: audience.positions, activity: audience.activity, reachableChannels: audience.reachableChannels },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('Kitle kaydedilemedi.', "Couldn't save the audience."));
      setSavedAudiences(items => [data, ...items]);
      setSelectedAudienceId(data.id);
      setAudienceName(data.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Kitle kaydedilemedi.', "Couldn't save the audience."));
    } finally { setAudienceBusy(false); }
  };

  const removeSavedAudience = async () => {
    if (!selectedAudienceId) return;
    setAudienceBusy(true); setError('');
    try {
      const res = await fetch(`/api/campaigns/audiences/${selectedAudienceId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('Kitle silinemedi.', "Couldn't delete the audience."));
      setSavedAudiences(items => items.filter(item => item.id !== selectedAudienceId));
      setSelectedAudienceId('');
      setAudienceName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Kitle silinemedi.', "Couldn't delete the audience."));
    } finally { setAudienceBusy(false); }
  };

  const previewAudience = async () => {
    setPreviewing(true);
    setError('');
    try {
      if (audienceType === 'maritime_businesses') {
        setAudienceCount(new Set(currentAudience().manualEmails?.map(item => item.toLowerCase())).size);
        setAudienceIsEstimate(false);
        setAudienceDistribution(null);
        return;
      }
      const res = await fetch('/api/campaigns/audience-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentAudience()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('Hedef kitle hesaplanamadı.', "Couldn't calculate the target audience."));
      setAudienceCount(data.estimatedTotal);
      setAudienceIsEstimate(Boolean(data.isEstimate));
      setAudienceDistribution(data.distributions || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Hedef kitle hesaplanamadı.', "Couldn't calculate the target audience."));
    } finally {
      setPreviewing(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setStep(1); setName(''); setObjective('registration'); setBuckets(['zero', 'low']);
    setAudienceType('seafarers');
    setCountries('TR'); setNationalities(''); setPositions(''); setActivity('all'); setReachableChannels([]); setManualEmails(''); setProspectSource('manual'); setProspectCompanyTypes(''); setProspectRows([]); setInvalidProspectRows(0); setWhatsappNumbers(''); setTelegramIds('');
    setConsent(false); setSocial(['linkedin', 'facebook']); setEmail(true); setWhatsapp(false);
    setTelegram(false); setPaid([]); setContent(''); setSubject(''); setTemplateId('');
    setPilotMode(false); setPilotMaxRecipients(5);
    setIntegrationIds({});
    setCtaUrl('https://www.crewinjob.com/account/login'); setLaunchAt(''); setDailyBudget(15); setAudienceCount(null); setAudienceIsEstimate(false); setAudienceDistribution(null);
    setSelectedAudienceId(''); setAudienceName('');
  };

  const editCampaign = (campaign: UnifiedCampaign) => {
    resetForm();
    setEditingId(campaign.id);
    setShowCreate(true);
    setSelected(null);
    setStep(1);
    setName(campaign.name);
    setObjective(campaign.objective);
    setAudienceType(campaign.audience.audienceType || 'seafarers');
    setBuckets(campaign.audience.fillBuckets || []);
    setCountries((campaign.audience.countries || []).join(', '));
    setNationalities((campaign.audience.nationalities || []).join(', '));
    setPositions((campaign.audience.positions || []).join(', '));
    setActivity(campaign.audience.activity || 'all');
    setReachableChannels(campaign.audience.reachableChannels || []);
    setManualEmails((campaign.audience.manualEmails || []).join('\n'));
    setProspectSource(campaign.audience.prospectSource || 'manual');
    setProspectCompanyTypes((campaign.audience.prospectCompanyTypes || []).join(', '));
    setWhatsappNumbers((campaign.audience.whatsappNumbers || []).join('\n'));
    setTelegramIds((campaign.audience.telegramChatIds || []).map(String).join('\n'));
    setConsent(Boolean(campaign.audience.consentConfirmed));
    setSocial(campaign.channels.social || []);
    setEmail(Boolean(campaign.channels.email));
    setWhatsapp(Boolean(campaign.channels.whatsapp));
    setTelegram(Boolean(campaign.channels.telegram));
    setPaid(campaign.channels.paidAds || []);
    setContent(campaign.content.text || campaign.content.html || '');
    setSubject(campaign.content.subject || '');
    setTemplateId(campaign.content.templateId || '');
    setIntegrationIds(Object.fromEntries(Object.entries(campaign.backendChannels || {}).map(([channel, config]) => [channel, config.integrationId || ''])));
    setCtaUrl(campaign.content.ctaUrl || 'https://www.crewinjob.com/account/login');
    setLaunchAt(toDateTimeLocal(campaign.launchAt));
    setPilotMode(Boolean(campaign.maxRecipients));
    setPilotMaxRecipients(campaign.maxRecipients || 5);
    const budgets = Object.values(campaign.budget.dailyByPlatform || {}).filter((value): value is number => typeof value === 'number');
    setDailyBudget(budgets[0] || 15);
  };

  const chooseObjective = (next: CampaignObjective) => {
    const option = OBJECTIVE_OPTIONS.find(item => item.id === next);
    const isBusiness = option?.group === 'business';
    const isProspect = next === 'company_acquisition';
    setObjective(next);
    setAudienceType(isProspect ? 'company_prospects' : isBusiness ? 'maritime_businesses' : 'seafarers');
    setBuckets(isBusiness ? [] : next === 'bullseye_cv_unlock' ? ['mid', 'high'] : next === 'cv_unlock' ? ['mid', 'high'] : next === 'profile_completion' ? ['zero', 'low', 'mid'] : ['zero', 'low']);
    if (isBusiness) {
      setCountries('');
      setSocial(['linkedin']);
      setEmail(true);
      setWhatsapp(false);
      setTelegram(false);
      setPaid([]);
    } else if (!countries.trim()) {
      setCountries('TR');
    }
    clearAudiencePreview();
  };

  const chooseAudienceType = (next: CampaignAudienceType) => {
    setAudienceType(next);
    if (next === 'seafarers') {
      if (!buckets.length) setBuckets(['zero', 'low']);
      if (!countries.trim()) setCountries('TR');
    } else {
      setBuckets([]);
      setCountries('');
    }
    clearAudiencePreview();
  };

  const useProspectsInCampaign = async (emails: string[]) => {
    const preflight = await fetch('/api/prospects/Preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails, channel: 'email' }),
    });
    const preflightBody = await preflight.json().catch(() => ({})) as Record<string, unknown>;
    if (!preflight.ok || preflightBody.allowed === false || preflightBody.canDispatch === false || preflightBody.valid === false) {
      setError(String(preflightBody.error || preflightBody.message || t('Prospect kampanyası ön kontrolünden geçemedi.', "The prospect campaign didn't pass the preflight check.")));
      return;
    }
    setView('flows');
    setShowCreate(true);
    setStep(1);
    setName(t('Yeni maritime business kazanımı', 'New maritime business acquisition'));
    setObjective('company_acquisition');
    setAudienceType('company_prospects');
    setBuckets([]);
    setCountries('');
    setManualEmails(emails.join('\n'));
    setProspectSource('manual');
    clearAudiencePreview();
  };

  const importProspects = async (file: File) => {
    setError('');
    try {
      const parsed = parseProspectCsv(await file.text());
      setProspectRows(parsed.rows);
      setInvalidProspectRows(parsed.invalid);
      setProspectSource('csv');
      clearAudiencePreview();
      if (!parsed.rows.length) setError(t('CSV içinde geçerli bir prospect e-postası bulunamadı.', 'No valid prospect email found in the CSV.'));
    } catch {
      setError(t('Prospect CSV dosyası okunamadı.', "Couldn't read the prospect CSV file."));
    }
  };

  const save = async () => {
    const targetId = editingId;
    setBusyId(targetId || 'create'); setError('');
    try {
      const text = ctaUrl && !content.includes(ctaUrl) ? `${content.trim()}\n\n${ctaUrl}` : content.trim();
      const payload: Record<string, unknown> = {
        name,
        objective,
        audience: currentAudience(),
        channels: { social, email, whatsapp, telegram, paidAds: paid },
        content: { text, subject: subject || name, ctaUrl, templateId: templateId.trim() || undefined },
        backendChannels: Object.fromEntries([
          ...Object.entries(integrationIds).map(([channel, integrationId]) => [channel, { integrationId, ...(channel === 'email' && templateId.trim() ? { templateId: templateId.trim() } : {}) }]),
          ...(email && templateId.trim() && !integrationIds.email ? [['email', { templateId: templateId.trim() }]] : []),
        ]),
        budget: { currency: 'USD', dailyByPlatform: Object.fromEntries(paid.map(platform => [platform, dailyBudget])) },
        // Düzenlemede boş bırakılan yayın zamanı null gönderilir → zamanlama kaldırılır, durum yeniden hesaplanır
        launchAt: launchAt ? new Date(launchAt).toISOString() : targetId ? null : undefined,
        timezone: 'Europe/Istanbul',
      };
      if (targetId) {
        payload.maxRecipients = pilotMode && email && channelCount === 1 ? pilotMaxRecipients : null;
      } else if (pilotMode && email && channelCount === 1) {
        payload.maxRecipients = pilotMaxRecipients;
      }
      const res = await fetch(targetId ? `/api/campaigns/${targetId}` : '/api/campaigns', {
        method: targetId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || (targetId ? t('Kampanya güncellenemedi.', "Couldn't update the campaign.") : t('Kampanya oluşturulamadı.', "Couldn't create the campaign.")));
      setCampaigns(items => {
        const campaign = data as UnifiedCampaign;
        const exists = items.some(item => item.id === campaign.id);
        return exists ? items.map(item => item.id === campaign.id ? campaign : item) : [campaign, ...items];
      });
      setShowCreate(false); resetForm(); setSelected(targetId || data.id);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : targetId ? t('Kampanya güncellenemedi.', "Couldn't update the campaign.") : t('Kampanya oluşturulamadı.', "Couldn't create the campaign."));
    } finally { setBusyId(null); }
  };

  // Sunucunun kodlu hatalarını TR/EN mesaja çevirir
  const launchErrorMessage = (data: { error?: string; code?: string }) => {
    if (data.code === 'non_contiguous_buckets') return t('Seçili profil segmentleri bitişik değil (ör. %0 ve %80+). Arka plan e-posta gönderimi tek bir doluluk aralığı kullanır; bitişik segmentler seçin veya her aralık için ayrı kampanya oluşturun.', "The selected profile segments aren't contiguous (e.g. 0% and 80%+). Background email dispatch uses a single completion range; select adjacent segments or create a separate campaign per range.");
    if (data.code === 'remote_only') return t('Bu kampanya yalnızca backend\'de kayıtlı; backend yönetiminden yönetin.', 'This campaign exists only in the backend; manage it there.');
    return data.error || t('Kampanya çalıştırılamadı.', "Couldn't launch the campaign.");
  };

  const launch = async (id: string) => {
    setBusyId(id); setError('');
    try {
      const existing = campaigns.find(item => item.id === id);
      const retryDispatch = Boolean(existing?.dispatch && existing.status === 'failed');
      const res = await fetch(retryDispatch ? `/api/campaigns/${id}/dispatch` : `/api/campaigns/${id}/launch`, {
        method: 'POST',
        ...(retryDispatch ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry' }) } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(launchErrorMessage(data));
      await load(); setSelected(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Kampanya çalıştırılamadı.', "Couldn't launch the campaign."));
    } finally { setBusyId(null); }
  };

  const cancel = async (id: string) => {
    setBusyId(id); setError('');
    try {
      const existing = campaigns.find(item => item.id === id);
      const url = existing?.dispatch ? `/api/campaigns/${id}/dispatch` : `/api/campaigns/${id}`;
      const method = existing?.dispatch ? 'POST' : 'PATCH';
      const body = existing?.dispatch ? { action: 'cancel' } : { status: 'cancelled' };
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.code ? launchErrorMessage(data) : data.error || t('Kampanya iptal edilemedi.', "Couldn't cancel the campaign."));
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : t('Kampanya iptal edilemedi.', "Couldn't cancel the campaign.")); }
    finally { setBusyId(null); }
  };

  const remove = async (id: string) => {
    const campaign = campaigns.find(item => item.id === id);
    if (!campaign || !window.confirm(t(`"${campaign.name}" kampanyası silinsin mi? Bu işlem geri alınamaz.`, `Delete "${campaign.name}"? This can't be undone.`))) return;
    setBusyId(`delete:${id}`); setError('');
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.code ? launchErrorMessage(data) : data.error || t('Kampanya silinemedi.', "Couldn't delete the campaign."));
      if (selected === id) setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Kampanya silinemedi.', "Couldn't delete the campaign."));
    } finally { setBusyId(null); }
  };

  const channelCount = social.length + paid.length + Number(email) + Number(whatsapp) + Number(telegram);
  const audienceEmailCount = new Set([...splitLines(manualEmails), ...prospectRows.map(row => row.email)].map(item => item.toLowerCase())).size;
  // Bitişik olmayan segmentler (ör. %0 + %80+) yalnızca backend e-posta dispatch'inde (tek kanal e-posta + şablon) sorun:
  // dispatch tek aralık gönderir, sunucu bu seçimi reddeder → formda baştan gösterilir ve kaydetme engellenir.
  const nonContiguousBuckets = audienceType === 'seafarers' && buckets.length > 1 && !bucketsAreContiguous(buckets);
  const dispatchBucketBlocked = nonContiguousBuckets && email && channelCount === 1 && Boolean(templateId.trim());
  const canNext = step === 1 ? Boolean(name.trim()) : step === 2 ? buckets.length > 0 || audienceEmailCount > 0 : step === 3 ? channelCount > 0 : Boolean(content.trim()) && !dispatchBucketBlocked;
  const selectedObjective = OBJECTIVE_OPTIONS.find(item => item.id === objective) || OBJECTIVE_OPTIONS[2];
  const conversionMetrics = conversion?.result?.summary || conversion?.result;
  const deliveryMetrics = delivery?.result?.summary || delivery?.result;
  const campaignMetrics = [conversionMetrics, deliveryMetrics].reduce<CampaignConversionMetrics>((merged, current) => {
    for (const [key, value] of Object.entries(current || {})) {
      if (value !== undefined) Object.assign(merged, { [key]: value });
    }
    return merged;
  }, {});
  const reportAvailable = Boolean(conversion?.available || delivery?.available);
  const reportMetrics: Array<[string, number | undefined]> = [
    [t('Kuyrukta', 'Queued'), campaignMetrics.totalQueued],
    [t('Gönderilen', 'Sent'), campaignMetrics.totalSent],
    [t('Teslim', 'Delivered'), campaignMetrics.delivered],
    [t('Açılma', 'Opens'), campaignMetrics.opens],
    [t('Tıklama', 'Clicks'), campaignMetrics.clicks],
    [t('Bounce', 'Bounced'), campaignMetrics.bounced],
    [t('Şikayet', 'Complaints'), campaignMetrics.complained],
    [t('Başarısız', 'Failed'), campaignMetrics.failed],
    [t('Abonelikten çıktı', 'Unsubscribed'), campaignMetrics.unsubscribed],
    [t('Kayıt', 'Registrations'), campaignMetrics.registrations],
    [t('Aktive', 'Activated'), campaignMetrics.activatedSeafarers],
  ];
  const reportRates: Array<[string, number | undefined]> = [
    [t('Teslim oranı', 'Delivery rate'), campaignMetrics.deliveryRate],
    [t('Açılma oranı', 'Open rate'), campaignMetrics.openRate],
    [t('Tıklama oranı', 'Click rate'), campaignMetrics.clickRate],
    ['CTOR', campaignMetrics.clickToOpenRate],
    [t('Kayıt oranı', 'Registration rate'), campaignMetrics.registrationRate],
    [t('Aktivasyon oranı', 'Activation rate'), campaignMetrics.activationRate],
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t('Kampanya merkezi', 'Campaign hub')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('Doğru kitleyi sosyal, mesajlaşma ve reklam kanallarında tek akıştan yönetin.', 'Reach the right audience across social, messaging and paid channels.')}</p>
        </div>
        <div role="tablist" aria-label={t('Kampanya merkezi bölümleri', 'Campaign hub sections')} onKeyDown={onTabKeys} className="inline-flex flex-wrap gap-1 max-w-full border border-slate-200 dark:border-slate-700 rounded-lg p-1 bg-white dark:bg-slate-800">
          <button type="button" role="tab" aria-selected={view === 'flows'} tabIndex={view === 'flows' ? 0 : -1} onClick={() => setView('flows')} className={`px-3 py-1.5 text-sm whitespace-nowrap rounded-md ${view === 'flows' ? 'bg-ocean text-white' : 'text-slate-600 dark:text-slate-300'}`}>{t('Kampanya akışları', 'Campaign flows')}</button>
          <button type="button" role="tab" aria-selected={view === 'paid'} tabIndex={view === 'paid' ? 0 : -1} onClick={() => setView('paid')} className={`px-3 py-1.5 text-sm whitespace-nowrap rounded-md ${view === 'paid' ? 'bg-ocean text-white' : 'text-slate-600 dark:text-slate-300'}`}>{t('Ücretli reklamlar', 'Paid ads')}</button>
          <button type="button" role="tab" aria-selected={view === 'lifecycle'} tabIndex={view === 'lifecycle' ? 0 : -1} onClick={() => setView('lifecycle')} className={`px-3 py-1.5 text-sm whitespace-nowrap rounded-md ${view === 'lifecycle' ? 'bg-ocean text-white' : 'text-slate-600 dark:text-slate-300'}`}>{t('Lifecycle', 'Lifecycle')}</button>
          <button type="button" role="tab" aria-selected={view === 'prospects'} tabIndex={view === 'prospects' ? 0 : -1} onClick={() => setView('prospects')} className={`px-3 py-1.5 text-sm whitespace-nowrap rounded-md ${view === 'prospects' ? 'bg-ocean text-white' : 'text-slate-600 dark:text-slate-300'}`}>{t('AI Prospect Finder', 'AI Prospect Finder')}</button>
        </div>
      </div>

      <div className="border border-cyan-200 dark:border-cyan-900 bg-cyan-50/60 dark:bg-cyan-950/20 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('Crewinjob gelir yolunu kampanyaya bağla', 'Connect the Crewinjob revenue path to your campaign')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('Önce şirketi getir, sonra ücretsiz ilan değerini göster, en sonunda doğru CV’yi unlock ettir.', 'Acquire the company, prove value with a free job post, then convert the right CV into an unlock.')}</p>
          </div>
          <span className="text-xs font-semibold text-ocean">{t('Ana büyüme akışı', 'Core growth loop')}</span>
        </div>
        <div className="grid sm:grid-cols-4 gap-2">
          {[
            [t('01 Şirket kazan', '01 Acquire business'), t('Armatör, crewing veya maritime business lead’i', 'Shipowner, crewing or maritime business lead')],
            [t('02 Ücretsiz ilan', '02 Free job post'), t('İlk ilanı yayınlat ve aday akışını göster', 'Publish the first job and prove candidate flow')],
            [t('03 Doğru adayı bul', '03 Find the right candidate'), t('Bullseye filtreleri veya başvurularla shortlist oluştur', 'Build a shortlist from Bullseye filters or applications')],
            [t('04 CV unlock geliri', '04 CV unlock revenue'), t('İlgilenilen CV’yi ücretli olarak görüntület', 'Convert the interested CV into a paid unlock')],
          ].map(([title, description]) => <div key={title} className="border border-cyan-100 dark:border-cyan-900/70 bg-white/70 dark:bg-slate-900/40 p-3"><p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{title}</p><p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 mt-1">{description}</p></div>)}
        </div>
      </div>

      {view === 'paid' ? <CampaignManagerTab /> : view === 'lifecycle' ? <LifecycleDraftPanel lang={lang} /> : view === 'prospects' ? <ProspectFinderPanel lang={lang} onUseInCampaign={useProspectsInCampaign} /> : (
        <>
          {error && <div role="alert" className="border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm"><Msg text={error} /></div>}

          {!showCreate && (
            <div className="flex justify-between items-center gap-3 border-b border-slate-200 dark:border-slate-700 pb-4">
              <div className="text-sm text-slate-500 dark:text-slate-400">{campaigns.length} {t('kampanya', 'campaigns')}</div>
              <button onClick={() => setShowCreate(true)} className="bg-ocean hover:bg-ocean-dark text-white text-sm font-semibold px-4 py-2 rounded-lg">+ {t('Yeni kampanya', 'New campaign')}</button>
            </div>
          )}

          {showCreate && (
            <section className="border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg overflow-hidden">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{editingId ? t('Kampanyayı düzenle', 'Edit campaign') : t('Yeni kampanya oluştur', 'Create campaign')}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{editingId ? t('Ayarları güncelle, son adımda değişiklikleri kaydet.', 'Update the settings and save your changes on the last step.') : t('Hedefini seç, kitleyi doğrula ve gönderimden önce içeriği kontrol et.', 'Choose a goal, validate the audience and review content before delivery.')}</p>
                </div>
                <button type="button" onClick={() => { setShowCreate(false); resetForm(); }} className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300">{t('Vazgeç', 'Discard')}</button>
              </div>
              <div className="grid grid-cols-4 border-b border-slate-200 dark:border-slate-700">
                {[t('Hedef', 'Goal'), t('Kitle', 'Audience'), t('Kanallar', 'Channels'), t('İçerik ve yayın', 'Content & launch')].map((label, index) => (
                  <button key={label} aria-current={step === index + 1 ? 'step' : undefined} onClick={() => index + 1 <= step && setStep(index + 1)} className={`py-3 text-xs sm:text-sm font-medium border-b-2 ${step === index + 1 ? 'border-ocean text-ocean' : 'border-transparent text-slate-600'}`}>{index + 1}. {label}</button>
                ))}
              </div>
              <div className="p-5 min-h-[300px]">
                {step === 1 && <div className="space-y-6">
                  <div className="max-w-3xl">
                    <label htmlFor={`${fid}-name`} className="text-xs text-slate-500 block mb-1">{t('Kampanya adı', 'Campaign name')}</label>
                    <input id={`${fid}-name`} value={name} onChange={e => setName(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2.5" placeholder={t('Örn: Eylül — Bullseye CV unlock şirket kazanımı', 'e.g. September — Bullseye CV unlock business acquisition')} />
                  </div>
                  <div>
                    <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('Bu kampanyayla neyi büyütmek istiyorsun?', 'What do you want this campaign to grow?')}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('Hedefi seçtiğinde kitle ve ölçüm önerileri buna göre şekillenir.', 'Your audience and measurement suggestions will follow this choice.')}</p>
                      </div>
                      <span className="text-xs text-ocean font-medium">{t('1 hedef seç', 'Choose 1 goal')}</span>
                    </div>
                    <div className="space-y-5">
                      {OBJECTIVE_GROUPS.map(group => {
                        const options = OBJECTIVE_OPTIONS.filter(option => option.group === group.id);
                        return <div key={group.id}>
                          <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-600 dark:text-slate-400 mb-2">{t(group.tr, group.en)}</p>
                          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
                            {options.map(option => <ObjectiveCard key={option.id} option={option} selected={objective === option.id} lang={lang} onSelect={() => chooseObjective(option.id)} />)}
                          </div>
                        </div>;
                      })}
                    </div>
                  </div>
                  <div className="border-l-4 border-ocean bg-cyan-50/70 dark:bg-cyan-950/25 px-4 py-3 max-w-4xl">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100"><span aria-hidden="true">{selectedObjective.icon}</span> {lang === 'tr' ? selectedObjective.tr : selectedObjective.en}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{lang === 'tr' ? selectedObjective.descTr : selectedObjective.descEn}</p>
                    <p className="text-xs text-ocean font-medium mt-2">{lang === 'tr' ? selectedObjective.kpiTr : selectedObjective.kpiEn}</p>
                  </div>
                </div>}

                {step === 2 && <div className="space-y-5">
                  <div className="grid gap-3 md:grid-cols-[minmax(190px,1fr)_minmax(220px,1fr)_auto] items-end border-b border-slate-200 dark:border-slate-700 pb-5">
                    <div>
                      <label htmlFor={`${fid}-saved-audience`} className="text-xs text-slate-500 block mb-1">{t('Kayıtlı kitle', 'Saved audience')}</label>
                      <select id={`${fid}-saved-audience`} value={selectedAudienceId} onChange={event => applySavedAudience(event.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2">
                        <option value="">{t('Kitle seçin', 'Select an audience')}</option>
                        {savedAudiences.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`${fid}-audience-name`} className="text-xs text-slate-500 block mb-1">{t('Kitle adı', 'Audience name')}</label>
                      <input id={`${fid}-audience-name`} value={audienceName} onChange={event => setAudienceName(event.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2" placeholder={t('Örn: Filipinli eksik profiller', 'e.g. Incomplete profiles from PH')} />
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={saveCurrentAudience} disabled={audienceBusy || !audienceName.trim() || audienceType !== 'seafarers'} className="text-sm bg-ocean text-white px-3 py-2 rounded-lg disabled:opacity-40">{audienceBusy ? t('İşleniyor…', 'Working…') : t('Kaydet', 'Save')}</button>
                      {selectedAudienceId && <button type="button" onClick={removeSavedAudience} disabled={audienceBusy} className="text-sm border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 px-3 py-2 rounded-lg disabled:opacity-40">{t('Sil', 'Delete')}</button>}
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">{audienceType === 'seafarers' ? t('Yalnızca segment filtreleri kaydedilir; manuel iletişim bilgileri ve alıcı listeleri saklanmaz.', 'Only segment filters are saved; manual contact details and recipient lists are not stored.') : t('Lead listeleri şu an kampanya taslağında kullanılır; kalıcı CRM kaydı için backend prospect servisi gerekir.', 'Lead lists are currently used in the campaign draft; persistent CRM storage requires the backend prospect service.')}</p>
                  <div className="border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('Kime ulaşacağız?', 'Who are we reaching?')}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('Şirket hedeflerinde profil segmenti yerine şirket iletişim listesi gerekir.', 'Business goals use a company contact list instead of seafarer profile segments.')}</p>
                      </div>
                      <div className="flex gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1">
                        {([['seafarers', t('Gemi adamları', 'Seafarers')], ['maritime_businesses', t('Kayıtlı şirketler', 'Registered companies')], ['company_prospects', t('Yeni prospectler', 'New prospects')]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={audienceType === value} onClick={() => chooseAudienceType(value)} className={`px-3 py-1.5 text-xs font-medium ${audienceType === value ? 'bg-ocean text-white' : 'text-slate-500 dark:text-slate-300'}`}>{label}</button>)}
                      </div>
                    </div>
                    {audienceType === 'maritime_businesses' && <div className="mt-3 flex items-center gap-3 flex-wrap"><p className="text-xs text-amber-700 dark:text-amber-300">{t('Bu seçenek yalnızca Crewinjob’a kayıtlı şirketleri temsil eder. Listeyi backend şirket audience endpoint’i geldiğinde filtreleyebileceğiz.', 'This option represents companies already registered on Crewinjob. It will become dynamic when the backend company audience endpoint is available.')}</p><button type="button" onClick={previewAudience} disabled={previewing} className="text-xs border border-ocean text-ocean px-3 py-1.5 disabled:opacity-50">{previewing ? t('Sayılıyor…', 'Counting…') : t('Firma listesini say', 'Count company list')}</button></div>}
                    {audienceType === 'company_prospects' && <div className="mt-3 border border-amber-200 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/20 p-4 space-y-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap"><div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('Yeni şirket prospect havuzu', 'New company prospect pool')}</p><p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{t('Crewinjob’da henüz kayıtlı olmayan şirketleri ayrı bir lead listesi olarak içeri al.', 'Import companies that are not yet registered on Crewinjob as a separate lead list.')}</p></div><span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">{t('İzin ve kaynak kontrolü gerekli', 'Consent and source review required')}</span></div>
                      <div className="grid md:grid-cols-3 gap-3">
                        {([['manual', t('Elle liste', 'Manual list'), t('Birkaç hedef şirket için', 'For a focused list')], ['csv', t('CSV içe aktar', 'Import CSV'), t('Toplu prospect listesi için', 'For a bulk prospect list')], ['crm', t('CRM bağlantısı', 'CRM connection'), t('Backend hazır olduğunda', 'When backend is ready')]] as const).map(([value, label, description]) => <button key={value} type="button" aria-pressed={prospectSource === value} disabled={value === 'crm'} onClick={() => setProspectSource(value)} className={`text-left border p-3 ${prospectSource === value ? 'border-ocean bg-white dark:bg-slate-900 ring-1 ring-ocean' : 'border-amber-200 dark:border-amber-900/70 bg-white/60 dark:bg-slate-900/30'} ${value === 'crm' ? 'opacity-50 cursor-not-allowed' : ''}`}><span className="block text-xs font-semibold text-slate-800 dark:text-slate-100">{label}</span><span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-1">{description}</span></button>)}
                      </div>
                      {prospectSource === 'csv' && <div className="border border-dashed border-amber-300 dark:border-amber-800 p-3"><label htmlFor={`${fid}-prospect-csv`} className="text-xs font-semibold text-slate-700 dark:text-slate-200 block mb-2">{t('Prospect CSV dosyası', 'Prospect CSV file')}</label><input id={`${fid}-prospect-csv`} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={event => { const file = event.target.files?.[0]; if (file) void importProspects(file); event.target.value = ''; }} className="block w-full text-sm text-slate-600 dark:text-slate-300" /><p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">{t('Başlıklar: companyName, email, country, companyType, website. Her satır bir şirket olmalı.', 'Headers: companyName, email, country, companyType, website. One company per row.')}</p>{prospectRows.length > 0 && <p role="status" className="text-xs text-green-700 dark:text-green-300 mt-2">{prospectRows.length} {t('geçerli lead içe aktarıldı', 'valid leads imported')}{invalidProspectRows ? ` · ${invalidProspectRows} ${t('satır atlandı', 'rows skipped')}` : ''}</p>}</div>}
                      <div className="grid md:grid-cols-2 gap-3"><div><label htmlFor={`${fid}-company-type`} className="text-xs text-slate-500 block mb-1">{t('Şirket tipi', 'Company type')}</label><input id={`${fid}-company-type`} value={prospectCompanyTypes} onChange={event => { setProspectCompanyTypes(event.target.value); clearAudiencePreview(); }} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" placeholder={t('Crewing, armatör, ship manager', 'Crewing, shipowner, ship manager')} /></div><div><label htmlFor={`${fid}-target-countries`} className="text-xs text-slate-500 block mb-1">{t('Hedef ülke kodları', 'Target country codes')}</label><input id={`${fid}-target-countries`} value={countries} onChange={event => { setCountries(event.target.value); clearAudiencePreview(); }} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" placeholder="TR, NL, GR, SG" /></div></div>
                      <div className="flex items-center gap-3 flex-wrap"><button type="button" onClick={previewAudience} disabled={previewing || audienceEmailCount === 0} className="text-xs border border-ocean text-ocean px-3 py-1.5 disabled:opacity-50">{previewing ? t('Sayılıyor…', 'Counting…') : t('Lead listesini say', 'Count lead list')}</button>{audienceEmailCount > 0 && <span className="text-xs font-semibold text-green-700 dark:text-green-300">{audienceEmailCount} {t('benzersiz e-posta', 'unique emails')}</span>}</div>
                      <p className="text-[11px] text-amber-800 dark:text-amber-300">{t('CRM ve harici lead kaynakları şu an pasif. Bu liste kampanyaya yalnızca sen eklediğinde girer; backend yayınında izin, duplicate ve kaynak doğrulaması ayrıca yapılmalı.', 'CRM and external lead sources are currently inactive. This list enters a campaign only when you add it; backend release must also validate consent, duplicates and source.')}</p>
                    </div>}
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                  <div className={audienceType !== 'seafarers' ? 'hidden' : ''}>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2">{t('Profil segmentleri', 'Profile segments')}</p>
                    {BUCKETS.map(bucket => <Check key={bucket.id} checked={buckets.includes(bucket.id)} onChange={() => { toggle(buckets, bucket.id, setBuckets); clearAudiencePreview(); }} label={lang === 'tr' ? bucket.tr : bucket.en} />)}
                    {nonContiguousBuckets && <p role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t('Seçili segmentler bitişik değil. Şablonlu e-posta (arka plan gönderimi) tek bir doluluk aralığı kullandığı için bu seçimle gönderilemez; bitişik segmentler seçin veya ayrı kampanyalar oluşturun.', "The selected segments aren't contiguous. Templated (background) email dispatch uses a single completion range, so it can't be sent with this selection; choose adjacent segments or create separate campaigns.")}</p>}
                    <button type="button" onClick={previewAudience} disabled={previewing} className="mt-3 text-sm border border-ocean text-ocean px-3 py-2 rounded-lg disabled:opacity-50">{previewing ? t('Hesaplanıyor…', 'Calculating…') : t('Kitleyi hesapla', 'Calculate audience')}</button>
                    {audienceCount !== null && <p role="status" className="text-sm font-semibold text-green-600 mt-2">{audienceIsEstimate ? '≈ ' : ''}{audienceCount.toLocaleString(localeTag(lang))} {t(audienceIsEstimate ? 'tahmini hedef profil' : 'hedef profil', audienceIsEstimate ? 'estimated target profiles' : 'target profiles')}</p>}
                    {audienceDistribution && (
                      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 space-y-3">
                        <p className="text-[11px] text-slate-600">{t('Dağılımlar Crewin tarafından sunucuda toplu olarak hesaplanır; kullanıcı listesi tarayıcıya indirilmez.', 'Distributions are aggregated by Crewin on the server; user lists are not downloaded to the browser.')}</p>
                        <div><b>{t('Aktivite (son 30 gün)', 'Activity (last 30 days)')}:</b> {t('Aktif', 'Active')} {audienceDistribution.activity.active.toLocaleString(localeTag(lang))} · {t('Pasif', 'Inactive')} {audienceDistribution.activity.inactive.toLocaleString(localeTag(lang))} · {t('Bilinmiyor', 'Unknown')} {audienceDistribution.activity.unknown.toLocaleString(localeTag(lang))}</div>
                        <div><b>{t('Ulaşılabilir kanal', 'Reachable channel')}:</b> {t('E-posta', 'Email')} {audienceDistribution.channelReachability.email.toLocaleString(localeTag(lang))} · WhatsApp {audienceDistribution.channelReachability.whatsapp.toLocaleString(localeTag(lang))} · Telegram {audienceDistribution.channelReachability.telegram.toLocaleString(localeTag(lang))} · Push {audienceDistribution.channelReachability.push.toLocaleString(localeTag(lang))}</div>
                        {audienceDistribution.profileCompletion.length > 0 && <div><b>{t('Profil doluluğu', 'Profile completion')}:</b> {audienceDistribution.profileCompletion.map(item => `${item.name} ${item.count.toLocaleString(localeTag(lang))}`).join(' · ')}</div>}
                        {audienceDistribution.countries.length > 0 && <div><b>{t('Ülke', 'Country')}:</b> {audienceDistribution.countries.map(item => `${item.name} ${item.count.toLocaleString(localeTag(lang))}`).join(' · ')}</div>}
                        {audienceDistribution.nationalities.length > 0 && <div><b>{t('Uyruk', 'Nationality')}:</b> {audienceDistribution.nationalities.map(item => `${item.name} ${item.count.toLocaleString(localeTag(lang))}`).join(' · ')}</div>}
                        {audienceDistribution.positions.length > 0 && <div><b>{t('Pozisyon', 'Position')}:</b> {audienceDistribution.positions.map(item => `${item.name} ${item.count.toLocaleString(localeTag(lang))}`).join(' · ')}</div>}
                      </div>
                    )}
                  </div>
                  <div className="space-y-3">
                    <div><label htmlFor={`${fid}-countries`} className="text-xs text-slate-500 block mb-1">{t('Ülke kodları', 'Country codes')}</label><input id={`${fid}-countries`} value={countries} onChange={e => { setCountries(e.target.value); clearAudiencePreview(); }} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2" placeholder="TR, PH, IN" /></div>
                    <div><label htmlFor={`${fid}-nationalities`} className="text-xs text-slate-500 block mb-1">{t('Uyruklar', 'Nationalities')}</label><input id={`${fid}-nationalities`} value={nationalities} onChange={e => { setNationalities(e.target.value); clearAudiencePreview(); }} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2" placeholder={t('Türk, Filipinli', 'Turkish, Filipino')} /></div>
                    <div><label htmlFor={`${fid}-positions`} className="text-xs text-slate-500 block mb-1">{t('Pozisyonlar', 'Positions')}</label><input id={`${fid}-positions`} value={positions} onChange={e => { setPositions(e.target.value); clearAudiencePreview(); }} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2" placeholder={t('Kaptan, Baş Mühendis', 'Captain, Chief Engineer')} /></div>
                    <div className="grid sm:grid-cols-2 gap-3"><label className="text-xs text-slate-500">{t('Aktivite', 'Activity')}<select value={activity} onChange={e => { setActivity(e.target.value as CampaignAudience['activity']); clearAudiencePreview(); }} className="mt-1 w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm"><option value="all">{t('Tümü', 'All')}</option><option value="active">{t('Aktif', 'Active')}</option><option value="inactive">{t('Pasif', 'Inactive')}</option></select></label><div role="group" aria-labelledby={`${fid}-reachable`}><span id={`${fid}-reachable`} className="text-xs text-slate-500 block mb-1">{t('Ulaşılabilir kanal', 'Reachable channel')}</span><div className="grid grid-cols-2">{(['email', 'whatsapp', 'telegram', 'push'] as const).map(item => <Check key={item} checked={reachableChannels.includes(item)} onChange={() => { toggle(reachableChannels, item, setReachableChannels); clearAudiencePreview(); }} label={item === 'email' ? t('E-posta', 'Email') : item[0].toUpperCase() + item.slice(1)} />)}</div></div></div>
                    <div><label htmlFor={`${fid}-manual-emails`} className="text-xs text-slate-500 block mb-1">{audienceType === 'maritime_businesses' ? t('Kayıtlı şirket e-postaları', 'Registered company emails') : audienceType === 'company_prospects' ? t('Ek prospect e-postaları', 'Additional prospect emails') : t('Ek e-postalar', 'Additional emails')}</label><textarea id={`${fid}-manual-emails`} value={manualEmails} onChange={e => { setManualEmails(e.target.value); clearAudiencePreview(); }} rows={3} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2 text-sm" placeholder={audienceType === 'maritime_businesses' ? t('Crewinjob’a kayıtlı şirket e-postaları; her satıra bir tane', 'Registered Crewinjob company emails; one per line') : audienceType === 'company_prospects' ? t('CSV dışında eklemek istediğin lead e-postaları', 'Lead emails to add beyond the CSV') : t('Her satıra bir e-posta', 'One email per line')} /></div>
                  </div>
                  </div>
                </div>}

                {step === 3 && <div className="grid md:grid-cols-3 gap-6">
                  <div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2">{t('Organik sosyal', 'Organic social')}</p>{SOCIAL.map(item => <Check key={item} checked={social.includes(item)} onChange={() => toggle(social, item, setSocial)} label={item === 'twitter' ? 'X / Twitter' : item[0].toUpperCase() + item.slice(1)} />)}</div>
                  <div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2">{t('Doğrudan mesajlaşma', 'Direct messaging')}</p><Check checked={email} onChange={() => setEmail(!email)} label={t('E-posta', 'Email')} /><Check checked={whatsapp} onChange={() => setWhatsapp(!whatsapp)} label="WhatsApp" /><Check checked={telegram} onChange={() => setTelegram(!telegram)} label="Telegram" />{whatsapp && <textarea value={whatsappNumbers} onChange={e => setWhatsappNumbers(e.target.value)} rows={3} aria-label={t('İzinli telefonlar, her satıra bir tane', 'Opted-in phone numbers, one per line')} className="mt-2 w-full text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg p-2" placeholder={t('İzinli telefonlar, her satıra bir tane', 'Opted-in phone numbers, one per line')} />}{whatsapp && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{t('WhatsApp serbest metni yalnızca son 24 saatte size yazmış kişilere ulaşır; pazarlama için onaylı template gerekir.', 'WhatsApp free text only reaches people who messaged you in the last 24 hours; marketing requires approved templates.')}</p>}{telegram && <textarea value={telegramIds} onChange={e => setTelegramIds(e.target.value)} rows={3} aria-label={t('İzinli chat ID; boşsa varsayılan kanal', 'Opted-in chat IDs; blank uses default channel')} className="mt-2 w-full text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg p-2" placeholder={t('İzinli chat ID; boşsa varsayılan kanal', 'Opted-in chat IDs; blank uses default channel')} />}{(whatsapp || (telegram && splitLines(telegramIds).length > 0)) && <Check checked={consent} onChange={() => setConsent(!consent)} label={t('Alıcı iletişim izinleri doğrulandı', 'Recipient consent is verified')} />}</div>
                  <div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2">{t('Ücretli erişim', 'Paid reach')}</p>{PAID.map(item => <Check key={item} checked={paid.includes(item)} onChange={() => toggle(paid, item, setPaid)} label={item === 'meta' ? 'Meta Ads' : item === 'linkedin' ? 'LinkedIn Ads' : 'Google Ads'} />)}{paid.length > 0 && <div className="mt-3"><label htmlFor={`${fid}-daily-budget`} className="text-xs text-slate-500">{t('Platform başına günlük bütçe', 'Daily budget per platform')} (${dailyBudget})</label><input id={`${fid}-daily-budget`} type="range" min={5} max={500} value={dailyBudget} onChange={e => setDailyBudget(Number(e.target.value))} className="w-full accent-ocean" /></div>}<p className="text-xs text-slate-600 mt-3">{t('Bağlı olmayan reklam hesapları çalıştırmada atlanır; sahte sonuç üretilmez.', 'Unconnected ad accounts are skipped; no mock result is counted.')}</p></div>
                </div>}

                {step === 4 && <div className="grid md:grid-cols-2 gap-5">
                  <div className="space-y-3">
                    <div><label htmlFor={`${fid}-message`} className="text-xs text-slate-500 block mb-1">{t('Mesaj', 'Message')}</label><textarea id={`${fid}-message`} value={content} onChange={e => setContent(e.target.value)} rows={7} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2" placeholder={t('Her kanal için temel kampanya mesajı', 'Base campaign message for every channel')} /></div>
                    <div><label htmlFor={`${fid}-subject`} className="text-xs text-slate-500 block mb-1">{t('E-posta konusu', 'Email subject')}</label><input id={`${fid}-subject`} value={subject} onChange={e => setSubject(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2" /></div>
                    {email && <div><label htmlFor={`${fid}-template`} className="text-xs text-slate-500 block mb-1">{t('E-posta şablonu', 'Email template')}</label>{templateCatalogAvailable && templates.some(item => item.channel === 'email') ? <select id={`${fid}-template`} value={templateId} onChange={e => setTemplateId(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2"><option value="">{t('Şablon seçin', 'Select a template')}</option>{templates.filter(item => item.channel === 'email').map(item => <option key={item.id} value={item.id}>{item.name}{item.language ? ` (${item.language})` : ''}</option>)}</select> : <input id={`${fid}-template`} value={templateId} onChange={e => setTemplateId(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2" placeholder={t('Backend şablon kimliği', 'Backend template ID')} />}<p className="text-xs text-slate-600 mt-1">{templateCatalogAvailable ? t('Aktif backend şablonları listeleniyor.', 'Active backend templates are listed.') : t('Şablon kataloğu yayınlanana kadar kimliği elle girebilirsiniz.', 'Enter the ID manually until the template catalog is available.')}</p></div>}
                    {(['email', 'whatsapp', 'telegram'] as const).filter(channel => ({ email, whatsapp, telegram })[channel]).map(channel => { const options = integrations.filter(item => item.channel === channel); const configured = options.filter(item => item.isConfigured !== false); return <div key={channel}><label htmlFor={`${fid}-integration-${channel}`} className="text-xs text-slate-500 block mb-1">{channel === 'email' ? t('E-posta', 'Email') : channel === 'whatsapp' ? 'WhatsApp' : 'Telegram'} {t('entegrasyonu', 'integration')}</label>{integrationCatalogAvailable && options.length > 0 ? <><select id={`${fid}-integration-${channel}`} value={integrationIds[channel] || ''} onChange={e => setIntegrationIds(current => ({ ...current, [channel]: e.target.value }))} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2"><option value="">{configured.length ? t('Entegrasyon seçin', 'Select an integration') : t('Yapılandırılmış entegrasyon yok', 'No configured integration')}</option>{options.map(item => <option key={item.id} value={item.id} disabled={item.isConfigured === false}>{item.name}{item.provider ? ` (${item.provider})` : ''}{item.isConfigured === false ? t(' - test, göndermez', ' - test, no delivery') : ''}</option>)}</select>{configured.length === 0 && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{t('Backend test entegrasyonu hazır; gerçek gönderim sağlayıcı yapılandırması bekliyor.', 'Backend test integration is available; real delivery awaits provider configuration.')}</p>}</> : <input id={`${fid}-integration-${channel}`} value={integrationIds[channel] || ''} onChange={e => setIntegrationIds(current => ({ ...current, [channel]: e.target.value }))} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2" placeholder={t('Backend entegrasyon kimliği', 'Backend integration ID')} />}</div>; })}
                  </div>
                  <div className="space-y-3">{dispatchBucketBlocked && <p role="alert" className="border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 px-3 py-2 rounded-lg text-xs">{t('Şablonlu e-posta arka planda tek bir doluluk aralığıyla gönderilir; seçili segmentler bitişik değil. Kitle adımında bitişik segmentler seçin veya ayrı kampanyalar oluşturun.', 'Templated email is dispatched in the background with a single completion range; the selected segments are not contiguous. Choose adjacent segments in the Audience step or create separate campaigns.')}</p>}<div><label htmlFor={`${fid}-cta-url`} className="text-xs text-slate-500 block mb-1">{t('Hedef bağlantı', 'Destination URL')}</label><input id={`${fid}-cta-url`} value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2" /></div><div><label htmlFor={`${fid}-launch-at`} className="text-xs text-slate-500 block mb-1">{t('Yayın zamanı (boşsa hemen çalıştırmaya hazır)', 'Launch time (blank means ready to launch)')}</label><input id={`${fid}-launch-at`} type="datetime-local" value={launchAt} onChange={e => setLaunchAt(e.target.value)} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2" /></div>{email && channelCount === 1 && <div className="border border-cyan-200 dark:border-cyan-900 rounded-lg p-3"><Check checked={pilotMode} onChange={() => setPilotMode(value => !value)} label={t('Pilot gönderimi', 'Pilot delivery')} />{pilotMode && <div className="mt-2 pl-6"><label htmlFor={`${fid}-max-recipients`} className="text-xs text-slate-500 block mb-1">{t('Maksimum alıcı', 'Maximum recipients')}</label><input id={`${fid}-max-recipients`} type="number" min={1} max={500} value={pilotMaxRecipients} onChange={e => setPilotMaxRecipients(Math.min(500, Math.max(1, Number(e.target.value) || 1)))} className="w-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-white rounded-lg px-3 py-2" /><p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{t('Yalnız backend allowlist’indeki test adreslerine gönderilir.', 'Delivery is limited to backend allowlisted test addresses.')}</p></div>}</div>}<div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm text-slate-600 dark:text-slate-300"><p><b>{t('Kitle:', 'Audience:')}</b> {audienceCount ?? t('hesaplanmadı', 'not calculated')}</p><p><b>{t('Kanallar:', 'Channels:')}</b> {channelCount}</p><p><b>UTM:</b> {t('Her bağlantıya otomatik eklenecek', 'Automatically added to each URL')}</p></div></div>
                </div>}
              </div>
              <div className="flex justify-between px-5 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                <button onClick={() => step === 1 ? (setShowCreate(false), resetForm()) : setStep(step - 1)} className="text-sm px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-600 dark:text-slate-300">{step === 1 ? t('Kapat', 'Close') : t('Geri', 'Back')}</button>
                {step < 4 ? <button onClick={() => setStep(step + 1)} disabled={!canNext} className="text-sm px-5 py-2 bg-ocean text-white rounded-lg disabled:opacity-40">{t('Devam', 'Continue')}</button> : <button onClick={save} disabled={!canNext || busyId === 'create' || (editingId !== null && busyId === editingId)} className="text-sm px-5 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg disabled:opacity-40">{busyId === 'create' || (editingId !== null && busyId === editingId) ? t('Kaydediliyor…', 'Saving…') : editingId ? t('Değişiklikleri kaydet', 'Save changes') : launchAt ? t('Zamanla', 'Schedule') : t('Kampanyayı hazırla', 'Prepare campaign')}</button>}
              </div>
            </section>
          )}

          {loading ? <div className="py-12 text-center text-sm text-slate-600">{t('Kampanyalar yükleniyor…', 'Loading campaigns…')}</div> : campaigns.length === 0 && !showCreate ? <div className="py-12 text-center border-y border-slate-200 dark:border-slate-700"><p className="font-semibold text-slate-700 dark:text-slate-200">{t('Henüz birleşik kampanya yok.', 'No unified campaigns yet.')}</p><p className="text-sm text-slate-600 mt-1">{t('İlk kampanyada mevcut sosyal ve mesajlaşma kanallarınızı birlikte kullanabilirsiniz.', 'Use your existing social and messaging channels together in the first campaign.')}</p></div> : (
            <div className="divide-y divide-slate-200 dark:divide-slate-700 border-y border-slate-200 dark:border-slate-700">
              {campaigns.map(campaign => {
                const ok = campaign.deliveries.filter(item => item.status === 'succeeded').length;
                // Yalnız backend'de olan kampanya: sunucu PATCH/launch/delete için 409 döner → aksiyonlar kapalı
                const remoteOnly = isRemoteOnly(campaign);
                const remoteOnlyTitle = t('Bu kampanya yalnızca backend\'de kayıtlı; backend yönetiminden yönetin.', 'This campaign exists only in the backend; manage it there.');
                return <div key={campaign.id} className="py-4">
                  <div className="flex items-center gap-4 flex-wrap">
                    <button type="button" aria-expanded={selected === campaign.id} onClick={() => setSelected(selected === campaign.id ? null : campaign.id)} className="text-left flex-1 min-w-[240px]"><div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-slate-800 dark:text-slate-100">{campaign.name}</span><span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[campaign.status]}`}>{statusLabel(campaign.status, lang)}</span>{remoteOnly && <span title={remoteOnlyTitle} className="text-[11px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">{t('Yalnız backend', 'Backend only')}</span>}</div><p className="text-xs text-slate-600 mt-1">{objectiveLabel(campaign.objective, lang)} · {campaign.deliveries.length} {t('kanal', 'channels')} · {ok}/{campaign.deliveries.length} {t('başarılı', 'successful')}{campaign.launchAt ? ` · ${new Date(campaign.launchAt).toLocaleString(localeTag(lang))}` : ''}</p></button>
                    {['ready', 'partial', 'failed'].includes(campaign.status) && <button onClick={() => launch(campaign.id)} disabled={busyId === campaign.id || remoteOnly} title={remoteOnly ? remoteOnlyTitle : undefined} className="text-sm bg-green-600 text-white font-semibold px-3 py-2 rounded-lg disabled:opacity-50">{busyId === campaign.id ? t('Çalışıyor…', 'Running…') : campaign.status === 'ready' ? t('Şimdi başlat', 'Launch now') : t('Başarısızları yeniden dene', 'Retry failed')}</button>}
                    {['running', 'ready', 'scheduled', 'partial', 'failed'].includes(campaign.status) && <button onClick={() => cancel(campaign.id)} disabled={busyId === campaign.id || remoteOnly} title={remoteOnly ? remoteOnlyTitle : undefined} className="text-sm border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 px-3 py-2 rounded-lg disabled:opacity-50">{campaign.status === 'running' ? t('Durdur', 'Stop') : t('İptal', 'Cancel')}</button>}
                    <button onClick={() => editCampaign(campaign)} disabled={busyId !== null || remoteOnly || ['running', 'completed'].includes(campaign.status)} title={remoteOnly ? remoteOnlyTitle : campaign.status === 'running' ? t('Önce devam eden gönderimi durdurun.', 'Stop the active delivery first.') : campaign.status === 'completed' ? t('Tamamlanan kampanya düzenlenemez.', "Completed campaigns can't be edited.") : undefined} className="text-sm border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 px-3 py-2 rounded-lg disabled:cursor-not-allowed disabled:opacity-40">{t('Düzenle', 'Edit')}</button>
                    <button onClick={() => void remove(campaign.id)} disabled={busyId !== null || remoteOnly || campaign.status === 'running'} title={remoteOnly ? remoteOnlyTitle : campaign.status === 'running' ? t('Önce devam eden gönderimi durdurun.', 'Stop the active delivery first.') : undefined} className="text-sm border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 px-3 py-2 rounded-lg disabled:cursor-not-allowed disabled:opacity-40">{busyId === `delete:${campaign.id}` ? t('Siliniyor…', 'Deleting…') : t('Sil', 'Delete')}</button>
                  </div>
                  {campaign.status === 'running' && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t('Gönderim devam ediyor. Düzenlemek veya silmek için önce kampanyayı durdurun.', 'Delivery is in progress. Stop the campaign before editing or deleting it.')}</p>}
                  {selectedCampaign?.id === campaign.id && <div className="mt-4 space-y-4">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        [t('Hedef', 'Goal'), objectiveLabel(campaign.objective, lang)],
                        [t('Kitle', 'Audience'), campaign.audience.audienceType === 'company_prospects' ? t('Yeni prospectler', 'New prospects') : campaign.audience.audienceType === 'maritime_businesses' ? t('Kayıtlı şirketler', 'Registered companies') : t('Gemi adamları', 'Seafarers')],
                        [t('Kanal', 'Channel'), campaign.deliveries.map(item => item.channel).join(', ') || t('Tanımsız', 'Not set')],
                        [t('Oluşturulma', 'Created'), new Date(campaign.createdAt).toLocaleDateString(localeTag(lang))],
                      ].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-800"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</p></div>)}
                    </div>
                    {campaign.content && <section className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40">
                      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                        <div>
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('Mesaj ve e-posta önizlemesi', 'Message and email preview')}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('Alıcının göreceği görünümü burada kontrol et.', 'Review what the recipient will see here.')}</p>
                        </div>
                        {campaign.maxRecipients && <span className="shrink-0 rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300">{t(`Pilot · ${campaign.maxRecipients} alıcı`, `Pilot · ${campaign.maxRecipients} recipients`)}</span>}
                      </div>
                      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
                        <EmailPreview body={selectedTemplate?.content || campaign.content.html || campaign.content.text} subject={selectedTemplate?.subject || campaign.content.subject || campaign.name} lang={lang} />
                        <div className="space-y-3">
                          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{t('Konu', 'Subject')}</p>
                            <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">{selectedTemplate?.subject || campaign.content.subject || campaign.name}</p>
                          </div>
                          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">{t('Şablon ve bağlantı', 'Template and link')}</p>
                            <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{selectedTemplate?.name || campaign.content.templateId || t('Özel içerik', 'Custom content')}</p>
                            {campaign.content.ctaUrl && <p className="mt-2 break-all text-xs text-cyan-700 dark:text-cyan-300">{campaign.content.ctaUrl}</p>}
                          </div>
                          <details className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                            <summary className="cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300">{t('Teknik içeriği göster', 'Show technical content')}</summary>
                            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{selectedTemplate?.content || campaign.content.html || campaign.content.text}</pre>
                          </details>
                        </div>
                      </div>
                    </section>}
                    {campaign.dispatch && <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                      <div className="flex items-center justify-between gap-3">
                        <div><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t('Gönderim durumu', 'Delivery status')}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('Kampanyanın arka plandaki ilerlemesi.', 'Background progress for this campaign.')}</p></div>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{runStatusLabel(campaign.dispatch.status, lang)}</span>
                      </div>
                      <div className="mt-4 flex items-center gap-3"><div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-2 rounded-full bg-cyan-500 transition-all" style={{ width: `${Math.min(100, Math.max(0, campaign.dispatch.progressPercent || 0))}%` }} /></div><span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{percentText(Math.round(campaign.dispatch.progressPercent || 0), lang)}</span></div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-5 xl:grid-cols-10">{[[t('Toplam', 'Total'), campaign.dispatch.totalRecipients ?? campaign.dispatch.estimatedRecipients], [t('Kuyruk', 'Queued'), campaign.dispatch.queued], [t('İşleniyor', 'Processing'), campaign.dispatch.processing], [t('Gönderildi', 'Sent'), campaign.dispatch.sent], [t('Teslim', 'Delivered'), campaign.dispatch.delivered], [t('Açıldı', 'Opened'), campaign.dispatch.opened], [t('Tıklandı', 'Clicked'), campaign.dispatch.clicked], [t('İşlenen', 'Processed'), campaign.dispatch.processed], [t('Başarısız', 'Failed'), campaign.dispatch.failed], [t('Atlandı', 'Skipped'), campaign.dispatch.skipped]].map(([label, value]) => <div key={String(label)}><span className="block text-slate-600">{label}</span><b className="mt-1 block text-slate-800 dark:text-slate-100">{typeof value === 'number' ? value.toLocaleString(localeTag(lang)) : value ?? '–'}</b></div>)}</div>
                      {campaign.dispatch.lastError && <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-400"><Msg text={campaign.dispatch.lastError} /></p>}
                    </section>}
                    <div className="border-y border-slate-200 dark:border-slate-700 py-3">
                      <div className="flex items-center gap-2 mb-3"><span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t('Kampanya dönüşümü', 'Campaign conversion')}</span>{conversionLoading && <span className="text-xs text-slate-600">{t('Yükleniyor…', 'Loading…')}</span>}</div>
                      {reportPilotDispatchId && <p className="text-[11px] text-slate-600 mb-2">{t('Pilot gönderim: rapor pilot kimliği, backend kampanya kimliği ve dispatch kimliğiyle sorgulanır.', 'Pilot delivery: the report is queried by the pilot id, backend campaign id and dispatch id.')}</p>}
                      {!conversionLoading && !reportAvailable && (conversion?.reason === 'backend_not_ready' || delivery?.reason === 'backend_not_ready') && <p className="text-xs text-amber-600 dark:text-amber-400">{t('Dönüşüm ve teslim raporu backend yayını bekliyor.', 'Conversion and delivery reports are waiting for the backend release.')}</p>}
                      {!conversionLoading && !reportAvailable && (conversion?.reason === 'permission_denied' || delivery?.reason === 'permission_denied') && <p className="text-xs text-amber-600 dark:text-amber-400">{t('Bu raporu görüntülemek için yetki gerekiyor.', 'Permission is required to view this report.')}</p>}
                      {!conversionLoading && !reportAvailable && (conversion?.reason === 'backend_error' || delivery?.reason === 'backend_error') && <p role="alert" className="text-xs text-red-600 dark:text-red-400"><Msg text={conversion?.error || delivery?.error || t('Kampanya raporu alınamadı.', "Couldn't load the campaign report.")} /></p>}
                      {reportAvailable && <><div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-3 text-xs">{reportMetrics.map(([label, value]) => <div key={label}><span className="text-slate-600 block">{label}</span><b>{value === undefined ? '–' : value.toLocaleString(localeTag(lang))}</b></div>)}</div><div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 text-xs mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">{reportRates.map(([label, value]) => <div key={label}><span className="text-slate-600 block">{label}</span><b>{value === undefined ? '–' : percentText(value, lang, 1)}</b></div>)}</div></>}
                      {reportAvailable && (conversion?.result?.dataNote || delivery?.result?.dataNote) && <div className="text-xs text-slate-600 mt-3 space-y-1">{conversion?.result?.dataNote && <p><Msg text={conversion.result.dataNote} /></p>}{delivery?.result?.dataNote && delivery.result.dataNote !== conversion?.result?.dataNote && <p><Msg text={delivery.result.dataNote} /></p>}</div>}
                    </div>
                    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-600"><th className="pb-2">{t('Kanal', 'Channel')}</th><th className="pb-2">{t('Durum', 'Status')}</th><th className="pb-2">{t('Gönderilen', 'Sent')}</th><th className="pb-2">{t('Deneme', 'Attempts')}</th><th className="pb-2">{t('Sonuç', 'Result')}</th></tr></thead><tbody>{campaign.deliveries.map(delivery => <tr key={delivery.id} className="border-t border-slate-100 dark:border-slate-800"><td className="py-2 font-medium text-slate-700 dark:text-slate-200">{delivery.channel}</td><td className="py-2 text-slate-500">{runStatusLabel(delivery.status, lang)}</td><td className="py-2 text-slate-500">{delivery.sentCount ?? '-'}</td><td className="py-2 text-slate-500">{delivery.attempts}</td><td className="py-2 text-xs text-slate-500 max-w-sm truncate" title={delivery.error}>{delivery.error ? <Msg text={delivery.error} /> : delivery.url || delivery.externalId || '-'}</td></tr>)}</tbody></table></div>
                  </div>}
                </div>;
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
