import 'server-only';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { WorkspacePermission } from './access';
import type { LocalizedText } from './catalog';
import { PlatformRepository } from './repository';
import { ProjectMarketingStore,type MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { ProjectOperations } from './operations';
import { projectEntitlement } from './entitlements';
import { SocialPublications } from './social-publications';
import { CampaignReviews } from './campaign-review';
import { EmailPilotQueue } from './email-pilots';
import { emailSenderReadiness } from './email-sender';
import { MobileGrowth } from './mobile-store';
import { MobileDelivery } from './mobile-delivery';
import { ProjectMeasurements } from './measurements';
import { googleConfiguration } from './google-client';
import { linkedinConfiguration } from './linkedin-client';
import { linkedinOrganizationConfiguration } from './linkedin-organization-publishing';
import { metaConfiguration } from './meta-client';
import { xConfiguration } from './x-client';
import { COMPASS_CHANNELS,COMPASS_INTENTS,COMPASS_VERSION,GUIDE_IDS,connectionGuide,connectionGuideName,type GuideId,type CompassChannel } from './guidance-catalog';
import type { CompassPreferences,CompassProvider,CompassSnapshot,CompassStep } from './guidance-types';
import { coachState,compassFromBrief } from './coach-compass';
const l=(tr:string,en:string):LocalizedText=>({tr,en});
const ready=(test:()=>unknown)=>{try{test();return true;}catch{return false;}};
const object=(raw:unknown):Record<string,unknown>=>raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
const field=(value:unknown,max=100)=>{if(value===undefined||value===null||value==='')return '';if(typeof value!=='string'||value.length>max||!value.trim()||/[\x00-\x1f]/.test(value))throw new MarketingStoreError('Pusula alanı geçersiz.');return value;};
export const compassSiteReceipt=(website:string)=>'seo.audit.completed:'+createHash('sha256').update(new URL(website).origin).digest('hex');
type PreferenceRow={revision:number;preferences_json:string;deferred:number;updated_at:string};
export class GrowthCompass {
  repo:PlatformRepository;store:ProjectMarketingStore;
  constructor(public db:Database.Database,public scope:MarketingScope,public key:string){this.repo=new PlatformRepository(db);this.store=new ProjectMarketingStore(db,scope);}
  args(){return [this.scope.organizationId,this.scope.projectId] as const;}
  can(permission:WorkspacePermission){return this.repo.can(this.scope.subject,...this.args(),permission);}
  authorize(){if(!this.can('read')||this.repo.workspace(this.scope.subject,...this.args())?.project.productPack!=='standard')throw new MarketingStoreError('Pusula için standart proje erişimi gerekli.',403);}
  private row(){return this.db.prepare('SELECT revision,preferences_json,deferred,updated_at FROM platform_compass_preferences WHERE user_id=? AND organization_id=? AND project_id=?').get(this.scope.subject,...this.args()) as PreferenceRow|undefined;}
  private preferences():CompassPreferences|null{const row=this.row();return row?{...JSON.parse(row.preferences_json),revision:row.revision,deferred:Boolean(row.deferred),updatedAt:row.updated_at}:null;}
  private normalize(raw:Record<string,unknown>){
    const project=this.repo.workspace(this.scope.subject,...this.args())!.project;
    if(!COMPASS_INTENTS.includes(raw.intent as never)||!['guided','experienced'].includes(String(raw.experience)))throw new MarketingStoreError('Öncelik ve rehberlik tercihi seçin.');
    if(!Array.isArray(raw.channels)||raw.channels.length>3||new Set(raw.channels).size!==raw.channels.length||raw.channels.some(value=>!COMPASS_CHANNELS.includes(value as never)))throw new MarketingStoreError('En fazla üç farklı kanal seçin.');
    const goalId=field(raw.goalId),campaignId=field(raw.campaignId,150),appId=field(raw.appId);
    if(goalId&&!project.goals.some(goal=>goal.id===goalId))throw new MarketingStoreError('Hedef bu projede bulunamadı.',404);
    if(campaignId){const campaign=this.store.campaign(campaignId);if(!campaign||goalId&&campaign.goalId!==goalId)throw new MarketingStoreError('Kampanya seçilen projeye/hedefe ait değil.',404);}
    if(appId&&!this.db.prepare('SELECT 1 FROM platform_mobile_apps WHERE id=? AND organization_id=? AND project_id=?').get(appId,...this.args()))throw new MarketingStoreError('Uygulama bu projede bulunamadı.',404);
    const obstacles=object(raw.obstacles);if(Object.keys(obstacles).length>GUIDE_IDS.length||Object.entries(obstacles).some(([id,value])=>!GUIDE_IDS.includes(id as GuideId)||!['unknown','no_account','need_access','later'].includes(String(value))))throw new MarketingStoreError('Bağlantı tercihi geçersiz.');
    return {intent:raw.intent as CompassPreferences['intent'],experience:raw.experience as CompassPreferences['experience'],goalId,campaignId,appId,channels:raw.channels as CompassChannel[],obstacles:obstacles as CompassPreferences['obstacles']};
  }
  save(raw:Record<string,unknown>,deferred=false){
    this.authorize();return this.db.transaction(()=>{
      this.authorize();const row=this.row();if(!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision!==(row?.revision||0))throw new MarketingStoreError('Pusula başka bir sekmede değişti. Yenileyip tekrar deneyin.',409);
      const input=this.normalize(raw),now=new Date().toISOString();
      this.db.prepare('INSERT INTO platform_compass_preferences VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,organization_id,project_id) DO UPDATE SET revision=excluded.revision,preferences_json=excluded.preferences_json,deferred=excluded.deferred,updated_at=excluded.updated_at').run(this.scope.subject,...this.args(),(row?.revision||0)+1,JSON.stringify(input),Number(deferred),now,now);
      this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),deferred?'compass.defer':'compass.preferences',now);
      return this.read();
    }).immediate();
  }
  defer(expectedRevision:number){const current=this.preferences();return this.save({...current,intent:current?.intent||'leads',experience:current?.experience||'guided',channels:current?.channels||[],obstacles:current?.obstacles||{},expectedRevision},true);}
  handoff(provider:GuideId){
    this.authorize();const guide=connectionGuide(provider);if(!guide)throw new MarketingStoreError('Rehber bulunamadı.',404);
    if(!this.can('content.write'))throw new MarketingStoreError('İş kaydı için içerik yazma yetkisi gerekir; hesap yöneticinizden yardım isteyin.',403);
    return this.db.transaction(()=>{
    const operations=new ProjectOperations(this.db,this.scope),marker=`compass.handoff:${provider}:`,receipts=this.db.prepare("SELECT operation FROM platform_audit WHERE organization_id=? AND project_id=? AND operation GLOB 'compass.handoff:*'").all(...this.args()) as {operation:string}[],ids=new Set(receipts.filter(item=>item.operation.startsWith(marker)).map(item=>item.operation.slice(marker.length)));
    const current=operations.tasks().find(item=>(ids.has(item.id)||item.note.startsWith(`compass-handoff:${provider}\n`))&&!['completed','cancelled'].includes(item.status));if(current)return {task:current,created:false};
    const task=operations.saveTask({title:`Bağlantı kurulumu · ${connectionGuideName(provider,'tr')}`.slice(0,160),dueAt:new Date(Date.now()+86400000).toISOString(),status:'planned',note:['Hedef: '+connectionGuideName(provider,'tr'),...guide.needs.map(item=>item.tr),'Sunucu OAuth kurulumu Ryzevo operatörüne; müşteri hesap/sayfa erişimi hesap sahibine aittir. Parola, token veya API anahtarı bu işe eklenmez.',...guide.links.map(item=>item.url)].join('\n').slice(0,2000)});
    this.db.prepare('INSERT INTO platform_audit(actor_id,organization_id,project_id,operation,created_at) VALUES(?,?,?,?,?)').run(this.scope.subject,...this.args(),marker+task.id,new Date().toISOString());return {task,created:true};
    }).immediate();
  }
  read():CompassSnapshot {
    this.authorize();const workspace=this.repo.workspace(this.scope.subject,...this.args())!,project=workspace.project,prefs=this.preferences(),canManage=this.can('connections.manage'),canWrite=this.can('content.write'),rights=projectEntitlement(this.db,this.scope),trialActive=rights.active;
    const primary=prefs?.channels[0],campaigns=this.store.listCampaigns().filter(item=>(!prefs?.goalId||item.goalId===prefs.goalId)&&(!prefs?true:prefs.intent==='retention'?item.channels.email:prefs.intent==='mobile'?true:prefs.intent==='seo'?false:primary==='email'?item.channels.email:Boolean(primary&&item.channels.social.includes(primary.startsWith('linkedin_')?'linkedin':primary)))),chosen=prefs?.campaignId?campaigns.find(item=>item.id===prefs.campaignId):campaigns.length===1?campaigns[0]:undefined;
    const apps=this.db.prepare('SELECT id,config_json FROM platform_mobile_apps WHERE organization_id=? AND project_id=? ORDER BY created_at,id LIMIT 3').all(...this.args()) as {id:string;config_json:string}[],app=prefs?.appId?apps.find(item=>item.id===prefs.appId):apps.length===1?apps[0]:undefined;
    const social=new SocialPublications(this.db,this.scope,this.key).workspace(),connections=canManage?this.store.connections():[],providers:CompassProvider[]=[];
    const providerIds=new Set<GuideId>([...(prefs?.channels||[]),'ga4','search_console','product_data','mobile']);
    const configured:Partial<Record<GuideId,boolean>>={ga4:ready(googleConfiguration),search_console:ready(googleConfiguration),linkedin_person:ready(linkedinConfiguration),linkedin_company:ready(linkedinOrganizationConfiguration),facebook:ready(metaConfiguration),instagram:ready(metaConfiguration),twitter:ready(xConfiguration),email:true,product_data:true,mobile:true};
    for(const id of providerIds){
      const platform=id.startsWith('linkedin_')?'linkedin':id,target=social.targets.filter(item=>item.platform===platform&&(platform!=='linkedin'||item.accountType===(id==='linkedin_company'?'organization':'person'))),list=connections.filter(item=>id==='product_data'?['product_rest','product_webhook'].includes(item.provider):id==='mobile'?item.provider==='mobile':id==='email'?item.provider==='email':id==='ga4'||id==='search_console'?item.provider===id:item.provider==='social'&&item.socialPlatform===platform&&(platform!=='linkedin'||item.socialAccountType===(id==='linkedin_company'?'organization':'person'))),verified=list.find(item=>item.isConnected),published=target.find(item=>item.ready);
      providers.push({id,state:!canManage?'restricted':published?'publishing_verified':verified?'access_verified':configured[id]===false?'operator_setup':list.some(item=>item.active)?'configured':'missing',checkedAt:published?.checkedAt||verified?.checkedAt||null});
    }
    const steps:CompassStep[]=[],settings='/?tab=project',campaignHref='/?tab=campaigns',publicationHref='/?tab=calendar&planning=social',mobileHref='/?tab=mobile';
    const step=(id:string,label:LocalizedText,detail:LocalizedText,done:boolean,href:string,permission:WorkspacePermission='read',provider?:GuideId,blocked?:LocalizedText|null,evidenceAt:string|null=null)=>{
      const tab=new URL(href,'https://ryzevo.invalid').searchParams.get('tab'),enabled=workspace.modules.some(item=>item.id===tab),canAct=enabled&&this.can(permission),reason=!enabled?l('Bu araç projenizde etkin değil. Proje yöneticisine danışın.','This tool is not enabled. Contact the project administrator.'):!this.can(permission)?l('Bu adım için yetkili bir ekip üyesi gerekli.','An authorized team member is required for this step.'):blocked||null;
      steps.push({id,label,detail,state:done?'done':reason?'blocked':'todo',reason:done?null:reason,href,provider,canAct,evidenceAt});
    };
    step('profile',l('Marka dili ve ölçülecek hedef','Brand voice & a goal to measure'),l('Proje ayarlarında markanızın nasıl konuştuğunu yazın ve ölçmek istediğiniz bir hedef ekleyin (ör. “ayda 30 teklif isteği”). Koç, içerikler ve raporlar bu hedefe göre çalışır. Hedef zaten varsa yenisini açmayın.','In project settings, describe how your brand speaks and add a goal you want to measure (e.g. “30 quote requests a month”). The coach, content and reports work towards it. Reuse a goal that already exists.'),Boolean(project.brandVoice&&project.goals.length&&(!prefs?.goalId||project.goals.some(goal=>goal.id===prefs.goalId))),settings,'connections.manage');
    if(prefs){
      const emailFlow=prefs.intent==='retention'||prefs.channels[0]==='email';
      if(!prefs.goalId)step('goal',l('Bu rotanın büyüme hedefini seç','Choose this path’s growth goal'),l('Mevcut proje hedefini seçin; kampanya ve ölçümler aynı hedefe bağlansın.','Select an existing project goal so campaigns and measurements follow the same outcome.'),false,settings,'read');
      if(['leads','social'].includes(prefs.intent)&&!prefs.channels.length)step('channels',l('Öncelikli kanalı seç','Choose a priority channel'),l('İlk pilot için bir kanal yeterli. Kanal seçimi hesap erişimi vermez.','One channel is enough for the first pilot. Choosing it does not grant account access.'),false,'/?tab=dashboard');
      for(const channel of prefs.channels){
        const provider=providers.find(item=>item.id===channel)!,state=provider.state,guide=connectionGuide(channel)!,obstacle=prefs.obstacles[channel];
        const blocker=state==='operator_setup'?l('Ryzevo sunucu OAuth kurulumu bekleniyor. Bunu müşteri değil Ryzevo yöneticisi tamamlar.','Ryzevo server OAuth setup is pending. The Ryzevo operator, not the customer, must complete it.'):obstacle==='later'?l('Bu bağlantıyı sonraya bıraktınız; tamamlanmış sayılmadı.','You deferred this connection; it is not complete.'):obstacle==='need_access'?l('Hesap/sayfa sahibinden kendi hesabınıza uygun erişim isteyin.','Ask the account/page owner for appropriate access for your own account.'):obstacle==='no_account'?l('Önce size/işletmenize ait hesap veya sayfa gerekli; rehberden başlayabilirsiniz.','A customer-owned account or page is required; start with the guide.'):obstacle==='unknown'?l('Hesap ve izin rehberini açın; gerekirse bir kurulum işi oluşturun.','Open the account and access guide; create a setup task if needed.'):null;
        step(`connection:${channel}`,l(`${connectionGuideName(channel,'tr')} bağlantısı`,`${connectionGuideName(channel,'en')} connection`),guide.purpose,['access_verified','publishing_verified'].includes(state),guide.href,'connections.manage',channel,blocker,provider.checkedAt);
      }
      if(prefs.intent==='seo'){
        const audit=this.db.prepare('SELECT MAX(created_at) at FROM platform_audit WHERE organization_id=? AND project_id=? AND operation=?').get(...this.args(),compassSiteReceipt(project.website)) as {at:string|null};
        step('site-audit',l('Web sitenizi tarayın','Scan your website'),l('SEO & Blog ekranında site taramasını başlatın; eksik başlık, açıklama ve benzeri sorunlar önem sırasıyla listelenir. Tarama Google sıralamasını ölçmez.','Start the site scan in SEO & Blog; missing titles, descriptions and similar issues are listed by importance. A scan does not measure Google rankings.'),Boolean(audit.at),'/?tab=seo','content.write',undefined,null,audit.at);
        const gsc=providers.find(item=>item.id==='search_console')!;step('search-data',l('Gerçek arama verisi','Actual search data'),l('Search Console erişimi; veri yoksa trafik/sıralama üretilmez.','Search Console access; no traffic/rankings are fabricated without data.'),['access_verified','publishing_verified'].includes(gsc.state),connectionGuide('search_console')!.href,'connections.manage','search_console',gsc.state==='operator_setup'?l('Google OAuth sunucu kurulumu bekleniyor.','Google OAuth server setup is pending.'):null);
        const task=new ProjectOperations(this.db,this.scope).tasks().find(item=>{try{return Boolean(audit.at)&&new URL(item.note.split('\n')[0]).origin===new URL(project.website).origin;}catch{return false;}});
        const clean=this.db.prepare('SELECT 1 FROM platform_audit WHERE organization_id=? AND project_id=? AND operation=? AND created_at=?').get(...this.args(),compassSiteReceipt(project.website)+':clean',audit.at||'');
        step('improvement-task',l('Bulguyu uygulama işine dönüştür','Turn a finding into a task'),l('Varsa, site denetimindeki bulgudan mevcut takvime iş ekleyin. Temiz denetimde iş oluşturmanız gerekmez. İş kaydı yayın yapmaz.','If found, add an audit finding to the existing calendar. A clean audit needs no task. A task does not deploy changes.'),Boolean(task||clean),'/?tab=seo','content.write');
        // Keeping the site watched and checking how AI assistants answer the customer's questions (GEO).
        const scheduled=this.db.prepare('SELECT 1 FROM platform_seo_schedules WHERE organization_id=? AND project_id=?').get(...this.args());
        step('seo-schedule',l('Otomatik taramayı açın','Turn on the automatic scan'),l('Site taramasında “Otomatik tarama”yı haftalık veya aylık açın; yeni bir sorun çıkınca “Dikkat gerekenler”de görürsünüz.','Turn on “Automatic scan” weekly or monthly in Site scan; new issues then appear in “Needs attention”.'),Boolean(scheduled),'/?tab=seo','content.write');
        const visibility=this.db.prepare("SELECT MAX(asked_at) at FROM platform_ai_visibility_checks WHERE organization_id=? AND project_id=? AND status='ok'").get(...this.args()) as {at:string|null};
        step('ai-visibility',l('AI aramalarında nasıl göründüğünüze bakın','See how you appear in AI search'),l('Müşterinizin bir AI asistanına soracağı birkaç soru yazıp sorun: cevapta markanız anılıyor ve siteniz kaynak gösteriliyor mu?','Write a few questions your customer would ask an AI assistant and ask them: is your brand named and your site cited?'),Boolean(visibility.at),'/?tab=seo&seoView=visibility','content.write',undefined,null,visibility.at);
      }else{
        if(emailFlow){
          const rows=this.db.prepare("SELECT MAX(r.received_at) at FROM platform_product_records r JOIN platform_product_sources s ON s.connection_id=r.connection_id AND s.version=r.version JOIN platform_connections c ON c.id=s.connection_id WHERE r.organization_id=? AND r.project_id=? AND c.active=1 AND s.enabled=1 AND c.provider IN ('product_rest','product_webhook') AND (?='' OR r.connection_id=?)").get(...this.args(),chosen?.segmentBinding?.sourceId||'',chosen?.segmentBinding?.sourceId||'') as {at:string|null};step('product-events',l('Gerçek ürün verisi','Actual product data'),l('Etkin kaynakta güncel kayıt; ardından izinli kitle ve alıcı eşleştirmesi.','Actual records in an active source, then consented audience and recipient mapping.'),Boolean(rows.at),'/?tab=project&settings=data','connections.manage','product_data',null,rows.at);
          const sender=emailSenderReadiness(this.db,this.scope);step('sender',l('Gönderen ve iletişim izni','Sender & communication consent'),l('Gönderen sahipliği, erişim testi, izin kanıtı ve test alıcıları ayrı kontrollerdir.','Sender ownership, access test, consent evidence and test recipients are separate checks.'),sender.smtpReady&&sender.ownership==='verified'&&sender.activePilotAddresses>0,'/?tab=campaigns&campaignView=sender','connections.manage','email');
        }
        if(prefs.intent==='mobile'){
          step('mobile-app',l('Mobil uygulamanı seç','Select your mobile app'),l('Var olan uygulama kaydını seçin; ikinci bir uygulama kaydı oluşturmayın.','Select the existing app record; do not create a duplicate.'),Boolean(app),mobileHref,'connections.manage','mobile');
          const event=app?this.db.prepare("SELECT MAX(e.occurred_at) at FROM platform_product_events e JOIN platform_mobile_event_details d ON d.event_id=e.event_id AND d.source_id=e.connection_id JOIN platform_mobile_apps a ON a.id=d.app_id JOIN platform_product_sources s ON s.connection_id=a.source_id AND s.version=a.source_version JOIN platform_connections c ON c.id=s.connection_id WHERE a.id=? AND e.organization_id=? AND e.project_id=? AND e.version=a.source_version AND c.active=1 AND s.enabled=1 AND json_extract(d.details_json,'$.environment')='production'").get(app.id,...this.args()) as {at:string|null}:null;step('mobile-events',l('Mobil olay akışını doğrula','Verify mobile events'),l('Kaydedilmiş anahtar değil, gerçek uygulama olayı. SDK/relay kurulumu uygulama ekibinin işidir.','An actual app event, not a saved key. SDK/relay setup belongs to the app team.'),Boolean(event?.at),mobileHref,'connections.manage','mobile',null,event?.at||null);
        }
        // Starter drafts from the coach count only once the team has saved them.
        const draft=this.store.history().some(item=>!item.starter&&prefs.channels.some(channel=>item.platform===(channel.startsWith('linkedin_')?'linkedin':channel)));
        step('draft',l('İlk içeriği hazırla','Prepare the first content'),l('Mevcut kütüphanedeki taslağı kullanabilirsiniz. İçerik kaydı gönderim değildir.','Reuse a draft from the existing library. Saving content is not sending.'),draft||Boolean(chosen?.content.text),'/?tab=library','content.write');
        step('campaign',l('Kampanyayı hedefe bağla','Bind a campaign to the goal'),l('Seçili hedef/kanalla eşleşen mevcut bir kampanya seçin veya taslağı tamamlayın.','Select an existing campaign matching the selected goal/channel or complete its draft.'),Boolean(chosen),campaignHref,'content.write');
        let rehearsal=false,delivered=false,checkedAt:string|null=null;
        if(chosen&&emailFlow){
          const review=new CampaignReviews(this.db,this.scope,this.key).get(chosen.id),queue=new EmailPilotQueue(this.db,this.scope,this.key),jobs=queue.list(chosen.id).jobs;rehearsal=jobs.some(job=>{const row=queue.row(job.id);return job.status==='completed'&&job.checked>0&&job.uncertain===0&&row.revision===review.digest&&row.review_id===review.history[0]?.id;});
          step('review',l('Güncel içerik ve kitle onayı','Current content & audience approval'),l('Onaylı içerik ve güncel, izinli kitle ön kontrolü. Eski onay yeni içeriği kapsamaz.','Approved content and a current consented-audience preflight. Old approval does not cover new content.'),review.approval==='approved'&&review.audience?.fresh===true,campaignHref,'campaign.approve');
          delivered=queue.list(chosen.id,'send').jobs.some(job=>(job.accepted||0)>0&&queue.row(job.id).revision===review.digest);checkedAt=jobs[0]?.updatedAt||null;
        }else if(chosen&&prefs.intent==='mobile'&&app&&canManage){const delivery=new MobileDelivery(new MobileGrowth(this.db,this.scope,this.key)),jobs=delivery.list(app.id).filter(item=>item.campaignId===chosen.id);rehearsal=jobs.some(item=>item.mode==='rehearsal'&&item.status==='rehearsed'&&delivery.isCurrent(item.id));delivered=jobs.some(item=>item.mode==='live'&&(item.accepted>0||item.impressions>0));checkedAt=jobs[0]?.createdAt||null;
        }else if(chosen&&prefs.intent!=='mobile'){
          const primary=prefs.channels[0],platform=primary?.startsWith('linkedin_')?'linkedin':primary,sources=social.sources.filter(item=>item.kind==='campaign'&&item.id===chosen.id&&item.platform===platform);
          const rows=this.db.prepare("SELECT p.*,j.revision FROM platform_social_publications p JOIN platform_jobs j ON j.id=p.job_id WHERE p.organization_id=? AND p.project_id=? AND p.source_kind='campaign' AND p.source_id=? ORDER BY j.created_at DESC LIMIT 50").all(...this.args(),chosen.id) as {source_digest:string;connection_id:string;mode:string;state:string;revision:string}[];
          const current=rows.filter(row=>sources.some(source=>source.eligible&&source.digest===row.source_digest)&&social.targets.some(target=>target.id===row.connection_id&&target.revision===row.revision&&target.platform===platform&&(platform!=='linkedin'||target.accountType===(primary==='linkedin_company'?'organization':'person'))));
          rehearsal=current.some(row=>row.mode==='rehearsal'&&row.state==='rehearsed');delivered=current.some(row=>row.mode==='publish'&&row.state==='accepted');
        }
        const flow=emailFlow?campaignHref:prefs.intent==='mobile'?mobileHref+'&mobileSection=messages':publicationHref;
        step('rehearsal',l('Gönderimsiz prova','No-send rehearsal'),l('Onaylı içeriği seçili hesapla deneyin: her şeyin doğru gittiğini görürsünüz ama hiçbir şey yayınlanmaz.','Try the approved content with the selected account: you see that everything works, but nothing is published.'),rehearsal,flow,'campaign.approve',undefined,null,checkedAt);
        const liveEnabled=emailFlow?process.env.PLATFORM_EMAIL_PILOT_SEND_ENABLED==='1':prefs.intent==='mobile'?process.env.PLATFORM_MOBILE_SEND_ENABLED==='1':process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED==='1';
        step('live',l('İlk gerçek yayın','First live post'),l('Provadan sonra gerçek yayını aynı ekranda ayrıca onaylarsınız. Yayının kabul edilmesi, görüldüğü veya satış getirdiği anlamına gelmez.','After the rehearsal you approve the live post separately on the same screen. A post being accepted does not mean it was seen or sold anything.'),delivered,flow,'campaign.dispatch',undefined,!trialActive||!rights.liveDeliveryAllowed?l('Plan/deneme koşulları gerçek gönderime izin vermiyor; prova ile ilerleyebilirsiniz.','The plan/trial does not allow live delivery; continue with rehearsal.'):!liveEnabled?l('Gerçek gönderim sunucuda kapalı. Pusula bu güvenlik sınırını açmaz.','Live delivery is disabled on the server. Compass does not enable it.'):!rehearsal?l('Önce güncel içerikle gönderimsiz prova gerekli.','A no-send rehearsal of the current content is required first.'):null);
      }
      const manual=new ProjectOperations(this.db,this.scope).metrics().find(item=>item.source==='manual'&&project.goals.some(goal=>goal.id===item.goalId)&&item.goalId===prefs.goalId),automatic=new ProjectMeasurements(this.db,this.scope,this.key).workspace().bindings.find(item=>item.goalId===prefs.goalId&&item.enabled&&item.valid&&item.latest?.fresh),measurement={at:manual?.observedAt||automatic?.latest?.checkedAt||null};
      step('measurement',l('Sonucu ölç ve sonraki adıma karar ver','Measure and choose the next step'),l('Hedefe bağlı tarihli ölçümler. Veri yoksa sonuç, artış veya ROI varsayılmaz.','Dated goal-linked measurements. Missing data does not imply results, uplift or ROI.'),Boolean(measurement.at),'/?tab=analytics','read',undefined,null,measurement.at);
    }
    const next=steps.find(item=>item.state!=='done');
    const coach=coachState(this.db,...this.args());
    return {version:COMPASS_VERSION,firstRun:!prefs,preferences:prefs,coach:{hasBrief:Boolean(coach.brief),hasDraft:coach.hasDraft,canDiagnose:canWrite},suggestion:coach.brief?compassFromBrief(coach.brief,coach.answers,project.goals):null,projectName:project.name,goals:project.goals.map(goal=>({id:goal.id,label:goal.label})),campaigns:campaigns.map(item=>({id:item.id,name:item.name})),boundCampaignId:chosen?.id||null,apps:apps.map(item=>({id:item.id,name:JSON.parse(item.config_json).name})),boundAppId:app?.id||null,providers,steps,nextStepId:next?.id||null,completed:steps.filter(item=>item.state==='done').length,total:steps.length,canManage,canWrite,liveEnabled:prefs?.intent==='mobile'?process.env.PLATFORM_MOBILE_SEND_ENABLED==='1':prefs?.intent==='retention'||prefs?.channels[0]==='email'?process.env.PLATFORM_EMAIL_PILOT_SEND_ENABLED==='1':process.env.PLATFORM_SOCIAL_PUBLISH_ENABLED==='1',trialActive,updatedAt:new Date().toISOString()};
  }
}
