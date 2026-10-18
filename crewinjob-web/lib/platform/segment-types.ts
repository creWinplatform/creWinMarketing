import type {GoalDefinition} from './catalog';
import type {ProductAttributeType} from './product-data-types';
export type SegmentScalar=string|number|boolean;
export type AttributeOperator='eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'in'|'empty'|'not_empty';
export type SegmentCondition=
  |{kind:'attribute';field:string;op:AttributeOperator;value?:SegmentScalar|SegmentScalar[]}
  |{kind:'event';eventName:string;op:'exists'|'absent';days:number}
  |{kind:'activity';op:'within'|'not_within';days:number};
export type SegmentGroup={kind:'group';op:'and'|'or';children:SegmentRule[]};
export type SegmentRule=SegmentGroup|SegmentCondition;
export type SegmentDefinition={sourceId:string;sourceVersion:number;maxAgeHours:number;rules:SegmentGroup;goalId:string;stageIndex:number|null};
export type StoredSegmentDefinition=SegmentDefinition&{goalFingerprint:string|null};
export type SegmentSource={id:string;name:string;version:number;kind:'rest'|'webhook';entityType:string;attributes:{key:string;type:ProductAttributeType}[];eventNames:string[];state:'active'|'inactive'|'blocked';lastSyncedAt:string|null;coverageFrom:string|null;hasMore:boolean};
export type SegmentSummary={id:string;name:string;version:number;archived:boolean;definition:StoredSegmentDefinition;updatedAt:string;preview:{matched:number;unknown:number;total:number;computedAt:string}|null};
export type SegmentReason={kind:SegmentCondition['kind'];field:string;op:string;result:boolean|null;actual:SegmentScalar|null;expected?:SegmentScalar|SegmentScalar[];days?:number};
export type SegmentPreview={segmentId:string|null;version:number|null;total:number;matched:number;unknown:number;excluded:number;computedAt:string;expiresAt:string;sourceId:string;sourceVersion:number;sourceSyncedAt:string;coverageFrom:string|null;timezone:string;dataRevision:string;ruleDigest:string;metric:'matching_entities';samples:{id:string;observedAt:string;reasons:SegmentReason[]}[];warnings:string[]};
export type SegmentBinding={segmentId:string;segmentVersion:number;ruleDigest:string;sourceId:string;sourceVersion:number;goalId:string;stageIndex:number|null};
export const SEGMENT_LIMITS={segments:100,versions:25,conditions:20,depth:2,previewPerDay:200,previewMinutes:15} as const;
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Kural nesnesi gerekli.');return value as Record<string,unknown>;};
function fields(raw:Record<string,unknown>,allowed:string[]){if(Object.keys(raw).some(key=>!allowed.includes(key)))throw new Error('Desteklenmeyen kural alanı var.');}
export function normalizeSegmentDefinition(value:unknown,source:SegmentSource,goals:GoalDefinition[]):SegmentDefinition {
  const raw=object(value);fields(raw,['sourceId','sourceVersion','maxAgeHours','rules','goalId','stageIndex']);
  if(raw.sourceId!==source.id||raw.sourceVersion!==source.version)throw new Error('Kaynak sürümü değişti. Güncel şemayı seçin.');
  if(!Number.isSafeInteger(raw.maxAgeHours)||Number(raw.maxAgeHours)<1||Number(raw.maxAgeHours)>720)throw new Error('Veri tazeliği 1-720 saat olmalı.');
  const goalId=raw.goalId??'',stageIndex=raw.stageIndex??null;
  if(typeof goalId!=='string'||goalId.length>100)throw new Error('Proje hedefi geçersiz.');
  const goal=goals.find(item=>item.id===goalId);
  if(goalId?(!goal||!Number.isSafeInteger(stageIndex)||Number(stageIndex)<0||Number(stageIndex)>=goal.stages.length):stageIndex!==null)throw new Error('Hedef ve aşama mevcut projeden seçilmeli.');
  let count=0;
  function rule(value:unknown,depth:number):SegmentRule {
    const item=object(value);
    if(item.kind==='group'){
      fields(item,['kind','op','children']);
      if(depth>SEGMENT_LIMITS.depth||!['and','or'].includes(String(item.op))||!Array.isArray(item.children)||item.children.length<1||item.children.length>10)throw new Error('AND/OR grubu 1-10 kural içermeli; en fazla iki alt grup seviyesi desteklenir.');
      return {kind:'group',op:item.op as 'and'|'or',children:item.children.map(child=>rule(child,depth+1))};
    }
    if(++count>SEGMENT_LIMITS.conditions)throw new Error('En fazla 20 koşul desteklenir.');
    if(item.kind==='attribute'){
      fields(item,['kind','field','op','value']);
      const field=source.attributes.find(attribute=>attribute.key===item.field);
      if(!field||!['eq','neq','gt','gte','lt','lte','in','empty','not_empty'].includes(String(item.op)))throw new Error('Özellik veya işlem kaynak şemasında desteklenmiyor.');
      const op=item.op as AttributeOperator;
      if(['gt','gte','lt','lte'].includes(op)&&field.type!=='number')throw new Error('Sayısal karşılaştırma yalnız sayı alanlarında kullanılabilir.');
      if(op==='empty'||op==='not_empty'){if(item.value!==undefined)throw new Error('Boşluk kuralı değer almaz.');return {kind:'attribute',field:field.key,op};}
      const scalar=(value:unknown):SegmentScalar=>{if(typeof value!==field.type||typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&(value.length>200||/[\x00-\x1f]/.test(value)))throw new Error('Koşul değeri kaynak alanıyla aynı türde olmalı.');return value as SegmentScalar;};
      if(op==='in'){
        if(!Array.isArray(item.value)||!item.value.length||item.value.length>20)throw new Error('Liste 1-20 değer içermeli.');
        return {kind:'attribute',field:field.key,op,value:Array.from(new Set(item.value.map(scalar)))};
      }
      return {kind:'attribute',field:field.key,op,value:scalar(item.value)};
    }
    if(item.kind==='event'||item.kind==='activity'){
      fields(item,item.kind==='event'?['kind','eventName','op','days']:['kind','op','days']);
      if(source.kind!=='webhook')throw new Error('Olay ve aktivite kuralları imzalı olay kaynağı gerektirir.');
      if(!Number.isSafeInteger(item.days)||Number(item.days)<1||Number(item.days)>30)throw new Error('Olay penceresi 1-30 gün olmalı.');
      if(item.kind==='event'){
        if(!source.eventNames.includes(String(item.eventName))||!['exists','absent'].includes(String(item.op)))throw new Error('Olay adı veya işlemi desteklenmiyor.');
        return {kind:'event',eventName:String(item.eventName),op:item.op as 'exists'|'absent',days:Number(item.days)};
      }
      if(!['within','not_within'].includes(String(item.op)))throw new Error('Aktivite işlemi desteklenmiyor.');
      return {kind:'activity',op:item.op as 'within'|'not_within',days:Number(item.days)};
    }
    throw new Error('Desteklenmeyen koşul türü.');
  }
  const rules=rule(raw.rules,0);if(rules.kind!=='group')throw new Error('Kök kural AND/OR grubu olmalı.');
  return {sourceId:source.id,sourceVersion:source.version,maxAgeHours:Number(raw.maxAgeHours),rules,goalId,stageIndex:stageIndex as number|null};
}
