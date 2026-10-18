import 'server-only';
import { MobileGrowth } from './mobile-store';
import { mobileDay } from './mobile-validation';
import { MarketingStoreError } from './errors';
import type { MobileReport } from './mobile-types';

type Observation={entity_id:string;event_id:string;occurred_at:string;provider:string;kind:string;details_json:string};
const dayMs=86400000,day=(time:string)=>time.slice(0,10),nextDay=(date:string,offset=1)=>new Date(Date.parse(date+'T00:00:00Z')+offset*dayMs).toISOString().slice(0,10);
export function mobileReport(service:MobileGrowth,appId:string,fromInput?:unknown,toInput?:unknown,now=Date.now()):MobileReport {
  const app=service.app(appId),to=mobileDay(toInput||new Date(now-dayMs).toISOString().slice(0,10)),from=mobileDay(fromInput||new Date(Date.parse(to)-29*dayMs).toISOString().slice(0,10));
  if(from>to||Date.parse(to)-Date.parse(from)>30*dayMs||Date.parse(from)<now-90*dayMs||Date.parse(to)>=Date.parse(new Date(now).toISOString().slice(0,10)))throw new MarketingStoreError('Son 90 günde, kapanmış en fazla 31 günlük bir aralık seçin.');
  const source=service.db.prepare('SELECT event_coverage_from FROM platform_product_sources WHERE connection_id=? AND version=?').get(app.sourceId,app.sourceVersion) as {event_coverage_from:string|null}|undefined;
  const complete=(date:string)=>app.sourceState==='active'&&Boolean(source?.event_coverage_from&&Date.parse(source.event_coverage_from)<=Date.parse(date+'T00:00:00Z')&&app.coverageThrough&&Date.parse(app.coverageThrough)>=Date.parse(nextDay(date)+'T00:00:00Z'));
  const rows=service.db.prepare(`SELECT e.entity_id,e.event_id,e.occurred_at,d.provider,d.kind,d.details_json FROM platform_product_events e JOIN platform_mobile_event_details d ON d.source_id=e.connection_id AND d.event_id=e.event_id AND d.organization_id=e.organization_id AND d.project_id=e.project_id WHERE d.app_id=? AND e.organization_id=? AND e.project_id=? AND e.version=? AND e.occurred_at>=? ORDER BY e.occurred_at,e.event_id LIMIT 10001`).all(app.id,...service.args(),app.sourceVersion,new Date(now-90*dayMs).toISOString()) as Observation[];
  const warnings:string[]=[],installs=new Map<string,Observation>(),sessions=new Map<string,Set<string>>();let uncertainIdentity=false;
  for(const row of rows){const details=JSON.parse(row.details_json);if(details.environment==='sandbox')continue;
    if(row.kind==='install'&&row.provider===app.attributionProvider){if(!installs.has(row.entity_id))installs.set(row.entity_id,row);if(details.identity!=='customer')uncertainIdentity=true;}
    if(row.kind==='session'&&row.provider==='bridge'){if(!sessions.has(row.entity_id))sessions.set(row.entity_id,new Set());sessions.get(row.entity_id)!.add(day(row.occurred_at));}
  }
  const selected=[...installs.values()].filter(row=>day(row.occurred_at)>=from&&day(row.occurred_at)<=to),dates=[...new Set(selected.map(row=>day(row.occurred_at)))].sort();
  if(!app.identityConfirmed||uncertainIdentity)warnings.push('identity_not_verified');
  if(!complete(from)||!complete(to))warnings.push('coverage_not_complete');
  if(rows.length>10000)warnings.push('record_limit');
  const cohorts=dates.map(date=>{
    const members=selected.filter(row=>day(row.occurred_at)===date);
    const retention=(offset:number)=>{const target=nextDay(date,offset),mature=Date.parse(nextDay(target)+'T00:00:00Z')<=now,returned=members.filter(row=>sessions.get(row.entity_id)?.has(target)).length;
      return {eligible:mature?members.length:0,returned,rate:mature&&complete(date)&&complete(target)&&app.identityConfirmed&&!uncertainIdentity&&rows.length<=10000?returned/members.length*100:null};};
    return {date,installs:members.length,d1:retention(1),d7:retention(7),d30:retention(30)};
  });
  const money=new Map<string,{spend:number|null;purchaseRevenue:number|null;refunds:number|null}>(),seenTransactions=new Map<string,string>(),subscription=new Map<string,{at:string;status:string}>();
  const inPeriod=(row:Observation)=>day(row.occurred_at)>=from&&day(row.occurred_at)<=to;
  for(const row of rows){if(row.provider!==app.revenueProvider)continue;const detail=JSON.parse(row.details_json);if(detail.environment==='sandbox')continue;
    if(inPeriod(row)&&detail.status==='REFUND_REVERSED')warnings.push('revenue_adjustment_unmodeled');
    if(row.kind==='subscription'||row.kind==='purchase'){if(!subscription.has(row.entity_id)||subscription.get(row.entity_id)!.at<row.occurred_at)subscription.set(row.entity_id,{at:row.occurred_at,status:detail.status||row.kind});}
    if(!['purchase','refund'].includes(row.kind)||!inPeriod(row))continue;
    if(typeof detail.amount!=='number'||!detail.currency||!detail.transaction){warnings.push('revenue_amount_missing');continue;}
    const key=JSON.stringify([row.kind,detail.currency,detail.transaction]),digest=JSON.stringify([row.entity_id,detail.amount]);
    if(seenTransactions.has(key)){if(seenTransactions.get(key)!==digest)warnings.push('transaction_conflict');continue;}seenTransactions.set(key,digest);
    if(!money.has(detail.currency))money.set(detail.currency,{spend:null,purchaseRevenue:null,refunds:null});const value=money.get(detail.currency)!;
    if(row.kind==='purchase')value.purchaseRevenue=(value.purchaseRevenue||0)+detail.amount;else value.refunds=(value.refunds||0)+detail.amount;
  }
  const spend=service.db.prepare('SELECT amount,currency,day,attribution_campaign FROM platform_mobile_costs WHERE organization_id=? AND project_id=? AND app_id=? AND day>=? AND day<=?').all(...service.args(),app.id,from,to) as {amount:number;currency:string;day:string;attribution_campaign:string}[];
  for(const row of spend){if(!money.has(row.currency))money.set(row.currency,{spend:null,purchaseRevenue:null,refunds:null});const value=money.get(row.currency)!;value.spend=(value.spend||0)+row.amount;}
  if(spend.length)warnings.push('spend_manual');
  const periodComplete=complete(from)&&complete(to)&&rows.length<=10000,installCount=selected.length||periodComplete?selected.length:null;
  const active=new Set(rows.filter(row=>row.kind==='session'&&row.provider==='bridge'&&inPeriod(row)).map(row=>row.entity_id));
  const states=new Map<string,number>();for(const item of subscription.values())states.set(item.status,(states.get(item.status)||0)+1);
  const acquisition=new Map<string,{channel:string;campaign:string;installs:number}>();for(const row of selected){const detail=JSON.parse(row.details_json),channel=detail.channel||'unknown',campaign=detail.campaign||'unknown',key=JSON.stringify([channel,campaign]),entry=acquisition.get(key)||{channel,campaign,installs:0};entry.installs++;acquisition.set(key,entry);}
  return {from,to,timezone:'UTC',status:!rows.length&&!spend.length?'no_data':periodComplete?'observed':'partial',installs:installCount,activeUsers:active.size||periodComplete?active.size:null,acquisition:[...acquisition.values()],cohorts,money:[...money].map(([currency,value])=>{
    const financialIncomplete=warnings.some(item=>['transaction_conflict','revenue_amount_missing','revenue_adjustment_unmodeled'].includes(item)),netRevenue=financialIncomplete||value.purchaseRevenue===null?null:value.purchaseRevenue-(value.refunds||0);
    const costs=spend.filter(row=>row.currency===currency),matched=new Set(selected.filter(row=>costs.some(cost=>cost.day===day(row.occurred_at)&&cost.attribution_campaign===JSON.parse(row.details_json).campaign)).map(row=>row.entity_id));
    let matchedRevenue=0,hasMatchedRevenue=false;const matchedTransactions=new Set<string>();for(const row of rows){const detail=JSON.parse(row.details_json);if(row.provider!==app.revenueProvider||!matched.has(row.entity_id)||!inPeriod(row)||detail.currency!==currency||typeof detail.amount!=='number'||!detail.transaction||!['purchase','refund'].includes(row.kind)||detail.environment==='sandbox')continue;const key=JSON.stringify([row.kind,detail.currency,detail.transaction]);if(matchedTransactions.has(key))continue;matchedTransactions.add(key);hasMatchedRevenue=true;matchedRevenue+=row.kind==='refund'?-detail.amount:detail.amount;}
    const compatible=periodComplete&&app.identityConfirmed&&!uncertainIdentity;
    return {currency,...value,netRevenue,cpi:compatible&&matched.size&&value.spend!==null?value.spend/matched.size:null,roas:compatible&&!financialIncomplete&&value.spend&&hasMatchedRevenue?matchedRevenue/value.spend:null};
  }),subscriptions:[...states].map(([status,count])=>({status,count})),warnings:[...new Set(warnings)]};
}
