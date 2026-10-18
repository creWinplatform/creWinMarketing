import 'server-only';
import {assertProjectWork,assertProjectDelivery} from './entitlements';
import {randomUUID} from 'node:crypto';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import type Database from 'better-sqlite3';
import {PlatformRepository} from './repository';
import {MarketingStoreError,ProjectMarketingStore,type MarketingScope} from './marketing-store';
import {CampaignReviews} from './campaign-review';
import {ProductSegments} from './segments';
import {EmailRecipients,type EligibleEmailRecipient} from './email-recipients';
import {emailSenderReadiness} from './email-sender';
import {decryptCredentials,encryptCredentials} from './credential-envelope';
import type {SegmentEntity} from './segment-engine';
import {EMAIL_QUEUE_LIMITS,type EmailPilotJob,type EmailPilotWorkspace,type PilotReason} from './email-pilot-types';
import {SesProvider} from './ses-provider';
import {newUnsubscribeToken,publicEmailOrigin} from './email-safety';
import {preparePilotMail} from './email-delivery';

export type JobRow={id:string;actor_id:string;connection_id:string;revision:string;status:EmailPilotJob['status'];attempts:number;lease_token:string|null;lease_until:string|null;created_at:string;updated_at:string;campaign_id:string;campaign_name:string;review_id:number;encrypted_snapshot:string;outcome:EmailPilotJob['outcome'];mode:'rehearsal'|'send'};
export type Snapshot={version:1;digest:string;reviewId:number;connectionId:string;bindingRevision:string;maxRecipients:number;domain:string|null;maskedSender:string|null;subject:string;text:string;ctaUrl:string;html:string;recipients:EligibleEmailRecipient[];sesRevision?:number;publicOrigin?:string;sourceId?:string};
const query=`SELECT j.*,p.campaign_id,p.campaign_name,p.review_id,p.encrypted_snapshot,p.outcome,p.mode FROM platform_jobs j JOIN platform_email_pilots p ON p.job_id=j.id AND p.organization_id=j.organization_id AND p.project_id=j.project_id WHERE j.organization_id=? AND j.project_id=? AND j.job_type IN ('email.rehearsal','email.pilot_send')`;

export class EmailPilotQueue {
  constructor(private db:Database.Database,private scope:MarketingScope,private key:string){}
  private args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  canManage(subject=this.scope.subject){const repo=new PlatformRepository(this.db);return ['campaign.approve','connections.manage','recipients.manage'].every(permission=>repo.can(subject,...this.args(),permission as 'campaign.approve'|'connections.manage'|'recipients.manage'));}
  private authorize(manage=false){
    const repo=new PlatformRepository(this.db);
    if(!repo.can(this.scope.subject,...this.args(),'read')||repo.workspace(this.scope.subject,...this.args())?.project.productPack!=='standard'||manage&&!this.canManage())throw new MarketingStoreError('Standart proje pilot erişimi gerekli.',403);
  }
  row(id:string){
    if(typeof id!=='string'||!id||id.length>120)throw new MarketingStoreError('Geçerli prova kimliği gerekli.');
    const row=this.db.prepare(`${query} AND j.id=?`).get(...this.args(),id) as JobRow|undefined;
    if(!row)throw new MarketingStoreError('Pilot provası bulunamadı.',404);return row;
  }
  snapshot(row:JobRow){return decryptCredentials<Snapshot>(row.encrypted_snapshot,this.key,...this.args(),row.id);}
  describe(row:JobRow):EmailPilotJob{
    const snapshot=this.snapshot(row),sender=emailSenderReadiness(this.db,this.scope),bound=sender.connectionId===snapshot.connectionId&&sender.bindingRevision===snapshot.bindingRevision;
    const recipients=this.db.prepare('SELECT position AS id,masked_email AS maskedEmail,state,reason FROM platform_email_pilot_recipients WHERE job_id=? AND organization_id=? AND project_id=? ORDER BY position').all(row.id,...this.args()) as EmailPilotJob['recipients'];
    const ses=row.mode==='send'?new SesProvider(this.db,this.scope,this.key).state():null;
    return {id:row.id,campaignId:row.campaign_id,campaignName:row.campaign_name,mode:row.mode,status:row.status,outcome:row.outcome,createdAt:row.created_at,updatedAt:row.updated_at,attempts:row.attempts,
      total:recipients.length,checked:recipients.filter(r=>r.state==='validated').length,skipped:recipients.filter(r=>r.state==='skipped').length,uncertain:recipients.filter(r=>r.state==='uncertain').length,cancelled:recipients.filter(r=>r.state==='cancelled').length,
      sender:this.canManage()?{domain:snapshot.domain,maskedSender:snapshot.maskedSender}:{domain:null,maskedSender:null},gates:{smtp:bound&&sender.smtpReady,domain:bound&&sender.ownership==='verified',authentication:ses?.verified||false},recipients:this.canManage()?recipients:[],sendingEnabled:ses?.ready||false,canManage:this.canManage(),
      ...(row.mode==='send'?{accepted:recipients.filter(r=>['accepted','delivered','bounced','complained'].includes(r.state)).length,delivered:recipients.filter(r=>r.state==='delivered').length,bounced:recipients.filter(r=>r.state==='bounced').length,complained:recipients.filter(r=>r.state==='complained').length}: {})};
  }
  list(campaignId:string,mode:'rehearsal'|'send'='rehearsal'):EmailPilotWorkspace{
    this.authorize();if(typeof campaignId!=='string'||!campaignId||campaignId.length>120)throw new MarketingStoreError('Kampanya kimliği gerekli.');
    const rows=this.db.prepare(`${query} AND p.campaign_id=? AND p.mode=? ORDER BY j.created_at DESC,j.id DESC LIMIT 10`).all(...this.args(),campaignId,mode) as JobRow[];
    return {jobs:rows.map(row=>this.describe(row)),sendingEnabled:mode==='send'&&new SesProvider(this.db,this.scope,this.key).state().ready};
  }
  get(id:string){this.authorize();return this.describe(this.row(id));}
  private eligible(campaignId:string,subject=this.scope.subject){
    const scope={...this.scope,subject},campaign=new ProjectMarketingStore(this.db,scope).campaign(campaignId),binding=campaign?.segmentBinding;
    if(!binding)throw new MarketingStoreError('Kaydedilmiş kitle bağı gerekli.',409);
    const members:SegmentEntity[]=[],preview=new ProductSegments(this.db,scope).evaluateSaved(binding.segmentId,binding.segmentVersion,members);
    if(preview.ruleDigest!==binding.ruleDigest)throw new MarketingStoreError('Kitle kuralı değişti.',409);
    const recipients:EligibleEmailRecipient[]=[];
    const eligibility=new EmailRecipients(this.db,scope,this.key).eligibility(binding.sourceId,binding.sourceVersion,members,undefined,recipients);
    if(!eligibility.mappingReady)throw new MarketingStoreError('Güncel alıcı eşleştirmesi gerekli.',409);
    const repo=new PlatformRepository(this.db);
    const grants=this.db.prepare('SELECT email_key,granted_by FROM platform_email_pilot_allowlist WHERE organization_id=? AND project_id=? AND active=1 LIMIT 21').all(...this.args()) as {email_key:string;granted_by:string}[];
    const allowed=new Set(grants.filter(grant=>repo.can(grant.granted_by,...this.args(),'connections.manage')&&repo.can(grant.granted_by,...this.args(),'recipients.manage')).map(grant=>grant.email_key));
    return recipients.filter(recipient=>allowed.has(recipient.emailKey)).sort((a,b)=>a.emailKey.localeCompare(b.emailKey));
  }
  enqueue(input:{campaignId:string;expectedDigest:string;expectedReviewId:number;idempotencyKey:string;acknowledged:boolean;sendAcknowledged?:boolean},mode:'rehearsal'|'send'='rehearsal'){
    this.authorize(true);
    assertProjectWork(this.db,this.scope);if(mode==='send')assertProjectDelivery(this.db,this.scope);
    if(input.acknowledged!==true||typeof input.idempotencyKey!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.idempotencyKey)||typeof input.expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedDigest)||!Number.isSafeInteger(input.expectedReviewId))throw new MarketingStoreError('Prova onayı, içerik sürümü ve işlem anahtarı gerekli.');
    return this.db.transaction(()=>{
      this.authorize(true);const key=`email.${mode==='send'?'pilot_send':'rehearsal'}:${input.idempotencyKey}`;
      const old=this.db.prepare('SELECT id,job_type FROM platform_jobs WHERE organization_id=? AND project_id=? AND idempotency_key=?').get(...this.args(),key) as {id:string;job_type:string}|undefined;
      if(old){const job=this.row(old.id);if(job.campaign_id!==input.campaignId||job.revision!==input.expectedDigest||job.review_id!==input.expectedReviewId)throw new MarketingStoreError('İşlem anahtarı başka bir prova sürümüne ait.',409);return this.describe(job);}
      const reviews=new CampaignReviews(this.db,this.scope,this.key),review=reviews.get(input.campaignId),sender=emailSenderReadiness(this.db,this.scope);
      if(review.digest!==input.expectedDigest||review.history[0]?.id!==input.expectedReviewId||review.approval!=='approved'||!review.audience?.fresh||!review.pilot?.planned)throw new MarketingStoreError('Onaylı içerik, güncel ön kontrol ve izinli pilot alıcıları gerekli.',409);
      if(!sender.connectionId||!sender.maxRecipients||!['pending','expired','verified'].includes(sender.ownership))throw new MarketingStoreError('Güncel bir gönderen hesabı seçin.',409);
      const ses=mode==='send'?new SesProvider(this.db,this.scope,this.key).state():null;
      if(mode==='send'&&(input.sendAcknowledged!==true||!ses?.ready))throw new MarketingStoreError('Gerçek gönderim için SES, DNS, SMTP, geri bildirim ve sunucu izni ile açık gönderim onayı gerekli.',409);
      if(mode==='send'&&this.db.prepare(`${query} AND p.mode='send' AND j.status IN ('queued','running')`).get(...this.args()))throw new MarketingStoreError('Projede aktif bir gerçek pilot var.',409);
      const active=this.db.prepare(`${query} AND p.campaign_id=? AND j.status IN ('queued','running')`).get(...this.args(),input.campaignId);
      if(active)throw new MarketingStoreError('Bu kampanyanın aktif bir pilot provası var.',409);
      const recipients=this.eligible(input.campaignId).slice(0,Math.min(sender.maxRecipients,EMAIL_QUEUE_LIMITS.recipients));
      if(!recipients.length)throw new MarketingStoreError('Güncel izinli pilot alıcısı bulunamadı.',409);
      const total=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_email_pilots WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n;
      const day=new Date().toISOString().slice(0,10),used=this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='email_rehearsal'").get(...this.args(),day) as {count:number}|undefined;
      if(total>=EMAIL_QUEUE_LIMITS.storedJobs||(used?.count||0)>=EMAIL_QUEUE_LIMITS.jobsPerDay)throw new MarketingStoreError('Pilot prova sınırına ulaşıldı.',429);
      const reserved=this.db.prepare('SELECT email_key,content_digest,campaign_id,day FROM platform_email_send_reservations WHERE organization_id=? AND project_id=? AND (day=? OR campaign_id=?)').all(...this.args(),day,input.campaignId) as {email_key:string;content_digest:string;campaign_id:string;day:string}[];
      if(mode==='send'&&(reserved.filter(r=>r.day===day).length+recipients.length>20||recipients.some(r=>reserved.some(old=>old.email_key===r.emailKey&&(old.day===day||old.campaign_id===input.campaignId&&old.content_digest===review.digest)))))throw new MarketingStoreError('Alıcı için gönderim rezervasyonu var veya günlük 20 alıcı sınırı aşıldı.',409);
      const id=randomUUID(),now=new Date().toISOString(),snapshot:Snapshot={version:1,digest:review.digest,reviewId:input.expectedReviewId,connectionId:sender.connectionId,bindingRevision:sender.bindingRevision,maxRecipients:sender.maxRecipients,domain:sender.domain,maskedSender:sender.maskedSender,subject:review.subject,text:review.text,ctaUrl:review.ctaUrl,html:review.html,recipients,sourceId:new ProjectMarketingStore(this.db,this.scope).campaign(input.campaignId)!.segmentBinding!.sourceId,...(ses?{sesRevision:ses.revision,publicOrigin:publicEmailOrigin()!}:{})};
      this.db.prepare(`INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES(?,?,?,?,?,?,?,'queued',?,?,?)`).run(id,...this.args(),this.scope.subject,sender.connectionId,review.digest,key,now,now,mode==='send'?'email.pilot_send':'email.rehearsal');
      this.db.prepare('INSERT INTO platform_email_pilots(job_id,organization_id,project_id,campaign_id,campaign_name,review_id,encrypted_snapshot,mode) VALUES(?,?,?,?,?,?,?,?)').run(id,...this.args(),input.campaignId,review.name,input.expectedReviewId,encryptCredentials(snapshot,this.key,...this.args(),id),mode);
      recipients.forEach((recipient,i)=>this.db.prepare("INSERT INTO platform_email_pilot_recipients(job_id,organization_id,project_id,position,email_key,masked_email,state,reason,updated_at) VALUES(?,?,?,?,?,?,'queued',NULL,?)").run(id,...this.args(),i+1,recipient.emailKey,recipient.maskedEmail,now));
      if(mode==='send'){
        const connection=this.db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=? AND organization_id=? AND project_id=?').get(sender.connectionId,...this.args()) as {encrypted_credentials:string},credentials=decryptCredentials<{smtp:{fromEmail:string;fromName:string}}>(connection.encrypted_credentials,this.key,...this.args(),sender.connectionId),project=new PlatformRepository(this.db).workspace(this.scope.subject,...this.args())!.project;
        const sourceId=new ProjectMarketingStore(this.db,this.scope).campaign(input.campaignId)!.segmentBinding!.sourceId;
        const tokenCount=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_email_unsubscribe WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n;if(tokenCount+recipients.length>1000)throw new MarketingStoreError('Abonelik bağlantısı saklama sınırı aşıldı.',429);
        recipients.forEach((recipient,i)=>{const attempt=randomUUID(),link=newUnsubscribeToken(this.db,this.scope,{sourceId,entityKey:recipient.entityKey,emailKey:recipient.emailKey,maskedEmail:recipient.maskedEmail}),mail=preparePilotMail({fromEmail:credentials.smtp.fromEmail,fromName:credentials.smtp.fromName,to:recipient.email,subject:review.subject,text:review.text,ctaUrl:review.ctaUrl,brand:project.name,language:project.language||'tr',unsubscribeUrl:publicEmailOrigin()!+link.path,configurationSet:ses!.configurationSet,jobId:id,position:i+1,attemptId:attempt,createdAt:now});
          this.db.prepare('INSERT INTO platform_email_send_reservations VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(id,i+1,...this.args(),input.campaignId,review.digest,recipient.emailKey,day,attempt);
          this.db.prepare('UPDATE platform_email_pilot_recipients SET encrypted_message=? WHERE job_id=? AND position=?').run(encryptCredentials(mail,this.key,...this.args(),`${id}:${i+1}`),id,i+1);
        });
      }
      this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'email_rehearsal',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),day);
      this.audit(mode==='send'?'email.pilot_send.enqueue':'email.rehearsal.enqueue');return this.describe(this.row(id));
    }).immediate();
  }
  cancel(id:string){
    this.authorize(true);return this.db.transaction(()=>{
      const job=this.row(id);if(!['queued','running'].includes(job.status))return this.describe(job);
      const now=new Date().toISOString();
      this.db.prepare("UPDATE platform_email_pilot_recipients SET state=CASE WHEN state IN ('checking','submitting') THEN 'uncertain' ELSE 'cancelled' END,reason=CASE WHEN state IN ('checking','submitting') THEN 'interrupted' ELSE 'cancelled' END,updated_at=? WHERE job_id=? AND organization_id=? AND project_id=? AND state IN ('queued','checking','submitting')").run(now,id,...this.args());
      this.db.prepare("UPDATE platform_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND organization_id=? AND project_id=?").run(now,id,...this.args());
      this.db.prepare("UPDATE platform_email_pilots SET outcome='cancelled' WHERE job_id=?").run(id);this.audit(job.mode==='send'?'email.pilot_send.cancel':'email.rehearsal.cancel');return this.describe(this.row(id));
    }).immediate();
  }
  async run(id:string){this.authorize(true);await this.process(id,undefined,this.scope.subject);return this.get(id);}
  liveReason(job:JobRow,snapshot:Snapshot,recipient:EligibleEmailRecipient,manualRunner?:string):PilotReason|null{
    if(!this.canManage(job.actor_id)||manualRunner&&!this.canManage(manualRunner))return 'authority_lost';
    if(Date.now()-Date.parse(job.created_at)>EMAIL_QUEUE_LIMITS.lifetimeMinutes*60000)return 'expired';
    const scope={...this.scope,subject:job.actor_id};
    try{
      assertProjectWork(this.db,scope);if(job.mode==='send')assertProjectDelivery(this.db,scope);
      const review=new CampaignReviews(this.db,scope,this.key).get(job.campaign_id),sender=emailSenderReadiness(this.db,scope);
      if(review.approval!=='approved'||review.history[0]?.id!==snapshot.reviewId||review.digest!==snapshot.digest||sender.connectionId!==snapshot.connectionId||sender.bindingRevision!==snapshot.bindingRevision||sender.maxRecipients!==snapshot.maxRecipients||!['pending','expired','verified'].includes(sender.ownership))return 'changed';
      return this.eligible(job.campaign_id,job.actor_id).some(item=>item.emailKey===recipient.emailKey&&item.contactKey===recipient.contactKey)?null:'recipient_ineligible';
    }catch{return 'changed';}
  }
  private holder(id:string,lease:string){return Boolean(this.db.prepare("SELECT 1 FROM platform_jobs WHERE id=? AND organization_id=? AND project_id=? AND job_type='email.rehearsal' AND status='running' AND lease_token=? AND lease_until>?").get(id,...this.args(),lease,new Date().toISOString()));}
  // Server worker only. The optional checkpoint is an isolated-test interruption hook,
  // not a transport or an HTTP override. No SMTP/network delivery code is imported.
  async process(id:string,checkpoint:(position:number)=>Promise<void>=async()=>{await yieldTurn();},manualRunner?:string){
    if(this.row(id).mode!=='rehearsal')throw new MarketingStoreError('Gerçek pilot prova worker’ında çalıştırılamaz.',409);
    const lease=randomUUID();
    const claimed=this.db.transaction(()=>{
      const job=this.row(id),now=new Date().toISOString();
      if(!['queued','running'].includes(job.status)||job.status==='running'&&job.lease_until&&job.lease_until>now)return null;
      this.db.prepare("UPDATE platform_email_pilot_recipients SET state='uncertain',reason='interrupted',updated_at=? WHERE job_id=? AND state='checking'").run(now,id);
      if(job.attempts>=EMAIL_QUEUE_LIMITS.attempts){this.db.prepare("UPDATE platform_email_pilot_recipients SET state='skipped',reason='check_failed',updated_at=? WHERE job_id=? AND state='queued'").run(now,id);this.finish(id);return null;}
      this.db.prepare("UPDATE platform_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(lease,new Date(Date.now()+EMAIL_QUEUE_LIMITS.leaseSeconds*1000).toISOString(),now,id);return job;
    }).immediate();
    if(!claimed)return;
    let snapshot:Snapshot;
    try{snapshot=this.snapshot(claimed);}catch{
      this.db.transaction(()=>{if(!this.holder(id,lease))return;this.db.prepare("UPDATE platform_email_pilot_recipients SET state='skipped',reason='check_failed' WHERE job_id=? AND state='queued'").run(id);this.finish(id);}).immediate();return;
    }
    for(let i=0;i<snapshot.recipients.length;i++){
      const position=i+1,recipient=snapshot.recipients[i];
      const started=this.db.transaction(()=>{
        if(!this.holder(id,lease))return false;
        const row=this.db.prepare('SELECT state FROM platform_email_pilot_recipients WHERE job_id=? AND position=?').get(id,position) as {state:string};
        if(row.state!=='queued')return false;
        const reason=this.liveReason(claimed,snapshot,recipient,manualRunner);
        if(!this.holder(id,lease))return false;
        this.db.prepare('UPDATE platform_email_pilot_recipients SET state=?,reason=?,updated_at=? WHERE job_id=? AND position=?').run(reason?'skipped':'checking',reason,new Date().toISOString(),id,position);return !reason;
      }).immediate();
      if(!started)continue;
      let interrupted=false,timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([checkpoint(position),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('deadline')),2000);})]);}catch{interrupted=true;}finally{if(timer)clearTimeout(timer);}
      this.db.transaction(()=>{
        if(!this.holder(id,lease))return;
        const reason=interrupted?'interrupted':this.liveReason(claimed,snapshot,recipient,manualRunner);
        if(!this.holder(id,lease))return;
        this.db.prepare("UPDATE platform_email_pilot_recipients SET state=?,reason=?,updated_at=? WHERE job_id=? AND position=? AND state='checking'").run(interrupted?'uncertain':reason?'skipped':'validated',reason,new Date().toISOString(),id,position);
      }).immediate();
    }
    this.db.transaction(()=>{if(this.holder(id,lease))this.finish(id);}).immediate();
  }
  private finish(id:string){
    const states=this.db.prepare('SELECT state FROM platform_email_pilot_recipients WHERE job_id=?').all(id) as {state:string}[];
    const uncertain=states.some(r=>r.state==='uncertain'),skipped=states.some(r=>r.state==='skipped'),valid=states.some(r=>r.state==='validated');
    this.db.prepare("UPDATE platform_jobs SET status=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(uncertain||!valid?'failed':'completed',new Date().toISOString(),id);
    // Even a perfect rehearsal cannot verify sender authentication or send a message.
    this.db.prepare('UPDATE platform_email_pilots SET outcome=? WHERE job_id=?').run(uncertain?'interrupted':skipped?'partial':'blocked',id);
    this.audit('email.rehearsal.finish');
  }
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
}

export async function runEmailPilotJob(db:Database.Database,scope:MarketingScope,id:string,key:string){await new EmailPilotQueue(db,scope,key).process(id);}
