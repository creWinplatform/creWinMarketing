// ─── Legacy Crewin panel: can this address's domain receive email? ──────────────────────────────────────────
// AI research sometimes returns domains that do not exist (an email there always bounces and hurts the sender's
// reputation). This checks DNS only: the domain's mail servers (MX). Nothing is sent and no mailbox is probed, so a
// domain with MX can still reject one particular address (e.g. info@).
import { Resolver } from 'node:dns/promises';

export type EmailDomainStatus = 'mx' | 'no_mx' | 'not_found' | 'error';
export type EmailDomainResult = { domain: string; status: EmailDomainStatus; mx: string[] };

const HOUR = 3600000, cache = new Map<string, { at: number; result: EmailDomainResult }>();
const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function emailDomain(email: string): string | null {
  const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
  return DOMAIN_RE.test(domain) ? domain : null;
}

type MxResolver = { resolveMx: (domain: string) => Promise<{ exchange: string; priority: number }[]> };
function defaultResolver(): MxResolver {
  const resolver = new Resolver({ timeout: 5000, tries: 2 });
  return resolver;
}

export async function checkDomain(domain: string, resolver: MxResolver = defaultResolver(), now = Date.now()): Promise<EmailDomainResult> {
  const cached = cache.get(domain);
  if (cached && now - cached.at < HOUR) return cached.result;
  let result: EmailDomainResult;
  try {
    // A null MX ("." — RFC 7505) means the domain explicitly accepts no email.
    const mx = (await resolver.resolveMx(domain)).filter(item => item.exchange && item.exchange !== '.').sort((a, b) => a.priority - b.priority).map(item => item.exchange.toLowerCase());
    result = { domain, status: mx.length ? 'mx' : 'no_mx', mx: mx.slice(0, 3) };
  } catch (error) {
    const code = (error as { code?: string }).code;
    result = { domain, status: code === 'ENOTFOUND' ? 'not_found' : code === 'ENODATA' ? 'no_mx' : 'error', mx: [] };
  }
  // Temporary DNS failures are not remembered.
  if (result.status !== 'error') cache.set(domain, { at: now, result });
  return result;
}

/** Results by lower-cased email; invalid addresses get 'not_found'. At most 200 addresses, 8 lookups at a time. */
export async function checkEmailDomains(emails: string[], resolver?: MxResolver): Promise<Record<string, EmailDomainResult>> {
  const list = Array.from(new Set(emails.map(item => String(item || '').trim().toLowerCase()).filter(Boolean))).slice(0, 200);
  const domains = Array.from(new Set(list.map(emailDomain).filter((item): item is string => Boolean(item))));
  const byDomain = new Map<string, EmailDomainResult>();
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(8, domains.length) }, async () => {
    while (index < domains.length) { const domain = domains[index++]; byDomain.set(domain, await checkDomain(domain, resolver)); }
  }));
  return Object.fromEntries(list.map(email => {
    const domain = emailDomain(email);
    return [email, domain ? byDomain.get(domain)! : { domain: '', status: 'not_found' as const, mx: [] }];
  }));
}
