import 'server-only';
import {request as httpsRequest} from 'node:https';
import {createHash,verify as verifySignature,X509Certificate} from 'node:crypto';
import type Database from 'better-sqlite3';
import {resolvePublicAddress} from '../site-audit';
import {MarketingStoreError} from './marketing-store';
import {PlatformRepository} from './repository';
import {emailAddress,emailIdentity,blockEmail,blockEntity} from './email-safety';
import {EmailPilotQueue} from './email-pilots';

type Notification={Type:string;TopicArn:string;Message:string;MessageId:string;Timestamp:string;SignatureVersion:string;Signature:string;SigningCertURL:string;Subject?:string};
export type CertificateLoader=(url:URL)=>Promise<string>;
export const readSnsCertificate:CertificateLoader=async url=>{
  let expired=false,timer:ReturnType<typeof setTimeout>|undefined,active:ReturnType<typeof httpsRequest>|undefined;
  try{return await Promise.race([(async()=>{
  const address=await resolvePublicAddress(url);
  if(expired)throw new Error('Certificate timeout.');
  const pem=await new Promise<string>((resolve,reject)=>{
    const req=httpsRequest({hostname:address.address,servername:url.hostname,port:443,path:url.pathname,method:'GET',headers:{Host:url.hostname},rejectUnauthorized:true,minVersion:'TLSv1.2'},res=>{
      if(res.statusCode!==200){res.destroy();reject(new Error('Certificate unavailable.'));return;}
      const chunks:Buffer[]=[];let size=0;res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>65536){res.destroy();reject(new Error('Certificate too large.'));}else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    });active=req;req.setTimeout(4000,()=>req.destroy(new Error('Certificate timeout.')));req.on('error',reject);req.end();
  });
  const certificate=new X509Certificate(pem);if(Date.parse(certificate.validFrom)>Date.now()||Date.parse(certificate.validTo)<=Date.now())throw new Error('Certificate expired.');return pem;
  })(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;active?.destroy();reject(new Error('Certificate timeout.'));},8000);})]);}finally{if(timer)clearTimeout(timer);active?.destroy();}
};
export async function validateSnsNotification(raw:unknown,topicArn:string,load:CertificateLoader=readSnsCertificate):Promise<Notification>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new MarketingStoreError('Geçersiz SNS bildirimi.');
  const body=raw as Notification;
  if(body.Type!=='Notification'||body.TopicArn!==topicArn||typeof body.Message!=='string'||body.Message.length>100000||typeof body.MessageId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(body.MessageId)||typeof body.Timestamp!=='string'||!Number.isFinite(Date.parse(body.Timestamp))||Date.now()-Date.parse(body.Timestamp)>7*86400000||Date.parse(body.Timestamp)>Date.now()+300000||!['1','2'].includes(body.SignatureVersion)||typeof body.Signature!=='string'||!/^[A-Za-z0-9+/]{64,2048}={0,2}$/.test(body.Signature)||body.Subject!==undefined&&typeof body.Subject!=='string')throw new MarketingStoreError('SNS imza alanları geçersiz.');
  const region=topicArn.split(':')[3],url=new URL(body.SigningCertURL);
  if(url.protocol!=='https:'||url.hostname!==`sns.${region}.amazonaws.com`||url.port||url.username||url.password||url.search||url.hash||!/^\/SimpleNotificationService-[A-Za-z0-9_-]{1,128}\.pem$/.test(url.pathname))throw new MarketingStoreError('SNS sertifika adresi geçersiz.');
  const fields=['Message','MessageId',...(body.Subject!==undefined?['Subject']:[]),'Timestamp','TopicArn','Type'] as (keyof Notification)[],canonical=fields.map(field=>`${field}\n${body[field]}\n`).join('');
  const certificate=await load(url);if(!verifySignature(body.SignatureVersion==='2'?'RSA-SHA256':'RSA-SHA1',Buffer.from(canonical),certificate,Buffer.from(body.Signature,'base64')))throw new MarketingStoreError('SNS imzası doğrulanamadı.');return body;
}

export async function receiveSesFeedback(db:Database.Database,connectionId:string,raw:unknown,key:string,validate=validateSnsNotification){
  const topic=(raw as {TopicArn?:unknown})?.TopicArn;
  const provider=typeof topic==='string'?db.prepare('SELECT * FROM platform_email_ses_topics WHERE connection_id=? AND topic_arn=?').get(connectionId,topic) as {organization_id:string;project_id:string;manager_id:string;topic_arn:string}|undefined:undefined;
  if(!provider)throw new MarketingStoreError('Geri bildirim bağlantısı bulunamadı.',404);
  const args=[provider.organization_id,provider.project_id] as const,repo=new PlatformRepository(db);
  const authorized=()=>repo.can(provider.manager_id,...args,'connections.manage')&&repo.can(provider.manager_id,...args,'recipients.manage');
  if((raw as {TopicArn?:unknown})?.TopicArn!==provider.topic_arn)throw new MarketingStoreError('SNS topic eşleşmiyor.',403);
  // Subscription creation/confirmation is an operator action in AWS, never a fetched URL.
  if((raw as {Type?:unknown})?.Type==='SubscriptionConfirmation')return {pendingConfirmation:true};
  db.transaction(()=>{const day=new Date().toISOString().slice(0,10),usage=db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='ses_feedback_verify'").get(...args,day) as {count:number}|undefined;if((usage?.count||0)>=500)throw new MarketingStoreError('Geri bildirim kontrol sınırı aşıldı.',429);db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'ses_feedback_verify',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...args,day);}).immediate();
  const body=await validate(raw,provider.topic_arn),digest=createHash('sha256').update(body.Message).digest('hex');
  return db.transaction(()=>{
    const binding=db.prepare('SELECT 1 FROM platform_email_ses_topics WHERE connection_id=? AND topic_arn=? AND organization_id=? AND project_id=?').get(connectionId,provider.topic_arn,...args);if(!binding)throw new MarketingStoreError('Geri bildirim yapılandırması değişti.',409);
    const old=db.prepare('SELECT digest FROM platform_email_ses_receipts WHERE organization_id=? AND project_id=? AND message_id=?').get(...args,body.MessageId) as {digest:string}|undefined;
    if(old){if(old.digest!==digest)throw new MarketingStoreError('SNS kayıt kimliği farklı içerikle tekrarlandı.',409);return {duplicate:true};}
    const count=(db.prepare('SELECT COUNT(*) AS n FROM platform_email_ses_receipts WHERE organization_id=? AND project_id=?').get(...args) as {n:number}).n;if(count>=10000)throw new MarketingStoreError('Geri bildirim saklama sınırı aşıldı.',429);
    let event;try{event=JSON.parse(body.Message);}catch{throw new MarketingStoreError('SNS olay içeriği geçersiz.');}
    if(!event||typeof event!=='object'||Array.isArray(event))throw new MarketingStoreError('SNS olay içeriği geçersiz.');
    const kind=String(event.eventType||event.notificationType||'unknown');
    db.prepare('INSERT INTO platform_email_ses_receipts VALUES(?,?,?,?,?,?)').run(...args,body.MessageId,digest,['Delivery','Bounce','Complaint','RyzevoFeedbackCheck'].includes(kind)?kind:'ignored',new Date().toISOString());
    if(authorized())db.prepare('UPDATE platform_email_ses SET feedback_observed_at=? WHERE organization_id=? AND project_id=? AND connection_id=? AND topic_arn=? AND manager_id=?').run(new Date().toISOString(),...args,connectionId,provider.topic_arn,provider.manager_id);
    if(!['Delivery','Bounce','Complaint'].includes(kind))return {observed:true};
    if(kind==='Bounce'&&event.bounce?.bounceType!=='Permanent')return {ignored:true};
    const tags=event.mail?.tags,jobId=tags?.ryzevoJob?.[0],position=Number(tags?.ryzevoPosition?.[0]),attempt=tags?.ryzevoAttempt?.[0];
    if(typeof jobId!=='string'||!Number.isInteger(position)||position<1||position>5||typeof attempt!=='string'||event.mail?.sendingAccountId!==provider.topic_arn.split(':')[4])return {ignored:true};
    const row=db.prepare(`SELECT r.*,p.state,p.email_key,p.masked_email,p.provider_message_id FROM platform_email_send_reservations r JOIN platform_email_pilot_recipients p ON p.job_id=r.job_id AND p.position=r.position WHERE r.job_id=? AND r.position=? AND r.attempt_id=? AND r.organization_id=? AND r.project_id=? AND r.submitted_at IS NOT NULL`).get(jobId,position,attempt,...args) as {state:string;email_key:string;masked_email:string;provider_message_id:string|null}|undefined;
    if(!row)return {ignored:true};
    const scope={subject:provider.manager_id,organizationId:args[0],projectId:args[1]},queue=new EmailPilotQueue(db,scope,key),job=queue.row(jobId),snapshot=queue.snapshot(job),recipient=snapshot.recipients[position-1];
    if(job.mode!=='send'||job.connection_id!==connectionId||!recipient||recipient.emailKey!==row.email_key||emailAddress(event.mail?.source)?.split('@')[1]!==snapshot.domain)return {ignored:true};
    const emails:unknown[]=kind==='Delivery'?event.delivery?.recipients:kind==='Bounce'?event.bounce?.bouncedRecipients?.map((r:{emailAddress:unknown})=>r.emailAddress):event.complaint?.complainedRecipients?.map((r:{emailAddress:unknown})=>r.emailAddress);
    const messageId=event.mail?.messageId;if(!Array.isArray(emails)||emails.length!==1||emailIdentity(scope,key,'email',[emailAddress(emails[0])])!==row.email_key||typeof messageId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(messageId)||row.provider_message_id&&row.provider_message_id!==messageId)return {ignored:true};
    const state=kind==='Complaint'?'complained':kind==='Bounce'?'bounced':'delivered',rank:Record<string,number>={complained:3,bounced:2,delivered:1};
    if((rank[state]||0)>(rank[row.state]||0))db.prepare('UPDATE platform_email_pilot_recipients SET state=?,reason=NULL,provider_message_id=?,updated_at=? WHERE job_id=? AND position=?').run(state,messageId,new Date().toISOString(),jobId,position);
    if(kind!=='Delivery'){blockEmail(db,scope,row.email_key,row.masked_email,kind==='Complaint'?'complaint':'hard_bounce');if(snapshot.sourceId)blockEntity(db,scope,snapshot.sourceId,recipient.entityKey);
      if(['queued','running'].includes(job.status)){const now=new Date().toISOString();db.prepare("UPDATE platform_email_pilot_recipients SET state=CASE WHEN state IN ('checking','submitting') THEN 'uncertain' ELSE 'cancelled' END,reason=CASE WHEN state IN ('checking','submitting') THEN 'interrupted' ELSE 'cancelled' END,updated_at=? WHERE job_id=? AND state IN ('queued','checking','submitting')").run(now,jobId);db.prepare("UPDATE platform_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(now,jobId);db.prepare("UPDATE platform_email_pilots SET outcome='cancelled' WHERE job_id=?").run(jobId);}
    }
    db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(provider.manager_id,...args,`email.feedback.${state}`,new Date().toISOString());return {recorded:true};
  }).immediate();
}
