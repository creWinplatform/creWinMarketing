// Sales assistant: a separate sales sending domain. Cold email can draw spam reports; sent from the main domain they
// would also hurt the newsletters, invoices and everyday mail of that domain. A second domain (for example
// firma-mail.com) added to the same Amazon SES account carries only the sales emails; replies still go to the team's
// real address. Pure data shared by the server and the browser.
export type DomainRecord = { type: 'CNAME' | 'TXT'; name: string; value: string; purpose: 'dkim' | 'dmarc'; ok: boolean | null };
export type DomainProof = { identity: boolean; dkim: boolean; dmarc: boolean; dkimStatus: string };
export type OutreachDomainView = {
  configured: boolean; domain: string | null; fromLocal: string; replyTo: string; fromAddress: string | null;
  state: 'pending' | 'verified' | 'failed' | null; records: DomainRecord[]; proof: DomainProof | null; checkedAt: string | null; firstSendAt: string | null;
  // The project's main sender domain and whether Amazon SES is connected (the sales domain uses the same account).
  mainDomain: string | null; sesConnected: boolean; canManage: boolean;
};
export const DOMAIN_DMARC = 'v=DMARC1; p=none;';
export const DOMAIN_CHECKS_PER_DAY = 20;
