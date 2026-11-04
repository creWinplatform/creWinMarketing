import 'server-only';
import { createHash,randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import sharp from 'sharp';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { assertProjectDelivery,assertProjectWork } from './entitlements';
import { ProjectAds,metaAdsGraph,type AdGraph } from './ad-manager';
import { adHttp,type AdHttp,type AdProvider } from './ad-providers';
import { normalizePublicationImage } from './publication-image';
import type { MarketingScope } from './marketing-store';
import type { AdCreativeView } from './ad-types';

// Ad images for created plans. The team adds an image and its text, an approver accepts the exact content, and only then
// is it sent: Meta gets the image, a creative and a PAUSED ad in the plan's ad set; TikTok gets the image in the ad
// account's library (TikTok ad groups and ads are built in TikTok Ads Manager). Nothing starts spending here.
export const AD_CREATIVE_LIMITS={perPlan:10,headline:40,text:500,tiktokText:100} as const;
export const AD_CTAS=['LEARN_MORE','SHOP_NOW','SIGN_UP','BOOK_NOW','CONTACT_US','DOWNLOAD','INSTALL_MOBILE_APP'] as const;
export const adCreativesEnabled=()=>process.env.PLATFORM_AD_CREATIVES_ENABLED==='1';
type Row={id:string;plan_id:string;provider:AdProvider;image:Buffer;thumb:Buffer;width:number;height:number;sha256:string;headline:string;primary_text:string;cta:string;page_id:string;digest:string;state:AdCreativeView['state'];revision:number;approved_digest:string|null;approved_at:string|null;image_ref:string|null;creative_ref:string|null;ad_ref:string|null;last_error:string|null;uploaded_at:string|null;updated_at:string};
const digestOf=(row:Pick<Row,'plan_id'|'sha256'|'headline'|'primary_text'|'cta'|'page_id'>)=>createHash('sha256').update(JSON.stringify([row.plan_id,row.sha256,row.headline,row.primary_text,row.cta,row.page_id])).digest('hex');
const text=(value:unknown,max:number,label:string)=>{const result=typeof value==='string'?value.normalize('NFC').replace(/\r\n/g,'\n').trim():'';if([...result].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(result))throw new MarketingStoreError(`${label} en çok ${max} karakter olabilir.`);return result;};

export class AdCreatives{
  private repo:PlatformRepository;
  constructor(private db:Database.Database,private scope:MarketingScope,private key:string,private provider:AdProvider,private graph:AdGraph=metaAdsGraph,private http:AdHttp=adHttp){this.repo=new PlatformRepository(db);}
  private args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private can(need:'read'|'content.write'|'campaign.approve'|'connections.manage'){return this.repo.can(this.scope.subject,...this.args(),need);}
  private authorize(need:'read'|'content.write'|'campaign.approve'|'connections.manage'='read'){
    if(!this.can(need)||this.repo.workspace(this.scope.subject,...this.args())?.project.productPack!=='standard')throw new MarketingStoreError('Reklam görsellerine erişim reddedildi.',403);
    if(this.provider!=='meta'&&this.provider!=='tiktok')throw new MarketingStoreError('Reklam görseli yükleme şimdilik Meta ve TikTok için var.',409);
  }
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
  private plan(id:unknown){
    const plan=typeof id==='string'?this.db.prepare('SELECT id,name,objective,state,provider_campaign_id,provider_adset_id,link_url,app_json FROM platform_ad_plans WHERE id=? AND organization_id=? AND project_id=? AND provider=?').get(id,...this.args(),this.provider) as {id:string;name:string;objective:string;state:string;provider_campaign_id:string|null;provider_adset_id:string|null;link_url:string;app_json:string|null}|undefined:undefined;
    if(!plan)throw new MarketingStoreError('Reklam planı bulunamadı.',404);return plan;
  }
  private row(id:unknown){const row=typeof id==='string'?this.db.prepare('SELECT * FROM platform_ad_creatives WHERE id=? AND organization_id=? AND project_id=? AND provider=?').get(id,...this.args(),this.provider) as Row|undefined:undefined;if(!row)throw new MarketingStoreError('Reklam görseli bulunamadı.',404);return row;}
  list(planId:unknown):{creatives:AdCreativeView[];enabled:boolean;canWrite:boolean;canApprove:boolean;canUpload:boolean;ctas:readonly string[]}{
    this.authorize();const plan=this.plan(planId);
    const rows=this.db.prepare('SELECT * FROM platform_ad_creatives WHERE plan_id=? AND organization_id=? AND project_id=? ORDER BY created_at,id').all(plan.id,...this.args()) as Row[];
    return {creatives:rows.map(row=>({id:row.id,planId:row.plan_id,thumbnail:`data:image/jpeg;base64,${row.thumb.toString('base64')}`,width:row.width,height:row.height,headline:row.headline,primaryText:row.primary_text,cta:row.cta,pageId:row.page_id,state:row.state,approved:row.state==='approved'&&row.approved_digest===row.digest,revision:row.revision,imageRef:row.image_ref,adRef:row.ad_ref,lastError:row.last_error,uploadedAt:row.uploaded_at,updatedAt:row.updated_at})),
      enabled:adCreativesEnabled(),canWrite:this.can('content.write'),canApprove:this.can('campaign.approve'),canUpload:this.can('connections.manage')&&this.can('campaign.approve'),ctas:plan.objective==='OUTCOME_APP_PROMOTION'?['INSTALL_MOBILE_APP']:AD_CTAS.filter(item=>item!=='INSTALL_MOBILE_APP')};
  }
  // A new image replaces the old one of the same draft; editing text or image clears the approval.
  async save(raw:Record<string,unknown>){
    this.authorize('content.write');assertProjectWork(this.db,this.scope);const plan=this.plan(raw.planId);
    if(!plan.provider_campaign_id)throw new MarketingStoreError('Görsel, sağlayıcıda oluşturulmuş bir plana eklenir.',409);
    const old=raw.id===undefined?null:this.row(raw.id);if(old&&old.plan_id!==plan.id)throw new MarketingStoreError('Reklam görseli bu plana ait değil.',409);
    if(old&&raw.expectedRevision!==old.revision)throw new MarketingStoreError('Reklam görseli başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
    if(old&&!['draft','approved','failed'].includes(old.state))throw new MarketingStoreError('Yüklenmiş veya yüklenmekte olan görsel düzenlenemez.',409);
    let image:{data:Buffer;thumb:Buffer;width:number;height:number;sha256:string};
    if(raw.image){const value=raw.image as {data?:unknown;mime?:unknown},normalized=await normalizePublicationImage(value.data,value.mime,'ad'),data=Buffer.from(normalized.data,'base64');
      image={data,thumb:await sharp(data).resize({width:240,height:240,fit:'inside'}).jpeg({quality:70}).toBuffer(),width:normalized.width,height:normalized.height,sha256:normalized.digest};}
    else if(old)image={data:old.image,thumb:old.thumb,width:old.width,height:old.height,sha256:old.sha256};
    else throw new MarketingStoreError('Bir görsel seçin.');
    const tiktok=this.provider==='tiktok',headline=text(raw.headline,AD_CREATIVE_LIMITS.headline,'Başlık'),primary=text(raw.primaryText,tiktok?AD_CREATIVE_LIMITS.tiktokText:AD_CREATIVE_LIMITS.text,'Reklam metni');
    const ctas=plan.objective==='OUTCOME_APP_PROMOTION'?['INSTALL_MOBILE_APP']:AD_CTAS.filter(item=>item!=='INSTALL_MOBILE_APP'),cta=raw.cta===undefined||raw.cta===''?ctas[0]:String(raw.cta);if(!ctas.includes(cta as never))throw new MarketingStoreError('Geçersiz eylem düğmesi.');
    const page=typeof raw.pageId==='string'?raw.pageId.trim():'';
    if(!tiktok){if(!/^\d{5,25}$/.test(page))throw new MarketingStoreError('Meta reklamı için Facebook Sayfası kimliği (yalnız rakam) gerekli.');if(!primary)throw new MarketingStoreError('Reklam metnini yazın.');}
    const values={plan_id:plan.id,sha256:image.sha256,headline,primary_text:primary,cta,page_id:tiktok?'':page},digest=digestOf(values),now=new Date().toISOString();
    return this.db.transaction(()=>{
      this.authorize('content.write');
      if(old)this.db.prepare("UPDATE platform_ad_creatives SET image=?,thumb=?,width=?,height=?,sha256=?,headline=?,primary_text=?,cta=?,page_id=?,digest=?,state='draft',approved_by=NULL,approved_digest=NULL,approved_at=NULL,last_error=NULL,revision=revision+1,updated_at=? WHERE id=?").run(image.data,image.thumb,image.width,image.height,image.sha256,headline,primary,cta,values.page_id,digest,now,old.id);
      else{if((this.db.prepare('SELECT COUNT(*) n FROM platform_ad_creatives WHERE plan_id=?').get(plan.id) as {n:number}).n>=AD_CREATIVE_LIMITS.perPlan)throw new MarketingStoreError('Bir plana en çok 10 görsel eklenebilir.',429);
        this.db.prepare("INSERT INTO platform_ad_creatives(id,organization_id,project_id,plan_id,provider,image,thumb,width,height,sha256,headline,primary_text,cta,page_id,digest,state,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)").run(randomUUID(),...this.args(),plan.id,this.provider,image.data,image.thumb,image.width,image.height,image.sha256,headline,primary,cta,values.page_id,digest,this.scope.subject,now,now);}
      this.audit('ads.creative.save');return this.list(plan.id);
    }).immediate();
  }
  approve(raw:Record<string,unknown>){
    this.authorize('campaign.approve');
    return this.db.transaction(()=>{this.authorize('campaign.approve');const row=this.row(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Reklam görseli başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);if(row.state!=='draft')throw new MarketingStoreError('Yalnız taslak görsel onaylanabilir.',409);
      const now=new Date().toISOString();this.db.prepare("UPDATE platform_ad_creatives SET state='approved',approved_by=?,approved_digest=?,approved_at=?,revision=revision+1,updated_at=? WHERE id=?").run(this.scope.subject,row.digest,now,now,row.id);this.audit('ads.creative.approve');return this.list(row.plan_id);}).immediate();
  }
  remove(raw:Record<string,unknown>){
    this.authorize('content.write');
    return this.db.transaction(()=>{const row=this.row(raw.id);if(['uploading','uploaded'].includes(row.state))throw new MarketingStoreError('Sağlayıcıya yüklenmiş görsel burada silinemez; sağlayıcının kendi ekranından kaldırın.',409);
      this.db.prepare('DELETE FROM platform_ad_creatives WHERE id=?').run(row.id);this.audit('ads.creative.delete');return this.list(row.plan_id);}).immediate();
  }
  // Sends an approved image: the server switch, an explicit acknowledgement and an unchanged approval.
  async upload(raw:Record<string,unknown>){
    this.authorize('connections.manage');if(!this.can('campaign.approve'))throw new MarketingStoreError('Görseli yüklemek için reklam onay yetkisi de gerekir.',403);assertProjectDelivery(this.db,this.scope);
    if(!adCreativesEnabled())throw new MarketingStoreError('Reklam görseli yükleme bu sunucuda kapalı (PLATFORM_AD_CREATIVES_ENABLED).',409);
    if(raw.acknowledged!==true)throw new MarketingStoreError('Görseli reklam hesabına göndermek için açık onay gerekli.');
    const row=this.row(raw.id);if(row.state!=='approved'||row.approved_digest!==row.digest||digestOf(row)!==row.digest)throw new MarketingStoreError('Görsel onaylı ve onaydan sonra değişmemiş olmalı.',409);
    const access=await new ProjectAds(this.db,this.scope,this.key,this.graph,this.provider,this.http).planAccess(row.plan_id);
    const claimed=this.db.transaction(()=>this.db.prepare("UPDATE platform_ad_creatives SET state='uploading',updated_at=? WHERE id=? AND state='approved' AND digest=?").run(new Date().toISOString(),row.id,row.digest).changes).immediate();
    if(!claimed)throw new MarketingStoreError('Görsel şu anda yükleniyor veya onaydan sonra değişti. Sayfayı yenileyin.',409);
    let image:string|null=null,creative:string|null=null,ad:string|null=null,error:string|null=null;
    try{
      if(this.provider==='tiktok'){
        const form=new FormData();form.set('advertiser_id',access.adAccountId);form.set('upload_type','UPLOAD_BY_FILE');form.set('file_name',`ryzevo-${row.id.slice(0,8)}.jpg`);form.set('image_signature',createHash('md5').update(row.image).digest('hex'));form.set('image_file',new Blob([new Uint8Array(row.image)],{type:'image/jpeg'}),'image.jpg');
        const result=await this.http({method:'POST',url:'https://business-api.tiktok.com/open_api/v1.3/file/image/ad/upload/',headers:{'Access-Token':access.token},body:form});
        const id=String((result.payload.data as Record<string,unknown>|undefined)?.image_id||'');if(result.status!==200||result.payload.code!==0||!/^[\w.-]{1,200}$/.test(id))throw new Error('tiktok_upload');image=id;
      }else{
        const account=access.adAccountId,uploaded=await this.graph('POST',`${account}/adimages`,access.token,{bytes:row.image.toString('base64')});
        const first=Object.values((uploaded.images||{}) as Record<string,{hash?:unknown}>)[0],hash=typeof first?.hash==='string'&&/^[a-f0-9]{16,64}$/.test(first.hash)?first.hash:'';if(!hash)throw new Error('meta_image');image=hash;
        if(!access.plan.provider_adset_id)throw new Error('meta_adset');
        const app=access.plan.app,link=app?.storeUrl||access.plan.link_url;
        const story={page_id:row.page_id,link_data:{image_hash:hash,link,message:row.primary_text,...(row.headline?{name:row.headline}:{}),call_to_action:{type:row.cta,value:row.cta==='INSTALL_MOBILE_APP'&&app?.metaApplicationId?{application:app.metaApplicationId,link}:{link}}}};
        const made=await this.graph('POST',`${account}/adcreatives`,access.token,{name:`${access.plan.name} · ${row.id.slice(0,8)}`,object_story_spec:JSON.stringify(story)});
        creative=typeof made.id==='string'&&/^\d{1,25}$/.test(made.id)?made.id:null;if(!creative)throw new Error('meta_creative');
        const placed=await this.graph('POST',`${account}/ads`,access.token,{name:`${access.plan.name} · ${row.id.slice(0,8)}`,adset_id:access.plan.provider_adset_id,creative:JSON.stringify({creative_id:creative}),status:'PAUSED'});
        ad=typeof placed.id==='string'&&/^\d{1,25}$/.test(placed.id)?placed.id:null;if(!ad)throw new Error('meta_ad');
      }
    }catch{error=this.provider==='tiktok'?'Görsel TikTok kütüphanesine yüklenemedi. Erişim anahtarının izinlerini kontrol edin.':image?(creative?'Görsel ve reklam içeriği Meta’ya yüklendi ancak reklam oluşturulamadı; Reklam Yöneticisi’nden kontrol edin.':'Görsel Meta’ya yüklendi ancak reklam içeriği oluşturulamadı. Sayfa kimliğini ve sayfa iznini kontrol edin.'):'Görsel Meta’ya yüklenemedi.';}
    return this.db.transaction(()=>{const now=new Date().toISOString();
      this.db.prepare("UPDATE platform_ad_creatives SET state=?,image_ref=?,creative_ref=?,ad_ref=?,last_error=?,uploaded_at=?,revision=revision+1,updated_at=? WHERE id=? AND state='uploading'").run(error?'failed':'uploaded',image,creative,ad,error,error?null:now,now,row.id);
      this.audit(error?'ads.creative.failed':'ads.creative.uploaded');return this.list(row.plan_id);}).immediate();
  }
}
