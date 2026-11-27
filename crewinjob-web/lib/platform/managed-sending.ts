import type { Db } from '../db/client';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials } from './credential-envelope';
import { pauseForSenderChange, salesDomainName } from './outreach-domain';
import { managedProvider, managedSendingEnabled, type SendingProvider } from './sending-providers';
import {
  MANAGED_AUTHORITY, MANAGED_LIMITS as LIMITS, MANAGED_TERMS_VERSION,
  type InboundView, type ManagedOperatorSnapshot, type ManagedSnapshot, type ManagedStage, type ManagedStageKey,
} from './managed-sending-types';

// Managed sales service (see managed-sending-types.ts): the pilot list and the managed domains are kept by the
// operator (the team running Ryzevo); the company's authorised person approves sending on its behalf; every email
// that goes uses one prepaid credit (follow-ups too unless PLATFORM_MANAGED_FOLLOWUPS_CHARGED=0), an email that never
// left uses none, and a provider's rejection gives it back.
type Json = Record<string, unknown>;
type Scope = { organizationId: string; projectId: string };
type PilotRow = { organization_id: string; project_id: string; state: 'active' | 'suspended'; company_name: string; daily_cap: number; note: string; suspended_reason: string; verified_by: string; verified_at: string; updated_at: string };
type DomainRow = { id: string; domain: string; state: 'available' | 'assigned' | 'released'; organization_id: string | null; project_id: string | null; registrant: 'customer' | 'ryzevo'; renews_on: string | null; from_local: string; from_name: string; verified: number; checked_at: string | null; approved_by: string | null; approved_at: string | null; assigned_at: string | null; released_at: string | null; note: string; created_at: string };
const DAY = 86400000;
const line = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
export const managedPrice = () => { const value = Number(process.env.PLATFORM_MANAGED_PRICE_USD); return Number.isFinite(value) && value > 0 && value < 10 ? value : null; };
export const followUpsCharged = () => process.env.PLATFORM_MANAGED_FOLLOWUPS_CHARGED !== '0';

async function pilotRow(db: Db, scope: Scope) {
  try { return await db.prepare('SELECT * FROM platform_managed_pilots WHERE organization_id=? AND project_id=?').get(scope.organizationId, scope.projectId) as PilotRow | undefined; } catch { return undefined; }
}
async function domainRow(db: Db, scope: Scope) {
  return await db.prepare("SELECT * FROM platform_managed_domains WHERE organization_id=? AND project_id=? AND state='assigned'").get(scope.organizationId, scope.projectId) as DomainRow | undefined;
}
export async function creditBalance(db: Db, scope: Scope) {
  return Number((await db.prepare('SELECT COALESCE(SUM(amount),0) n FROM platform_sending_credits WHERE organization_id=? AND project_id=?').get(scope.organizationId, scope.projectId) as { n: number }).n);
}

// What the sending side needs for a project in the managed service, or null when the project is not a pilot (then it
// sends as before, from its own sender). A pilot never falls back to its own sender.
export async function managedSender(db: Db, scope: Scope, provider: SendingProvider | null = managedProvider()) {
  const pilot = await pilotRow(db, scope); if (!pilot) return null;
  const domain = await domainRow(db, scope), balance = await creditBalance(db, scope);
  const waiting: ManagedSnapshot['waiting'] = pilot.state !== 'active' ? 'suspended' : !managedSendingEnabled() ? 'switch_off' : !provider ? 'no_provider' : !domain ? 'no_domain'
    : !Number(domain.verified) ? 'not_verified' : !domain.approved_at ? 'not_approved' : balance < 1 ? 'no_credits' : null;
  return { pilot, domain: domain || null, provider, balance, waiting, ready: waiting === null,
    from: domain ? `${domain.from_local}@${domain.domain}` : null, fromName: domain?.from_name || pilot.company_name, companyName: pilot.company_name, dailyCap: Number(pilot.daily_cap), approvedAt: domain?.approved_at || null };
}
// One credit for an email about to go (inside the sending reservation); false when there is none left.
export async function debitCredit(db: Db, scope: Scope, sendId: string, step: number) {
  if (step > 0 && !followUpsCharged()) return true;
  if (await creditBalance(db, scope) < 1) return false;
  await db.prepare("INSERT INTO platform_sending_credits(id,organization_id,project_id,kind,amount,send_id,note,actor,created_at) VALUES(?,?,?,'debit',-1,?,'',?,?)").run(`credit_${randomUUID()}`, scope.organizationId, scope.projectId, sendId, 'ryzevo', new Date().toISOString());
  return true;
}
// The provider refused it, or it never left: the credit comes back (once).
export async function refundCredit(db: Db, scope: Scope, sendId: string, note: string) {
  const debit = await db.prepare("SELECT 1 FROM platform_sending_credits WHERE send_id=? AND kind='debit'").get(sendId), refunded = await db.prepare("SELECT 1 FROM platform_sending_credits WHERE send_id=? AND kind='refund'").get(sendId);
  if (!debit || refunded) return false;
  await db.prepare("INSERT INTO platform_sending_credits(id,organization_id,project_id,kind,amount,send_id,note,actor,created_at) VALUES(?,?,?,'refund',1,?,?,?,?)").run(`credit_${randomUUID()}`, scope.organizationId, scope.projectId, sendId, note.slice(0, 120), 'ryzevo', new Date().toISOString());
  return true;
}

// ---- The customer's side ----
export class ManagedSending {
  private repo: PlatformRepository;
  constructor(private db: Db, private scope: MarketingScope, private key: string, private provider: SendingProvider | null = managedProvider()) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private async authorize() {
    if (!await this.repo.can(this.scope.subject, ...this.args(), 'read') || (await this.repo.workspace(this.scope.subject, ...this.args()))?.project.productPack !== 'standard') throw new MarketingStoreError('Aday listesi için standart proje erişimi gerekli.', 403);
  }
  private async count(sql: string, ...values: unknown[]) { return Number((await this.db.prepare(sql).get(...this.args(), ...values) as { n: number } | undefined)?.n || 0); }
  async read(): Promise<ManagedSnapshot> {
    await this.authorize();
    const sender = await managedSender(this.db, this.scope, this.provider), canRead = await this.repo.can(this.scope.subject, ...this.args(), 'content.write');
    const since = sender?.approvedAt || '9999', price = managedPrice();
    const sent = sender ? await this.count('SELECT COUNT(*) n FROM platform_prospect_outreach_sends WHERE organization_id=? AND project_id=? AND submitted_at>=? AND provider_message_id IS NOT NULL', since) : 0;
    const replies = sender ? await this.count("SELECT COUNT(*) n FROM platform_prospect_outreach WHERE organization_id=? AND project_id=? AND approved_at>=? AND reply_at IS NOT NULL AND (reply_kind IS NULL OR reply_kind<>'auto_reply')", since) : 0;
    const interested = sender ? await this.count("SELECT COUNT(*) n FROM platform_prospect_outreach WHERE organization_id=? AND project_id=? AND approved_at>=? AND reply_kind='interested'", since) : 0;
    const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
    const usedMonth = -await this.count("SELECT COALESCE(SUM(amount),0) n FROM platform_sending_credits WHERE organization_id=? AND project_id=? AND kind IN ('debit','refund') AND created_at>=?", month.toISOString());
    const usedAll = -await this.count("SELECT COALESCE(SUM(amount),0) n FROM platform_sending_credits WHERE organization_id=? AND project_id=? AND kind IN ('debit','refund')");
    // The four stages the customer sees instead of an empty waiting screen.
    const approved = await this.count("SELECT COUNT(*) n FROM platform_prospects WHERE organization_id=? AND project_id=? AND state='approved'"), drafts = await this.count('SELECT COUNT(*) n FROM platform_prospect_outreach WHERE organization_id=? AND project_id=?');
    const done: Record<ManagedStageKey, boolean> = { prepare: approved > 0 && drafts > 0, sender: Boolean(sender?.domain && Number(sender.domain.verified) && sender.domain.approved_at), sending: sent > 0, capacity: false };
    const order: ManagedStageKey[] = ['prepare', 'sender', 'sending', 'capacity'], current = order.find(key => !done[key]) || 'capacity';
    const tr = (await this.repo.workspace(this.scope.subject, ...this.args()))!.project.language !== 'en';
    const notes: Record<ManagedStageKey, string> = {
      prepare: tr ? `${approved} onaylı firma, ${drafts} taslak` : `${approved} approved companies, ${drafts} drafts`,
      sender: sender?.domain ? (sender.domain.approved_at ? (tr ? `${sender.from} onaylandı` : `${sender.from} approved`) : (tr ? `${sender.from} onayınızı bekliyor` : `${sender.from} awaits your approval`)) : '',
      sending: sent ? (tr ? `${sent} e-posta gitti` : `${sent} emails sent`) : '', capacity: '',
    };
    const stages: ManagedStage[] = order.map(key => ({ key, state: done[key] ? 'done' : key === current ? 'current' : 'todo', note: notes[key] }));
    let inbound: InboundView[] = [];
    if (canRead && sender) {
      const rows = await this.db.prepare('SELECT id,prospect_id,masked_from,matched,kind,encrypted_message,received_at FROM platform_outreach_inbound WHERE organization_id=? AND project_id=? ORDER BY received_at DESC LIMIT 20').all(...this.args()) as { id: string; prospect_id: string; masked_from: string; matched: InboundView['matched']; kind: string | null; encrypted_message: string; received_at: string }[];
      inbound = rows.map(row => { const message = decryptCredentials<{ from: string; subject: string; text: string }>(row.encrypted_message, this.key, ...this.args(), `inbound:${row.id}`);
        return { id: row.id, prospectId: row.prospect_id, from: message.from, matched: row.matched, kind: row.kind, subject: message.subject, text: message.text, receivedAt: row.received_at }; });
    }
    return {
      pilot: sender ? { state: sender.pilot.state, companyName: sender.pilot.company_name, dailyCap: Number(sender.pilot.daily_cap), suspendedReason: sender.pilot.suspended_reason } : null,
      switchOn: managedSendingEnabled(), providerConfigured: Boolean(this.provider),
      domain: sender?.domain ? { id: sender.domain.id, domain: sender.domain.domain, fromAddress: sender.from!, fromName: sender.fromName, companyName: sender.companyName, verified: Boolean(Number(sender.domain.verified)), approvedAt: sender.domain.approved_at, renewsOn: sender.domain.renews_on, registrant: sender.domain.registrant } : null,
      ready: Boolean(sender?.ready), waiting: sender ? sender.waiting : 'not_pilot',
      credits: { balance: sender?.balance || 0, usedThisMonth: usedMonth, priceUsd: price, followUpsCharged: followUpsCharged() },
      results: { sent, replies, interested, costPerInterestedUsd: price && interested ? Math.round(usedAll * price / interested * 100) / 100 : null },
      stages, inbound, terms: { version: MANAGED_TERMS_VERSION, text: MANAGED_AUTHORITY }, canApprove: await this.repo.can(this.scope.subject, ...this.args(), 'billing.manage'), canRead,
    };
  }
  // The company's authorised person (the project owner) approves sending on its behalf from the assigned domain.
  async approve(raw: Json) {
    await this.authorize();
    if (!await this.repo.can(this.scope.subject, ...this.args(), 'billing.manage')) throw new MarketingStoreError('Şirket adına gönderim yetkisini yalnız projenin sahibi verebilir.', 403);
    if (raw.accepted !== true || raw.version !== MANAGED_TERMS_VERSION) throw new MarketingStoreError('Yetki metnini okuyup onaylayın.');
    const domain = await domainRow(this.db, this.scope);
    if (!domain || raw.domainId !== domain.id) throw new MarketingStoreError('Size ayrılan alan adı değişti; sayfayı yenileyin.', 409);
    await this.db.transaction(async () => {
      await this.db.prepare('UPDATE platform_managed_domains SET approved_by=?,approved_at=?,updated_at=? WHERE id=? AND approved_at IS NULL').run(this.scope.subject, new Date().toISOString(), new Date().toISOString(), domain.id);
      await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), 'managed.domain.approve', new Date().toISOString());
    });
    return await this.read();
  }
}

// ---- The operator's side (the team running Ryzevo; never a customer session) ----
export class ManagedOperator {
  constructor(private db: Db, private actor: string, private provider: SendingProvider | null = managedProvider()) {}
  private async audit(scope: Scope | null, operation: string) { await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.actor, scope?.organizationId || 'operator', scope?.projectId || 'managed-sending', operation, new Date().toISOString()); }
  private async project(raw: Json) {
    const row = typeof raw.projectId === 'string' && typeof raw.organizationId === 'string' ? await this.db.prepare('SELECT id,organization_id,product_pack FROM platform_projects WHERE id=? AND organization_id=?').get(raw.projectId, raw.organizationId) as { id: string; organization_id: string; product_pack: string } | undefined : undefined;
    if (!row || row.product_pack !== 'standard') throw new MarketingStoreError('Proje bulunamadı.', 404);
    return { organizationId: row.organization_id, projectId: row.id };
  }
  private async domain(id: unknown) {
    const row = typeof id === 'string' ? await this.db.prepare('SELECT * FROM platform_managed_domains WHERE id=?').get(id) as DomainRow | undefined : undefined;
    if (!row) throw new MarketingStoreError('Alan adı bulunamadı.', 404); return row;
  }
  async read(): Promise<ManagedOperatorSnapshot> {
    const pilots = await this.db.prepare('SELECT p.*,pr.name project_name,o.name organization_name FROM platform_managed_pilots p JOIN platform_projects pr ON pr.id=p.project_id JOIN platform_organizations o ON o.id=p.organization_id ORDER BY p.verified_at').all() as (PilotRow & { project_name: string; organization_name: string })[];
    const since = new Date(Date.now() - 14 * DAY).toISOString(), rows = [];
    for (const pilot of pilots) {
      const scope = { organizationId: pilot.organization_id, projectId: pilot.project_id }, domain = await domainRow(this.db, scope);
      const health = await this.db.prepare("SELECT COUNT(*) n,SUM(CASE WHEN state='bounced' THEN 1 ELSE 0 END) b,SUM(CASE WHEN state='complained' THEN 1 ELSE 0 END) c FROM platform_prospect_outreach_sends WHERE organization_id=? AND project_id=? AND submitted_at>?").get(pilot.organization_id, pilot.project_id, since) as { n: number; b: number | null; c: number | null };
      rows.push({ organizationId: pilot.organization_id, projectId: pilot.project_id, projectName: pilot.project_name, organizationName: pilot.organization_name, state: pilot.state, companyName: pilot.company_name, dailyCap: Number(pilot.daily_cap), note: pilot.note,
        suspendedReason: pilot.suspended_reason, verifiedAt: pilot.verified_at, balance: await creditBalance(this.db, scope), domain: domain?.domain || null, domainApproved: Boolean(domain?.approved_at), sent: Number(health.n), bounces: Number(health.b || 0), complaints: Number(health.c || 0) });
    }
    const domains = await this.db.prepare('SELECT d.*,p.name project_name FROM platform_managed_domains d LEFT JOIN platform_projects p ON p.id=d.project_id ORDER BY d.created_at').all() as (DomainRow & { project_name: string | null })[];
    const projects = await this.db.prepare("SELECT p.id,p.organization_id,p.name,o.name organization FROM platform_projects p JOIN platform_organizations o ON o.id=p.organization_id WHERE p.product_pack='standard' ORDER BY o.name,p.name LIMIT 300").all() as { id: string; organization_id: string; name: string; organization: string }[];
    return { pilots: rows,
      domains: domains.map(row => ({ id: row.id, domain: row.domain, state: row.state, projectId: row.project_id, projectName: row.project_name, registrant: row.registrant, renewsOn: row.renews_on, fromLocal: row.from_local, fromName: row.from_name, verified: Boolean(Number(row.verified)), checkedAt: row.checked_at, approvedAt: row.approved_at, note: row.note })),
      projects: projects.map(row => ({ organizationId: row.organization_id, projectId: row.id, name: row.name, organization: row.organization })),
      switchOn: managedSendingEnabled(), provider: this.provider?.id || null, inboundConfigured: Boolean(process.env.PLATFORM_MANAGED_INBOUND_SECRET || process.env.PLATFORM_MANAGED_SES_TOPIC_ARN), maxPilots: LIMITS.pilots };
  }
  // A verified company joins the pilot (at most ten active), or its details change.
  async savePilot(raw: Json) {
    const scope = await this.project(raw), company = line(raw.companyName, 120), cap = raw.dailyCap === undefined ? 25 : Number(raw.dailyCap), note = line(raw.note, 300);
    if (company.length < 2) throw new MarketingStoreError('Şirketin resmi adını yazın (e-postalarda gönderen olarak görünür).');
    if (!Number.isInteger(cap) || cap < 1 || cap > LIMITS.dailyCap) throw new MarketingStoreError(`Günlük üst sınır 1 ile ${LIMITS.dailyCap} arasında olmalı.`);
    if (raw.verified !== true) throw new MarketingStoreError('Şirketin ve yetkilinin doğrulandığını onaylayın.');
    const now = new Date().toISOString(), old = await pilotRow(this.db, scope);
    await this.db.transaction(async () => {
      if (!old && Number((await this.db.prepare("SELECT COUNT(*) n FROM platform_managed_pilots WHERE state='active'").get() as { n: number }).n) >= LIMITS.pilots) throw new MarketingStoreError(`Pilot en çok ${LIMITS.pilots} şirketle yürür.`, 409);
      if (old) await this.db.prepare('UPDATE platform_managed_pilots SET company_name=?,daily_cap=?,note=?,updated_at=? WHERE organization_id=? AND project_id=?').run(company, cap, note, now, scope.organizationId, scope.projectId);
      else await this.db.prepare("INSERT INTO platform_managed_pilots(organization_id,project_id,state,company_name,daily_cap,note,suspended_reason,verified_by,verified_at,updated_at) VALUES(?,?,'active',?,?,?,'',?,?,?)").run(scope.organizationId, scope.projectId, company, cap, note, this.actor, now, now);
      await this.audit(scope, old ? 'managed.pilot.update' : 'managed.pilot.add');
    });
    return await this.read();
  }
  // Stopping a pilot stops its sending at once; resuming needs a reason to have been cleared by a person.
  async setPilotState(raw: Json) {
    const scope = await this.project(raw), state = raw.state === 'active' ? 'active' : 'suspended', reason = line(raw.reason, 200), old = await pilotRow(this.db, scope);
    if (!old) throw new MarketingStoreError('Bu proje pilotta değil.', 404);
    if (state === 'suspended' && reason.length < 3) throw new MarketingStoreError('Durdurma nedenini yazın.');
    if (state === 'active' && old.state !== 'active' && Number((await this.db.prepare("SELECT COUNT(*) n FROM platform_managed_pilots WHERE state='active'").get() as { n: number }).n) >= LIMITS.pilots) throw new MarketingStoreError(`Pilot en çok ${LIMITS.pilots} şirketle yürür.`, 409);
    await this.db.prepare('UPDATE platform_managed_pilots SET state=?,suspended_reason=?,updated_at=? WHERE organization_id=? AND project_id=?').run(state, state === 'suspended' ? reason : '', new Date().toISOString(), scope.organizationId, scope.projectId);
    await this.audit(scope, `managed.pilot.${state}`);
    return await this.read();
  }
  // Prepaid credits (a pilot grant or a payment received outside Ryzevo for now).
  async grant(raw: Json) {
    const scope = await this.project(raw), amount = Number(raw.amount), note = line(raw.note, 120), kind = raw.kind === 'purchase' ? 'purchase' : raw.kind === 'adjust' ? 'adjust' : 'grant';
    if (!await pilotRow(this.db, scope)) throw new MarketingStoreError('Bu proje pilotta değil.', 404);
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > LIMITS.grantMax || (kind !== 'adjust' && amount < 0)) throw new MarketingStoreError(`Kredi miktarı 1 ile ${LIMITS.grantMax} arasında olmalı.`);
    if (kind === 'adjust' && await creditBalance(this.db, scope) + amount < 0) throw new MarketingStoreError('Bakiye eksiye düşemez.', 409);
    await this.db.prepare('INSERT INTO platform_sending_credits(id,organization_id,project_id,kind,amount,send_id,note,actor,created_at) VALUES(?,?,?,?,?,NULL,?,?,?)').run(`credit_${randomUUID()}`, scope.organizationId, scope.projectId, kind, amount, note, this.actor, new Date().toISOString());
    await this.audit(scope, `managed.credits.${kind}`);
    return await this.read();
  }
  // A domain bought and prepared by Ryzevo (or registered for the customer); it serves one customer only.
  async addDomain(raw: Json) {
    const domain = salesDomainName(raw.domain), local = typeof raw.fromLocal === 'string' ? raw.fromLocal.trim().toLowerCase() : '', name = line(raw.fromName, 80), renews = line(raw.renewsOn, 10);
    if (!domain) throw new MarketingStoreError('Geçerli bir alan adı yazın (ör. firma-mail.com).');
    if (!/^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/.test(local) || local.includes('..') || /^r-/.test(local)) throw new MarketingStoreError('Gönderen adresinin @ öncesini yazın (ör. ayse veya satis).');
    if (renews && !/^\d{4}-\d{2}-\d{2}$/.test(renews)) throw new MarketingStoreError('Yenileme tarihi YYYY-AA-GG biçiminde olmalı.');
    if (await this.db.prepare('SELECT 1 FROM platform_managed_domains WHERE domain=?').get(domain)) throw new MarketingStoreError('Bu alan adı zaten listede.', 409);
    const now = new Date().toISOString();
    await this.db.prepare("INSERT INTO platform_managed_domains(id,domain,state,organization_id,project_id,registrant,renews_on,from_local,from_name,verified,checked_at,approved_by,approved_at,assigned_at,released_at,note,created_by,created_at,updated_at) VALUES(?,?,'available',NULL,NULL,?,?,?,?,0,NULL,NULL,NULL,NULL,NULL,?,?,?,?)")
      .run(`mdomain_${randomUUID()}`, domain, raw.registrant === 'customer' ? 'customer' : 'ryzevo', renews || null, local, name, line(raw.note, 300), this.actor, now, now);
    await this.audit(null, 'managed.domain.add');
    return await this.read();
  }
  async checkDomain(raw: Json) {
    const row = await this.domain(raw.domainId);
    if (!this.provider) throw new MarketingStoreError('Gönderim sağlayıcısı yapılandırılmadı (PLATFORM_MANAGED_PROVIDER).', 409);
    const result = await this.provider.checkDomain(row.domain);
    await this.db.prepare('UPDATE platform_managed_domains SET verified=?,checked_at=?,updated_at=? WHERE id=?').run(result.verified ? 1 : 0, new Date().toISOString(), new Date().toISOString(), row.id);
    await this.audit(null, `managed.domain.check:${result.verified ? 'ok' : 'missing'}`);
    return await this.read();
  }
  // One domain per customer. A new domain starts without approval, and running sequences pause until a person resumes.
  async assignDomain(raw: Json) {
    const scope = await this.project(raw), row = await this.domain(raw.domainId);
    if (!await pilotRow(this.db, scope)) throw new MarketingStoreError('Önce projeyi pilota ekleyin.', 409);
    if (row.state !== 'available') throw new MarketingStoreError('Bu alan adı başka bir müşteriye ayrılmış veya bırakılmış; alan adları müşteriler arasında paylaşılmaz.', 409);
    const now = new Date().toISOString();
    await this.db.transaction(async () => {
      const old = await domainRow(this.db, scope);
      if (old) await this.db.prepare("UPDATE platform_managed_domains SET state='released',released_at=?,updated_at=? WHERE id=?").run(now, now, old.id);
      await this.db.prepare("UPDATE platform_managed_domains SET state='assigned',organization_id=?,project_id=?,assigned_at=?,approved_by=NULL,approved_at=NULL,updated_at=? WHERE id=? AND state='available'").run(scope.organizationId, scope.projectId, now, now, row.id);
      await pauseForSenderChange(this.db, scope);
      await this.audit(scope, 'managed.domain.assign');
    });
    return await this.read();
  }
  // A released domain is never given to another customer (its reputation belongs to the first one).
  async releaseDomain(raw: Json) {
    const row = await this.domain(raw.domainId);
    if (row.state !== 'assigned') throw new MarketingStoreError('Alan adı bir müşteriye ayrılmış değil.', 409);
    const scope = { organizationId: row.organization_id!, projectId: row.project_id! }, now = new Date().toISOString();
    await this.db.transaction(async () => {
      await this.db.prepare("UPDATE platform_managed_domains SET state='released',released_at=?,updated_at=? WHERE id=?").run(now, now, row.id);
      await pauseForSenderChange(this.db, scope);
      await this.audit(scope, 'managed.domain.release');
    });
    return await this.read();
  }
}
// Whether the managed service tables exist (schema 85); asked outside a transaction.
export async function managedReady(db: Db) { try { await db.prepare('SELECT COUNT(*) AS n FROM platform_managed_pilots WHERE 1=0').get(); return true; } catch { return false; } }
