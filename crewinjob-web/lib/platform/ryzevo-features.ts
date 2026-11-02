import type { ProductPack } from './catalog';
// Which Ryzevo features a project pack may use. Standard projects get all of them. The Crewin workspace keeps its own
// tools wherever it has one (campaigns, content library, calendar, prospects, ads, automations, messaging, social
// publishing), so it gets only the Ryzevo features it has no counterpart for. Everything else stays standard-only.
export type RyzevoFeature = 'coach' | 'compass_api' | 'brand' | 'seo_ops' | 'ai_visibility' | 'alerts' | 'push' | 'approvals'
  | 'measurements' | 'monthly_report' | 'budget' | 'inbox' | 'connections_google' | 'connections_meta' | 'iys' | 'product_events' | 'attribution';
// iys: the declaration and İYS connection; Crewin's own WhatsApp sender applies the gate (lib/crewin-iys.ts).
// product_events: signed product-event webhooks (Crewin's backend sends them); REST data sources and segments stay standard.
// attribution: the "Which work brought customers" report; Crewin's own tools tag their links (crewin-links.ts).
export const CREWIN_RYZEVO_FEATURES: readonly RyzevoFeature[] = ['coach', 'compass_api', 'brand', 'seo_ops', 'ai_visibility', 'alerts', 'push', 'approvals',
  'measurements', 'monthly_report', 'budget', 'inbox', 'connections_google', 'connections_meta', 'iys', 'product_events', 'attribution'];
export function ryzevoFeature(pack: ProductPack | string | null | undefined, feature: RyzevoFeature): boolean {
  return pack === 'standard' || (pack === 'crewin' && CREWIN_RYZEVO_FEATURES.includes(feature));
}
// SQL form for queries that join platform_projects as p (webhooks, workers).
export const ryzevoPackSql = (feature: RyzevoFeature) => CREWIN_RYZEVO_FEATURES.includes(feature) ? "p.product_pack IN ('standard','crewin')" : "p.product_pack='standard'";
