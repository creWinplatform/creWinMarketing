import 'server-only';
import { createHmac, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { ryzevoFeature } from './ryzevo-features';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials, encryptCredentials } from './credential-envelope';
import { emailAddress, emailIdentity, maskEmail } from './email-safety';
import { IysClient, IysError, fetchTransport, type IysCredentials, type IysTransport } from './iys-client';
import { IYS_LIMITS as LIMITS, IYS_SOURCES, iysDate, iysDueAt, type IysChannel, type IysGateReason, type IysScope, type IysSource, type IysStatus, type IysView } from './iys-types';

type Scope = { organizationId: string; projectId: string };
type Settings = { organization_id: string; project_id: string; scope: 'tr' | 'none' | null; declared_by: string | null; declared_at: string | null; connection_id: string | null; pull_state: 'idle' | 'ok' | 'failed'; pull_error: string | null; pulled_at: string | null; pull_cursor: string | null; next_pull_at: string | null; lease_until: string | null };
type Outbox = { id: string; organization_id: string; project_id: string; channel: IysChannel; recipient_key: string; encrypted_recipient: string | null; status: IysStatus; source: string; consent_date: string; due_at: string; state: 'queued' | 'sent' | 'failed'; attempts: number; last_error: string | null; created_at: string };
const HOUR = 3600000;
const args = (scope: Scope) => [scope.organizationId, scope.projectId] as const;
const E164 = /^\+[1-9]\d{7,14}$/;
const settings = (db: Database.Database, scope: Scope) => db.prepare('SELECT * FROM platform_iys_settings WHERE organization_id=? AND project_id=?').get(...args(scope)) as Settings | undefined;
const audit = (db: Database.Database, actor: string, scope: Scope, operation: string) => db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(actor, ...args(scope), operation, new Date().toISOString());
const maskPhone = (phone: string) => `${phone.slice(0, 3)}•••${phone.slice(-2)}`;
// The same keys the email and WhatsApp stores use, so a status reached through İYS applies to the right recipient.
export const iysEmailKey = (scope: Scope, key: string, email: string) => emailIdentity(scope, key, 'email', [email]);
export const iysPhoneKey = (scope: Scope, key: string, phone: string) => createHmac('sha256', Buffer.from(key, 'hex')).update(`whatsapp:${scope.organizationId}:${scope.projectId}:${phone}`).digest('hex');
const normalize = (channel: IysChannel, value: string) => channel === 'EPOSTA' ? emailAddress(value.trim().toLowerCase()) : (() => { const compact = value.replace(/[\s().-]/g, '').replace(/^00/, '+'); return E164.test(compact) ? compact : null; })();
const recipientKey = (scope: Scope, key: string, channel: IysChannel, value: string) => channel === 'EPOSTA' ? iysEmailKey(scope, key, value) : iysPhoneKey(scope, key, value);
const connection = (db: Database.Database, scope: Scope) => {
  const row = settings(db, scope); if (!row?.connection_id) return null;
  return db.prepare("SELECT id,encrypted_credentials,updated_at FROM platform_connections WHERE id=? AND organization_id=? AND project_id=? AND provider='iys' AND active=1").get(row.connection_id, ...args(scope)) as { id: string; encrypted_credentials: string; updated_at: string } | undefined || null;
};
const credentials = (db: Database.Database, scope: Scope, key: string) => { const row = connection(db, scope); return row ? decryptCredentials<IysCredentials>(row.encrypted_credentials, key, ...args(scope), row.id) : null; };
// Stores what İYS reported (or accepted) for one recipient and channel.
function remember(db: Database.Database, scope: Scope, key: string, channel: IysChannel, recipient: string, status: IysStatus, origin: 'query' | 'pull' | 'upload', consentDate: string | null, source: string | null) {
  const id = recipientKey(scope, key, channel, recipient), now = new Date().toISOString();
  db.prepare(`INSERT INTO platform_iys_recipients VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,project_id,channel,recipient_key) DO UPDATE SET encrypted_recipient=excluded.encrypted_recipient,status=excluded.status,
    consent_date=excluded.consent_date,source=excluded.source,origin=excluded.origin,checked_at=excluded.checked_at`).run(...args(scope), channel, id, encryptCredentials({ recipient }, key, ...args(scope), `iys-recipient:${channel}:${id}`), status, consentDate, source, origin, now);
}

export const iysScope = (db: Database.Database, scope: Scope): IysScope => settings(db, scope)?.scope || null;
// What a live send must respect. Null: no İYS duty (declared "no") or the recipient's consent is confirmed and fresh.
export function iysGate(db: Database.Database, scope: Scope, channel: IysChannel, key: string): IysGateReason | null {
  const row = settings(db, scope);
  if (!row?.scope) return 'iys_scope_missing';
  if (row.scope === 'none') return null;
  if (!connection(db, scope)) return 'iys_not_connected';
  const status = db.prepare('SELECT status,checked_at FROM platform_iys_recipients WHERE organization_id=? AND project_id=? AND channel=? AND recipient_key=?').get(...args(scope), channel, key) as { status: IysStatus; checked_at: string } | undefined;
  if (!status) return 'iys_no_consent';
  if (status.status === 'RET') return 'iys_rejected';
  // A status is current when it was checked in the last 24 hours, or İYS's change feed was read successfully since.
  const fresh = Date.now() - Date.parse(status.checked_at) < LIMITS.freshHours * HOUR || row.pull_state === 'ok' && Boolean(row.pulled_at) && Date.now() - Date.parse(row.pulled_at!) < LIMITS.freshHours * HOUR;
  return fresh ? null : 'iys_stale';
}
// Before a live send is queued: the project must have declared, and a "Turkey" project must be connected.
export function iysSendBlock(db: Database.Database, scope: Scope) {
  const row = settings(db, scope);
  if (!row?.scope) return 'Canlı gönderimden önce İYS beyanını yapın: Proje ayarları → Gönderim izinleri (İYS).';
  if (row.scope === 'tr' && !connection(db, scope)) return 'Türkiye’deki alıcılara gönderim için İYS bağlantısı gerekli: Proje ayarları → Gönderim izinleri (İYS).';
  return null;
}
// Queues a consent (ONAY) or an opt-out (RET) for İYS. Only for projects that declared Turkey. A consent older than three
// business days cannot be reported any more: it is not queued (İYS should already hold it; query its status instead).
export function queueIysConsent(db: Database.Database, scope: Scope, key: string, input: { channel: IysChannel; recipient: string | null; recipientKey?: string; status: IysStatus; source: IysSource | null; consentDate: string; actor: string }) {
  const row = settings(db, scope);
  if (row?.scope !== 'tr') return 'not_required' as const;
  const value = input.recipient ? normalize(input.channel, input.recipient) : null, id = value ? recipientKey(scope, key, input.channel, value) : input.recipientKey;
  if (!id) return 'invalid' as const;
  const now = new Date(), due = input.status === 'ONAY' ? iysDueAt(input.consentDate) : iysDueAt(now);
  if (input.status === 'ONAY' && Date.parse(due) < now.getTime()) return 'too_old' as const;
  if ((db.prepare("SELECT COUNT(*) n FROM platform_iys_outbox WHERE organization_id=? AND project_id=? AND state='queued'").get(...args(scope)) as { n: number }).n >= LIMITS.outbox) throw new MarketingStoreError('İYS kuyruk sınırına ulaşıldı.', 429);
  // The latest decision for a recipient replaces a queued one that has not been sent yet.
  db.prepare("DELETE FROM platform_iys_outbox WHERE organization_id=? AND project_id=? AND channel=? AND recipient_key=? AND state='queued'").run(...args(scope), input.channel, id);
  const outbox = `iys_${randomUUID()}`;
  // Without the address (for example an unsubscribe whose record is gone) the item waits for a person to report it.
  db.prepare('INSERT INTO platform_iys_outbox(id,organization_id,project_id,channel,recipient_key,encrypted_recipient,masked,status,source,consent_date,due_at,state,attempts,last_error,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)')
    .run(outbox, ...args(scope), input.channel, id, value ? encryptCredentials({ recipient: value }, key, ...args(scope), `iys-outbox:${outbox}`) : null, value ? input.channel === 'EPOSTA' ? maskEmail(value) : maskPhone(value) : '—',
      input.status, input.source && (IYS_SOURCES as readonly string[]).includes(input.source) ? input.source : 'HS_WEB', new Date(input.consentDate).toISOString(), due,
      value ? 'queued' : 'failed', value ? null : 'Alıcı adresi bulunamadı; bu kaydı İYS’ye elle bildirin.', input.actor, now.toISOString(), now.toISOString());
  // An opt-out stops sending at once; İYS is told within the deadline.
  if (input.status === 'RET' && value) remember(db, scope, key, input.channel, value, 'RET', 'upload', new Date(input.consentDate).toISOString(), null);
  return 'queued' as const;
}

export class ProjectIys {
  private repo: PlatformRepository;
  constructor(private db: Database.Database, private scope: MarketingScope, private key: string, private transport: IysTransport = fetchTransport) { this.repo = new PlatformRepository(db); }
  private project() { return this.repo.workspace(this.scope.subject, ...args(this.scope))?.project; }
  private can(permission: 'read' | 'connections.manage' | 'recipients.manage') { return this.repo.can(this.scope.subject, ...args(this.scope), permission); }
  private authorize(manage = false) {
    if (!this.can('read') || !ryzevoFeature(this.project()?.productPack, 'iys') || manage && !this.can('connections.manage')) throw new MarketingStoreError('İYS ayarlarına erişim reddedildi.', 403);
  }
  private ensure(now = new Date().toISOString()) { this.db.prepare("INSERT OR IGNORE INTO platform_iys_settings(organization_id,project_id,pull_state,updated_at) VALUES(?,?,'idle',?)").run(...args(this.scope), now); }
  view(): IysView {
    this.authorize(); const row = settings(this.db, this.scope), live = connection(this.db, this.scope), canManage = this.can('connections.manage');
    const value = live && canManage ? decryptCredentials<IysCredentials>(live.encrypted_credentials, this.key, ...args(this.scope), live.id) : null;
    const counts = (state: string, extra = '') => (this.db.prepare(`SELECT COUNT(*) n FROM platform_iys_outbox WHERE organization_id=? AND project_id=? AND state=?${extra}`).get(...args(this.scope), state) as { n: number }).n;
    const now = new Date().toISOString(), next = this.db.prepare("SELECT MIN(due_at) at FROM platform_iys_outbox WHERE organization_id=? AND project_id=? AND state='queued'").get(...args(this.scope)) as { at: string | null };
    const statuses = { EPOSTA: { ONAY: 0, RET: 0 }, MESAJ: { ONAY: 0, RET: 0 } };
    for (const item of this.db.prepare('SELECT channel,status,COUNT(*) n FROM platform_iys_recipients WHERE organization_id=? AND project_id=? GROUP BY channel,status').all(...args(this.scope)) as { channel: IysChannel; status: IysStatus; n: number }[]) statuses[item.channel][item.status] = item.n;
    const attention = (this.db.prepare("SELECT id,channel,status,masked,due_at,state,last_error FROM platform_iys_outbox WHERE organization_id=? AND project_id=? AND (state='failed' OR state='queued' AND due_at<=?) ORDER BY due_at LIMIT 20").all(...args(this.scope), new Date(Date.now() + 24 * HOUR).toISOString()) as { id: string; channel: IysChannel; status: IysStatus; masked: string; due_at: string; state: 'queued' | 'failed'; last_error: string | null }[])
      .map(item => ({ id: item.id, channel: item.channel, status: item.status, masked: item.masked, dueAt: item.due_at, state: item.state, error: item.last_error }));
    const declarer = row?.declared_by ? (this.db.prepare('SELECT username FROM platform_users WHERE id=?').get(row.declared_by) as { username: string } | undefined)?.username || null : null;
    return { scope: (row?.scope || null) as IysScope, declaredAt: row?.declared_at || null, declaredBy: declarer, canManage,
      connection: live ? { environment: value?.environment || 'production', iysCode: value ? value.iysCode : '', brandCode: value ? value.brandCode : '', connectedAt: live.updated_at } : null,
      pull: { state: row?.pull_state || 'idle', at: row?.pulled_at || null, error: row?.pull_error || null },
      outbox: { queued: counts('queued'), sent: counts('sent'), failed: counts('failed'), overdue: counts('queued', ` AND due_at<'${now}'`), nextDue: next.at }, statuses, attention };
  }
  // The project's own statement, kept with who made it and when. "No" means no İYS check is made.
  declare(raw: Record<string, unknown>) {
    this.authorize(true);
    if (raw.scope !== 'tr' && raw.scope !== 'none') throw new MarketingStoreError('Beyan için “Evet” veya “Hayır” seçin.');
    const now = new Date().toISOString();
    this.db.transaction(() => { this.ensure(now); this.db.prepare('UPDATE platform_iys_settings SET scope=?,declared_by=?,declared_at=?,updated_at=? WHERE organization_id=? AND project_id=?').run(raw.scope, this.scope.subject, now, now, ...args(this.scope)); audit(this.db, this.scope.subject, this.scope, `iys.declare.${raw.scope}`); })();
    return this.view();
  }
  // Connects the project's İYS API user: the account must sign in and the brand code must be one of its brands.
  async connect(raw: Record<string, unknown>) {
    this.authorize(true);
    const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
    const input: IysCredentials = { username: text(raw.username, 200), password: typeof raw.password === 'string' ? raw.password : '', iysCode: text(raw.iysCode, 20), brandCode: text(raw.brandCode, 20), environment: raw.environment === 'sandbox' ? 'sandbox' : 'production' };
    if (!input.username || !input.password || input.password.length > 500 || !/^\d{3,20}$/.test(input.iysCode) || !/^\d{3,20}$/.test(input.brandCode)) throw new MarketingStoreError('İYS kullanıcı adı, şifre, İYS kodu ve marka kodu (yalnız rakam) gerekli.');
    try { const client = new IysClient(input, this.transport); await client.login(); await client.verify(); }
    catch (error) { throw new MarketingStoreError(error instanceof IysError ? error.message : 'İYS bağlantısı doğrulanamadı.', error instanceof IysError && error.code === 'unavailable' ? 502 : 409); }
    const now = new Date().toISOString(), id = `iysconn_${randomUUID()}`;
    this.db.transaction(() => {
      this.authorize(true); this.ensure(now); const old = connection(this.db, this.scope);
      if (old) this.db.prepare("UPDATE platform_connections SET active=0,encrypted_credentials='',updated_at=? WHERE id=?").run(now, old.id);
      this.db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,'iys',?,?,?,1,?)").run(id, ...args(this.scope), `${input.iysCode}:${input.brandCode}`, `İYS ${input.brandCode}`, encryptCredentials(input, this.key, ...args(this.scope), id), now);
      this.db.prepare("UPDATE platform_iys_settings SET connection_id=?,pull_state='idle',pull_error=NULL,pull_cursor=NULL,next_pull_at=?,updated_at=? WHERE organization_id=? AND project_id=?").run(id, now, now, ...args(this.scope));
      audit(this.db, this.scope.subject, this.scope, 'iys.connect');
    }).immediate();
    return this.view();
  }
  revoke() {
    this.authorize(true); const now = new Date().toISOString();
    this.db.transaction(() => { const old = connection(this.db, this.scope); if (old) this.db.prepare("UPDATE platform_connections SET active=0,encrypted_credentials='',updated_at=? WHERE id=?").run(now, old.id);
      this.db.prepare("UPDATE platform_iys_settings SET connection_id=NULL,pull_state='idle',next_pull_at=NULL,updated_at=? WHERE organization_id=? AND project_id=?").run(now, ...args(this.scope)); audit(this.db, this.scope.subject, this.scope, 'iys.revoke'); })();
    return this.view();
  }
  retry(raw: Record<string, unknown>) {
    this.authorize(true);
    const changed = this.db.prepare("UPDATE platform_iys_outbox SET state='queued',attempts=0,last_error=NULL,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND state='failed' AND encrypted_recipient IS NOT NULL").run(new Date().toISOString(), raw.id, ...args(this.scope)).changes;
    if (!changed) throw new MarketingStoreError('Yeniden denenecek İYS kaydı bulunamadı.', 404);
    return this.view();
  }
  // Asks İYS for the current status of the recipients a live send could reach: the email pilot allowlist and the
  // WhatsApp contacts. At most 50 per run, oldest first; nothing is sent to the recipients.
  async query(recipients: { channel: IysChannel; value: string }[]) {
    this.authorize(); if (!this.can('connections.manage') && !this.can('recipients.manage')) throw new MarketingStoreError('İYS durumunu yalnız alıcı veya bağlantı yöneticileri sorgulayabilir.', 403);
    const creds = credentials(this.db, this.scope, this.key); if (!creds) throw new MarketingStoreError('Önce İYS’yi bağlayın.', 409);
    const checked = new Map((this.db.prepare('SELECT channel,recipient_key,checked_at FROM platform_iys_recipients WHERE organization_id=? AND project_id=?').all(...args(this.scope)) as { channel: string; recipient_key: string; checked_at: string }[]).map(row => [`${row.channel}\n${row.recipient_key}`, row.checked_at]));
    const list = recipients.flatMap(item => { const value = normalize(item.channel, item.value); return value ? [{ channel: item.channel, value, at: checked.get(`${item.channel}\n${recipientKey(this.scope, this.key, item.channel, value)}`) || '' }] : []; })
      .sort((a, b) => a.at.localeCompare(b.at)).slice(0, LIMITS.queryBatch);
    const client = new IysClient(creds, this.transport), result = { checked: 0, onay: 0, ret: 0, none: 0 };
    for (const item of list) {
      const status = await client.status(item.value, item.channel); result.checked++;
      if (!status) { result.none++; this.db.prepare('DELETE FROM platform_iys_recipients WHERE organization_id=? AND project_id=? AND channel=? AND recipient_key=?').run(...args(this.scope), item.channel, recipientKey(this.scope, this.key, item.channel, item.value)); continue; }
      remember(this.db, this.scope, this.key, item.channel, item.value, status.status, 'query', status.consentDate, status.source); if (status.status === 'ONAY') result.onay++; else result.ret++;
    }
    audit(this.db, this.scope.subject, this.scope, 'iys.query');
    return { ...result, view: this.view() };
  }
}

// Worker: uploads due consents and opt-outs, a few per tick, as the project's İYS user.
export async function deliverIysOutbox(db: Database.Database, key: string, transport: IysTransport = fetchTransport) {
  const rows = db.prepare("SELECT o.* FROM platform_iys_outbox o JOIN platform_iys_settings s ON s.organization_id=o.organization_id AND s.project_id=o.project_id WHERE o.state='queued' AND o.encrypted_recipient IS NOT NULL AND s.scope='tr' AND s.connection_id IS NOT NULL ORDER BY o.due_at LIMIT ?").all(LIMITS.perTick) as Outbox[];
  let sent = 0, failed = 0; const clients = new Map<string, IysClient | null>();
  for (const row of rows) {
    const scope = { organizationId: row.organization_id, projectId: row.project_id }, project = `${row.organization_id}\n${row.project_id}`;
    if (!clients.has(project)) { const creds = credentials(db, scope, key); clients.set(project, creds ? new IysClient(creds, transport) : null); }
    const client = clients.get(project); if (!client) continue;
    const recipient = decryptCredentials<{ recipient: string }>(row.encrypted_recipient!, key, ...args(scope), `iys-outbox:${row.id}`).recipient, now = new Date().toISOString();
    try {
      const result = await client.addConsent({ recipient, type: row.channel, status: row.status, source: row.source, consentDate: iysDate(row.consent_date) });
      db.transaction(() => { db.prepare("UPDATE platform_iys_outbox SET state='sent',transaction_id=?,last_error=NULL,attempts=attempts+1,updated_at=? WHERE id=? AND state='queued'").run(result.transactionId, now, row.id); remember(db, scope, key, row.channel, recipient, row.status, 'upload', row.consent_date, row.source); })();
      sent++;
    } catch (error) {
      const message = error instanceof IysError ? error.message : 'İYS kaydı gönderilemedi.', final = row.attempts + 1 >= LIMITS.attempts || error instanceof IysError && error.code === 'rejected';
      db.prepare('UPDATE platform_iys_outbox SET state=?,attempts=attempts+1,last_error=?,updated_at=? WHERE id=?').run(final ? 'failed' : 'queued', message.slice(0, 300), now, row.id); failed++;
      if (error instanceof IysError && error.code === 'auth') clients.set(project, null);
    }
  }
  return { sent, failed };
}
// Worker: reads İYS's change feed every 30 minutes per connected project, one project per tick. A recipient who rejects
// through İYS is not sent to from then on; the status is kept apart from Ryzevo's own opt-outs.
export async function pullIysChanges(db: Database.Database, key: string, transport: IysTransport = fetchTransport, now = Date.now()) {
  const row = db.prepare("SELECT * FROM platform_iys_settings WHERE scope='tr' AND connection_id IS NOT NULL AND (next_pull_at IS NULL OR next_pull_at<=?) AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_pull_at LIMIT 1").get(new Date(now).toISOString(), new Date(now).toISOString()) as Settings | undefined;
  if (!row) return { projects: 0, changes: 0 };
  const scope = { organizationId: row.organization_id, projectId: row.project_id }, at = new Date(now).toISOString();
  db.prepare('UPDATE platform_iys_settings SET lease_until=? WHERE organization_id=? AND project_id=?').run(new Date(now + 60000).toISOString(), ...args(scope));
  let changes = 0;
  try {
    const creds = credentials(db, scope, key); if (!creds) throw new IysError('auth', 'İYS bağlantısı yok.');
    const client = new IysClient(creds, transport); let cursor = row.pull_cursor;
    for (let page = 0; page < 5; page++) {
      const result = await client.changes(cursor);
      db.transaction(() => { for (const item of result.list) { const value = normalize(item.type, item.recipient); if (value) { remember(db, scope, key, item.type, value, item.status, 'pull', item.consentDate, null); changes++; } } })();
      if (!result.list.length || result.next === cursor) { cursor = result.next; break; }
      cursor = result.next;
    }
    db.prepare("UPDATE platform_iys_settings SET pull_state='ok',pull_error=NULL,pulled_at=?,pull_cursor=?,next_pull_at=?,lease_until=NULL WHERE organization_id=? AND project_id=?").run(at, cursor, new Date(now + LIMITS.pullMinutes * 60000).toISOString(), ...args(scope));
  } catch (error) {
    db.prepare("UPDATE platform_iys_settings SET pull_state='failed',pull_error=?,next_pull_at=?,lease_until=NULL WHERE organization_id=? AND project_id=?").run((error instanceof IysError ? error.message : 'İYS değişiklikleri okunamadı.').slice(0, 300), new Date(now + LIMITS.pullMinutes * 60000).toISOString(), ...args(scope));
  }
  return { projects: 1, changes };
}
// For team alerts: uploads that are due within a day or failed, and a change feed that has not been read for 6 hours.
export function iysAttention(db: Database.Database, scope: Scope, now = Date.now()) {
  const row = settings(db, scope); if (row?.scope !== 'tr') return null;
  const items = db.prepare("SELECT id,due_at,state FROM platform_iys_outbox WHERE organization_id=? AND project_id=? AND (state='failed' OR state='queued' AND due_at<=?) ORDER BY due_at LIMIT 50").all(...args(scope), new Date(now + 24 * HOUR).toISOString()) as { id: string; due_at: string; state: string }[];
  const stale = Boolean(row.connection_id) && (row.pull_state === 'failed' || !row.pulled_at || now - Date.parse(row.pulled_at) > 6 * HOUR);
  return { items, stale, pulledAt: row.pulled_at };
}
