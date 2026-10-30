import 'server-only';
import type { IysChannel, IysEnvironment, IysSource, IysStatus } from './iys-types';

// A thin client for the İYS brand API. Paths follow İYS's published service-provider API (token, consents, status,
// changes); check them against the current İYS documentation when the account is set up. Secrets never appear in errors.
export const IYS_BASE: Record<IysEnvironment, string> = { production: 'https://api.iys.org.tr', sandbox: 'https://api.sandbox.iys.org.tr' };
export type IysCredentials = { username: string; password: string; iysCode: string; brandCode: string; environment: IysEnvironment };
export type IysTransport = (request: { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; body: unknown }>;
export type IysConsent = { recipient: string; type: IysChannel; status: IysStatus; source: IysSource | string; consentDate: string };
export class IysError extends Error {
  constructor(public code: 'auth' | 'brand' | 'rejected' | 'unavailable' | 'format', message: string) { super(message); }
}
export const fetchTransport: IysTransport = async request => {
  const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal: AbortSignal.timeout(15000), cache: 'no-store' });
  let body: unknown = null; try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
};
const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export class IysClient {
  private token = '';
  constructor(private credentials: IysCredentials, private transport: IysTransport = fetchTransport) {}
  private url(path: string) { return IYS_BASE[this.credentials.environment] + path; }
  private brandPath(suffix: string) { return `/sps/${encodeURIComponent(this.credentials.iysCode)}/brands/${encodeURIComponent(this.credentials.brandCode)}${suffix}`; }
  private async send(method: 'GET' | 'POST', path: string, body?: unknown, auth = true) {
    let response: { status: number; body: unknown };
    try { response = await this.transport({ method, url: this.url(path), headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(auth ? { Authorization: `Bearer ${this.token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw new IysError('unavailable', 'İYS’ye ulaşılamadı.'); }
    return response;
  }
  async login() {
    const response = await this.send('POST', '/oauth2/token', { username: this.credentials.username, password: this.credentials.password, grant_type: 'password' }, false);
    const token = record(response.body).access_token;
    if (response.status === 401 || response.status === 400 || response.status === 403) throw new IysError('auth', 'İYS kullanıcı adı veya şifresi kabul edilmedi.');
    if (response.status !== 200 || typeof token !== 'string' || !token) throw new IysError('unavailable', 'İYS oturumu açılamadı.');
    this.token = token;
  }
  // One request with the current token; an expired token is renewed once.
  private async call(method: 'GET' | 'POST', path: string, body?: unknown) {
    if (!this.token) await this.login();
    let response = await this.send(method, path, body);
    if (response.status === 401) { await this.login(); response = await this.send(method, path, body); }
    if (response.status >= 500 || response.status === 429) throw new IysError('unavailable', `İYS geçici olarak yanıt vermedi (${response.status}).`);
    return response;
  }
  // The brand code must be one of the account's brands.
  async verify() {
    const response = await this.call('GET', `/sps/${encodeURIComponent(this.credentials.iysCode)}/brands`);
    if (response.status === 403 || response.status === 404) throw new IysError('brand', 'İYS kodu bu kullanıcıya ait değil.');
    const list = Array.isArray(response.body) ? response.body : Array.isArray(record(response.body).list) ? record(response.body).list as unknown[] : null;
    if (response.status !== 200 || !list) throw new IysError('format', 'İYS marka listesi okunamadı.');
    if (!list.some(item => String(record(item).brandCode) === this.credentials.brandCode)) throw new IysError('brand', 'Marka kodu bu İYS hesabında bulunamadı.');
  }
  async addConsent(consent: IysConsent) {
    const response = await this.call('POST', this.brandPath('/consents'), { ...consent, recipientType: 'BIREYSEL' });
    if (response.status === 200 || response.status === 201) { const id = record(response.body).transactionId; return { transactionId: typeof id === 'string' || typeof id === 'number' ? String(id) : null }; }
    const errors = record(response.body).errors, first = Array.isArray(errors) ? record(errors[0]) : {}, code = typeof first.code === 'string' ? first.code : String(response.status);
    throw new IysError('rejected', `İYS kaydı kabul etmedi (${code.slice(0, 40)}).`);
  }
  // The current consent of one recipient for one channel; null when İYS has none.
  async status(recipient: string, type: IysChannel): Promise<{ status: IysStatus; consentDate: string | null; source: string | null } | null> {
    const response = await this.call('POST', this.brandPath('/consents/status'), { recipient, recipientType: 'BIREYSEL', type });
    if (response.status === 404) return null;
    const body = record(response.body), status = body.status;
    if (response.status !== 200) throw new IysError('format', `İYS durumu okunamadı (${response.status}).`);
    if (status !== 'ONAY' && status !== 'RET') return null;
    return { status, consentDate: typeof body.consentDate === 'string' ? body.consentDate : null, source: typeof body.source === 'string' ? body.source : null };
  }
  // Consent changes on İYS's side since the last cursor (recipients who changed their mind through İYS).
  async changes(after: string | null) {
    const response = await this.call('GET', this.brandPath('/consents/changes') + (after ? `?after=${encodeURIComponent(after)}` : ''));
    if (response.status !== 200) throw new IysError('format', `İYS değişiklikleri okunamadı (${response.status}).`);
    const body = record(response.body), list = Array.isArray(body.list) ? body.list : Array.isArray(response.body) ? response.body as unknown[] : [];
    const next = typeof body.after === 'string' || typeof body.after === 'number' ? String(body.after) : after;
    return { next, list: list.map(record).filter(item => typeof item.recipient === 'string' && (item.status === 'ONAY' || item.status === 'RET') && (item.type === 'EPOSTA' || item.type === 'MESAJ'))
      .map(item => ({ recipient: item.recipient as string, type: item.type as IysChannel, status: item.status as IysStatus, consentDate: typeof item.consentDate === 'string' ? item.consentDate : null })) };
  }
}
