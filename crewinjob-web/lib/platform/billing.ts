import 'server-only';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import type Database from 'better-sqlite3';
import {PlatformRepository} from './repository';
import {MarketingStoreError,type MarketingScope} from './marketing-store';
import {encryptCredentials,decryptCredentials} from './credential-envelope';
import {paytrConfiguration,paytrCheckoutForm,requestPaytrToken,verifyPaytrNotification,type PaytrConfiguration,type PaytrTransport} from './paytr';
import type {BillingOrder,BillingOrderState,BillingCheck,BillingCheckOutcome,BillingCheckReason,ProjectBillingView} from './billing-types';
import {paytrStatusEnabled,paytrStatusForm,requestPaytrStatus,type PaytrStatusResult,type PaytrStatusTransport} from './paytr-status';

type OrderRow={id:string;organization_id:string;project_id:string;actor_id:string;idempotency_key:string;request_digest:string;configuration_revision:string;merchant_revision:string;plan_name:string;cadence:'monthly'|'yearly';amount_minor:number;state:BillingOrderState;encrypted_token:string;notification_digest:string|null;created_at:string;expires_at:string;updated_at:string;revision:number;settlement_source:BillingOrder['settlementSource']};
type CheckRow={id:string;actor_id:string;order_id:string;request_digest:string;expected_revision:number;outcome:BillingCheckOutcome;reason:BillingCheckReason|null;created_at:string;completed_at:string|null};
const timestamp=()=>new Date().toISOString();
const text=(value:unknown,min:number,max:number)=>{
  if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw new MarketingStoreError('Test ödeme bilgileri geçersiz.');
  return value.trim();
};
export class ProjectBilling {
  constructor(private db:Database.Database,private scope:MarketingScope,private key:string,private configuration:()=>PaytrConfiguration=paytrConfiguration){}
  private authorize(){
    const repo=new PlatformRepository(this.db);
    if(!repo.can(this.scope.subject,this.scope.organizationId,this.scope.projectId,'billing.manage')||repo.workspace(this.scope.subject,this.scope.organizationId,this.scope.projectId)?.project.productPack!=='standard')throw new MarketingStoreError('Ödeme alanına yalnız proje sahibi erişebilir.',403);
  }
  private row(id:string){return this.db.prepare('SELECT * FROM platform_billing_orders WHERE id=? AND organization_id=? AND project_id=?').get(id,this.scope.organizationId,this.scope.projectId) as OrderRow|undefined;}
  private view(row:OrderRow,config:PaytrConfiguration):BillingOrder {
    let checkoutUrl:string|null=null;
    if(row.state==='pending'&&row.expires_at>timestamp()&&config.readiness.ready&&row.configuration_revision===config.revision){
      try{const token=decryptCredentials<{token:string}>(row.encrypted_token,this.key,row.organization_id,row.project_id,row.id).token;if(/^[a-zA-Z0-9]{20,256}$/.test(token))checkoutUrl='https://www.paytr.com/odeme/guvenli/'+token;}catch{}
    }
    const check=this.db.prepare('SELECT * FROM platform_billing_checks WHERE order_id=? AND organization_id=? AND project_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(row.id,this.scope.organizationId,this.scope.projectId) as CheckRow|undefined;
    const latestCheck:BillingCheck|null=check?{outcome:check.outcome,reason:check.reason,createdAt:check.created_at,completedAt:check.completed_at,interrupted:check.outcome==='checking'&&Date.now()-Date.parse(check.created_at)>15000}:null;
    return {id:row.id,planName:row.plan_name,amountMinor:row.amount_minor,currency:'USD',cadence:row.cadence,state:row.state,createdAt:row.created_at,expiresAt:row.expires_at,updatedAt:row.updated_at,checkoutUrl,settlementSource:row.settlement_source,latestCheck,canCheck:paytrStatusEnabled(config)&&row.merchant_revision===config.merchantRevision&&row.state!=='rejected'&&(!check||Date.now()-Date.parse(check.created_at)>=60000)};
  }
  read():ProjectBillingView {
    this.authorize();const config=this.configuration();
    const rows=this.db.prepare('SELECT * FROM platform_billing_orders WHERE organization_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 20').all(this.scope.organizationId,this.scope.projectId) as OrderRow[];
    return {projectId:this.scope.projectId,readiness:config.readiness,emailVerified:Boolean(this.db.prepare('SELECT user_id FROM platform_account_emails WHERE user_id=?').get(this.scope.subject)),plans:config.plans,orders:rows.map(row=>this.view(row,config)),statusCheckEnabled:paytrStatusEnabled(config)};
  }
  async start(input:unknown,ip:string,transport:PaytrTransport=requestPaytrToken):Promise<BillingOrder>{
    this.authorize();const config=this.configuration();
    if(!config.readiness.ready)throw new MarketingStoreError('PayTR test kurulumu henüz tamamlanmadı.',503);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['action','planId','idempotencyKey','contact','language'].includes(key)))throw new MarketingStoreError('Geçersiz test ödeme isteği.');
    const value=input as Record<string,unknown>,plan=config.plans.find(plan=>plan.id===value.planId);
    if(!plan)throw new MarketingStoreError('Test paketi bulunamadı.',404);
    if(typeof value.idempotencyKey!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(value.idempotencyKey)||!isIP(ip))throw new MarketingStoreError('Geçersiz test ödeme isteği.');
    const email=(this.db.prepare('SELECT email FROM platform_account_emails WHERE user_id=?').get(this.scope.subject) as {email:string}|undefined)?.email;
    if(!email)throw new MarketingStoreError('Önce hesap e-postanızı doğrulayın.',409);
    const contact=value.contact as Record<string,unknown>;
    if(!contact||typeof contact!=='object'||Array.isArray(contact)||Object.keys(contact).some(key=>!['name','phone','address'].includes(key)))throw new MarketingStoreError('Test ödeme bilgileri geçersiz.');
    const name=text(contact.name,2,60),phone=text(contact.phone,5,20),address=text(contact.address,5,400),language=value.language==='en'?'en':'tr';
    if(!/^[+\d ()-]+$/.test(phone))throw new MarketingStoreError('Telefon numarası geçersiz.');
    const digest=createHash('sha256').update(JSON.stringify([this.scope.subject,plan,config.revision,name,phone,address,email,language])).digest('hex'),idempotency=createHash('sha256').update(value.idempotencyKey).digest('hex');
    const reservation=this.db.transaction(()=>{
      this.authorize();
      const existing=this.db.prepare('SELECT * FROM platform_billing_orders WHERE organization_id=? AND project_id=? AND idempotency_key=?').get(this.scope.organizationId,this.scope.projectId,idempotency) as OrderRow|undefined;
      if(existing){if(existing.request_digest!==digest)throw new MarketingStoreError('Bu istek anahtarı başka bir ödeme denemesinde kullanıldı.',409);return {row:existing,created:false};}
      if(this.db.prepare("SELECT id FROM platform_billing_orders WHERE organization_id=? AND project_id=? AND state IN ('preparing','pending','uncertain','review')").get(this.scope.organizationId,this.scope.projectId))throw new MarketingStoreError('Sonucu beklenen bir test ödemesi var. Yeni denemeden önce sonucu doğrulayın.',409);
      const count=this.db.prepare('SELECT COUNT(*) AS n FROM platform_billing_orders WHERE organization_id=? AND project_id=? AND created_at>=?').get(this.scope.organizationId,this.scope.projectId,new Date(Date.now()-86400000).toISOString()) as {n:number};
      if(count.n>=20)throw new MarketingStoreError('Günlük test ödeme sınırına ulaşıldı.',429);
      const id='RZTEST'+randomBytes(16).toString('hex'),now=timestamp(),expiresAt=new Date(Date.now()+10*60000).toISOString();
      this.db.prepare(`INSERT INTO platform_billing_orders(id,organization_id,project_id,actor_id,idempotency_key,request_digest,configuration_revision,merchant_revision,plan_id,plan_name,cadence,amount_minor,currency,test_mode,state,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'USD',1,'preparing',?,?,?)`).run(id,this.scope.organizationId,this.scope.projectId,this.scope.subject,idempotency,digest,config.revision,config.merchantRevision,plan.id,plan.name,plan.cadence,plan.amountMinor,now,expiresAt,now);
      this.audit('billing.sandbox.prepare');return {row:this.row(id)!,created:true};
    }).immediate();
    if(!reservation.created)return this.view(reservation.row,config);
    const row=reservation.row;
    let result:Awaited<ReturnType<PaytrTransport>>={state:'uncertain'};
    try{
      // Recheck immediately before the only external request; no automatic retries.
      this.authorize();if(this.configuration().revision!==config.revision||!this.configuration().readiness.ready)throw new Error('Configuration changed.');
      result=await transport(paytrCheckoutForm(config,{orderId:row.id,amountMinor:plan.amountMinor,planName:plan.name,name,email,phone,address,ip,language}));
    }catch{}
    this.db.transaction(()=>{
      const state=result.state==='accepted'?'pending':result.state;
      const token=result.state==='accepted'&&/^[a-zA-Z0-9]{20,256}$/.test(result.token)?encryptCredentials({token:result.token},this.key,this.scope.organizationId,this.scope.projectId,row.id):'';
      this.db.prepare("UPDATE platform_billing_orders SET state=?,encrypted_token=?,updated_at=?,revision=revision+1 WHERE id=? AND organization_id=? AND project_id=? AND state='preparing'").run(state==='pending'&&!token?'uncertain':state,token,timestamp(),row.id,this.scope.organizationId,this.scope.projectId);
      this.audit('billing.sandbox.response');
    }).immediate();
    this.authorize();return this.view(this.row(row.id)!,this.configuration());
  }
  async check(input:unknown,transport:PaytrStatusTransport=requestPaytrStatus):Promise<BillingOrder>{
    this.authorize();
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['action','orderId','idempotencyKey'].includes(key)))throw new MarketingStoreError('Geçersiz durum sorgusu.');
    const value=input as Record<string,unknown>;
    if(typeof value.orderId!=='string'||!/^RZTEST[a-f0-9]{32}$/.test(value.orderId)||typeof value.idempotencyKey!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(value.idempotencyKey))throw new MarketingStoreError('Geçersiz durum sorgusu.');
    const config=this.configuration(),args=[this.scope.organizationId,this.scope.projectId] as const;
    const digest=createHash('sha256').update(JSON.stringify([this.scope.subject,value.orderId,config.merchantRevision])).digest('hex'),key=createHash('sha256').update(value.idempotencyKey).digest('hex');
    const reservation=this.db.transaction(()=>{
      this.authorize();const order=this.row(value.orderId as string);if(!order)throw new MarketingStoreError('Test ödemesi bulunamadı.',404);
      const previous=this.db.prepare('SELECT * FROM platform_billing_checks WHERE organization_id=? AND project_id=? AND idempotency_key=?').get(...args,key) as CheckRow|undefined;
      if(previous){if(previous.request_digest!==digest)throw new MarketingStoreError('İşlem anahtarı başka bir sorguya ait.',409);return {order,check:previous,created:false};}
      if(!paytrStatusEnabled(config))throw new MarketingStoreError('PayTR test durum sorgusu henüz yapılandırılmadı.',503);
      if(order.merchant_revision!==config.merchantRevision)throw new MarketingStoreError('Mağaza bilgileri değişti. Eski test için yönetici kontrolü gerekli.',409);
      if(order.state==='rejected')throw new MarketingStoreError('Reddedilen hazırlık isteği sorgulanamaz.',409);
      const now=timestamp();
      this.db.prepare("UPDATE platform_billing_checks SET outcome='unavailable',reason='interrupted',completed_at=? WHERE order_id=? AND outcome='checking' AND created_at<?").run(now,order.id,new Date(Date.now()-15000).toISOString());
      if(this.db.prepare('SELECT id FROM platform_billing_checks WHERE order_id=? AND created_at>?').get(order.id,new Date(Date.now()-60000).toISOString()))throw new MarketingStoreError('Bu test yakın zamanda sorgulandı. Bir dakika sonra tekrar deneyin.',429);
      const total=this.db.prepare('SELECT COUNT(*) AS n FROM platform_billing_checks WHERE organization_id=? AND project_id=? AND created_at>=?').get(...args,new Date(Date.now()-86400000).toISOString()) as {n:number};
      if(total.n>=40)throw new MarketingStoreError('Günlük test durum sorgusu sınırına ulaşıldı.',429);
      const id=randomUUID();
      this.db.prepare("INSERT INTO platform_billing_checks VALUES(?,?,?,?,?,?,?,?,?,'checking',NULL,?,NULL)").run(id,...args,order.id,this.scope.subject,key,digest,order.revision,config.merchantRevision,now);
      this.audit('billing.sandbox.check.requested');return {order,check:{id,expected_revision:order.revision},created:true};
    }).immediate();
    if(!reservation.created)return this.view(reservation.order,this.configuration());
    const {order,check}=reservation;
    let result:PaytrStatusResult={status:'unavailable'},before:BillingCheckReason|null=null;
    try{
      this.authorize();const current=this.configuration();
      if(!paytrStatusEnabled(current)||current.merchantRevision!==config.merchantRevision)before='configuration_changed';
      else if(this.row(order.id)?.revision!==check.expected_revision)before='order_changed';
      else result=await transport(paytrStatusForm(config,order.id));
    }catch{}
    this.db.transaction(()=>{
      const pending=this.db.prepare("SELECT created_at FROM platform_billing_checks WHERE id=? AND outcome='checking'").get(check.id) as {created_at:string}|undefined;if(!pending)return;
      if(Date.now()-Date.parse(pending.created_at)>15000)before='interrupted';
      let outcome:BillingCheckOutcome='unavailable',reason:BillingCheckReason='provider_unavailable';
      const current=this.configuration(),latest=this.row(order.id)!;
      try{this.authorize();}catch{before='authority_lost';}
      if(!before&&(!paytrStatusEnabled(current)||current.merchantRevision!==config.merchantRevision))before='configuration_changed';
      if(!before&&latest.revision!==check.expected_revision)before='order_changed';
      if(before){outcome='changed';reason=before;}
      else if(result.status==='not_confirmed'){outcome='not_confirmed';reason='no_confirmed_payment';}
      else if(result.status==='invalid_response')reason='invalid_response';
      else if(result.status==='payment_found'){
        const matches=result.amountMinor===order.amount_minor&&result.totalMinor===order.amount_minor&&result.currency==='USD'&&result.testMode===true&&result.card===true&&result.installments===false&&result.hasRefunds===false;
        if(!matches||['test_failed','rejected'].includes(latest.state)){
          outcome='mismatch';reason=result.hasRefunds?'refund_observed':matches?'contradicting_result':'details_mismatch';
          this.db.prepare("UPDATE platform_billing_orders SET state='review',encrypted_token='',updated_at=?,revision=revision+1 WHERE id=?").run(timestamp(),order.id);
        }else{
          outcome='confirmed';reason=latest.state==='review'?'review_required':'matched';
          // A contradictory history remains in review; positive inquiry never grants paid access.
          if(['preparing','pending','uncertain'].includes(latest.state))this.db.prepare("UPDATE platform_billing_orders SET state='test_paid',settlement_source='status_inquiry',encrypted_token='',updated_at=?,revision=revision+1 WHERE id=?").run(timestamp(),order.id);
        }
      }
      this.db.prepare('UPDATE platform_billing_checks SET outcome=?,reason=?,completed_at=? WHERE id=?').run(outcome,reason,timestamp(),check.id);
      this.audit('billing.sandbox.check.'+outcome);
    }).immediate();
    this.authorize();return this.view(this.row(order.id)!,this.configuration());
  }
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,this.scope.organizationId,this.scope.projectId,operation,timestamp());}
}

export function receivePaytrNotification(db:Database.Database,body:string,config:PaytrConfiguration=paytrConfiguration()){
  const notice=verifyPaytrNotification(config,body);
  return db.transaction(()=>{
    // The authenticated order ID determines scope, never a cookie or submitted tenant ID.
    const row=db.prepare('SELECT * FROM platform_billing_orders WHERE id=?').get(notice.orderId) as OrderRow|undefined;
    if(!row||row.merchant_revision!==config.merchantRevision)throw new MarketingStoreError('Bildirim eşleştirilemedi.',409);
    if(row.notification_digest===notice.digest)return;
    const contradiction=row.state==='review'||row.state==='test_paid'&&notice.status!=='success'||row.state==='test_failed'&&notice.status==='success';
    const conflict=Boolean(row.notification_digest)||contradiction||!notice.metadataMatches||notice.status==='success'&&notice.totalMinor!==row.amount_minor;
    const state:BillingOrderState=conflict?'review':notice.status==='success'?'test_paid':'test_failed';
    db.prepare('UPDATE platform_billing_orders SET state=?,notification_digest=?,encrypted_token=\'\',updated_at=?,revision=revision+1,settlement_source=CASE WHEN ? IN (\'test_paid\',\'test_failed\') THEN \'notification\' ELSE settlement_source END WHERE id=?').run(state,notice.digest,timestamp(),state,row.id);
    db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(row.actor_id,row.organization_id,row.project_id,'billing.sandbox.'+state,timestamp());
    // Sandbox results never change platform_usage, plan limits or subscription entitlements.
  }).immediate();
}
