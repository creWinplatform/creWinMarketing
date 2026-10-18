import 'server-only';

export type SmtpConfiguration = { host: string; port: 465 | 587; user: string; fromEmail: string; fromName: string };
const DEFAULT_HOSTS = ['smtp.sendgrid.net', 'smtp.mailgun.org', 'smtp.eu.mailgun.org', 'smtp-relay.brevo.com', 'smtp.gmail.com', 'smtp.office365.com'];
export function allowedSmtpHost(host: string) {
  const extras = (process.env.PLATFORM_SMTP_ALLOWED_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return DEFAULT_HOSTS.includes(host) || /^email-smtp\.[a-z]{2}(?:-gov)?-[a-z]+-\d\.amazonaws\.com$/.test(host) || extras.includes(host);
}
export function normalizeSmtpConfiguration(raw: unknown): SmtpConfiguration {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('SMTP settings required.');
  const value = raw as Record<string, unknown>;
  const text = (key: string, max: number) => { const field = value[key]; if (typeof field !== 'string' || field.length > max || /[\r\n\x00]/.test(field)) throw new Error('Invalid SMTP settings.'); return field.trim(); };
  const host = text('host', 253).toLowerCase(), user = text('user', 320), fromEmail = text('fromEmail', 254), fromName = value.fromName === undefined ? '' : text('fromName', 160);
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(host) || !host.includes('.') || !allowedSmtpHost(host) || !user || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])\.[a-z]{2,63}$/i.test(fromEmail)) throw new Error('SMTP host, username or sender invalid.');
  if (!host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !fromEmail.split('@')[1].split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) throw new Error('Invalid SMTP domain.');
  if (value.port !== 465 && value.port !== 587) throw new Error('SMTP requires port 465 or 587.');
  return { host, port: value.port, user, fromEmail, fromName };
}
