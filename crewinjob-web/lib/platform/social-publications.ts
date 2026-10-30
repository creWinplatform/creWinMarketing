import 'server-only';
import {assertProjectWork,assertProjectDelivery} from './entitlements';
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { ProjectMarketingStore, MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials, encryptCredentials, type StoredCredentials } from './credential-envelope';
import { linkedinPublishingConfiguration, socialPublishingEnabled, checkLinkedInPublishing, publishLinkedInText, publishLinkedInOrganizationText, type PublishCheck, type PublishTransport, type PublishResult } from './linkedin-publishing';
import { checkLinkedInOrganizationPublishing } from './linkedin-organization-publishing';
import { isLinkedInOrganization } from './social-configuration';
import { facebookPublishingConfiguration, checkFacebookPublishing, publishFacebookText, publishFacebookImage, publishFacebookVideo, publishFacebookReel, facebookVideoId, validFacebookPost } from './facebook-publishing';
import { VIDEO_FORMATS, checkPublicationVideo, readVideoHeaders, sameVideo, type ContentVideo, type PublicationVideo, type VideoReader } from './social-video';
import { instagramPublishingConfiguration, checkInstagramPublishing, instagramPublisher, instagramId, instagramPermalink, type InstagramPublisher } from './instagram-publishing';
import { normalizePublicationImages, type PublicationImage } from './publication-image';
import { xConfiguration } from './x-client';
import { checkXPublishing, publishXText, xPostId } from './x-publishing';
import { xText } from './x-text';
import { hasMessagingDuty } from './messaging-duties';
import { publishLinkedInImage, publishLinkedInOrganizationImage, publishXImage } from './social-image-publishing';
import { TELEGRAM_TEXT_LIMIT, checkTelegramPublishing, publishTelegramText, telegramPostId, telegramPublishingConfiguration } from './telegram-publishing';
import type { Publication, PublicationSource, PublicationWorkspace, PublicationEngagement, EngagementCounts } from './social-publication-types';
import { cleanEngagementCounts, readPublicationEngagement, type EngagementReader } from './social-engagement';
import { LinkTracking, linkTag, linkTrackingEnabled, tagOwnLinks } from './link-tracking';
import { LINK_SOURCES } from './link-tracking-types';
import { ProjectAttribution } from './attribution';

type Connection = { id: string; account_name: string; encrypted_credentials: string; account_id: string; platform: string; expires_at: number | null; integration_id:string; accountType?:'organization' };
type Snapshot = { title: string; text: string; accountName: string; accountId: string; platform?: string; accountType?:'organization'; image?: PublicationImage; images?: PublicationImage[]; video?: PublicationVideo; story?: boolean };
const snapshotImages=(snapshot:Snapshot)=>snapshot.images|| (snapshot.image?[snapshot.image]:[]);
type Row = { id: string; actor_id: string; connection_id: string; revision: string; idempotency_key: string; status: string; attempts: number; lease_until: string | null; updated_at: string; source_kind: 'content' | 'campaign'; source_id: string; source_digest: string; body_digest: string; encrypted_snapshot: string; mode: 'rehearsal' | 'publish'; state: string; scheduled_at: string; timezone: string; configuration_revision: string; submitted_at: string | null; provider_post_id: string | null; provider_url: string | null; reason: string | null; cancel_requested: number; preparation_started_at:string|null;provider_container_id:string|null;next_check_at:string|null;image_bytes:number;link_tag:string|null };
type EnqueueInput = {sourceKind:string;sourceId:string;connectionId:string;expectedDigest:string;expectedTargetRevision:string;mode:string;scheduledAt?:string;idempotencyKey:string;acknowledged?:boolean};
type Proof = { revision: string; configuration_revision: string; manager_id: string; checked_at: string; expires_at: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const query = `SELECT j.*,p.* ,j.id AS id FROM platform_jobs j JOIN platform_social_publications p ON p.job_id=j.id AND p.organization_id=j.organization_id AND p.project_id=j.project_id WHERE j.organization_id=? AND j.project_id=? AND j.job_type='social.publish'`;

export class SocialPublications {
  private repo: PlatformRepository; private store: ProjectMarketingStore;
  constructor(private db: Database.Database, private scope: MarketingScope, private key: string, private instagram:InstagramPublisher=instagramPublisher, private videoReader:VideoReader=readVideoHeaders) { this.repo = new PlatformRepository(db); this.store = new ProjectMarketingStore(db, scope); }
  private args() { return [this.scope.organizationId, this.scope.projectId] as const; }
  private can(subject = this.scope.subject) { return (['connections.manage','campaign.approve','campaign.dispatch'] as const).every(permission => this.repo.can(subject, ...this.args(), permission)) && this.repo.workspace(subject, ...this.args())?.project.productPack === 'standard'; }
  private authorize(manage = false) {
    if (!this.repo.can(this.scope.subject, ...this.args(), 'read') || this.repo.workspace(this.scope.subject, ...this.args())?.project.productPack !== 'standard' || manage && !this.can()) throw new MarketingStoreError('Sosyal yayın erişimi reddedildi.', 403);
  }
  private connection(id: string) {
    const row = this.db.prepare("SELECT c.id,c.integration_id,c.account_name,c.encrypted_credentials,s.account_id,s.platform,s.expires_at FROM platform_connections c JOIN platform_social_accounts s ON s.connection_id=c.id WHERE c.id=? AND c.organization_id=? AND c.project_id=? AND c.active=1 AND c.provider='social'").get(id, ...this.args()) as Connection | undefined;
    if (!row) throw new MarketingStoreError('Yayın hesabı bulunamadı.', 404);
    if (!['linkedin','facebook','instagram','twitter','telegram'].includes(row.platform) || row.expires_at && row.expires_at <= Date.now()) throw new MarketingStoreError('Etkin LinkedIn, Facebook, Instagram, X veya Telegram bağlantısı gerekli.', 409);
    if(isLinkedInOrganization(row.platform,row.account_id,row.integration_id))row.accountType='organization';
    return row;
  }
  private config(platform = 'linkedin') { try { return platform === 'telegram' ? telegramPublishingConfiguration().revision : platform === 'twitter' ? xConfiguration().revision : platform === 'instagram' ? instagramPublishingConfiguration().revision : platform === 'facebook' ? facebookPublishingConfiguration().revision : platform === 'linkedin' ? linkedinPublishingConfiguration().revision : ''; } catch { return ''; } }
  private checker(platform:string,accountType?:string) { return platform==='linkedin'&&accountType==='organization'?checkLinkedInOrganizationPublishing:platform==='twitter'?checkXPublishing:platform==='telegram'?checkTelegramPublishing:platform==='instagram'?checkInstagramPublishing:platform==='facebook'?checkFacebookPublishing:checkLinkedInPublishing; }
  private source(kind: unknown, id: unknown, platform = 'linkedin'): PublicationSource {
    if (typeof kind!=='string'||!['content','campaign'].includes(kind) || typeof id !== 'string' || !id || id.length > 150) throw new MarketingStoreError('Geçerli içerik kaynağı gerekli.');
    const project = this.repo.workspace(this.scope.subject, ...this.args())!.project;
    let title: string, text: string, media: boolean, raw: unknown, imageCount=0,unsupportedHtml=false,video:ContentVideo|undefined,story=false;
    if (kind === 'campaign') {
      const campaign = this.store.campaign(id);
      if (!campaign?.channels.social.includes(platform) || campaign.status !== 'draft') throw new MarketingStoreError('Sosyal kampanya taslağı bulunamadı.', 404);
      title = campaign.name; text = campaign.content.perPlatformContent?.[platform] ?? campaign.content.text;
      const link = campaign.content.ctaUrl;
      if (link && !text.includes(link)) text += `\n\n${link}`;
      imageCount=campaign.content.imageData?1:0;
      unsupportedHtml=Boolean(campaign.content.html);
      const format=platform==='instagram'||platform==='facebook'?campaign.content.video?.[platform]:undefined;
      video = format && campaign.content.video ? {url:campaign.content.video.url,format} : undefined;
      media = Boolean(campaign.content.imageData || campaign.content.html || video); raw = campaign;
    } else {
      const row = this.db.prepare('SELECT payload FROM platform_content_history WHERE id=? AND organization_id=? AND project_id=?').get(id, ...this.args()) as { payload: string } | undefined;
      const content = row ? JSON.parse(row.payload) : null;
      if (content?.platform !== platform) throw new MarketingStoreError('Bu hesaba uygun sosyal içerik bulunamadı.', 404);
      imageCount=content.images?.length|| (content.imageData?1:0);
      title = content.headline || platform; text = content.content; media = Boolean(imageCount || content.rawBgData || content.video); raw = content;
      video = content.video && typeof content.video==='object' ? content.video as ContentVideo : undefined;
      story = platform==='instagram' && content.story===true && imageCount===1;
    }
    // Links to the project's own site carry this item's tag so GA4 can report the visits that arrived through them. The
    // tagged text is what the preview shows, what is approved and what is sent; turning tagging off changes the digest.
    const tracking=linkTrackingEnabled(this.db,this.scope),tagging=tracking&&typeof text==='string'?tagOwnLinks(text,project.website,platform,linkTag(this.scope,kind,id)):{text,tagged:0};
    text=tagging.text;
    // A video item is its own format: no images, a format the channel supports and the channel's caption limit.
    const videoOk = Boolean(video && !imageCount && !(raw as {rawBgData?:string}).rawBgData && ((VIDEO_FORMATS as Record<string,readonly string[]>)[platform]||[]).includes(video.format) && typeof text === 'string' && Boolean(text.trim()) && text.length <= (platform==='instagram'?2200:3000) && !/\{\{[\s\S]*?\}\}|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text));
    const eligible = video ? videoOk : !unsupportedHtml && typeof text === 'string' && Boolean(text.trim()) && (platform==='twitter'?xText(text).valid:text.length <= (platform==='instagram'?2200:platform==='telegram'?TELEGRAM_TEXT_LIMIT:3000)) && (platform==='instagram'?imageCount>=1&&imageCount<=5:['facebook','linkedin','twitter'].includes(platform)?imageCount<=1&&(!media||imageCount===1):!media) && !/\{\{[\s\S]*?\}\}|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text);
    const digest=hash(JSON.stringify([...(platform === 'linkedin' ? [kind,id,raw,project] : [kind,id,raw,project,platform]),...(tracking?[]:['links:untagged'])]));
    const previews=!video&&['instagram','facebook','linkedin','twitter'].includes(platform)?Array.from({length:Math.min(imageCount,5)},(_,index)=>`/api/platform/publication-preview?kind=${kind}&id=${encodeURIComponent(id)}&digest=${digest}&platform=${platform}&index=${index}`):[];
    return { kind: kind as 'content' | 'campaign', id, platform, title, text, eligible, digest, format:video?(video.format==='reel'?'reel':video.format==='story'?'story':'video'):story?'story':imageCount>1?'carousel':imageCount?'image':'text',...(story?{story:true}:{}),...(video?{video:{url:video.url,format:video.format}}:{}), ...(platform==='twitter'?{weightedLength:xText(text).length}:{}), ...(tagging.tagged?{trackedLinks:tagging.tagged}:{}), ...(previews.length?{imagePreview:previews[0],imagePreviews:previews}:{}) };
  }
  private results(tag:string,platform:string){const results=new ProjectAttribution(this.db,this.scope).forTag(tag,LINK_SOURCES[platform]||null);return results?{results}:{};}
  async previewImage(kind:string,id:string,digest:string,platform='instagram',index=0) {
    const image=(await this.previewImages(kind,id,digest,platform))[this.imageIndex(index)];
    if(!image)throw new MarketingStoreError('Gorsel bulunamadi.',404);return image;
  }
  private imageIndex(index:number){if(!Number.isSafeInteger(index)||index<0||index>4)throw new MarketingStoreError('Gorsel bulunamadi.',404);return index;}
  private async previewImages(kind:string,id:string,digest:string,platform:string) {
    this.authorize();if(!['instagram','facebook','linkedin','twitter'].includes(platform))throw new MarketingStoreError('Gorsel kanali gecersiz.');
    const source=this.source(kind,id,platform);if(source.digest!==digest||!source.eligible)throw new MarketingStoreError('Görsel kaynağı değişti veya uygun değil.',409);
    const day=new Date().toISOString().slice(0,10),usage=this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='social_image'").get(...this.args(),day) as {count:number}|undefined;
    if((usage?.count||0)>=200)throw new MarketingStoreError('Günlük görsel kontrol sınırına ulaşıldı.',429);
    this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'social_image',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),day);
    const raw=kind==='campaign'?this.store.campaign(id)?.content:JSON.parse((this.db.prepare('SELECT payload FROM platform_content_history WHERE id=? AND organization_id=? AND project_id=?').get(id,...this.args()) as {payload:string}).payload);
    const images=await normalizePublicationImages(raw?.images?.length?raw.images:[{data:raw?.imageData,mime:raw?.imageMime||'image/jpeg'}]);
    this.authorize();if(this.source(kind,id,platform).digest!==digest)throw new MarketingStoreError('Görsel değişti. Yeniden inceleyin.',409);return images;
  }
  async create(input:EnqueueInput) {
    this.authorize(true);const connection=this.connection(input.connectionId);
    const source=this.source(input.sourceKind,input.sourceId,connection.platform);
    const image=source.imagePreview?await this.previewImages(input.sourceKind,input.sourceId,input.expectedDigest,connection.platform):undefined;
    const video=source.video?await checkPublicationVideo(source.video,this.videoReader):undefined;
    return this.enqueue(input,image,video);
  }
  previewJobImage(id:string,index=0) { this.authorize();const image=snapshotImages(this.snapshot(this.row(id)))[this.imageIndex(index)];if(!image)throw new MarketingStoreError('Görsel bulunamadı.',404);return image; }
  private proof(connection: Connection) {
    const proof = this.db.prepare('SELECT * FROM platform_social_publish_checks WHERE connection_id=? AND organization_id=? AND project_id=?').get(connection.id, ...this.args()) as Proof | undefined;
    return proof && this.can(proof.manager_id) && proof.revision === hash(connection.encrypted_credentials) && proof.configuration_revision === this.config(connection.platform) && Date.parse(proof.expires_at) > Date.now() ? proof : null;
  }
  workspace(page = 1): PublicationWorkspace {
    this.authorize(); if (!Number.isSafeInteger(page) || page < 1 || page > 25) throw new MarketingStoreError('Geçerli sayfa numarası gerekli.');
    const canManage = this.can(), sources: PublicationSource[] = []; let sourceTotal=0;
    if (canManage) {
      const candidates=this.db.prepare(`SELECT *,COUNT(*) OVER() AS total FROM (
        SELECT 'content' AS kind,id,json_extract(payload,'$.platform') AS platform,updated_at FROM platform_content_history WHERE organization_id=? AND project_id=? AND json_extract(payload,'$.platform') IN ('linkedin','facebook','instagram','twitter','telegram')
        UNION ALL SELECT DISTINCT 'campaign' AS kind,c.id,ch.value AS platform,c.updated_at FROM platform_campaigns c,json_each(c.payload,'$.channels.social') ch WHERE c.organization_id=? AND c.project_id=? AND json_extract(c.payload,'$.status')='draft' AND ch.value IN ('linkedin','facebook','instagram','twitter','telegram')
      ) ORDER BY updated_at DESC,id,platform LIMIT 50`).all(...this.args(),...this.args()) as {kind:'content'|'campaign';id:string;platform:string;total:number}[];
      sourceTotal=candidates[0]?.total||0;for(const item of candidates)sources.push(this.source(item.kind,item.id,item.platform));
    }
    const targets = canManage ? (this.db.prepare("SELECT c.id,c.integration_id,c.account_name,s.account_id,s.platform,s.expires_at FROM platform_connections c JOIN platform_social_accounts s ON s.connection_id=c.id WHERE c.organization_id=? AND c.project_id=? AND c.active=1 AND c.provider='social' ORDER BY c.account_name,c.id").all(...this.args()) as {id:string;integration_id:string;account_name:string;account_id:string;platform:string;expires_at:number|null}[]).map(item => {
      let proof: Proof | null = null,revision=''; try { const connection=this.connection(item.id);proof=this.proof(connection);revision=hash(connection.encrypted_credentials); } catch {}
      return { id:item.id, name:item.account_name, platform:item.platform, accountId:item.account_id, accountType:isLinkedInOrganization(item.platform,item.account_id,item.integration_id)?'organization' as const:'person' as const, revision, configured:Boolean(this.config(item.platform)), ready:Boolean(proof), checkedAt:proof?.checked_at || null, expiresAt:item.expires_at ? new Date(item.expires_at).toISOString() : null };
    }) : [];
    const rows = this.db.prepare(query+' ORDER BY p.scheduled_at DESC,j.rowid DESC LIMIT 20 OFFSET ?').all(...this.args(),(page-1)*20) as Row[];
    return { items:rows.map(row=>this.describe(row)), total:(this.db.prepare('SELECT COUNT(*) AS n FROM platform_social_publications WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n, page, sources, sourceTotal, targets, canManage, configured:['linkedin','facebook','instagram','twitter','telegram'].some(platform=>Boolean(this.config(platform))), publishingEnabled:socialPublishingEnabled(), timezone:this.repo.workspace(this.scope.subject,...this.args())!.project.timezone };
  }
  async check(connectionId: string, read?: PublishCheck) {
    this.authorize(true); const connection=this.connection(connectionId), revision=hash(connection.encrypted_credentials), config=this.config(connection.platform);
    if (!config) throw new MarketingStoreError('Sunucuda ilgili sosyal uygulama ve API sürümü yapılandırılmalı.',503);
    const checkId=randomUUID();
    this.db.transaction(()=>{
      const day=new Date().toISOString().slice(0,10),usage=this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='social_check'").get(...this.args(),day) as {count:number}|undefined;
      if((usage?.count||0)>=100)throw new MarketingStoreError('Günlük yayın izni kontrol sınırına ulaşıldı.',429);
      this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'social_check',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),day);
      const now=new Date().toISOString();
      this.db.prepare('INSERT INTO platform_social_publish_checks VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET revision=excluded.revision,configuration_revision=excluded.configuration_revision,manager_id=excluded.manager_id,checked_at=excluded.checked_at,expires_at=excluded.expires_at,check_id=excluded.check_id').run(connectionId,...this.args(),revision,config,this.scope.subject,now,now,checkId);
    }).immediate();
    try {
      const credentials=decryptCredentials<StoredCredentials>(connection.encrypted_credentials,this.key,...this.args(),connectionId), proof=await (read || this.checker(connection.platform,connection.accountType))(credentials.accessToken,connection.account_id,credentials);
      return this.db.transaction(()=>{
        this.authorize(true); if (hash(this.connection(connectionId).encrypted_credentials)!==revision || this.config(connection.platform)!==config || !Number.isFinite(proof.expiresAt) || proof.expiresAt<=Date.now()+60000) throw new Error();
        const checkedAt=new Date().toISOString(), expiresAt=new Date(Math.min(proof.expiresAt,Date.now()+300000)).toISOString();
        const updated=this.db.prepare('UPDATE platform_social_publish_checks SET checked_at=?,expires_at=? WHERE connection_id=? AND organization_id=? AND project_id=? AND check_id=?').run(checkedAt,expiresAt,connectionId,...this.args(),checkId);
        if(!updated.changes)throw new Error();
        this.audit('social.publish.check'); return {ready:true,checkedAt,expiresAt};
      }).immediate();
    } catch { throw new MarketingStoreError(connection.accountType==='organization'?'LinkedIn şirket yayın izni doğrulanamadı. w_organization_social, r_organization_admin, seçilen sayfa rolü ve token süresini kontrol edin.':connection.platform==='telegram'?'Telegram yayın izni doğrulanamadı. Botu kanala yönetici olarak ekleyin ve “Mesaj gönder” iznini açın; bot token’ının güncel olduğunu kontrol edin.':connection.platform==='twitter'?'X yayın izni doğrulanamadı. X OAuth ile yayın izni isteyerek yeniden bağlanın; tweet.write, token süresi ve uygulama erişimini kontrol edin.':connection.platform==='instagram'?'Instagram yayın izni doğrulanamadı. instagram_content_publish izni, bağlı sayfa ve içerik oluşturma görevini kontrol edin.':connection.platform==='facebook'?'Facebook yayın izni doğrulanamadı. Yayın izniyle yeniden bağlanın; pages_manage_posts ve sayfanın içerik oluşturma görevini kontrol edin.':'LinkedIn yayın izni doğrulanamadı. w_member_social iznini, token süresini ve hesabı kontrol edin.',409); }
  }
  private row(id: string) { const row=this.db.prepare(query+' AND j.id=?').get(...this.args(),id) as Row|undefined; if(!row)throw new MarketingStoreError('Yayın işi bulunamadı.',404);return row; }
  private snapshot(row: Row) { return decryptCredentials<Snapshot>(row.encrypted_snapshot,this.key,...this.args(),`publication:${row.id}`); }
  private describe(row: Row): Publication {
    const snapshot=this.snapshot(row),images=snapshotImages(snapshot).map((image,index)=>({width:image.width,height:image.height,bytes:image.bytes,previewUrl:`/api/platform/publication-preview?jobId=${row.id}&index=${index}`}));
    return {id:row.id,mode:row.mode,status:row.status,state:row.state,title:snapshot.title,text:snapshot.text,platform:snapshot.platform||'linkedin',accountType:snapshot.accountType||'person',accountName:snapshot.accountName,accountId:snapshot.accountId,sourceKind:row.source_kind,sourceId:row.source_id,scheduledAt:row.scheduled_at,timezone:row.timezone,submittedAt:row.submitted_at,updatedAt:row.updated_at,reason:row.reason,providerPostId:row.provider_post_id,providerUrl:row.provider_url,cancelRequested:Boolean(row.cancel_requested),nextCheckAt:row.next_check_at,format:snapshot.video?(snapshot.video.format==='reel'?'reel':snapshot.video.format==='story'?'story':'video'):snapshot.story?'story':images.length>1?'carousel':images.length?'image':'text',...(snapshot.video?{video:{url:snapshot.video.url,format:snapshot.video.format,bytes:snapshot.video.bytes}}:{}),engagement:this.engagement(row),...(row.link_tag&&row.mode==='publish'&&row.state==='accepted'?{site:new LinkTracking(this.db,this.scope).result(row.link_tag,snapshot.platform||'linkedin',row.submitted_at),...this.results(row.link_tag,snapshot.platform||'linkedin')}:{}),...(images.length?{image:images[0],images}:{})};
  }
  get(id: string) { this.authorize(); return this.describe(this.row(id)); }
  private engagementSupported(row:Row){if(row.mode!=='publish'||row.state!=='accepted'||!row.provider_post_id)return false;const s=this.snapshot(row);return s.platform==='linkedin'?(s.accountType==='organization'&&process.env.PLATFORM_LINKEDIN_ANALYTICS_ENABLED==='1'):['facebook','instagram','twitter'].includes(s.platform||'');}
  private engagement(row:Row):PublicationEngagement {
    if(!this.engagementSupported(row))return {status:'unsupported',counts:{},observedAt:null,attemptedAt:null};
    const metric=this.db.prepare('SELECT * FROM platform_social_engagement WHERE job_id=? AND organization_id=? AND project_id=?').get(row.id,...this.args()) as {counts_json:string;observed_at:string|null;attempted_at:string;state:PublicationEngagement['status'];lease_until:string|null}|undefined;
    return metric?{status:metric.state==='refreshing'&&(!metric.lease_until||Date.parse(metric.lease_until)<=Date.now())?'unavailable':metric.state,counts:JSON.parse(metric.counts_json),observedAt:metric.observed_at,attemptedAt:metric.attempted_at}:{status:'not_requested',counts:{},observedAt:null,attemptedAt:null};
  }
  async refreshEngagement(id:string,read:EngagementReader=readPublicationEngagement){
    this.authorize(true);assertProjectWork(this.db,this.scope);
    const row=this.row(id);if(!this.engagementSupported(row))throw new MarketingStoreError('Bu yayın için etkileşim ölçümü desteklenmiyor.',409);
    const connection=this.connection(row.connection_id),revision=hash(connection.encrypted_credentials),snapshot=this.snapshot(row),lease=randomUUID(),config=this.config(connection.platform);
    if(connection.account_id!==snapshot.accountId||connection.accountType!==snapshot.accountType||connection.platform!==(snapshot.platform||'linkedin'))throw new MarketingStoreError('Yayin hesabi degisti. Olcum alinmadi.',409);
    const claimed=this.db.transaction(()=>{
      this.authorize(true);const current=this.engagement(row);
      if(current.attemptedAt&&Date.now()-Date.parse(current.attemptedAt)<60000)return false;
      const day=new Date().toISOString().slice(0,10),usage=this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='social_metrics'").get(...this.args(),day) as {count:number}|undefined;
      if((usage?.count||0)>=100)throw new MarketingStoreError('Günlük etkileşim yenileme sınırına ulaşıldı.',429);
      this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'social_metrics',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),day);
      this.db.prepare("INSERT INTO platform_social_engagement(job_id,organization_id,project_id,attempted_at,state,lease_token,lease_until) VALUES(?,?,?,?,'refreshing',?,?) ON CONFLICT(job_id) DO UPDATE SET attempted_at=excluded.attempted_at,state='refreshing',lease_token=excluded.lease_token,lease_until=excluded.lease_until").run(id,...this.args(),new Date().toISOString(),lease,new Date(Date.now()+60000).toISOString());return true;
    }).immediate();
    if(!claimed)return this.get(id);
    let counts:EngagementCounts|undefined;try{
      const credentials=decryptCredentials<StoredCredentials>(connection.encrypted_credentials,this.key,...this.args(),connection.id);
      counts=cleanEngagementCounts(await read({platform:connection.platform,accountId:connection.account_id,accountType:connection.accountType,postId:row.provider_post_id!,credentials}));
    }catch{}
    this.db.transaction(()=>{
      this.authorize(true);
      if(hash(this.connection(row.connection_id).encrypted_credentials)!==revision||this.config(connection.platform)!==config)counts=undefined;
      if(counts)this.db.prepare("UPDATE platform_social_engagement SET counts_json=?,observed_at=?,state='ready',lease_token=NULL,lease_until=NULL WHERE job_id=? AND organization_id=? AND project_id=? AND lease_token=? AND lease_until>?").run(JSON.stringify(counts),new Date().toISOString(),id,...this.args(),lease,new Date().toISOString());
      else this.db.prepare("UPDATE platform_social_engagement SET state='unavailable',lease_token=NULL,lease_until=NULL WHERE job_id=? AND organization_id=? AND project_id=? AND lease_token=?").run(id,...this.args(),lease);
      this.audit('social.engagement.refresh');
    }).immediate();return this.get(id);
  }
  enqueue(input: EnqueueInput, media?:PublicationImage|PublicationImage[], video?:PublicationVideo) {
    const images=media?(Array.isArray(media)?media:[media]):[],image=images[0];
    this.authorize(true);
    assertProjectWork(this.db,this.scope);if(input.mode==='publish')assertProjectDelivery(this.db,this.scope);
    if (!['publish','rehearsal'].includes(input.mode) || typeof input.idempotencyKey!=='string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.idempotencyKey)) throw new MarketingStoreError('Geçerli işlem ve anahtar gerekli.');
    return this.db.transaction(()=>{
      const connection=this.connection(input.connectionId), source=this.source(input.sourceKind,input.sourceId,connection.platform), revision=hash(connection.encrypted_credentials), config=this.config(connection.platform), key=`social:${input.idempotencyKey}`;
      if(source.video&&(!video||video.url!==source.video.url||video.format!==source.video.format))throw new MarketingStoreError('Video önce doğrulanmalı.',409);
      if(!source.video&&(connection.platform==='instagram'||source.imagePreview)&&!image)throw new MarketingStoreError('Gorseller once dogrulanmali.',409);
      if(input.expectedTargetRevision!==revision)throw new MarketingStoreError('Yayın hesabı değişti. Önizlemeyi yenileyin.',409);
      const requestedAt=input.scheduledAt===undefined||input.scheduledAt===''?null:typeof input.scheduledAt==='string'&&/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(input.scheduledAt)&&Number.isFinite(Date.parse(input.scheduledAt.slice(0,10)))&&new Date(input.scheduledAt.slice(0,10)).toISOString().slice(0,10)===input.scheduledAt.slice(0,10)?Date.parse(input.scheduledAt):NaN;
      if(requestedAt!==null&&!Number.isFinite(requestedAt))throw new MarketingStoreError('Saat dilimi içeren geçerli bir yayın tarihi gerekli.');
      const existing=this.db.prepare(query+' AND j.idempotency_key=?').get(...this.args(),key) as Row|undefined;
      if(existing){if(existing.source_kind!==input.sourceKind||existing.source_id!==input.sourceId||existing.source_digest!==input.expectedDigest || existing.connection_id!==connection.id || existing.mode!==input.mode || requestedAt!==null&&Date.parse(existing.scheduled_at)!==requestedAt)throw new MarketingStoreError('İşlem anahtarı başka bir yayına ait.',409);return this.describe(existing);}
      if(!source.eligible || source.digest!==input.expectedDigest)throw new MarketingStoreError('İçerik değişti veya metin yayını için uygun değil. Taslağı yenileyin.',409);
      if(input.mode==='publish'&&connection.platform==='telegram'&&!hasMessagingDuty(this.db,this.scope.subject,...this.args(),'publish'))throw new MarketingStoreError('Telegram kanalında yayın için ayrıca "yayın" mesajlaşma görevi gerekir.',403);
      if(input.mode==='publish'&&(!socialPublishingEnabled()||!config||input.acknowledged!==true||!this.proof(connection)))throw new MarketingStoreError('Gerçek yayın kapalı, yayın izni eksik veya açık onay verilmedi.',409);
      const at=requestedAt??Date.now();
      if(!Number.isFinite(at)||at<Date.now()-60000||at>Date.now()+30*86400000)throw new MarketingStoreError('Şimdi veya gelecek 30 gün içinde bir yayın saati seçin.');
      if(input.mode==='publish'&&connection.expires_at&&connection.expires_at<=at+60000)throw new MarketingStoreError('Bağlantı izni planlanan yayından önce sona eriyor. Yeniden bağlanın.',409);
      const total=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_social_publications WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n;
      const day=new Date().toISOString().slice(0,10), usage=this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='social_enqueue'").get(...this.args(),day) as {count:number}|undefined;
      const imageBytes=(this.db.prepare('SELECT COALESCE(SUM(image_bytes),0) AS n FROM platform_social_publications WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n;
      const bytes=images.reduce((sum,item)=>sum+item.bytes,0);
      if(total>=500||(usage?.count||0)>=20||imageBytes+bytes>32*1024*1024)throw new MarketingStoreError('Sosyal yayın pilot sınırına ulaşıldı.',429);
      const bodyDigest=hash(video?JSON.stringify([source.text,video.url,video.format,video.bytes,video.etag,video.lastModified]):images.length>1?JSON.stringify([source.text,images.map(item=>item.digest)]):image?JSON.stringify([source.text,image.digest]):source.text);
      if(input.mode==='publish'&&this.db.prepare(query+" AND j.connection_id=? AND p.body_digest=? AND p.mode='publish' AND p.state IN ('pending','checking','preparing','container_processing','submitting','accepted','uncertain')").get(...this.args(),connection.id,bodyDigest))throw new MarketingStoreError('Bu içerik bu hesapta zaten kuyrukta veya gönderilmiş olabilir.',409);
      const id=randomUUID(),now=new Date().toISOString(),scheduledAt=new Date(at).toISOString(),timezone=this.repo.workspace(this.scope.subject,...this.args())!.project.timezone;
      this.db.prepare("INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES(?,?,?,?,?,?,?,'queued',?,?,'social.publish')").run(id,...this.args(),this.scope.subject,connection.id,revision,key,now,now);
      this.db.prepare('INSERT INTO platform_social_publications(job_id,organization_id,project_id,source_kind,source_id,source_digest,body_digest,encrypted_snapshot,mode,scheduled_at,timezone,configuration_revision,image_bytes,link_tag) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,...this.args(),source.kind,source.id,source.digest,bodyDigest,encryptCredentials({title:source.title,text:source.text,platform:connection.platform,accountName:connection.account_name,accountId:connection.account_id,...(connection.accountType?{accountType:connection.accountType}:{}),...(video?{video}:images.length>1?{images}:image?{image}:{}),...(source.story?{story:true}:{})},this.key,...this.args(),`publication:${id}`),input.mode,scheduledAt,timezone,config,bytes,source.trackedLinks?linkTag(this.scope,source.kind,source.id):null);
      this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'social_enqueue',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),day);
      this.audit(input.mode==='publish'?'social.publish.approve':'social.rehearsal.enqueue');return this.get(id);
    }).immediate();
  }
  cancel(id: string) {
    this.authorize(true);return this.db.transaction(()=>{
      const row=this.row(id);if(!['queued','running'].includes(row.status))return this.describe(row);
      if(row.submitted_at){this.db.prepare('UPDATE platform_social_publications SET cancel_requested=1 WHERE job_id=?').run(id);this.audit('social.publish.cancel_requested');}
      else {this.finish(id,'cancelled','cancelled');this.audit('social.publish.cancel');}
      return this.get(id);
    }).immediate();
  }
  async run(id: string) { this.authorize(true);await this.process(id,undefined,undefined,this.scope.subject);return this.get(id); }
  private holder(id:string,lease:string){return Boolean(this.db.prepare("SELECT 1 FROM platform_jobs WHERE id=? AND organization_id=? AND project_id=? AND status='running' AND lease_token=? AND lease_until>?").get(id,...this.args(),lease,new Date().toISOString()));}
  private live(row:Row,manualRunner?:string){
    assertProjectWork(this.db,this.scope);if(row.mode==='publish')assertProjectDelivery(this.db,this.scope);
    if(!this.can(row.actor_id)||manualRunner&&!this.can(manualRunner))throw new Error();
    const connection=this.connection(row.connection_id),snapshot=this.snapshot(row),platform=snapshot.platform||'linkedin',source=this.source(row.source_kind,row.source_id,platform);
    // A Telegram publication also needs the publish duty, checked again here in case it was taken away while queued.
    if(row.mode==='publish'&&connection.platform==='telegram'&&(!hasMessagingDuty(this.db,row.actor_id,...this.args(),'publish')||manualRunner&&!hasMessagingDuty(this.db,manualRunner,...this.args(),'publish')))throw new Error();
    if(connection.platform!==platform||connection.accountType!==snapshot.accountType||hash(connection.encrypted_credentials)!==row.revision||!source.eligible||source.digest!==row.source_digest||row.mode==='publish'&&(!socialPublishingEnabled()||!this.config(platform)||this.config(platform)!==row.configuration_revision))throw new Error();
    return connection;
  }
  private imageSignature(row:Row,index=0) { return publicationImageSignature(this.key,...this.args(),row.id,row.preparation_started_at,row.body_digest,index); }
  providerImage(id:string,signature:string,index=0) {
    this.imageIndex(index);
    const row=this.row(id);
    if(row.mode!=='publish'||!row.preparation_started_at||Date.now()-Date.parse(row.preparation_started_at)>900000||Date.parse(row.preparation_started_at)>Date.now()||!['queued','running'].includes(row.status)||!['preparing','container_processing','checking'].includes(row.state)||row.cancel_requested||row.submitted_at||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(this.imageSignature(row,index),'hex')))throw new MarketingStoreError('Görsel bulunamadı.',404);
    const snapshot=this.snapshot(row),image=snapshotImages(snapshot)[index];if(!image||snapshot.platform!=='instagram')throw new MarketingStoreError('Görsel bulunamadı.',404);
    this.live(row);return image;
  }
  private waitForImage(row:Row,lease:string,manualRunner?:string) {
    this.db.transaction(()=>{
      if(!this.holder(row.id,lease))return;this.live(row,manualRunner);
      this.db.prepare("UPDATE platform_social_publications SET state='container_processing',next_check_at=? WHERE job_id=?").run(new Date(Date.now()+10000).toISOString(),row.id);
      this.db.prepare("UPDATE platform_jobs SET status='queued',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(),row.id);
    }).immediate();
  }
  private async prepareInstagram(row:Row,lease:string,credentials:StoredCredentials,reserve:()=>boolean,manualRunner?:string):Promise<PublishResult|undefined> {
    const snapshot=this.snapshot(row),id=row.id;
    const images=snapshotImages(snapshot);if(!images.length&&!snapshot.video)throw new Error();
    const settle=(state:string,reason:string)=>this.db.transaction(()=>{if(this.holder(id,lease))this.finish(id,state,reason);}).immediate();
    if(!row.provider_container_id){
      const started=this.db.transaction(()=>{
        if(!this.holder(id,lease))return false;this.live(row,manualRunner);
        const day=`${new Date().toISOString().slice(0,10)}T00:00:00.000Z`;
        const n=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_social_publications WHERE organization_id=? AND project_id=? AND job_id<>? AND (submitted_at>=? OR preparation_started_at>=?)').get(...this.args(),id,day,day) as {n:number}).n;
        if(n>=5){this.finish(id,'blocked','limit');return false;}
        return Boolean(this.db.prepare("UPDATE platform_social_publications SET preparation_started_at=?,state='preparing' WHERE job_id=? AND preparation_started_at IS NULL").run(new Date().toISOString(),id).changes);
      }).immediate();
      if(!started)return;
      try{
        if(snapshot.video){
          // The team's file must be the one that was approved; Meta then fetches it from that address.
          let current:PublicationVideo|null=null;try{current=await checkPublicationVideo(snapshot.video,this.videoReader);}catch{current=null;}
          if(!current||!sameVideo(current,snapshot.video)){settle('blocked','media_changed');return;}
          if(!this.instagram.createVideo)throw new Error('Video adapter unavailable.');
          const container=await this.instagram.createVideo(credentials.accessToken,snapshot.accountId,snapshot.text,snapshot.video.url,snapshot.video.format==='story'?'story':'reel');
          if(!instagramId(container))throw new Error();
          this.db.transaction(()=>{if(!this.holder(id,lease))return;this.live(row,manualRunner);this.db.prepare('UPDATE platform_social_publications SET provider_container_id=? WHERE job_id=?').run(container,id);this.waitForImage(row,lease,manualRunner);}).immediate();
          return;
        }
        const fresh=this.row(id),origin=instagramPublishingConfiguration().origin;
        const imageUrl=`${origin}/api/platform/publication-media/${id}?signature=${this.imageSignature(fresh)}`;
        const urls=images.map((_,index)=>`${origin}/api/platform/publication-media/${id}?signature=${this.imageSignature(fresh,index)}&index=${index}`);
        const stillValid=()=>{try{return this.holder(id,lease)&&Boolean(this.live(fresh,manualRunner))&&!this.row(id).cancel_requested;}catch{return false;}};
        if(images.length>1&&!this.instagram.createCarousel)throw new Error('Carousel adapter unavailable.');
        const container=images.length>1?await this.instagram.createCarousel!(credentials.accessToken,snapshot.accountId,snapshot.text,urls,stillValid):await this.instagram.create(credentials.accessToken,snapshot.accountId,snapshot.text,imageUrl,snapshot.story===true);
        if(!instagramId(container))throw new Error();
        this.db.transaction(()=>{if(!this.holder(id,lease))return;this.live(row,manualRunner);this.db.prepare('UPDATE platform_social_publications SET provider_container_id=? WHERE job_id=?').run(container,id);this.waitForImage(row,lease,manualRunner);}).immediate();
      }catch{settle('uncertain','container_unknown');}
      return;
    }
    if(!row.preparation_started_at||Date.now()-Date.parse(row.preparation_started_at)>900000){settle('blocked','media_expired');return;}
    let state:string;
    try{state=await this.instagram.status(credentials.accessToken,row.provider_container_id);}catch{this.waitForImage(row,lease,manualRunner);return;}
    if(!this.holder(id,lease))return;this.live(row,manualRunner);
    if(state==='IN_PROGRESS'){this.waitForImage(row,lease,manualRunner);return;}
    if(state==='PUBLISHED'){settle('uncertain','interrupted');return;}
    if(state!=='FINISHED'){settle('blocked',state==='EXPIRED'?'media_expired':'media_failed');return;}
    return this.instagram.publish(credentials.accessToken,snapshot.accountId,row.provider_container_id,reserve);
  }
  async process(id:string,check?:PublishCheck,transport?:PublishTransport,manualRunner?:string){
    const lease=randomUUID();
    const claimed=this.db.transaction(()=>{
      const row=this.row(id),now=new Date().toISOString();
      if(!['queued','running'].includes(row.status)||row.scheduled_at>now||row.next_check_at&&row.next_check_at>now||row.status==='running'&&row.lease_until&&row.lease_until>now)return null;
      if(row.submitted_at){this.finish(id,'uncertain','interrupted');return null;}
      if(row.preparation_started_at&&!row.provider_container_id){this.finish(id,'uncertain','container_unknown');return null;}
      if(Date.parse(row.scheduled_at)<Date.now()-86400000){this.finish(id,'blocked','expired');return null;}
      if(row.attempts>=(this.snapshot(row).platform==='instagram'?30:3)){this.finish(id,'blocked','unavailable');return null;}
      this.db.prepare("UPDATE platform_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(lease,new Date(Date.now()+60000).toISOString(),now,id);
      this.db.prepare("UPDATE platform_social_publications SET state='checking',next_check_at=NULL WHERE job_id=?").run(id);return row;
    }).immediate();
    if(!claimed)return;
    let result:PublishResult={state:'blocked',postId:null},reason='changed';
    try{
      const connection=this.live(claimed,manualRunner),snapshot=this.snapshot(claimed);
      if(claimed.mode==='rehearsal'){
        this.db.transaction(()=>{if(!this.holder(id,lease))return;this.live(claimed,manualRunner);this.finish(id,'rehearsed',null);}).immediate();return;
      }
      const credentials=decryptCredentials<StoredCredentials>(connection.encrypted_credentials,this.key,...this.args(),connection.id);reason='unavailable';
      const access=await (check || this.checker(connection.platform,connection.accountType))(credentials.accessToken,connection.account_id,credentials);
      if(!this.holder(id,lease))return;this.live(claimed,manualRunner);
      if(!Number.isFinite(access.expiresAt)||access.expiresAt<=Date.now()+60000)throw new Error();
      const reserve=()=>this.db.transaction(()=>{
        if(!this.holder(id,lease))return false;this.live(claimed,manualRunner);
        if(this.row(id).cancel_requested||access.expiresAt<=Date.now()+10000)return false;
        const day=`${new Date().toISOString().slice(0,10)}T00:00:00.000Z`,n=(this.db.prepare("SELECT COUNT(*) AS n FROM platform_social_publications WHERE organization_id=? AND project_id=? AND job_id<>? AND (submitted_at>=? OR preparation_started_at>=?)").get(...this.args(),id,day,day) as {n:number}).n;
        if(n>=5){reason='limit';return false;}
        const reserved=this.db.prepare("UPDATE platform_social_publications SET state='submitting',submitted_at=? WHERE job_id=? AND submitted_at IS NULL AND state='checking'").run(new Date().toISOString(),id);return Boolean(reserved.changes);
      }).immediate();
      if(connection.platform==='instagram'){
        const imageResult=await this.prepareInstagram(claimed,lease,credentials,reserve,manualRunner);if(!imageResult)return;result=imageResult;
      }else if(connection.platform==='facebook'&&snapshot.video){
        let current:PublicationVideo|null=null;try{current=await checkPublicationVideo(snapshot.video,this.videoReader);}catch{current=null;}
        if(!this.holder(id,lease))return;this.live(claimed,manualRunner);
        result=current&&sameVideo(current,snapshot.video)?await (snapshot.video.format==='reel'?publishFacebookReel:publishFacebookVideo)(credentials.accessToken,snapshot.accountId,snapshot.text,snapshot.video.url,reserve):{state:'blocked',postId:null};if(result.state==='blocked'&&!current)reason='media_changed';
      }else if(connection.platform==='facebook'&&snapshot.image)result=await publishFacebookImage(credentials.accessToken,snapshot.accountId,snapshot.text,snapshot.image,reserve);
      else if(connection.platform==='linkedin'&&snapshot.image)result=await (connection.accountType==='organization'?publishLinkedInOrganizationImage:publishLinkedInImage)(credentials.accessToken,snapshot.accountId,snapshot.text,snapshot.image,reserve);
      // X image posts need the media.write grant, which older X connections do not have; they reconnect first.
      else if(connection.platform==='twitter'&&snapshot.image)result=credentials.xPublishing?.scopes.includes('media.write')?await publishXImage(credentials.accessToken,snapshot.accountId,snapshot.text,snapshot.image,reserve):{state:'blocked',postId:null};
      else result=await (transport || (connection.accountType==='organization'?publishLinkedInOrganizationText:connection.platform==='twitter'?publishXText:connection.platform==='telegram'?publishTelegramText:connection.platform==='facebook'?publishFacebookText:publishLinkedInText))(credentials.accessToken,snapshot.accountId,snapshot.text,reserve);
    }catch{try{this.live(claimed,manualRunner);}catch{reason='changed';}}
    this.db.transaction(()=>{
      if(!this.holder(id,lease))return;const row=this.row(id);
      if(row.submitted_at){
        const snapshot=this.snapshot(row),facebook=snapshot.platform==='facebook',instagram=snapshot.platform==='instagram',x=snapshot.platform==='twitter',telegram=snapshot.platform==='telegram';
        const accepted=result.state==='accepted'&&typeof result.postId==='string'&&(x?xPostId(result.postId):telegram?telegramPostId(result.postId):instagram?instagramId(result.postId):facebook?(snapshot.video?facebookVideoId(result.postId):validFacebookPost(result.postId,snapshot.accountId)):/^urn:li:(share|ugcPost):\d{1,30}$/.test(result.postId));
        if(accepted){this.db.prepare('UPDATE platform_social_publications SET provider_post_id=?,provider_url=? WHERE job_id=?').run(result.postId,x?`https://x.com/i/status/${result.postId}`:telegram?(typeof result.postUrl==='string'&&/^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}\/\d{1,12}$/.test(result.postUrl)?result.postUrl:null):instagram?instagramPermalink(result.postUrl):facebook?(snapshot.video?.format==='reel'?`https://www.facebook.com/reel/${result.postId}`:`https://www.facebook.com/${result.postId}`):`https://www.linkedin.com/feed/update/${result.postId}`,id);this.finish(id,'accepted',null);}
        else this.finish(id,result.state==='rejected'?'rejected':'uncertain',result.state==='rejected'?'unavailable':'interrupted');
      }else this.finish(id,'blocked',reason);
    }).immediate();
  }
  private finish(id:string,state:string,reason:string|null){
    this.db.prepare('UPDATE platform_social_publications SET state=?,reason=?,next_check_at=NULL WHERE job_id=?').run(state,reason,id);
    this.db.prepare('UPDATE platform_jobs SET status=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?').run(state==='cancelled'?'cancelled':['accepted','rehearsed'].includes(state)?'completed':'failed',new Date().toISOString(),id);this.audit('social.publish.result');
  }
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
}

export function providerPublicationImage(db:Database.Database,key:string,id:string,signature:string,index=0) {
  if(!Number.isSafeInteger(index)||index<0||index>4)throw new MarketingStoreError('Gorsel bulunamadi.',404);
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)||!/^[a-f0-9]{64}$/.test(signature))throw new MarketingStoreError('Görsel bulunamadı.',404);
  const row=db.prepare("SELECT j.actor_id,j.organization_id,j.project_id,p.preparation_started_at,p.body_digest FROM platform_jobs j JOIN platform_social_publications p ON p.job_id=j.id AND p.organization_id=j.organization_id AND p.project_id=j.project_id WHERE j.id=? AND j.job_type='social.publish'").get(id) as {actor_id:string;organization_id:string;project_id:string;preparation_started_at:string|null;body_digest:string}|undefined;
  if(!row||!row.preparation_started_at||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(publicationImageSignature(key,row.organization_id,row.project_id,id,row.preparation_started_at,row.body_digest,index),'hex')))throw new MarketingStoreError('Görsel bulunamadı.',404);
  return new SocialPublications(db,{subject:row.actor_id,organizationId:row.organization_id,projectId:row.project_id},key).providerImage(id,signature,index);
}
function publicationImageSignature(key:string,org:string,project:string,id:string,started:string|null,digest:string,index=0) { return createHmac('sha256',Buffer.from(key,'hex')).update(JSON.stringify(index===0?['instagram-image-v1',org,project,id,started,digest]:['instagram-carousel-v1',org,project,id,started,digest,index])).digest('hex'); }
