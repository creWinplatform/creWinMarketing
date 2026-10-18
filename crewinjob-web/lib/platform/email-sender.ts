import 'server-only';
import {createHash,randomBytes} from 'node:crypto';
import type Database from 'better-sqlite3';
import {PlatformRepository} from './repository';
import {MarketingStoreError,type MarketingScope} from './marketing-store';
import {decryptCredentials,encryptCredentials,type StoredCredentials} from './credential-envelope';
import {normalizeSmtpConfiguration} from './email-configuration';
import {emailAddress,emailIdentity,maskEmail,bumpSafety,type EmailScope} from './email-safety';
import {checkSenderDomain,domainRecordName,senderDomain} from './email-domain';
import {EMAIL_PILOT_LIMITS,type SenderReadiness,type SenderWorkspace,type PilotRecipientCounts} from './email-sender-types';

type SenderRow={organization_id:string;project_id:string;connection_id:string;connection_revision:string;domain:string;masked_sender:string;max_recipients:number;revision:number;manager_id:string;challenge_hash:string;encrypted_challenge:string;challenge_expires_at:string;verified_at:string|null;checked_at:string|null;last_error:string};
type Connection={id:string;account_name:string;active:number;provider:string;encrypted_credentials:string};
const args=(scope:EmailScope)=>[scope.organizationId,scope.projectId] as const;
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const manager=(db:Database.Database,scope:EmailScope,subject:string)=>{const repo=new PlatformRepository(db);return repo.can(subject,...args(scope),'connections.manage')&&repo.can(subject,...args(scope),'recipients.manage');};
const senderRow=(db:Database.Database,scope:EmailScope)=>db.prepare('SELECT * FROM platform_email_sender WHERE organization_id=? AND project_id=?').get(...args(scope)) as SenderRow|undefined;
function pilotRows(db:Database.Database,scope:EmailScope){return (db.prepare('SELECT email_key,masked_email,updated_at,granted_by FROM platform_email_pilot_allowlist WHERE organization_id=? AND project_id=? AND active=1 ORDER BY updated_at DESC,email_key LIMIT 21').all(...args(scope)) as {email_key:string;masked_email:string;updated_at:string;granted_by:string}[]).filter(row=>manager(db,scope,row.granted_by));}
export function emailSenderReadiness(db:Database.Database,scope:EmailScope):SenderReadiness{
  const row=senderRow(db,scope),base:SenderReadiness={connectionId:row?.connection_id||null,domain:row?.domain||null,maskedSender:row?.masked_sender||null,revision:row?.revision||0,bindingRevision:'',maxRecipients:row?.max_recipients||null,smtpReady:false,ownership:'not_configured',verifiedAt:null,ownershipExpiresAt:null,activePilotAddresses:pilotRows(db,scope).length};
  if(!row)return base;
  const connection=db.prepare("SELECT * FROM platform_connections WHERE id=? AND organization_id=? AND project_id=? AND provider='email'").get(row.connection_id,...args(scope)) as Connection|undefined;
  const current=connection?.encrypted_credentials?hash(connection.encrypted_credentials):'';
  base.bindingRevision=`${row.connection_revision}:${current}`;
  if(!connection?.active){base.ownership='inactive';return base;}
  if(current!==row.connection_revision){base.ownership='connection_changed';return base;}
  if(!manager(db,scope,row.manager_id)){base.ownership='authority_lost';return base;}
  const check=db.prepare('SELECT revision,status,checked_at FROM platform_connection_checks WHERE connection_id=?').get(connection.id) as {revision:string;status:string;checked_at:string}|undefined;
  base.smtpReady=Boolean(check&&check.revision===current&&check.status==='verified'&&Date.now()-Date.parse(check.checked_at)<3600000&&Date.parse(check.checked_at)<=Date.now());
  const expiry=row.verified_at?Math.min(Date.parse(row.challenge_expires_at),Date.parse(row.verified_at)+EMAIL_PILOT_LIMITS.ownershipHours*3600000):NaN;
  base.verifiedAt=row.verified_at;base.ownershipExpiresAt=Number.isFinite(expiry)?new Date(expiry).toISOString():null;
  base.ownership=row.verified_at&&expiry>Date.now()&&Date.parse(row.verified_at)<=Date.now()?'verified':row.verified_at||Date.parse(row.challenge_expires_at)<=Date.now()?'expired':'pending';
  return base;
}
export function emailPilotCounts(db:Database.Database,scope:EmailScope,eligibleEmailKeys:string[]):PilotRecipientCounts{
  const policy=emailSenderReadiness(db,scope),allowedKeys=new Set(pilotRows(db,scope).map(row=>row.email_key)),unique=new Set(eligibleEmailKeys),allowed=[...unique].filter(key=>allowedKeys.has(key)).length;
  return {allowed,planned:policy.maxRecipients?Math.min(allowed,policy.maxRecipients):0,notAllowlisted:unique.size-allowed,maxRecipients:policy.maxRecipients};
}
export class EmailSenders {
  constructor(private db:Database.Database,private scope:MarketingScope,private key:string){}
  private args(){return args(this.scope);}
  private authorize(){if(!manager(this.db,this.scope,this.scope.subject)||new PlatformRepository(this.db).workspace(this.scope.subject,...this.args())?.project.productPack!=='standard')throw new MarketingStoreError('Standart proje gönderen yönetimi için sahip veya yönetici yetkisi gerekli.',403);}
  private connection(id:string){const row=this.db.prepare("SELECT * FROM platform_connections WHERE id=? AND organization_id=? AND project_id=? AND provider='email' AND active=1").get(id,...this.args()) as Connection|undefined;if(!row)throw new MarketingStoreError('Etkin proje SMTP bağlantısı bulunamadı.',404);return row;}
  private smtp(connection:Connection){
    try{const credentials=decryptCredentials<StoredCredentials>(connection.encrypted_credentials,this.key,...this.args(),connection.id),smtp=normalizeSmtpConfiguration(credentials.smtp),address=emailAddress(smtp.fromEmail);if(!address)throw new Error();return {domain:senderDomain(address.split('@')[1]),maskedSender:maskEmail(address)};}
    catch{throw new MarketingStoreError('SMTP gönderen ayarları eksik veya okunamadı. Bağlantıyı yeniden kaydedin.',409);}
  }
  private current(expected:number){const row=senderRow(this.db,this.scope);if(!Number.isSafeInteger(expected)||(row?.revision||0)!==expected)throw new MarketingStoreError('Gönderen veya pilot ayarları değişti. Ekranı yenileyin.',409);return row;}
  get():SenderWorkspace{
    this.authorize();const row=senderRow(this.db,this.scope),readiness=emailSenderReadiness(this.db,this.scope);
    const connections=(this.db.prepare("SELECT * FROM platform_connections WHERE organization_id=? AND project_id=? AND provider='email' AND active=1 ORDER BY account_name LIMIT 50").all(...this.args()) as Connection[]).map(connection=>{
      let info:{domain:string;maskedSender:string}|null=null;try{info=this.smtp(connection);}catch{}
      const check=this.db.prepare('SELECT revision,status,checked_at FROM platform_connection_checks WHERE connection_id=?').get(connection.id) as {revision:string;status:string;checked_at:string}|undefined;
      return {id:connection.id,name:connection.account_name,domain:info?.domain||null,maskedSender:info?.maskedSender||null,configured:Boolean(info),smtpReady:Boolean(check?.status==='verified'&&check.revision===hash(connection.encrypted_credentials)&&Date.now()-Date.parse(check.checked_at)<3600000&&Date.parse(check.checked_at)<=Date.now())};
    });
    let dnsRecord:SenderWorkspace['dnsRecord']=null;
    if(row?.encrypted_challenge&&['pending','expired','verified'].includes(readiness.ownership))try{const challenge=decryptCredentials<{value:string}>(row.encrypted_challenge,this.key,...this.args(),'email-domain');if(hash(challenge.value)!==row.challenge_hash)throw new Error();dnsRecord={type:'TXT',name:domainRecordName(row.domain),value:challenge.value,expiresAt:row.challenge_expires_at};}catch{throw new MarketingStoreError('DNS kaydı okunamadı. Göndereni yeniden seçin.',409);}
    return {readiness,connections,dnsRecord,lastCheckedAt:row?.checked_at||null,lastError:row?.last_error||'',allowlist:pilotRows(this.db,this.scope).map(row=>({id:row.email_key,maskedEmail:row.masked_email,updatedAt:row.updated_at})),limits:EMAIL_PILOT_LIMITS,sendingEnabled:false,authentication:'not_verified'};
  }
  select(input:{connectionId:string;maxRecipients:number;expectedRevision:number}){
    this.authorize();if(!Number.isSafeInteger(input.maxRecipients)||input.maxRecipients<1||input.maxRecipients>EMAIL_PILOT_LIMITS.maxRecipients)throw new MarketingStoreError('Pilot başına alıcı sayısı 1-5 arasında olmalı.');
    this.consume('email_sender_change',EMAIL_PILOT_LIMITS.changesPerDay);
    return this.db.transaction(()=>{
      this.authorize();const old=this.current(input.expectedRevision),connection=this.connection(input.connectionId),info=this.smtp(connection),revision=hash(connection.encrypted_credentials);
      if(old?.connection_id===connection.id&&old.connection_revision===revision&&manager(this.db,this.scope,old.manager_id)&&old.challenge_hash){
        if(old.max_recipients!==input.maxRecipients){this.db.prepare('UPDATE platform_email_sender SET max_recipients=?,revision=revision+1,updated_at=? WHERE organization_id=? AND project_id=?').run(input.maxRecipients,new Date().toISOString(),...this.args());bumpSafety(this.db,this.scope);this.audit('sender.pilot_limit');}return this.get();
      }
      this.writeChallenge(connection.id,revision,info,input.maxRecipients,(old?.revision||0)+1);this.audit('sender.select');return this.get();
    })();
  }
  renew(expectedRevision:number){
    this.authorize();this.consume('email_sender_change',EMAIL_PILOT_LIMITS.changesPerDay);return this.db.transaction(()=>{
      this.authorize();const old=this.current(expectedRevision);if(!old)throw new MarketingStoreError('Önce gönderen seçin.',409);const connection=this.connection(old.connection_id);this.writeChallenge(connection.id,hash(connection.encrypted_credentials),this.smtp(connection),old.max_recipients,old.revision+1);this.audit('sender.challenge');return this.get();
    })();
  }
  private writeChallenge(connectionId:string,revision:string,info:{domain:string;maskedSender:string},maximum:number,version:number){
    const value=`ryzevo-verify=v1.${randomBytes(32).toString('base64url')}`,encrypted=encryptCredentials({value},this.key,...this.args(),'email-domain'),now=new Date().toISOString(),expires=new Date(Date.now()+EMAIL_PILOT_LIMITS.challengeDays*86400000).toISOString();
    this.db.prepare(`INSERT INTO platform_email_sender VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,'',?) ON CONFLICT(organization_id,project_id) DO UPDATE SET connection_id=excluded.connection_id,connection_revision=excluded.connection_revision,domain=excluded.domain,masked_sender=excluded.masked_sender,max_recipients=excluded.max_recipients,revision=excluded.revision,manager_id=excluded.manager_id,challenge_hash=excluded.challenge_hash,encrypted_challenge=excluded.encrypted_challenge,challenge_expires_at=excluded.challenge_expires_at,verified_at=NULL,checked_at=NULL,last_error='',updated_at=excluded.updated_at`).run(...this.args(),connectionId,revision,info.domain,info.maskedSender,maximum,version,this.scope.subject,hash(value),encrypted,expires,now);bumpSafety(this.db,this.scope);
  }
  async verify(expectedRevision:number,check:typeof checkSenderDomain=checkSenderDomain){
    this.authorize();this.consume('email_domain_check',EMAIL_PILOT_LIMITS.dnsChecksPerDay);const row=this.current(expectedRevision),state=emailSenderReadiness(this.db,this.scope);
    if(!row||!['pending','expired','verified'].includes(state.ownership)||!row.challenge_hash||Date.parse(row.challenge_expires_at)<=Date.now())throw new MarketingStoreError('Geçerli DNS kaydı gerekli. Göndereni veya DNS değerini yenileyin.',409);
    const outcome=await check(row.domain,row.challenge_hash);
    return this.db.transaction(()=>{
      this.authorize();const latest=this.current(expectedRevision),connection=this.connection(row.connection_id);
      if(!latest||latest.challenge_hash!==row.challenge_hash||hash(connection.encrypted_credentials)!==row.connection_revision||Date.parse(row.challenge_expires_at)<=Date.now()||!manager(this.db,this.scope,row.manager_id))throw new MarketingStoreError('Kontrol sırasında gönderen ayarları veya yetkisi değişti.',409);
      const now=new Date().toISOString();this.db.prepare('UPDATE platform_email_sender SET verified_at=?,checked_at=?,last_error=?,revision=revision+1,updated_at=? WHERE organization_id=? AND project_id=?').run(outcome.verified?now:null,now,outcome.error,now,...this.args());bumpSafety(this.db,this.scope);this.audit(outcome.verified?'sender.domain_verified':'sender.domain_failed');return this.get();
    })();
  }
  allow(input:{email:string;expectedRevision:number;acknowledged:boolean}){
    this.authorize();const email=emailAddress(input.email);if(!email||input.acknowledged!==true)throw new MarketingStoreError('Geçerli pilot adresi ve açık onay gerekli.');
    this.consume('email_sender_change',EMAIL_PILOT_LIMITS.changesPerDay);return this.db.transaction(()=>{
      this.authorize();if(!this.current(input.expectedRevision))throw new MarketingStoreError('Önce gönderen seçin.',409);
      const key=emailIdentity(this.scope,this.key,'email',[email]);if(this.db.prepare('SELECT 1 FROM platform_email_blocks WHERE organization_id=? AND project_id=? AND email_key=?').get(...this.args(),key))throw new MarketingStoreError('Bu adres engelleme listesinde. Pilot listesi engeli kaldıramaz.',409);
      const existing=this.db.prepare('SELECT active,granted_by FROM platform_email_pilot_allowlist WHERE organization_id=? AND project_id=? AND email_key=?').get(...this.args(),key) as {active:number;granted_by:string}|undefined;
      if(existing?.active&&manager(this.db,this.scope,existing.granted_by))return this.get();
      const total=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_email_pilot_allowlist WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n;
      if(pilotRows(this.db,this.scope).length>=EMAIL_PILOT_LIMITS.activeAddresses||!existing&&total>=EMAIL_PILOT_LIMITS.storedAddresses)throw new MarketingStoreError('Pilot adresi sınırına ulaşıldı.',429);
      this.db.prepare('INSERT INTO platform_email_pilot_allowlist VALUES(?,?,?,?,1,?,?) ON CONFLICT(organization_id,project_id,email_key) DO UPDATE SET active=1,granted_by=excluded.granted_by,updated_at=excluded.updated_at').run(...this.args(),key,maskEmail(email),this.scope.subject,new Date().toISOString());this.changed('sender.allowlist.add');return this.get();
    })();
  }
  remove(input:{id:string;expectedRevision:number}){
    this.authorize();if(typeof input.id!=='string'||!/^[a-f0-9]{64}$/.test(input.id))throw new MarketingStoreError('Geçerli pilot adresi kaydı gerekli.');
    this.consume('email_sender_change',EMAIL_PILOT_LIMITS.changesPerDay);return this.db.transaction(()=>{
      this.authorize();this.current(input.expectedRevision);const changed=this.db.prepare('UPDATE platform_email_pilot_allowlist SET active=0,updated_at=? WHERE organization_id=? AND project_id=? AND email_key=? AND active=1').run(new Date().toISOString(),...this.args(),input.id).changes;
      if(!changed)throw new MarketingStoreError('Etkin pilot adresi bulunamadı.',404);this.changed('sender.allowlist.remove');return this.get();
    })();
  }
  private changed(operation:string){this.db.prepare('UPDATE platform_email_sender SET revision=revision+1,updated_at=? WHERE organization_id=? AND project_id=?').run(new Date().toISOString(),...this.args());bumpSafety(this.db,this.scope);this.audit(operation);}
  private consume(resource:string,maximum:number){this.db.transaction(()=>{const day=new Date().toISOString().slice(0,10),used=this.db.prepare('SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource=?').get(...this.args(),day,resource) as {count:number}|undefined;if((used?.count||0)>=maximum)throw new MarketingStoreError('Günlük gönderen kontrol sınırına ulaşıldı.',429);this.db.prepare('INSERT INTO platform_usage VALUES(?,?,?,?,1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1').run(...this.args(),day,resource);})();}
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
}
