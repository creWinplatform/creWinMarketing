import 'server-only';
import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {MarketingStoreError,type MarketingScope} from './marketing-store';
import {EmailPilotQueue,type Snapshot} from './email-pilots';
import {SesProvider} from './ses-provider';
import {decryptCredentials,type StoredCredentials} from './credential-envelope';
import {publicEmailOrigin} from './email-safety';
import {submitSmtpPilot,type PilotDelivery,type PilotMail} from './email-delivery';

export class EmailSendJobs {
  private queue:EmailPilotQueue;
  constructor(private db:Database.Database,private scope:MarketingScope,private key:string){this.queue=new EmailPilotQueue(db,scope,key);}
  private args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private holder(id:string,lease:string){return Boolean(this.db.prepare("SELECT 1 FROM platform_jobs WHERE id=? AND organization_id=? AND project_id=? AND job_type='email.pilot_send' AND status='running' AND lease_token=? AND lease_until>?").get(id,...this.args(),lease,new Date().toISOString()));}
  private ready(snapshot:Snapshot){const ses=new SesProvider(this.db,this.scope,this.key).state();return ses.ready&&ses.revision===snapshot.sesRevision&&publicEmailOrigin()===snapshot.publicOrigin;}
  async run(id:string){this.queue.get(id);if(!this.queue.canManage())throw new MarketingStoreError('Pilot gönderim yetkisi gerekli.',403);await this.process(id,submitSmtpPilot,this.scope.subject);return this.queue.get(id);}
  // One recipient per claim. Submission is reserved durably before touching SMTP DATA.
  async process(id:string,deliver:PilotDelivery=submitSmtpPilot,manualRunner?:string){
    const lease=randomUUID();
    const claimed=this.db.transaction(()=>{
      const row=this.queue.row(id),now=new Date().toISOString();if(row.mode!=='send')throw new MarketingStoreError('Gerçek gönderim işi bulunamadı.',404);
      if(!['queued','running'].includes(row.status)||row.status==='running'&&row.lease_until&&row.lease_until>now)return null;
      const last=this.db.prepare('SELECT last_submit_at FROM platform_email_ses WHERE organization_id=? AND project_id=?').get(...this.args()) as {last_submit_at:string|null}|undefined;
      if(row.status==='queued'&&last?.last_submit_at&&Date.now()-Date.parse(last.last_submit_at)<2000)return null;
      this.db.prepare("UPDATE platform_email_pilot_recipients SET state='uncertain',reason='interrupted',updated_at=? WHERE job_id=? AND state IN ('checking','submitting')").run(now,id);
      const interrupted=this.db.prepare("SELECT 1 FROM platform_email_pilot_recipients WHERE job_id=? AND state='uncertain'").get(id);
      if(interrupted||row.attempts>=7){this.stopRemaining(id,'interrupted');this.finish(id);return null;}
      this.db.prepare("UPDATE platform_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(lease,new Date(Date.now()+60000).toISOString(),now,id);return row;
    }).immediate();
    if(!claimed)return;
    let snapshot:Snapshot;
    try{snapshot=this.queue.snapshot(claimed);}catch{this.db.transaction(()=>{if(!this.holder(id,lease))return;this.stopRemaining(id,'check_failed');this.finish(id);}).immediate();return;}
    const row=this.db.transaction(()=>{
      if(!this.holder(id,lease))return null;
      const item=this.db.prepare("SELECT position,encrypted_message FROM platform_email_pilot_recipients WHERE job_id=? AND state='queued' ORDER BY position LIMIT 1").get(id) as {position:number;encrypted_message:string}|undefined;
      if(!item){this.finish(id);return null;}
      const recipient=snapshot.recipients[item.position-1],reason=this.queue.liveReason(claimed,snapshot,recipient,manualRunner);
      if(!this.holder(id,lease))return null;
      if(reason||!this.ready(snapshot)){this.stopRemaining(id,reason||'changed');this.finish(id);return null;}
      this.db.prepare("UPDATE platform_email_pilot_recipients SET state='checking',updated_at=? WHERE job_id=? AND position=? AND state='queued'").run(new Date().toISOString(),id,item.position);return item;
    }).immediate();
    if(!row)return;
    let result:Awaited<ReturnType<PilotDelivery>>={state:'blocked',providerMessageId:null};
    try{
      const connection=this.db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=? AND organization_id=? AND project_id=? AND active=1').get(claimed.connection_id,...this.args()) as {encrypted_credentials:string};
      const credentials=decryptCredentials<StoredCredentials>(connection.encrypted_credentials,this.key,...this.args(),claimed.connection_id),mail=decryptCredentials<PilotMail>(row.encrypted_message,this.key,...this.args(),`${id}:${row.position}`);
      const reserve=()=>this.db.transaction(()=>{
        if(!this.holder(id,lease))return false;
        const reason=this.queue.liveReason(claimed,snapshot,snapshot.recipients[row.position-1],manualRunner);
        if(reason||!this.ready(snapshot)||!this.holder(id,lease))return false;
        const now=new Date().toISOString(),reserved=this.db.prepare('UPDATE platform_email_send_reservations SET submitted_at=? WHERE job_id=? AND position=? AND organization_id=? AND project_id=? AND submitted_at IS NULL').run(now,id,row.position,...this.args());
        if(!reserved.changes)return false;
        this.db.prepare("UPDATE platform_email_pilot_recipients SET state='submitting',updated_at=? WHERE job_id=? AND position=? AND state='checking'").run(now,id,row.position);
        this.db.prepare('UPDATE platform_email_ses SET last_submit_at=? WHERE organization_id=? AND project_id=?').run(now,...this.args());return true;
      }).immediate();
      result=await deliver(credentials.smtp!,credentials.accessToken,mail,reserve);
    }catch{
      const reserved=this.db.prepare('SELECT submitted_at FROM platform_email_send_reservations WHERE job_id=? AND position=?').get(id,row.position) as {submitted_at:string|null};result={state:reserved.submitted_at?'uncertain':'blocked',providerMessageId:null};
    }
    this.db.transaction(()=>{
      if(!this.holder(id,lease))return;
      const reservation=this.db.prepare('SELECT submitted_at FROM platform_email_send_reservations WHERE job_id=? AND position=?').get(id,row.position) as {submitted_at:string|null};
      if(!reservation.submitted_at)result={state:'blocked',providerMessageId:null};
      const current=this.db.prepare('SELECT state FROM platform_email_pilot_recipients WHERE job_id=? AND position=?').get(id,row.position) as {state:string};
      // Signed feedback can arrive before the SMTP response; never downgrade it.
      if(['checking','submitting'].includes(current.state))this.db.prepare('UPDATE platform_email_pilot_recipients SET state=?,reason=?,provider_message_id=?,updated_at=? WHERE job_id=? AND position=?').run(result.state==='blocked'?'skipped':result.state,result.state==='blocked'?'changed':result.state==='uncertain'?'interrupted':result.state==='rejected'?'check_failed':null,result.providerMessageId,new Date().toISOString(),id,row.position);
      if(result.state!=='accepted')this.stopRemaining(id,result.state==='uncertain'?'interrupted':'check_failed');
      this.finish(id);
    }).immediate();
  }
  private stopRemaining(id:string,reason:string){this.db.prepare("UPDATE platform_email_pilot_recipients SET state='skipped',reason=?,updated_at=? WHERE job_id=? AND state='queued'").run(reason,new Date().toISOString(),id);}
  private finish(id:string){
    const states=this.db.prepare('SELECT state FROM platform_email_pilot_recipients WHERE job_id=?').all(id) as {state:string}[],queued=states.some(r=>r.state==='queued'),unknown=states.some(r=>r.state==='uncertain'),failed=states.some(r=>['skipped','rejected'].includes(r.state));
    this.db.prepare('UPDATE platform_jobs SET status=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?').run(queued?'queued':unknown||failed?'failed':'completed',new Date().toISOString(),id);
    this.db.prepare('UPDATE platform_email_pilots SET outcome=? WHERE job_id=?').run(queued?'pending':unknown?'interrupted':failed?'partial':'checked',id);
    this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),'email.pilot_send.process',new Date().toISOString());
  }
}
