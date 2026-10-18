import 'server-only';
import { normalizeSocialConfiguration, type SocialConfiguration } from './social-configuration';
export async function readSocialJson(url: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['api.linkedin.com', 'api.x.com', 'graph.facebook.com'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.port || parsed.searchParams.has('access_token')) throw new Error('Invalid provider URL.');
  const headers = new Headers(init.headers); headers.set('Accept', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const timeout = AbortSignal.timeout(12000);
  const response = await fetch(url, { ...init, headers, cache: 'no-store', redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Social account access failed.'); }
  const payload = await readSocialResponse(response);
  if (payload.error || payload.errors) throw new Error('Invalid provider response.');
  return payload;
}
export async function readSocialResponse(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty provider response.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) throw new Error('Provider response too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid provider response.');
  return payload;
}
export async function verifySocialConnection(raw: SocialConfiguration, token: string, expiresAt?: number) {
  try {
    const settings = normalizeSocialConfiguration(raw);
    if (!token || token.length > 16384 || /[\r\n\x00]/.test(token) || (expiresAt !== undefined && expiresAt <= Date.now())) throw new Error();
    if(settings.platform==='linkedin'&&settings.accountType==='organization'){
      const {checkLinkedInOrganizationReadAccess}=await import('./linkedin-organization-publishing');
      await checkLinkedInOrganizationReadAccess(token,settings.accountId);
      return {status:'verified' as const,message:'LinkedIn şirket sayfası erişimi eşleştirildi. Yayın izni henüz doğrulanmadı.'};
    }
    if (settings.platform === 'facebook' || settings.platform === 'instagram') {
      const url = new URL(`https://graph.facebook.com/${settings.graphVersion}/me`);
      url.searchParams.set('fields', settings.platform === 'facebook' ? 'id,name' : 'id,name,instagram_business_account{id,username}');
      const page = await readSocialJson(url.href, token);
      const instagram = page.instagram_business_account as Record<string, unknown> | undefined;
      if (settings.platform === 'facebook' ? page.id !== settings.accountId : page.id !== settings.pageId || instagram?.id !== settings.accountId || typeof instagram.username !== 'string' || !instagram.username) throw new Error();
      return { status: 'verified' as const, message: 'Meta sayfa ve hesap erişimi eşleştirildi. Yayın izni henüz doğrulanmadı.' };
    }
    const payload = await readSocialJson(settings.platform === 'linkedin' ? 'https://api.linkedin.com/v2/userinfo' : 'https://api.x.com/2/users/me', token);
    const id = settings.platform === 'linkedin' ? payload.sub : (payload.data as Record<string, unknown> | undefined)?.id;
    if (id !== settings.accountId) throw new Error();
    return { status: 'verified' as const, message: 'Sosyal hesap erişimi eşleştirildi. Paylaşım yetkisi ve yayın henüz doğrulanmadı.' };
  } catch { return { status: 'failed' as const, message: 'Sosyal hesap eşleştirilemedi. Hesap kimliği, token süresi ve sağlayıcı izinlerini kontrol edin.' }; }
}
