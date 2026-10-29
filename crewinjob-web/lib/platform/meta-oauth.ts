import 'server-only';
import type Database from 'better-sqlite3';
import { OAuthRequests } from './oauth-requests';
import { ProjectMarketingStore, MarketingStoreError, type MarketingScope } from './marketing-store';
import { metaClient } from './meta-client';
import { readSocialJson } from './social-connection';

export const META_BROWSER_COOKIE = 'platform_meta_oauth';
export const META_SELECTION_COOKIE = 'platform_meta_selection';
type Page = { id: string; name: string; token: string; instagramId?: string; instagramUsername?: string; cursor?: string };
type Grant = { accessToken: string; expiresAt: number; graphVersion: string; appId?: string; publishing?: boolean; pages: Page[]; nextCursor?: string; loaded: boolean };
const numericId = (value: unknown): value is string => typeof value === 'string' && /^\d{1,30}$/.test(value);

export class ProjectMetaOAuth {
  private requests: OAuthRequests;
  constructor(private db: Database.Database, private scope: MarketingScope, private key: string, private clientFactory = metaClient, private read = readSocialJson) { this.requests = new OAuthRequests(db, scope, key); }
  start(target: string, publishing = false, inbox = false) {
    new ProjectMarketingStore(this.db, this.scope).connections();
    if (!['facebook', 'instagram'].includes(target)) throw new MarketingStoreError('Facebook veya Instagram seçin.');
    if (typeof publishing !== 'boolean') throw new MarketingStoreError('Geçerli yayın izni seçimi gerekli.');
    if (typeof inbox !== 'boolean') throw new MarketingStoreError('Geçerli gelen kutusu izni seçimi gerekli.');
    const client = this.clientFactory(), { state, browser } = this.requests.create('meta', target, target, { publishing });
    return { browser, authorizationUrl: client.authorizationUrl(state, target, publishing, inbox) };
  }
  async complete(state: string, browser: string, code: string) {
    if (!code || code.length > 4096) throw new MarketingStoreError('Yetkilendirme kodu geçersiz.');
    const pending = this.requests.claim(state, browser, ['meta']);
    try {
      const client = this.clientFactory(), token = await client.exchange(code), { publishing } = this.requests.secret<{publishing?:boolean}>(pending);
      return this.requests.finish(pending, () => {
        const selected = this.requests.create('meta_selection', pending.resource, pending.account_name, { ...token, graphVersion: client.graphVersion, ...(publishing ? {publishing:true,appId:client.appId} : {}), pages: [], loaded: false });
        return `${selected.state}.${selected.browser}`;
      });
    } catch { this.requests.discard(pending); throw new MarketingStoreError('Meta bağlantısı tamamlanamadı. Uygulama ve izinleri kontrol edin.'); }
  }
  private selection(cookie: string, claim = false) {
    const [state, browser, extra] = cookie.split('.');
    if (extra !== undefined) throw new MarketingStoreError('Seçim isteği geçersiz.', 403);
    const pending = claim ? this.requests.claim(state || '', browser || '', ['meta_selection']) : this.requests.get(state || '', browser || '', ['meta_selection']);
    const grant = this.requests.secret<Grant>(pending);
    if (grant.expiresAt <= Date.now()) throw new MarketingStoreError('Meta izni süresi dolmuş. Yeniden bağlanın.', 409);
    return { pending, grant };
  }
  private async pages(grant: Grant, target: string, cursor?: string) {
    const url = new URL(`https://graph.facebook.com/${grant.graphVersion}/me/accounts`);
    url.searchParams.set('fields', target === 'instagram' ? 'id,name,access_token,instagram_business_account{id,username}' : 'id,name,access_token');
    url.searchParams.set('limit', '50');
    if (cursor) url.searchParams.set('after', cursor);
    const response = await this.read(url.href, grant.accessToken);
    if (!Array.isArray(response.data) || response.data.length > 50) throw new Error('Invalid page list.');
    const pages: Page[] = response.data.map(raw => {
      const page = raw as Record<string, unknown>, instagram = page.instagram_business_account as Record<string, unknown> | undefined;
      if (!numericId(page.id) || typeof page.name !== 'string' || typeof page.access_token !== 'string' || !page.access_token || page.access_token.length > 16384) throw new Error('Invalid page credentials.');
      return { id: page.id, name: page.name.slice(0, 160), token: page.access_token, ...(cursor ? { cursor } : {}), ...(numericId(instagram?.id) && typeof instagram?.username === 'string' && instagram.username.trim() ? { instagramId: instagram.id, instagramUsername: instagram.username.slice(0, 160) } : {}) };
    });
    const paging = response.paging as { next?: string; cursors?: { after?: string } } | undefined;
    const nextCursor = paging?.next ? paging.cursors?.after : undefined;
    if (nextCursor !== undefined && (typeof nextCursor !== 'string' || !nextCursor || nextCursor === cursor || nextCursor.length > 2048 || /[\r\n\x00]/.test(nextCursor))) throw new Error('Invalid page cursor.');
    return { pages, nextCursor };
  }
  async list(cookie: string, more = false) {
    const { pending, grant } = this.selection(cookie);
    if (!grant.loaded || (more && grant.nextCursor && grant.pages.length < 200)) {
      try {
        const batch = await this.pages(grant, pending.resource, grant.loaded ? grant.nextCursor : undefined);
        const pages = new Map(grant.pages.map(page => [page.id, page]));
        for (const page of batch.pages) pages.set(page.id, page);
        if (pages.size > 200) throw new Error('Page limit exceeded.');
        grant.pages = Array.from(pages.values()); grant.nextCursor = batch.nextCursor; grant.loaded = true;
        this.requests.replaceSecret(pending, grant);
      } catch { throw new MarketingStoreError('Meta sayfaları alınamadı. İzinleri kontrol edin veya yeniden bağlanın.'); }
    }
    return { target: pending.resource, publishing: grant.publishing === true, items: grant.pages.map(page => ({ id: page.id, name: page.name, instagramId: page.instagramId || null, instagramUsername: page.instagramUsername || null })), hasMore: Boolean(grant.nextCursor && grant.pages.length < 200), limitReached: Boolean(grant.nextCursor && grant.pages.length >= 200) };
  }
  async select(cookie: string, pageId: string) {
    if (!numericId(pageId)) throw new MarketingStoreError('Geçerli sayfa seçin.');
    const { pending, grant } = this.selection(cookie, true);
    try {
      const cached = grant.pages.find(page => page.id === pageId);
      if (!cached) throw new Error();
      const batch = await this.pages(grant, pending.resource, cached.cursor);
      const page = batch.pages.find(item => item.id === pageId);
      if (!page || (pending.resource === 'instagram' && (!page.instagramId || !page.instagramUsername || page.instagramId !== cached.instagramId))) throw new Error();
      const instagram = pending.resource === 'instagram';
      const social = { platform: instagram ? 'instagram' as const : 'facebook' as const, accountId: instagram ? page.instagramId! : page.id, graphVersion: grant.graphVersion, ...(instagram ? { pageId: page.id } : {}) };
      return this.requests.finish(pending, () => new ProjectMarketingStore(this.db, this.scope).saveConnection({ provider: 'social', integrationId: `${social.platform}:${social.accountId}`, accountName: (instagram ? page.instagramUsername! : page.name).slice(0, 160), accessToken: page.token, expiresAt: grant.expiresAt, social }, this.key, grant.publishing ? {userAccessToken:grant.accessToken,appId:grant.appId!} : undefined));
    } catch { this.requests.discard(pending); throw new MarketingStoreError('Seçilen sayfa veya Instagram bağlantısı değişti. Yeniden bağlanın.'); }
  }
  cancel(cookie: string) { const { pending } = this.selection(cookie); this.requests.discard(pending); }
}
