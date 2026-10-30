import 'server-only';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { decryptCredentials, encryptCredentials } from './credential-envelope';
import { hasMessagingDuty } from './messaging-duties';
import { iysGate, iysScope, iysSendBlock, queueIysConsent } from './iys';
import { IYS_SOURCES, type IysSource } from './iys-types';
import { INBOX_LIMITS } from './social-inbox-types';
import { ingestWhatsAppInbound, whatsAppInboundFrom, type WhatsAppInbound } from './social-inbox';
import { WHATSAPP_LIMITS, WHATSAPP_STOP_WORDS, type WhatsAppBatchExtras, type WhatsAppBatchView, type WhatsAppDelivery, type WhatsAppHeaderFormat, type WhatsAppMessageState, type WhatsAppSnapshot, type WhatsAppTemplateView } from './whatsapp-types';

// WhatsApp Cloud API client: fixed host, token only in the Authorization header, a short path allowlist.
export type WhatsAppGraph=(method:'GET'|'POST',path:string,token:string,params?:Record<string,string>,body?:Record<string,unknown>)=>Promise<{status:number;payload:Record<string,unknown>}>;
const version=()=>{const value=process.env.PLATFORM_WHATSAPP_GRAPH_VERSION||process.env.PLATFORM_META_ADS_GRAPH_VERSION||'v25.0';return /^v\d{1,3}\.\d$/.test(value)?value:'v25.0';};
export const whatsAppGraph:WhatsAppGraph=async(method,path,token,params={},body)=>{
  if(!/^\d{1,25}(\/(phone_numbers|message_templates|messages))?$/.test(path))throw new Error('Invalid WhatsApp path.');
  const url=new URL(`https://graph.facebook.com/${version()}/${path}`);for(const [key,value] of Object.entries(params))url.searchParams.set(key,value);
  const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  const text=await response.text();let payload:Record<string,unknown>={};try{payload=JSON.parse(text.slice(0,262144));}catch{payload={};}
  return {status:response.status,payload};
};
export const whatsAppSendEnabled=()=>process.env.PLATFORM_WHATSAPP_SEND_ENABLED==='1';
type Credentials={accessToken:string;refreshToken:string;phoneNumberId:string;wabaId:string;displayPhone:string;verifiedName:string;quality:string|null;checkedAt:string};
type Batch={id:string;connection_id:string;name:string;template_name:string;template_language:string;params_json:string;overrides_json:string;extras_json:string;contacts_json:string;digest:string;state:WhatsAppBatchView['state'];mode:'rehearsal'|'send'|null;approved_digest:string|null;approved_at:string|null;queued_by:string|null;queued_at:string|null;revision:number;updated_at:string;created_by:string};
const E164=/^\+[1-9]\d{7,14}$/;
export const normalizePhone=(value:string)=>{const compact=value.replace(/[\s().-]/g,'').replace(/^00/,'+');return E164.test(compact)?compact:null;};
const hint=(phone:string)=>`${phone.slice(0,3)}•••${phone.slice(-2)}`;
const clean=(value:unknown,max:number)=>typeof value==='string'?value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').trim().slice(0,max):'';
// Template variables are plain text: WhatsApp rejects new lines, tabs and long runs of spaces in them.
const param=(value:unknown)=>{const text=typeof value==='string'?value.trim():'';if(!text||text.length>WHATSAPP_LIMITS.param||/[\n\r\t]| {4,}|\{\{|\}\}/.test(text))throw new MarketingStoreError(`Her şablon değişkeni 1–${WHATSAPP_LIMITS.param} karakterlik tek satır metin olmalı.`);return text;};
export const templateParams=(body:string)=>new Set([...body.matchAll(/\{\{(\d{1,2})\}\}/g)].map(match=>match[1])).size;
// A media header link is fetched by Meta, not by Ryzevo; it must still be a public https address.
const mediaLink=(value:unknown)=>{
  const text=typeof value==='string'?value.trim():'';let url:URL|null=null;try{url=new URL(text);}catch{url=null;}
  const host=url?.hostname.toLowerCase()||'';
  if(!url||text.length>1000||url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!host.includes('.')||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||/^[\d.]+$/.test(host)||host.startsWith('['))
    throw new MarketingStoreError('Başlık medyası için herkese açık bir https bağlantısı girin.');
  return url.href;
};
const batchDigest=(connectionId:string,template:WhatsAppTemplateView,params:string[],contactIds:string[],overrides:Record<string,string[]>,extras:WhatsAppBatchExtras)=>createHash('sha256').update(JSON.stringify([connectionId,template.name,template.language,template.body,params,contactIds,overrides,template.headerFormat,template.buttonUrl,extras])).digest('hex');
// The dynamic end of a URL button: a short path or query piece, never a whole new address.
const buttonParam=(value:unknown)=>{const text=typeof value==='string'?value.trim():'';if(!/^[A-Za-z0-9._~\-\/?=&%+]{1,200}$/.test(text)||text.includes('//'))throw new MarketingStoreError('Düğme bağlantısının değişken kısmı boşluksuz, 1–200 karakterlik bir yol veya sorgu parçası olmalı.');return text;};

// WhatsApp template sending. Contacts carry their own WhatsApp consent; a batch is approved on its exact content and
// sent one message at a time, each re-checked just before it goes. Meta bills each message; no price is shown here.
export class ProjectWhatsApp{
  repo:PlatformRepository;
  constructor(public db:Database.Database,public scope:MarketingScope,public key:string,public graph:WhatsAppGraph=whatsAppGraph){this.repo=new PlatformRepository(db);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private can(permission:Parameters<PlatformRepository['can']>[3],subject=this.scope.subject){return this.repo.can(subject,...this.args(),permission);}
  private authorize(need?:'connections.manage'|'recipients.manage'|'content.write'|'campaign.approve'|'campaign.dispatch'|'publish',subject=this.scope.subject){
    if(!this.can('read',subject)||this.repo.workspace(subject,...this.args())?.project.productPack!=='standard')throw new MarketingStoreError('WhatsApp gönderimi için standart proje erişimi gerekli.',403);
    if(!need)return;
    if(need==='publish'){if(!this.can('campaign.dispatch',subject)||!hasMessagingDuty(this.db,subject,...this.args(),'publish'))throw new MarketingStoreError('Gerçek WhatsApp gönderimi için gönderim yetkisi ve "yayın" mesajlaşma görevi gerekir.',403);return;}
    if(!this.can(need,subject))throw new MarketingStoreError(need==='connections.manage'?'WhatsApp numarasını yalnız bağlantı yönetimi yetkisi olanlar bağlayabilir.':need==='recipients.manage'?'WhatsApp kişilerini ve izinlerini yalnız alıcı yönetimi yetkisi olanlar düzenleyebilir.':need==='campaign.approve'?'WhatsApp gönderilerini yalnız onay yetkisi olanlar onaylayabilir.':need==='campaign.dispatch'?'Bu işlem için gönderim yetkisi gerekir.':'Bu işlem için içerik yazma yetkisi gerekir.',403);
  }
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
  private connection(){return this.db.prepare("SELECT id,encrypted_credentials FROM platform_connections WHERE organization_id=? AND project_id=? AND provider='whatsapp' AND active=1 ORDER BY updated_at DESC LIMIT 1").get(...this.args()) as {id:string;encrypted_credentials:string}|undefined;}
  private credentials(){const connection=this.connection();if(!connection)throw new MarketingStoreError('Önce WhatsApp Business numarasını bağlayın.',409);return {connection,credentials:decryptCredentials<Credentials>(connection.encrypted_credentials,this.key,...this.args(),connection.id)};}
  private phoneHash(phone:string){return createHmac('sha256',Buffer.from(this.key,'hex')).update(`whatsapp:${this.scope.organizationId}:${this.scope.projectId}:${phone}`).digest('hex');}
  private phone(contactId:string,encrypted:string){return decryptCredentials<{phone:string}>(encrypted,this.key,...this.args(),`whatsapp-contact:${contactId}`).phone;}
  private templates(connectionId?:string):WhatsAppTemplateView[]{
    const id=connectionId??this.connection()?.id;if(!id)return [];
    return (this.db.prepare('SELECT name,language,category,body,params,header_format,button_url,fetched_at FROM platform_whatsapp_templates WHERE connection_id=? AND organization_id=? AND project_id=? ORDER BY name,language').all(id,...this.args()) as {name:string;language:string;category:string;body:string;params:number;header_format:WhatsAppHeaderFormat;button_url:string|null;fetched_at:string}[]).map(row=>({name:row.name,language:row.language,category:row.category,body:row.body,params:row.params,headerFormat:row.header_format,buttonUrl:row.button_url,fetchedAt:row.fetched_at}));
  }
  private buttonIndex(connectionId:string,name:string,language:string){
    return (this.db.prepare('SELECT button_index FROM platform_whatsapp_templates WHERE connection_id=? AND organization_id=? AND project_id=? AND name=? AND language=?').get(connectionId,...this.args(),name,language) as {button_index:number|null}|undefined)?.button_index??null;
  }
  private batch(id:unknown){const row=typeof id==='string'?this.db.prepare('SELECT * FROM platform_whatsapp_batches WHERE id=? AND organization_id=? AND project_id=?').get(id,...this.args()) as Batch|undefined:undefined;if(!row)throw new MarketingStoreError('WhatsApp gönderisi bulunamadı.',404);return row;}
  private sentToday(){return (this.db.prepare("SELECT COUNT(*) n FROM platform_whatsapp_messages m JOIN platform_whatsapp_batches b ON b.id=m.batch_id WHERE b.organization_id=? AND b.project_id=? AND m.state IN ('submitting','accepted','uncertain') AND m.submitted_at>=?").get(...this.args(),`${new Date().toISOString().slice(0,10)}T00:00:00.000Z`) as {n:number}).n;}
  private sendable(contactId:string){return this.db.prepare('SELECT id,phone_hash,phone_encrypted FROM platform_whatsapp_contacts WHERE id=? AND organization_id=? AND project_id=? AND opted_out_at IS NULL').get(contactId,...this.args()) as {id:string;phone_hash:string;phone_encrypted:string}|undefined;}
  private describe(row:Batch):WhatsAppBatchView{
    const counts:Partial<Record<WhatsAppMessageState,number>>={};for(const item of this.db.prepare('SELECT state,COUNT(*) n FROM platform_whatsapp_messages WHERE batch_id=? GROUP BY state').all(row.id) as {state:WhatsAppMessageState;n:number}[])counts[item.state]=item.n;
    const delivery:Partial<Record<WhatsAppDelivery,number>>={};for(const item of this.db.prepare('SELECT delivery,COUNT(*) n FROM platform_whatsapp_messages WHERE batch_id=? AND delivery IS NOT NULL GROUP BY delivery').all(row.id) as {delivery:WhatsAppDelivery;n:number}[])delivery[item.delivery]=item.n;
    const params=JSON.parse(row.params_json) as string[],template=this.templates(row.connection_id).find(item=>item.name===row.template_name&&item.language===row.template_language);
    return {id:row.id,name:row.name,templateName:row.template_name,templateLanguage:row.template_language,params,overrides:JSON.parse(row.overrides_json||'{}'),extras:JSON.parse(row.extras_json||'{}') as WhatsAppBatchExtras,contactIds:JSON.parse(row.contacts_json),digest:row.digest,state:row.state,mode:row.mode,approved:row.approved_digest===row.digest,approvedAt:row.approved_at,queuedAt:row.queued_at,counts,delivery,
      preview:template?template.body.replace(/\{\{(\d{1,2})\}\}/g,(match,index)=>params[Number(index)-1]??match):null,revision:row.revision,updatedAt:row.updated_at};
  }
  read():WhatsAppSnapshot{
    this.authorize();const connection=this.connection();let account:WhatsAppSnapshot['account']=null;
    if(connection){const value=decryptCredentials<Credentials>(connection.encrypted_credentials,this.key,...this.args(),connection.id);account={connectionId:connection.id,phoneNumberId:value.phoneNumberId,wabaId:value.wabaId,displayPhone:value.displayPhone,verifiedName:value.verifiedName,quality:value.quality,checkedAt:value.checkedAt};}
    const showContacts=this.can('recipients.manage')||this.can('content.write');
    return {
      account,templates:this.templates(),
      contacts:showContacts?(this.db.prepare('SELECT id,phone_hint,consent_evidence,consent_at,opted_out_at,opt_out_source,created_at FROM platform_whatsapp_contacts WHERE organization_id=? AND project_id=? ORDER BY created_at DESC').all(...this.args()) as {id:string;phone_hint:string;consent_evidence:string;consent_at:string;opted_out_at:string|null;opt_out_source:'team'|'reply'|null;created_at:string}[]).map(row=>({id:row.id,hint:row.phone_hint,consentEvidence:row.consent_evidence,consentAt:row.consent_at,optedOut:Boolean(row.opted_out_at),optOutSource:row.opt_out_source,createdAt:row.created_at})):[],
      batches:(this.db.prepare('SELECT * FROM platform_whatsapp_batches WHERE organization_id=? AND project_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 50').all(...this.args()) as Batch[]).map(row=>this.describe(row)),
      sendEnabled:whatsAppSendEnabled(),sentToday:this.sentToday(),hook:this.hook(connection?.id),
      can:{connect:this.can('connections.manage'),contacts:this.can('recipients.manage'),write:this.can('content.write'),approve:this.can('campaign.approve'),dispatch:this.can('campaign.dispatch'),publish:this.can('campaign.dispatch')&&hasMessagingDuty(this.db,this.scope.subject,...this.args(),'publish')},
    };
  }
  // Connects the project's own number: the token must see the phone number and that number must belong to the WABA.
  async connect(raw:Record<string,unknown>){
    this.authorize('connections.manage');
    const phoneNumberId=clean(raw.phoneNumberId,25),wabaId=clean(raw.wabaId,25),token=typeof raw.accessToken==='string'?raw.accessToken.trim():'';
    if(!/^\d{5,25}$/.test(phoneNumberId)||!/^\d{5,25}$/.test(wabaId))throw new MarketingStoreError('Telefon numarası kimliği ve WhatsApp Business hesap kimliği yalnız rakamlardan oluşmalı.');
    if(!token||token.length>4096||/[\s\x00]/.test(token))throw new MarketingStoreError('Geçerli bir erişim anahtarı girin.');
    let phone:Record<string,unknown>,numbers:unknown;
    try{
      const one=await this.graph('GET',phoneNumberId,token,{fields:'display_phone_number,verified_name,quality_rating'}),list=await this.graph('GET',`${wabaId}/phone_numbers`,token,{fields:'id'});
      if(one.status!==200||list.status!==200)throw new Error();phone=one.payload;numbers=list.payload.data;
    }catch{throw new MarketingStoreError('WhatsApp numarasına erişilemedi. Kimlikleri, anahtarın whatsapp_business_messaging ve whatsapp_business_management izinlerini kontrol edin.',502);}
    if(!Array.isArray(numbers)||!numbers.some(item=>item&&typeof item==='object'&&(item as Record<string,unknown>).id===phoneNumberId))throw new MarketingStoreError('Bu telefon numarası belirtilen WhatsApp Business hesabına ait değil.',409);
    return this.db.transaction(()=>{
      this.authorize('connections.manage');const now=new Date().toISOString(),old=this.connection(),id=`waconn_${randomUUID()}`;
      const credentials:Credentials={accessToken:token,refreshToken:'',phoneNumberId,wabaId,displayPhone:clean(phone.display_phone_number,30)||phoneNumberId,verifiedName:clean(phone.verified_name,120),quality:clean(phone.quality_rating,20)||null,checkedAt:now};
      if(old)this.db.prepare("UPDATE platform_connections SET active=0,encrypted_credentials='',updated_at=? WHERE id=?").run(now,old.id);
      this.db.prepare("UPDATE platform_whatsapp_batches SET state='cancelled',revision=revision+1,updated_at=? WHERE organization_id=? AND project_id=? AND state IN ('draft','approved','queued')").run(now,...this.args());
      this.db.prepare("UPDATE platform_whatsapp_messages SET state='skipped',reason='number_changed',finished_at=? WHERE state='pending' AND batch_id IN (SELECT id FROM platform_whatsapp_batches WHERE organization_id=? AND project_id=?)").run(now,...this.args());
      this.db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,'whatsapp',?,?,?,1,?)").run(id,...this.args(),phoneNumberId,(credentials.verifiedName||credentials.displayPhone).slice(0,120),encryptCredentials(credentials,this.key,...this.args(),id),now);
      this.audit('whatsapp.connect');return this.read();
    }).immediate();
  }
  // Approved templates: body variables, an optional image/video/document header and at most one URL button with a dynamic ending.
  // Text-header variables, copy-code, flow, catalogue and one-time-password buttons are left out.
  async refreshTemplates(){
    this.authorize('content.write');const {connection,credentials}=this.credentials();let data:unknown;
    try{const result=await this.graph('GET',`${credentials.wabaId}/message_templates`,credentials.accessToken,{fields:'name,language,status,category,components',limit:'100'});if(result.status!==200)throw new Error();data=result.payload.data;}catch{throw new MarketingStoreError('WhatsApp şablonları okunamadı. Anahtarın whatsapp_business_management iznini kontrol edin.',502);}
    const rows=(Array.isArray(data)?data:[]).flatMap((item:unknown)=>{
      const value=item&&typeof item==='object'?item as Record<string,unknown>:{},components=Array.isArray(value.components)?value.components as Record<string,unknown>[]:[];
      if(value.status!=='APPROVED'||!['MARKETING','UTILITY'].includes(String(value.category))||typeof value.name!=='string'||!/^[a-z0-9_]{1,512}$/.test(value.name)||typeof value.language!=='string'||!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(value.language))return [];
      const body=components.find(part=>part.type==='BODY'),header=components.find(part=>part.type==='HEADER'),buttons=components.find(part=>part.type==='BUTTONS');
      if(!body||typeof body.text!=='string')return [];
      const headerFormat=(header?String(header.format):'NONE') as WhatsAppHeaderFormat;
      if(!['NONE','TEXT','IMAGE','VIDEO','DOCUMENT'].includes(headerFormat)||headerFormat==='TEXT'&&/\{\{/.test(String(header?.text)))return [];
      const list=Array.isArray(buttons?.buttons)?buttons.buttons as Record<string,unknown>[]:[];
      if(list.some(button=>!['QUICK_REPLY','URL','PHONE_NUMBER'].includes(String(button.type))||button.type!=='URL'&&JSON.stringify(button).includes('{{')))return [];
      const dynamic=list.map((button,index)=>({button,index})).filter(item=>item.button.type==='URL'&&String(item.button.url).includes('{{'));
      if(dynamic.length>1)return [];
      const url=dynamic[0]?String(dynamic[0].button.url):null;
      if(url&&!/^https:\/\/[^\s{}]+\{\{1\}\}$/.test(url))return [];
      return [{name:value.name,language:value.language,category:String(value.category),body:body.text.slice(0,1024),params:templateParams(body.text),headerFormat,buttonUrl:url?url.slice(0,1000):null,buttonIndex:dynamic[0]?.index??null}];
    });
    return this.db.transaction(()=>{
      this.authorize('content.write');const now=new Date().toISOString();
      this.db.prepare('DELETE FROM platform_whatsapp_templates WHERE connection_id=? AND organization_id=? AND project_id=?').run(connection.id,...this.args());
      for(const row of rows)this.db.prepare('INSERT OR REPLACE INTO platform_whatsapp_templates(connection_id,organization_id,project_id,name,language,category,body,params,fetched_at,header_format,button_url,button_index) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(connection.id,...this.args(),row.name,row.language,row.category,row.body,row.params,now,row.headerFormat,row.buttonUrl,row.buttonIndex);
      this.audit('whatsapp.templates.refresh');return this.read();
    }).immediate();
  }
  // Contacts are added with their own WhatsApp consent evidence. Email consent never counts for WhatsApp.
  addContacts(raw:Record<string,unknown>){
    this.authorize('recipients.manage');
    if(raw.acknowledged!==true)throw new MarketingStoreError('Her kişinin WhatsApp ile pazarlama mesajı almayı açıkça kabul ettiğini onaylayın.');
    const evidence=clean(raw.evidence,160),consentAt=clean(raw.consentAt,10);if(!evidence)throw new MarketingStoreError('İzin kanıtı (form, kayıt veya belge referansı) gerekli.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(consentAt)||Date.parse(`${consentAt}T00:00:00Z`)>Date.now())throw new MarketingStoreError('Geçerli bir izin tarihi girin; gelecek tarih olamaz.');
    const entries=(typeof raw.phones==='string'?raw.phones.split(/[\n,;]+/):[]).map(item=>item.trim()).filter(Boolean);
    if(!entries.length||entries.length>WHATSAPP_LIMITS.addPerRequest)throw new MarketingStoreError(`Bir seferde 1–${WHATSAPP_LIMITS.addPerRequest} numara ekleyin.`);
    const phones=entries.map(normalizePhone);if(phones.some(phone=>!phone))throw new MarketingStoreError('Numaraları ülke koduyla, uluslararası biçimde girin (ör. +905321234567).');
    const iysSource=typeof raw.iysSource==='string'&&(IYS_SOURCES as readonly string[]).includes(raw.iysSource)?raw.iysSource as IysSource:null;
    if(iysScope(this.db,this.scope)==='tr'&&!iysSource)throw new MarketingStoreError('İYS için iznin nasıl alındığını seçin.');
    return this.db.transaction(()=>{
      this.authorize('recipients.manage');let added=0,existing=0;const now=new Date().toISOString();
      for(const phone of new Set(phones as string[])){
        const hash=this.phoneHash(phone);if(this.db.prepare('SELECT 1 FROM platform_whatsapp_contacts WHERE organization_id=? AND project_id=? AND phone_hash=?').get(...this.args(),hash)){existing++;continue;}
        const suppressed=this.db.prepare('SELECT created_at FROM platform_whatsapp_suppressions WHERE organization_id=? AND project_id=? AND phone_hash=?').get(...this.args(),hash) as {created_at:string}|undefined;
        if(suppressed&&consentAt<=suppressed.created_at.slice(0,10))throw new MarketingStoreError('Bu numaralardan biri daha önce izinden çıktı; yeniden eklemek için çıkıştan sonra alınmış yeni bir izin gerekir.',409);
        if(suppressed)this.db.prepare('DELETE FROM platform_whatsapp_suppressions WHERE organization_id=? AND project_id=? AND phone_hash=?').run(...this.args(),hash);
        if((this.db.prepare('SELECT COUNT(*) n FROM platform_whatsapp_contacts WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n>=WHATSAPP_LIMITS.contacts)throw new MarketingStoreError('WhatsApp kişi sınırına ulaşıldı.',429);
        const id=`wacontact_${randomUUID()}`;
        this.db.prepare('INSERT INTO platform_whatsapp_contacts(id,organization_id,project_id,phone_hash,phone_encrypted,phone_hint,consent_evidence,consent_at,consent_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,...this.args(),hash,encryptCredentials({phone},this.key,...this.args(),`whatsapp-contact:${id}`),hint(phone),evidence,consentAt,this.scope.subject,now);added++;
        queueIysConsent(this.db,this.scope,this.key,{channel:'MESAJ',recipient:phone,status:'ONAY',source:iysSource,consentDate:`${consentAt}T12:00:00+03:00`,actor:this.scope.subject});
      }
      this.audit('whatsapp.contacts.add');return {added,existing,snapshot:this.read()};
    }).immediate();
  }
  // Opting out is permanent for that number in this project; pending messages to it are skipped.
  optOut(raw:Record<string,unknown>){
    this.authorize('recipients.manage');
    return this.db.transaction(()=>{const now=new Date().toISOString(),changed=this.db.prepare("UPDATE platform_whatsapp_contacts SET opted_out_at=COALESCE(opted_out_at,?),opt_out_source=COALESCE(opt_out_source,'team') WHERE id=? AND organization_id=? AND project_id=?").run(now,raw.id,...this.args()).changes;if(!changed)throw new MarketingStoreError('Kişi bulunamadı.',404);
      const row=this.db.prepare('SELECT id,phone_encrypted FROM platform_whatsapp_contacts WHERE id=?').get(raw.id) as {id:string;phone_encrypted:string};
      queueIysConsent(this.db,this.scope,this.key,{channel:'MESAJ',recipient:this.phone(row.id,row.phone_encrypted),status:'RET',source:'HS_WEB',consentDate:now,actor:this.scope.subject});
      this.db.prepare("UPDATE platform_whatsapp_messages SET state='skipped',reason='opted_out',finished_at=? WHERE contact_id=? AND state='pending'").run(now,raw.id);this.audit('whatsapp.contact.opt_out');return this.read();}).immediate();
  }
  removeContact(raw:Record<string,unknown>){
    this.authorize('recipients.manage');
    return this.db.transaction(()=>{const now=new Date().toISOString(),old=this.db.prepare('SELECT phone_hash,opted_out_at,opt_out_source FROM platform_whatsapp_contacts WHERE id=? AND organization_id=? AND project_id=?').get(raw.id,...this.args()) as {phone_hash:string;opted_out_at:string|null;opt_out_source:'team'|'reply'|null}|undefined;
      if(old?.opted_out_at)this.db.prepare('INSERT OR IGNORE INTO platform_whatsapp_suppressions VALUES(?,?,?,?,?)').run(...this.args(),old.phone_hash,old.opt_out_source||'team',old.opted_out_at);
      const changed=this.db.prepare('DELETE FROM platform_whatsapp_contacts WHERE id=? AND organization_id=? AND project_id=?').run(raw.id,...this.args()).changes;if(!changed)throw new MarketingStoreError('Kişi bulunamadı.',404);
      this.db.prepare("UPDATE platform_whatsapp_messages SET state='skipped',reason='removed',finished_at=? WHERE contact_id=? AND state='pending'").run(now,raw.id);this.audit('whatsapp.contact.remove');return this.read();}).immediate();
  }
  // A batch is one approved template, its fixed variables and up to 20 consented contacts. Any edit clears the approval.
  saveBatch(raw:Record<string,unknown>){
    this.authorize('content.write');const {connection}=this.credentials();
    const name=clean(raw.name,80),language=clean(raw.templateLanguage,10),templateName=clean(raw.templateName,512);if(!name)throw new MarketingStoreError('Gönderi adı gerekli.');
    const template=this.templates(connection.id).find(item=>item.name===templateName&&item.language===language);if(!template)throw new MarketingStoreError('Onaylı bir WhatsApp şablonu seçin.',409);
    const params=(Array.isArray(raw.params)?raw.params:[]).map(param);if(params.length!==template.params)throw new MarketingStoreError(`Bu şablon ${template.params} değişken bekliyor.`);
    const contactIds=[...new Set((Array.isArray(raw.contactIds)?raw.contactIds:[]).filter((item):item is string=>typeof item==='string'))].sort();
    if(!contactIds.length||contactIds.length>WHATSAPP_LIMITS.batchRecipients)throw new MarketingStoreError(`Bir gönderide 1–${WHATSAPP_LIMITS.batchRecipients} kişi seçin.`);
    if(contactIds.some(id=>!this.sendable(id)))throw new MarketingStoreError('Seçilen kişilerden biri bulunamadı veya izinden çıktı.',409);
    // Per-recipient values: an empty value keeps the batch's own value for that variable.
    const rawOverrides=raw.overrides&&typeof raw.overrides==='object'?raw.overrides as Record<string,unknown>:{},overrides:Record<string,string[]>={};
    for(const contactId of contactIds){const list=rawOverrides[contactId];if(!Array.isArray(list)||!list.some(item=>typeof item==='string'&&item.trim()))continue;if(list.length!==template.params)throw new MarketingStoreError(`Bu şablon ${template.params} değişken bekliyor.`);overrides[contactId]=list.map(item=>typeof item==='string'&&item.trim()?param(item):'');}
    const rawExtras=raw.extras&&typeof raw.extras==='object'?raw.extras as Record<string,unknown>:{},extras:WhatsAppBatchExtras={};
    if(['IMAGE','VIDEO','DOCUMENT'].includes(template.headerFormat))extras.headerLink=mediaLink(rawExtras.headerLink);
    if(template.buttonUrl)extras.buttonParam=buttonParam(rawExtras.buttonParam);
    const digest=batchDigest(connection.id,template,params,contactIds,overrides,extras);
    return this.db.transaction(()=>{
      this.authorize('content.write');const now=new Date().toISOString();
      if(raw.id===undefined){
        if((this.db.prepare("SELECT COUNT(*) n FROM platform_whatsapp_batches WHERE organization_id=? AND project_id=? AND state IN ('draft','approved')").get(...this.args()) as {n:number}).n>=WHATSAPP_LIMITS.batches)throw new MarketingStoreError('Taslak gönderi sınırına ulaşıldı.',429);
        this.db.prepare("INSERT INTO platform_whatsapp_batches(id,organization_id,project_id,connection_id,name,template_name,template_language,params_json,overrides_json,extras_json,contacts_json,digest,state,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)").run(`wabatch_${randomUUID()}`,...this.args(),connection.id,name,templateName,language,JSON.stringify(params),JSON.stringify(overrides),JSON.stringify(extras),JSON.stringify(contactIds),digest,this.scope.subject,now,now);
      }else{
        const row=this.batch(raw.id);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Gönderi başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
        if(!['draft','approved'].includes(row.state))throw new MarketingStoreError('Kuyruğa alınmış bir gönderi değiştirilemez.',409);
        this.db.prepare("UPDATE platform_whatsapp_batches SET connection_id=?,name=?,template_name=?,template_language=?,params_json=?,overrides_json=?,extras_json=?,contacts_json=?,digest=?,state='draft',approved_by=NULL,approved_digest=NULL,approved_at=NULL,revision=revision+1,updated_at=? WHERE id=?").run(connection.id,name,templateName,language,JSON.stringify(params),JSON.stringify(overrides),JSON.stringify(extras),JSON.stringify(contactIds),digest,now,row.id);
      }
      this.audit('whatsapp.batch.save');return this.read();
    }).immediate();
  }
  approve(raw:Record<string,unknown>){
    this.authorize('campaign.approve');
    return this.db.transaction(()=>{const row=this.batch(raw.id);if(row.state!=='draft'||raw.expectedDigest!==row.digest)throw new MarketingStoreError('Gönderi değişti veya onaylanacak durumda değil. Yenileyip tekrar inceleyin.',409);
      this.db.prepare("UPDATE platform_whatsapp_batches SET state='approved',approved_by=?,approved_digest=digest,approved_at=?,revision=revision+1,updated_at=? WHERE id=?").run(this.scope.subject,new Date().toISOString(),new Date().toISOString(),row.id);this.audit('whatsapp.batch.approve');return this.read();}).immediate();
  }
  // Rehearsal checks every message without contacting WhatsApp. A real send needs the switch, the publish duty and an acknowledgement.
  queue(raw:Record<string,unknown>){
    const mode=raw.mode==='send'?'send':raw.mode==='rehearsal'?'rehearsal':null;if(!mode)throw new MarketingStoreError('Geçersiz gönderim türü.');
    this.authorize(mode==='send'?'publish':'campaign.dispatch');
    if(mode==='send'&&(!whatsAppSendEnabled()||raw.acknowledged!==true))throw new MarketingStoreError('Gerçek WhatsApp gönderimi bu sunucuda kapalı veya açık onay verilmedi.',409);
    const iys=mode==='send'?iysSendBlock(this.db,this.scope):null;if(iys)throw new MarketingStoreError(iys,409);
    return this.db.transaction(()=>{
      this.authorize(mode==='send'?'publish':'campaign.dispatch');const row=this.batch(raw.id),now=new Date().toISOString(),contacts=JSON.parse(row.contacts_json) as string[];
      if(row.state!=='approved'||row.approved_digest!==row.digest||raw.expectedDigest!==row.digest)throw new MarketingStoreError('Yalnız değişmemiş, onaylı gönderiler kuyruğa alınabilir.',409);
      if(row.connection_id!==this.connection()?.id)throw new MarketingStoreError('WhatsApp numarası değişti. Gönderiyi yeniden hazırlayın.',409);
      if(mode==='send'&&this.sentToday()+contacts.length>WHATSAPP_LIMITS.sendsPerDay)throw new MarketingStoreError(`Günlük WhatsApp gönderim sınırı (${WHATSAPP_LIMITS.sendsPerDay}) aşılır.`,429);
      this.db.prepare("UPDATE platform_whatsapp_batches SET state='queued',mode=?,queued_by=?,queued_at=?,revision=revision+1,updated_at=? WHERE id=?").run(mode,this.scope.subject,now,now,row.id);
      for(const contactId of contacts)this.db.prepare("INSERT INTO platform_whatsapp_messages(batch_id,contact_id,state) VALUES(?,?,'pending')").run(row.id,contactId);
      this.audit(mode==='send'?'whatsapp.batch.queue_send':'whatsapp.batch.queue_rehearsal');return this.read();
    }).immediate();
  }
  cancel(raw:Record<string,unknown>){
    this.authorize('campaign.dispatch');
    return this.db.transaction(()=>{const row=this.batch(raw.id),now=new Date().toISOString();if(['done','cancelled'].includes(row.state))throw new MarketingStoreError('Bu gönderi zaten tamamlandı.',409);
      this.db.prepare("UPDATE platform_whatsapp_messages SET state='skipped',reason='cancelled',finished_at=? WHERE batch_id=? AND state='pending'").run(now,row.id);
      this.db.prepare("UPDATE platform_whatsapp_batches SET state='cancelled',revision=revision+1,updated_at=? WHERE id=?").run(now,row.id);this.audit('whatsapp.batch.cancel');return this.read();}).immediate();
  }
  // Sends (or rehearses) up to `limit` pending messages of a queued batch. Each one is re-checked and marked as submitted
  // before the network call, so an interrupted send is recorded as uncertain and never repeated.
  async process(id:string,limit=10){
    const row=this.batch(id);if(row.state!=='queued')return this.describe(row);
    this.db.prepare("UPDATE platform_whatsapp_messages SET state='uncertain',reason='interrupted',finished_at=? WHERE batch_id=? AND state='submitting' AND submitted_at<?").run(new Date().toISOString(),id,new Date(Date.now()-120000).toISOString());
    for(let i=0;i<limit;i++){
      const claim=this.db.transaction(()=>{
        const batch=this.batch(id),next=this.db.prepare("SELECT contact_id FROM platform_whatsapp_messages WHERE batch_id=? AND state='pending' LIMIT 1").get(id) as {contact_id:string}|undefined;if(batch.state!=='queued'||!next)return null;const now=new Date().toISOString();
        const skip=(reason:string)=>{this.db.prepare("UPDATE platform_whatsapp_messages SET state='skipped',reason=?,finished_at=? WHERE batch_id=? AND contact_id=?").run(reason,now,id,next.contact_id);return 'skipped' as const;};
        const actor=batch.queued_by||'';let allowed=true;try{this.authorize(batch.mode==='send'?'publish':'campaign.dispatch',actor);}catch{allowed=false;}
        const approver=this.db.prepare('SELECT approved_by FROM platform_whatsapp_batches WHERE id=?').get(id) as {approved_by:string|null};
        if(!allowed||batch.approved_digest!==batch.digest||!approver.approved_by||!this.can('campaign.approve',approver.approved_by)||batch.connection_id!==this.connection()?.id)return skip('changed');
        // A template refreshed after approval must still have the same body, header kind and button.
        const extras=JSON.parse(batch.extras_json||'{}') as WhatsAppBatchExtras,template=this.templates(batch.connection_id).find(item=>item.name===batch.template_name&&item.language===batch.template_language);
        if(!template||batchDigest(batch.connection_id,template,JSON.parse(batch.params_json),JSON.parse(batch.contacts_json),JSON.parse(batch.overrides_json||'{}'),extras)!==batch.digest)return skip('changed');
        const contact=this.sendable(next.contact_id);if(!contact)return skip('not_consented');
        if(batch.mode==='rehearsal'){this.db.prepare("UPDATE platform_whatsapp_messages SET state='rehearsed',finished_at=? WHERE batch_id=? AND contact_id=?").run(now,id,next.contact_id);return 'rehearsed' as const;}
        if(!whatsAppSendEnabled())return skip('switch_off');if(this.sentToday()>=WHATSAPP_LIMITS.sendsPerDay)return skip('daily_limit');
        const iys=iysGate(this.db,this.scope,'MESAJ',contact.phone_hash);if(iys)return skip(iys);
        this.db.prepare("UPDATE platform_whatsapp_messages SET state='submitting',submitted_at=? WHERE batch_id=? AND contact_id=?").run(now,id,next.contact_id);
        return {contactId:next.contact_id,phone:this.phone(contact.id,contact.phone_encrypted),batch};
      }).immediate();
      if(!claim)break;if(typeof claim==='string')continue;
      const {credentials}=this.credentials(),base=JSON.parse(claim.batch.params_json) as string[],override=(JSON.parse(claim.batch.overrides_json||'{}') as Record<string,string[]>)[claim.contactId],params=base.map((value,index)=>override?.[index]||value);
      const extras=JSON.parse(claim.batch.extras_json||'{}') as WhatsAppBatchExtras,template=this.templates(claim.batch.connection_id).find(item=>item.name===claim.batch.template_name&&item.language===claim.batch.template_language);
      const components:Record<string,unknown>[]=[];
      if(extras.headerLink&&template&&['IMAGE','VIDEO','DOCUMENT'].includes(template.headerFormat)){const type=template.headerFormat.toLowerCase();components.push({type:'header',parameters:[{type,[type]:{link:extras.headerLink}}]});}
      if(params.length)components.push({type:'body',parameters:params.map(text=>({type:'text',text}))});
      const buttonIndex=extras.buttonParam?this.buttonIndex(claim.batch.connection_id,claim.batch.template_name,claim.batch.template_language):null;
      if(extras.buttonParam&&buttonIndex!==null)components.push({type:'button',sub_type:'url',index:String(buttonIndex),parameters:[{type:'text',text:extras.buttonParam}]});
      let state:WhatsAppMessageState='uncertain',messageId:string|null=null,reason:string|null=null;
      try{
        const result=await this.graph('POST',`${credentials.phoneNumberId}/messages`,credentials.accessToken,{},{messaging_product:'whatsapp',recipient_type:'individual',to:claim.phone.slice(1),type:'template',template:{name:claim.batch.template_name,language:{code:claim.batch.template_language},...(components.length?{components}:{})}});
        const messages=result.payload.messages;const first=Array.isArray(messages)?messages[0] as Record<string,unknown>:undefined;
        if(result.status===200&&typeof first?.id==='string'&&/^[A-Za-z0-9._=:-]{8,200}$/.test(first.id)){state='accepted';messageId=first.id;}
        else if(result.status>=400&&result.status<500){state='rejected';const error=result.payload.error as Record<string,unknown>|undefined;reason=Number.isSafeInteger(error?.code)?`meta_${error!.code}`:`http_${result.status}`;}
        else reason=`http_${result.status}`;
      }catch{reason='network';}
      this.db.prepare('UPDATE platform_whatsapp_messages SET state=?,reason=?,provider_message_id=?,finished_at=? WHERE batch_id=? AND contact_id=?').run(state,reason,messageId,new Date().toISOString(),id,claim.contactId);
    }
    this.db.transaction(()=>{if(!this.db.prepare("SELECT 1 FROM platform_whatsapp_messages WHERE batch_id=? AND state IN ('pending','submitting')").get(id))this.db.prepare("UPDATE platform_whatsapp_batches SET state='done',revision=revision+1,updated_at=? WHERE id=? AND state='queued'").run(new Date().toISOString(),id);}).immediate();
    return this.describe(this.batch(id));
  }
  private hook(connectionId?:string){if(!connectionId)return null;const row=this.db.prepare('SELECT hook_id,created_at,last_event_at FROM platform_whatsapp_hooks WHERE connection_id=? AND organization_id=? AND project_id=?').get(connectionId,...this.args()) as {hook_id:string;created_at:string;last_event_at:string|null}|undefined;
    return row?{callbackPath:`/api/platform/whatsapp/hooks/${row.hook_id}`,createdAt:row.created_at,lastEventAt:row.last_event_at}:null;}
  // Webhook setup: the Meta app secret signs every callback. The verify token is shown once and only its hash is kept.
  setupHooks(raw:Record<string,unknown>){
    this.authorize('connections.manage');const secret=typeof raw.appSecret==='string'?raw.appSecret.trim():'';
    if(!/^[a-f0-9]{32}$/.test(secret))throw new MarketingStoreError('Meta uygulama gizli anahtarı 32 karakterlik onaltılık bir değer olmalı.');
    return this.db.transaction(()=>{
      this.authorize('connections.manage');const {connection}=this.credentials(),hookId=randomBytes(16).toString('hex'),verifyToken=randomBytes(24).toString('base64url'),now=new Date().toISOString();
      this.db.prepare('DELETE FROM platform_whatsapp_hooks WHERE connection_id=?').run(connection.id);
      this.db.prepare('INSERT INTO platform_whatsapp_hooks(hook_id,connection_id,organization_id,project_id,verify_hash,secret_encrypted,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').run(hookId,connection.id,...this.args(),createHash('sha256').update(verifyToken).digest('hex'),encryptCredentials({secret},this.key,...this.args(),`whatsapp-hook:${hookId}`),this.scope.subject,now);
      this.audit('whatsapp.hooks.setup');return {verifyToken,snapshot:this.read()};
    }).immediate();
  }
  async deliver(raw:Record<string,unknown>){this.authorize('campaign.dispatch');const row=this.batch(raw.id);await this.process(row.id);return this.read();}
}

// Worker step: continues queued batches, a few messages per tick, as the person who queued them.
export async function deliverWhatsAppBatches(db:Database.Database,key:string,graph:WhatsAppGraph=whatsAppGraph,limit=2){
  const rows=db.prepare("SELECT id,organization_id,project_id,queued_by FROM platform_whatsapp_batches WHERE state='queued' ORDER BY queued_at LIMIT ?").all(limit) as {id:string;organization_id:string;project_id:string;queued_by:string}[];
  let processed=0;
  for(const row of rows){try{await new ProjectWhatsApp(db,{subject:row.queued_by,organizationId:row.organization_id,projectId:row.project_id},key,graph).process(row.id);processed++;}catch{}}
  return processed;
}

// Signed Meta webhook for one number. GET answers the subscription check; POST records delivery states and opt-outs.
// A stop word opts the contact out and is not stored; any other inbound message goes to the project inbox (masked text,
// hashed sender, encrypted reply address, 90-day retention) so the team can answer it inside the 24-hour window.
const STOP=new Set<string>(WHATSAPP_STOP_WORDS.map(word=>word.toLocaleLowerCase('tr')));
const ORDER:Record<WhatsAppDelivery,number>={sent:1,delivered:2,read:3,failed:4};
export function verifyWhatsAppHook(db:Database.Database,hookId:string,query:URLSearchParams){
  const row=/^[a-f0-9]{32}$/.test(hookId)?db.prepare('SELECT verify_hash FROM platform_whatsapp_hooks WHERE hook_id=?').get(hookId) as {verify_hash:string}|undefined:undefined;
  const token=query.get('hub.verify_token')||'',challenge=query.get('hub.challenge')||'';
  if(!row||query.get('hub.mode')!=='subscribe'||!/^[A-Za-z0-9_-]{1,200}$/.test(challenge))return null;
  const given=Buffer.from(createHash('sha256').update(token).digest('hex')),expected=Buffer.from(row.verify_hash);
  return given.length===expected.length&&timingSafeEqual(given,expected)?challenge:null;
}
export function receiveWhatsAppHook(db:Database.Database,key:string,hookId:string,body:Uint8Array,signature:string|null){
  const row=/^[a-f0-9]{32}$/.test(hookId)?db.prepare('SELECT h.*,c.encrypted_credentials,c.active,c.account_name,c.integration_id FROM platform_whatsapp_hooks h JOIN platform_connections c ON c.id=h.connection_id WHERE h.hook_id=?').get(hookId) as {hook_id:string;connection_id:string;organization_id:string;project_id:string;secret_encrypted:string;encrypted_credentials:string;active:number;account_name:string;integration_id:string}|undefined:undefined;
  if(!row||row.active!==1)throw new MarketingStoreError('Bilinmeyen WhatsApp bildirimi.',404);
  const {secret}=decryptCredentials<{secret:string}>(row.secret_encrypted,key,row.organization_id,row.project_id,`whatsapp-hook:${row.hook_id}`);
  const expected=Buffer.from(`sha256=${createHmac('sha256',secret).update(body).digest('hex')}`),given=Buffer.from(signature||'');
  if(given.length!==expected.length||!timingSafeEqual(given,expected))throw new MarketingStoreError('WhatsApp bildirim imzası doğrulanamadı.',401);
  const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)) as Record<string,unknown>;
  const phoneNumberId=decryptCredentials<{phoneNumberId:string}>(row.encrypted_credentials,key,row.organization_id,row.project_id,row.connection_id).phoneNumberId;
  let statuses=0,optOuts=0,inbound=0;
  db.transaction(()=>{
    const received:WhatsAppInbound[]=[];
    const now=new Date().toISOString();
    for(const entry of Array.isArray(payload.entry)?payload.entry as Record<string,unknown>[]:[])for(const change of Array.isArray(entry.changes)?entry.changes as Record<string,unknown>[]:[]){
      const value=change.value as Record<string,unknown>|undefined,metadata=value?.metadata as Record<string,unknown>|undefined;
      if(change.field!=='messages'||!value||metadata?.phone_number_id!==phoneNumberId)continue;
      for(const status of Array.isArray(value.statuses)?value.statuses as Record<string,unknown>[]:[]){
        const state=status.status as WhatsAppDelivery,id=status.id;if(typeof id!=='string'||!Object.hasOwn(ORDER,state))continue;
        const at=Number.isFinite(Number(status.timestamp))?new Date(Number(status.timestamp)*1000).toISOString():now;
        // States only move forward (sent → delivered → read); a failure is final.
        statuses+=db.prepare("UPDATE platform_whatsapp_messages SET delivery=?,delivery_at=? WHERE provider_message_id=? AND batch_id IN (SELECT id FROM platform_whatsapp_batches WHERE organization_id=? AND project_id=?) AND (delivery IS NULL OR CASE delivery WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 4 END<?)").run(state,at,id,row.organization_id,row.project_id,ORDER[state]).changes;
      }
      for(const message of Array.isArray(value.messages)?value.messages as Record<string,unknown>[]:[]){
        const from=typeof message.from==='string'&&/^[1-9]\d{7,14}$/.test(message.from)?`+${message.from}`:null;
        const raw=(message.text as Record<string,unknown>|undefined)?.body??(message.button as Record<string,unknown>|undefined)?.text??'';
        const text=String(raw).trim().toLocaleLowerCase('tr').replace(/[.!]+$/,'');
        if(!from)continue;
        if(!STOP.has(text)){const item=whatsAppInboundFrom(message);if(item)received.push(item);continue;}
        const hash=createHmac('sha256',Buffer.from(key,'hex')).update(`whatsapp:${row.organization_id}:${row.project_id}:${from}`).digest('hex');
        const contact=db.prepare('SELECT id FROM platform_whatsapp_contacts WHERE organization_id=? AND project_id=? AND phone_hash=? AND opted_out_at IS NULL').get(row.organization_id,row.project_id,hash) as {id:string}|undefined;
        if(!contact)continue;
        db.prepare("UPDATE platform_whatsapp_contacts SET opted_out_at=?,opt_out_source='reply' WHERE id=?").run(now,contact.id);
        queueIysConsent(db,{organizationId:row.organization_id,projectId:row.project_id},key,{channel:'MESAJ',recipient:from,status:'RET',source:'HS_MESAJ',consentDate:now,actor:'whatsapp-reply'});
        db.prepare("UPDATE platform_whatsapp_messages SET state='skipped',reason='opted_out',finished_at=? WHERE contact_id=? AND state='pending'").run(now,contact.id);optOuts++;
      }
    }
    inbound=ingestWhatsAppInbound(db,key,{id:row.connection_id,organization_id:row.organization_id,project_id:row.project_id,account_name:row.account_name,encrypted_credentials:row.encrypted_credentials,integration_id:row.integration_id},received.slice(0,INBOX_LIMITS.hookEntries));
    db.prepare('UPDATE platform_whatsapp_hooks SET last_event_at=? WHERE hook_id=?').run(now,row.hook_id);
    if(statuses||optOuts)db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run('whatsapp-webhook',row.organization_id,row.project_id,optOuts?'whatsapp.hook.opt_out':'whatsapp.hook.status',now);
    if(inbound)db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run('whatsapp-webhook',row.organization_id,row.project_id,'whatsapp.hook.inbound',now);
  }).immediate();
  return {statuses,optOuts,inbound};
}
// The numbers a live batch could reach (not opted out), for an İYS status query.
export function whatsAppContactPhones(db:Database.Database,scope:{organizationId:string;projectId:string},key:string){
  return (db.prepare('SELECT id,phone_encrypted FROM platform_whatsapp_contacts WHERE organization_id=? AND project_id=? AND opted_out_at IS NULL').all(scope.organizationId,scope.projectId) as {id:string;phone_encrypted:string}[])
    .map(row=>decryptCredentials<{phone:string}>(row.phone_encrypted,key,scope.organizationId,scope.projectId,`whatsapp-contact:${row.id}`).phone);
}
