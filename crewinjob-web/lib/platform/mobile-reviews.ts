import 'server-only';
import { createHash,randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { MarketingStoreError } from './errors';
import { assertProjectDelivery,assertProjectWork } from './entitlements';
import { mobileId } from './mobile-validation';
import { mobileGoogleAccess,type MobileSecret,type MobileTransport } from './mobile-providers';
import { REPLY_LIMITS,readAppStoreReviews,readPlayReviews,replyAppStoreReview,replyPlayReview,type StoreReview } from './mobile-aso-providers';
import { MobileGrowth,mobileRevision } from './mobile-store';
import { maskPersonal } from './messaging-sources';
import { COACH_BANNED,coachClip,coachObject,coachText,type CoachGenerator } from './coach';
import { parseCoachJson,runCoachAi } from './coach-ai';
import type { MobileReviewView,MobileReviewsSnapshot } from './mobile-types';

export const REVIEW_LIMITS={perApp:1000,keepDays:400,syncEveryHours:24,list:50} as const;
export const reviewRepliesEnabled=()=>process.env.PLATFORM_MOBILE_REVIEW_REPLY_ENABLED==='1';
type Store='ios'|'android';
type ReviewRow={id:string;app_id:string;store:Store;provider_id:string;rating:number;title:string;body:string;author:string;territory:string;language:string;app_version:string;reviewed_at:string;store_reply:string|null;store_reply_at:string|null};
type ReplyRow={review_id:string;text:string;digest:string;source:'team'|'ai';state:'draft'|'approved'|'sending'|'sent'|'failed';revision:number;approved_digest:string|null;approved_at:string|null;sent_at:string|null;last_error:string|null;updated_at:string};
type TokenSource=(secret:MobileSecret,scope:string)=>Promise<string>;
const digestOf=(reviewId:string,text:string)=>createHash('sha256').update(JSON.stringify([reviewId,text])).digest('hex');
const kindOf=(store:Store)=>store==='ios'?'app_store_connect':'google_play';
export function cleanReply(store:Store,value:unknown){
  const text=typeof value==='string'?value.normalize('NFC').replace(/\r\n/g,'\n').trim():'';
  if(!text)throw new MarketingStoreError('Yanıt metni gerekli.');
  if([...text].length>REPLY_LIMITS[store])throw new MarketingStoreError(`Yanıt en çok {0} karakter olabilir.`.replace('{0}',String(REPLY_LIMITS[store])));
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))throw new MarketingStoreError('Yanıtta kontrol karakteri olamaz.');
  return text;
}

// Store reviews of the project's apps: read from App Store Connect and Google Play, answered from a draft that an approver
// accepts on its exact text. Sending needs the server switch and an explicit acknowledgement; nothing is sent by itself.
export class MobileReviews{
  db:Database.Database;
  constructor(public mobile:MobileGrowth){this.db=mobile.db;}
  args(){return this.mobile.args();}
  private connection(appId:string,store:Store){
    const row=this.db.prepare('SELECT connection_id FROM platform_mobile_integrations WHERE app_id=? AND kind=? AND organization_id=? AND project_id=?').get(appId,kindOf(store),...this.args()) as {connection_id:string}|undefined;
    const integration=row?this.mobile.integration(row.connection_id):null;
    if(!integration?.active)throw new MarketingStoreError(store==='ios'?'Önce Entegrasyonlar bölümünden App Store Connect bağlantısını kurun.':'Önce Entegrasyonlar bölümünden Google Play bağlantısını kurun.',409);
    return integration;
  }
  private store(appId:string,value:unknown):Store{
    const app=this.mobile.app(appId),store=value==='ios'||value==='android'?value:null;if(!store)throw new MarketingStoreError('Mağaza seçin.');
    if(store==='ios'&&(!app.appleId||app.platform==='android')||store==='android'&&(!app.packageName||app.platform==='ios'))throw new MarketingStoreError(store==='ios'?'Bu uygulamanın App Store kimliği yok.':'Bu uygulamanın Android paket adı yok.',409);return store;
  }
  snapshot(appId:string,filter:unknown='all'):MobileReviewsSnapshot{
    this.mobile.rawApp(appId);
    const where=filter==='unanswered'?" AND r.store_reply IS NULL AND (p.state IS NULL OR p.state<>'sent')":filter==='low'?' AND r.rating<=3':'';
    const rows=this.db.prepare(`SELECT r.*,p.text reply_text,p.source reply_source,p.state reply_state,p.revision reply_revision,p.digest reply_digest,p.approved_digest reply_approved_digest,p.last_error reply_error,p.sent_at reply_sent_at FROM platform_mobile_reviews r LEFT JOIN platform_mobile_review_replies p ON p.review_id=r.id WHERE r.app_id=? AND r.organization_id=? AND r.project_id=?${where} ORDER BY r.reviewed_at DESC,r.id LIMIT ?`).all(appId,...this.args(),REVIEW_LIMITS.list) as (ReviewRow&{reply_text:string|null;reply_source:'team'|'ai'|null;reply_state:ReplyRow['state']|null;reply_revision:number|null;reply_digest:string|null;reply_approved_digest:string|null;reply_error:string|null;reply_sent_at:string|null})[];
    const since=new Date(Date.now()-30*86400000).toISOString();
    const stats=(['ios','android'] as const).map(store=>{
      const all=this.db.prepare('SELECT rating,COUNT(*) n FROM platform_mobile_reviews WHERE app_id=? AND store=? GROUP BY rating').all(appId,store) as {rating:number;n:number}[];
      const recent=this.db.prepare('SELECT AVG(rating) average,COUNT(*) n FROM platform_mobile_reviews WHERE app_id=? AND store=? AND reviewed_at>=?').get(appId,store,since) as {average:number|null;n:number};
      const unanswered=(this.db.prepare("SELECT COUNT(*) n FROM platform_mobile_reviews r LEFT JOIN platform_mobile_review_replies p ON p.review_id=r.id WHERE r.app_id=? AND r.store=? AND r.store_reply IS NULL AND (p.state IS NULL OR p.state<>'sent')").get(appId,store) as {n:number}).n;
      const synced=this.db.prepare('SELECT synced_at FROM platform_mobile_review_sync WHERE app_id=? AND store=?').get(appId,store) as {synced_at:string}|undefined;
      const count=all.reduce((total,row)=>total+row.n,0),round=(value:number)=>Math.round(value*100)/100;
      return {store,count,average:count?round(all.reduce((total,row)=>total+row.rating*row.n,0)/count):null,recentAverage:recent.n?round(recent.average||0):null,recentCount:recent.n,unanswered,distribution:[1,2,3,4,5].map(rating=>all.find(row=>row.rating===rating)?.n||0),syncedAt:synced?.synced_at||null};
    }).filter(item=>item.count||item.syncedAt);
    const reviews:MobileReviewView[]=rows.map(row=>({id:row.id,store:row.store,rating:row.rating,title:row.title,body:row.body,author:row.author,territory:row.territory,language:row.language,appVersion:row.app_version,reviewedAt:row.reviewed_at,storeReply:row.store_reply,storeReplyAt:row.store_reply_at,
      reply:row.reply_state?{text:row.reply_text!,source:row.reply_source!,state:row.reply_state,revision:row.reply_revision!,approved:row.reply_state==='approved'&&row.reply_approved_digest===row.reply_digest,lastError:row.reply_error,sentAt:row.reply_sent_at}:null}));
    return {reviews,stats,repliesEnabled:reviewRepliesEnabled(),limits:REPLY_LIMITS};
  }
  // Reviews are stored as the store reports them; a later read updates the text, rating and the store's own reply.
  private keep(appId:string,store:Store,reviews:StoreReview[]){
    const now=new Date().toISOString();
    for(const review of reviews)this.db.prepare(`INSERT INTO platform_mobile_reviews(id,organization_id,project_id,app_id,store,provider_id,rating,title,body,author,territory,language,app_version,reviewed_at,store_reply,store_reply_at,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(app_id,store,provider_id) DO UPDATE SET rating=excluded.rating,title=excluded.title,body=excluded.body,author=excluded.author,territory=excluded.territory,language=excluded.language,app_version=excluded.app_version,reviewed_at=excluded.reviewed_at,store_reply=excluded.store_reply,store_reply_at=excluded.store_reply_at,fetched_at=excluded.fetched_at`)
      .run(randomUUID(),...this.args(),appId,store,review.providerId,review.rating,review.title,review.body,review.author,review.territory,review.language,review.appVersion,review.reviewedAt,review.storeReply,review.storeReplyAt,now);
    const old=`SELECT id FROM platform_mobile_reviews WHERE app_id=? AND (reviewed_at<? OR id NOT IN (SELECT id FROM platform_mobile_reviews WHERE app_id=? ORDER BY reviewed_at DESC LIMIT ${REVIEW_LIMITS.perApp}))`,cutoff=new Date(Date.now()-REVIEW_LIMITS.keepDays*86400000).toISOString();
    this.db.prepare(`DELETE FROM platform_mobile_review_replies WHERE review_id IN (${old}) AND state<>'sending'`).run(appId,cutoff,appId);
    this.db.prepare(`DELETE FROM platform_mobile_reviews WHERE id IN (${old}) AND id NOT IN (SELECT review_id FROM platform_mobile_review_replies)`).run(appId,cutoff,appId);
    this.db.prepare('INSERT INTO platform_mobile_review_sync VALUES(?,?,?,?,?) ON CONFLICT(app_id,store) DO UPDATE SET synced_at=excluded.synced_at').run(appId,store,...this.args(),now);
  }
  async sync(raw:Record<string,unknown>,read?:MobileTransport,getToken:TokenSource=mobileGoogleAccess){
    this.mobile.authorize('content.write');assertProjectWork(this.db,this.mobile.scope);const appId=String(raw.appId),store=this.store(appId,raw.store),app=this.mobile.app(appId),integration=this.connection(appId,store),revision=mobileRevision(integration.encrypted_credentials);
    this.db.transaction(()=>this.mobile.quota('mobile_reviews',20)).immediate();
    let reviews:StoreReview[];
    try{reviews=store==='ios'?await readAppStoreReviews(app,JSON.parse(integration.config_json),this.mobile.secret(integration),read):await readPlayReviews(app,this.mobile.secret(integration),getToken,read);}
    catch{throw new MarketingStoreError(store==='ios'?'App Store yorumları okunamadı. API anahtarının rolünü ve uygulama kimliğini kontrol edin.':'Google Play yorumları okunamadı. Hizmet hesabının yorum yanıtlama iznini ve paket adını kontrol edin.',502);}
    this.mobile.authorize('content.write');const now=this.mobile.integration(integration.connection_id);if(!now.active||mobileRevision(now.encrypted_credentials)!==revision)throw new MarketingStoreError('Yorumlar okunurken bağlantı değişti.',409);
    this.db.transaction(()=>{this.keep(appId,store,reviews);this.mobile.audit('mobile.reviews.sync');}).immediate();
    return {read:reviews.length,snapshot:this.snapshot(appId)};
  }
  private review(appId:string,id:unknown){const row=this.db.prepare('SELECT * FROM platform_mobile_reviews WHERE id=? AND app_id=? AND organization_id=? AND project_id=?').get(mobileId(id),appId,...this.args()) as ReviewRow|undefined;if(!row)throw new MarketingStoreError('Yorum bulunamadı.',404);return row;}
  private reply(reviewId:string){return this.db.prepare('SELECT * FROM platform_mobile_review_replies WHERE review_id=?').get(reviewId) as ReplyRow|undefined;}
  saveReply(raw:Record<string,unknown>){
    this.mobile.authorize('content.write');assertProjectWork(this.db,this.mobile.scope);const appId=String(raw.appId);this.mobile.rawApp(appId);
    return this.db.transaction(()=>{
      this.mobile.authorize('content.write');const review=this.review(appId,raw.reviewId),text=cleanReply(review.store,raw.text),old=this.reply(review.id),now=new Date().toISOString(),source=raw.source==='ai'?'ai':'team';
      if(old){if(raw.expectedRevision!==old.revision)throw new MarketingStoreError('Yanıt başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);if(old.state==='sending')throw new MarketingStoreError('Gönderilmekte olan yanıt düzenlenemez.',409);
        this.db.prepare("UPDATE platform_mobile_review_replies SET text=?,digest=?,source=?,state='draft',approved_by=NULL,approved_digest=NULL,approved_at=NULL,last_error=NULL,revision=revision+1,updated_at=? WHERE review_id=?").run(text,digestOf(review.id,text),source,now,review.id);}
      else this.db.prepare("INSERT INTO platform_mobile_review_replies(review_id,organization_id,project_id,app_id,text,digest,source,state,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'draft',?,?,?)").run(review.id,...this.args(),appId,text,digestOf(review.id,text),source,this.mobile.scope.subject,now,now);
      this.mobile.audit('mobile.review.reply.save');return this.snapshot(appId,raw.filter);
    }).immediate();
  }
  deleteReply(raw:Record<string,unknown>){
    this.mobile.authorize('content.write');const appId=String(raw.appId);this.mobile.rawApp(appId);
    return this.db.transaction(()=>{const review=this.review(appId,raw.reviewId),old=this.reply(review.id);if(!old)throw new MarketingStoreError('Yanıt taslağı bulunamadı.',404);if(['sending','sent'].includes(old.state))throw new MarketingStoreError('Gönderilmiş yanıt burada silinemez.',409);
      this.db.prepare('DELETE FROM platform_mobile_review_replies WHERE review_id=?').run(review.id);this.mobile.audit('mobile.review.reply.delete');return this.snapshot(appId,raw.filter);}).immediate();
  }
  approveReply(raw:Record<string,unknown>){
    this.mobile.authorize('campaign.approve');const appId=String(raw.appId);this.mobile.rawApp(appId);
    return this.db.transaction(()=>{this.mobile.authorize('campaign.approve');const review=this.review(appId,raw.reviewId),old=this.reply(review.id);if(!old)throw new MarketingStoreError('Yanıt taslağı bulunamadı.',404);
      if(raw.expectedRevision!==old.revision)throw new MarketingStoreError('Yanıt başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);if(old.state!=='draft')throw new MarketingStoreError('Yalnız taslak durumundaki yanıt onaylanabilir.',409);
      const now=new Date().toISOString();this.db.prepare("UPDATE platform_mobile_review_replies SET state='approved',approved_by=?,approved_digest=?,approved_at=?,revision=revision+1,updated_at=? WHERE review_id=?").run(this.mobile.scope.subject,old.digest,now,now,review.id);
      this.mobile.audit('mobile.review.reply.approve');return this.snapshot(appId,raw.filter);}).immediate();
  }
  // AI drafts a reply for the team to edit and save; it is never saved or sent by itself.
  async aiReply(raw:Record<string,unknown>,generator?:CoachGenerator){
    this.mobile.authorize('content.write');assertProjectWork(this.db,this.mobile.scope);if(!generator)throw new MarketingStoreError('Bu platform için AI sağlayıcısı ve model henüz yapılandırılmadı.',503);
    const appId=String(raw.appId),review=this.review(appId,raw.reviewId),app=this.mobile.app(appId),project=this.mobile.repo.workspace(this.mobile.scope.subject,...this.args())!.project,limit=Math.min(REPLY_LIMITS[review.store],review.store==='ios'?800:350);
    const lang=review.language?.toLowerCase().startsWith('en')||review.territory==='USA'||project.language==='en'&&!review.language?'English':'Turkish';
    const prompt=`Write a short, polite public reply in ${lang} from the team of the app "${app.name}" to this ${review.rating}-star ${review.store==='ios'?'App Store':'Google Play'} review. Brand voice: ${(project.brandVoice||'clear, warm, practical').slice(0,300)}. Rules: thank the person; for a problem, acknowledge it without blaming and say the team is looking into it; do not invent facts, features, release dates, prices, refunds or promises; no guarantees; no email addresses, phone numbers or links; do not repeat personal details from the review; at most ${limit} characters. Answer only as JSON: {"reply":"..."}\nThe review:\n"""${`${review.title}\n${review.body}`.trim().slice(0,1500)}"""`;
    return runCoachAi(this.db,this.mobile.scope,generator,prompt,output=>{
      const fail=()=>new MarketingStoreError('AI yanıtı kurallara uymadı (kişisel bilgi, bağlantı veya garanti). Yanıtı kendiniz yazabilirsiniz.',422);
      let reply:string;try{reply=coachClip(coachText(coachObject(parseCoachJson(output)).reply,2000),limit);}catch{throw fail();}
      if(!reply.trim()||maskPersonal(reply)!==reply||/https?:\/\//i.test(reply)||COACH_BANNED.test(reply))throw fail();return reply;
    },reply=>{this.mobile.authorize('content.write');this.mobile.audit('mobile.review.reply.ai');return {reply};});
  }
  async sendReply(raw:Record<string,unknown>,read?:MobileTransport,getToken:TokenSource=mobileGoogleAccess){
    this.mobile.authorize('connections.manage');assertProjectDelivery(this.db,this.mobile.scope);const appId=String(raw.appId),review=this.review(appId,raw.reviewId),old=this.reply(review.id),app=this.mobile.app(appId);
    if(!reviewRepliesEnabled())throw new MarketingStoreError('Mağaza yorumlarına yanıt gönderme bu sunucuda kapalı (PLATFORM_MOBILE_REVIEW_REPLY_ENABLED).',409);
    if(raw.acknowledged!==true)throw new MarketingStoreError('Yanıtı herkese açık yayınlamak için açık onay gerekli.');
    if(!old||old.state!=='approved'||old.approved_digest!==old.digest||digestOf(review.id,old.text)!==old.digest)throw new MarketingStoreError('Yanıt onaylı ve onaydan sonra değişmemiş olmalı.',409);
    const integration=this.connection(appId,review.store);
    const claimed=this.db.transaction(()=>{this.mobile.authorize('connections.manage');this.mobile.quota('mobile_review_reply',50);return this.db.prepare("UPDATE platform_mobile_review_replies SET state='sending',updated_at=? WHERE review_id=? AND state='approved' AND digest=?").run(new Date().toISOString(),review.id,old.digest).changes;}).immediate();
    if(!claimed)throw new MarketingStoreError('Yanıt şu anda gönderiliyor veya onaydan sonra değişti. Sayfayı yenileyin.',409);
    let error:string|null=null;
    try{if(review.store==='ios')await replyAppStoreReview(review.provider_id,old.text,JSON.parse(integration.config_json),this.mobile.secret(integration),read);else await replyPlayReview(app,review.provider_id,old.text,this.mobile.secret(integration),getToken,read);}
    catch{error=review.store==='ios'?'App Store yanıtı gönderilemedi. API anahtarının rolünü kontrol edip yeniden deneyin.':'Google Play yanıtı gönderilemedi. Hizmet hesabının yorum yanıtlama iznini kontrol edip yeniden deneyin.';}
    return this.db.transaction(()=>{const now=new Date().toISOString();
      this.db.prepare("UPDATE platform_mobile_review_replies SET state=?,last_error=?,sent_at=?,revision=revision+1,updated_at=? WHERE review_id=? AND state='sending'").run(error?'failed':'sent',error,error?null:now,now,review.id);
      if(!error)this.db.prepare('UPDATE platform_mobile_reviews SET store_reply=?,store_reply_at=? WHERE id=?').run(old.text,now,review.id);
      this.mobile.audit(error?'mobile.review.reply.failed':'mobile.review.reply.sent');return this.snapshot(appId,raw.filter);}).immediate();
  }
}

// Worker step: each connected store is read once a day as the person who set up its connection, one store per tick.
// A failed read waits for the next day.
export async function syncDueReviews(db:Database.Database,key:string,read?:MobileTransport,getToken:TokenSource=mobileGoogleAccess){
  const cutoff=new Date(Date.now()-REVIEW_LIMITS.syncEveryHours*3600000).toISOString();
  const due=db.prepare(`SELECT i.app_id,i.kind,i.actor_id,i.organization_id,i.project_id FROM platform_mobile_integrations i JOIN platform_connections c ON c.id=i.connection_id AND c.active=1
    JOIN platform_projects p ON p.id=i.project_id AND p.organization_id=i.organization_id AND p.product_pack='standard'
    LEFT JOIN platform_mobile_review_sync s ON s.app_id=i.app_id AND s.store=CASE i.kind WHEN 'app_store_connect' THEN 'ios' ELSE 'android' END
    WHERE i.kind IN ('app_store_connect','google_play') AND (s.synced_at IS NULL OR s.synced_at<?) ORDER BY s.synced_at IS NOT NULL,s.synced_at LIMIT 1`).get(cutoff) as {app_id:string;kind:string;actor_id:string;organization_id:string;project_id:string}|undefined;
  if(!due)return 0;const store:Store=due.kind==='app_store_connect'?'ios':'android';
  try{await new MobileReviews(new MobileGrowth(db,{subject:due.actor_id,organizationId:due.organization_id,projectId:due.project_id},key)).sync({appId:due.app_id,store},read,getToken);return 1;}
  catch{db.prepare('INSERT INTO platform_mobile_review_sync VALUES(?,?,?,?,?) ON CONFLICT(app_id,store) DO UPDATE SET synced_at=excluded.synced_at').run(due.app_id,store,due.organization_id,due.project_id,new Date().toISOString());return 0;}
}
