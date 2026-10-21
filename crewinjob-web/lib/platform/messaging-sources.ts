import 'server-only';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { MarketingStoreError, ProjectMarketingStore, type MarketingScope } from './marketing-store';
import { decryptCredentials, type StoredCredentials } from './credential-envelope';
import { readTelegramPosts, readTelegramSource, TelegramReadError, type TelegramPost, type TelegramSource } from './telegram-publishing';
import { dutyEligible, hasMessagingDuty, isProjectOwner } from './messaging-duties';
import { MESSAGING_DUTIES, MESSAGING_LIMITS, type MessagingDuty, type MessagingPostView, type MessagingSnapshot, type MessagingTopic } from './messaging-types';

export type MessagingReader={source:(token:string,channel:string)=>Promise<TelegramSource>;posts:(token:string,offset:number)=>Promise<{posts:TelegramPost[];nextOffset:number}>};
export const telegramMessagingReader:MessagingReader={source:readTelegramSource,posts:readTelegramPosts};
type SourceRow={id:string;connection_id:string;chat_id:string;title:string;username:string|null;auto_read:number;manager_id:string;last_read_at:string|null;last_error:string|null;revision:number;bot_name:string};
type PostRow={id:string;source_id:string;message_id:number;posted_at:string;text:string;topics_json:string;state:'new'|'suggested'|'dismissed';suggestion:string;content_id:string|null;decided_at:string|null;revision:number;title:string;username:string|null};
// Contact details are masked before a post is stored: email addresses, phone numbers and @handles.
const PERSONAL=[/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi,/\+?\d[\d\s().-]{8,}\d/g,/(^|[^\w/])@[A-Za-z][A-Za-z0-9_]{3,31}/g];
export const maskPersonal=(text:string)=>PERSONAL.reduce((value,pattern,index)=>value.replace(pattern,(match,lead)=>index===2?`${lead}[@…]`:'[…]'),text);
const fold=(value:string)=>value.toLocaleLowerCase('tr').normalize('NFC');
export const matchTopics=(text:string,dictionary:MessagingTopic[])=>{const body=fold(text);return dictionary.filter(topic=>topic.terms.some(term=>body.includes(fold(term)))).map(topic=>topic.id);};
const clean=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').trim().slice(0,max):'';

// Messaging sources for standard projects. Reading channel posts, turning one into a content suggestion and publishing
// are separate duties. Only channels the project's own bot was added to can be read; nothing here posts or messages anyone.
export class ProjectMessaging{
  repo:PlatformRepository;
  constructor(public db:Database.Database,public scope:MarketingScope,public key:string,public reader:MessagingReader=telegramMessagingReader){this.repo=new PlatformRepository(db);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private standard(subject=this.scope.subject){return this.repo.can(subject,...this.args(),'read')&&this.repo.workspace(subject,...this.args())?.project.productPack==='standard';}
  private authorize(need?:MessagingDuty|'connections.manage'|'members.manage',subject=this.scope.subject){
    if(!this.standard(subject))throw new MarketingStoreError('Mesajlaşma kaynakları için standart proje erişimi gerekli.',403);
    if(!need)return;
    if(need==='connections.manage'||need==='members.manage'){if(!this.repo.can(subject,...this.args(),need))throw new MarketingStoreError(need==='members.manage'?'Görevleri yalnız üye yönetimi yetkisi olanlar verebilir.':'Kaynakları yalnız bağlantı yönetimi yetkisi olanlar ekleyebilir.',403);return;}
    if(!hasMessagingDuty(this.db,subject,...this.args(),need))throw new MarketingStoreError(need==='source.read'?'Kaynakları okumak için "kaynak okuma" görevi gerekir.':need==='suggest'?'İçerik önermek için "içerik önerisi" görevi gerekir.':'Yayın için "yayın" görevi gerekir.',403);
  }
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
  private settings(){return this.db.prepare('SELECT dictionary_json,revision FROM platform_messaging_settings WHERE organization_id=? AND project_id=?').get(...this.args()) as {dictionary_json:string;revision:number}|undefined;}
  dictionary():MessagingTopic[]{try{return JSON.parse(this.settings()?.dictionary_json||'[]');}catch{return [];}}
  private bots(){return this.db.prepare("SELECT c.id,c.account_name name,s.account_id channel,c.encrypted_credentials FROM platform_connections c JOIN platform_social_accounts s ON s.connection_id=c.id WHERE c.organization_id=? AND c.project_id=? AND c.active=1 AND c.provider='social' AND s.platform='telegram' ORDER BY c.account_name").all(...this.args()) as {id:string;name:string;channel:string;encrypted_credentials:string}[];}
  private token(connectionId:string){const bot=this.bots().find(item=>item.id===connectionId);if(!bot)throw new MarketingStoreError('Telegram botu bulunamadı.',404);return decryptCredentials<StoredCredentials>(bot.encrypted_credentials,this.key,...this.args(),bot.id).accessToken;}
  private sources(){return this.db.prepare("SELECT m.*,c.account_name bot_name FROM platform_messaging_sources m JOIN platform_connections c ON c.id=m.connection_id WHERE m.organization_id=? AND m.project_id=? AND c.active=1 ORDER BY m.title COLLATE NOCASE").all(...this.args()) as SourceRow[];}
  private source(id:unknown){const row=this.sources().find(item=>item.id===id);if(!row)throw new MarketingStoreError('Kaynak bulunamadı.',404);return row;}
  private post(id:unknown){const row=typeof id==='string'?this.db.prepare('SELECT p.*,s.title,s.username FROM platform_messaging_posts p JOIN platform_messaging_sources s ON s.id=p.source_id WHERE p.id=? AND p.organization_id=? AND p.project_id=?').get(id,...this.args()) as PostRow|undefined:undefined;if(!row)throw new MarketingStoreError('Gönderi bulunamadı.',404);return row;}
  private readsToday(){return (this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='messaging_read'").get(...this.args(),new Date().toISOString().slice(0,10)) as {count:number}|undefined)?.count||0;}
  private duties(subject:string){return Object.fromEntries(MESSAGING_DUTIES.map(duty=>[duty,hasMessagingDuty(this.db,subject,...this.args(),duty)])) as Record<MessagingDuty,boolean>;}
  private describe(row:PostRow):MessagingPostView{
    return {id:row.id,sourceId:row.source_id,sourceTitle:row.title,link:row.username?`https://t.me/${row.username}/${row.message_id}`:null,postedAt:row.posted_at,text:row.text,topics:JSON.parse(row.topics_json),state:row.state,suggestion:row.suggestion,contentId:row.content_id,decidedAt:row.decided_at,revision:row.revision};
  }
  read():MessagingSnapshot{
    this.authorize();const me=this.duties(this.scope.subject),canManage=this.repo.can(this.scope.subject,...this.args(),'members.manage');
    // Post text is only shown to people who may read sources; the list of sources is visible to every member.
    const posts=me['source.read']?(this.db.prepare("SELECT p.*,s.title,s.username FROM platform_messaging_posts p JOIN platform_messaging_sources s ON s.id=p.source_id WHERE p.organization_id=? AND p.project_id=? ORDER BY p.posted_at DESC LIMIT 150").all(...this.args()) as PostRow[]).map(row=>this.describe(row)):[];
    const counts={new:0,suggested:0,dismissed:0};for(const row of this.db.prepare('SELECT state,COUNT(*) n FROM platform_messaging_posts WHERE organization_id=? AND project_id=? GROUP BY state').all(...this.args()) as {state:keyof typeof counts;n:number}[])counts[row.state]=row.n;
    const members=canManage?(this.db.prepare("SELECT u.id,u.username,m.role FROM platform_memberships m JOIN platform_users u ON u.id=m.user_id WHERE m.organization_id=? AND m.project_id=? AND m.active=1 AND u.active=1 ORDER BY u.username COLLATE NOCASE").all(...this.args()) as {id:string;username:string;role:string}[])
      .map(row=>({userId:row.id,name:row.username,role:row.role,implicit:isProjectOwner(this.db,row.id,...this.args()),duties:MESSAGING_DUTIES.filter(duty=>hasMessagingDuty(this.db,row.id,...this.args(),duty)),eligible:Object.fromEntries(MESSAGING_DUTIES.map(duty=>[duty,dutyEligible(this.repo,row.id,...this.args(),duty)])) as Record<MessagingDuty,boolean>})):null;
    return {
      sources:this.sources().map(row=>({id:row.id,connectionId:row.connection_id,botName:row.bot_name,chatId:row.chat_id,title:row.title,username:row.username,autoRead:row.auto_read===1,lastReadAt:row.last_read_at,lastError:row.last_error,revision:row.revision})),
      bots:this.bots().map(({id,name,channel})=>({id,name,channel})),posts,counts:me['source.read']?counts:{new:0,suggested:0,dismissed:0},
      dictionary:this.dictionary(),dictionaryRevision:this.settings()?.revision||0,readsLeft:Math.max(0,MESSAGING_LIMITS.readsPerDay-this.readsToday()),me,canManage,canConnect:this.repo.can(this.scope.subject,...this.args(),'connections.manage'),members,
    };
  }
  // Adds a channel the bot was added to. The bot must be a member or administrator there; groups are refused.
  async addSource(raw:Record<string,unknown>){
    this.authorize('connections.manage');const channel=clean(raw.channel,40),connectionId=clean(raw.connectionId,120);
    if(!/^(-100\d{6,15}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(channel))throw new MarketingStoreError('Kanalı @kullaniciadi veya -100… kimliğiyle girin.');
    if(this.sources().length>=MESSAGING_LIMITS.sources)throw new MarketingStoreError('Kaynak sınırına ulaşıldı.',429);
    let found:TelegramSource;try{found=await this.reader.source(this.token(connectionId),channel);}catch(error){if(error instanceof MarketingStoreError)throw error;throw new MarketingStoreError('Kanal doğrulanamadı. Botun bu kanala kanal yöneticisi tarafından eklendiğini ve kanalın grup değil kanal olduğunu kontrol edin.',409);}
    return this.db.transaction(()=>{
      this.authorize('connections.manage');this.token(connectionId);
      if(this.db.prepare('SELECT 1 FROM platform_messaging_sources WHERE organization_id=? AND project_id=? AND chat_id=?').get(...this.args(),found.chatId))throw new MarketingStoreError('Bu kanal zaten kaynak olarak ekli.',409);
      const now=new Date().toISOString();
      this.db.prepare('INSERT INTO platform_messaging_sources(id,organization_id,project_id,connection_id,chat_id,title,username,auto_read,manager_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,?,?,?)').run(`msgsrc_${randomUUID()}`,...this.args(),connectionId,found.chatId,found.title,found.username,this.scope.subject,now,now);
      this.audit('messaging.source.add');return this.read();
    }).immediate();
  }
  // Automatic reading runs as the person who turns it on, and stops when that person loses the reading duty.
  setAutoRead(raw:Record<string,unknown>){
    this.authorize('connections.manage');
    return this.db.transaction(()=>{const row=this.source(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Kaynak başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      const on=raw.autoRead===true;if(on)this.authorize('source.read');
      this.db.prepare('UPDATE platform_messaging_sources SET auto_read=?,manager_id=?,revision=revision+1,updated_at=? WHERE id=?').run(on?1:0,this.scope.subject,new Date().toISOString(),row.id);
      this.audit(on?'messaging.source.auto_on':'messaging.source.auto_off');return this.read();}).immediate();
  }
  removeSource(raw:Record<string,unknown>){
    this.authorize('connections.manage');
    return this.db.transaction(()=>{const row=this.source(raw.id);this.db.prepare('DELETE FROM platform_messaging_sources WHERE id=?').run(row.id);this.audit('messaging.source.remove');return this.read();}).immediate();
  }
  // Reads waiting channel posts for every bot of this project's sources. Posts from other chats are skipped.
  async readNow(subject=this.scope.subject){
    this.authorize('source.read',subject);if(!this.sources().length)throw new MarketingStoreError('Önce bir kaynak kanal ekleyin.',409);
    if(this.readsToday()>=MESSAGING_LIMITS.readsPerDay)throw new MarketingStoreError('Günlük kaynak okuma sınırına ulaşıldı.',429);
    this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'messaging_read',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),new Date().toISOString().slice(0,10));
    let added=0;
    for(const connectionId of [...new Set(this.sources().map(row=>row.connection_id))]){
      const offset=(this.db.prepare('SELECT next_offset FROM platform_messaging_offsets WHERE connection_id=?').get(connectionId) as {next_offset:number}|undefined)?.next_offset||0;
      let result:{posts:TelegramPost[];nextOffset:number}|null=null,failure:string|null=null;
      try{result=await this.reader.posts(this.token(connectionId),offset);}catch(error){failure=error instanceof TelegramReadError&&error.code==='webhook'?'webhook':'failed';}
      added+=this.db.transaction(()=>{
        this.authorize('source.read',subject);const now=new Date().toISOString(),sources=this.sources().filter(row=>row.connection_id===connectionId);
        if(!result){this.db.prepare('UPDATE platform_messaging_sources SET last_error=?,attempted_at=? WHERE connection_id=? AND organization_id=? AND project_id=?').run(failure,now,connectionId,...this.args());return 0;}
        const dictionary=this.dictionary();let count=0;
        for(const post of result.posts){
          const source=sources.find(row=>row.chat_id===post.chatId);if(!source)continue;const text=maskPersonal(post.text);
          count+=this.db.prepare('INSERT OR IGNORE INTO platform_messaging_posts(id,organization_id,project_id,source_id,message_id,posted_at,text,topics_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(`msgpost_${randomUUID()}`,...this.args(),source.id,post.messageId,new Date(post.date*1000).toISOString(),text,JSON.stringify(matchTopics(text,dictionary)),now).changes;
        }
        this.db.prepare('INSERT INTO platform_messaging_offsets(connection_id,organization_id,project_id,next_offset,read_at) VALUES(?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET next_offset=MAX(next_offset,excluded.next_offset),read_at=excluded.read_at').run(connectionId,...this.args(),result.nextOffset,now);
        this.db.prepare('UPDATE platform_messaging_sources SET last_read_at=?,attempted_at=?,last_error=NULL WHERE connection_id=? AND organization_id=? AND project_id=?').run(now,now,connectionId,...this.args());
        return count;
      }).immediate();
    }
    this.prune();return {added,snapshot:this.read()};
  }
  private prune(){this.db.prepare("DELETE FROM platform_messaging_posts WHERE organization_id=? AND project_id=? AND posted_at<?").run(...this.args(),new Date(Date.now()-MESSAGING_LIMITS.retentionDays*86400000).toISOString());}
  // Sector dictionary: topics and the words that mark them. Re-tags every stored post.
  saveDictionary(raw:Record<string,unknown>){
    this.authorize('suggest');
    const topics:MessagingTopic[]=(Array.isArray(raw.dictionary)?raw.dictionary:[]).slice(0,MESSAGING_LIMITS.topics+1).map((item:unknown)=>{const value=item&&typeof item==='object'?item as Record<string,unknown>:{};
      const terms=[...new Set((Array.isArray(value.terms)?value.terms:[]).map(term=>clean(term,40)).filter(term=>term.length>=2))];
      return {id:/^[a-z0-9-]{1,40}$/.test(String(value.id))?String(value.id):randomUUID().slice(0,8),label:clean(value.label,60),terms};});
    if(topics.length>MESSAGING_LIMITS.topics||topics.some(topic=>!topic.label||!topic.terms.length||topic.terms.length>MESSAGING_LIMITS.termsPerTopic)||new Set(topics.map(topic=>topic.id)).size!==topics.length)throw new MarketingStoreError(`Sözlükte en fazla ${MESSAGING_LIMITS.topics} konu olabilir; her konunun adı ve 1–${MESSAGING_LIMITS.termsPerTopic} terimi olmalı.`);
    return this.db.transaction(()=>{
      this.authorize('suggest');const current=this.settings();if(raw.expectedRevision!==(current?.revision||0))throw new MarketingStoreError('Sözlük başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);const now=new Date().toISOString();
      this.db.prepare('INSERT INTO platform_messaging_settings(organization_id,project_id,dictionary_json,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET dictionary_json=excluded.dictionary_json,revision=revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(...this.args(),JSON.stringify(topics),this.scope.subject,now);
      for(const row of this.db.prepare('SELECT id,text FROM platform_messaging_posts WHERE organization_id=? AND project_id=?').all(...this.args()) as {id:string;text:string}[])this.db.prepare('UPDATE platform_messaging_posts SET topics_json=? WHERE id=?').run(JSON.stringify(matchTopics(row.text,topics)),row.id);
      this.audit('messaging.dictionary.save');return this.read();
    }).immediate();
  }
  // A suggestion is the team's own text inspired by a post. It can become a Telegram content draft, never a copy sent on.
  suggest(raw:Record<string,unknown>){
    this.authorize('suggest');const suggestion=clean(raw.suggestion,MESSAGING_LIMITS.suggestion);if(!suggestion)throw new MarketingStoreError('Öneri metni gerekli.');
    return this.db.transaction(()=>{
      this.authorize('suggest');const row=this.post(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Gönderi başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      const now=new Date().toISOString();let contentId=row.content_id;
      if(raw.draft===true&&!contentId){
        const project=this.repo.workspace(this.scope.subject,...this.args())!.project,link=row.username?`https://t.me/${row.username}/${row.message_id}`:row.title;
        contentId=`msg-${randomUUID()}`;new ProjectMarketingStore(this.db,this.scope).saveContent({id:contentId,platform:'telegram',language:project.language==='en'?'en':'tr',content:suggestion,prompt:`${project.language==='en'?'Inspired by':'Esinlenilen kaynak'}: ${link} (${row.posted_at.slice(0,10)})`,timestamp:Date.now()},true);
      }
      this.db.prepare("UPDATE platform_messaging_posts SET state='suggested',suggestion=?,content_id=?,decided_by=?,decided_at=?,revision=revision+1 WHERE id=?").run(suggestion,contentId,this.scope.subject,now,row.id);
      this.audit(raw.draft===true?'messaging.post.draft':'messaging.post.suggest');return this.read();
    }).immediate();
  }
  decide(raw:Record<string,unknown>){
    this.authorize('suggest');const state=raw.state==='dismissed'||raw.state==='new'?raw.state:null;if(!state)throw new MarketingStoreError('Geçersiz gönderi durumu.');
    return this.db.transaction(()=>{const row=this.post(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Gönderi başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      this.db.prepare('UPDATE platform_messaging_posts SET state=?,decided_by=?,decided_at=?,revision=revision+1 WHERE id=?').run(state,this.scope.subject,new Date().toISOString(),row.id);this.audit(`messaging.post.${state}`);return this.read();}).immediate();
  }
  // Duties are given per person by someone who manages members; each one still needs its base permission.
  setDuty(raw:Record<string,unknown>){
    this.authorize('members.manage');const duty=MESSAGING_DUTIES.find(item=>item===raw.duty),userId=clean(raw.userId,120);if(!duty)throw new MarketingStoreError('Geçersiz görev.');
    return this.db.transaction(()=>{
      this.authorize('members.manage');
      if(!this.db.prepare('SELECT 1 FROM platform_memberships WHERE user_id=? AND organization_id=? AND project_id=? AND active=1').get(userId,...this.args()))throw new MarketingStoreError('Üye bulunamadı.',404);
      if(raw.granted===true){if(!dutyEligible(this.repo,userId,...this.args(),duty))throw new MarketingStoreError('Bu görev için üyenin rolü yetmiyor: kaynak okuma için okuma, öneri için içerik yazma, yayın için bağlantı, onay ve gönderim yetkileri gerekir.',403);
        this.db.prepare('INSERT OR IGNORE INTO platform_messaging_duties VALUES(?,?,?,?,?,?)').run(...this.args(),userId,duty,this.scope.subject,new Date().toISOString());}
      else{this.db.prepare('DELETE FROM platform_messaging_duties WHERE organization_id=? AND project_id=? AND user_id=? AND duty=?').run(...this.args(),userId,duty);
        if(duty==='source.read')this.db.prepare('UPDATE platform_messaging_sources SET auto_read=0,revision=revision+1 WHERE organization_id=? AND project_id=? AND manager_id=? AND auto_read=1').run(...this.args(),userId);}
      this.audit(`messaging.duty.${raw.granted===true?'grant':'revoke'}`);return this.read();
    }).immediate();
  }
}

// Worker step: projects with automatic reading are read every 30 minutes as the person who turned it on.
export async function readDueMessagingSources(db:Database.Database,key:string,reader:MessagingReader=telegramMessagingReader,everyMs=30*60000,limit=3){
  const due=db.prepare("SELECT s.organization_id,s.project_id,s.manager_id,MIN(COALESCE(s.attempted_at,'')) last FROM platform_messaging_sources s JOIN platform_connections c ON c.id=s.connection_id WHERE s.auto_read=1 AND c.active=1 GROUP BY s.organization_id,s.project_id,s.manager_id HAVING last<? ORDER BY last LIMIT ?").all(new Date(Date.now()-everyMs).toISOString(),limit) as {organization_id:string;project_id:string;manager_id:string}[];
  let read=0;
  for(const row of due){
    const scope={subject:row.manager_id,organizationId:row.organization_id,projectId:row.project_id};
    if(!hasMessagingDuty(db,row.manager_id,row.organization_id,row.project_id,'source.read')){db.prepare('UPDATE platform_messaging_sources SET auto_read=0,revision=revision+1 WHERE organization_id=? AND project_id=? AND manager_id=?').run(row.organization_id,row.project_id,row.manager_id);continue;}
    try{await new ProjectMessaging(db,scope,key,reader).readNow();read++;}catch{db.prepare("UPDATE platform_messaging_sources SET attempted_at=? WHERE organization_id=? AND project_id=? AND manager_id=? AND auto_read=1").run(new Date().toISOString(),row.organization_id,row.project_id,row.manager_id);}
  }
  return read;
}
