import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import { SESv2Client, GetEmailIdentityCommand, SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { DeliveryResult } from './email-delivery';

// Managed sales service: the sending provider behind one small interface, so the provider can change without the
// customer noticing. A provider sends one prepared email (only after the last checks pass in beforeSubmit) and says
// whether a domain is ready to send from. Feedback (deliveries, bounces, spam reports) and replies come back through
// /api/mail/managed/* and /api/mail/inbound, in the same normalised form for every provider.
//   PLATFORM_MANAGED_PROVIDER=ses      Amazon SES (only once AWS has accepted this use in writing)
//   PLATFORM_MANAGED_PROVIDER=sandbox  accepts and never transmits (pilot rehearsals and QA)
export type ProviderMail = {
  from: { name: string; address: string }; replyTo: string; to: string; subject: string; text: string; html: string;
  messageId: string; date: string; headers: Record<string, string>; tags: Record<string, string>; tenant: string;
};
export type SendingProvider = {
  id: 'ses' | 'sandbox' | 'test';
  send: (mail: ProviderMail, beforeSubmit: () => boolean | Promise<boolean>) => Promise<DeliveryResult>;
  checkDomain: (domain: string) => Promise<{ verified: boolean; detail: string }>;
};

const tag = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
async function mime(mail: ProviderMail) {
  const composer = new MailComposer({ from: { name: mail.from.name, address: mail.from.address }, to: mail.to, replyTo: mail.replyTo, subject: mail.subject, text: mail.text, html: mail.html, messageId: mail.messageId, date: new Date(mail.date), headers: mail.headers, disableFileAccess: true, disableUrlAccess: true });
  return await new Promise<Buffer>((resolve, reject) => composer.compile().build((error, message) => error ? reject(error) : resolve(message)));
}

export function sesProvider(env: NodeJS.ProcessEnv = process.env): SendingProvider | null {
  const region = env.PLATFORM_MANAGED_SES_REGION || '', accessKeyId = env.PLATFORM_MANAGED_SES_ACCESS_KEY_ID || '', secretAccessKey = env.PLATFORM_MANAGED_SES_SECRET_ACCESS_KEY || '', configurationSet = env.PLATFORM_MANAGED_SES_CONFIGURATION_SET || '';
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region) || !/^AKIA[A-Z0-9]{16}$/.test(accessKeyId) || !/^[A-Za-z0-9/+=]{40}$/.test(secretAccessKey) || !/^[a-zA-Z0-9_-]{1,64}$/.test(configurationSet)) return null;
  // SES tenants keep each customer's reputation apart (the account-level rules still apply to everyone).
  const tenants = env.PLATFORM_MANAGED_SES_TENANTS === '1';
  const client = () => new SESv2Client({ region, endpoint: `https://email.${region}.amazonaws.com`, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 1 });
  return {
    id: 'ses',
    async send(mail, beforeSubmit) {
      let raw: Buffer; try { raw = await mime(mail); } catch { return { state: 'blocked', providerMessageId: null }; }
      const ses = client(); let submitted = false;
      try {
        if (!await beforeSubmit()) return { state: 'blocked', providerMessageId: null };
        submitted = true;
        const result = await ses.send(new SendEmailCommand({
          Content: { Raw: { Data: raw } }, ConfigurationSetName: configurationSet, ...(tenants ? { TenantName: `ryzevo-${tag(mail.tenant)}`.slice(0, 64) } : {}),
          EmailTags: Object.entries(mail.tags).map(([Name, Value]) => ({ Name: tag(Name), Value: tag(Value) })),
        }), { abortSignal: AbortSignal.timeout(15000) });
        return result.MessageId ? { state: 'accepted', providerMessageId: result.MessageId } : { state: 'uncertain', providerMessageId: null };
      } catch (error) {
        const name = String((error as { name?: string })?.name || '');
        if (!submitted) return { state: 'blocked', providerMessageId: null };
        return /MessageRejected|MailFromDomainNotVerified|AccountSuspended|SendingPaused|BadRequest|NotFound|LimitExceeded/.test(name) ? { state: 'rejected', providerMessageId: null } : { state: 'uncertain', providerMessageId: null };
      } finally { ses.destroy(); }
    },
    async checkDomain(domain) {
      const ses = client();
      try {
        const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain }), { abortSignal: AbortSignal.timeout(10000) });
        const verified = identity.VerifiedForSendingStatus === true && identity.DkimAttributes?.Status === 'SUCCESS';
        return { verified, detail: verified ? 'ok' : `dkim:${identity.DkimAttributes?.Status || 'unknown'}` };
      } catch (error) { return { verified: false, detail: String((error as { name?: string })?.name || 'error').slice(0, 60) }; }
      finally { ses.destroy(); }
    },
  };
}
// Never transmits: for a pilot rehearsal before a provider has accepted the use, and for QA.
export const sandboxProvider: SendingProvider = {
  id: 'sandbox',
  async send(_mail, beforeSubmit) { return await beforeSubmit() ? { state: 'accepted', providerMessageId: `sandbox-${randomBytes(9).toString('hex')}` } : { state: 'blocked', providerMessageId: null }; },
  async checkDomain() { return { verified: true, detail: 'sandbox' }; },
};
export function managedProvider(env: NodeJS.ProcessEnv = process.env): SendingProvider | null {
  return env.PLATFORM_MANAGED_PROVIDER === 'ses' ? sesProvider(env) : env.PLATFORM_MANAGED_PROVIDER === 'sandbox' ? sandboxProvider : null;
}
export const managedSendingEnabled = (env: NodeJS.ProcessEnv = process.env) => env.PLATFORM_MANAGED_SENDING_ENABLED === '1';

// Each sequence has its own reply address on the customer's managed domain: r-<sequence>.<check>@domain. The check is
// keyed with the server's key, so a made-up address is never matched to a sequence.
const mac = (key: string, id: string) => createHmac('sha256', Buffer.from(key, 'hex')).update(`ryzevo-reply-v1:${id}`).digest('hex').slice(0, 12);
export function replyAddress(key: string, outreachId: string, domain: string) {
  const hex = outreachId.replace(/^outreach_/, '').replace(/-/g, '');
  if (!/^[a-f0-9]{32}$/.test(hex)) throw new Error('Invalid sequence id.');
  return `r-${hex}.${mac(key, outreachId)}@${domain}`;
}
export function readReplyAddress(key: string, address: string) {
  const match = /^r-([a-f0-9]{32})\.([a-f0-9]{12})@/i.exec(address.trim().toLowerCase());
  if (!match) return null;
  const hex = match[1], id = `outreach_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const expected = Buffer.from(mac(key, id)), given = Buffer.from(match[2]);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}
