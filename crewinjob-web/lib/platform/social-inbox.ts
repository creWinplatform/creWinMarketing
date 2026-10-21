import 'server-only';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials, encryptCredentials, type StoredCredentials } from './credential-envelope';
import { hasMessagingDuty } from './messaging-duties';
import { maskPersonal } from './messaging-sources';
import { socialPublishingEnabled } from './linkedin-publishing';
import { isLinkedInOrganization } from './social-configuration';
import { COACH_BANNED, coachClip, coachObject, coachText, type CoachGenerator } from './coach';
import { parseCoachJson, runCoachAi } from './coach-ai';
import { xText } from './x-text';
import { INBOX_LIMITS, type InboxItemView, type InboxSnapshot } from './social-inbox-types';

// One provider call; fixed hosts, the token only in the Authorization header. Injected in tests.
export type InboxHttp=(request:{method:'GET'|'POST';url:string;token:string;form?:Record<string,string>;json?:unknown;headers?:Record<string,string>})=>Promise<{status:number;payload:Record<string,unknown>;header:(name:string)=>string|null}>;
export const inboxHttp:InboxHttp=async({method,url,token,form,json,headers})=>{
  const parsed=new URL(url);if(parsed.protocol!=='https:'||!['graph.facebook.com','api.linkedin.com','api.x.com'].includes(parsed.hostname)||parsed.searchParams.has('access_token')||!token||/[\r\n\x00]/.test(token))throw new Error('Invalid inbox request.');
  const response=await fetch(parsed,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(form?{'Content-Type':'application/x-www-form-urlencoded'}:json?{'Content-Type':'application/json'}:{}),...(headers||{})},body:form?new URLSearchParams(form).toString():json?JSON.stringify(json):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  const text=await response.text();let payload:Record<string,unknown>={};try{payload=text?JSON.parse(text.slice(0,262144)):{};}catch{payload={};}
  return {status:response.status,payload,header:name=>response.headers.get(name)};
};
const graphVersion=()=>{const value=process.env.PLATFORM_META_GRAPH_VERSION||'v25.0';return /^v\d{1,3}\.\d$/.test(value)?value:'v25.0';};
// X replies need paid search access and LinkedIn member comments need the restricted r_member_social permission,
// so each stays off until the server owner turns it on.
export const xInboxEnabled=()=>process.env.PLATFORM_X_INBOX_ENABLED==='1';
export const linkedInMemberCommentsEnabled=()=>process.env.PLATFORM_LINKEDIN_MEMBER_COMMENTS_ENABLED==='1';
const verifyToken=()=>{const value=process.env.PLATFORM_META_WEBHOOK_VERIFY_TOKEN||'';return /^[A-Za-z0-9_-]{16,200}$/.test(value)?value:'';};
export const metaInboxHookConfigured=()=>Boolean(process.env.PLATFORM_META_APP_SECRET&&verifyToken());
const X_ID=/^[1-9]\d{0,18}$/;
const linkedInVersion=()=>{const value=process.env.PLATFORM_LINKEDIN_API_VERSION||'';return /^20\d{4}$/.test(value)?value:null;};
type Account={id:string;account_name:string;encrypted_credentials:string;account_id:string;platform:string;page_id:string|null;integration_id:string;organization:boolean};
type Row={id:string;connection_id:string;platform:InboxItemView['platform'];kind:'comment'|'message';thread_id:string;item_id:string;publication_id:string|null;author_hash:string;recipient_encrypted:string|null;text:string;received_at:string;state:'new'|'replied'|'dismissed';reply_text:string;reply_state:InboxItemView['replyState'];reply_id:string|null;replied_at:string|null;revision:number};
type Found={kind:'comment'|'message';threadId:string;itemId:string;publicationId:string|null;author:string;recipient:string|null;text:string;receivedAt:string};
const ID=/^[A-Za-z0-9_:.-]{1,120}$/;
// Webhooks send Unix seconds (or milliseconds for messages); the Graph API sends ISO text.
const unix=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0?new Date(value<1e12?value*1000:value).toISOString():null;
const iso=(value:unknown)=>{const time=typeof value==='string'||typeof value==='number'?Date.parse(String(value).replace(/\+0000$/,'Z')):NaN;return Number.isFinite(time)?new Date(time).toISOString():null;};
const clean=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').trim().slice(0,max):'';

// The social inbox: comments under the project's own published posts and Page/Instagram messages. Reading needs the
// reading duty, writing a reply needs the suggesting duty, and sending one needs the publish duty, the server switch and
// an explicit acknowledgement. A reply is sent once; an unclear outcome is recorded as uncertain and never repeated.
export class ProjectSocialInbox{
  repo:PlatformRepository;
  constructor(public db:Database.Database,public scope:MarketingScope,public key:string,public http:InboxHttp=inboxHttp){this.repo=new PlatformRepository(db);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private duty(duty:'source.read'|'suggest'|'publish'){return hasMessagingDuty(this.db,this.scope.subject,...this.args(),duty);}
  private authorize(need?:'source.read'|'suggest'|'publish'){
    if(!this.repo.can(this.scope.subject,...this.args(),'read')||this.repo.workspace(this.scope.subject,...this.args())?.project.productPack!=='standard')throw new MarketingStoreError('Gelen kutusu için standart proje erişimi gerekli.',403);
    if(need&&!this.duty(need))throw new MarketingStoreError(need==='source.read'?'Yorum ve mesajları okumak için "kaynak okuma" görevi gerekir.':need==='suggest'?'Yanıt yazmak için "içerik önerisi" görevi gerekir.':'Yanıt göndermek için "yayın" görevi gerekir.',403);
  }
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
  private authorHash(connectionId:string,id:string){return createHmac('sha256',Buffer.from(this.key,'hex')).update(`inbox:${this.scope.organizationId}:${this.scope.projectId}:${connectionId}:${id}`).digest('hex');}
  // Facebook Pages, Instagram accounts and LinkedIn company pages; X accounts and LinkedIn member profiles only behind their
  // server switches. LinkedIn messages are not readable here.
  private accounts():Account[]{
    return (this.db.prepare("SELECT c.id,c.account_name,c.encrypted_credentials,c.integration_id,s.account_id,s.platform,s.page_id FROM platform_connections c JOIN platform_social_accounts s ON s.connection_id=c.id WHERE c.organization_id=? AND c.project_id=? AND c.active=1 AND c.provider='social' AND s.platform IN ('facebook','instagram','linkedin','twitter') ORDER BY c.account_name").all(...this.args()) as Omit<Account,'organization'>[])
      .map(row=>({...row,organization:isLinkedInOrganization(row.platform,row.account_id,row.integration_id)})).filter(row=>row.platform==='twitter'?xInboxEnabled():row.platform!=='linkedin'||row.organization||linkedInMemberCommentsEnabled());
  }
  private linkedInActor(account:Account){return account.organization?`urn:li:organization:${account.account_id}`:`urn:li:person:${account.account_id}`;}
  private account(id:unknown){const row=this.accounts().find(item=>item.id===id);if(!row)throw new MarketingStoreError('Hesap bulunamadı.',404);return row;}
  private token(account:Account){return decryptCredentials<StoredCredentials>(account.encrypted_credentials,this.key,...this.args(),account.id).accessToken;}
  private syncsToday(){return (this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='inbox_sync'").get(...this.args(),new Date().toISOString().slice(0,10)) as {count:number}|undefined)?.count||0;}
  private row(id:unknown){const row=typeof id==='string'?this.db.prepare('SELECT * FROM platform_social_inbox WHERE id=? AND organization_id=? AND project_id=?').get(id,...this.args()) as Row|undefined:undefined;if(!row)throw new MarketingStoreError('Kayıt bulunamadı.',404);return row;}
  private windowOpen(row:Row){return row.kind!=='message'||Date.now()-Date.parse(row.received_at)<INBOX_LIMITS.messageWindowHours*3600000;}
  read():InboxSnapshot{
    this.authorize();const me={read:this.duty('source.read'),suggest:this.duty('suggest'),publish:this.duty('publish')&&this.repo.can(this.scope.subject,...this.args(),'campaign.dispatch'),manage:this.duty('source.read')&&this.repo.can(this.scope.subject,...this.args(),'connections.manage')};
    const posts=new Map((this.db.prepare("SELECT job_id,provider_url FROM platform_social_publications WHERE organization_id=? AND project_id=? AND state='accepted'").all(...this.args()) as {job_id:string;provider_url:string|null}[]).map(row=>[row.job_id,row.provider_url]));
    const names=new Map(this.accounts().map(row=>[row.id,row.account_name]));
    const items=me.read?(this.db.prepare('SELECT * FROM platform_social_inbox WHERE organization_id=? AND project_id=? ORDER BY received_at DESC LIMIT 200').all(...this.args()) as Row[]).map((row):InboxItemView=>({id:row.id,connectionId:row.connection_id,accountName:names.get(row.connection_id)||'',platform:row.platform,kind:row.kind,text:row.text,receivedAt:row.received_at,postTitle:null,postUrl:row.publication_id?posts.get(row.publication_id)||null:null,state:row.state,reply:row.reply_text,replyState:row.reply_state,repliedAt:row.replied_at,windowOpen:this.windowOpen(row),revision:row.revision})):[];
    const counts={new:0,replied:0,dismissed:0};if(me.read)for(const row of this.db.prepare('SELECT state,COUNT(*) n FROM platform_social_inbox WHERE organization_id=? AND project_id=? GROUP BY state').all(...this.args()) as {state:keyof typeof counts;n:number}[])counts[row.state]=row.n;
    const last=new Map((this.db.prepare("SELECT connection_id,MAX(created_at) at FROM platform_social_inbox WHERE organization_id=? AND project_id=? GROUP BY connection_id").all(...this.args()) as {connection_id:string;at:string}[]).map(row=>[row.connection_id,row.at]));
    const settings=new Map((this.db.prepare('SELECT connection_id,auto_read,hook_event_at FROM platform_social_inbox_accounts WHERE organization_id=? AND project_id=?').all(...this.args()) as {connection_id:string;auto_read:number;hook_event_at:string|null}[]).map(row=>[row.connection_id,row]));
    return {accounts:this.accounts().map(row=>({id:row.id,name:row.account_name,platform:row.platform,personal:row.platform==='linkedin'&&!row.organization,comments:true,messages:['facebook','instagram'].includes(row.platform),lastSyncAt:last.get(row.id)||null,
      autoRead:settings.get(row.id)?.auto_read===1,autoReadAllowed:row.platform!=='twitter',live:['facebook','instagram'].includes(row.platform),liveEventAt:settings.get(row.id)?.hook_event_at||null})),
      items,counts,syncsLeft:Math.max(0,INBOX_LIMITS.syncsPerDay-this.syncsToday()),sendEnabled:socialPublishingEnabled(),aiConfigured:Boolean(process.env.PLATFORM_GEMINI_API_KEY&&process.env.PLATFORM_GEMINI_MODEL),liveConfigured:metaInboxHookConfigured(),me};
  }
  // Comments: under the project's own accepted publications of the last 30 days on this account.
  private async comments(account:Account,token:string):Promise<Found[]>{
    // X recent search covers only the last seven days.
    const x=account.platform==='twitter',since=new Date(Date.now()-(x?7:30)*86400000).toISOString(),found:Found[]=[];
    const posts=this.db.prepare("SELECT job_id,provider_post_id FROM platform_social_publications p JOIN platform_jobs j ON j.id=p.job_id WHERE p.organization_id=? AND p.project_id=? AND j.connection_id=? AND p.state='accepted' AND p.mode='publish' AND p.provider_post_id IS NOT NULL AND p.submitted_at>=? ORDER BY p.submitted_at DESC LIMIT ?").all(...this.args(),account.id,since,x?INBOX_LIMITS.xPostsPerSync:INBOX_LIMITS.postsPerSync) as {job_id:string;provider_post_id:string}[];
    for(const post of posts){
      if(!ID.test(post.provider_post_id))continue;
      let list:Record<string,unknown>[]=[];
      if(x){
        if(!X_ID.test(post.provider_post_id)||!X_ID.test(account.account_id))continue;
        const query=new URLSearchParams({query:`conversation_id:${post.provider_post_id} -from:${account.account_id}`,'tweet.fields':'created_at,author_id,conversation_id',max_results:'50'});
        const result=await this.http({method:'GET',url:`https://api.x.com/2/tweets/search/recent?${query}`,token});
        if(result.status!==200)throw new Error('replies');list=(Array.isArray(result.payload.data)?result.payload.data:[]) as Record<string,unknown>[];
        for(const item of list){const id=String(item.id||''),author=String(item.author_id||''),text=clean(item.text,2000),at=iso(item.created_at);
          if(!X_ID.test(id)||!text||!at||author===account.account_id||item.conversation_id!==post.provider_post_id)continue;found.push({kind:'comment',threadId:post.provider_post_id,itemId:id,publicationId:post.job_id,author:author||id,recipient:null,text,receivedAt:at});}
        continue;
      }
      if(account.platform==='linkedin'){
        const version=linkedInVersion();if(!version)throw new MarketingStoreError('Sunucuda LinkedIn API sürümü yapılandırılmalı.',503);
        const result=await this.http({method:'GET',url:`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(post.provider_post_id)}/comments?count=50`,token,headers:{'LinkedIn-Version':version,'X-Restli-Protocol-Version':'2.0.0'}});
        if(result.status!==200)throw new Error('comments');list=(Array.isArray(result.payload.elements)?result.payload.elements:[]) as Record<string,unknown>[];
        for(const item of list){const actor=String(item.actor||''),id=String(item.commentUrn||item.id||''),text=clean((item.message as Record<string,unknown>|undefined)?.text,2000),created=(item.created as Record<string,unknown>|undefined)?.time,at=unix(created)||iso(created);
          if(!ID.test(id.replace(/[(),]/g,''))||!text||!at||actor===this.linkedInActor(account))continue;found.push({kind:'comment',threadId:post.provider_post_id,itemId:id.slice(0,200),publicationId:post.job_id,author:actor,recipient:null,text,receivedAt:at});}
        continue;
      }
      const fields=account.platform==='instagram'?'id,text,timestamp,from':'id,message,created_time,from';
      const result=await this.http({method:'GET',url:`https://graph.facebook.com/${graphVersion()}/${post.provider_post_id}/comments?fields=${fields}&limit=50`,token});
      if(result.status!==200)throw new Error('comments');list=(Array.isArray(result.payload.data)?result.payload.data:[]) as Record<string,unknown>[];
      for(const item of list){const from=item.from as Record<string,unknown>|undefined,author=String(from?.id||''),id=String(item.id||''),text=clean(account.platform==='instagram'?item.text:item.message,2000),at=iso(account.platform==='instagram'?item.timestamp:item.created_time);
        if(!ID.test(id)||!text||!at||author===account.account_id||author===account.page_id)continue;found.push({kind:'comment',threadId:post.provider_post_id,itemId:id,publicationId:post.job_id,author:author||id,recipient:null,text,receivedAt:at});}
    }
    return found;
  }
  // Messages: the latest inbound message of each recent conversation (Messenger or Instagram).
  private async messages(account:Account,token:string):Promise<Found[]>{
    if(!['facebook','instagram'].includes(account.platform))return [];
    const page=account.platform==='instagram'?account.page_id:account.account_id;if(!page||!/^\d{1,30}$/.test(page))return [];
    const result=await this.http({method:'GET',url:`https://graph.facebook.com/${graphVersion()}/${page}/conversations?platform=${account.platform==='instagram'?'instagram':'messenger'}&fields=id,updated_time,messages.limit(5){id,message,from,created_time}&limit=${INBOX_LIMITS.conversationsPerSync}`,token});
    if(result.status!==200)throw new Error('messages');const found:Found[]=[];
    for(const conversation of (Array.isArray(result.payload.data)?result.payload.data:[]) as Record<string,unknown>[]){
      const id=String(conversation.id||''),messages=((conversation.messages as Record<string,unknown>|undefined)?.data||[]) as Record<string,unknown>[];if(!ID.test(id))continue;
      const inbound=messages.find(item=>{const from=String((item.from as Record<string,unknown>|undefined)?.id||'');return from&&from!==account.account_id&&from!==page;});
      if(!inbound)continue;const from=String((inbound.from as Record<string,unknown>).id),text=clean(inbound.message,2000),at=iso(inbound.created_time),itemId=String(inbound.id||'');
      if(!/^\d{1,30}$/.test(from)||!text||!at||!ID.test(itemId))continue;found.push({kind:'message',threadId:id,itemId,publicationId:null,author:from,recipient:from,text,receivedAt:at});
    }
    return found;
  }
  // A manual refresh counts against the daily limit; the automatic one (every 30 minutes, as the person who turned it on) does not.
  async sync(raw:Record<string,unknown>,auto=false){
    this.authorize('source.read');const account=this.account(raw.connectionId);
    if(auto&&account.platform==='twitter')throw new MarketingStoreError('X hesapları otomatik okunmaz.',409);
    if(!auto){
      if(this.syncsToday()>=INBOX_LIMITS.syncsPerDay)throw new MarketingStoreError('Günlük gelen kutusu yenileme sınırına ulaşıldı.',429);
      this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'inbox_sync',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),new Date().toISOString().slice(0,10));
    }
    const token=this.token(account);let found:Found[];
    try{found=[...await this.comments(account,token),...await this.messages(account,token)];}catch(error){if(error instanceof MarketingStoreError)throw error;throw new MarketingStoreError('Yorumlar veya mesajlar alınamadı. Hesabın yorum ve mesaj izinlerini (pages_read_user_content, pages_messaging, instagram_manage_comments, instagram_manage_messages, LinkedIn şirket sayfası sosyal izinleri, LinkedIn kişisel profil için r_member_social, X için ücretli arama erişimi) kontrol edin. X erişim anahtarı yaklaşık iki saatte dolar; gerekirse hesabı yeniden bağlayın.',502);}
    return this.db.transaction(()=>{
      this.authorize('source.read');const added=this.ingest(account,found);
      this.audit(auto?'inbox.sync.auto':'inbox.sync');return {added,snapshot:this.read()};
    }).immediate();
  }
  // Stores new items (masked text, hashed author, encrypted reply address) and drops items past the retention period.
  // Callers check access first: the sync checks the reading duty, the webhook checks Meta's signature.
  ingest(account:Account,found:Found[]){
    const now=new Date().toISOString();let added=0;
    for(const item of found){
      const id=`inbox_${randomUUID()}`;
        added+=this.db.prepare('INSERT OR IGNORE INTO platform_social_inbox(id,organization_id,project_id,connection_id,platform,kind,thread_id,item_id,publication_id,author_hash,recipient_encrypted,text,received_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,...this.args(),account.id,account.platform,item.kind,item.threadId,item.itemId,item.publicationId,this.authorHash(account.id,item.author),item.recipient?encryptCredentials({id:item.recipient},this.key,...this.args(),`inbox:${id}`):null,maskPersonal(item.text),item.receivedAt,now).changes;
    }
    this.db.prepare('DELETE FROM platform_social_inbox WHERE organization_id=? AND project_id=? AND received_at<?').run(...this.args(),new Date(Date.now()-INBOX_LIMITS.retentionDays*86400000).toISOString());
    return added;
  }
  // Automatic reading every 30 minutes for one account, run as the person who turns it on (they need the reading duty).
  setAutoRead(raw:Record<string,unknown>){
    this.authorize('source.read');if(!this.repo.can(this.scope.subject,...this.args(),'connections.manage'))throw new MarketingStoreError('Otomatik okumayı yalnız bağlantı yönetimi yetkisi olanlar açabilir.',403);
    const account=this.account(raw.connectionId),on=raw.autoRead===true;if(on&&account.platform==='twitter')throw new MarketingStoreError('X hesapları için otomatik okuma yok: her okuma X API kotanızdan düşer.',409);
    return this.db.transaction(()=>{const now=new Date().toISOString();
      this.db.prepare('INSERT INTO platform_social_inbox_accounts(connection_id,organization_id,project_id,auto_read,manager_id,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET auto_read=excluded.auto_read,manager_id=excluded.manager_id,attempted_at=NULL,updated_at=excluded.updated_at').run(account.id,...this.args(),on?1:0,this.scope.subject,now);
      this.audit(on?'inbox.auto_on':'inbox.auto_off');return this.read();}).immediate();
  }
  // Instant updates: subscribes the Facebook Page (for Instagram, its linked Page) to this server's Meta app webhook.
  async subscribeLive(raw:Record<string,unknown>){
    this.authorize('source.read');if(!this.repo.can(this.scope.subject,...this.args(),'connections.manage'))throw new MarketingStoreError('Anlık bildirimleri yalnız bağlantı yönetimi yetkisi olanlar açabilir.',403);
    if(!metaInboxHookConfigured())throw new MarketingStoreError('Anlık bildirimler bu sunucuda yapılandırılmadı (PLATFORM_META_APP_SECRET, PLATFORM_META_WEBHOOK_VERIFY_TOKEN).',503);
    const account=this.account(raw.connectionId),page=account.platform==='instagram'?account.page_id:account.platform==='facebook'?account.account_id:null;
    if(!page||!/^\d{1,30}$/.test(page))throw new MarketingStoreError('Anlık bildirim yalnız Facebook sayfası ve Instagram hesabı için var.',409);
    let ok=false;try{const result=await this.http({method:'POST',url:`https://graph.facebook.com/${graphVersion()}/${page}/subscribed_apps`,token:this.token(account),form:{subscribed_fields:'feed,messages'}});ok=result.status===200&&result.payload.success===true;}catch{ok=false;}
    if(!ok)throw new MarketingStoreError('Sayfa Meta uygulamasına abone edilemedi. Sayfa yöneticisi izni ve pages_manage_metadata iznini kontrol edin.',502);
    this.audit('inbox.live.subscribe');return this.read();
  }
  saveReply(raw:Record<string,unknown>){
    this.authorize('suggest');const reply=clean(raw.reply,INBOX_LIMITS.reply);if(!reply)throw new MarketingStoreError('Yanıt metni gerekli.');
    if(maskPersonal(reply)!==reply)throw new MarketingStoreError('Yanıta e-posta, telefon veya kullanıcı adı yazmayın; gerekirse kişiyi doğru kanala yönlendirin.');
    return this.db.transaction(()=>{const row=this.row(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Kayıt başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      if(['sending','sent','uncertain'].includes(String(row.reply_state)))throw new MarketingStoreError('Bu kayda yanıt zaten gönderildi veya gönderiliyor.',409);
      if(row.platform==='twitter'&&!xText(reply).valid)throw new MarketingStoreError('X yanıtı en fazla 280 karakter olabilir.');
      this.db.prepare("UPDATE platform_social_inbox SET reply_text=?,reply_state='draft',revision=revision+1 WHERE id=?").run(reply,row.id);this.audit('inbox.reply.draft');return this.read();}).immediate();
  }
  decide(raw:Record<string,unknown>){
    this.authorize('suggest');const state=raw.state==='dismissed'||raw.state==='new'?raw.state:null;if(!state)throw new MarketingStoreError('Geçersiz durum.');
    return this.db.transaction(()=>{const row=this.row(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Kayıt başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      this.db.prepare('UPDATE platform_social_inbox SET state=?,revision=revision+1 WHERE id=?').run(state,row.id);this.audit(`inbox.${state}`);return this.read();}).immediate();
  }
  // Sends the saved reply once. Comments are answered in their thread; messages only inside the 24-hour window.
  async send(raw:Record<string,unknown>){
    this.authorize('publish');if(!this.repo.can(this.scope.subject,...this.args(),'campaign.dispatch'))throw new MarketingStoreError('Yanıt göndermek için gönderim yetkisi gerekir.',403);
    if(!socialPublishingEnabled()||raw.acknowledged!==true)throw new MarketingStoreError('Gerçek yanıt gönderimi bu sunucuda kapalı veya açık onay verilmedi.',409);
    const claimed=this.db.transaction(()=>{
      const row=this.row(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Kayıt başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      if(row.reply_state!=='draft'||!row.reply_text)throw new MarketingStoreError('Önce yanıtı kaydedin.',409);
      if(!this.windowOpen(row))throw new MarketingStoreError('Mesajlaşma penceresi kapandı: son mesajın üzerinden 24 saat geçti. Yanıt gönderilemez.',409);
      this.db.prepare("UPDATE platform_social_inbox SET reply_state='sending',reply_by=?,revision=revision+1 WHERE id=? AND reply_state='draft'").run(this.scope.subject,row.id);return row;
    }).immediate();
    const account=this.account(claimed.connection_id),token=this.token(account);let state:'sent'|'rejected'|'uncertain'='uncertain',replyId:string|null=null;
    try{
      let result;
      if(claimed.platform==='linkedin'){
        const version=linkedInVersion();if(!version)throw new Error('version');
        result=await this.http({method:'POST',url:`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(claimed.item_id.startsWith('urn:li:comment:')?claimed.item_id:claimed.thread_id)}/comments`,token,json:{actor:this.linkedInActor(account),object:claimed.thread_id,message:{text:claimed.reply_text},...(claimed.item_id.startsWith('urn:li:comment:')?{parentComment:claimed.item_id}:{})},headers:{'LinkedIn-Version':version,'X-Restli-Protocol-Version':'2.0.0'}});
        replyId=result.header('x-restli-id');
      }else if(claimed.platform==='twitter'){
        if(!X_ID.test(claimed.item_id))throw new Error('reply');
        result=await this.http({method:'POST',url:'https://api.x.com/2/tweets',token,json:{text:claimed.reply_text,reply:{in_reply_to_tweet_id:claimed.item_id}}});
        const data=result.payload.data as Record<string,unknown>|undefined;replyId=typeof data?.id==='string'&&X_ID.test(data.id)?data.id:null;
      }else if(claimed.kind==='comment'){
        result=await this.http({method:'POST',url:`https://graph.facebook.com/${graphVersion()}/${claimed.item_id}/${claimed.platform==='instagram'?'replies':'comments'}`,token,form:{message:claimed.reply_text}});
        replyId=typeof result.payload.id==='string'?result.payload.id:null;
      }else{
        const recipient=claimed.recipient_encrypted?decryptCredentials<{id:string}>(claimed.recipient_encrypted,this.key,...this.args(),`inbox:${claimed.id}`).id:'';
        const page=claimed.platform==='instagram'?account.page_id:account.account_id;if(!/^\d{1,30}$/.test(recipient)||!page)throw new Error('recipient');
        result=await this.http({method:'POST',url:`https://graph.facebook.com/${graphVersion()}/${page}/messages`,token,json:{recipient:{id:recipient},messaging_type:'RESPONSE',message:{text:claimed.reply_text}}});
        replyId=typeof result.payload.message_id==='string'?result.payload.message_id:null;
      }
      state=(result.status===200||result.status===201)&&replyId?'sent':result.status>=400&&result.status<500?'rejected':'uncertain';
    }catch{state='uncertain';}
    return this.db.transaction(()=>{const now=new Date().toISOString();
      this.db.prepare("UPDATE platform_social_inbox SET reply_state=?,reply_id=?,replied_at=?,state=CASE WHEN ?='sent' THEN 'replied' ELSE state END,revision=revision+1 WHERE id=? AND reply_state='sending'").run(state,replyId?replyId.slice(0,200):null,state==='sent'?now:null,state,claimed.id);
      this.audit(`inbox.reply.${state}`);return this.read();}).immediate();
  }
  // AI drafts a short, polite reply for the team to edit; it is never sent or saved by itself.
  async aiReply(raw:Record<string,unknown>,generator?:CoachGenerator){
    this.authorize('suggest');if(!this.repo.can(this.scope.subject,...this.args(),'content.write'))throw new MarketingStoreError('Bu işlem için içerik yazma yetkisi gerekir.',403);
    if(!generator)throw new MarketingStoreError('Bu platform için AI sağlayıcısı ve model henüz yapılandırılmadı.',503);
    const row=this.row(raw.id),project=this.repo.workspace(this.scope.subject,...this.args())!.project,lang=project.language==='en'?'English':'Turkish';
    const prompt=`Write a short, polite reply in ${lang} from ${project.name} to this ${row.kind==='message'?'direct message':'comment on our post'}. Brand voice: ${(project.brandVoice||'clear, practical, trustworthy').slice(0,300)}. Rules: do not invent facts, prices, dates, offers or promises; no guarantees; no email addresses, phone numbers or links; if the question needs details you do not have, invite them to continue in a private message or on the website without inventing contact details; at most 400 characters. Answer only as JSON: {"reply":"..."}\nThe ${row.kind}:\n"""${row.text.slice(0,1500)}"""`;
    return runCoachAi(this.db,this.scope,generator,prompt,output=>{
      const fail=()=>new MarketingStoreError('AI yanıtı kurallara uymadı (kişisel bilgi, bağlantı veya garanti). Yanıtı kendiniz yazabilirsiniz.',422);
      let reply:string;try{reply=coachClip(coachText(coachObject(parseCoachJson(output)).reply,1500),INBOX_LIMITS.reply);}catch{throw fail();}
      if(!reply.trim()||maskPersonal(reply)!==reply||/https?:\/\//i.test(reply)||COACH_BANNED.test(reply))throw fail();return reply;
    },reply=>{this.authorize('suggest');this.audit('inbox.reply.ai');return {reply,snapshot:this.read()};});
  }
}

// Worker step: accounts with automatic reading are read every 30 minutes as the person who turned it on. If that person
// lost the reading duty, automatic reading switches off.
export async function readDueInboxAccounts(db:Database.Database,key:string,http:InboxHttp=inboxHttp,everyMs=INBOX_LIMITS.autoReadMinutes*60000,limit=3){
  const due=db.prepare("SELECT a.connection_id,a.organization_id,a.project_id,a.manager_id FROM platform_social_inbox_accounts a JOIN platform_connections c ON c.id=a.connection_id WHERE a.auto_read=1 AND a.manager_id IS NOT NULL AND c.active=1 AND COALESCE(a.attempted_at,'')<? ORDER BY COALESCE(a.attempted_at,'') LIMIT ?").all(new Date(Date.now()-everyMs).toISOString(),limit) as {connection_id:string;organization_id:string;project_id:string;manager_id:string}[];
  let read=0;
  for(const row of due){
    if(!hasMessagingDuty(db,row.manager_id,row.organization_id,row.project_id,'source.read')){db.prepare('UPDATE platform_social_inbox_accounts SET auto_read=0,updated_at=? WHERE connection_id=?').run(new Date().toISOString(),row.connection_id);continue;}
    db.prepare('UPDATE platform_social_inbox_accounts SET attempted_at=? WHERE connection_id=?').run(new Date().toISOString(),row.connection_id);
    try{await new ProjectSocialInbox(db,{subject:row.manager_id,organizationId:row.organization_id,projectId:row.project_id},key,http).sync({connectionId:row.connection_id},true);read++;}catch{}
  }
  return read;
}
// Meta webhook (one per server, signed with the Meta app secret): new comments under the project's own accepted posts
// and inbound Page/Instagram messages land in every standard project connected to that Page or Instagram account.
export function verifyMetaInboxHook(query:URLSearchParams){
  const expected=verifyToken(),challenge=query.get('hub.challenge')||'';
  if(!metaInboxHookConfigured()||query.get('hub.mode')!=='subscribe'||!/^[A-Za-z0-9_-]{1,200}$/.test(challenge))return null;
  const given=createHash('sha256').update(query.get('hub.verify_token')||'').digest(),wanted=createHash('sha256').update(expected).digest();
  return timingSafeEqual(given,wanted)?challenge:null;
}
export function receiveMetaInboxHook(db:Database.Database,key:string,body:Uint8Array,signature:string|null){
  if(!metaInboxHookConfigured())throw new MarketingStoreError('Anlık bildirimler bu sunucuda kapalı.',404);
  const expected=Buffer.from(`sha256=${createHmac('sha256',process.env.PLATFORM_META_APP_SECRET!).update(body).digest('hex')}`),given=Buffer.from(signature||'');
  if(given.length!==expected.length||!timingSafeEqual(given,expected))throw new MarketingStoreError('Meta bildirim imzası doğrulanamadı.',401);
  let payload:Record<string,unknown>;try{payload=JSON.parse(Buffer.from(body).toString('utf8'));}catch{throw new MarketingStoreError('Geçersiz bildirim.',400);}
  const platform=payload.object==='page'?'facebook':payload.object==='instagram'?'instagram':null;if(!platform)return {stored:0};
  let stored=0;
  for(const entry of (Array.isArray(payload.entry)?payload.entry:[]).slice(0,INBOX_LIMITS.hookEntries) as Record<string,unknown>[]){
    const owner=String(entry.id||'');if(!/^\d{1,30}$/.test(owner))continue;
    const accounts=db.prepare("SELECT c.id,c.organization_id,c.project_id,c.account_name,c.encrypted_credentials,c.integration_id,s.account_id,s.platform,s.page_id FROM platform_connections c JOIN platform_social_accounts s ON s.connection_id=c.id JOIN platform_projects p ON p.id=c.project_id AND p.organization_id=c.organization_id WHERE c.active=1 AND c.provider='social' AND p.product_pack='standard' AND s.platform=? AND s.account_id=?").all(platform,owner) as (Omit<Account,'organization'>&{organization_id:string;project_id:string})[];
    for(const row of accounts){
      const account:Account={...row,organization:false},found:Found[]=[];
      const post=(id:unknown)=>typeof id==='string'&&ID.test(id)?(db.prepare("SELECT p.job_id FROM platform_social_publications p JOIN platform_jobs j ON j.id=p.job_id WHERE p.organization_id=? AND p.project_id=? AND j.connection_id=? AND p.state='accepted' AND p.mode='publish' AND p.provider_post_id=?").get(row.organization_id,row.project_id,row.id,id) as {job_id:string}|undefined)?.job_id||null:null;
      for(const change of (Array.isArray(entry.changes)?entry.changes:[]) as Record<string,unknown>[]){
        const value=change.value&&typeof change.value==='object'?change.value as Record<string,unknown>:{},from=String((value.from as Record<string,unknown>|undefined)?.id||'');
        if(platform==='facebook'&&change.field==='feed'&&value.item==='comment'&&value.verb==='add'){
          const job=post(value.post_id),id=String(value.comment_id||''),text=clean(value.message,2000),at=unix(value.created_time);
          if(job&&ID.test(id)&&text&&at&&from!==owner)found.push({kind:'comment',threadId:String(value.post_id),itemId:id,publicationId:job,author:from||id,recipient:null,text,receivedAt:at});
        }
        if(platform==='instagram'&&change.field==='comments'){
          const media=(value.media as Record<string,unknown>|undefined)?.id,job=post(media),id=String(value.id||''),text=clean(value.text,2000),at=unix(entry.time)||new Date().toISOString();
          if(job&&ID.test(id)&&text&&from!==owner)found.push({kind:'comment',threadId:String(media),itemId:id,publicationId:job,author:from||id,recipient:null,text,receivedAt:at});
        }
      }
      for(const event of (Array.isArray(entry.messaging)?entry.messaging:[]) as Record<string,unknown>[]){
        const sender=String((event.sender as Record<string,unknown>|undefined)?.id||''),message=event.message&&typeof event.message==='object'?event.message as Record<string,unknown>:null;
        if(!message||message.is_echo===true||!/^\d{1,30}$/.test(sender)||sender===owner||sender===row.page_id)continue;
        const id=String(message.mid||''),text=clean(message.text,2000),at=unix(event.timestamp);
        if(ID.test(id)&&text&&at)found.push({kind:'message',threadId:'webhook',itemId:id,publicationId:null,author:sender,recipient:sender,text,receivedAt:at});
      }
      if(!found.length)continue;
      const inbox=new ProjectSocialInbox(db,{subject:'',organizationId:row.organization_id,projectId:row.project_id},key);
      db.transaction(()=>{stored+=inbox.ingest(account,found);const now=new Date().toISOString();
        db.prepare('INSERT INTO platform_social_inbox_accounts(connection_id,organization_id,project_id,hook_event_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET hook_event_at=excluded.hook_event_at').run(row.id,row.organization_id,row.project_id,now,now);}).immediate();
    }
  }
  return {stored};
}
