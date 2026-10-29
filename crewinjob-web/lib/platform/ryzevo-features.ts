import type { ProductPack } from './catalog';
// Which Ryzevo features a project pack may use. Standard projects get all of them. The Crewin workspace keeps its own
// tools wherever it has one (campaigns, content library, calendar, prospects, ads, automations, messaging, social
// publishing), so it gets only the Ryzevo features it has no counterpart for. Everything else stays standard-only.
export type RyzevoFeature = 'coach' | 'compass_api' | 'brand' | 'seo_ops' | 'ai_visibility' | 'alerts' | 'push' | 'approvals'
  | 'measurements' | 'monthly_report' | 'budget' | 'inbox' | 'connections_google' | 'connections_meta';
export const CREWIN_RYZEVO_FEATURES: readonly RyzevoFeature[] = ['coach', 'compass_api', 'brand', 'seo_ops', 'ai_visibility', 'alerts', 'push', 'approvals',
  'measurements', 'monthly_report', 'budget', 'inbox', 'connections_google', 'connections_meta'];
export function ryzevoFeature(pack: ProductPack | string | null | undefined, feature: RyzevoFeature): boolean {
  return pack === 'standard' || (pack === 'crewin' && CREWIN_RYZEVO_FEATURES.includes(feature));
}
// SQL form for queries that join platform_projects as p (webhooks, workers).
export const ryzevoPackSql = (feature: RyzevoFeature) => CREWIN_RYZEVO_FEATURES.includes(feature) ? "p.product_pack IN ('standard','crewin')" : "p.product_pack='standard'";
