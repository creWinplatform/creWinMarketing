import 'server-only';
import type Database from 'better-sqlite3';
import {PlatformRepository} from './repository';
import {MarketingStoreError,type MarketingScope} from './marketing-store';
import {ProductSegments} from './segments';
import type {SegmentEntity} from './segment-engine';
import {encryptCredentials} from './credential-envelope';
import {emailAddress,emailIdentity,maskEmail,safetyRevision,bumpSafety,blockEmail,blockEntity,recordEmailOptOut,newUnsubscribeToken} from './email-safety';
import type {EmailMapping,RecipientContact,RecipientWorkspace,EmailEligibility} from './email-recipient-types';

type RecordRow={external_id:string;attributes_json:string};
type ConsentRow={id:number;decision:RecipientContact['consent'];actor_id:string};
export type EligibleEmailRecipient={email:string;emailKey:string;entityKey:string;contactKey:string;maskedEmail:string};
export class EmailRecipients {
  constructor(private db:Database.Database,private scope:MarketingScope,private key:string){}
  private args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private repo(){return new PlatformRepository(this.db);}
  private authorize(){if(!this.repo().can(this.scope.subject,...this.args(),'recipients.manage')||this.repo().workspace(this.scope.subject,...this.args())?.project.productPack!=='standard')throw new MarketingStoreError('Alıcı yönetimi için proje sahibi veya yönetici yetkisi gerekli.',403);}
  mapping(sourceId:string):EmailMapping|null{
    const row=this.db.prepare('SELECT source_id AS sourceId,source_version AS sourceVersion,field,revision FROM platform_email_mappings WHERE source_id=? AND organization_id=? AND project_id=?').get(sourceId,...this.args()) as EmailMapping|undefined;return row||null;
  }
  private source(id:string){const source=new ProductSegments(this.db,this.scope).sources().find(item=>item.id===id);if(!source)throw new MarketingStoreError('Proje kaynağı bulunamadı.',404);return source;}
  private records(sourceId:string,version:number):RecordRow[]{
    const budget=this.db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(LENGTH(CAST(attributes_json AS BLOB))),0) AS bytes FROM platform_product_records WHERE connection_id=? AND version=? AND organization_id=? AND project_id=?').get(sourceId,version,...this.args()) as {n:number;bytes:number};
    if(budget.n>10000||budget.bytes>8*1024*1024)throw new MarketingStoreError('Alıcı inceleme sınırı aşıldı (10.000 kayıt / 8 MB).',429);
    return this.db.prepare('SELECT external_id,attributes_json FROM platform_product_records WHERE connection_id=? AND version=? AND organization_id=? AND project_id=? ORDER BY external_id LIMIT 10001').all(sourceId,version,...this.args()) as RecordRow[];
  }
  private identity(mapping:EmailMapping,id:string,attributes:Record<string,unknown>){
    const email=emailAddress(attributes[mapping.field]),emailKey=email?emailIdentity(this.scope,this.key,'email',[email]):'',entityKey=emailIdentity(this.scope,this.key,'entity',[mapping.sourceId,id]);
    return {email,emailKey,entityKey,contactKey:emailIdentity(this.scope,this.key,'contact',[mapping.sourceId,mapping.sourceVersion,mapping.revision,id,email||null])};
  }
  private consent(contactKey:string){return this.db.prepare('SELECT id,decision,actor_id FROM platform_email_consents WHERE organization_id=? AND project_id=? AND contact_key=? ORDER BY id DESC LIMIT 1').get(...this.args(),contactKey) as ConsentRow|undefined;}
  private blocked(sourceId:string,entityKey:string,emailKey:string){return Boolean(this.db.prepare('SELECT 1 FROM platform_email_entity_blocks WHERE organization_id=? AND project_id=? AND source_id=? AND entity_key=?').get(...this.args(),sourceId,entityKey)||emailKey&&this.db.prepare('SELECT 1 FROM platform_email_blocks WHERE organization_id=? AND project_id=? AND email_key=?').get(...this.args(),emailKey));}
  private contact(mapping:EmailMapping,row:RecordRow):RecipientContact{
    const identity=this.identity(mapping,row.external_id,JSON.parse(row.attributes_json)),consent=this.consent(identity.contactKey);
    const claim=this.db.prepare("SELECT consent_json FROM platform_product_events WHERE connection_id=? AND organization_id=? AND project_id=? AND entity_id=? AND consent_json IS NOT NULL ORDER BY occurred_at DESC,event_id DESC LIMIT 1").get(mapping.sourceId,...this.args(),row.external_id) as {consent_json:string}|undefined;
    const status=consent?.decision==='reviewed'&&!this.repo().can(consent.actor_id,...this.args(),'recipients.manage')?'revoked':consent?.decision||'unknown';
    return {key:identity.contactKey,maskedId:`...${row.external_id.slice(-4)}`,maskedEmail:identity.email?maskEmail(identity.email):'—',validEmail:Boolean(identity.email),blocked:this.blocked(mapping.sourceId,identity.entityKey,identity.emailKey),consent:status,decisionId:consent?.id||null,reported:claim?JSON.parse(claim.consent_json).status:null};
  }
  list(sourceId='',page=1,blockPage=1):RecipientWorkspace{
    this.authorize();this.page(page);this.page(blockPage);const sources=new ProductSegments(this.db,this.scope).sources(),selected=sourceId?sources.find(item=>item.id===sourceId):sources[0];
    if(sourceId&&!selected)throw new MarketingStoreError('Proje kaynağı bulunamadı.',404);
    const mapping=selected?this.mapping(selected.id):null,records=mapping&&mapping.sourceVersion===selected?.version?this.records(selected.id,selected.version):[];
    const blockTotal=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_email_blocks WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n;
    const blocks=this.db.prepare('SELECT masked_email AS maskedEmail,reason,created_at AS createdAt FROM platform_email_blocks WHERE organization_id=? AND project_id=? ORDER BY created_at DESC,email_key LIMIT 20 OFFSET ?').all(...this.args(),(blockPage-1)*20) as RecipientWorkspace['blocks'];
    return {sources:sources.map(source=>({id:source.id,name:source.name,version:source.version,state:source.state,attributes:source.attributes})),mapping,sourceId:selected?.id||'',contacts:records.slice((page-1)*20,page*20).map(row=>this.contact(mapping!,row)),total:records.length,page,blocks,blockTotal,blockPage,revision:safetyRevision(this.db,this.scope)};
  }
  saveMapping(input:{sourceId:string;sourceVersion:number;field:string;expectedRevision:number|null}){
    this.authorize();return this.db.transaction(()=>{
      const source=this.source(input.sourceId),old=this.mapping(source.id);
      if(source.version!==input.sourceVersion||(old?.revision??null)!==input.expectedRevision)throw new MarketingStoreError('Kaynak veya eşleştirme değişti. Listeyi yenileyin.',409);
      if(!source.attributes.some(field=>field.key===input.field&&field.type==='string'))throw new MarketingStoreError('Kaynak şemasında tanımlı bir metin alanı seçin.');
      if(old?.sourceVersion===source.version&&old.field===input.field)return this.list(source.id);
      const mapping={sourceId:source.id,sourceVersion:source.version,field:input.field,revision:(old?.revision||0)+1};
      this.db.prepare('INSERT INTO platform_email_mappings VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET source_version=excluded.source_version,field=excluded.field,revision=excluded.revision,updated_at=excluded.updated_at').run(source.id,source.version,...this.args(),input.field,mapping.revision,new Date().toISOString());
      // Backfill pre-feature opt-outs before any permission can be reviewed.
      const events=this.db.prepare('SELECT version,entity_id,attributes_json,consent_json FROM platform_product_events WHERE connection_id=? AND organization_id=? AND project_id=? AND consent_json IS NOT NULL LIMIT 10001').all(source.id,...this.args()) as {version:number;entity_id:string;attributes_json:string;consent_json:string}[];
      if(events.length>10000)throw new MarketingStoreError('İzin geçmişi inceleme sınırı aşıldı.',429);
      for(const event of events)if(JSON.parse(event.consent_json).status==='opted_out')recordEmailOptOut(this.db,this.scope,this.key,source.id,event.version,event.entity_id,JSON.parse(event.attributes_json));
      for(const row of this.records(source.id,source.version)){
        const identity=this.identity(mapping,row.external_id,JSON.parse(row.attributes_json));
        if(identity.email&&this.blocked(source.id,identity.entityKey,''))blockEmail(this.db,this.scope,identity.emailKey,maskEmail(identity.email),'reported_opt_out');
      }
      bumpSafety(this.db,this.scope);this.audit('recipient.mapping');return this.list(source.id);
    })();
  }
  private selected(sourceId:string,contactKey:string){
    const source=this.source(sourceId),mapping=this.mapping(sourceId);
    if(source.state!=='active'||!mapping||mapping.sourceVersion!==source.version)throw new MarketingStoreError('Etkin kaynak ve güncel e-posta eşleştirmesi gerekli.',409);
    if(typeof contactKey!=='string'||!/^[a-f0-9]{64}$/.test(contactKey))throw new MarketingStoreError('Geçerli alıcı seçin.');
    for(const row of this.records(sourceId,source.version)){const identity=this.identity(mapping,row.external_id,JSON.parse(row.attributes_json));if(identity.contactKey===contactKey)return {source,mapping,row,identity,contact:this.contact(mapping,row)};}
    throw new MarketingStoreError('Alıcı verisi değişti. Listeyi yenileyin.',409);
  }
  review(input:{sourceId:string;contactKey:string;expectedDecisionId:number|null;decision:'reviewed'|'withdrawn';evidenceRef:string;recordedAt:string;note:string;acknowledged:boolean}){
    this.authorize();this.consume('recipient_review',100);
    return this.db.transaction(()=>{
      const item=this.selected(input.sourceId,input.contactKey);
      if(!item.identity.email)throw new MarketingStoreError('Geçerli e-posta adresi gerekli.');
      if(item.contact.decisionId!==input.expectedDecisionId)throw new MarketingStoreError('İzin kaydı değişti. Listeyi yenileyin.',409);
      if(!['reviewed','withdrawn'].includes(input.decision)||input.acknowledged!==true||typeof input.note!=='string'||!input.note.trim()||input.note.length>1000||/[\x00-\x1f]/.test(input.note))throw new MarketingStoreError('İnceleme notu ve açık onay gerekli.');
      const recordedAt=typeof input.recordedAt==='string'?Date.parse(input.recordedAt):NaN;
      if(input.decision==='reviewed'&&(item.contact.blocked||typeof input.evidenceRef!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/.test(input.evidenceRef)||!Number.isFinite(recordedAt)||recordedAt>Date.now()||recordedAt<Date.UTC(1970,0)))throw new MarketingStoreError('Engellenmemiş alıcı, kanıt referansı ve geçmiş izin tarihi gerekli.');
      const count=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_email_consents WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n;
      if(count>=20000)throw new MarketingStoreError('İzin geçmişi sınırına ulaşıldı.',429);
      const envelope=encryptCredentials({evidenceRef:input.evidenceRef||'',recordedAt:input.recordedAt||'',note:input.note.trim()},this.key,...this.args(),input.contactKey);
      this.db.prepare('INSERT INTO platform_email_consents(organization_id,project_id,contact_key,decision,encrypted_evidence,actor_id,created_at) VALUES(?,?,?,?,?,?,?)').run(...this.args(),input.contactKey,input.decision,envelope,this.scope.subject,new Date().toISOString());
      if(input.decision==='withdrawn'){blockEntity(this.db,this.scope,item.source.id,item.identity.entityKey);blockEmail(this.db,this.scope,item.identity.emailKey,maskEmail(item.identity.email),'consent_withdrawn');}
      bumpSafety(this.db,this.scope);this.audit(`recipient.consent.${input.decision}`);return {saved:true};
    })();
  }
  suppress(input:{email:string;acknowledged:boolean}){
    this.authorize();const email=emailAddress(input.email);if(!email||input.acknowledged!==true)throw new MarketingStoreError('Geçerli adres ve engelleme onayı gerekli.');
    this.consume('recipient_block',100);return this.db.transaction(()=>{blockEmail(this.db,this.scope,emailIdentity(this.scope,this.key,'email',[email]),maskEmail(email),'manual');this.audit('recipient.suppress');return {saved:true};})();
  }
  testLink(sourceId:string,contactKey:string){
    this.authorize();this.consume('recipient_link',20);return this.db.transaction(()=>{
      const item=this.selected(sourceId,contactKey);if(!item.identity.email)throw new MarketingStoreError('Geçerli adres gerekli.');
      const n=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_email_unsubscribe WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n;
      if(n>=1000)throw new MarketingStoreError('Bağlantı saklama sınırına ulaşıldı.',429);
      const link=newUnsubscribeToken(this.db,this.scope,{sourceId,entityKey:item.identity.entityKey,emailKey:item.identity.emailKey,maskedEmail:maskEmail(item.identity.email)});this.audit('recipient.unsubscribe_test');return link;
    })();
  }
  eligibility(sourceId:string,version:number,members:SegmentEntity[],eligibleEmailKeys?:string[],eligibleRecipients?:EligibleEmailRecipient[]):EmailEligibility{
    // Internal only: callers already evaluated the same immutable segment with live access.
    if(!this.repo().can(this.scope.subject,...this.args(),'content.write')||this.repo().workspace(this.scope.subject,...this.args())?.project.productPack!=='standard')throw new MarketingStoreError('Alıcı ön kontrol erişimi gerekli.',403);
    const mapping=this.mapping(sourceId),result:EmailEligibility={matched:members.length,eligible:0,invalid:0,unconsented:0,suppressed:0,duplicates:0,revision:safetyRevision(this.db,this.scope),mappingReady:Boolean(mapping&&mapping.sourceVersion===version)};
    if(!result.mappingReady)return result;
    const groups=new Map<string,{blocked:boolean;permitted:boolean;n:number;recipient:EligibleEmailRecipient}>();
    for(const member of members){
      const identity=this.identity(mapping!,member.id,member.attributes);if(!identity.email){result.invalid++;continue;}
      const consent=this.consent(identity.contactKey),blocked=this.blocked(sourceId,identity.entityKey,identity.emailKey),permitted=consent?.decision==='reviewed'&&this.repo().can(consent.actor_id,...this.args(),'recipients.manage');
      const group=groups.get(identity.emailKey)||{blocked:false,permitted:true,n:0,recipient:{email:identity.email,emailKey:identity.emailKey,entityKey:identity.entityKey,contactKey:identity.contactKey,maskedEmail:maskEmail(identity.email)}};group.n++;group.blocked||=blocked;group.permitted&&=Boolean(permitted);groups.set(identity.emailKey,group);
    }
    for(const [key,group] of groups){result.duplicates+=group.n-1;if(group.blocked)result.suppressed++;else if(!group.permitted)result.unconsented++;else{result.eligible++;eligibleEmailKeys?.push(key);eligibleRecipients?.push(group.recipient);}}
    return result;
  }
  private page(value:number){if(!Number.isSafeInteger(value)||value<1||value>1000)throw new MarketingStoreError('Geçersiz sayfa.');}
  private consume(resource:string,max:number){this.db.transaction(()=>{const day=new Date().toISOString().slice(0,10),used=this.db.prepare('SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource=?').get(...this.args(),day,resource) as {count:number}|undefined;if((used?.count||0)>=max)throw new MarketingStoreError('Günlük alıcı işlemi sınırına ulaşıldı.',429);this.db.prepare('INSERT INTO platform_usage VALUES(?,?,?,?,1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1').run(...this.args(),day,resource);})();}
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
}
