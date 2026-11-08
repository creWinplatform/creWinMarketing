import type { Db } from '../db/client';
import 'server-only';
import type Database from 'better-sqlite3';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { adMinorUnit } from './ad-manager';
import type { AdProvider } from './ad-providers';

// Spend warnings for running ad plans, from what the providers last reported and the daily spend pulled into the mobile
// report. They are shown to the team with a pause suggestion; Ryzevo never pauses or changes a plan by itself.
export type AdWarning={kind:'overspend'|'cpi';planId:string;provider:AdProvider;name:string;currency:string;day:string;
  // overspend: reported spend against the budget allowed so far; cpi: cost per install over the last 7 closed days.
  spendMinor:number;limitMinor:number;installs?:number;cpiMinor?:number|null};
export type AdAlertSettings={overspendPercent:number;cpiCaps:Record<string,number>;updatedAt:string|null};
export const AD_ALERT_DEFAULTS={overspendPercent:120,cpiDays:7} as const;
const DAY=86400000;
const args=(scope:{organizationId:string;projectId:string})=>[scope.organizationId,scope.projectId] as const;

export async function adAlertSettings(db:Db,scope:{organizationId:string;projectId:string}):Promise<AdAlertSettings>{
  const row=await db.prepare('SELECT overspend_percent,cpi_caps_json,updated_at FROM platform_ad_alert_settings WHERE organization_id=? AND project_id=?').get(...args(scope)) as {overspend_percent:number;cpi_caps_json:string;updated_at:string}|undefined;
  return row?{overspendPercent:row.overspend_percent,cpiCaps:JSON.parse(row.cpi_caps_json),updatedAt:row.updated_at}:{overspendPercent:AD_ALERT_DEFAULTS.overspendPercent,cpiCaps:{},updatedAt:null};
}
// Thresholds are set by people who can approve ad plans.
export async function saveAdAlertSettings(db:Db,scope:{subject:string;organizationId:string;projectId:string},raw:Record<string,unknown>){
  const repo=new PlatformRepository(db);if(!await repo.can(scope.subject,...args(scope),'campaign.approve')||!await repo.can(scope.subject,...args(scope),'connections.manage'))throw new MarketingStoreError('Reklam uyarı eşiklerini yalnız reklam yöneticileri değiştirebilir.',403);
  const percent=raw.overspendPercent;if(!Number.isSafeInteger(percent)||(percent as number)<100||(percent as number)>300)throw new MarketingStoreError('Aşım eşiği %100 ile %300 arasında olmalı.');
  const caps:Record<string,number>={};const value=raw.cpiCaps&&typeof raw.cpiCaps==='object'&&!Array.isArray(raw.cpiCaps)?raw.cpiCaps as Record<string,unknown>:{};
  for(const [currency,amount] of Object.entries(value)){if(!/^[A-Z]{3}$/.test(currency))throw new MarketingStoreError('Para birimi üç harfli olmalı.');if(amount===null||amount===0)continue;if(!Number.isSafeInteger(amount)||(amount as number)<1||(amount as number)>1e9)throw new MarketingStoreError('CPI üst sınırı pozitif bir tutar olmalı.');caps[currency]=amount as number;}
  if(Object.keys(caps).length>10)throw new MarketingStoreError('En çok 10 para birimi için CPI sınırı girilebilir.');
  const now=new Date().toISOString();
  await db.prepare('INSERT INTO platform_ad_alert_settings VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET overspend_percent=excluded.overspend_percent,cpi_caps_json=excluded.cpi_caps_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at').run(...args(scope),percent,JSON.stringify(caps),scope.subject,now);
  await db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(scope.subject,...args(scope),'ads.alerts.settings',now);
  return await adAlertSettings(db,scope);
}
// Running plans only. Overspend: the reported spend is above (days run so far × daily budget × threshold), or one
// synced day is above (daily budget × threshold). CPI: the last 7 closed days of synced spend for the plan divided by
// the installs the attribution provider reported for its campaign name, against the team's cap in that currency.
export async function adWarnings(db:Db,scope:{organizationId:string;projectId:string},now=Date.now()):Promise<AdWarning[]>{
  const settings=await adAlertSettings(db,scope),factor=settings.overspendPercent/100,today=new Date(now).toISOString().slice(0,10),warnings:AdWarning[]=[];
  const plans=await db.prepare("SELECT id,provider,name,currency,daily_budget_minor,start_date,end_date,spend_minor,spend_checked_at FROM platform_ad_plans WHERE organization_id=? AND project_id=? AND state='active' ORDER BY id").all(...args(scope)) as {id:string;provider:AdProvider;name:string;currency:string;daily_budget_minor:number;start_date:string;end_date:string;spend_minor:number|null;spend_checked_at:string|null}[];
  const hasCosts=Boolean(await db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='platform_mobile_costs'").get());
  for(const plan of plans){
    const unit=adMinorUnit(plan.currency),through=[today,plan.end_date].sort()[0],days=Math.max(1,Math.floor((Date.parse(through)-Date.parse(plan.start_date))/DAY)+1);
    if(plan.spend_minor!==null&&plan.start_date<=today){const limit=Math.round(plan.daily_budget_minor*days*factor);if(plan.spend_minor>limit)warnings.push({kind:'overspend',planId:plan.id,provider:plan.provider,name:plan.name,currency:plan.currency,day:(plan.spend_checked_at||today).slice(0,10),spendMinor:plan.spend_minor,limitMinor:limit});}
    if(!hasCosts)continue;
    const daily=await db.prepare("SELECT day,amount FROM platform_mobile_costs WHERE organization_id=? AND project_id=? AND campaign_id=? AND currency=? ORDER BY day DESC LIMIT 7").all(...args(scope),`ad:${plan.provider}:${plan.id}`,plan.currency) as {day:string;amount:number}[];
    const peak=daily.find(row=>Math.round(row.amount*unit)>plan.daily_budget_minor*factor);
    if(peak&&!warnings.some(item=>item.planId===plan.id&&item.kind==='overspend'))warnings.push({kind:'overspend',planId:plan.id,provider:plan.provider,name:plan.name,currency:plan.currency,day:peak.day,spendMinor:Math.round(peak.amount*unit),limitMinor:Math.round(plan.daily_budget_minor*factor)});
    const cap=settings.cpiCaps[plan.currency];if(!cap)continue;
    const from=new Date(now-AD_ALERT_DEFAULTS.cpiDays*DAY).toISOString().slice(0,10);
    const cost=await db.prepare("SELECT app_id,attribution_campaign,SUM(amount) amount FROM platform_mobile_costs WHERE organization_id=? AND project_id=? AND campaign_id=? AND currency=? AND day>=? AND day<? GROUP BY app_id,attribution_campaign").all(...args(scope),`ad:${plan.provider}:${plan.id}`,plan.currency,from,today) as {app_id:string;attribution_campaign:string;amount:number}[];
    for(const row of cost){
      const spend=Math.round(row.amount*unit);if(spend<=cap)continue;
      const installs=(await db.prepare("SELECT COUNT(DISTINCT e.entity_id) n FROM platform_product_events e JOIN platform_mobile_event_details d ON d.source_id=e.connection_id AND d.event_id=e.event_id AND d.organization_id=e.organization_id AND d.project_id=e.project_id WHERE d.app_id=? AND e.organization_id=? AND e.project_id=? AND d.kind='install' AND json_extract(d.details_json,'$.campaign')=? AND COALESCE(json_extract(d.details_json,'$.environment'),'')<>'sandbox' AND e.occurred_at>=? AND e.occurred_at<?").get(row.app_id,...args(scope),row.attribution_campaign,`${from}T00:00:00.000Z`,`${today}T00:00:00.000Z`) as {n:number}).n;
      const cpi=installs?Math.round(spend/installs):null;
      if(cpi===null||cpi>cap)warnings.push({kind:'cpi',planId:plan.id,provider:plan.provider,name:plan.name,currency:plan.currency,day:today,spendMinor:spend,limitMinor:cap,installs,cpiMinor:cpi});
    }
  }
  return warnings;
}
