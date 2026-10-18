import 'server-only';
import type Database from 'better-sqlite3';
import { CodeChallengeMethod } from 'google-auth-library';
import { ProjectMarketingStore, MarketingStoreError, type MarketingScope } from './marketing-store';
import { OAuthRequests } from './oauth-requests';
import { GOOGLE_SCOPES, googleClient } from './google-client';
import { verifyGoogleConnection } from './connection-jobs';

export const GOOGLE_BROWSER_COOKIE = 'platform_google_oauth';

export class ProjectGoogleOAuth {
  constructor(private db: Database.Database, private scope: MarketingScope, private key: string, private clientFactory = googleClient) {}
  private authorize() { new ProjectMarketingStore(this.db, this.scope).connections(); }
  async start(input: { provider: string; resource: string; accountName: string }) {
    this.authorize();
    if (!['ga4', 'search_console'].includes(input.provider) || typeof input.resource !== 'string' || !input.resource || input.resource.length > 160 || typeof input.accountName !== 'string' || !input.accountName.trim() || input.accountName.length > 160) throw new MarketingStoreError('Google sağlayıcısı, mülk ve hesap adı gerekli.');
    if (input.provider === 'ga4' && !/^\d{1,20}$/.test(input.resource)) throw new MarketingStoreError('GA4 Property ID sayısal olmalı.');
    if (input.provider === 'search_console' && !/^sc-domain:[a-z0-9.-]+$/i.test(input.resource)) {
      try { const url = new URL(input.resource); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) throw new Error(); }
      catch { throw new MarketingStoreError('Geçerli Search Console mülkü gerekli.'); }
    }
    const client = this.clientFactory(), { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const { state, browser } = new OAuthRequests(this.db, this.scope, this.key).create(input.provider, input.resource, input.accountName.trim(), { codeVerifier });
    return { browser, authorizationUrl: client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [GOOGLE_SCOPES[input.provider]], state, code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256 }) };
  }
  async complete(state: string, browser: string, code: string, verify = verifyGoogleConnection) {
    this.authorize();
    if (!/^[a-zA-Z0-9_-]{43}$/.test(state) || !/^[a-zA-Z0-9_-]{43}$/.test(browser) || !code || code.length > 4096) throw new MarketingStoreError('Google bağlantı isteği geçersiz.', 400);
    const requests = new OAuthRequests(this.db, this.scope, this.key);
    const pending = requests.claim(state, browser, ['ga4', 'search_console']);
    try {
      const { codeVerifier } = requests.secret<{ codeVerifier: string }>(pending);
      const { tokens } = await this.clientFactory().getToken({ code, codeVerifier });
      if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date || !tokens.scope?.split(' ').includes(GOOGLE_SCOPES[pending.provider])) throw new Error();
      const result = await verify(pending.provider, pending.resource, tokens.access_token);
      if (result.status !== 'verified') throw new MarketingStoreError(result.message, 400);
      // Never use the current browser project as a fallback for an earlier OAuth request.
      return requests.finish(pending, () => {
        const store = new ProjectMarketingStore(this.db, this.scope);
        return store.saveConnection({ provider: pending.provider, integrationId: pending.resource, accountName: pending.account_name, accessToken: tokens.access_token!, refreshToken: tokens.refresh_token || '', googleOAuth: true, expiresAt: tokens.expiry_date! }, this.key);
      });
    } catch (error) {
      requests.discard(pending);
      if (error instanceof MarketingStoreError) throw error;
      throw new MarketingStoreError('Google bağlantısı tamamlanamadı. Yeniden bağlanmayı deneyin.', 400);
    }
  }
}
