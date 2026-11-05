import 'server-only';
import type Database from 'better-sqlite3';
import { adMinorUnit } from './ad-manager';
import type { AdCreativeStats } from './ad-types';

// Per-ad daily figures the providers report for the images and videos Ryzevo sent, kept 90 days. "Fatigue" is an
// observation: the click-through rate of the last 3 days with delivery fell by 30% or more against the days before,
// with at least 1000 impressions on each side. It suggests a new image; nothing is paused or changed.
export const CREATIVE_STATS={days:14,keepDays:90,fatigueDays:3,minImpressions:1000,drop:0.3} as const;
type Day={creative_id:string;day:string;impressions:number;clicks:number;spend_minor:number;conversions:number|null};
const round=(value:number,digits=4)=>Math.round(value*10**digits)/10**digits;

export function storeCreativeDays(db:Database.Database,rows:Day[]){
  const insert=db.prepare('INSERT INTO platform_ad_creative_stats VALUES(?,?,?,?,?,?) ON CONFLICT(creative_id,day) DO UPDATE SET impressions=excluded.impressions,clicks=excluded.clicks,spend_minor=excluded.spend_minor,conversions=excluded.conversions');
  for(const row of rows)insert.run(row.creative_id,row.day,row.impressions,row.clicks,row.spend_minor,row.conversions);
  db.prepare('DELETE FROM platform_ad_creative_stats WHERE day<?').run(new Date(Date.now()-CREATIVE_STATS.keepDays*86400000).toISOString().slice(0,10));
}
export function creativeStats(db:Database.Database,creativeId:string,currency:string,now=Date.now()):AdCreativeStats|null{
  const from=new Date(now-(CREATIVE_STATS.days-1)*86400000).toISOString().slice(0,10);
  const days=db.prepare('SELECT * FROM platform_ad_creative_stats WHERE creative_id=? AND day>=? ORDER BY day').all(creativeId,from) as Day[];if(!days.length)return null;
  const sum=(list:Day[],key:'impressions'|'clicks'|'spend_minor')=>list.reduce((total,row)=>total+row[key],0);
  const impressions=sum(days,'impressions'),clicks=sum(days,'clicks'),spend=sum(days,'spend_minor'),known=days.filter(row=>row.conversions!==null),conversions=known.length?known.reduce((total,row)=>total+(row.conversions||0),0):null;
  const delivered=days.filter(row=>row.impressions>0),recent=delivered.slice(-CREATIVE_STATS.fatigueDays),before=delivered.slice(0,-CREATIVE_STATS.fatigueDays);
  const ctr=(list:Day[])=>{const shown=sum(list,'impressions');return shown?sum(list,'clicks')/shown:0;};
  const fatigued=sum(recent,'impressions')>=CREATIVE_STATS.minImpressions&&sum(before,'impressions')>=CREATIVE_STATS.minImpressions&&ctr(before)>0&&ctr(recent)<=ctr(before)*(1-CREATIVE_STATS.drop);
  return {from:days[0].day,to:days.at(-1)!.day,impressions,clicks,spendMinor:spend,currency,conversions,ctr:impressions?round(clicks/impressions):null,cpaMinor:conversions?Math.round(spend/conversions):null,
    fatigue:fatigued?{recentCtr:round(ctr(recent)),earlierCtr:round(ctr(before))}:null,days:days.map(row=>({day:row.day,impressions:row.impressions,clicks:row.clicks,spendMinor:row.spend_minor}))};
}
// Sent creatives of running or paused plans whose click-through rate is falling (team alert).
export function fatiguedCreatives(db:Database.Database,scope:{organizationId:string;projectId:string},now=Date.now()){
  if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='platform_ad_creative_stats'").get())return [];
  const rows=db.prepare("SELECT c.id,p.name,p.currency,p.id plan_id FROM platform_ad_creatives c JOIN platform_ad_plans p ON p.id=c.plan_id WHERE c.organization_id=? AND c.project_id=? AND c.state='uploaded' AND c.ad_ref IS NOT NULL AND p.state IN ('active','paused')").all(scope.organizationId,scope.projectId) as {id:string;name:string;currency:string;plan_id:string}[];
  return rows.flatMap(row=>{const stats=creativeStats(db,row.id,row.currency,now);return stats?.fatigue?[{creativeId:row.id,planId:row.plan_id,planName:row.name,day:stats.to}]:[];});
}
// Provider spend strings ("12.34") to minor units of the plan's currency.
export const spendMinor=(value:unknown,currency:string)=>{const number=typeof value==='string'||typeof value==='number'?Number(value):NaN;return Number.isFinite(number)&&number>=0?Math.round(number*adMinorUnit(currency)):0;};
export const count=(value:unknown)=>{const number=typeof value==='string'||typeof value==='number'?Number(value):NaN;return Number.isFinite(number)&&number>=0?Math.round(number):0;};
