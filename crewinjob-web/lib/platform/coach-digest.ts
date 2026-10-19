import 'server-only';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { SESv2Client,SendEmailCommand } from '@aws-sdk/client-sesv2';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { PlatformRepository } from './repository';
import { GrowthCoach,coachChoice,coachWeekKey } from './coach';
import { identityEmailConfiguration } from './identity-email';
import type { CoachDigestSnapshot,CoachReviewFacts,CoachAdjustment } from './coach-types';

type Lang='tr'|'en';
type Configuration=NonNullable<ReturnType<typeof identityEmailConfiguration>>;
export type DigestMail={to:string;subject:string;text:string};
export type DigestDelivery=(mail:DigestMail,configuration:Configuration)=>Promise<void>;
type SesClient={send(command:SendEmailCommand,options:{abortSignal:AbortSignal}):Promise<{MessageId?:string}>;destroy():void};
// Weekly-review email: opt-in per member, sent only when an approver queues it, at most once per review and recipient.
// Uses the platform's account-email (SES) configuration and is off unless PLATFORM_COACH_DIGEST_ENABLED=1.
export function digestConfiguration(){return process.env.PLATFORM_COACH_DIGEST_ENABLED==='1'?identityEmailConfiguration():null;}
export async function deliverCoachDigest(mail:DigestMail,configuration:Configuration,createClient:(options:NonNullable<ConstructorParameters<typeof SESv2Client>[0]>)=>SesClient=options=>new SESv2Client(options)){
  const client=createClient({region:configuration.region,endpoint:`https://email.${configuration.region}.amazonaws.com`,credentials:{accessKeyId:configuration.accessKeyId,secretAccessKey:configuration.secretAccessKey},maxAttempts:1});
  try{
    const result=await client.send(new SendEmailCommand({FromEmailAddress:configuration.from,Destination:{ToAddresses:[mail.to]},ConfigurationOverrides:{Tracking:{ClickTrackingEnabled:'DISABLED',OpenTrackingEnabled:'DISABLED'}},Content:{Simple:{Subject:{Data:mail.subject,Charset:'UTF-8'},Body:{Text:{Data:mail.text,Charset:'UTF-8'}}}}}),{abortSignal:AbortSignal.timeout(8000)});
    if(!result.MessageId)throw new Error('Unconfirmed delivery.');
  }finally{client.destroy();}
}
const SOURCES:Record<string,[string,string]>={manual:['manuel kayıt','manual record'],ga4:['Google Analytics','Google Analytics'],search_console:['Search Console','Search Console'],product_webhook:['ürün olayları','product events']};
// Plain-text summary built only from the stored review facts; the same honesty rules as the screen.
export function digestMessage(facts:CoachReviewFacts,adjustments:CoachAdjustment[],lang:Lang,project:{name:string;timezone:string},origin:string){
  const tr=lang==='tr',locale=tr?'tr-TR':'en-GB',n=(value:number)=>value.toLocaleString(locale),date=(value:string)=>new Date(value).toLocaleDateString(locale,{day:'numeric',month:'short',timeZone:project.timezone});
  const period=`${date(facts.from)} – ${date(facts.to)}`,lines:string[]=[];
  lines.push(tr?`${project.name} · haftalık özet · ${period}`:`${project.name} · weekly review · ${period}`,'');
  lines.push(tr?'Ne oldu':'What happened');
  lines.push(`- ${tr?`Koç eylemleri: ${n(facts.actions.done)} tamamlandı, ${n(facts.actions.skipped)} atlandı, ${n(facts.actions.open)} açık.`:`Coach actions: ${n(facts.actions.done)} done, ${n(facts.actions.skipped)} skipped, ${n(facts.actions.open)} open.`}`);
  lines.push(`- ${facts.content.drafts?(tr?`${n(facts.content.drafts)} içerik taslağı kaydedildi.`:`${n(facts.content.drafts)} content draft(s) saved.`):(tr?'Yeni içerik taslağı kaydedilmedi.':'No new content draft was saved.')}`);
  lines.push(`- ${facts.content.publications?(tr?`${n(facts.content.publications)} sosyal yayın sağlayıcı tarafından kabul edildi (erişim veya etkileşim değildir).`:`${n(facts.content.publications)} social publication(s) accepted by the provider (not reach or engagement).`):(tr?'Kabul edilen sosyal yayın yok.':'No social publication was accepted.')}`);
  lines.push('',tr?'Ölçümler':'Measurements');
  if(facts.measurements.length)for(const item of facts.measurements)lines.push(`- ${item.goal[lang]} · ${item.stage[lang]}: ${n(item.latest)} (${date(item.latestAt)})${item.previous!==null?(tr?`, önceki ${n(item.previous)} (${date(item.previousAt!)})`:`, previous ${n(item.previous)} (${date(item.previousAt!)})`):''} · ${SOURCES[item.source]?.[tr?0:1]||item.source}`);
  else lines.push(`- ${tr?'Bu dönemde ölçüm kaydedilmedi. Veri yok, sıfır demek değildir.':'No measurement was recorded in this period. No data is not zero.'}`);
  if(facts.rose.length)lines.push('',tr?'Ekip aktifken artan ölçümler (neden-sonuç kanıtı değildir):':'Measurements that rose while the team was active (not proof of cause):',...facts.rose.map(item=>`- ${item.goal[lang]} · ${item.stage[lang]}: ${n(item.from)} → ${n(item.to)}`));
  const open=adjustments.filter(item=>item.state==='proposed');
  if(open.length)lines.push('',tr?'Onay bekleyen plan önerileri':'Plan proposals waiting for approval',...open.map(item=>`- ${item.title[lang]}`));
  lines.push('',tr?`Özeti Ryzevo'da açın: ${origin}/?tab=dashboard`:`Open the review in Ryzevo: ${origin}/?tab=dashboard`,'',
    tr?'Bu e-postayı haftalık özete abone olduğunuz için aldınız. Aboneliği genel bakıştaki haftalık özet kartından kapatabilirsiniz. Tahmin, artış veya ROI hesaplanmaz.':'You receive this email because you subscribed to the weekly review. You can turn it off from the weekly review card on the overview. No estimates, uplift or ROI are calculated.');
  return {subject:tr?`Ryzevo · ${project.name} · haftalık özet (${period})`:`Ryzevo · ${project.name} · weekly review (${period})`,text:lines.join('\n').slice(0,20000)};
}
const SEND_DENIED='Haftalık özeti yalnız onay yetkisi olan ekip üyeleri gönderebilir.';
type ReviewRow={id:string;week:string;facts_json:string;adjustments_json:string};
export class CoachDigest{
  coach:GrowthCoach;repo:PlatformRepository;
  constructor(public db:Database.Database,public scope:MarketingScope){this.coach=new GrowthCoach(db,scope);this.repo=this.coach.repo;}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  private email(user=this.scope.subject){return (this.db.prepare('SELECT email FROM platform_account_emails WHERE user_id=?').get(user) as {email:string}|undefined)?.email||null;}
  private subscription(user=this.scope.subject){return this.db.prepare('SELECT language FROM platform_coach_digest_subscriptions WHERE user_id=? AND organization_id=? AND project_id=?').get(user,...this.args()) as {language:Lang}|undefined;}
  private review(){return this.db.prepare('SELECT id,week,facts_json,adjustments_json FROM platform_coach_reviews WHERE organization_id=? AND project_id=? AND week=?').get(...this.args(),coachWeekKey(new Date(),this.coach.timeZone())) as ReviewRow|undefined;}
  private audit(operation:string){this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),operation,new Date().toISOString());}
  private recipients(){return this.db.prepare("SELECT s.user_id,s.language,e.email FROM platform_coach_digest_subscriptions s JOIN platform_account_emails e ON e.user_id=s.user_id JOIN platform_memberships m ON m.user_id=s.user_id AND m.project_id=s.project_id AND m.organization_id=s.organization_id AND m.active=1 JOIN platform_users u ON u.id=s.user_id AND u.active=1 WHERE s.organization_id=? AND s.project_id=?").all(...this.args()) as {user_id:string;language:Lang;email:string}[];}
  // The preview follows the member's subscription language, else the language they are viewing in.
  read(viewLang?:unknown):CoachDigestSnapshot{
    this.coach.authorize();const review=this.review(),project=this.repo.workspace(this.scope.subject,...this.args())!.project,configuration=digestConfiguration(),subscription=this.subscription(),canSend=this.coach.can('campaign.approve');
    const counts=review?(this.db.prepare('SELECT state,COUNT(*) n FROM platform_coach_digest_deliveries WHERE organization_id=? AND project_id=? AND review_id=? GROUP BY state').all(...this.args(),review.id) as {state:string;n:number}[]):[];
    const lang=subscription?.language||(viewLang==='en'||viewLang==='tr'?viewLang:project.language)||'tr';
    return {subscribed:Boolean(subscription),language:subscription?.language||null,hasVerifiedEmail:Boolean(this.email()),enabled:Boolean(configuration),canSend,
      recipients:canSend?this.recipients().length:null,reviewId:review?.id||null,deliveries:Object.fromEntries(counts.map(item=>[item.state,item.n])),
      preview:review?digestMessage(JSON.parse(review.facts_json),JSON.parse(review.adjustments_json),lang,project,configuration?.origin||'https://ryzevo.com'):null};
  }
  subscribe(raw:Record<string,unknown>){
    this.coach.authorize();const language=coachChoice(['tr','en'] as const,raw.language);
    if(!this.email())throw new MarketingStoreError('Özeti e-postayla almak için önce hesap e-postanızı doğrulayın.',409);
    this.db.transaction(()=>{this.coach.authorize();this.db.prepare('INSERT INTO platform_coach_digest_subscriptions(user_id,organization_id,project_id,language,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,organization_id,project_id) DO UPDATE SET language=excluded.language').run(this.scope.subject,...this.args(),language,new Date().toISOString());this.audit('coach.digest.subscribe');}).immediate();
    return this.read();
  }
  unsubscribe(){
    this.coach.authorize();this.db.transaction(()=>{this.db.prepare('DELETE FROM platform_coach_digest_subscriptions WHERE user_id=? AND organization_id=? AND project_id=?').run(this.scope.subject,...this.args());this.audit('coach.digest.unsubscribe');}).immediate();return this.read();
  }
  // Queues this week's review for current subscribers. Re-sending the same review never mails anyone twice.
  send(raw:Record<string,unknown>){
    this.coach.authorize('campaign.approve',SEND_DENIED);if(!digestConfiguration())throw new MarketingStoreError('E-posta özeti bu platformda etkin değil; yalnız önizleme kullanılabilir.',503);
    return this.db.transaction(()=>{
      this.coach.authorize('campaign.approve',SEND_DENIED);const review=this.review();if(!review||review.id!==raw.reviewId)throw new MarketingStoreError('Yalnız bu haftanın özeti gönderilebilir.',409);
      const recipients=this.recipients();if(!recipients.length)throw new MarketingStoreError('Bu özete abone olmuş ve e-postası doğrulanmış ekip üyesi yok.',409);
      const now=new Date().toISOString(),insert=this.db.prepare("INSERT OR IGNORE INTO platform_coach_digest_deliveries(id,organization_id,project_id,review_id,user_id,state,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?,?)");
      let queued=0;for(const item of recipients)queued+=insert.run(`digest_${randomUUID()}`,...this.args(),review.id,item.user_id,this.scope.subject,now,now).changes;
      this.audit('coach.digest.send');return {queued,snapshot:this.read()};
    }).immediate();
  }
}
// Worker step: claims one queued digest, re-checks membership/subscription/verified email, marks it submitted before
// the provider call (never retried) and records sent or uncertain.
export async function deliverNextCoachDigest(db:Database.Database,deliver:DigestDelivery=deliverCoachDigest,configuration=digestConfiguration()){
  if(!configuration)return false;
  const claimed=db.transaction(()=>{
    const row=db.prepare("SELECT d.id,d.organization_id,d.project_id,d.review_id,d.user_id FROM platform_coach_digest_deliveries d WHERE d.state='queued' ORDER BY d.created_at,d.rowid LIMIT 1").get() as {id:string;organization_id:string;project_id:string;review_id:string;user_id:string}|undefined;
    if(!row)return null;
    const now=new Date().toISOString(),skip=(reason:string)=>{db.prepare("UPDATE platform_coach_digest_deliveries SET state='skipped',reason=?,updated_at=? WHERE id=?").run(reason,now,row.id);return 'skipped' as const;};
    const repo=new PlatformRepository(db),workspace=repo.can(row.user_id,row.organization_id,row.project_id,'read')?repo.workspace(row.user_id,row.organization_id,row.project_id):null;
    const subscription=db.prepare('SELECT language FROM platform_coach_digest_subscriptions WHERE user_id=? AND organization_id=? AND project_id=?').get(row.user_id,row.organization_id,row.project_id) as {language:Lang}|undefined;
    const email=(db.prepare('SELECT email FROM platform_account_emails WHERE user_id=?').get(row.user_id) as {email:string}|undefined)?.email;
    const review=db.prepare('SELECT facts_json,adjustments_json FROM platform_coach_reviews WHERE id=? AND organization_id=? AND project_id=?').get(row.review_id,row.organization_id,row.project_id) as {facts_json:string;adjustments_json:string}|undefined;
    if(!workspace||workspace.project.productPack!=='standard')return skip('membership');if(!subscription)return skip('unsubscribed');if(!email)return skip('email');if(!review)return skip('review');
    db.prepare("UPDATE platform_coach_digest_deliveries SET state='submitted',updated_at=? WHERE id=? AND state='queued'").run(now,row.id);
    return {id:row.id,mail:{to:email,...digestMessage(JSON.parse(review.facts_json),JSON.parse(review.adjustments_json),subscription.language,workspace.project,configuration.origin)}};
  }).immediate();
  if(!claimed||claimed==='skipped')return Boolean(claimed);
  let state:'sent'|'uncertain'='sent';try{await deliver(claimed.mail,configuration);}catch{state='uncertain';}
  db.prepare('UPDATE platform_coach_digest_deliveries SET state=?,updated_at=? WHERE id=?').run(state,new Date().toISOString(),claimed.id);
  return true;
}
