import 'server-only';
import {createHash,randomBytes} from 'node:crypto';
import type Database from 'better-sqlite3';
import {PlatformRepository} from './repository';
import {MarketingStoreError,type MarketingScope} from './marketing-store';
import type {WorkspacePermission} from './access';
import type {GoalDefinition} from './catalog';
import {normalizeProductSource} from './product-data-types';
import {normalizeWebhookConfig,WEBHOOK_LIMITS} from './product-webhook-types';
import {normalizeSegmentDefinition,SEGMENT_LIMITS,type StoredSegmentDefinition,type SegmentSource,type SegmentSummary,type SegmentPreview,type SegmentBinding} from './segment-types';
import {evaluateSegment,type SegmentEvent,type SegmentEntity} from './segment-engine';

type SourceRow={connection_id:string;version:number;config_json:string;enabled:number;encrypted_checkpoint:string;last_synced_at:string|null;event_coverage_from:string|null;webhook_actor_id:string|null;active:number;provider:string;account_name:string};
type SegmentRow={id:string;name:string;version:number;archived:number;updated_at:string};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceQuery=`SELECT s.*,c.active,c.provider,c.account_name FROM platform_product_sources s JOIN platform_connections c ON c.id=s.connection_id AND c.organization_id=s.organization_id AND c.project_id=s.project_id WHERE s.organization_id=? AND s.project_id=? AND c.provider IN ('product_rest','product_webhook')`;
export class ProductSegments {
  constructor(private db:Database.Database,private scope:MarketingScope){}
  private args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private repo(){return new PlatformRepository(this.db);}
  authorize(permission:WorkspacePermission='read'){
    const repo=this.repo();
    if(!repo.can(this.scope.subject,...this.args(),permission)||repo.workspace(this.scope.subject,...this.args())?.project.productPack!=='standard')throw new MarketingStoreError('Standart proje segment erişimi gerekli.',403);
  }
  private goals():GoalDefinition[]{return this.repo().workspace(this.scope.subject,...this.args())!.project.goals;}
  private fingerprint(goalId:string,stageIndex:number|null){
    if(!goalId)return null;
    const goal=this.goals().find(goal=>goal.id===goalId);
    if(!goal||stageIndex===null||!goal.stages[stageIndex])throw new MarketingStoreError('Segmentin bağlı olduğu hedef veya aşama değişti. Kuralı yeniden kaydedin.',409);
    return digest([goal.id,stageIndex,goal.stages[stageIndex]]);
  }
  private source(id:string):SegmentSource {
    const row=this.db.prepare(`${sourceQuery} AND s.connection_id=?`).get(...this.args(),id) as SourceRow|undefined;
    if(!row)throw new MarketingStoreError('Proje veri kaynağı bulunamadı.',404);
    const kind=row.provider==='product_rest'?'rest':'webhook',config=kind==='rest'?normalizeProductSource(JSON.parse(row.config_json)):normalizeWebhookConfig(JSON.parse(row.config_json));
    const delegated=kind==='rest'||Boolean(row.webhook_actor_id&&this.repo().can(row.webhook_actor_id,...this.args(),'connections.manage'));
    return {id,name:row.account_name,version:row.version,kind,entityType:config.entityType,attributes:config.attributes.map(({key,type})=>({key,type})),eventNames:kind==='webhook'?(config as ReturnType<typeof normalizeWebhookConfig>).eventNames:[],state:!row.active||!row.enabled?'inactive':delegated?'active':'blocked',lastSyncedAt:row.last_synced_at,coverageFrom:row.event_coverage_from,hasMore:Boolean(row.encrypted_checkpoint)};
  }
  sources(){this.authorize('content.write');return (this.db.prepare(`${sourceQuery} ORDER BY c.account_name`).all(...this.args()) as SourceRow[]).map(row=>this.source(row.connection_id));}
  private row(id:string):SegmentRow {
    const row=this.db.prepare('SELECT * FROM platform_segments WHERE id=? AND organization_id=? AND project_id=?').get(id,...this.args()) as SegmentRow|undefined;
    if(!row)throw new MarketingStoreError('Segment bulunamadı.',404);return row;
  }
  private definition(id:string,version:number):StoredSegmentDefinition {
    if(!Number.isSafeInteger(version)||version<1)throw new MarketingStoreError('Segment sürümü gerekli.');
    const row=this.db.prepare('SELECT definition_json FROM platform_segment_versions WHERE segment_id=? AND version=? AND organization_id=? AND project_id=?').get(id,version,...this.args()) as {definition_json:string}|undefined;
    if(!row)throw new MarketingStoreError('Segment sürümü bulunamadı.',404);return JSON.parse(row.definition_json);
  }
  private summary(row:SegmentRow):SegmentSummary {
    const preview=this.db.prepare('SELECT counts_json,computed_at FROM platform_segment_previews WHERE segment_id=? AND version=? AND organization_id=? AND project_id=?').get(row.id,row.version,...this.args()) as {counts_json:string;computed_at:string}|undefined;
    return {id:row.id,name:row.name,version:row.version,archived:Boolean(row.archived),definition:this.definition(row.id,row.version),updatedAt:row.updated_at,preview:preview?{...JSON.parse(preview.counts_json),computedAt:preview.computed_at}:null};
  }
  list(){this.authorize();return (this.db.prepare('SELECT * FROM platform_segments WHERE organization_id=? AND project_id=? ORDER BY updated_at DESC,id').all(...this.args()) as SegmentRow[]).map(row=>this.summary(row));}
  versions(id:string){this.authorize();this.row(id);return (this.db.prepare('SELECT version,created_at AS createdAt FROM platform_segment_versions WHERE segment_id=? AND organization_id=? AND project_id=? ORDER BY version DESC').all(id,...this.args()) as {version:number;createdAt:string}[]).map(item=>({...item,definition:this.definition(id,item.version)}));}
  save(input:{id?:string;version?:number;name:string;definition:unknown}) {
    this.authorize('content.write');
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>160)throw new MarketingStoreError('Segment adı gerekli (en fazla 160 karakter).');
    return this.db.transaction(()=>{
      const current=input.id?this.row(input.id):null;
      if(current&&(current.version!==input.version||current.archived))throw new MarketingStoreError('Segment sürümü değişti veya arşivlendi.',409);
      const count=(this.db.prepare('SELECT COUNT(*) AS n FROM platform_segments WHERE organization_id=? AND project_id=?').get(...this.args()) as {n:number}).n;
      if(!current&&count>=SEGMENT_LIMITS.segments||current&&current.version>=SEGMENT_LIMITS.versions)throw new MarketingStoreError('Pilot segment veya sürüm sınırına ulaşıldı.',429);
      const sourceId=(input.definition as {sourceId?:unknown})?.sourceId;
      if(typeof sourceId!=='string')throw new MarketingStoreError('Veri kaynağı seçin.');
      const source=this.source(sourceId);let normalized;
      try{normalized=normalizeSegmentDefinition(input.definition,source,this.goals());}catch(error){throw new MarketingStoreError(error instanceof Error?error.message:'Kural geçersiz.');}
      const definition:StoredSegmentDefinition={...normalized,goalFingerprint:this.fingerprint(normalized.goalId,normalized.stageIndex)},id=current?.id||randomBytes(16).toString('hex'),version=(current?.version||0)+1,now=new Date().toISOString();
      this.db.prepare('INSERT INTO platform_segments VALUES(?,?,?,?,?,0,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,updated_at=excluded.updated_at').run(id,...this.args(),input.name.trim(),version,now,now);
      this.db.prepare('INSERT INTO platform_segment_versions VALUES(?,?,?,?,?,?,?,?,?)').run(id,version,...this.args(),source.id,source.version,JSON.stringify(definition),now,this.scope.subject);
      this.audit('segment.save');return this.summary(this.row(id));
    })();
  }
  archive(id:string,version:number,archived:boolean){
    this.authorize('content.write');return this.db.transaction(()=>{
      const row=this.row(id);if(row.version!==version)throw new MarketingStoreError('Segment sürümü değişti.',409);
      this.db.prepare('UPDATE platform_segments SET archived=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=?').run(Number(archived),new Date().toISOString(),id,...this.args());this.audit(archived?'segment.archive':'segment.restore');return this.summary(this.row(id));
    })();
  }
  private compute(definition:StoredSegmentDefinition,id:string|null,version:number|null,members?:SegmentEntity[]):SegmentPreview {
    const source=this.source(definition.sourceId),now=Date.now();
    if(source.version!==definition.sourceVersion)throw new MarketingStoreError('Kaynak şeması değişti. Segmenti güncel şemayla yeniden kaydedin.',409);
    if(source.state!=='active'||source.hasMore)throw new MarketingStoreError('Kaynak etkin olmalı ve bekleyen REST sayfaları tamamlanmalı.',409);
    if(!source.lastSyncedAt||!Number.isFinite(Date.parse(source.lastSyncedAt))||now-Date.parse(source.lastSyncedAt)>definition.maxAgeHours*3600000)throw new MarketingStoreError('Kaynak verisi eski veya hiç alınmadı. Kaynağı güncelleyin.',409);
    if(this.fingerprint(definition.goalId,definition.stageIndex)!==definition.goalFingerprint)throw new MarketingStoreError('Hedef aşaması değişti. Segmenti yeniden kaydedin.',409);
    const cutoff=new Date(now-WEBHOOK_LIMITS.retentionDays*86400000).toISOString();
    const budget=this.db.prepare(`SELECT COUNT(*) AS n,COALESCE(SUM(LENGTH(CAST(attributes_json AS BLOB))),0) AS bytes FROM platform_product_records WHERE connection_id=? AND version=? AND organization_id=? AND project_id=? ${source.kind==='webhook'?'AND received_at>=?':''}`).get(source.id,source.version,...this.args(),...(source.kind==='webhook'?[cutoff]:[])) as {n:number;bytes:number};
    if(budget.n>10000||budget.bytes>8*1024*1024)throw new MarketingStoreError('Pilot hesaplama sınırı aşıldı (10.000 kayıt / 8 MB).',429);
    const records=this.db.prepare(`SELECT external_id,attributes_json,observed_at FROM platform_product_records WHERE connection_id=? AND version=? AND organization_id=? AND project_id=? ${source.kind==='webhook'?'AND received_at>=?':''} ORDER BY external_id LIMIT 10001`).all(source.id,source.version,...this.args(),...(source.kind==='webhook'?[cutoff]:[])) as {external_id:string;attributes_json:string;observed_at:string}[];
    const events=source.kind==='webhook'?this.db.prepare('SELECT event_id,entity_id,event_name,occurred_at FROM platform_product_events WHERE connection_id=? AND version=? AND organization_id=? AND project_id=? AND received_at>=? ORDER BY event_id LIMIT 10001').all(source.id,source.version,...this.args(),cutoff) as {event_id:string;entity_id:string;event_name:string;occurred_at:string}[]:[];
    if(records.length>10000||events.length>10000)throw new MarketingStoreError('Pilot hesaplama sınırı aşıldı.',429);
    const byEntity=new Map<string,SegmentEvent[]>(),states:(boolean|null)[]=[];
    for(const event of events){const list=byEntity.get(event.entity_id)||[];list.push({entityId:event.entity_id,name:event.event_name,occurredAt:event.occurred_at});byEntity.set(event.entity_id,list);}
    let matched=0,unknown=0;const samples:SegmentPreview['samples']=[],showSamples=this.repo().can(this.scope.subject,...this.args(),'content.write'),types=Object.fromEntries(source.attributes.map(field=>[field.key,field.type]));
    for(const record of records){
      const result=evaluateSegment(definition.rules,{id:record.external_id,attributes:JSON.parse(record.attributes_json),observedAt:record.observed_at},byEntity.get(record.external_id)||[],now,source.coverageFrom,types);
      states.push(result.match);
      if(result.match===null)unknown++;
      if(result.match===true){matched++;members?.push({id:record.external_id,attributes:JSON.parse(record.attributes_json),observedAt:record.observed_at});if(showSamples&&samples.length<5)samples.push({id:`...${record.external_id.slice(-4)}`,observedAt:record.observed_at,reasons:result.reasons});}
    }
    const dataRevision=digest([source.id,source.version,source.lastSyncedAt,source.coverageFrom,records,events,states]);
    return {segmentId:id,version,total:records.length,matched,unknown,excluded:records.length-matched-unknown,computedAt:new Date(now).toISOString(),expiresAt:new Date(now+SEGMENT_LIMITS.previewMinutes*60000).toISOString(),sourceId:source.id,sourceVersion:source.version,sourceSyncedAt:source.lastSyncedAt,coverageFrom:source.coverageFrom,timezone:this.repo().workspace(this.scope.subject,...this.args())!.project.timezone,dataRevision,ruleDigest:digest(definition),metric:'matching_entities',samples,warnings:[...(unknown?['incomplete_event_history']:[]),'observed_source_population','consent_not_verified']};
  }
  // Internal worker evaluation: reuse the same engine without consuming an operator preview.
  evaluateSaved(id:string,version:number,members?:SegmentEntity[]) {
    this.authorize('content.write');
    if(this.row(id).archived)throw new MarketingStoreError('Arşivlenen segment hesaplanamaz.',409);
    return this.compute(this.definition(id,version),id,version,members);
  }
  preview(input:{id?:string;version?:number;definition?:unknown},members?:SegmentEntity[]) {
    this.authorize(input.definition?'content.write':'read');
    this.db.transaction(()=>{
      const period=new Date().toISOString().slice(0,10),used=this.db.prepare("SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND period=? AND resource='segment_preview'").get(...this.args(),period) as {count:number}|undefined;
      if((used?.count||0)>=SEGMENT_LIMITS.previewPerDay)throw new MarketingStoreError('Günlük segment önizleme sınırına ulaşıldı.',429);
      this.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'segment_preview',1) ON CONFLICT(organization_id,project_id,period,resource) DO UPDATE SET count=count+1").run(...this.args(),period);
    })();
    return this.db.transaction(()=>{
      let definition:StoredSegmentDefinition;
      if(input.definition){
        const sourceId=(input.definition as {sourceId?:unknown})?.sourceId;if(typeof sourceId!=='string')throw new MarketingStoreError('Kaynak gerekli.');
        let normalized;try{normalized=normalizeSegmentDefinition(input.definition,this.source(sourceId),this.goals());}catch(error){throw new MarketingStoreError(error instanceof Error?error.message:'Kural geçersiz.');}
        definition={...normalized,goalFingerprint:this.fingerprint(normalized.goalId,normalized.stageIndex)};
      }else{
        const row=this.row(input.id||'');if(row.archived)throw new MarketingStoreError('Arşivlenen segment hesaplanamaz.',409);definition=this.definition(row.id,input.version!);
      }
      const result=this.compute(definition,input.definition?null:input.id!,input.definition?null:input.version!,members);
      if(result.segmentId)this.db.prepare('INSERT INTO platform_segment_previews VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(segment_id,version) DO UPDATE SET rule_digest=excluded.rule_digest,data_revision=excluded.data_revision,counts_json=excluded.counts_json,computed_at=excluded.computed_at').run(result.segmentId,result.version,...this.args(),result.ruleDigest,result.dataRevision,JSON.stringify({total:result.total,matched:result.matched,unknown:result.unknown}),result.computedAt);
      return result;
    })();
  }
  binding(id:string,version:number,goalId:string):SegmentBinding {
    this.authorize('content.write');return this.db.transaction(()=>{const row=this.row(id);if(row.archived)throw new MarketingStoreError('Arşivlenen segment bağlanamaz.',409);
    const definition=this.definition(id,version);
    if(definition.goalId&&definition.goalId!==goalId)throw new MarketingStoreError('Kampanya ve segment hedefi eşleşmiyor.',409);
    const current=this.compute(definition,id,version),receipt=this.db.prepare('SELECT * FROM platform_segment_previews WHERE segment_id=? AND version=? AND organization_id=? AND project_id=?').get(id,version,...this.args()) as {rule_digest:string;data_revision:string;computed_at:string}|undefined;
    if(!receipt||Date.now()-Date.parse(receipt.computed_at)>SEGMENT_LIMITS.previewMinutes*60000||receipt.rule_digest!==current.ruleDigest||receipt.data_revision!==current.dataRevision)throw new MarketingStoreError('Bu segment sürümünün güncel önizlemesini yapın; veri değişmiş veya 15 dakika geçmiş olabilir.',409);
    return {segmentId:id,segmentVersion:version,ruleDigest:current.ruleDigest,sourceId:definition.sourceId,sourceVersion:definition.sourceVersion,goalId:definition.goalId,stageIndex:definition.stageIndex};})();
  }
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
}
