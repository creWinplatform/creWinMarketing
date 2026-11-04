import 'server-only';
import type Database from 'better-sqlite3';
import type { MonthlyMobile } from './monthly-report-types';

const DAY=86400000;
// The month's mobile figures per app, for the monthly report: counts only, no review text, author or device.
// Installs come from the app's own events (kept 90 days), SKAN from AppsFlyer, positions from Apple's public search API,
// ratings from the stores, spend from the ad accounts and manual entries.
export function mobileMonthFacts(db:Database.Database,scope:{organizationId:string;projectId:string},from:string,to:string,now=Date.now()):MonthlyMobile[]{
  if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='platform_mobile_review_sync'").get())return [];
  const args=[scope.organizationId,scope.projectId] as const,fromDay=from.slice(0,10),lastDay=new Date(Date.parse(to)-1).toISOString().slice(0,10);
  const apps=db.prepare('SELECT id,source_id,source_version,config_json FROM platform_mobile_apps WHERE organization_id=? AND project_id=? ORDER BY created_at,id').all(...args) as {id:string;source_id:string;source_version:number;config_json:string}[];
  return apps.map(app=>{
    const config=JSON.parse(app.config_json) as {name:string;attributionProvider:string};
    // Installs: distinct people with an install event from the app's attribution source, sandbox excluded.
    const kept=Date.parse(from)>=now-90*DAY;
    const installs=kept?(db.prepare("SELECT COUNT(DISTINCT e.entity_id) n FROM platform_product_events e JOIN platform_mobile_event_details d ON d.source_id=e.connection_id AND d.event_id=e.event_id AND d.organization_id=e.organization_id AND d.project_id=e.project_id WHERE d.app_id=? AND e.organization_id=? AND e.project_id=? AND e.version=? AND d.kind='install' AND d.provider=? AND COALESCE(json_extract(d.details_json,'$.environment'),'')<>'sandbox' AND e.occurred_at>=? AND e.occurred_at<?").get(app.id,...args,app.source_version,config.attributionProvider,from,to) as {n:number}).n:null;
    const skan=db.prepare('SELECT SUM(installs) installs,SUM(revenue) revenue,COUNT(revenue) revenue_n,SUM(cost) cost,COUNT(cost) cost_n,MAX(currency) currency,COUNT(*) n FROM platform_mobile_skan WHERE app_id=? AND organization_id=? AND project_id=? AND day BETWEEN ? AND ?').get(app.id,...args,fromDay,lastDay) as {installs:number|null;revenue:number|null;revenue_n:number;cost:number|null;cost_n:number;currency:string|null;n:number};
    const spend=db.prepare('SELECT currency,SUM(amount) amount FROM platform_mobile_costs WHERE app_id=? AND organization_id=? AND project_id=? AND day BETWEEN ? AND ? GROUP BY currency ORDER BY currency').all(app.id,...args,fromDay,lastDay) as {currency:string;amount:number}[];
    // Keyword positions: the first and last check inside the month for each tracked term.
    const terms=db.prepare(`SELECT k.term,k.country,(SELECT rank FROM platform_mobile_keyword_ranks r WHERE r.keyword_id=k.id AND r.day BETWEEN ? AND ? ORDER BY r.day LIMIT 1) first,(SELECT rank FROM platform_mobile_keyword_ranks r WHERE r.keyword_id=k.id AND r.day BETWEEN ? AND ? ORDER BY r.day DESC LIMIT 1) last,(SELECT COUNT(*) FROM platform_mobile_keyword_ranks r WHERE r.keyword_id=k.id AND r.day BETWEEN ? AND ?) checks FROM platform_mobile_keywords k WHERE k.app_id=? AND k.organization_id=? AND k.project_id=? ORDER BY k.created_at,k.id`).all(fromDay,lastDay,fromDay,lastDay,fromDay,lastDay,app.id,...args) as {term:string;country:string;first:number|null;last:number|null;checks:number}[];
    const checked=terms.filter(term=>term.checks>0),moved=(term:{first:number|null;last:number|null})=>term.first!==null&&term.last!==null?term.first-term.last:term.first===null&&term.last!==null?1:term.first!==null&&term.last===null?-1:0;
    const reviews=(['ios','android'] as const).map(store=>{
      const row=db.prepare('SELECT COUNT(*) n,AVG(rating) average FROM platform_mobile_reviews WHERE app_id=? AND store=? AND reviewed_at>=? AND reviewed_at<?').get(app.id,store,from,to) as {n:number;average:number|null};
      const replied=(db.prepare("SELECT COUNT(*) n FROM platform_mobile_review_replies WHERE app_id=? AND state='sent' AND sent_at>=? AND sent_at<? AND review_id IN (SELECT id FROM platform_mobile_reviews WHERE store=?)").get(app.id,from,to,store) as {n:number}).n;
      const overall=db.prepare('SELECT COUNT(*) n,AVG(rating) average FROM platform_mobile_reviews WHERE app_id=? AND store=? AND reviewed_at<?').get(app.id,store,to) as {n:number;average:number|null};
      return {store,count:row.n,average:row.average===null?null:Math.round(row.average*100)/100,replied,overallAverage:overall.average===null?null:Math.round(overall.average*100)/100,overallCount:overall.n};
    }).filter(item=>item.count||item.replied||item.overallCount);
    const round=(value:number)=>Math.round(value*100)/100;
    return {name:config.name,installs,
      skan:skan.n?{installs:skan.installs||0,revenue:skan.revenue_n?round(skan.revenue||0):null,cost:skan.cost_n?round(skan.cost||0):null,currency:skan.currency||'USD'}:null,
      spend:spend.map(item=>({currency:item.currency,amount:round(item.amount),cpi:installs&&installs>0?round(item.amount/installs):null})),
      keywords:checked.length?{tracked:checked.length,improved:checked.filter(term=>moved(term)>0).length,declined:checked.filter(term=>moved(term)<0).length,top:checked.filter(term=>term.last!==null).sort((a,b)=>a.last!-b.last!).slice(0,5).map(term=>({term:term.term,country:term.country,first:term.first,last:term.last}))}:null,
      reviews};
  }).filter(app=>app.installs||app.skan||app.spend.length||app.keywords||app.reviews.length);
}
