// ── Shared types for the Ads Campaign Manager ────────────────────────────────

export type AdPlatform = 'meta' | 'linkedin' | 'google';

// ── Platform configuration status ────────────────────────────────────────────
export interface AdPlatformStatus {
  platform:    AdPlatform;
  configured:  boolean;   // env vars present
  accountId:   string | null;
  label:       string;
  icon:        string;
}

// ── Normalized campaign (maps all platforms to one shape) ─────────────────────
export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED' | 'DRAFT' | 'COMPLETED' | 'UNKNOWN';

export interface AdCampaign {
  id:           string;
  platform:     AdPlatform;
  name:         string;
  status:       CampaignStatus;
  objective:    string;
  budgetDaily:  number | null;   // USD cents → UI converts to $
  budgetTotal:  number | null;
  currency:     string;
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
  budgetDaily:  number;     // USD
  budgetTotal?: number;     // USD (optional)
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
  platform:  AdPlatform;
  campaigns: AdCampaign[];
  source:    'api' | 'mock';
  error?:    string;
}

export interface CreateCampaignResponse {
  platform:   AdPlatform;
  campaignId: string;
  success:    boolean;
  error?:     string;
}

// ── Meta-specific enums ───────────────────────────────────────────────────────
export const META_OBJECTIVES = [
  { value: 'OUTCOME_LEADS',          label: '🎯 Lead Generation' },
  { value: 'OUTCOME_TRAFFIC',        label: '🌐 Traffic' },
  { value: 'OUTCOME_SALES',          label: '💰 Sales / Conversions' },
  { value: 'OUTCOME_ENGAGEMENT',     label: '❤️ Engagement' },
  { value: 'OUTCOME_AWARENESS',      label: '👁️ Brand Awareness' },
  { value: 'OUTCOME_APP_PROMOTION',  label: '📱 App Promotion' },
];

// ── LinkedIn-specific enums ───────────────────────────────────────────────────
export const LINKEDIN_OBJECTIVES = [
  { value: 'LEAD_GENERATION',    label: '📋 Lead Generation' },
  { value: 'WEBSITE_VISITS',     label: '🌐 Website Visits' },
  { value: 'BRAND_AWARENESS',    label: '👁️ Brand Awareness' },
  { value: 'ENGAGEMENT',         label: '❤️ Engagement' },
  { value: 'VIDEO_VIEWS',        label: '▶️ Video Views' },
  { value: 'WEBSITE_CONVERSIONS',label: '💰 Website Conversions' },
];

// ── Google Ads campaign types ─────────────────────────────────────────────────
export const GOOGLE_CAMPAIGN_TYPES = [
  { value: 'SEARCH',           label: '🔍 Search' },
  { value: 'DISPLAY',          label: '🖼️ Display' },
  { value: 'VIDEO',            label: '▶️ YouTube / Video' },
  { value: 'PERFORMANCE_MAX',  label: '⚡ Performance Max' },
  { value: 'SMART',            label: '🤖 Smart Campaign' },
];
