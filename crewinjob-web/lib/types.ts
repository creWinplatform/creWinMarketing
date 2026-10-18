// ─── Shared TypeScript types for crewinjob Marketing Agent ───────────────────
// Import from here in route handlers and components to keep types in sync.

// ── Fill-rate buckets ─────────────────────────────────────────────────────────
export interface FillRateBuckets {
  zero: number;   // %0 — profili hiç doldurmamış
  low:  number;   // %1–49
  mid:  number;   // %50–79
  high: number;   // %80+ — Activated Seafarer
}

// ── Seafarer istatistikleri ───────────────────────────────────────────────────
export interface SeafarerStats {
  total:              number;
  newToday?:          number;
  newThisWeek:        number;
  newThisMonth?:      number;
  /** Ağırlıklı ORTALAMA profil doluluk yüzdesi — "profili tamamlanmış kullanıcı oranı" değildir. */
  profileCompletion:  number;
  /** true ise GrowthAnalytics kesin ortalaması, false ise bucket midpoint tahminidir. */
  profileCompletionIsExact?: boolean;
  /** Activated olmayan kullanıcı sayısı. Geriye uyumlu alan. */
  incompleteProfiles: number;
  /** @deprecated activatedSeafarers kullanın. */
  readyToHire?:       number;
  /** Pazarlama KPI tanımı: profil doluluğu %80 ve üzeri kullanıcı. */
  activatedSeafarers?: number;
  /** activatedSeafarers / total * 100. */
  activationRate?:     number;
  /** Profil doluluğu tam %100 olan kullanıcı sayısı; null ise endpoint desteklemiyordur. */
  completeProfiles?:   number | null;
  /** Profil doluluğu %80'in altında kalan kullanıcılar. */
  profilesBelow80?:    number;
  activeLastMonth?:   number;
  retentionRate?:     number;
  byNationality?:     Record<string, number>;
  byRank?:            Record<string, number>;
  dailyRegistrations?: number[];
  fillRateBuckets?:   FillRateBuckets;
  source:             'api' | 'mock';
}

// ── İlan / Firma istatistikleri ───────────────────────────────────────────────
export interface JobStats {
  total:                  number;
  active:                 number;
  /** null = API'de haftalık ilan endpoint'i yok. 0 ile karıştırma — UI "–" göstermeli. */
  newThisWeek:            number | null;
  totalApps?:             number;
  appsThisWeek?:          number;
  avgAppsPerJob?:         number;
  companies?:             number;
  newCompaniesThisWeek?:  number;
  crewManagements?:       number;
  source?:                'api' | 'mock';
}

// ── Eksik profil segmenti ─────────────────────────────────────────────────────
export interface IncompleteSegment {
  missingField:    string;
  count:           number;
  label?:          string;
  lastActiveDays?: number | null;
}

export interface IncompleteProfiles {
  total:    number;
  segments: IncompleteSegment[];
  source?:  'api' | 'mock';
}

// ── Kayıt kaynakları ──────────────────────────────────────────────────────────
export interface RegistrationSources {
  channels: Record<string, number>;
  weekly?:  { week: string; [key: string]: string | number }[];
  source?:  'api' | 'mock';
}

// ── fetchAllData dönüş tipi ───────────────────────────────────────────────────
export interface AllData {
  seafarers:  SeafarerStats;
  jobs:       JobStats;
  incomplete: IncompleteProfiles;
  sources:    RegistrationSources;
  fetchedAt:  string;
  /** En az bir backend çağrısı başarılıysa true. */
  isRealData: boolean;
  /** Bazı çağrılar başarısız → sayılar eksik olabilir. */
  partial?:   boolean;
  /** Kısa hata metinleri ("Endpoint → HTTP 500"); token/yanıt gövdesi içermez. */
  apiErrors?: string[];
  /** Geriye dönük uyumluluk — generator.js tarafından kullanılır */
  stats: {
    seafarers:  string;
    jobs:       string;
    businesses: string;
  };
  newJobs: unknown[];
}

// ── Stats API response (page.tsx) ─────────────────────────────────────────────
export interface StatsResponse {
  seafarers?:  SeafarerStats;
  jobs?:       JobStats;
  incomplete?: IncompleteProfiles;
  isRealData?: boolean;
  /** true → bazı backend çağrıları başarısız (kısmi veri). */
  partial?:    boolean;
  /** Başarısız çağrıların kısa açıklamaları (yalnızca string). */
  apiErrors?:  string[];
  fetchedAt?:  string;
  error?:      string;
}

// ── Breakdown (ülke / pozisyon) ───────────────────────────────────────────────
export interface BreakdownItem {
  id:     number;
  name:   string;
  code?:  string;
  count:  number;
}

export interface BreakdownData {
  countries:  BreakdownItem[];
  positions:  BreakdownItem[];
  source:     'api' | 'mock';
  fetchedAt:  string;
  error?:     string;
}

// ── Son kayıt olan firma ──────────────────────────────────────────────────────
export interface CompanyItem {
  id:           number;
  name:         string;
  country:      string;
  countryCode:  string;
  registeredAt: string | null;
  type:         string;
  crewCount:    number;
}

export interface CompaniesResponse {
  companies: CompanyItem[];
  source:    'api' | 'mock';
  fetchedAt: string;
  error?:    string;
}

// ── Generate API request ──────────────────────────────────────────────────────
export type GenerateType =
  | 'social'
  | 'blog'
  | 'registration'
  | 'tiktok_cta'
  | 'retention'
  | 'seo_job'
  | 'kpi'
  | 'facebook_ads'
  | 'google_ads'
  | 'instagram_ads'
  | 'linkedin_ads'
  | 'keyword_research'
  | 'competitor_analysis'
  | 'click_to_whatsapp'
  | 'telegram_channel'
  | 'telegram_bot';

export interface GenerateRequest {
  type:       GenerateType;
  textModel?: string;
  language?:  'tr' | 'en';
  [key: string]: unknown;
}

export interface GenerateResponse {
  content?: string;
  error?:   string;
}
