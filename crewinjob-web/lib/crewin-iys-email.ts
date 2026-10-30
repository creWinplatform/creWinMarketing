// ─── Legacy Crewin panel: İYS for its own email senders (phase 2) ──────────────────────────────────────────
// Reactivation, job-match and campaign emails count as commercial messages. After Crewin's "Turkey" declaration a
// recipient whose nationality is TR or unknown needs İYS's consent; other nationalities rely on the unsubscribe list,
// and company and prospect audiences use the merchant (tacir) exemption. The gate starts in measure mode: everyone
// still gets the email and the result says who İYS would have stopped. The owner switches to enforce mode when the
// numbers look right. Unknown recipients are queued (encrypted) and the worker asks İYS about them, 50 per tick.
import 'server-only';
import path from 'path';
import type Database from 'better-sqlite3';
import { LEGACY_SCOPE } from './platform/access';
import { ProjectIys, iysEmailKey, iysGate, iysScope, iysSendBlock } from './platform/iys';
import { decryptCredentials, encryptCredentials } from './platform/credential-envelope';
import { emailAddress } from './platform/email-safety';
import { fetchTransport, type IysTransport } from './platform/iys-client';
import { IYS_LIMITS, type IysGateReason } from './platform/iys-types';
import { readJson, withFileLock, writeJsonAtomic } from './json-store';

export const CREWIN_IYS_EMAIL_FILE = path.join(process.cwd(), 'data', 'crewin-iys-email.json');
export const CREWIN_IYS_PENDING_FILE = path.join(process.cwd(), 'data', 'crewin-iys-email-pending.json');
const PENDING_LIMIT = 50000;
export type CrewinEmailMode = 'measure' | 'enforce';
export type CrewinEmailModeView = { mode: CrewinEmailMode; by: string | null; at: string | null };
type Pending = Record<string, { e: string; at: string }>;
export type EmailRecipientRef = { email: string; nationality?: string | null; business?: boolean };
export type CrewinEmailGateResult = {
  mode: CrewinEmailMode;
  /** Set only in enforce mode before any declaration: no email may go. */
  block: string | null;
  /** Lower-cased addresses that may get the email. */
  allowed: Set<string>;
  /** Enforce mode: the recipients İYS stopped. */
  skipped: { email: string; reason: IysGateReason }[];
  /** Both modes: how many İYS stops (or would stop), by reason, and how many unknown recipients were queued for a check. */
  counts: { total: number; reasons: Partial<Record<IysGateReason, number>>; queued: number };
};
const files = { mode: CREWIN_IYS_EMAIL_FILE, pending: CREWIN_IYS_PENDING_FILE };
const pendingId = (key: string) => `crewin-iys-pending:${key}`;
const normal = (email: string) => emailAddress(email.trim().toLowerCase());

export function crewinEmailMode(file = files.mode): CrewinEmailModeView {
  const row = readJson<Partial<CrewinEmailModeView>>(file, {});
  return { mode: row.mode === 'enforce' ? 'enforce' : 'measure', by: row.by || null, at: row.at || null };
}
export async function setCrewinEmailMode(mode: unknown, actor: string, file = files.mode): Promise<CrewinEmailModeView> {
  if (mode !== 'measure' && mode !== 'enforce') throw new Error('mode');
  const row: CrewinEmailModeView = { mode, by: actor, at: new Date().toISOString() };
  await withFileLock(file, () => writeJsonAtomic(file, row));
  return row;
}
export const crewinPendingCount = (file = files.pending) => Object.keys(readJson<Pending>(file, {})).length;

// Company and prospect audiences: the merchant (tacir) exemption.
export const BUSINESS_AUDIENCES: readonly string[] = ['maritime_businesses', 'company_prospects'];
/** The backend's own Dispatch does not pass this gate. In enforce mode a campaign to individuals goes through the
 *  panel's gated send instead, until the backend applies the same rule (docs/CREWIN-BACKEND-IYS.md item 6). */
export const crewinDispatchAllowed = (audienceType: string | null | undefined, file = files.mode) =>
  crewinEmailMode(file).mode !== 'enforce' || BUSINESS_AUDIENCES.includes(audienceType || '');

/** İYS applies to individuals whose nationality is Turkish or unknown; companies use the merchant exemption. */
export const iysAppliesToEmail = (recipient: EmailRecipientRef) =>
  !recipient.business && (!recipient.nationality || !recipient.nationality.trim() || recipient.nationality.trim().toUpperCase() === 'TR');

/** The İYS side of one legacy email send. Pure for "no" declarations; queues unknown recipients for the worker. */
export async function crewinEmailGate(db: Database.Database, key: string, recipients: EmailRecipientRef[], paths = files): Promise<CrewinEmailGateResult> {
  const mode = crewinEmailMode(paths.mode).mode, scope = iysScope(db, LEGACY_SCOPE);
  const allowed = new Set<string>(), skipped: CrewinEmailGateResult['skipped'] = [], counts: CrewinEmailGateResult['counts'] = { total: 0, reasons: {}, queued: 0 };
  const queue: { id: string; email: string }[] = [];
  if (!scope && mode === 'enforce') return { mode, block: iysSendBlock(db, LEGACY_SCOPE), allowed, skipped, counts };
  for (const recipient of recipients) {
    const raw = recipient.email.trim().toLowerCase(), email = normal(recipient.email);
    const reason: IysGateReason | null = scope === 'none' || !iysAppliesToEmail(recipient) ? null
      : !scope ? 'iys_scope_missing' : !email ? 'iys_no_consent' : iysGate(db, LEGACY_SCOPE, 'EPOSTA', iysEmailKey(LEGACY_SCOPE, key, email));
    if (reason) {
      counts.total++; counts.reasons[reason] = (counts.reasons[reason] || 0) + 1;
      if (email && scope === 'tr' && reason !== 'iys_rejected') queue.push({ id: iysEmailKey(LEGACY_SCOPE, key, email), email });
      if (mode === 'enforce') { skipped.push({ email: raw, reason }); continue; }
    }
    allowed.add(raw);
  }
  if (queue.length) counts.queued = await withFileLock(paths.pending, () => {
    const list = readJson<Pending>(paths.pending, {}), now = new Date().toISOString();
    let added = 0, size = Object.keys(list).length;
    for (const item of queue) {
      if (list[item.id] || size >= PENDING_LIMIT) continue;
      list[item.id] = { e: encryptCredentials({ email: item.email }, key, LEGACY_SCOPE.organizationId, LEGACY_SCOPE.projectId, pendingId(item.id)), at: now };
      added++; size++;
    }
    if (added) writeJsonAtomic(paths.pending, list);
    return added;
  });
  return { mode, block: null, allowed, skipped, counts };
}

/** Worker: asks İYS about up to 50 queued addresses, oldest first, once Crewin declared Turkey and is connected. */
export async function crewinIysEmailBackfill(db: Database.Database, key: string, transport: IysTransport = fetchTransport, file = files.pending) {
  if (iysScope(db, LEGACY_SCOPE) !== 'tr' || iysSendBlock(db, LEGACY_SCOPE)) return { checked: 0 };
  const batch = Object.entries(readJson<Pending>(file, {})).sort((a, b) => a[1].at.localeCompare(b[1].at)).slice(0, IYS_LIMITS.queryBatch);
  if (!batch.length) return { checked: 0 };
  const emails = batch.flatMap(([id, item]) => {
    try { return [decryptCredentials<{ email: string }>(item.e, key, LEGACY_SCOPE.organizationId, LEGACY_SCOPE.projectId, pendingId(id)).email]; } catch { return []; }
  });
  // Removed only after İYS answered; a failed run keeps them for the next tick.
  const result = emails.length ? await new ProjectIys(db, { subject: 'legacy-admin', ...LEGACY_SCOPE }, key, transport).query(emails.map(value => ({ channel: 'EPOSTA' as const, value }))) : { checked: 0 };
  await withFileLock(file, () => { const list = readJson<Pending>(file, {}); for (const [id] of batch) delete list[id]; writeJsonAtomic(file, list); });
  return { checked: result.checked };
}
