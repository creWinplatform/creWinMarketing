import type { Db } from '../db/client';
import type { ExtraContact } from './prospect-sources-types';

// Extra addresses of companies (a list the team brought, the team's Hunter account, a guess from a name), read by the
// prospect cards and the outreach. Empty before schema 83.
export async function extraContacts(db: Db, scope: { organizationId: string; projectId: string }, prospectId?: string) {
  try {
    const rows = await db.prepare(`SELECT id,prospect_id,kind,value,source,recipient_type,confidence,note FROM platform_prospect_extra_contacts WHERE organization_id=? AND project_id=?${prospectId ? ' AND prospect_id=?' : ''} ORDER BY found_at`).all(scope.organizationId, scope.projectId, ...(prospectId ? [prospectId] : [])) as Record<string, unknown>[];
    return rows.map(row => ({ prospectId: String(row.prospect_id), contact: { id: String(row.id), kind: row.kind as 'email' | 'phone', value: String(row.value), source: row.source as ExtraContact['source'], person: row.recipient_type === 'person', confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence), note: String(row.note || '') } }));
  } catch { return []; }
}

// The "never contact again" hosts that apply to a project: its own, and by default those of every project of the same
// organisation (the project may limit it to itself). Empty before schema 83.
export async function suppressedHosts(db: Db, scope: { organizationId: string; projectId: string }) {
  try {
    const setting = await db.prepare('SELECT org_wide FROM platform_outreach_settings WHERE organization_id=? AND project_id=?').get(scope.organizationId, scope.projectId) as { org_wide: number } | undefined;
    const rows = setting && Number(setting.org_wide) === 0
      ? await db.prepare('SELECT host FROM platform_prospect_suppressions WHERE organization_id=? AND project_id=?').all(scope.organizationId, scope.projectId)
      : await db.prepare('SELECT host FROM platform_prospect_suppressions WHERE organization_id=?').all(scope.organizationId);
    return new Set((rows as { host: string }[]).map(row => row.host));
  } catch { return new Set<string>(); }
}
