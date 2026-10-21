import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { LocalizedText } from './catalog';
import { PlatformRepository } from './repository';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { adMinorUnit } from './ad-manager';
import { validRange, type PaidInputs, type SeoInputs } from './budget-math';

export type MeasuredValue={value:number;label:LocalizedText;source:string;from:string|null;to:string|null;at:string};
export type BudgetScenario={id:string;name:string;kind:'paid'|'seo';currency:string;inputs:PaidInputs|SeoInputs;sources:Record<string,string>;revision:number;updatedAt:string};
export type BudgetSnapshot={
  currency:string;minorUnit:number;
  measured:{cpc:MeasuredValue|null;ctr:MeasuredValue|null;organicClicksPerDay:MeasuredValue|null;conversions:(MeasuredValue&{goal:LocalizedText;from_:LocalizedText;to_:LocalizedText})[]};
  scenarios:BudgetScenario[];canWrite:boolean;
};
const MAX=1e12,LIMIT=30;
const days=(from:string,to:string)=>Math.round((Date.parse(`${to.slice(0,10)}T00:00:00Z`)-Date.parse(`${from.slice(0,10)}T00:00:00Z`))/86400000)+1;

// Budget and goal planner: the team's own scenarios, plus values measured for this project (with source and period)
// that can replace an assumption. Read and bookkeeping only; nothing is predicted, bought or sent.
export class BudgetPlanner{
  repo:PlatformRepository;
  constructor(public db:Database.Database,public scope:MarketingScope){this.repo=new PlatformRepository(db);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private can(permission:'read'|'content.write'){return this.repo.can(this.scope.subject,...this.args(),permission);}
  authorize(permission:'read'|'content.write'='read'){
    if(!this.can('read')||this.repo.workspace(this.scope.subject,...this.args())?.project.productPack!=='standard')throw new MarketingStoreError('Bütçe planlayıcı için standart proje erişimi gerekli.',403);
    if(!this.can(permission))throw new MarketingStoreError('Bu işlem için içerik yazma yetkisi gerekir.',403);
  }
  private currency(){const plan=this.db.prepare("SELECT currency FROM platform_ad_plans WHERE organization_id=? AND project_id=? AND provider='meta' ORDER BY updated_at DESC LIMIT 1").get(...this.args()) as {currency:string}|undefined;
    return plan?.currency||(this.repo.workspace(this.scope.subject,...this.args())!.project.language==='en'?'USD':'TRY');}
  // Meta-reported totals across this project's ad plans: CPC = spend ÷ clicks, CTR = clicks ÷ impressions.
  private meta(currency:string){
    const row=this.db.prepare("SELECT SUM(spend_minor) spend,SUM(clicks) clicks,SUM(impressions) impressions,MAX(spend_checked_at) at,MIN(start_date) from_,MIN(MAX(end_date),substr(MAX(spend_checked_at),1,10)) to_ FROM platform_ad_plans WHERE organization_id=? AND project_id=? AND provider='meta' AND currency=? AND spend_checked_at IS NOT NULL AND clicks IS NOT NULL").get(...this.args(),currency) as {spend:number|null;clicks:number|null;impressions:number|null;at:string|null;from_:string|null;to_:string|null};
    if(!row.at||!row.clicks)return {cpc:null,ctr:null};
    const unit=adMinorUnit(currency),base={source:'meta',from:row.from_,to:row.to_,at:row.at};
    return {cpc:{...base,value:(row.spend||0)/unit/row.clicks,label:{tr:'Meta’nın bildirdiği tıklama başı maliyet',en:'Cost per click reported by Meta'}},
      ctr:row.impressions?{...base,value:row.clicks/row.impressions,label:{tr:'Meta’nın bildirdiği tıklama oranı',en:'Click-through rate reported by Meta'}}:null};
  }
  // Latest automatic Search Console "clicks" reading, as an average per day over its measured period.
  private organic():MeasuredValue|null{
    const row=this.db.prepare("SELECT e.value,e.period_from,e.period_to,e.observed_at FROM platform_metric_entries e JOIN platform_measurement_bindings b ON b.id=e.binding_id WHERE e.organization_id=? AND e.project_id=? AND e.source='search_console' AND json_extract(b.definition_json,'$.metric')='clicks' AND e.period_from IS NOT NULL ORDER BY e.period_to DESC,e.observed_at DESC LIMIT 1").get(...this.args()) as {value:number;period_from:string;period_to:string;observed_at:string}|undefined;
    if(!row)return null;const length=days(row.period_from,row.period_to);
    return length>0?{value:row.value/length,label:{tr:'Search Console organik tıklama, günlük ortalama',en:'Search Console organic clicks, daily average'},source:'search_console',from:row.period_from,to:row.period_to,at:row.observed_at}:null;
  }
  // Stage-to-stage rates from automatic readings of the SAME goal, source and period (e.g. key events ÷ sessions).
  // Only readings whose mapping still matches the goal as it is today count, so renamed or reordered stages never mislabel a rate.
  private conversions(){
    const project=this.repo.workspace(this.scope.subject,...this.args())!.project,list:BudgetSnapshot['measured']['conversions']=[];
    const rows=this.db.prepare("SELECT e.goal_id,e.stage_index,e.value,e.source,e.period_from,e.period_to,e.observed_at,b.goal_signature FROM platform_metric_entries e JOIN platform_measurement_bindings b ON b.id=e.binding_id WHERE e.organization_id=? AND e.project_id=? AND e.source<>'manual' AND e.period_from IS NOT NULL ORDER BY e.period_to DESC,e.observed_at DESC LIMIT 400").all(...this.args()) as {goal_id:string;stage_index:number;value:number;source:string;period_from:string;period_to:string;observed_at:string;goal_signature:string}[];
    for(const goal of project.goals){
      const seen=new Set<string>(),signature=createHash('sha256').update(JSON.stringify(goal)).digest('hex'),current=rows.filter(row=>row.goal_id===goal.id&&row.goal_signature===signature);
      for(const later of current){
        for(const earlier of current.filter(row=>row.stage_index<later.stage_index&&row.source===later.source&&row.period_from===later.period_from&&row.period_to===later.period_to)){
          const key=`${earlier.stage_index}:${later.stage_index}`;if(seen.has(key)||!(earlier.value>0))continue;seen.add(key);
          list.push({goal:goal.label,from_:goal.stages[earlier.stage_index],to_:goal.stages[later.stage_index],value:later.value/earlier.value,label:{tr:`${goal.stages[later.stage_index].tr} ÷ ${goal.stages[earlier.stage_index].tr}`,en:`${goal.stages[later.stage_index].en} ÷ ${goal.stages[earlier.stage_index].en}`},source:later.source,from:later.period_from,to:later.period_to,at:later.observed_at});
        }
      }
    }
    return list.slice(0,10);
  }
  read():BudgetSnapshot{
    this.authorize();const currency=this.currency();
    const scenarios=(this.db.prepare('SELECT * FROM platform_budget_scenarios WHERE organization_id=? AND project_id=? ORDER BY updated_at DESC,id').all(...this.args()) as {id:string;name:string;kind:'paid'|'seo';currency:string;inputs_json:string;sources_json:string;revision:number;updated_at:string}[])
      .map(row=>({id:row.id,name:row.name,kind:row.kind,currency:row.currency,inputs:JSON.parse(row.inputs_json),sources:JSON.parse(row.sources_json),revision:row.revision,updatedAt:row.updated_at}));
    return {currency,minorUnit:adMinorUnit(currency),measured:{...this.meta(currency),organicClicksPerDay:this.organic(),conversions:this.conversions()},scenarios,canWrite:this.can('content.write')};
  }
  // Validates a scenario: money ≥ 0, rates in 0–1 (growth −1 to +10), every range low ≤ high.
  normalize(raw:Record<string,unknown>){
    const name=typeof raw.name==='string'?raw.name.trim():'';if(!name||name.length>80)throw new MarketingStoreError('Senaryo adı 1–80 karakter olmalı.');
    const kind=raw.kind==='paid'||raw.kind==='seo'?raw.kind:null;if(!kind)throw new MarketingStoreError('Senaryo türü geçersiz.');
    const currency=typeof raw.currency==='string'&&/^[A-Z]{3}$/.test(raw.currency)?raw.currency:null;if(!currency)throw new MarketingStoreError('Para birimi geçersiz.');
    const input=raw.inputs&&typeof raw.inputs==='object'?raw.inputs as Record<string,unknown>:{},bad=()=>new MarketingStoreError('Senaryo değerleri geçersiz: tutarlar 0 veya üzeri, oranlar 0–1 arası ve her aralıkta alt değer üst değerden büyük olmamalı.');
    const money=(value:unknown)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>MAX)throw bad();return value;};
    const range=(value:unknown,min:number,max:number,positive=false)=>{const item=value&&typeof value==='object'?value as Record<string,unknown>:{},result={low:Number(item.low),high:Number(item.high)};if(!validRange(result,min,max)||positive&&result.low<=0)throw bad();return result;};
    const optional=(value:unknown)=>value===null||value===undefined?null:range(value,0,1);
    const value=input.value===null||input.value===undefined?null:money(input.value);
    const inputs:PaidInputs|SeoInputs=kind==='paid'?{budget:money(input.budget),cpc:range(input.cpc,0,MAX,true),conversion:range(input.conversion,0,1),close:optional(input.close),value}
      :{hours:money(input.hours),hourlyRate:money(input.hourlyRate),tools:money(input.tools),pieces:money(input.pieces),pieceCost:money(input.pieceCost),clicks:money(input.clicks),growth:range(input.growth,-1,10),conversion:range(input.conversion,0,1),close:optional(input.close),value};
    const sources:Record<string,string>={};
    for(const [key,label] of Object.entries(raw.sources&&typeof raw.sources==='object'?raw.sources as Record<string,unknown>:{}).slice(0,12))if(/^[a-zA-Z]{1,20}$/.test(key)&&typeof label==='string'&&label.length<=160&&!/[\x00-\x1f]/.test(label))sources[key]=label;
    return {name,kind,currency,inputs,sources};
  }
  save(raw:Record<string,unknown>){
    this.authorize('content.write');const value=this.normalize(raw);
    return this.db.transaction(()=>{
      this.authorize('content.write');const now=new Date().toISOString();
      if(raw.id===undefined){
        if((this.db.prepare('SELECT COUNT(*) n FROM platform_budget_scenarios WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n>=LIMIT)throw new MarketingStoreError('Senaryo sınırına ulaşıldı.',429);
        this.db.prepare('INSERT INTO platform_budget_scenarios(id,organization_id,project_id,name,kind,currency,inputs_json,sources_json,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(`budget_${randomUUID()}`,...this.args(),value.name,value.kind,value.currency,JSON.stringify(value.inputs),JSON.stringify(value.sources),this.scope.subject,this.scope.subject,now,now);
      }else{
        const row=this.db.prepare('SELECT revision FROM platform_budget_scenarios WHERE id=? AND organization_id=? AND project_id=?').get(raw.id,...this.args()) as {revision:number}|undefined;
        if(!row)throw new MarketingStoreError('Senaryo bulunamadı.',404);if(raw.expectedRevision!==row.revision)throw new MarketingStoreError('Senaryo başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
        this.db.prepare('UPDATE platform_budget_scenarios SET name=?,kind=?,currency=?,inputs_json=?,sources_json=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=?').run(value.name,value.kind,value.currency,JSON.stringify(value.inputs),JSON.stringify(value.sources),this.scope.subject,now,raw.id);
      }
      this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),'budget.scenario.save',now);return this.read();
    }).immediate();
  }
  remove(raw:Record<string,unknown>){
    this.authorize('content.write');
    return this.db.transaction(()=>{const removed=this.db.prepare('DELETE FROM platform_budget_scenarios WHERE id=? AND organization_id=? AND project_id=?').run(raw.id,...this.args()).changes;if(!removed)throw new MarketingStoreError('Senaryo bulunamadı.',404);return this.read();}).immediate();
  }
}
