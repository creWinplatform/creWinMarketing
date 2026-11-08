import { mapSeries } from '../db/async-array';
import type { Db } from '../db/client';
import 'server-only';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { PlatformRepository } from './repository';
import { ryzevoFeature } from './ryzevo-features';
import { deliverCoachDigest,type DigestDelivery,type DigestMail } from './coach-digest';
import { alertEmailConfiguration,alertMessage,teamAlerts } from './team-alerts';
import { adWarnings } from './ad-alerts';
import { recentCompetitorChanges } from './mobile-aso';

// A short weekly email for the team (never for customers): the last 7 days against the 7 before, counts only, plus what
// needs attention now. It goes on Monday to members who opted in on top of the alert emails.
type Scope={subject:string;organizationId:string;projectId:string};
type Lang='tr'|'en';
const DAY=86400000;
export type WeeklyFacts={from:string;to:string;posts:number;previousPosts:number;spend:{currency:string;amount:number}[];adWarnings:number;
  apps:{name:string;installs:number|null;previousInstalls:number|null;reviews:number;average:number|null;unanswered:number;improved:number;declined:number}[];competitorChanges:number;alerts:string[]};
export async function weeklyFacts(db:Db,scope:Scope,lang:Lang,now=Date.now()):Promise<WeeklyFacts>{
  const args=[scope.organizationId,scope.projectId] as const,to=new Date(Math.floor(now/DAY)*DAY),from=new Date(to.getTime()-7*DAY),before=new Date(from.getTime()-7*DAY),iso=(value:Date)=>value.toISOString(),day=(value:Date)=>iso(value).slice(0,10);
  const has=async (table:string)=>Boolean(await db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table));
  const posts=async (a:Date,b:Date)=>(await db.prepare("SELECT COUNT(*) n FROM platform_social_publications WHERE organization_id=? AND project_id=? AND mode='publish' AND state='accepted' AND COALESCE(submitted_at,scheduled_at)>=? AND COALESCE(submitted_at,scheduled_at)<?").get(...args,iso(a),iso(b)) as {n:number}).n;
  const spend=await has('platform_mobile_costs')?(await db.prepare("SELECT currency,ROUND(SUM(amount),2) amount FROM platform_mobile_costs WHERE organization_id=? AND project_id=? AND day>=? AND day<? GROUP BY currency ORDER BY currency").all(...args,day(from),day(to)) as {currency:string;amount:number}[]):[];
  const apps=await has('platform_mobile_apps')?await mapSeries((await db.prepare('SELECT id,source_version,config_json FROM platform_mobile_apps WHERE organization_id=? AND project_id=? ORDER BY created_at,id').all(...args) as {id:string;source_version:number;config_json:string}[]), async app=>{
    const config=JSON.parse(app.config_json) as {name:string;attributionProvider:string};
    const installs=async (a:Date,b:Date)=>(await db.prepare("SELECT COUNT(DISTINCT e.entity_id) n FROM platform_product_events e JOIN platform_mobile_event_details d ON d.source_id=e.connection_id AND d.event_id=e.event_id AND d.organization_id=e.organization_id AND d.project_id=e.project_id WHERE d.app_id=? AND e.organization_id=? AND e.project_id=? AND d.kind='install' AND d.provider=? AND COALESCE(json_extract(d.details_json,'$.environment'),'')<>'sandbox' AND e.occurred_at>=? AND e.occurred_at<?").get(app.id,...args,config.attributionProvider,iso(a),iso(b)) as {n:number}).n;
    const reviews=await has('platform_mobile_reviews')?await db.prepare('SELECT COUNT(*) n,AVG(rating) average FROM platform_mobile_reviews WHERE app_id=? AND reviewed_at>=? AND reviewed_at<?').get(app.id,iso(from),iso(to)) as {n:number;average:number|null}:{n:0,average:null};
    const unanswered=await has('platform_mobile_reviews')?(await db.prepare("SELECT COUNT(*) n FROM platform_mobile_reviews r LEFT JOIN platform_mobile_review_replies p ON p.review_id=r.id WHERE r.app_id=? AND r.store_reply IS NULL AND (p.state IS NULL OR p.state<>'sent')").get(app.id) as {n:number}).n:0;
    const moves=await has('platform_mobile_keywords')?(await db.prepare('SELECT (SELECT rank FROM platform_mobile_keyword_ranks r WHERE r.keyword_id=k.id AND r.day>=? AND r.day<? ORDER BY r.day LIMIT 1) first,(SELECT rank FROM platform_mobile_keyword_ranks r WHERE r.keyword_id=k.id AND r.day>=? AND r.day<? ORDER BY r.day DESC LIMIT 1) last FROM platform_mobile_keywords k WHERE k.app_id=?').all(day(from),day(to),day(from),day(to),app.id) as {first:number|null;last:number|null}[]):[];
    const moved=(row:{first:number|null;last:number|null})=>row.first!==null&&row.last!==null?row.first-row.last:row.first===null&&row.last!==null?1:row.first!==null&&row.last===null?-1:0;
    // Installs kept for 90 days are always within reach of a weekly summary.
    return {name:config.name,installs:await installs(from,to),previousInstalls:await installs(before,from),reviews:reviews.n,average:reviews.average===null?null:Math.round(reviews.average*100)/100,unanswered,improved:moves.filter(row=>moved(row)>0).length,declined:moves.filter(row=>moved(row)<0).length};
  }):[];
  const repo=new PlatformRepository(db),project=(await repo.workspace(scope.subject,...args))!.project,alerts=await teamAlerts(db,scope,now);
  const lines=alertMessage(alerts,lang,project,'').text.split('\n').filter(line=>line.startsWith('- ')).map(line=>line.slice(2));
  return {from:day(from),to:day(new Date(to.getTime()-DAY)),posts:await posts(from,to),previousPosts:await posts(before,from),spend,adWarnings:await repo.can(scope.subject,...args,'connections.manage')?(await adWarnings(db,scope,now)).length:0,apps,competitorChanges:(await recentCompetitorChanges(db,scope,now)).length,alerts:lines};
}
export function weeklyMessage(facts:WeeklyFacts,lang:Lang,project:{name:string},origin:string):Pick<DigestMail,'subject'|'text'>{
  const tr=lang==='tr',n=(value:number)=>value.toLocaleString(tr?'tr-TR':'en-GB'),change=(now:number|null,before:number|null)=>now===null||before===null?'':before===now?(tr?' (değişmedi)':' (unchanged)'):` (${tr?'önceki hafta':'week before'}: ${n(before)})`;
  const lines=[tr?`${project.name} · haftalık özet · ${facts.from} – ${facts.to}`:`${project.name} · weekly summary · ${facts.from} – ${facts.to}`,''];
  lines.push(tr?`- Yayınlanan paylaşım: ${n(facts.posts)}${change(facts.posts,facts.previousPosts)}`:`- Posts published: ${n(facts.posts)}${change(facts.posts,facts.previousPosts)}`);
  if(facts.spend.length)lines.push(tr?`- Kampanya harcaması: ${facts.spend.map(item=>`${n(item.amount)} ${item.currency}`).join(', ')}${facts.adWarnings?` · ${n(facts.adWarnings)} plan uyarı eşiğinde`:''}`:`- Campaign spend: ${facts.spend.map(item=>`${n(item.amount)} ${item.currency}`).join(', ')}${facts.adWarnings?` · ${n(facts.adWarnings)} plan(s) at a warning threshold`:''}`);
  for(const app of facts.apps){
    lines.push(tr?`- ${app.name}: ${n(app.installs||0)} yükleme${change(app.installs,app.previousInstalls)} · ${n(app.reviews)} yeni yorum${app.average!==null?` (ortalama ${n(app.average)}★)`:''} · ${n(app.unanswered)} yanıtsız yorum`:`- ${app.name}: ${n(app.installs||0)} installs${change(app.installs,app.previousInstalls)} · ${n(app.reviews)} new reviews${app.average!==null?` (average ${n(app.average)}★)`:''} · ${n(app.unanswered)} unanswered`);
    if(app.improved||app.declined)lines.push(tr?`  App Store anahtar kelimeleri: ${n(app.improved)} yükseldi, ${n(app.declined)} düştü`:`  App Store keywords: ${n(app.improved)} up, ${n(app.declined)} down`);
  }
  if(facts.competitorChanges)lines.push(tr?`- Rakip uygulamalarda ${n(facts.competitorChanges)} değişiklik`:`- ${n(facts.competitorChanges)} competitor change(s)`);
  lines.push('',tr?'Dikkat gerekenler:':'Needs attention:');
  if(facts.alerts.length)for(const alert of facts.alerts.slice(0,8))lines.push(`- ${alert}`);else lines.push(tr?'- Şu an açık bir konu yok.':'- Nothing open right now.');
  lines.push('',`${origin}/`,'',tr?'Bu haftalık özeti, “Dikkat gerekenler” kartında açtığınız için alıyorsunuz; aynı karttan kapatabilirsiniz. Sayılar Ryzevo kayıtlarından ve sağlayıcıların bildirdiklerinden gelir; neden-sonuç kanıtı değildir. Müşterilere hiçbir şey gönderilmedi.':'You receive this weekly summary because you turned it on in the “Needs attention” card; you can turn it off there. Figures come from Ryzevo records and what providers report; they are not proof of cause. Nothing was sent to customers.');
  return {subject:tr?`Ryzevo · ${project.name} · haftalık özet`:`Ryzevo · ${project.name} · weekly summary`,text:lines.join('\n').slice(0,20000)};
}
const isoWeek=(now:number)=>{const date=new Date(Math.floor(now/DAY)*DAY),dayOfWeek=(date.getUTCDay()+6)%7;date.setUTCDate(date.getUTCDate()-dayOfWeek+3);const first=new Date(Date.UTC(date.getUTCFullYear(),0,4));return `${date.getUTCFullYear()}-W${String(1+Math.round(((date.getTime()-first.getTime())/DAY-3+((first.getUTCDay()+6)%7))/7)).padStart(2,'0')}`;};
// Worker step: on Mondays from 06:00 UTC, one opted-in member per tick gets the summary, once per week. It is marked
// before the provider call and not retried.
export async function deliverNextWeeklySummary(db:Db,deliver:DigestDelivery=deliverCoachDigest,configuration=alertEmailConfiguration(),now=Date.now()){
  if(!configuration)return false;const date=new Date(now);if(date.getUTCDay()!==1||date.getUTCHours()<6)return false;
  const week=isoWeek(now);
  const claimed=await db.transaction(async ()=>{
    const row=await db.prepare('SELECT user_id,organization_id,project_id,language FROM platform_alert_subscriptions WHERE weekly=1 AND (weekly_week IS NULL OR weekly_week<>?) ORDER BY user_id LIMIT 1').get(week) as {user_id:string;organization_id:string;project_id:string;language:Lang}|undefined;
    if(!row)return null;await db.prepare('UPDATE platform_alert_subscriptions SET weekly_week=? WHERE user_id=? AND organization_id=? AND project_id=?').run(week,row.user_id,row.organization_id,row.project_id);
    const repo=new PlatformRepository(db),workspace=await repo.can(row.user_id,row.organization_id,row.project_id,'read')?await repo.workspace(row.user_id,row.organization_id,row.project_id):null;
    const email=(await db.prepare('SELECT email FROM platform_account_emails WHERE user_id=?').get(row.user_id) as {email:string}|undefined)?.email;
    if(!workspace||!ryzevoFeature(workspace.project.productPack,'alerts')||!email)return null;
    const scope={subject:row.user_id,organizationId:row.organization_id,projectId:row.project_id},id=`weekly_${randomUUID()}`,at=new Date(now).toISOString();
    await db.prepare("INSERT INTO platform_alert_deliveries(id,organization_id,project_id,user_id,state,alert_count,created_at,updated_at) VALUES(?,?,?,?,'submitted',0,?,?)").run(id,row.organization_id,row.project_id,row.user_id,at,at);
    return {id,mail:{to:email,...weeklyMessage(await weeklyFacts(db,scope,row.language,now),row.language,workspace.project,configuration.origin)}};
  });
  if(!claimed)return false;
  let state:'sent'|'uncertain'='sent';try{await deliver(claimed.mail,configuration);}catch{state='uncertain';}
  await db.prepare('UPDATE platform_alert_deliveries SET state=?,updated_at=? WHERE id=?').run(state,new Date().toISOString(),claimed.id);return true;
}
