import type {SegmentGroup,SegmentRule,SegmentReason} from './segment-types';
import type {ProductAttributeType} from './product-data-types';
export type SegmentEntity={id:string;attributes:Record<string,unknown>;observedAt:string};
export type SegmentEvent={entityId:string;name:string;occurredAt:string};
export function evaluateSegment(rules:SegmentGroup,entity:SegmentEntity,events:SegmentEvent[],now:number,coverageFrom:string|null,types:Record<string,ProductAttributeType>){
  const reasons:SegmentReason[]=[];
  function evaluate(rule:SegmentRule):boolean|null {
    if(rule.kind==='group'){
      const values=rule.children.map(evaluate);
      if(rule.op==='and')return values.includes(false)?false:values.includes(null)?null:true;
      return values.includes(true)?true:values.includes(null)?null:false;
    }
    let result:boolean|null=null,actual:SegmentReason['actual']=null;
    if(rule.kind==='attribute'){
      const value=Object.prototype.hasOwnProperty.call(entity.attributes,rule.field)?entity.attributes[rule.field]:undefined;
      const empty=value===undefined||value===null||typeof value==='string'&&!value.trim();
      const invalid=value!==null&&value!==undefined&&(typeof value!==types[rule.field]||typeof value==='number'&&!Number.isFinite(value));
      if(invalid)result=null;
      else if(rule.op==='empty')result=empty;
      else if(rule.op==='not_empty')result=!empty;
      else if(value!==undefined&&value!==null){
        if(rule.op==='in'){const list=rule.value as (string|number|boolean)[];result=typeof value===typeof list[0]?list.includes(value as string|number|boolean):null;}
        else if(typeof value===typeof rule.value){
          if(rule.op==='eq')result=value===rule.value;
          else if(rule.op==='neq')result=value!==rule.value;
          else if(typeof value==='number'&&Number.isFinite(value)&&typeof rule.value==='number')result=rule.op==='gt'?value>rule.value:rule.op==='gte'?value>=rule.value:rule.op==='lt'?value<rule.value:value<=rule.value;
        }
      }
      if(['number','string','boolean'].includes(typeof value))actual=value as SegmentReason['actual'];
      reasons.push({kind:rule.kind,field:rule.field,op:rule.op,result,actual,...(rule.value!==undefined?{expected:rule.value}:{})});
    }else{
      const since=now-rule.days*86400000;
      const relevant=events.filter(event=>(rule.kind!=='event'||event.name===rule.eventName)&&Date.parse(event.occurredAt)>=since&&Date.parse(event.occurredAt)<=now);
      const complete=Boolean(coverageFrom&&Date.parse(coverageFrom)<=since);
      const present=relevant.length>0?true:complete?false:null;
      result=rule.op==='absent'||rule.op==='not_within'?present===null?null:!present:present;
      reasons.push({kind:rule.kind,field:rule.kind==='event'?rule.eventName:'last_observed_activity',op:rule.op,result,actual:relevant.length,days:rule.days});
    }
    return result;
  }
  return {match:evaluate(rules),reasons};
}
