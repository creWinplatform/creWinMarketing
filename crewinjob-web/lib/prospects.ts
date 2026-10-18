export type ProspectLeadSource = 'ai_research' | 'csv' | 'json_import' | 'meeting' | 'manual';
export type ProspectLeadStatus = 'new' | 'review' | 'approved' | 'contacted' | 'registered' | 'job_posted' | 'cv_unlocked' | 'rejected';
export type ProspectConsentStatus = 'unknown' | 'confirmed' | 'restricted';

export interface ProspectLead {
  id: string;
  companyName: string;
  email: string;
  country?: string;
  companyType?: string;
  website?: string;
  sourceUrl?: string;
  source: ProspectLeadSource;
  status: ProspectLeadStatus;
  consentStatus: ProspectConsentStatus;
  fitScore?: number;
  intentScore?: number;
  selectionReason?: string;
  intentReason?: string;
  researchSignals?: string[];
  sourceTitle?: string;
  contactName?: string;
  contactRole?: string;
  notes?: string;
  companyId?: string;
  isRegisteredCompany?: boolean;
  isSuppressed?: boolean;
  suppressionReason?: string;
  emailValid?: boolean;
  emailDeliverable?: boolean;
  emailVerificationReason?: string;
  emailCheckedAt?: string;
  researchSourceCount?: number;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProspectResearchRequest {
  companyTypes: string[];
  countries: string[];
  signals: string[];
  maxResults: number;
  language: 'tr' | 'en';
}
