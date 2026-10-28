import type { WorkspacePermission } from './access';
export type Locale = 'tr' | 'en';
export type LocalizedText = Record<Locale, string>;
export type ModuleScope = 'shared' | 'crewin';
export type ModuleDefinition = {
  id: string;
  label: LocalizedText;
  icon: string;
  scope: ModuleScope;
  group: 'overview' | 'marketing' | 'audience' | 'operations' | 'measurement' | 'settings';
};

// IDs preserve the existing tab and route contracts.
export const MODULES = [
  { id: 'dashboard', label: { tr: 'Genel bakış', en: 'Overview' }, icon: '📈', scope: 'shared', group: 'overview' },
  { id: 'social', label: { tr: 'Sosyal medya', en: 'Social media' }, icon: '📱', scope: 'shared', group: 'marketing' },
  { id: 'mobile', label: { tr: 'Mobil büyüme', en: 'Mobile growth' }, icon: 'mobile', scope: 'shared', group: 'marketing' },
  { id: 'library', label: { tr: 'İçerik kütüphanesi', en: 'Content library' }, icon: '🗂️', scope: 'shared', group: 'marketing' },
  { id: 'growth', label: { tr: 'Gemi adamı büyümesi', en: 'Seafarer growth' }, icon: '👥', scope: 'crewin', group: 'audience' },
  { id: 'retention', label: { tr: 'Elde tutma', en: 'Retention' }, icon: '🔄', scope: 'crewin', group: 'audience' },
  { id: 'seo', label: { tr: 'SEO & Blog', en: 'SEO & Blog' }, icon: '🔍', scope: 'shared', group: 'marketing' },
  { id: 'ads', label: { tr: 'Reklam içeriği', en: 'Ad content' }, icon: '✍️', scope: 'shared', group: 'marketing' },
  { id: 'campaigns', label: { tr: 'Kampanyalar', en: 'Campaigns' }, icon: '📣', scope: 'shared', group: 'marketing' },
  { id: 'messaging', label: { tr: 'WA & Telegram', en: 'WA & Telegram' }, icon: '💬', scope: 'shared', group: 'marketing' },
  { id: 'telegrambot', label: { tr: 'Telegram botu', en: 'Telegram bot' }, icon: '🤖', scope: 'crewin', group: 'operations' },
  { id: 'jobbot', label: { tr: 'İlan botu', en: 'Job bot' }, icon: '📋', scope: 'crewin', group: 'operations' },
  { id: 'pipeline', label: { tr: 'Otomasyon', en: 'Automation' }, icon: '⚙️', scope: 'crewin', group: 'operations' },
  { id: 'analytics', label: { tr: 'Analitik', en: 'Analytics' }, icon: '📊', scope: 'shared', group: 'measurement' },
  { id: 'kpi', label: { tr: 'KPI & raporlar', en: 'KPI & reports' }, icon: '📉', scope: 'crewin', group: 'measurement' },
  { id: 'calendar', label: { tr: 'Takvim', en: 'Calendar' }, icon: '📅', scope: 'shared', group: 'operations' },
  { id: 'firma_kredi', label: { tr: 'Kredi & ödeme', en: 'Credits & payments' }, icon: '💳', scope: 'crewin', group: 'operations' },
  { id: 'project', label: { tr: 'Proje ayarları', en: 'Project settings' }, icon: '⚙️', scope: 'shared', group: 'settings' },
] as const satisfies readonly ModuleDefinition[];

export type ModuleId = typeof MODULES[number]['id'];
export type ProductPack = 'crewin' | 'standard';

export function modulesForProject(pack: ProductPack, enabledIds: readonly string[]): ModuleDefinition[] {
  return MODULES.filter(module => enabledIds.includes(module.id) && (module.scope === 'shared' || pack === 'crewin'));
}

export type GoalDefinition = {
  id: string;
  label: LocalizedText;
  audience: LocalizedText;
  stages: LocalizedText[];
};
export type ProjectProfile = {
  id: string;
  organizationId: string;
  name: string;
  website: string;
  timezone: string;
  productPack: ProductPack;
  enabledModules: ModuleId[];
  goals: GoalDefinition[];
  language?: Locale;
  brandVoice?: string;
};
export type WorkspaceContext = {
  organization: { id: string; name: string };
  project: ProjectProfile;
  modules: ModuleDefinition[];
  accessMode: 'legacy_single_account' | 'platform_account';
  permissions?: WorkspacePermission[];
  plan?: {id:'pilot'|'trial'|'paid';active:boolean;endsAt:string|null;inGrace?:boolean};
};

export const CREWIN_PROJECT: ProjectProfile = {
  id: 'crewinjob', organizationId: 'crewin', name: 'CrewinJob',
  website: 'https://www.crewinjob.com', timezone: 'Europe/Istanbul', productPack: 'crewin',
  enabledModules: MODULES.filter(module=>module.id!=='mobile').map(module => module.id),
  goals: [
    { id: 'seafarer_activation', label: { tr: 'Denizci aktivasyonu', en: 'Seafarer activation' }, audience: { tr: 'Gemi adamları', en: 'Seafarers' }, stages: [
      { tr: 'Kayıt', en: 'Registration' }, { tr: 'Profil tamamlama', en: 'Profile completion' }, { tr: 'İlana başvuru', en: 'Job application' },
    ] },
    { id: 'business_revenue', label: { tr: 'CV unlock geliri', en: 'CV unlock revenue' }, audience: { tr: 'Maritime business', en: 'Maritime business' }, stages: [
      { tr: 'Şirket kaydı', en: 'Company registration' }, { tr: 'Ücretsiz ilan / Bullseye', en: 'Free job post / Bullseye' }, { tr: 'Aday inceleme', en: 'Candidate review' }, { tr: 'CV unlock', en: 'CV unlock' },
    ] },
  ],
};

export function legacyWorkspace(): WorkspaceContext {
  const project = structuredClone(CREWIN_PROJECT);
  return { organization: { id: 'crewin', name: 'Crewin' }, project,
    modules: modulesForProject(project.productPack, project.enabledModules), accessMode: 'legacy_single_account' };
}

// SaaS IDs are not ABP tenant IDs. Namespace persisted data/cache/jobs with this scope.
export function projectScopeKey(organizationId: string, projectId: string, resource: string): string {
  if (![organizationId, projectId, resource].every(value => typeof value === 'string' && value.trim().length > 0)) {
    throw new Error('Organization, project and resource are required.');
  }
  return JSON.stringify([organizationId, projectId, resource]);
}
