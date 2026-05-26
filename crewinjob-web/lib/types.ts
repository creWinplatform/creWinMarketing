// ─── Shared TypeScript types for crewinjob Marketing Agent ───────────────────
// Import from here in route handlers and components to keep types in sync.

// ── Fill-rate buckets ─────────────────────────────────────────────────────────
export interface FillRateBuckets {
  zero: number;   // %0 — profili hiç doldurmamış
  low:  number;   // %0–30
  mid:  number;   // %30–60
  high: number;   // %60+
}

// ── Seafarer istatistikleri ───────────────────────────────────────────────────
export interface SeafarerStats {
  total:              number;
  newToday?:          number;
  newThisWeek:        number;
  newThisMonth?:      number;
  profileCompletion:  number;
  incompleteProfiles: number;
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
  newThisWeek:            number;
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
  isRealData: boolean;
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
