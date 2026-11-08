import type { Db } from '../db/client';
import 'server-only';
import {createHash} from 'node:crypto';
import type Database from 'better-sqlite3';
import type {UnifiedCampaign} from '../campaigns';
import {PlatformRepository} from './repository';
import {ProjectMarketingStore,MarketingStoreError,type MarketingScope} from './marketing-store';
import {ProductSegments} from './segments';
import {EMAIL_PREVIEW_VERSION,renderCampaignEmailPreview} from './email-preview';
import type {CampaignReviewData,ReviewCheck,ReviewDecision,ReviewState} from './campaign-review-types';
import type {WorkspacePermission} from './access';
import {EmailRecipients} from './email-recipients';
import {safetyRevision,publicEmailOrigin} from './email-safety';
import type {SegmentEntity} from './segment-engine';
import {emailSenderReadiness,emailPilotCounts} from './email-sender';
import {SesProvider} from './ses-provider';
import {linkTag,linkTrackingEnabled,tagOwnLinks} from './link-tracking';
import {iysSendBlock} from './iys';
import {iysEnabled} from './iys-types';

type Receipt={content_digest:string;data_revision:string;counts_json:string;checked_at:string};
type Review={id:number;content_digest:string;data_revision:string;decision:ReviewDecision;note:string;actor_id:string;created_at:string};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class CampaignReviews {
  constructor(private db:Db,private scope:MarketingScope,private key?:string){}
  private args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private repo(){return new PlatformRepository(this.db);}
  private async authorize(permission:WorkspacePermission='read'){
    const repo=this.repo();
    if(!await repo.can(this.scope.subject,...this.args(),permission)||(await repo.workspace(this.scope.subject,...this.args()))?.project.productPack!=='standard')throw new MarketingStoreError('Standart proje inceleme erişimi gerekli.',403);
  }
  // Links to the project's own site carry the campaign's tag (utm_medium=email), so GA4 and the team's signup events can
  // tell which email a visitor came from. The tagged text is what the review shows, what its digest covers and what is
  // sent; a campaign without such links keeps the digest it had.
  private async campaign(id:string){
    if(typeof id!=='string'||!id||id.length>120)throw new MarketingStoreError('Geçerli kampanya kimliği gerekli.');
    const campaign=await new ProjectMarketingStore(this.db,this.scope).campaign(id);
    if(!campaign)throw new MarketingStoreError('Kampanya bulunamadı.',404);
    const website=(await this.repo().workspace(this.scope.subject,...this.args()))?.project.website||'';
    if(!website||!await linkTrackingEnabled(this.db,this.scope))return campaign;
    const tag=linkTag(this.scope,'campaign',campaign.id),text=tagOwnLinks(campaign.content.text||'',website,'email',tag,'email'),cta=tagOwnLinks(campaign.content.ctaUrl||'',website,'email',tag,'email');
    return text.tagged||cta.tagged?{...campaign,content:{...campaign.content,text:text.tagged?text.text:campaign.content.text,ctaUrl:cta.tagged?cta.text:campaign.content.ctaUrl}}:campaign;
  }
  private async context(campaign:UnifiedCampaign){
    const profile=(await this.repo().workspace(this.scope.subject,...this.args()))!.project,project={...profile,language:profile.language||'tr' as const},sender=await emailSenderReadiness(this.db,this.scope);
    const digest=hash({previewVersion:EMAIL_PREVIEW_VERSION,id:campaign.id,updatedAt:campaign.updatedAt,name:campaign.name,channels:campaign.channels,
      subject:campaign.content.subject||'',text:campaign.content.text,ctaUrl:campaign.content.ctaUrl||'',goalId:campaign.goalId||'',binding:campaign.segmentBinding||null,
      brand:project.name,language:project.language,goal:project.goals.find(goal=>goal.id===campaign.goalId)||null,
      mapping:campaign.segmentBinding?await this.db.prepare('SELECT source_version,field,revision FROM platform_email_mappings WHERE source_id=? AND organization_id=? AND project_id=?').get(campaign.segmentBinding.sourceId,...this.args())||null:null,
      sender:{connectionId:sender.connectionId,bindingRevision:sender.bindingRevision,maxRecipients:sender.maxRecipients}});
    return {project,digest};
  }
  private contentChecks(campaign:UnifiedCampaign):ReviewCheck[]{
    const subject=campaign.content.subject||'',text=campaign.content.text||'',url=campaign.content.ctaUrl||'';
    let safe=false;try{const target=new URL(url);safe=target.protocol==='https:'&&!target.username&&!target.password&&!/[\r\n\x00]/.test(url)&&url.length<=2048;}catch{}
    const result:Record<string,boolean>={saved_draft:campaign.status==='draft',email_only:campaign.channels.email===true&&!campaign.channels.social.length&&!campaign.channels.whatsapp&&!campaign.channels.telegram&&!campaign.channels.paidAds.length,
      subject:Boolean(subject.trim()&&subject.length<=200&&!/[\r\n\x00-\x1f]/.test(subject)),content:Boolean(text.trim()&&text.length<=20000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)),
      target:safe,variables:![subject,text,url].some(value=>/\{\{|\}\}/.test(value)),segment:Boolean(campaign.segmentBinding)};
    return Object.entries(result).map(([code,pass])=>({code,state:pass?'pass':'blocked'}));
  }
  private async receipt(id:string){return await this.db.prepare('SELECT * FROM platform_campaign_preflights WHERE campaign_id=? AND organization_id=? AND project_id=?').get(id,...this.args()) as Receipt|undefined;}
  private async history(id:string){return await this.db.prepare('SELECT * FROM platform_campaign_reviews WHERE campaign_id=? AND organization_id=? AND project_id=? ORDER BY id DESC LIMIT 50').all(id,...this.args()) as Review[];}
  private async fresh(campaign:UnifiedCampaign,receipt:Receipt|undefined,digest:string){
    if(!receipt||receipt.content_digest!==digest||!receipt.data_revision||Date.now()-Date.parse(receipt.checked_at)>15*60000)return false;
    const binding=campaign.segmentBinding;if(!binding)return false;
    const source=await this.db.prepare('SELECT s.*,c.active FROM platform_product_sources s JOIN platform_connections c ON c.id=s.connection_id AND c.organization_id=s.organization_id AND c.project_id=s.project_id WHERE s.connection_id=? AND s.organization_id=? AND s.project_id=?').get(binding.sourceId,...this.args()) as {version:number;active:number;enabled:number;last_synced_at:string;encrypted_checkpoint:string;event_coverage_from:string|null;webhook_actor_id:string|null}|undefined;
    const counts=JSON.parse(receipt.counts_json);
    if(counts.recipientRevision!==await safetyRevision(this.db,this.scope))return false;
    return Boolean(source?.active&&source.enabled&&source.version===binding.sourceVersion&&!source.encrypted_checkpoint&&source.last_synced_at===counts.sourceSyncedAt&&source.event_coverage_from===counts.coverageFrom&&
      Date.now()-Date.parse(source.last_synced_at)<=counts.maxAgeHours*3600000&&(!source.webhook_actor_id||await this.repo().can(source.webhook_actor_id,...this.args(),'connections.manage')));
  }
  async get(id:string):Promise<CampaignReviewData>{
    await this.authorize();const campaign=await this.campaign(id),{project,digest}=await this.context(campaign),history=await this.history(id),latest=history[0],receipt=await this.receipt(id),fresh=await this.fresh(campaign,receipt,digest);
    let approval:ReviewState=latest?.decision||'none';
    if(latest&&latest.content_digest!==digest)approval='outdated';
    else if(latest?.decision==='approved'&&!await this.repo().can(latest.actor_id,...this.args(),'campaign.approve'))approval='authority_lost';
    const counts=receipt&&receipt.content_digest===digest&&receipt.data_revision?JSON.parse(receipt.counts_json):null;
    const checks=this.contentChecks(campaign);
    checks.push({code:'audience',state:fresh&&counts?.matched>0?'pass':receipt?'blocked':'pending'},{code:'approval',state:approval==='approved'?'pass':'pending'});
    const sender=await emailSenderReadiness(this.db,this.scope);
    const ses=this.key?await new SesProvider(this.db,this.scope,this.key).state():null;
    checks.push({code:'smtp',state:sender.smtpReady?'pass':'pending'},{code:'sender_domain',state:sender.ownership==='verified'?'pass':'blocked'},{code:'sender_auth',state:ses?.verified?'pass':'blocked'},
      {code:'consent',state:fresh&&counts?.eligibility?.mappingReady&&counts.eligibility.eligible>0?'pass':'blocked'},
      {code:'pilot',state:fresh&&counts?.pilot?.planned>0?'pass':'blocked'},
      {code:'unsubscribe',state:publicEmailOrigin()?'pass':'blocked'},...(iysEnabled()?[{code:'iys',state:await iysSendBlock(this.db,this.scope)?'blocked' as const:'pass' as const}]:[]),{code:'dispatch',state:ses?.ready?'pending':'blocked'});
    return {campaignId:id,name:campaign.name,digest,timezone:project.timezone,language:project.language,canCheck:await this.repo().can(this.scope.subject,...this.args(),'content.write'),canApprove:await this.repo().can(this.scope.subject,...this.args(),'campaign.approve'),approval,
      checks,html:renderCampaignEmailPreview(campaign,project.name,project.language),subject:campaign.content.subject||'',text:campaign.content.text,ctaUrl:campaign.content.ctaUrl||'',
      audience:counts?{matched:counts.matched,unknown:counts.unknown,total:counts.total,computedAt:receipt!.checked_at,fresh}:null,
      audienceError:receipt&&receipt.content_digest===digest?JSON.parse(receipt.counts_json).error||null:null,
      history:history.map(row=>({id:row.id,decision:row.decision,note:row.note,createdAt:row.created_at,byYou:row.actor_id===this.scope.subject})),sendingEnabled:false,
      eligibleRecipients:fresh&&counts?.eligibility?.mappingReady?counts.eligibility.eligible:null,eligibility:fresh?counts?.eligibility||null:null,pilot:fresh?counts?.pilot||null:null,sender:{domain:sender.domain,maskedSender:sender.maskedSender,ownership:sender.ownership,maxRecipients:sender.maxRecipients}};
  }
  async check(id:string,expectedDigest:string){
    await this.authorize('content.write');const campaign=await this.campaign(id),{digest}=await this.context(campaign);
    if(expectedDigest!==digest)throw new MarketingStoreError('Taslak değişti. İncelemeyi yenileyin.',409);
    let dataRevision='',counts:object={error:'Önce içerik ve kitle sürümü kontrollerini tamamlayın.'};
    if(this.contentChecks(campaign).every(check=>check.state==='pass')){
      try{
        const members:SegmentEntity[]=[],binding=campaign.segmentBinding!,segments=new ProductSegments(this.db,this.scope),preview=await segments.preview({id:binding.segmentId,version:binding.segmentVersion},members);
        if(preview.ruleDigest!==binding.ruleDigest)throw new MarketingStoreError('Kitle kuralı değişti.',409);
        const version=(await segments.versions(binding.segmentId)).find(version=>version.version===binding.segmentVersion)!;
        const eligibleKeys:string[]=[],eligibility=this.key?await new EmailRecipients(this.db,this.scope,this.key).eligibility(binding.sourceId,binding.sourceVersion,members,eligibleKeys):null;
        dataRevision=preview.dataRevision;counts={matched:preview.matched,unknown:preview.unknown,total:preview.total,sourceSyncedAt:preview.sourceSyncedAt,coverageFrom:preview.coverageFrom,maxAgeHours:version.definition.maxAgeHours,
          recipientRevision:await safetyRevision(this.db,this.scope),eligibility,pilot:eligibility?.mappingReady?await emailPilotCounts(this.db,this.scope,eligibleKeys):null};
      }catch(error){if(!(error instanceof MarketingStoreError))throw error;counts={error:error.message};}
    }
    await this.db.transaction(async ()=>{
      await this.authorize('content.write');if((await this.context(await this.campaign(id))).digest!==digest)throw new MarketingStoreError('Taslak değişti.',409);
      await this.db.prepare('INSERT INTO platform_campaign_preflights VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET content_digest=excluded.content_digest,data_revision=excluded.data_revision,counts_json=excluded.counts_json,checked_at=excluded.checked_at,checked_by=excluded.checked_by').run(id,...this.args(),digest,dataRevision,JSON.stringify(counts),new Date().toISOString(),this.scope.subject);
    });return await this.get(id);
  }
  async decide(id:string,input:{decision:ReviewDecision;expectedDigest:string;expectedReviewId:number|null;note:string}){
    await this.authorize('campaign.approve');
    if(!['approved','rejected','revoked'].includes(input.decision)||typeof input.note!=='string'||input.note.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(input.note)||input.decision!=='approved'&&!input.note.trim())throw new MarketingStoreError('Geçerli karar ve açıklama gerekli (en fazla 1000 karakter).');
    await this.db.transaction(async ()=>{
      const day=new Date().toISOString().slice(0,10),used=await this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='campaign_review'").get(...this.args(),day) as {count:number}|undefined;
      if((used?.count||0)>=100)throw new MarketingStoreError('Günlük inceleme sınırına ulaşıldı.',429);
      await this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'campaign_review',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),day);
    });
    return await this.db.transaction(async ()=>{
      await this.authorize('campaign.approve');
      const campaign=await this.campaign(id),{digest}=await this.context(campaign),latest=(await this.history(id))[0],receipt=await this.receipt(id);
      if(input.expectedDigest!==digest)throw new MarketingStoreError('Taslak değişti. İncelemeyi yenileyin.',409);
      if(latest&&latest.actor_id===this.scope.subject&&latest.decision===input.decision&&latest.content_digest===digest&&latest.note===input.note.trim())return await this.get(id);
      if((latest?.id||null)!==input.expectedReviewId)throw new MarketingStoreError('Başka bir karar kaydedildi. İncelemeyi yenileyin.',409);
      if(input.decision==='revoked'&&latest?.decision!=='approved')throw new MarketingStoreError('Geri çekilecek onay bulunamadı.',409);
      if(input.decision==='approved'){
        if(!this.contentChecks(campaign).every(check=>check.state==='pass')||!await this.fresh(campaign,receipt,digest)||JSON.parse(receipt!.counts_json).matched<1)throw new MarketingStoreError('Onaydan önce güncel içerik ve dolu kitle ön kontrolü gerekli.',409);
        const binding=campaign.segmentBinding!,segments=new ProductSegments(this.db,this.scope);
        await segments.binding(binding.segmentId,binding.segmentVersion,campaign.goalId||'');
        const current=await this.db.prepare('SELECT data_revision FROM platform_segment_previews WHERE segment_id=? AND version=? AND organization_id=? AND project_id=?').get(binding.segmentId,binding.segmentVersion,...this.args()) as {data_revision:string};
        if(current.data_revision!==receipt!.data_revision)throw new MarketingStoreError('Kitle verisi değişti. Ön kontrolü tekrarlayın.',409);
      }
      const count=(await this.db.prepare('SELECT COUNT(*) AS n FROM platform_campaign_reviews WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n;
      if((await this.history(id)).length>=50||count>=5000)throw new MarketingStoreError('Pilot inceleme geçmişi sınırına ulaşıldı.',429);
      await this.db.prepare('INSERT INTO platform_campaign_reviews(organization_id,project_id,campaign_id,content_digest,data_revision,decision,note,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(...this.args(),id,digest,receipt?.data_revision||'',input.decision,input.note.trim(),this.scope.subject,new Date().toISOString());
      await this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),`campaign.review.${input.decision}`,new Date().toISOString());return await this.get(id);
    });
  }
}
