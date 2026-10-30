// ─── Legacy Crewin panel: İYS for its own WhatsApp sender ───────────────────────────────────────────────────
// Crewin declares and connects İYS like a Ryzevo project (Project settings → Sending consents), on its own project
// (LEGACY_SCOPE). Its WhatsApp sender then asks İYS only about Turkish (+90) numbers; other numbers depend on Crewin's
// own consent list alone. Consents recorded in the panel and every opt-out are queued for İYS within three business
// days. Email is not checked yet (a later step with the Crewin backend).
import 'server-only';
import type Database from 'better-sqlite3';
import { LEGACY_SCOPE } from './platform/access';
import { ProjectIys, iysGate, iysPhoneKey, iysScope, iysSendBlock, queueIysConsent } from './platform/iys';
import { decryptCredentials } from './platform/credential-envelope';
import { fetchTransport, type IysTransport } from './platform/iys-client';
import { IYS_LIMITS, type IysGateReason, type IysScope, type IysSource, type IysStatus } from './platform/iys-types';
import { isTurkishNumber } from './legacy-whatsapp-consent';

export type CrewinIysReport = 'queued' | 'not_required' | 'too_old' | 'invalid';
export type CrewinIys = {
  scope(): IysScope;
  connected(): boolean;
  /** A message for a live send before any declaration; null once Crewin declared (yes or no). */
  block(): string | null;
  /** Why İYS stops a message to this number; null when it may go (or İYS does not apply to it). */
  gate(phone: string): IysGateReason | null;
  /** Queues a consent or an opt-out of a Turkish number for İYS (only after a "Turkey" declaration). */
  report(phone: string, status: IysStatus, source: IysSource | null, date: string, actor: string): CrewinIysReport;
  /** Asks İYS about up to 50 Turkish numbers. */
  query(phones: string[]): Promise<{ checked: number; onay: number; ret: number; none: number }>;
};

export function crewinIys(db: Database.Database, key: string, transport: IysTransport = fetchTransport): CrewinIys {
  const scope = LEGACY_SCOPE;
  return {
    scope: () => iysScope(db, scope),
    connected: () => iysScope(db, scope) === 'tr' && iysSendBlock(db, scope) === null,
    block: () => iysScope(db, scope) ? null : iysSendBlock(db, scope),
    gate: phone => isTurkishNumber(phone) ? iysGate(db, scope, 'MESAJ', iysPhoneKey(scope, key, phone)) : null,
    report: (phone, status, source, date, actor) => isTurkishNumber(phone)
      ? queueIysConsent(db, scope, key, { channel: 'MESAJ', recipient: phone, status, source, consentDate: date, actor }) : 'not_required',
    query: async phones => {
      const list = [...new Set(phones.filter(isTurkishNumber))].slice(0, IYS_LIMITS.queryBatch);
      const { view: _view, ...counts } = await new ProjectIys(db, { subject: 'legacy-admin', ...scope }, key, transport).query(list.map(value => ({ channel: 'MESAJ' as const, value })));
      return counts;
    },
  };
}

/** Crewin numbers İYS already reported on, oldest check first, for the Project settings → İYS status check. */
export function crewinKnownIysPhones(db: Database.Database, key: string): string[] {
  const scope = LEGACY_SCOPE;
  const rows = db.prepare("SELECT recipient_key,encrypted_recipient FROM platform_iys_recipients WHERE organization_id=? AND project_id=? AND channel='MESAJ' ORDER BY checked_at LIMIT ?")
    .all(scope.organizationId, scope.projectId, IYS_LIMITS.queryBatch) as { recipient_key: string; encrypted_recipient: string }[];
  return rows.flatMap(row => {
    try { return [decryptCredentials<{ recipient: string }>(row.encrypted_recipient, key, scope.organizationId, scope.projectId, `iys-recipient:MESAJ:${row.recipient_key}`).recipient]; }
    catch { return []; }
  });
}
