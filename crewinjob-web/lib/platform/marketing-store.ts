import type { Db } from '../db/client';
import 'server-only';
import { randomBytes,createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { UnifiedCampaign } from '@/lib/campaigns';
import type { HistoryItem } from '@/lib/content-history';
import { PlatformRepository } from './repository';
import { encryptCredentials, type MetaPublishingGrant, type XPublishingGrant, type LinkedInOrganizationGrant , type ChannelPublishingGrant } from './credential-envelope';
import { normalizeSmtpConfiguration, type SmtpConfiguration } from './email-configuration';
import { normalizeSocialConfiguration, type SocialConfiguration } from './social-configuration';
import type { WorkspacePermission } from './access';
import { assertProjectWork } from './entitlements';
import { MarketingStoreError } from './errors';
export { MarketingStoreError } from './errors';

export type MarketingScope = { subject: string; organizationId: string; projectId: string };
type ConnectionRow = { id: string; provider: string; integrationId: string; accountName: string; active: number; updatedAt: string };

export class ProjectMarketingStore {
  private identity: PlatformRepository;
  constructor(private db: Db, private scope: MarketingScope) { this.identity = new PlatformRepository(db); }

  private async authorize(permission: WorkspacePermission) {
    if (!await this.identity.can(this.scope.subject, this.scope.organizationId, this.scope.projectId, permission)) throw new MarketingStoreError('Proje erişimi reddedildi.', 403);
  }

  async listCampaigns(): Promise<UnifiedCampaign[]> {
    await this.authorize('read');
    return (await this.db.prepare('SELECT payload FROM platform_campaigns WHERE organization_id=? AND project_id=? ORDER BY updated_at DESC,id').all(this.scope.organizationId, this.scope.projectId))
      .map(row => JSON.parse((row as { payload: string }).payload));
  }
  async campaign(id: string): Promise<UnifiedCampaign | null> {
    await this.authorize('read');
    const row = await this.db.prepare('SELECT payload FROM platform_campaigns WHERE id=? AND organization_id=? AND project_id=?').get(id, this.scope.organizationId, this.scope.projectId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }
  async saveCampaign(campaign: UnifiedCampaign, creating: boolean) {
    return await this.db.transaction(async () => {
      await this.authorize('content.write');
      const rights=await assertProjectWork(this.db,this.scope);
      if (campaign.status !== 'draft') throw new MarketingStoreError('Gönderim bağlantıları doğrulanana kadar yalnız taslak kaydedilebilir.', 409);
      if(campaign.segmentBinding){
        const binding=campaign.segmentBinding;
        const row=await this.db.prepare('SELECT definition_json,source_id,source_version FROM platform_segment_versions WHERE segment_id=? AND version=? AND organization_id=? AND project_id=?').get(binding.segmentId,binding.segmentVersion,this.scope.organizationId,this.scope.projectId) as {definition_json:string;source_id:string;source_version:number}|undefined;
        if(!row)throw new MarketingStoreError('Kitle sürümü bu projede bulunamadı.',403);
        const definition=JSON.parse(row.definition_json),hash=createHash('sha256').update(JSON.stringify(definition)).digest('hex');
        if(binding.ruleDigest!==hash||binding.sourceId!==row.source_id||binding.sourceVersion!==row.source_version||binding.goalId!==definition.goalId||binding.stageIndex!==definition.stageIndex||binding.goalId&&binding.goalId!==campaign.goalId)throw new MarketingStoreError('Kampanya kitle bağı geçersiz.',409);
      }
      if(creating && (await this.listCampaigns()).length>=rights.limits.campaigns) throw new MarketingStoreError('Kampanya kayıt sınırına ulaşıldı.',429);
      if (creating) await this.db.prepare('INSERT INTO platform_campaigns VALUES(?,?,?,?,?)').run(campaign.id, this.scope.organizationId, this.scope.projectId, JSON.stringify(campaign), campaign.updatedAt);
      else {
        const result = await this.db.prepare('UPDATE platform_campaigns SET payload=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=?').run(JSON.stringify(campaign), campaign.updatedAt, campaign.id, this.scope.organizationId, this.scope.projectId);
        if (!result.changes) throw new MarketingStoreError('Kampanya bulunamadı.', 404);
      }
      await this.audit(creating ? 'campaign.create' : 'campaign.update');
      return campaign;
    });
  }
  async deleteCampaign(id: string) {
    await this.db.transaction(async () => {
      await this.authorize('content.write');
      const result = await this.db.prepare('DELETE FROM platform_campaigns WHERE id=? AND organization_id=? AND project_id=?').run(id, this.scope.organizationId, this.scope.projectId);
      if (!result.changes) throw new MarketingStoreError('Kampanya bulunamadı.', 404);
      await this.audit('campaign.delete');
    });
  }

  async history(): Promise<HistoryItem[]> {
    await this.authorize('read');
    return (await this.db.prepare('SELECT payload FROM platform_content_history WHERE organization_id=? AND project_id=? ORDER BY updated_at DESC,id').all(this.scope.organizationId, this.scope.projectId))
      .map(row => JSON.parse((row as { payload: string }).payload));
  }
  async saveContent(item: HistoryItem, creating: boolean) {
    return await this.db.transaction(async () => {
      await this.authorize('content.write');
      const rights=await assertProjectWork(this.db,this.scope);
      const imageSize=(await this.db.prepare("SELECT COALESCE(SUM(COALESCE(length(json_extract(payload,'$.imageData')),0)+COALESCE(length(json_extract(payload,'$.images')),0)),0) AS n FROM platform_content_history WHERE organization_id=? AND project_id=? AND id<>?").get(this.scope.organizationId,this.scope.projectId,item.id) as {n:number}).n;
      if(imageSize+(item.imageData?.length||0)+(item.images?JSON.stringify(item.images).length:0)>32*1024*1024)throw new MarketingStoreError('Pilot görsel saklama sınırına ulaşıldı.',429);
      if(creating && (await this.history()).length>=rights.limits.content) throw new MarketingStoreError('İçerik kayıt sınırına ulaşıldı.',429);
      if (creating) await this.db.prepare('INSERT INTO platform_content_history VALUES(?,?,?,?,?)').run(item.id, this.scope.organizationId, this.scope.projectId, JSON.stringify(item), new Date().toISOString());
      else {
        const result = await this.db.prepare('UPDATE platform_content_history SET payload=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=?').run(JSON.stringify(item), new Date().toISOString(), item.id, this.scope.organizationId, this.scope.projectId);
        if (!result.changes) throw new MarketingStoreError('İçerik bulunamadı.', 404);
      }
      await this.audit(creating ? 'content.create' : 'content.update');
      return item;
    });
  }
  async deleteContent(id?: string) {
    await this.db.transaction(async () => {
      await this.authorize('content.write');
      const result = id ? await this.db.prepare('DELETE FROM platform_content_history WHERE id=? AND organization_id=? AND project_id=?').run(id, this.scope.organizationId, this.scope.projectId)
        : await this.db.prepare('DELETE FROM platform_content_history WHERE organization_id=? AND project_id=?').run(this.scope.organizationId, this.scope.projectId);
      if (id && !result.changes) throw new MarketingStoreError('İçerik bulunamadı.', 404);
      await this.audit('content.delete');
    });
  }

  async connections() {
    await this.authorize('connections.manage');
    return (await this.db.prepare(`SELECT c.id,c.provider,c.integration_id AS integrationId,c.account_name AS accountName,c.active,c.updated_at AS updatedAt,
      v.status AS verificationStatus,v.checked_at AS checkedAt,v.message AS verificationMessage,
      s.platform AS socialPlatform,s.account_id AS socialAccountId,s.expires_at AS expiresAt,s.page_id AS socialPageId,
      CASE WHEN s.platform='linkedin' AND c.integration_id='linkedin:organization:'||s.account_id THEN 'organization' ELSE 'person' END AS socialAccountType
      FROM platform_connections c LEFT JOIN platform_connection_checks v ON v.connection_id=c.id
      LEFT JOIN platform_social_accounts s ON s.connection_id=c.id
      WHERE c.organization_id=? AND c.project_id=? ORDER BY c.updated_at DESC`)
      .all(this.scope.organizationId, this.scope.projectId)).map(raw => {
        const row = raw as ConnectionRow & { verificationStatus?: string; checkedAt?: string; verificationMessage?: string; expiresAt?: number | null; socialPlatform?: string; socialAccountType?: 'person'|'organization' };
        const fresh = row.checkedAt && Date.now() - Date.parse(row.checkedAt) < 3600000 && (!row.expiresAt || row.expiresAt > Date.now());
        return { ...row, status: !row.active ? 'revoked' : row.verificationStatus === 'verified' && !fresh ? 'verification_expired' : row.verificationStatus || 'configured_not_verified', isConnected: Boolean(row.active && fresh && row.verificationStatus === 'verified') };
      });
  }
  async saveConnection(input: { id?: string; provider: string; integrationId: string; accountName: string; accessToken: string; refreshToken?: string; googleOAuth?: boolean; expiresAt?: number; smtp?: SmtpConfiguration; social?: SocialConfiguration }, keyHex: string, metaPublishing?: MetaPublishingGrant, xPublishing?: XPublishingGrant, linkedinOrganization?:LinkedInOrganizationGrant, channelPublishing?:ChannelPublishingGrant) {
    await this.authorize('connections.manage');
    if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw new MarketingStoreError('Sunucuda PLATFORM_ENCRYPTION_KEY yapılandırılmalı.', 503);
    if (!['email', 'ga4', 'search_console', 'google_ads', 'social', 'product_rest', 'product_webhook', 'mobile'].includes(input.provider) || !input.integrationId?.trim() || input.integrationId.length > 160 || !input.accountName?.trim() || input.accountName.length > 160 || typeof input.accessToken !== 'string' || (!input.accessToken && input.provider !== 'product_rest') || input.accessToken.length > 16384 || (input.refreshToken && input.refreshToken.length > 16384)) throw new MarketingStoreError('Geçerli sağlayıcı, hesap ve bağlantı bilgileri gerekli.');
    let smtp: SmtpConfiguration | undefined;
    if (input.smtp !== undefined) {
      try {
        if (input.provider !== 'email' || /[\r\n\x00]/.test(input.accessToken)) throw new Error();
        smtp = normalizeSmtpConfiguration(input.smtp);
      } catch { throw new MarketingStoreError('SMTP ayarları geçersiz. İzinli sunucu, 465/587 portu ve gönderen adresini kontrol edin.'); }
    }
    let social: SocialConfiguration | undefined;
    if (input.social !== undefined) {
      try { if (input.provider !== 'social' || /[\r\n\x00]/.test(input.accessToken)) throw new Error(); social = normalizeSocialConfiguration(input.social); }
      catch { throw new MarketingStoreError('Sosyal platform veya hesap kimliği geçersiz.'); }
    }
    if (input.expiresAt !== undefined && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0)) throw new MarketingStoreError('Token süresi geçersiz.');
    if (metaPublishing && (!['facebook','instagram'].includes(social?.platform || '') || !input.expiresAt || typeof metaPublishing.userAccessToken !== 'string' || !metaPublishing.userAccessToken || metaPublishing.userAccessToken.length > 16384 || /[\r\n\x00]/.test(metaPublishing.userAccessToken) || !/^\d{1,30}$/.test(metaPublishing.appId))) throw new MarketingStoreError('Meta yayın izni geçersiz.');
    if (xPublishing && (social?.platform !== 'twitter' || !input.expiresAt || !/^[a-f0-9]{64}$/.test(xPublishing.configurationRevision) || !Array.isArray(xPublishing.scopes) || xPublishing.scopes.length > 30 || !xPublishing.scopes.every(scope=>typeof scope==='string'&&/^[a-z._]+$/.test(scope)) || !['tweet.read','users.read','tweet.write'].every(scope=>xPublishing.scopes.includes(scope)))) throw new MarketingStoreError('X yayın izni geçersiz.');
    if(linkedinOrganization&&(social?.platform!=='linkedin'||social.accountType!=='organization'||!input.expiresAt||!/^[A-Za-z0-9_-]{1,128}$/.test(linkedinOrganization.memberSub)||!/^[a-f0-9]{64}$/.test(linkedinOrganization.configurationRevision)||typeof linkedinOrganization.publishing!=='boolean'))throw new MarketingStoreError('LinkedIn şirket izni geçersiz.');
    // TikTok/Pinterest/YouTube connections always carry their grant and a refresh token; no other connection may.
    const channel=['tiktok','pinterest','youtube'].includes(social?.platform||'');
    if(channel!==Boolean(channelPublishing)||channelPublishing&&(!input.expiresAt||!input.refreshToken||/[\r\n\x00]/.test(input.refreshToken)||!/^[a-f0-9]{64}$/.test(channelPublishing.configurationRevision)||!Array.isArray(channelPublishing.scopes)||channelPublishing.scopes.length>30||!channelPublishing.scopes.every(scope=>typeof scope==='string'&&/^[A-Za-z0-9._:/-]{1,120}$/.test(scope))||!Number.isSafeInteger(channelPublishing.accessExpiresAt)||channelPublishing.accessExpiresAt<=0))throw new MarketingStoreError('Kanal yayın izni geçersiz.');
    const integrationId = social ? `${social.platform}:${social.accountType==='organization'?'organization:':''}${social.accountId}` : input.integrationId;
    return await this.db.transaction(async () => {
      await this.authorize('connections.manage');
      let id = input.id;
      if (id) {
        const existing = await this.db.prepare('SELECT id FROM platform_connections WHERE id=? AND organization_id=? AND project_id=?').get(id, this.scope.organizationId, this.scope.projectId);
        if (!existing) throw new MarketingStoreError('Bağlantı bulunamadı.', 404);
      } else {
        const existing = await this.db.prepare('SELECT id FROM platform_connections WHERE organization_id=? AND project_id=? AND provider=? AND integration_id=?').get(this.scope.organizationId, this.scope.projectId, input.provider, integrationId) as { id: string } | undefined;
        id = existing?.id || randomBytes(16).toString('hex');
      }
      const envelope = encryptCredentials({ accessToken: input.accessToken, refreshToken: input.refreshToken || '', ...(input.googleOAuth ? { googleOAuth: true, expiresAt: input.expiresAt } : {}), ...(smtp ? { smtp } : {}), ...(social ? { social, expiresAt: input.expiresAt } : {}), ...(metaPublishing ? { metaPublishing } : {}), ...(xPublishing ? { xPublishing } : {}), ...(channelPublishing?{channelPublishing}:{}), ...(linkedinOrganization?{linkedinOrganization}:{}) }, keyHex, this.scope.organizationId, this.scope.projectId, id);
      const rights=await assertProjectWork(this.db,this.scope);
      const activeSocial=await this.db.prepare("SELECT c.id FROM platform_connections c JOIN platform_social_accounts s ON s.connection_id=c.id WHERE c.organization_id=? AND c.project_id=? AND c.provider='social' AND c.active=1").all(this.scope.organizationId,this.scope.projectId) as {id:string}[];
      if(social && rights.socialAccounts!==null && !activeSocial.some(row=>row.id===id) && activeSocial.length>=rights.socialAccounts)throw new MarketingStoreError('Sosyal hesap sınırına ulaşıldı.',429);
      if (social?.platform === 'twitter' || await this.db.prepare("SELECT connection_id FROM platform_social_accounts WHERE connection_id=? AND platform='twitter'").get(id)) await this.db.prepare("DELETE FROM platform_oauth_requests WHERE organization_id=? AND project_id=? AND provider='x'").run(this.scope.organizationId,this.scope.projectId);
      if (social?.platform === 'linkedin' || await this.db.prepare("SELECT connection_id FROM platform_social_accounts WHERE connection_id=? AND platform='linkedin'").get(id)) await this.db.prepare("DELETE FROM platform_oauth_requests WHERE organization_id=? AND project_id=? AND provider IN ('linkedin','linkedin_organization','linkedin_organization_selection')").run(this.scope.organizationId, this.scope.projectId);
      if (['facebook', 'instagram'].includes(social?.platform || '') || await this.db.prepare("SELECT connection_id FROM platform_social_accounts WHERE connection_id=? AND platform IN ('facebook','instagram')").get(id)) await this.db.prepare("DELETE FROM platform_oauth_requests WHERE organization_id=? AND project_id=? AND provider IN ('meta','meta_selection')").run(this.scope.organizationId, this.scope.projectId);
      if (channel) await this.db.prepare('DELETE FROM platform_oauth_requests WHERE organization_id=? AND project_id=? AND provider=?').run(this.scope.organizationId, this.scope.projectId, social!.platform);
      await this.db.prepare('DELETE FROM platform_channel_tokens WHERE connection_id=?').run(id);
      await this.db.prepare('DELETE FROM platform_oauth_requests WHERE organization_id=? AND project_id=? AND provider=? AND resource=?').run(this.scope.organizationId, this.scope.projectId, input.provider, input.integrationId);
      await this.db.prepare(`INSERT INTO platform_connections VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,integration_id=excluded.integration_id,account_name=excluded.account_name,encrypted_credentials=excluded.encrypted_credentials,active=1,updated_at=excluded.updated_at`)
        .run(id, this.scope.organizationId, this.scope.projectId, input.provider, integrationId, input.accountName, envelope, 1, new Date().toISOString());
      await this.db.prepare('DELETE FROM platform_social_accounts WHERE connection_id=?').run(id);
      if (social) await this.db.prepare('INSERT INTO platform_social_accounts(connection_id,platform,account_id,expires_at,page_id,graph_version) VALUES(?,?,?,?,?,?)').run(id, social.platform, social.accountId, input.expiresAt || null, social.pageId || null, social.graphVersion || null);
      await this.audit('connection.save');
      await this.db.prepare('DELETE FROM platform_connection_checks WHERE connection_id=?').run(id);
      return (await this.connections()).find(item => item.id === id);
    });
  }
  async revokeConnection(id: string) {
    await this.db.transaction(async () => {
      await this.authorize('connections.manage');
      const result = await this.db.prepare('UPDATE platform_connections SET active=0,encrypted_credentials=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=?').run('', new Date().toISOString(), id, this.scope.organizationId, this.scope.projectId);
      if (!result.changes) throw new MarketingStoreError('Bağlantı bulunamadı.', 404);
      if (await this.db.prepare("SELECT connection_id FROM platform_social_accounts WHERE connection_id=? AND platform='twitter'").get(id)) await this.db.prepare("DELETE FROM platform_oauth_requests WHERE organization_id=? AND project_id=? AND provider='x'").run(this.scope.organizationId,this.scope.projectId);
      if (await this.db.prepare("SELECT connection_id FROM platform_social_accounts WHERE connection_id=? AND platform='linkedin'").get(id)) await this.db.prepare("DELETE FROM platform_oauth_requests WHERE organization_id=? AND project_id=? AND provider IN ('linkedin','linkedin_organization','linkedin_organization_selection')").run(this.scope.organizationId, this.scope.projectId);
      if (await this.db.prepare("SELECT connection_id FROM platform_social_accounts WHERE connection_id=? AND platform IN ('facebook','instagram')").get(id)) await this.db.prepare("DELETE FROM platform_oauth_requests WHERE organization_id=? AND project_id=? AND provider IN ('meta','meta_selection')").run(this.scope.organizationId, this.scope.projectId);
      await this.db.prepare(`DELETE FROM platform_oauth_requests WHERE organization_id=? AND project_id=? AND EXISTS (SELECT 1 FROM platform_connections c WHERE c.id=? AND c.provider=platform_oauth_requests.provider AND c.integration_id=platform_oauth_requests.resource)`).run(this.scope.organizationId, this.scope.projectId, id);
      await this.audit('connection.revoke');
    });
  }
  private async audit(operation: string) {
    await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject, this.scope.organizationId, this.scope.projectId, operation, new Date().toISOString());
  }
}
