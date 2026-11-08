import type { Db } from '../db/client';
import 'server-only';
import type Database from 'better-sqlite3';
import { ProjectMarketingStore, MarketingStoreError, type MarketingScope } from './marketing-store';
import { OAuthRequests } from './oauth-requests';
import { normalizeSocialConfiguration } from './social-configuration';
import { CHANNEL_PLATFORMS, channelAuthorizationUrl, channelConfiguration, exchangeChannelCode, isChannelPlatform, newChannelVerifier, readChannelAccount, type ChannelHttp, type ChannelPlatform, channelHttp } from './channel-publishing';

export const CHANNEL_BROWSER_COOKIE = 'platform_channel_oauth';
type Pending = { verifier: string; revision: string; boardId?: string };
// Connecting a TikTok account, a Pinterest board or a YouTube channel: the same OAuth request store, browser binding
// and connection vault as X. The connection always carries the publishing grant; posting still needs approval.
export class ProjectChannelOAuth {
  constructor(private db: Db, private scope: MarketingScope, private key: string, private http: ChannelHttp = channelHttp) {}
  async start(input: { platform: unknown; accountName: unknown; boardId?: unknown }) {
    await new ProjectMarketingStore(this.db, this.scope).connections();
    const platform = String(input.platform);
    if (!isChannelPlatform(platform)) throw new MarketingStoreError('Kanal geçersiz.');
    if (typeof input.accountName !== 'string' || !input.accountName.trim() || input.accountName.length > 160) throw new MarketingStoreError('Hesap adı geçersiz.');
    if (platform === 'pinterest' && (typeof input.boardId !== 'string' || !/^\d{1,30}$/.test(input.boardId))) throw new MarketingStoreError('Pinterest pano kimliği gerekli (yalnız rakam).');
    let revision: string;
    try { revision = channelConfiguration(platform).revision; } catch { throw new MarketingStoreError('Bu kanalın uygulaması sunucuda yapılandırılmamış.', 503); }
    const verifier = newChannelVerifier(), result = await new OAuthRequests(this.db, this.scope, this.key).create(platform, '', input.accountName.trim(), { verifier, revision, ...(platform === 'pinterest' ? { boardId: input.boardId as string } : {}) });
    return { browser: result.browser, authorizationUrl: channelAuthorizationUrl(platform, result.state, verifier) };
  }
  async complete(state: string, browser: string, code: string) {
    if (!code || code.length > 4096) throw new MarketingStoreError('Yetkilendirme kodu geçersiz.');
    const requests = new OAuthRequests(this.db, this.scope, this.key), pending = await requests.claim(state, browser, [...CHANNEL_PLATFORMS]), platform = pending.provider as ChannelPlatform;
    try {
      const secret = requests.secret<Pending>(pending);
      if (channelConfiguration(platform).revision !== secret.revision || !/^[a-zA-Z0-9_-]{43}$/.test(secret.verifier)) throw new Error();
      const token = await exchangeChannelCode(platform, code, secret.verifier, this.http);
      const account = await readChannelAccount(platform, token.accessToken, { boardId: secret.boardId, openId: token.openId }, this.http);
      const social = normalizeSocialConfiguration({ platform, accountId: account.accountId });
      if (channelConfiguration(platform).revision !== secret.revision) throw new Error();
      const saved = await requests.finish(pending, async () => await new ProjectMarketingStore(this.db, this.scope).saveConnection({ provider: 'social', integrationId: `${platform}:${social.accountId}`, accountName: pending.account_name, accessToken: token.accessToken, refreshToken: token.refreshToken, expiresAt: token.refreshExpiresAt, social }, this.key, undefined, undefined, undefined, { configurationRevision: secret.revision, scopes: token.scopes, accessExpiresAt: token.expiresAt }));
      return { platform, connection: saved };
    } catch {
      await requests.discard(pending);
      throw new MarketingStoreError('Kanal bağlantısı tamamlanamadı. Proje, hesap ve uygulama izinlerini kontrol edin.');
    }
  }
}
