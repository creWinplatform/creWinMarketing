import 'server-only';
import { createHash,randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import sharp from 'sharp';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { assertProjectDelivery,assertProjectWork } from './entitlements';
import { ProjectAds,adMinorUnit,metaAdsGraph,type AdGraph } from './ad-manager';
import { adHttp,type AdHttp,type AdProvider } from './ad-providers';
import { normalizePublicationImage } from './publication-image';
import { checkPublicationVideo,normalizeContentVideo,readVideoHeaders,sameVideo,type PublicationVideo,type VideoReader } from './social-video';
import type { MarketingScope } from './marketing-store';
import type { AdCreativeView,TikTokAdSetupView } from './ad-types';
import { CREATIVE_STATS,count,creativeStats,spendMinor,storeCreativeDays } from './ad-creative-stats';

// Ad images and videos for created plans. The team adds an image (the cover of a video) and its text, optionally the
// address of a video it hosts; an approver accepts the exact content, and only then is it sent:
// - Meta: the image (and the video, fetched by Meta from the address), a creative and a PAUSED ad in the plan's ad set.
// - TikTok: the image and video in the ad account's library and, once the plan's TikTok ad group is set up, a DISABLED
//   video ad in it. TikTok shows ads with a video only.
// Nothing starts spending here: delivery starts only with the plan's own start approval.
export const AD_CREATIVE_LIMITS={perPlan:10,headline:40,text:500,tiktokText:100,displayName:40} as const;
export const AD_CTAS=['LEARN_MORE','SHOP_NOW','SIGN_UP','BOOK_NOW','CONTACT_US','DOWNLOAD','INSTALL_MOBILE_APP'] as const;
const TIKTOK_CTA:Record<string,string>={LEARN_MORE:'LEARN_MORE',SHOP_NOW:'SHOP_NOW',SIGN_UP:'SIGN_UP',BOOK_NOW:'BOOK_NOW',CONTACT_US:'CONTACT_US',DOWNLOAD:'DOWNLOAD_NOW',INSTALL_MOBILE_APP:'DOWNLOAD_NOW'};
export const adCreativesEnabled=()=>process.env.PLATFORM_AD_CREATIVES_ENABLED==='1';
type Row={stats_checked_at:string|null;id:string;plan_id:string;provider:AdProvider;image:Buffer;thumb:Buffer;width:number;height:number;sha256:string;headline:string;primary_text:string;cta:string;page_id:string;digest:string;state:AdCreativeView['state'];revision:number;approved_digest:string|null;approved_at:string|null;image_ref:string|null;creative_ref:string|null;ad_ref:string|null;last_error:string|null;uploaded_at:string|null;updated_at:string;video_json:string|null;video_ref:string|null};
type Setup={plan_id:string;adgroup_id:string;identity_id:string;display_name:string;tiktok_app_id:string;created_at:string};
const videoOf=(row:Pick<Row,'video_json'>)=>row.video_json?JSON.parse(row.video_json) as PublicationVideo:null;
const digestOf=(row:Pick<Row,'plan_id'|'sha256'|'headline'|'primary_text'|'cta'|'page_id'|'video_json'>)=>{const video=videoOf(row);return createHash('sha256').update(JSON.stringify([row.plan_id,row.sha256,row.headline,row.primary_text,row.cta,row.page_id,...(video?[[video.url,video.bytes,video.contentType,video.etag,video.lastModified]]:[])])).digest('hex');};
const text=(value:unknown,max:number,label:string)=>{const result=typeof value==='string'?value.normalize('NFC').replace(/\r\n/g,'\n').trim():'';if([...result].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(result))throw new MarketingStoreError(`${label} en çok ${max} karakter olabilir.`);return result;};
// The provider's own short reason, kept with the error for the team (no tokens are ever part of it).
const reason=(payload:Record<string,unknown>|undefined)=>{const value=typeof payload?.message==='string'?payload.message:'';return value?` (${value.replace(/[\x00-\x1f]/g,' ').slice(0,160)})`:'';};
class ProviderError extends Error{constructor(public step:string,public detail=''){super(step);}}
const TT='https://business-api.tiktok.com/open_api/v1.3';

export class AdCreatives{
  private repo:PlatformRepository;
  constructor(private db:Database.Database,private scope:MarketingScope,private key:string,private provider:AdProvider,private graph:AdGraph=metaAdsGraph,private http:AdHttp=adHttp,private videos:VideoReader=readVideoHeaders,private wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){this.repo=new PlatformRepository(db);}
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
  private setup(planId:string){return this.db.prepare('SELECT * FROM platform_tiktok_adgroups WHERE plan_id=? AND organization_id=? AND project_id=?').get(planId,...this.args()) as Setup|undefined;}
  list(planId:unknown):{creatives:AdCreativeView[];enabled:boolean;canWrite:boolean;canApprove:boolean;canUpload:boolean;ctas:readonly string[];tiktok:TikTokAdSetupView|null}{
    this.authorize();const plan=this.plan(planId),setup=this.provider==='tiktok'?this.setup(plan.id):undefined;
    const rows=this.db.prepare('SELECT * FROM platform_ad_creatives WHERE plan_id=? AND organization_id=? AND project_id=? ORDER BY created_at,id').all(plan.id,...this.args()) as Row[];
    const currency=(this.db.prepare('SELECT currency FROM platform_ad_plans WHERE id=?').get(plan.id) as {currency:string}).currency,stats=new Map(rows.map(row=>[row.id,creativeStats(this.db,row.id,currency)]));
    // The best click-through rate among creatives with enough impressions, for the comparison.
    const ranked=[...stats.entries()].filter(([,value])=>value&&value.impressions>=CREATIVE_STATS.minImpressions&&value.ctr!==null).sort((a,b)=>b[1]!.ctr!-a[1]!.ctr!),best=ranked.length>1?ranked[0][0]:null;
    return {creatives:rows.map(row=>{const video=videoOf(row);return {stats:stats.get(row.id)||null,best:row.id===best,statsCheckedAt:row.stats_checked_at,id:row.id,planId:row.plan_id,thumbnail:`data:image/jpeg;base64,${row.thumb.toString('base64')}`,width:row.width,height:row.height,headline:row.headline,primaryText:row.primary_text,cta:row.cta,pageId:row.page_id,videoUrl:video?.url||null,videoBytes:video?.bytes||null,state:row.state,approved:row.state==='approved'&&row.approved_digest===row.digest,revision:row.revision,imageRef:row.image_ref,videoRef:row.video_ref,adRef:row.ad_ref,lastError:row.last_error,uploadedAt:row.uploaded_at,updatedAt:row.updated_at};}),
      enabled:adCreativesEnabled(),canWrite:this.can('content.write'),canApprove:this.can('campaign.approve'),canUpload:this.can('connections.manage')&&this.can('campaign.approve'),ctas:plan.objective==='OUTCOME_APP_PROMOTION'?['INSTALL_MOBILE_APP']:AD_CTAS.filter(item=>item!=='INSTALL_MOBILE_APP'),
      tiktok:this.provider==='tiktok'?{ready:Boolean(setup),adgroupId:setup?.adgroup_id||null,displayName:setup?.display_name||null,needsAppId:plan.objective==='OUTCOME_APP_PROMOTION',createdAt:setup?.created_at||null}:null};
  }
  // A new image replaces the old one of the same draft; editing image, video or text clears the approval.
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
    // A video is the team's own https address, checked with the SSRF-safe reader (type, size, no redirect).
    const videoUrl=typeof raw.videoUrl==='string'?raw.videoUrl.trim():'';
    const video=videoUrl?await checkPublicationVideo(normalizeContentVideo({url:videoUrl,format:'feed'},'tiktok'),this.videos):null;
    const tiktok=this.provider==='tiktok',headline=text(raw.headline,AD_CREATIVE_LIMITS.headline,'Başlık'),primary=text(raw.primaryText,tiktok?AD_CREATIVE_LIMITS.tiktokText:AD_CREATIVE_LIMITS.text,'Reklam metni');
    const ctas=plan.objective==='OUTCOME_APP_PROMOTION'?['INSTALL_MOBILE_APP']:AD_CTAS.filter(item=>item!=='INSTALL_MOBILE_APP'),cta=raw.cta===undefined||raw.cta===''?ctas[0]:String(raw.cta);if(!ctas.includes(cta as never))throw new MarketingStoreError('Geçersiz eylem düğmesi.');
    const page=typeof raw.pageId==='string'?raw.pageId.trim():'';
    if(!tiktok){if(!/^\d{5,25}$/.test(page))throw new MarketingStoreError('Meta reklamı için Facebook Sayfası kimliği (yalnız rakam) gerekli.');if(!primary)throw new MarketingStoreError('Reklam metnini yazın.');}
    if(tiktok&&video&&!primary)throw new MarketingStoreError('TikTok video reklamı için reklam metnini yazın.');
    const values={plan_id:plan.id,sha256:image.sha256,headline,primary_text:primary,cta,page_id:tiktok?'':page,video_json:video?JSON.stringify(video):null},digest=digestOf(values),now=new Date().toISOString();
    return this.db.transaction(()=>{
      this.authorize('content.write');
      if(old)this.db.prepare("UPDATE platform_ad_creatives SET image=?,thumb=?,width=?,height=?,sha256=?,headline=?,primary_text=?,cta=?,page_id=?,video_json=?,digest=?,state='draft',approved_by=NULL,approved_digest=NULL,approved_at=NULL,last_error=NULL,image_ref=CASE WHEN sha256=? THEN image_ref ELSE NULL END,video_ref=CASE WHEN COALESCE(video_json,'')=COALESCE(?,'') THEN video_ref ELSE NULL END,revision=revision+1,updated_at=? WHERE id=?").run(image.data,image.thumb,image.width,image.height,image.sha256,headline,primary,cta,values.page_id,values.video_json,digest,image.sha256,values.video_json,now,old.id);
      else{if((this.db.prepare('SELECT COUNT(*) n FROM platform_ad_creatives WHERE plan_id=?').get(plan.id) as {n:number}).n>=AD_CREATIVE_LIMITS.perPlan)throw new MarketingStoreError('Bir plana en çok 10 görsel eklenebilir.',429);
        this.db.prepare("INSERT INTO platform_ad_creatives(id,organization_id,project_id,plan_id,provider,image,thumb,width,height,sha256,headline,primary_text,cta,page_id,digest,state,created_by,created_at,updated_at,video_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?)").run(randomUUID(),...this.args(),plan.id,this.provider,image.data,image.thumb,image.width,image.height,image.sha256,headline,primary,cta,values.page_id,digest,this.scope.subject,now,now,values.video_json);}
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
  private async tiktok(path:string,token:string,body:Record<string,unknown>|FormData,method:'GET'|'POST'='POST'){
    let url=`${TT}/${path}`;if(method==='GET')url+=`?${new URLSearchParams(Object.entries(body as Record<string,unknown>).map(([key,value])=>[key,typeof value==='string'?value:JSON.stringify(value)]))}`;
    const result=await this.http({method,url,headers:body instanceof FormData?{'Access-Token':token}:{'Access-Token':token,'Content-Type':'application/json'},body:method==='GET'?undefined:body instanceof FormData?body:JSON.stringify(body)});
    if(result.status!==200||result.payload.code!==0)throw new ProviderError(path,reason(result.payload));
    return (result.payload.data||{}) as Record<string,unknown>;
  }
  // TikTok ads need an ad group and an identity (the name shown on the ad). Both are made once per plan from the plan's
  // approved budget, dates and countries, DISABLED; countries are matched to TikTok's own location list, never guessed.
  async setupTikTok(raw:Record<string,unknown>){
    this.authorize('connections.manage');if(this.provider!=='tiktok')throw new MarketingStoreError('Bu işlem yalnız TikTok planları için.',409);if(!this.can('campaign.approve'))throw new MarketingStoreError('Reklam grubunu kurmak için reklam onay yetkisi de gerekir.',403);assertProjectDelivery(this.db,this.scope);
    if(!adCreativesEnabled())throw new MarketingStoreError('Reklam görseli yükleme bu sunucuda kapalı (PLATFORM_AD_CREATIVES_ENABLED).',409);
    if(raw.acknowledged!==true)throw new MarketingStoreError('TikTok’ta reklam grubu oluşturmak için açık onay gerekli.');
    const plan=this.plan(raw.planId);if(this.setup(plan.id))throw new MarketingStoreError('Bu planın TikTok reklam grubu zaten kurulu.',409);
    const name=text(raw.displayName,AD_CREATIVE_LIMITS.displayName,'Görünen ad');if(!name)throw new MarketingStoreError('Reklamda görünecek adı yazın.');
    const access=await new ProjectAds(this.db,this.scope,this.key,this.graph,this.provider,this.http).planAccess(plan.id);
    if(!access.plan.approved)throw new MarketingStoreError('Plan onaylı ve onaydan sonra değişmemiş olmalı.',409);
    const app=access.plan.app,appId=typeof raw.tiktokAppId==='string'?raw.tiktokAppId.trim():'';
    if(access.plan.objective==='OUTCOME_APP_PROMOTION'&&!/^\d{5,25}$/.test(appId))throw new MarketingStoreError('Uygulama planı için TikTok’taki uygulama kimliği (App ID, yalnız rakam) gerekli.');
    this.db.transaction(()=>{const period=new Date().toISOString().slice(0,10),old=this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='tiktok_adgroup'").get(...this.args(),period) as {count:number}|undefined;if((old?.count||0)>=10)throw new MarketingStoreError('Günlük TikTok kurulum sınırına ulaşıldı.',429);this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'tiktok_adgroup',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),period);}).immediate();
    const advertiser=access.adAccountId,unit=adMinorUnit(access.plan.currency);
    try{
      const regions=((await this.tiktok('tool/region/',access.token,{advertiser_id:advertiser,placements:['PLACEMENT_TIKTOK'],objective_type:access.plan.objective==='OUTCOME_APP_PROMOTION'?'APP_PROMOTION':access.plan.objective==='OUTCOME_TRAFFIC'?'TRAFFIC':'REACH'},'GET')).region_info||[]) as {location_id?:unknown;region_code?:unknown;level?:unknown}[];
      const locations=access.plan.countries.map(code=>regions.find(item=>String(item.region_code).toUpperCase()===code&&(item.level===undefined||String(item.level).toUpperCase().includes('COUNTRY')))?.location_id).map(String);
      if(locations.some(item=>!/^\d{1,20}$/.test(item)))throw new ProviderError('location','');
      const identity=String((await this.tiktok('identity/create/',access.token,{advertiser_id:advertiser,display_name:name})).identity_id||'');if(!/^[\w-]{1,100}$/.test(identity))throw new ProviderError('identity/create/');
      const goal=access.plan.objective==='OUTCOME_APP_PROMOTION'?['INSTALL','OCPM']:access.plan.objective==='OUTCOME_TRAFFIC'?['CLICK','CPC']:['REACH','CPM'];
      const group=await this.tiktok('adgroup/create/',access.token,{advertiser_id:advertiser,campaign_id:access.plan.provider_campaign_id,adgroup_name:`${access.plan.name} · Ryzevo`,
        promotion_type:access.plan.objective==='OUTCOME_APP_PROMOTION'?(app?.store==='apple'?'APP_IOS':'APP_ANDROID'):'WEBSITE',...(access.plan.objective==='OUTCOME_APP_PROMOTION'?{app_id:appId}:{}),
        placement_type:'PLACEMENT_TYPE_NORMAL',placements:['PLACEMENT_TIKTOK'],location_ids:locations,budget_mode:'BUDGET_MODE_DAY',budget:access.plan.daily_budget_minor/unit,
        schedule_type:'SCHEDULE_START_END',schedule_start_time:`${access.plan.start_date} 00:00:00`,schedule_end_time:`${access.plan.end_date} 23:59:59`,
        optimization_goal:goal[0],billing_event:goal[1],bid_type:'BID_TYPE_NO_BID',pacing:'PACING_MODE_SMOOTH',operation_status:'DISABLE'});
      const adgroup=String(group.adgroup_id||'');if(!/^\d{1,25}$/.test(adgroup))throw new ProviderError('adgroup/create/');
      this.db.transaction(()=>{const now=new Date().toISOString();
        this.db.prepare('INSERT INTO platform_tiktok_adgroups VALUES(?,?,?,?,?,?,?,?,?)').run(plan.id,...this.args(),adgroup,identity,name,appId,this.scope.subject,now);
        this.db.prepare('UPDATE platform_ad_plans SET provider_adset_id=?,updated_at=? WHERE id=?').run(adgroup,now,plan.id);this.audit('ads.tiktok.adgroup');}).immediate();
    }catch(error){
      if(error instanceof MarketingStoreError)throw error;const failure=error instanceof ProviderError?error:new ProviderError('');
      throw new MarketingStoreError(failure.step==='location'?'Ülkelerden biri TikTok’un konum listesinde bulunamadı; reklam grubu oluşturulmadı.':`TikTok reklam grubu oluşturulamadı${failure.detail}. TikTok Ads Manager’dan kontrol edin.`,502);
    }
    return this.list(plan.id);
  }
  // Daily figures of the plan's sent ads for the last 14 days, as the provider reports them. A read; nothing changes.
  async refreshStats(raw:Record<string,unknown>){
    this.authorize('connections.manage');const plan=this.plan(raw.planId);
    const rows=this.db.prepare("SELECT id,ad_ref FROM platform_ad_creatives WHERE plan_id=? AND organization_id=? AND project_id=? AND state='uploaded' AND ad_ref IS NOT NULL").all(plan.id,...this.args()) as {id:string;ad_ref:string}[];
    if(!rows.length)throw new MarketingStoreError('Bu planda sağlayıcıda reklama dönüşmüş görsel yok.',409);
    this.db.transaction(()=>{const period=new Date().toISOString().slice(0,10),old=this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='ad_creative_stats'").get(...this.args(),period) as {count:number}|undefined;if((old?.count||0)>=40)throw new MarketingStoreError('Günlük performans okuma sınırına ulaşıldı.',429);this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'ad_creative_stats',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),period);}).immediate();
    const access=await new ProjectAds(this.db,this.scope,this.key,this.graph,this.provider,this.http).planAccess(plan.id),currency=access.plan.currency,app=access.plan.objective==='OUTCOME_APP_PROMOTION';
    const since=new Date(Date.now()-(CREATIVE_STATS.days-1)*86400000).toISOString().slice(0,10),until=new Date().toISOString().slice(0,10),days:{creative_id:string;day:string;impressions:number;clicks:number;spend_minor:number;conversions:number|null}[]=[];
    try{
      if(this.provider==='meta')for(const row of rows){
        const value=await this.graph('GET',`${row.ad_ref}/insights`,access.token,{fields:'spend,impressions,clicks,actions,date_start',time_increment:'1',time_range:JSON.stringify({since,until}),limit:'100'});
        for(const item of (Array.isArray(value.data)?value.data:[]) as Record<string,unknown>[]){const day=String(item.date_start||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;
          const actions=(Array.isArray(item.actions)?item.actions:[]) as {action_type?:unknown;value?:unknown}[],installs=actions.filter(action=>['mobile_app_install','app_install','omni_app_install'].includes(String(action.action_type))).reduce((total,action)=>total+count(action.value),0);
          days.push({creative_id:row.id,day,impressions:count(item.impressions),clicks:count(item.clicks),spend_minor:spendMinor(item.spend,currency),conversions:app?installs:null});}
      }else{
        const value=await this.tiktok('report/integrated/get/',access.token,{advertiser_id:access.adAccountId,report_type:'BASIC',data_level:'AUCTION_AD',dimensions:['ad_id','stat_time_day'],metrics:['spend','impressions','clicks','conversion'],start_date:since,end_date:until,filtering:[{field_name:'ad_ids',filter_type:'IN',filter_value:JSON.stringify(rows.map(row=>row.ad_ref))}],page_size:1000},'GET');
        for(const item of (Array.isArray(value.list)?value.list:[]) as {dimensions?:Record<string,unknown>;metrics?:Record<string,unknown>}[]){const creative=rows.find(row=>row.ad_ref===String(item.dimensions?.ad_id)),day=String(item.dimensions?.stat_time_day||'').slice(0,10);if(!creative||!/^\d{4}-\d{2}-\d{2}$/.test(day))continue;
          days.push({creative_id:creative.id,day,impressions:count(item.metrics?.impressions),clicks:count(item.metrics?.clicks),spend_minor:spendMinor(item.metrics?.spend,currency),conversions:app?count(item.metrics?.conversion):null});}
      }
    }catch(failure){throw new MarketingStoreError(`${this.provider==='meta'?'Meta':'TikTok'} reklam performansı okunamadı${failure instanceof ProviderError?failure.detail:''}.`,502);}
    this.db.transaction(()=>{storeCreativeDays(this.db,days);this.db.prepare('UPDATE platform_ad_creatives SET stats_checked_at=? WHERE plan_id=? AND ad_ref IS NOT NULL').run(new Date().toISOString(),plan.id);this.audit('ads.creative.stats');}).immediate();
    return this.list(plan.id);
  }
  // Sends an approved image: the server switch, an explicit acknowledgement and an unchanged approval. Steps already done
  // (an uploaded image or video) are not repeated when the team presses Send again.
  async upload(raw:Record<string,unknown>){
    this.authorize('connections.manage');if(!this.can('campaign.approve'))throw new MarketingStoreError('Görseli yüklemek için reklam onay yetkisi de gerekir.',403);assertProjectDelivery(this.db,this.scope);
    if(!adCreativesEnabled())throw new MarketingStoreError('Reklam görseli yükleme bu sunucuda kapalı (PLATFORM_AD_CREATIVES_ENABLED).',409);
    if(raw.acknowledged!==true)throw new MarketingStoreError('Görseli reklam hesabına göndermek için açık onay gerekli.');
    const row=this.row(raw.id),waiting=this.provider==='tiktok'&&row.state==='uploaded'&&Boolean(row.video_ref)&&!row.ad_ref&&Boolean(this.setup(row.plan_id));
    // A TikTok video already in the library becomes an ad once the plan's ad group is set up.
    if(!(row.state==='approved'||waiting)||row.approved_digest!==row.digest||digestOf(row)!==row.digest)throw new MarketingStoreError('Görsel onaylı ve onaydan sonra değişmemiş olmalı.',409);
    const stored=videoOf(row);if(stored&&!row.video_ref){let current;try{current=await checkPublicationVideo({url:stored.url,format:stored.format},this.videos);}catch{current=null;}if(!current||!sameVideo(current,stored))throw new MarketingStoreError('Video dosyası onaydan sonra değişti veya ulaşılamıyor. Taslağı yeniden kaydedip onaylayın.',409);}
    const access=await new ProjectAds(this.db,this.scope,this.key,this.graph,this.provider,this.http).planAccess(row.plan_id),setup=this.provider==='tiktok'?this.setup(row.plan_id):undefined;
    const claimed=this.db.transaction(()=>this.db.prepare("UPDATE platform_ad_creatives SET state='uploading',updated_at=? WHERE id=? AND state=? AND digest=?").run(new Date().toISOString(),row.id,row.state,row.digest).changes).immediate();
    if(!claimed)throw new MarketingStoreError('Görsel şu anda yükleniyor veya onaydan sonra değişti. Sayfayı yenileyin.',409);
    let image=row.image_ref,video=row.video_ref,creative:string|null=null,ad:string|null=null,error:string|null=null,retry=false;
    try{
      if(this.provider==='tiktok'){
        if(!image){const form=new FormData();form.set('advertiser_id',access.adAccountId);form.set('upload_type','UPLOAD_BY_FILE');form.set('file_name',`ryzevo-${row.id.slice(0,8)}.jpg`);form.set('image_signature',createHash('md5').update(row.image).digest('hex'));form.set('image_file',new Blob([new Uint8Array(row.image)],{type:'image/jpeg'}),'image.jpg');
          const id=String((await this.tiktok('file/image/ad/upload/',access.token,form)).image_id||'');if(!/^[\w.-]{1,200}$/.test(id))throw new ProviderError('file/image/ad/upload/');image=id;}
        if(stored&&!video){const data=await this.tiktok('file/video/ad/upload/',access.token,{advertiser_id:access.adAccountId,upload_type:'UPLOAD_BY_URL',video_url:stored.url,file_name:`ryzevo-${row.id.slice(0,8)}`}),first=(Array.isArray(data)?data[0]:Array.isArray(data.list)?(data.list as unknown[])[0]:data) as Record<string,unknown>|undefined;
          const id=String(first?.video_id||'');if(!/^[\w.-]{1,200}$/.test(id))throw new ProviderError('file/video/ad/upload/');video=id;}
        if(stored&&setup){const plan=access.plan,cta=TIKTOK_CTA[row.cta]||'LEARN_MORE';
          const made=await this.tiktok('ad/create/',access.token,{advertiser_id:access.adAccountId,adgroup_id:setup.adgroup_id,creatives:[{ad_name:`${plan.name} · ${row.id.slice(0,8)}`,identity_type:'CUSTOMIZED_USER',identity_id:setup.identity_id,ad_format:'SINGLE_VIDEO',video_id:video,image_ids:[image],ad_text:row.primary_text,call_to_action:cta,...(plan.objective==='OUTCOME_APP_PROMOTION'?{}:{landing_page_url:plan.link_url})}],operation_status:'DISABLE'});
          const id=String(((made.ad_ids||[]) as unknown[])[0]||'');if(!/^\d{1,25}$/.test(id))throw new ProviderError('ad/create/');ad=id;}
      }else{
        const account=access.adAccountId;
        if(!image){const uploaded=await this.graph('POST',`${account}/adimages`,access.token,{bytes:row.image.toString('base64')});
          const first=Object.values((uploaded.images||{}) as Record<string,{hash?:unknown}>)[0],hash=typeof first?.hash==='string'&&/^[a-f0-9]{16,64}$/.test(first.hash)?first.hash:'';if(!hash)throw new ProviderError('adimages');image=hash;}
        if(stored&&!video){const made=await this.graph('POST',`${account}/advideos`,access.token,{file_url:stored.url,name:`${access.plan.name} · ${row.id.slice(0,8)}`});video=typeof made.id==='string'&&/^\d{1,25}$/.test(made.id)?made.id:null;if(!video)throw new ProviderError('advideos');}
        // Meta processes a video after fetching it; the ad is made once it is ready, otherwise Send is pressed again later.
        if(stored){let status='';for(let attempt=0;attempt<4;attempt++){const value=await this.graph('GET',video!,access.token,{fields:'status'});status=String((value.status as {video_status?:unknown}|undefined)?.video_status||'');if(status==='ready'||status==='error')break;await this.wait(4000);}
          if(status==='error')throw new ProviderError('video_error');if(status!=='ready'){retry=true;throw new ProviderError('video_processing');}}
        if(!access.plan.provider_adset_id)throw new ProviderError('adset');
        const app=access.plan.app,link=app?.storeUrl||access.plan.link_url,action={type:row.cta,value:row.cta==='INSTALL_MOBILE_APP'&&app?.metaApplicationId?{application:app.metaApplicationId,link}:{link}};
        const story=stored?{page_id:row.page_id,video_data:{video_id:video,image_hash:image,message:row.primary_text,...(row.headline?{title:row.headline}:{}),call_to_action:action}}:{page_id:row.page_id,link_data:{image_hash:image,link,message:row.primary_text,...(row.headline?{name:row.headline}:{}),call_to_action:action}};
        const made=await this.graph('POST',`${account}/adcreatives`,access.token,{name:`${access.plan.name} · ${row.id.slice(0,8)}`,object_story_spec:JSON.stringify(story)});
        creative=typeof made.id==='string'&&/^\d{1,25}$/.test(made.id)?made.id:null;if(!creative)throw new ProviderError('adcreatives');
        const placed=await this.graph('POST',`${account}/ads`,access.token,{name:`${access.plan.name} · ${row.id.slice(0,8)}`,adset_id:access.plan.provider_adset_id,creative:JSON.stringify({creative_id:creative}),status:'PAUSED'});
        ad=typeof placed.id==='string'&&/^\d{1,25}$/.test(placed.id)?placed.id:null;if(!ad)throw new ProviderError('ads');
      }
    }catch(failure){
      const step=failure instanceof ProviderError?failure.step:'',detail=failure instanceof ProviderError?failure.detail:'';
      error=step==='video_processing'?'Video Meta’da hâlâ işleniyor; birkaç dakika sonra yeniden “Gönder”e basın.':step==='video_error'?'Meta videoyu işleyemedi. Video dosyasını kontrol edip taslağı yeniden kaydedin.'
        :this.provider==='tiktok'?(step==='ad/create/'?`Görsel ve video TikTok kütüphanesine yüklendi ancak reklam oluşturulamadı${detail}.`:`TikTok’a yükleme tamamlanamadı${detail}. Erişim anahtarının izinlerini kontrol edin.`)
        :image?(creative?'Görsel ve reklam içeriği Meta’ya yüklendi ancak reklam oluşturulamadı; Reklam Yöneticisi’nden kontrol edin.':'Görsel Meta’ya yüklendi ancak reklam içeriği oluşturulamadı. Sayfa kimliğini ve sayfa iznini kontrol edin.'):'Görsel Meta’ya yüklenemedi.';
    }
    return this.db.transaction(()=>{const now=new Date().toISOString();
      // Waiting for Meta keeps the approval, so Send can be pressed again without a new approval.
      this.db.prepare("UPDATE platform_ad_creatives SET state=?,image_ref=?,video_ref=?,creative_ref=?,ad_ref=?,last_error=?,uploaded_at=?,revision=revision+1,updated_at=? WHERE id=? AND state='uploading'").run(error?(retry?'approved':'failed'):'uploaded',image,video,creative,ad,error,error?null:now,now,row.id);
      this.audit(error?(retry?'ads.creative.waiting':'ads.creative.failed'):'ads.creative.uploaded');return this.list(row.plan_id);}).immediate();
  }
}

// Worker step: the figures of one plan's sent ads are read once a day, as the plan's approver.
export async function refreshDueCreativeStats(db:Database.Database,key:string,make?:(scope:MarketingScope,provider:AdProvider)=>{refreshStats:(raw:Record<string,unknown>)=>Promise<unknown>}){
  const cutoff=new Date(Date.now()-86400000).toISOString();
  const due=db.prepare(`SELECT p.id,p.provider,p.organization_id,p.project_id,p.approved_by FROM platform_ad_plans p JOIN platform_projects x ON x.id=p.project_id AND x.organization_id=p.organization_id AND x.product_pack='standard'
    WHERE p.state IN ('active','paused') AND p.approved_by IS NOT NULL AND EXISTS(SELECT 1 FROM platform_ad_creatives c WHERE c.plan_id=p.id AND c.state='uploaded' AND c.ad_ref IS NOT NULL AND (c.stats_checked_at IS NULL OR c.stats_checked_at<?))
    ORDER BY p.updated_at LIMIT 1`).get(cutoff) as {id:string;provider:AdProvider;organization_id:string;project_id:string;approved_by:string}|undefined;
  if(!due)return 0;const scope={subject:due.approved_by,organizationId:due.organization_id,projectId:due.project_id};
  try{await (make?make(scope,due.provider):new AdCreatives(db,scope,key,due.provider)).refreshStats({planId:due.id});return 1;}
  catch{db.prepare('UPDATE platform_ad_creatives SET stats_checked_at=? WHERE plan_id=?').run(new Date().toISOString(),due.id);return 0;}
}

