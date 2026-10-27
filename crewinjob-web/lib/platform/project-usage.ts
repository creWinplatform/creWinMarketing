import 'server-only';
import {randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import {PlatformRepository} from './repository';
import {MarketingStoreError,type MarketingScope} from './marketing-store';
import {PILOT_LIMITS} from './limits';
import {projectEntitlement,assertProjectWork} from './entitlements';
import {PLAN_CATALOG,PLAN_CATALOG_VERSION} from './plan-catalog';
import {paytrLiveReadiness} from './paytr';
import type {MonthlyResource,UsageReservation,ReservationState,PlanUsage,PlanResource} from './plan-types';

type ReservationRow={id:string;organization_id:string;project_id:string;actor_id:string;resource:MonthlyResource;period:string;status:ReservationState};
const monthlyResources:MonthlyResource[]=['ai','audits'];
const storedTables={campaigns:'platform_campaigns',content:'platform_content_history',tasks:'platform_work_items',members:'platform_memberships'} as const;
const MAX_RESERVATIONS_PER_MONTH=1000;

export class ProjectUsage {
  private repository:PlatformRepository;
  constructor(private db:Database.Database,private scope:MarketingScope){this.repository=new PlatformRepository(db);}
  private args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private authorize(write=false){if(!this.repository.can(this.scope.subject,...this.args(),write?'content.write':'read'))throw new MarketingStoreError('Proje erişimi reddedildi.',403);}
  private period(){const rights=projectEntitlement(this.db,this.scope);if(rights.id==='trial')return {key:rights.periodKey!,startsAt:rights.startsAt!,endsAt:rights.endsAt!,timezone:'UTC' as const};const now=new Date(),year=now.getUTCFullYear(),month=now.getUTCMonth();return {key:now.toISOString().slice(0,7),startsAt:new Date(Date.UTC(year,month,1)).toISOString(),endsAt:new Date(Date.UTC(year,month+1,1)).toISOString(),timezone:'UTC' as const};}
  private count(resource:MonthlyResource,period:string){
    const row=this.db.prepare('SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource=?').get(...this.args(),period,resource) as {count:number}|undefined;
    if(row&&(!Number.isSafeInteger(row.count)||row.count<0))throw new MarketingStoreError('Kullanım sayacı doğrulanamadı.',409);
    return row?.count||0;
  }
  reserve(resource:MonthlyResource='ai'):UsageReservation{
    if(!monthlyResources.includes(resource))throw new MarketingStoreError('Geçersiz kullanım türü.');
    return this.db.transaction(()=>{
      this.authorize(true);
      const rights=assertProjectWork(this.db,this.scope);
      const period=this.period().key;
      if(this.count(resource,period)>=rights.limits[resource])throw new MarketingStoreError('Dönem işlem sınırına ulaşıldı.',429);
      const now=new Date(),threshold=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-6,1));
      this.db.prepare('DELETE FROM platform_usage_reservations WHERE organization_id=? AND project_id=? AND created_at<?').run(...this.args(),threshold.toISOString());
      const attempts=this.db.prepare('SELECT COUNT(*) AS n FROM platform_usage_reservations WHERE organization_id=? AND project_id=? AND period=?').get(...this.args(),period) as {n:number};
      if(attempts.n>=MAX_RESERVATIONS_PER_MONTH)throw new MarketingStoreError('Aylık işlem denemesi sınırına ulaşıldı.',429);
      const id=randomUUID();
      this.db.prepare("INSERT INTO platform_usage_reservations VALUES(?,?,?,?,?,?,'reserved',?,NULL)").run(id,...this.args(),this.scope.subject,resource,period,new Date().toISOString());
      this.db.prepare('INSERT INTO platform_usage VALUES(?,?,?,?,1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1').run(...this.args(),period,resource);
      return {id,period,resource};
    }).immediate();
  }
  complete(reservation:UsageReservation){return this.settle(reservation,'committed');}
  release(reservation:UsageReservation){return this.settle(reservation,'released');}
  private settle(reservation:UsageReservation,status:'committed'|'released'){
    return this.db.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM platform_usage_reservations WHERE id=? AND organization_id=? AND project_id=? AND actor_id=?').get(reservation?.id||'',...this.args(),this.scope.subject) as ReservationRow|undefined;
      if(!row||row.period!==reservation.period||row.resource!==reservation.resource)throw new MarketingStoreError('İşlem kaydı bulunamadı.',404);
      if(row.status!=='reserved'){
        if(status==='committed'&&row.status==='released')throw new MarketingStoreError('Serbest bırakılan işlem tamamlanamaz.',409);
        return row.status;
      }
      if(status==='committed')this.authorize(true);
      // Release is allowed after revocation, but only for this exact actor's reservation.
      if(status==='released'){
        const changed=this.db.prepare('UPDATE platform_usage SET count=count-1 WHERE organization_id=? AND project_id=? AND period=? AND resource=? AND count>0').run(...this.args(),row.period,row.resource);
        if(!changed.changes)throw new MarketingStoreError('Kullanım sayacı uzlaştırılamadı.',409);
      }
      this.db.prepare("UPDATE platform_usage_reservations SET status=?,settled_at=? WHERE id=? AND status='reserved'").run(status,new Date().toISOString(),row.id);
      return status;
    }).immediate();
  }
  read():PlanUsage{
    return this.db.transaction(():PlanUsage=>{
    this.authorize();
    const rights=projectEntitlement(this.db,this.scope),canManage=this.repository.can(this.scope.subject,...this.args(),'billing.manage');
    const preference=this.db.prepare('SELECT plan_id AS planId,catalog_version AS catalogVersion,updated_at AS updatedAt FROM platform_plan_preferences WHERE organization_id=? AND project_id=?').get(...this.args()) as PlanUsage['commercial']['preference'];
    const period=this.period();
    const usage:Record<PlanResource,number>={ai:this.count('ai',period.key),audits:this.count('audits',period.key),campaigns:0,content:0,tasks:0,members:0};
    for(const resource of Object.keys(storedTables) as (keyof typeof storedTables)[]){
      usage[resource]=(this.db.prepare(`SELECT COUNT(*) AS n FROM ${storedTables[resource]} WHERE organization_id=? AND project_id=?`).get(...this.args()) as {n:number}).n;
    }
    const monthly=monthlyResources.map(resource=>{
      const values=this.db.prepare('SELECT status,COUNT(*) AS n FROM platform_usage_reservations WHERE organization_id=? AND project_id=? AND period=? AND resource=? GROUP BY status').all(...this.args(),period.key,resource) as {status:ReservationState;n:number}[];
      const count=(status:ReservationState)=>values.find(row=>row.status===status)?.n||0,reserved=count('reserved'),committed=count('committed'),previous=usage[resource]-reserved-committed;
      return {resource,reserved,committed,released:count('released'),previousCounter:previous<0?null:previous,consistent:previous>=0};
    });
    const recent=(this.db.prepare('SELECT id,resource,status,created_at AS createdAt,settled_at AS settledAt FROM platform_usage_reservations WHERE organization_id=? AND project_id=? AND period=? ORDER BY created_at DESC,id DESC LIMIT 10').all(...this.args(),period.key) as Omit<PlanUsage['recent'][number],'needsReview'>[]).map(row=>({...row,needsReview:row.status==='reserved'&&Date.now()-Date.parse(row.createdAt)>10*60000}));
    const providerUsage=(this.db.prepare('SELECT provider,model,COUNT(*) calls,SUM(prompt_tokens) prompt,SUM(output_tokens) output,SUM(thinking_tokens) thinking,SUM(total_tokens) total FROM platform_ai_provider_usage WHERE organization_id=? AND project_id=? AND period=? GROUP BY provider,model ORDER BY total DESC').all(...this.args(),period.key) as PlanUsage['providerUsage']);
    return {projectId:this.scope.projectId,providerUsage,plan:{id:rights.id,active:rights.active,price:null,currency:null,provider:null,checkoutEnabled:false,...(rights.id==='paid'?{paidPlan:rights.plan,...('agency' in rights&&rights.agency?{agency:rights.agency}:{}),endsAt:rights.endsAt,inGrace:rights.inGrace}:{})},period,
      commercial:{catalogVersion:PLAN_CATALOG_VERSION,catalog:PLAN_CATALOG,preference:preference||null,canManage,livePurchase:rights.id!=='pilot'&&paytrLiveReadiness().ready},
      deliveryAllowed:rights.liveDeliveryAllowed&&rights.active,
      capacities:{seats:{limit:rights.seats,used:(this.db.prepare('SELECT COUNT(*) AS n FROM platform_memberships m JOIN platform_users u ON u.id=m.user_id WHERE m.organization_id=? AND m.project_id=? AND m.active=1 AND u.active=1').get(...this.args()) as {n:number}).n},socialAccounts:{limit:rights.socialAccounts,used:(this.db.prepare("SELECT COUNT(*) AS n FROM platform_connections c JOIN platform_social_accounts s ON s.connection_id=c.id WHERE c.organization_id=? AND c.project_id=? AND c.active=1 AND c.provider='social'").get(...this.args()) as {n:number}).n}},
      resources:(Object.keys(PILOT_LIMITS) as PlanResource[]).map(resource=>({resource,used:usage[resource],limit:rights.limits[resource],remaining:Math.max(0,rights.limits[resource]-usage[resource]),kind:monthlyResources.includes(resource as MonthlyResource)?'monthly' as const:'stored' as const,state:usage[resource]>rights.limits[resource]?'over_limit' as const:usage[resource]===rights.limits[resource]?'at_limit' as const:usage[resource]>=rights.limits[resource]*.8?'near_limit' as const:'available' as const})),monthly,recent};
    })();
  }
  savePreference(input:unknown){
    return this.db.transaction(()=>{
      if(!this.repository.can(this.scope.subject,...this.args(),'billing.manage'))throw new MarketingStoreError('Paket tercihini yalnız proje sahibi değiştirebilir.',403);
      const project=this.db.prepare('SELECT product_pack FROM platform_projects WHERE organization_id=? AND id=?').get(...this.args()) as {product_pack:string}|undefined;
      if(project?.product_pack!=='standard')throw new MarketingStoreError('Bu alan Ryzevo proje hesaplarına açıktır.',403);
      const value=input as {planId?:unknown;catalogVersion?:unknown};
      if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['planId','catalogVersion'].includes(key))||!['launch','growth'].includes(String(value.planId)))throw new MarketingStoreError('Geçerli bir paket tercihi seçin.');
      if(value.catalogVersion!==PLAN_CATALOG_VERSION)throw new MarketingStoreError('Paket kataloğu değişti. Sayfayı yenileyin.',409);
      projectEntitlement(this.db,this.scope);
      const previous=this.db.prepare('SELECT plan_id,catalog_version FROM platform_plan_preferences WHERE organization_id=? AND project_id=?').get(...this.args()) as {plan_id:string;catalog_version:string}|undefined;
      if(previous&&previous.plan_id===value.planId&&previous.catalog_version===value.catalogVersion)return this.read();
      this.db.prepare('INSERT INTO platform_plan_preferences VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET plan_id=excluded.plan_id,catalog_version=excluded.catalog_version,actor_id=excluded.actor_id,updated_at=excluded.updated_at').run(...this.args(),value.planId,PLAN_CATALOG_VERSION,this.scope.subject,new Date().toISOString());
      this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),'plan.preference',new Date().toISOString());
      return this.read();
    }).immediate();
  }
}
