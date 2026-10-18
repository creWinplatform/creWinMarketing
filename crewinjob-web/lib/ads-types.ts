// ── Shared types for the Ads Campaign Manager ────────────────────────────────

export type AdPlatform = 'meta' | 'linkedin' | 'google';

// ── Platform configuration status ────────────────────────────────────────────
export interface AdPlatformStatus {
  platform:    AdPlatform;
  configured:  boolean;   // env vars present
  accountId:   string | null;
  label:       string;
  icon:        string;
  missingEnv?: string[];  // eksik env değişkeni ADLARI (değer değil)
  currency?:   string;    // varsayılan para birimi (ADS_CURRENCY || USD)
}

// ── Normalized campaign (maps all platforms to one shape) ─────────────────────
export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED' | 'DRAFT' | 'COMPLETED' | 'UNKNOWN';

export interface AdCampaign {
  id:           string;
  platform:     AdPlatform;
  name:         string;
  status:       CampaignStatus;
  objective:    string;
  budgetDaily:  number | null;   // hesap para biriminde, ana birim (route'lar cent/micros'u çevirir)
  budgetTotal:  number | null;
  currency:     string;          // hesap para birimi (API'den; yoksa ADS_CURRENCY || USD)
  startDate:    string | null;   // ISO date
  endDate:      string | null;
  createdAt:    string | null;
  insights?:    AdInsights;
}

// ── Performance metrics ───────────────────────────────────────────────────────
export interface AdInsights {
  impressions:   number;
  clicks:        number;
  spend:         number;   // actual spend in currency units (not cents)
  ctr:           number;   // click-through rate 0–100
  cpc:           number;   // cost per click
  conversions:   number;
  cpm:           number;   // cost per 1000 impressions
  dateStart?:    string;
  dateStop?:     string;
}

// ── Budget allocation across platforms ───────────────────────────────────────
export interface BudgetAllocation {
  totalMonthlyUSD: number;
  platforms: {
    meta:     number;   // percentage 0–100
    linkedin: number;
    google:   number;
  };
}

// ── Campaign create request (normalized input) ────────────────────────────────
export interface CreateCampaignRequest {
  platform:     AdPlatform;
  name:         string;
  objective:    string;
  budgetDaily:  number;     // hesap para biriminde (ana birim)
  budgetTotal?: number;     // hesap para biriminde (optional)
  startDate:    string;     // YYYY-MM-DD
  endDate?:     string;
  targeting?: {
    countries?: string[];
    ageMin?:    number;
    ageMax?:    number;
    interests?: string[];
  };
}

// ── API route response wrappers ───────────────────────────────────────────────
export interface CampaignsResponse {
  platform:    AdPlatform;
  campaigns:   AdCampaign[];
  source:      'api' | 'mock';
  mock?:       boolean;    // true → platform yapılandırılmamış, kampanyalar demo verisi
  configured?: boolean;
  currency?:   string;     // hesap para birimi (biliniyorsa)
  error?:      string;
}

export interface CreateCampaignResponse {
  platform:    AdPlatform;
  campaignId:  string;
  success:     boolean;
  configured?: boolean;
  status?:     CampaignStatus;   // oluşturulan kampanyanın ilk durumu (PAUSED / DRAFT)
  error?:      string;
}

// ── Meta-specific enums ───────────────────────────────────────────────────────
// Yalnızca panelin uçtan uca oluşturabildiği hedefler. Satış (pixel) ve uygulama (app id)
// hedefleri ek kurulum gerektirdiğinden Ads Manager'dan oluşturulmalı.
export const META_OBJECTIVES = [
  { value: 'OUTCOME_LEADS',          label: '🎯 Lead Generation' },
  { value: 'OUTCOME_TRAFFIC',        label: '🌐 Traffic' },
  { value: 'OUTCOME_ENGAGEMENT',     label: '❤️ Engagement' },
  { value: 'OUTCOME_AWARENESS',      label: '👁️ Brand Awareness' },
];

// ── LinkedIn-specific enums ───────────────────────────────────────────────────
// Değerler LinkedIn objectiveType enum'u ile birebir (tekil: WEBSITE_VISIT, VIDEO_VIEW, WEBSITE_CONVERSION)
export const LINKEDIN_OBJECTIVES = [
  { value: 'LEAD_GENERATION',    label: '📋 Lead Generation' },
  { value: 'WEBSITE_VISIT',      label: '🌐 Website Visits' },
  { value: 'BRAND_AWARENESS',    label: '👁️ Brand Awareness' },
  { value: 'ENGAGEMENT',         label: '❤️ Engagement' },
  { value: 'VIDEO_VIEW',         label: '▶️ Video Views' },
  { value: 'WEBSITE_CONVERSION', label: '💰 Website Conversions' },
];

// ── Google Ads campaign types ─────────────────────────────────────────────────
// API ile yalnızca Search ve Display kampanyası tek adımda oluşturulabilir
// (Video/PMax/Smart asset group, video veya ek ayar ister → Google Ads arayüzünden).
export const GOOGLE_CAMPAIGN_TYPES = [
  { value: 'SEARCH',           label: '🔍 Search' },
  { value: 'DISPLAY',          label: '🖼️ Display' },
];
