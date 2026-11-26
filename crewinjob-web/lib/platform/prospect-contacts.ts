import type { Db } from '../db/client';
import type { ExtraContact } from './prospect-sources-types';
import { decryptCredentials } from './credential-envelope';

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

// ---- Warm introductions (lib/platform/prospect-network.ts): matching people's companies with the prospects ----
export const fold = (value: string) => value.toLocaleLowerCase('tr').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/i̇/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').normalize('NFKD').replace(/[̀-ͯ]/g, '');
// Legal forms and filler words left out so "Gülüş Diş Kliniği Ltd. Şti." and "Gülüş Diş Kliniği" meet.
const LEGAL = new Set(['a', 's', 'as', 'anonim', 'sirketi', 'sirket', 'sti', 'ltd', 'limited', 'inc', 'llc', 'gmbh', 'co', 'corp', 'corporation', 'tic', 'ticaret', 'san', 'sanayi', 've', 'ltdsti', 'the']);
export const companyKey = (name: string) => fold(name).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(word => word && !LEGAL.has(word)).join(' ').trim();
const hostLabel = (website: string) => { try { const parts = new URL(website).hostname.replace(/^www\./, '').split('.'); return fold(parts[0] || ''); } catch { return ''; } };
export function sameCompany(contactKey: string, prospect: { company: string; website: string }) {
  if (!contactKey) return false;
  const key = companyKey(prospect.company), host = hostLabel(prospect.website), compact = contactKey.replace(/ /g, '');
  return contactKey === key || (host.length >= 4 && compact === host) || (Math.min(contactKey.length, key.length) >= 5 && (contactKey.startsWith(`${key} `) || key.startsWith(`${contactKey} `)));
}
export const DECISION = /(kurucu|founder|ceo|cfo|coo|cto|genel m[uü]d[uü]r|m[uü]d[uü]r|direkt[oö]r|director|head of|owner|sahib|ortak|partner|president|ba[sş]kan|manager|y[oö]netici)/i;
// For the company cards: who the team knows there (the first person by name, and how many).
export async function networkByProspect(db: Db, scope: { organizationId: string; projectId: string }, key: string) {
  try {
    const rows = await db.prepare('SELECT id,encrypted_person,company_key,position FROM platform_network_contacts WHERE organization_id=? AND project_id=?').all(scope.organizationId, scope.projectId) as { id: string; encrypted_person: string; company_key: string; position: string }[];
    if (!rows.length) return {};
    const prospects = await db.prepare("SELECT id,company,website FROM platform_prospects WHERE organization_id=? AND project_id=? AND state<>'rejected'").all(scope.organizationId, scope.projectId) as { id: string; company: string; website: string }[];
    const out: Record<string, { count: number; first: string; position: string }> = {};
    for (const prospect of prospects) {
      const found = rows.filter(row => sameCompany(row.company_key, prospect)).sort((a, b) => Number(DECISION.test(b.position)) - Number(DECISION.test(a.position)));
      if (!found.length) continue;
      const person = decryptCredentials<{ firstName: string; lastName: string }>(found[0].encrypted_person, key, scope.organizationId, scope.projectId, `network:${found[0].id}`);
      out[prospect.id] = { count: found.length, first: `${person.firstName} ${person.lastName.charAt(0)}.`.trim(), position: found[0].position };
    }
    return out;
  } catch { return {}; }
}
