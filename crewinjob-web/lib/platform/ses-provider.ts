import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {SESv2Client,GetAccountCommand,GetEmailIdentityCommand,GetConfigurationSetEventDestinationsCommand} from '@aws-sdk/client-sesv2';
import type Database from 'better-sqlite3';
import {PlatformRepository} from './repository';
import {MarketingStoreError,type MarketingScope} from './marketing-store';
import {decryptCredentials,encryptCredentials,type StoredCredentials} from './credential-envelope';
import {emailSenderReadiness} from './email-sender';
import {publicEmailOrigin,bumpSafety} from './email-safety';
import {emptySesProof,type SesProof,type SesSettings} from './ses-types';

type SesRow={connection_id:string;binding_revision:string;revision:number;manager_id:string;region:string;configuration_set:string;topic_arn:string;encrypted_credentials:string;checked_at:string|null;proof_json:string|null;last_error:string;feedback_observed_at:string|null};
export const sesRegion=(host:string)=>/^email-smtp\.([a-z]{2}-[a-z]+-\d)\.amazonaws\.com$/.exec(host)?.[1]||null;
// AWS-documented SMTP derivation; these are not interchangeable credential types.
export function sesSmtpPassword(secret:string,region:string){let value:Buffer=Buffer.from(`AWS4${secret}`);for(const part of ['11111111',region,'ses','aws4_request','SendRawEmail'])value=createHmac('sha256',value).update(part).digest();return Buffer.concat([Buffer.from([4]),value]).toString('base64');}
const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export type SesVerifier=(input:{region:string;domain:string;configurationSet:string;topicArn:string;accessKeyId:string;secretAccessKey:string})=>Promise<SesProof>;
export const verifySes:SesVerifier=async input=>{
  const client=new SESv2Client({region:input.region,endpoint:`https://email.${input.region}.amazonaws.com`,credentials:{accessKeyId:input.accessKeyId,secretAccessKey:input.secretAccessKey},maxAttempts:1});
  const options={abortSignal:AbortSignal.timeout(10000)};
  try{
    const identity=await client.send(new GetEmailIdentityCommand({EmailIdentity:input.domain}),options),account=await client.send(new GetAccountCommand({}),options),destinations=await client.send(new GetConfigurationSetEventDestinationsCommand({ConfigurationSetName:input.configurationSet}),options);
    const events=(destinations.EventDestinations||[]).some(item=>item.Enabled&&item.SnsDestination?.TopicArn===input.topicArn&&['BOUNCE','COMPLAINT','DELIVERY'].every(event=>item.MatchingEventTypes?.includes(event as 'BOUNCE')));
    return {identity:identity.IdentityType==='DOMAIN'&&identity.VerifiedForSendingStatus===true,dkim:identity.DkimAttributes?.SigningEnabled===true&&identity.DkimAttributes.Status==='SUCCESS',account:account.SendingEnabled===true&&account.EnforcementStatus==='HEALTHY'&&Number(account.SendQuota?.MaxSendRate)>0,events,sandbox:account.ProductionAccessEnabled!==true,
      mailFrom:!identity.MailFromAttributes?.MailFromDomain?'provider_managed':identity.MailFromAttributes.MailFromDomainStatus==='SUCCESS'?'custom_verified':'not_verified'};
  }finally{client.destroy();}
};
export class SesProvider {
  constructor(private db:Database.Database,private scope:MarketingScope,private key:string){}
  private args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private can(subject=this.scope.subject){const repo=new PlatformRepository(this.db);return repo.can(subject,...this.args(),'connections.manage')&&repo.can(subject,...this.args(),'recipients.manage')&&repo.workspace(subject,...this.args())?.project.productPack==='standard';}
  private authorize(){if(!this.can())throw new MarketingStoreError('SES ayarları için proje yöneticisi yetkisi gerekli.',403);}
  private row(){return this.db.prepare('SELECT * FROM platform_email_ses WHERE organization_id=? AND project_id=?').get(...this.args()) as SesRow|undefined;}
  state():SesSettings{
    const row=this.row(),sender=emailSenderReadiness(this.db,this.scope),proof:SesProof|null=row?.proof_json?JSON.parse(row.proof_json):null;
    const bound=Boolean(row&&row.connection_id===sender.connectionId&&row.binding_revision===sender.bindingRevision&&this.can(row.manager_id));
    const fresh=Boolean(row?.checked_at&&Date.now()-Date.parse(row.checked_at)<3600000&&Date.parse(row.checked_at)<=Date.now());
    const verified=Boolean(bound&&fresh&&proof?.identity&&proof.dkim&&proof.account&&proof.events&&proof.mailFrom!=='not_verified');
    const origin=publicEmailOrigin(),feedback=Boolean(row?.feedback_observed_at&&Date.now()-Date.parse(row.feedback_observed_at)<86400000),deploymentEnabled=process.env.PLATFORM_EMAIL_PILOT_SEND_ENABLED==='1';
    return {configured:Boolean(row),revision:row?.revision||0,region:row?.region||null,configurationSet:row?.configuration_set||'',topicArn:row?.topic_arn||'',checkedAt:row?.checked_at||null,verified,proof,lastError:row?.last_error||'',feedbackObservedAt:bound?row?.feedback_observed_at||null:null,endpoint:origin&&sender.connectionId?`${origin}/api/platform/email-feedback/${sender.connectionId}`:null,deploymentEnabled,
      ready:verified&&feedback&&deploymentEnabled&&Boolean(origin)&&sender.smtpReady&&sender.ownership==='verified'};
  }
  get(){this.authorize();return this.state();}
  save(input:{accessKeyId:string;secretAccessKey:string;configurationSet:string;topicArn:string;expectedRevision:number}){
    this.authorize();
    return this.db.transaction(()=>{
      const old=this.row(),sender=emailSenderReadiness(this.db,this.scope);
      if(!Number.isSafeInteger(input.expectedRevision)||(old?.revision||0)!==input.expectedRevision)throw new MarketingStoreError('SES ayarları değişti; yenileyin.',409);
      if(!sender.connectionId)throw new MarketingStoreError('Önce SMTP göndereni seçin.',409);
      const connection=this.db.prepare("SELECT encrypted_credentials FROM platform_connections WHERE id=? AND organization_id=? AND project_id=? AND active=1 AND provider='email'").get(sender.connectionId,...this.args()) as {encrypted_credentials:string}|undefined;
      if(!connection)throw new MarketingStoreError('SMTP bağlantısı etkin değil.',409);
      const credentials=decryptCredentials<StoredCredentials>(connection.encrypted_credentials,this.key,...this.args(),sender.connectionId),region=sesRegion(credentials.smtp?.host||'');
      if(!region)throw new MarketingStoreError('Bu adım Amazon SES SMTP hesabı gerektirir.',409);
      if(typeof input.accessKeyId!=='string'||!/^AKIA[A-Z0-9]{16}$/.test(input.accessKeyId)||typeof input.secretAccessKey!=='string'||!/^[A-Za-z0-9/+=]{40}$/.test(input.secretAccessKey)||input.accessKeyId!==credentials.smtp?.user||!equal(sesSmtpPassword(input.secretAccessKey,region),credentials.accessToken))throw new MarketingStoreError('AWS anahtarı seçili SES SMTP hesabıyla eşleşmiyor. Geçici AWS anahtarı desteklenmez.');
      if(typeof input.configurationSet!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(input.configurationSet)||typeof input.topicArn!=='string'||!new RegExp(`^arn:aws:sns:${region}:\\d{12}:[a-zA-Z0-9_-]{1,200}$`).test(input.topicArn))throw new MarketingStoreError('Aynı bölgedeki configuration set ve SNS topic ARN gerekli.');
      const occupied=this.db.prepare('SELECT project_id FROM platform_email_ses WHERE topic_arn=? AND (organization_id<>? OR project_id<>?)').get(input.topicArn,...this.args());if(occupied)throw new MarketingStoreError('Her proje ayrı bir SNS topic kullanmalı.',409);
      if(this.db.prepare('SELECT 1 FROM platform_email_ses_topics WHERE topic_arn=? AND (organization_id<>? OR project_id<>?)').get(input.topicArn,...this.args()))throw new MarketingStoreError('SNS topic daha önce başka bir projeye bağlandı.',409);
      const encrypted=encryptCredentials({accessKeyId:input.accessKeyId,secretAccessKey:input.secretAccessKey},this.key,...this.args(),'ses-provider');
      this.db.prepare(`INSERT INTO platform_email_ses(organization_id,project_id,connection_id,binding_revision,revision,manager_id,region,configuration_set,topic_arn,encrypted_credentials) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET connection_id=excluded.connection_id,binding_revision=excluded.binding_revision,revision=excluded.revision,manager_id=excluded.manager_id,region=excluded.region,configuration_set=excluded.configuration_set,topic_arn=excluded.topic_arn,encrypted_credentials=excluded.encrypted_credentials,checked_at=NULL,proof_json=NULL,last_error='',feedback_observed_at=NULL`).run(...this.args(),sender.connectionId,sender.bindingRevision,(old?.revision||0)+1,this.scope.subject,region,input.configurationSet,input.topicArn,encrypted);
      this.db.prepare('INSERT INTO platform_email_ses_topics VALUES(?,?,?,?,?,?) ON CONFLICT(topic_arn,connection_id) DO UPDATE SET manager_id=excluded.manager_id').run(input.topicArn,sender.connectionId,...this.args(),this.scope.subject,new Date().toISOString());
      bumpSafety(this.db,this.scope);this.audit('ses.configure');return this.get();
    }).immediate();
  }
  async verify(expectedRevision:number,verify:SesVerifier=verifySes){
    this.authorize();const row=this.row(),sender=emailSenderReadiness(this.db,this.scope);if(!row||row.revision!==expectedRevision||row.binding_revision!==sender.bindingRevision||row.connection_id!==sender.connectionId)throw new MarketingStoreError('Güncel SES ayarları gerekli.',409);
    const day=new Date().toISOString().slice(0,10);this.db.transaction(()=>{const used=this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='ses_verify'").get(...this.args(),day) as {count:number}|undefined;if((used?.count||0)>=20)throw new MarketingStoreError('Günlük SES kontrol sınırına ulaşıldı.',429);this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'ses_verify',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),day);}).immediate();
    let proof=emptySesProof(),error='';try{proof=await verify({region:row.region,domain:sender.domain!,configurationSet:row.configuration_set,topicArn:row.topic_arn,...decryptCredentials<{accessKeyId:string;secretAccessKey:string}>(row.encrypted_credentials,this.key,...this.args(),'ses-provider')});}catch{error='provider_unavailable';}
    return this.db.transaction(()=>{
      this.authorize();const current=this.row(),live=emailSenderReadiness(this.db,this.scope);if(current?.revision!==row.revision||current.encrypted_credentials!==row.encrypted_credentials||live.bindingRevision!==sender.bindingRevision||live.connectionId!==sender.connectionId)throw new MarketingStoreError('Kontrol sırasında SES veya SMTP ayarları değişti.',409);
      this.db.prepare('UPDATE platform_email_ses SET proof_json=?,checked_at=?,last_error=? WHERE organization_id=? AND project_id=?').run(JSON.stringify(proof),new Date().toISOString(),error,...this.args());bumpSafety(this.db,this.scope);this.audit('ses.verify');return this.get();
    }).immediate();
  }
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
}
