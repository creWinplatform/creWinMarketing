import type { Db } from '../db/client';
import 'server-only';
import { resolveTxt } from 'node:dns/promises';
import { SESv2Client, CreateEmailIdentityCommand, GetEmailIdentityCommand } from '@aws-sdk/client-sesv2';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials } from './credential-envelope';
import { emailAddress } from './email-safety';
import { emailSenderReadiness } from './email-sender';
import { DOMAIN_CHECKS_PER_DAY, DOMAIN_DMARC, type DomainProof, type DomainRecord, type OutreachDomainView } from './outreach-domain-types';

// Sales assistant: the separate sales sending domain (see outreach-domain-types.ts). Ryzevo adds the domain to the
// project's own Amazon SES account when the key allows it (otherwise the team adds it in the SES console), shows the
// DNS records to copy, and checks them. Sales emails then go from this domain only after every check passes.
type Json = Record<string, unknown>;
type Row = { domain: string; from_local: string; reply_to: string; state: 'pending' | 'verified' | 'failed'; dkim_json: string; proof_json: string | null; checked_at: string | null; first_send_at: string | null };
type Keys = { region: string; accessKeyId: string; secretAccessKey: string };
export type DomainIdentity = { exists: boolean; verified: boolean; dkimStatus: string; tokens: string[] };
// The SES calls, replaceable in tests. create() returns null when the key may not add identities (then the team adds
// the domain in the SES console).
export type DomainApi = { create: (keys: Keys, domain: string) => Promise<DomainIdentity | null>; get: (keys: Keys, domain: string) => Promise<DomainIdentity> };
export type TxtResolver = (name: string) => Promise<string[][]>;
const client = (keys: Keys) => new SESv2Client({ region: keys.region, endpoint: `https://email.${keys.region}.amazonaws.com`, credentials: { accessKeyId: keys.accessKeyId, secretAccessKey: keys.secretAccessKey }, maxAttempts: 1 });
const named = (error: unknown) => String((error as { name?: string })?.name || '');
const identityOf = (value: { VerifiedForSendingStatus?: boolean; DkimAttributes?: { Status?: string; Tokens?: string[] } }): DomainIdentity =>
  ({ exists: true, verified: value.VerifiedForSendingStatus === true, dkimStatus: String(value.DkimAttributes?.Status || 'NOT_STARTED'), tokens: (value.DkimAttributes?.Tokens || []).filter(token => /^[a-z0-9]{20,64}$/i.test(token)).slice(0, 3) });
export const sesDomainApi: DomainApi = {
  async create(keys, domain) {
    const ses = client(keys);
    try { return identityOf(await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: domain }), { abortSignal: AbortSignal.timeout(10000) }) as never); }
    catch (error) {
      if (named(error) === 'AlreadyExistsException') return await sesDomainApi.get(keys, domain);
      if (/AccessDenied|NotAuthorized|UnrecognizedClient|InvalidClientTokenId/.test(named(error))) return null;
      throw error;
    } finally { ses.destroy(); }
  },
  async get(keys, domain) {
    const ses = client(keys);
    try { return identityOf(await ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain }), { abortSignal: AbortSignal.timeout(10000) })); }
    catch (error) { if (named(error) === 'NotFoundException') return { exists: false, verified: false, dkimStatus: 'NOT_STARTED', tokens: [] }; throw error; }
    finally { ses.destroy(); }
  },
};
const txtResolver: TxtResolver = name => Promise.race([resolveTxt(name), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))]);
// A registrable domain name, lower case, without the scheme, "www." or a path.
export function salesDomainName(value: unknown) {
  const text = typeof value === 'string' ? value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '') : '';
  return /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(text) ? text : null;
}
// The registrable part (firma.com, firma.com.tr): a subdomain of the main domain shares its reputation.
export const baseDomain = (domain: string) => { const labels = domain.split('.'); return labels.length > 2 && /^(com|net|org|gen|web|biz|info|av|bel|tv|co|ac|ltd|plc|me|edu|k12|name|tel)$/.test(labels[labels.length - 2]) && labels[labels.length - 1].length === 2 ? labels.slice(-3).join('.') : labels.slice(-2).join('.'); };

// What the sending side needs: the From address and reply address, and whether it may send yet. Null when the project
// sends from its main domain. Empty before schema 84.
export async function salesSender(db: Db, scope: { organizationId: string; projectId: string }) {
  try {
    const row = await db.prepare('SELECT domain,from_local,reply_to,state,first_send_at FROM platform_outreach_domains WHERE organization_id=? AND project_id=?').get(scope.organizationId, scope.projectId) as Pick<Row, 'domain' | 'from_local' | 'reply_to' | 'state' | 'first_send_at'> | undefined;
    return row ? { domain: row.domain, from: `${row.from_local}@${row.domain}`, replyTo: row.reply_to, ready: row.state === 'verified', firstSendAt: row.first_send_at } : null;
  } catch { return null; }
}
// Changing or removing the sender while sequences are running never moves them to another domain by itself: sending
// pauses until a connection manager confirms (Sales settings → Resume).
export async function pauseForSenderChange(db: Db, scope: { organizationId: string; projectId: string }) {
  const running = await db.prepare("SELECT 1 FROM platform_prospect_outreach WHERE organization_id=? AND project_id=? AND state='active' AND sent_steps>0").get(scope.organizationId, scope.projectId);
  if (!running) return false;
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO platform_outreach_settings(organization_id,project_id,from_name,signature,calendar_url,follow_up_days) SELECT ?,?,'','','','[3,7]' WHERE NOT EXISTS (SELECT 1 FROM platform_outreach_settings WHERE organization_id=? AND project_id=?)").run(scope.organizationId, scope.projectId, scope.organizationId, scope.projectId);
  await db.prepare("UPDATE platform_outreach_settings SET paused_reason='sender_changed',paused_at=? WHERE organization_id=? AND project_id=? AND paused_reason IS NULL").run(now, scope.organizationId, scope.projectId);
  return true;
}
export async function markSalesDomainUsed(db: Db, scope: { organizationId: string; projectId: string }, at: string) {
  try { await db.prepare('UPDATE platform_outreach_domains SET first_send_at=? WHERE organization_id=? AND project_id=? AND first_send_at IS NULL').run(at, scope.organizationId, scope.projectId); } catch { /* before schema 84 */ }
}

export class OutreachDomain {
  private repo: PlatformRepository;
  constructor(private db: Db, private scope: MarketingScope, private key: string, private api: DomainApi = sesDomainApi, private dns: TxtResolver = txtResolver) { this.repo = new PlatformRepository(db); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private async authorize(manage: boolean) {
    if (!await this.repo.can(this.scope.subject, ...this.args(), 'read') || (await this.repo.workspace(this.scope.subject, ...this.args()))?.project.productPack !== 'standard') throw new MarketingStoreError('Aday listesi için standart proje erişimi gerekli.', 403);
    if (manage && !await this.repo.can(this.scope.subject, ...this.args(), 'connections.manage')) throw new MarketingStoreError('Satış alan adını bağlantı yöneticisi ayarlar.', 403);
  }
  private async row() { return await this.db.prepare('SELECT * FROM platform_outreach_domains WHERE organization_id=? AND project_id=?').get(...this.args()) as Row | undefined; }
  private async audit(operation: string) { await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, ...this.args(), operation, new Date().toISOString()); }
  private async usage() {
    const day = new Date().toISOString().slice(0, 10), used = (await this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='outreach_domain'").get(...this.args(), day) as { count: number } | undefined)?.count || 0;
    if (used >= DOMAIN_CHECKS_PER_DAY) throw new MarketingStoreError('Bugünkü alan adı kontrol sınırına ulaşıldı. Yarın tekrar deneyin.', 429);
    await this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'outreach_domain',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(), day);
  }
  // The project's own Amazon SES keys (Campaigns → Sender & pilot); the sales domain lives in the same account.
  private async keys(): Promise<Keys> {
    const row = await this.db.prepare('SELECT region,encrypted_credentials FROM platform_email_ses WHERE organization_id=? AND project_id=?').get(...this.args()) as { region: string; encrypted_credentials: string } | undefined;
    if (!row) throw new MarketingStoreError('Önce Amazon SES hesabınızı bağlayın: Kampanyalar → Gönderen ve pilot.', 409);
    return { region: row.region, ...decryptCredentials<{ accessKeyId: string; secretAccessKey: string }>(row.encrypted_credentials, this.key, ...this.args(), 'ses-provider') };
  }
  async view(): Promise<OutreachDomainView> {
    await this.authorize(false);
    const row = await this.row(), sender = await emailSenderReadiness(this.db, this.scope), proof = row?.proof_json ? JSON.parse(row.proof_json) as DomainProof : null;
    const tokens = row ? JSON.parse(row.dkim_json) as string[] : [];
    const records: DomainRecord[] = row ? [
      ...tokens.map(token => ({ type: 'CNAME' as const, name: `${token}._domainkey.${row.domain}`, value: `${token}.dkim.amazonses.com`, purpose: 'dkim' as const, ok: proof ? proof.dkim : null })),
      { type: 'TXT', name: `_dmarc.${row.domain}`, value: DOMAIN_DMARC, purpose: 'dmarc', ok: proof ? proof.dmarc : null },
    ] : [];
    return { configured: Boolean(row), domain: row?.domain || null, fromLocal: row?.from_local || '', replyTo: row?.reply_to || '', fromAddress: row ? `${row.from_local}@${row.domain}` : null, state: row?.state || null, records, proof,
      checkedAt: row?.checked_at || null, firstSendAt: row?.first_send_at || null, mainDomain: sender.domain, sesConnected: Boolean(await this.db.prepare('SELECT 1 FROM platform_email_ses WHERE organization_id=? AND project_id=?').get(...this.args())),
      canManage: await this.repo.can(this.scope.subject, ...this.args(), 'connections.manage') };
  }
  // Saves the domain and, when the SES key allows it, adds it to the SES account at once (DKIM records come back).
  async save(raw: Json) {
    await this.authorize(true);
    const domain = salesDomainName(raw.domain), local = typeof raw.fromLocal === 'string' ? raw.fromLocal.trim().toLowerCase() : '', sender = await emailSenderReadiness(this.db, this.scope);
    if (!domain) throw new MarketingStoreError('Geçerli bir alan adı yazın (ör. firma-mail.com).');
    if (sender.domain && baseDomain(domain) === baseDomain(sender.domain.toLowerCase())) throw new MarketingStoreError('Satış alan adı ana alan adınızdan (ve onun alt alan adlarından) ayrı olmalı; ör. firma-mail.com veya firmahq.com.');
    if (!/^[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?$/.test(local) || local.includes('..')) throw new MarketingStoreError('Gönderen adresinin @ öncesini yazın (ör. ayse veya satis).');
    const replyTo = emailAddress(typeof raw.replyTo === 'string' ? raw.replyTo.trim() : '');
    if (!replyTo) throw new MarketingStoreError('Yanıtların geleceği geçerli bir e-posta adresi yazın (ör. ana adresiniz).');
    if (replyTo.endsWith(`@${domain}`)) throw new MarketingStoreError('Yanıt adresi satış alan adında olmamalı; yanıtlar gerçek kutunuza (ana adresinize) gelsin.');
    const keys = await this.keys(), old = await this.row(), now = new Date().toISOString();
    await this.usage();
    let identity: DomainIdentity | null = null;
    try { identity = await this.api.create(keys, domain); } catch { throw new MarketingStoreError('Amazon SES şu anda yanıt vermiyor. Biraz sonra tekrar deneyin.', 502); }
    const tokens = JSON.stringify(identity?.tokens.length ? identity.tokens : old?.domain === domain ? JSON.parse(old.dkim_json) : []);
    await this.db.transaction(async () => {
      if (old && old.domain === domain) await this.db.prepare('UPDATE platform_outreach_domains SET from_local=?,reply_to=?,dkim_json=?,updated_at=? WHERE organization_id=? AND project_id=?').run(local, replyTo, tokens, now, ...this.args());
      else {
        // A different domain starts again: its own checks and its own warm-up; running sequences wait for a person.
        if (old) await this.db.prepare('DELETE FROM platform_outreach_domains WHERE organization_id=? AND project_id=?').run(...this.args());
        await pauseForSenderChange(this.db, this.scope);
        await this.db.prepare("INSERT INTO platform_outreach_domains(organization_id,project_id,domain,from_local,reply_to,state,dkim_json,proof_json,checked_at,first_send_at,added_by,added_at,updated_at) VALUES(?,?,?,?,?,'pending',?,NULL,NULL,NULL,?,?,?)")
          .run(...this.args(), domain, local, replyTo, tokens, this.scope.subject, now, now);
      }
    });
    await this.audit('prospect.outreach.domain.save');
    return { added: Boolean(identity), view: await this.view() };
  }
  // Reads the SES identity (DKIM records and status) and the DMARC record; sending from the domain starts only when all pass.
  async check() {
    await this.authorize(true);
    const row = await this.row(); if (!row) throw new MarketingStoreError('Önce satış alan adını kaydedin.', 404);
    const keys = await this.keys();
    await this.usage();
    let identity: DomainIdentity;
    try { identity = await this.api.get(keys, row.domain); } catch { throw new MarketingStoreError('Amazon SES şu anda yanıt vermiyor. Biraz sonra tekrar deneyin.', 502); }
    let dmarc = false;
    try { dmarc = (await this.dns(`_dmarc.${row.domain}`)).map(parts => parts.join('')).some(item => /^v=DMARC1\s*;/i.test(item.trim())); } catch { dmarc = false; }
    const proof: DomainProof = { identity: identity.exists && identity.verified, dkim: identity.dkimStatus === 'SUCCESS', dmarc, dkimStatus: identity.dkimStatus };
    const state = proof.identity && proof.dkim && proof.dmarc ? 'verified' : identity.dkimStatus === 'FAILED' ? 'failed' : 'pending';
    await this.db.prepare('UPDATE platform_outreach_domains SET state=?,dkim_json=?,proof_json=?,checked_at=?,updated_at=? WHERE organization_id=? AND project_id=?')
      .run(state, JSON.stringify(identity.tokens.length ? identity.tokens : JSON.parse(row.dkim_json)), JSON.stringify(proof), new Date().toISOString(), new Date().toISOString(), ...this.args());
    await this.audit('prospect.outreach.domain.check');
    return { exists: identity.exists, view: await this.view() };
  }
  // Back to the main domain. Sequences that are running wait until a sender is ready again (see the outreach).
  async remove() {
    await this.authorize(true);
    await this.db.transaction(async () => {
      await this.db.prepare('DELETE FROM platform_outreach_domains WHERE organization_id=? AND project_id=?').run(...this.args());
      await pauseForSenderChange(this.db, this.scope);
      await this.audit('prospect.outreach.domain.remove');
    });
    return { view: await this.view() };
  }
}
