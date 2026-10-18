import 'server-only';
import type Database from 'better-sqlite3';
import { ProjectMarketingStore, MarketingStoreError, type MarketingScope } from './marketing-store';
import { OAuthRequests } from './oauth-requests';
import { linkedinClient } from './linkedin-client';
import { readSocialJson } from './social-connection';
import { normalizeSocialConfiguration } from './social-configuration';
export const LINKEDIN_BROWSER_COOKIE = 'platform_linkedin_oauth';
export class ProjectLinkedInOAuth {
  constructor(private db: Database.Database, private scope: MarketingScope, private key: string, private clientFactory = linkedinClient) {}
  start(input: { accountName: string; accountId?: string; publishing?: boolean }) {
    new ProjectMarketingStore(this.db, this.scope).connections();
    if (typeof input.accountName !== 'string' || !input.accountName.trim() || input.accountName.length > 160) throw new MarketingStoreError('Hesap adı gerekli.');
    if(input.publishing!==undefined&&typeof input.publishing!=='boolean')throw new MarketingStoreError('Yayın izni seçimi geçersiz.');
    const accountId = input.accountId ? normalizeSocialConfiguration({ platform: 'linkedin', accountId: input.accountId }).accountId : '';
    const client = this.clientFactory(), { state, browser } = new OAuthRequests(this.db, this.scope, this.key).create('linkedin', accountId, input.accountName.trim(), {});
    return { browser, authorizationUrl: client.authorizationUrl(state, input.publishing === true) };
  }
  async complete(state: string, browser: string, code: string, read = readSocialJson) {
    if (!code || code.length > 4096) throw new MarketingStoreError('Yetkilendirme kodu geçersiz.');
    const requests = new OAuthRequests(this.db, this.scope, this.key), pending = requests.claim(state, browser, ['linkedin']);
    try {
      const token = await this.clientFactory().exchange(code);
      const profile = await read('https://api.linkedin.com/v2/userinfo', token.accessToken);
      const social = normalizeSocialConfiguration({ platform: 'linkedin', accountId: profile.sub });
      if (pending.resource && social.accountId !== pending.resource) throw new Error();
      return requests.finish(pending, () => new ProjectMarketingStore(this.db, this.scope).saveConnection({ provider: 'social', integrationId: `linkedin:${social.accountId}`, accountName: pending.account_name, accessToken: token.accessToken, expiresAt: token.expiresAt, social }, this.key));
    } catch {
      requests.discard(pending);
      throw new MarketingStoreError('LinkedIn bağlantısı tamamlanamadı. Proje, hesap ve sağlayıcı izinlerini kontrol edin.');
    }
  }
}
