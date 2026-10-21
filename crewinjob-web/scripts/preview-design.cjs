// Isolated visual QA server. Never opens or changes the application's database.
const { spawn } = require('node:child_process');
const { randomBytes,createHmac,createHash } = require('node:crypto');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { load } = require('../test/platform-loader.cjs');
const { openPlatformDatabase } = load('database.ts');
const { PlatformRepository,insertStandardWorkspace } = load('repository.ts');
const { ProjectOperations } = load('operations.ts');
const hssQa = process.argv.includes('--hss'), socialExtensionsQa=process.argv.includes('--social-extensions'),mobileQa=process.argv.includes('--mobile'),compassQa=process.argv.includes('--compass');
if (hssQa && process.argv.some(value => value.startsWith('--') && !['--hss','--dev'].includes(value))) throw new Error('HSS QA is isolated from the generic provider fixtures. Use --hss, optionally --dev.');
const { hssProfile } = require('../test/hss-pilot-fixture.cjs');
const directory = mkdtempSync(path.join(tmpdir(), 'ryzevo-design-qa-'));
const database = path.join(directory, 'fixture.sqlite');
const db = openPlatformDatabase(database);
const repo = new PlatformRepository(db);
repo.bootstrapLegacy('design-fixture-admin');
const fixture = repo.provision('legacy-admin', { organizationName:hssQa?'HSS Digital (disposable QA)':'Ryzevo QA', projectName:hssQa?hssProfile.name:'Örnek Proje', website:hssQa?hssProfile.website:'https://example.com', username:'design-fixture', password:'design-fixture-only-123' });
repo.updateProject(fixture.userId,fixture.organizationId,fixture.projectId,hssQa?hssProfile:{name:'Örnek Proje',website:'https://example.com',timezone:'Europe/Istanbul',language:'tr',brandVoice:'Açık, pratik, güvenilir.',goals:[{id:'demo',label:{tr:'Nitelikli talep',en:'Qualified demand'},audience:{tr:'B2B işletmeler',en:'B2B businesses'},stages:[{tr:'Talep',en:'Request'},{tr:'Görüşme',en:'Meeting'},{tr:'Müşteri',en:'Customer'}]}]});
const operations = new ProjectOperations(db,{subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId});
operations.saveTask({title:'Kampanya içeriğini gözden geçir',dueAt:new Date().toISOString(),status:'in_progress',note:'Örnek QA kaydı'});
operations.saveTask({title:'Bir sonraki içerik planını hazırla',dueAt:new Date(Date.now()+86400000).toISOString(),status:'planned'});
if(!hssQa)operations.saveMetric({goalId:'demo',stageIndex:0,value:12,observedAt:new Date().toISOString(),note:'Yalnızca görsel QA örneği'});
async function start() {
const encryptionKey=randomBytes(32).toString('hex');
const organizationQa=process.argv.includes('--linkedin-organizations'),identityQa=process.argv.includes('--identity'),usageQa=process.argv.includes('--usage'),billingQa=process.argv.includes('--billing'),billingChecksQa=process.argv.includes('--billing-checks'),plansQa=process.argv.includes('--plans'),qaHost=compassQa||mobileQa||hssQa||socialExtensionsQa||organizationQa||identityQa||usageQa||billingQa||plansQa||billingChecksQa?'127.0.0.2':'127.0.0.1';let selectionPortal;
if(process.argv.includes('--coach')){
  for(const role of ['editor','viewer'])repo.addMember(fixture.userId,fixture.organizationId,fixture.projectId,{username:`coach-${role}`,password:'design-fixture-only-123',role});
  // Disposable Search Console snapshot: a fake grant plus stub rows read through a stub reader. No Google call is made here.
  const {encryptCredentials}=load('credential-envelope.ts'),{CoachSeo}=load('coach-seo.ts'),{GrowthCoach}=load('coach.ts'),scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId},connectionId='qa-search-console';
  db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,'search_console','https://example.com/','QA Search Console · not real',?,1,?)").run(connectionId,fixture.organizationId,fixture.projectId,encryptCredentials({accessToken:'qa-only-not-real',refreshToken:'qa-only-not-real',googleOAuth:true,expiresAt:Date.now()+86400000},encryptionKey,fixture.organizationId,fixture.projectId,connectionId),new Date().toISOString());
  if(process.argv.includes('--coach-brief')){const coach=new GrowthCoach(db,scope),drafted=await coach.diagnose({answers:{offer:'Küçük dükkanlar için ön muhasebe yazılımı',customer:'Bağımsız dükkân sahipleri',market:'b2b',price:'high',sales:'sales',current:['website','linkedin'],hours:'2to5',skills:['writing'],obstacle:'start',success:''},language:'tr',mode:'template',expectedRevision:0});coach.approve({brief:drafted.draft,expectedRevision:drafted.revision});}
  await new CoachSeo(db,scope,encryptionKey).refreshQueries(async()=>[{query:'ön muhasebe programı',clicks:9,impressions:310,position:11.2},{query:'dükkan muhasebe nasıl yapılır',clicks:2,impressions:95,position:18.6}],async credentials=>credentials);
  // Phase 4 QA: the approved plan is in its last week (renewal due) and the goal has dated readings in earlier weeks.
  if(process.argv.includes('--coach-renewal')){const day=86400000,ago=days=>new Date(Date.now()-days*day).toISOString();
    db.prepare('UPDATE platform_growth_coach SET approved_at=? WHERE organization_id=? AND project_id=?').run(ago(23),fixture.organizationId,fixture.projectId);
    for(const [days,value] of [[20,6],[13,9],[6,11]])operations.saveMetric({goalId:'demo',stageIndex:0,value,observedAt:ago(days),note:'Yalnızca görsel QA örneği'});
    db.prepare("INSERT INTO platform_metric_entries(id,organization_id,project_id,goal_id,stage_index,value,observed_at,source,note,period_from,period_to) VALUES('qa_auto_reading',?,?,'demo',0,140,?,'ga4','QA stub, not a Google reading',?,?)").run(fixture.organizationId,fixture.projectId,ago(1),ago(15).slice(0,10),ago(9).slice(0,10));
    console.log('Renewal QA: approval moved back 23 days; disposable manual and stub readings added.');}
  console.log('Growth coach QA: owner design-fixture, coach-editor and coach-viewer. Search Console rows are disposable stubs; AI key stays empty.');
}
// Ads QA: a disposable ad account row with fake credentials, caps and two plans. No Meta request is made.
if(process.argv.includes('--ads')){const {encryptCredentials}=load('credential-envelope.ts'),now=new Date().toISOString(),day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10),{organizationId,projectId}=fixture,id='qa-meta-ads';
  db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,'meta_ads','act_123456789','QA reklam hesabı · gerçek değil',?,1,?)").run(id,organizationId,projectId,encryptCredentials({accessToken:'qa-only-not-real',refreshToken:'',adAccountId:'act_123456789',currency:'TRY',name:'QA reklam hesabı · gerçek değil',status:1,timezone:'Europe/Istanbul',checkedAt:now},encryptionKey,organizationId,projectId,id),now);
  db.prepare("INSERT INTO platform_ad_policies(organization_id,project_id,connection_id,currency,daily_cap_minor,monthly_cap_minor,revision,updated_by,updated_at) VALUES(?,?,?,'TRY',50000,600000,1,?,?)").run(organizationId,projectId,id,fixture.userId,now);
  for(const [plan,state,name] of [['qa-plan-draft','draft','Bahar trafiği · taslak'],['qa-plan-created','created','Ürün tanıtımı · Meta’da duraklatılmış']])db.prepare("INSERT INTO platform_ad_plans(id,organization_id,project_id,connection_id,name,objective,special_category,daily_budget_minor,currency,start_date,end_date,countries_json,link_url,state,digest,approved_by,approved_digest,approved_at,provider_campaign_id,provider_adset_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'OUTCOME_TRAFFIC','NONE',25000,'TRY',?,?,'[\"TR\"]','https://example.com/bahar',?,?,?,?,?,?,?,?,?,?)").run(plan,organizationId,projectId,id,name,day(1),day(10),state,'qa-digest',state==='created'?fixture.userId:null,state==='created'?'qa-digest':null,state==='created'?now:null,state==='created'?'1200000000001':null,state==='created'?'1200000000002':null,fixture.userId,now,now);
  console.log('Ads QA: fake ad account, caps and two plans; no Meta call is made.');}
if(process.argv.includes('--budget')){
  // Budget planner QA: fake Meta totals on the --ads plan plus stub GA4 and Search Console readings. No provider call is made.
  if(!process.argv.includes('--ads'))throw new Error('Budget QA requires --ads.');
  const {encryptCredentials}=load('credential-envelope.ts'),{organizationId,projectId}=fixture,now=new Date().toISOString(),ago=days=>new Date(Date.now()-days*86400000).toISOString().slice(0,10);
  db.prepare("UPDATE platform_ad_plans SET start_date=?,end_date=?,spend_minor=184500,impressions=42000,clicks=615,spend_checked_at=? WHERE id='qa-plan-created'").run(ago(12),ago(3),now);
  for(const [id,provider,integration,name] of [['qa-budget-ga4','ga4','123456789','QA GA4 · gerçek değil'],['qa-budget-gsc','search_console','https://example.com/','QA Search Console · gerçek değil']])
    db.prepare("INSERT INTO platform_connections(id,organization_id,project_id,provider,integration_id,account_name,encrypted_credentials,active,updated_at) VALUES(?,?,?,?,?,?,?,1,?)").run(id,organizationId,projectId,provider,integration,name,encryptCredentials({accessToken:'qa-only-not-real',refreshToken:'qa-only-not-real',googleOAuth:true,expiresAt:Date.now()+86400000},encryptionKey,organizationId,projectId,id),now);
  const goal=repo.workspace(fixture.userId,organizationId,projectId).project.goals.find(item=>item.id==='demo'),signature=createHash('sha256').update(JSON.stringify(goal)).digest('hex');
  const binding=(id,connection,provider,metric,stage)=>db.prepare("INSERT INTO platform_measurement_bindings(id,organization_id,project_id,goal_id,stage_index,goal_signature,connection_id,provider,definition_json,version,enabled,manager_id,updated_at) VALUES(?,?,?,'demo',?,?,?,?,?,1,0,?,?)").run(id,organizationId,projectId,stage,signature,connection,provider,JSON.stringify({metric,eventName:''}),fixture.userId,now);
  binding('qa-budget-b0','qa-budget-ga4','ga4','sessions',0);binding('qa-budget-b1','qa-budget-ga4','ga4','keyEvents',1);binding('qa-budget-b2','qa-budget-gsc','search_console','clicks',2);
  const entry=(id,stage,value,source,bindingId)=>db.prepare("INSERT INTO platform_metric_entries(id,organization_id,project_id,goal_id,stage_index,value,observed_at,source,note,binding_id,binding_version,period_from,period_to) VALUES(?,?,?,'demo',?,?,?,?,'QA stub, not a provider reading',?,1,?,?)").run(id,organizationId,projectId,stage,value,now,source,bindingId,ago(28),ago(1));
  entry('qa-budget-e0',0,1240,'ga4','qa-budget-b0');entry('qa-budget-e1',1,31,'ga4','qa-budget-b1');entry('qa-budget-e2',2,420,'search_console','qa-budget-b2');
  console.log('Budget QA: fake Meta totals and stub GA4/Search Console readings; no provider call is made.');}
if(process.argv.includes('--messaging')){
  // Messaging QA: a fake Telegram bot, one source channel, stored posts and a dictionary. No Telegram call is made.
  const {ProjectMarketingStore}=load('marketing-store.ts'),{ProjectMessaging}=load('messaging-sources.ts'),scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId},now=new Date().toISOString();
  const bot=new ProjectMarketingStore(db,scope).saveConnection({provider:'social',integrationId:'telegram',accountName:'QA bot · gerçek değil',accessToken:'123456789:AAFixtureTelegramTokenOnly_not_real_01',social:{platform:'telegram',accountId:'@ryzevo_qa_out'}},encryptionKey);
  db.prepare("INSERT INTO platform_messaging_sources(id,organization_id,project_id,connection_id,chat_id,title,username,auto_read,manager_id,last_read_at,attempted_at,created_at,updated_at) VALUES('qa-msg-source',?,?,?,'-1001111111111','Denizcilik Haberleri · QA','qa_denizcilik',0,?,?,?,?,?)").run(fixture.organizationId,fixture.projectId,bot.id,fixture.userId,now,now,now,now);
  const messaging=new ProjectMessaging(db,scope,encryptionKey);messaging.saveDictionary({dictionary:[{id:'liman',label:'Liman ve lojistik',terms:['liman','konteyner','lojistik']},{id:'egitim',label:'Eğitim',terms:['kurs','sertifika','eğitim']}],expectedRevision:0});
  const {matchTopics}=load('messaging-sources.ts'),dictionary=messaging.dictionary();
  for(const [i,text] of ['Mersin limanında konteyner hacmi bu çeyrekte arttı. Ayrıntılar: […]','STCW sertifika yenileme kursları için yeni dönem başvuruları açıldı.','Hafta sonu hava durumu: kıyılarda kuvvetli rüzgâr bekleniyor.'].entries())
    db.prepare("INSERT INTO platform_messaging_posts(id,organization_id,project_id,source_id,message_id,posted_at,text,topics_json,created_at) VALUES(?,?,?,'qa-msg-source',?,?,?,?,?)").run(`qa-msg-post-${i}`,fixture.organizationId,fixture.projectId,100+i,new Date(Date.now()-(i+1)*3600000).toISOString(),text,JSON.stringify(matchTopics(text,dictionary)),now);
  repo.addMember(fixture.userId,fixture.organizationId,fixture.projectId,{username:'messaging-editor',password:'design-fixture-only-123',role:'editor'});
  console.log('Messaging QA: fake bot, one source, three stored posts and an editor without duties; no Telegram call is made.');}
if(process.argv.includes('--whatsapp')){
  // WhatsApp QA: a fake number and template answered by a stub Graph client, fixture contacts and one approved batch. No Meta call.
  const {ProjectWhatsApp}=load('whatsapp.ts'),scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId};
  const stub=async(method,path)=>path==='1234567890'?{status:200,payload:{display_phone_number:'+90 212 000 00 00',verified_name:'QA numarası · gerçek değil',quality_rating:'GREEN'}}
    :path==='9988776655/phone_numbers'?{status:200,payload:{data:[{id:'1234567890'}]}}
    :path==='9988776655/message_templates'?{status:200,payload:{data:[{name:'yeni_donem',language:'tr',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Merhaba, {{1}} için yeni dönem {{2}} tarihinde başlıyor. Ayrıntılar için bu mesaja yanıt verin.'}]},{name:'gorselli_kayit',language:'tr',status:'APPROVED',category:'MARKETING',components:[{type:'HEADER',format:'IMAGE'},{type:'BODY',text:'{{1}} kaydı açıldı.'},{type:'BUTTONS',buttons:[{type:'URL',text:'Kayıt',url:'https://example.com/kayit/{{1}}'}]}]}]}}:{status:404,payload:{}};
  const wa=new ProjectWhatsApp(db,scope,encryptionKey,stub);await wa.connect({phoneNumberId:'1234567890',wabaId:'9988776655',accessToken:'EAAFixtureWhatsAppTokenOnly_not_real'});await wa.refreshTemplates();
  wa.addContacts({phones:'+905550000001,+905550000002,+905550000003',evidence:'QA kayıt formu · gerçek değil',consentAt:new Date().toISOString().slice(0,10),acknowledged:true});
  const contacts=wa.read().contacts,saved=wa.saveBatch({name:'Kasım dönemi duyurusu',templateName:'yeni_donem',templateLanguage:'tr',params:['STCW kursu','3 Kasım'],contactIds:contacts.map(item=>item.id)}).batches[0];wa.approve({id:saved.id,expectedDigest:saved.digest});
  wa.saveBatch({name:'Taslak · hatırlatma',templateName:'yeni_donem',templateLanguage:'tr',params:['ileri seviye kurs','10 Kasım'],contactIds:[contacts[0].id]});
  console.log('WhatsApp QA: fake number, two approved templates (one with an image header and a link button), three fixture contacts, one approved and one draft batch; no Meta call is made.');}
if(process.argv.includes('--inbox')){
  // Inbox QA: a fake Facebook Page, one accepted post and stored comments/messages. No Meta call is made.
  const {ProjectMarketingStore}=load('marketing-store.ts'),{encryptCredentials}=load('credential-envelope.ts'),scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId},now=new Date().toISOString(),ago=hours=>new Date(Date.now()-hours*3600000).toISOString();
  const page=new ProjectMarketingStore(db,scope).saveConnection({provider:'social',integrationId:'facebook:100',accountName:'QA sayfası · gerçek değil',accessToken:'qa-only-not-real',expiresAt:Date.now()+86400000,social:{platform:'facebook',accountId:'100',graphVersion:'v25.0'}},encryptionKey,{appId:'12345',userAccessToken:'qa-only-not-real'});
  db.prepare("INSERT INTO platform_jobs(id,organization_id,project_id,actor_id,connection_id,revision,idempotency_key,status,created_at,updated_at,job_type) VALUES('qa-inbox-job',?,?,?,?,'r','social:qa-inbox','completed',?,?,'social.publish')").run(fixture.organizationId,fixture.projectId,fixture.userId,page.id,now,now);
  db.prepare("INSERT INTO platform_social_publications(job_id,organization_id,project_id,source_kind,source_id,source_digest,body_digest,encrypted_snapshot,mode,scheduled_at,timezone,configuration_revision,state,submitted_at,provider_post_id,provider_url) VALUES('qa-inbox-job',?,?,'content','qa','d','b',?,'publish',?,'UTC','cfg','accepted',?,'100_200','https://www.facebook.com/100_200')").run(fixture.organizationId,fixture.projectId,encryptCredentials({title:'QA gönderisi · gerçek değil',text:'Bahar dönemi kayıtları açıldı.',platform:'facebook',accountName:'QA sayfası · gerçek değil',accountId:'100'},encryptionKey,fixture.organizationId,fixture.projectId,'publication:qa-inbox-job'),now,now);
  const row=(id,kind,text,hours,recipient)=>db.prepare("INSERT INTO platform_social_inbox(id,organization_id,project_id,connection_id,platform,kind,thread_id,item_id,publication_id,author_hash,recipient_encrypted,text,received_at,created_at) VALUES(?,?,?,?,'facebook',?,?,?,?,?,?,?,?,?)").run(id,fixture.organizationId,fixture.projectId,page.id,kind,kind==='comment'?'100_200':'t_'+id,'item_'+id,kind==='comment'?'qa-inbox-job':null,'h'+id,recipient?encryptCredentials({id:recipient},encryptionKey,fixture.organizationId,fixture.projectId,'inbox:'+id):null,text,ago(hours),now);
  row('qa-inbox-1','comment','Kurs ne zaman başlıyor? Bana […] adresinden dönün.',2);row('qa-inbox-2','message','Fiyat nedir?',3,'777');row('qa-inbox-3','message','Geçen hafta yazmıştım, hâlâ bekliyorum.',40,'888');
  console.log('Inbox QA: fake Facebook Page, one accepted post, one comment and two messages (one outside the 24-hour window); no Meta call is made.');}
if(compassQa){repo.addMember(fixture.userId,fixture.organizationId,fixture.projectId,{username:'compass-viewer',password:'design-fixture-only-123',role:'viewer'});console.log('Compass QA: first-run owner design-fixture and viewer compass-viewer. No provider grants or real sends.');}
if(billingChecksQa){
  const {ProjectBilling}=load('billing.ts'),scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId};
  const merchantId='123456',merchantKey='qa-only-not-real-key',merchantSalt='qa-only-not-real-salt';
  const config={merchantId,merchantKey,merchantSalt,merchantRevision:createHash('sha256').update(JSON.stringify([merchantId,merchantKey,merchantSalt])).digest('hex'),revision:'a'.repeat(64),origin:'https://ryzevo.example',plans:[{id:'qa',name:'QA fixture',amountMinor:2900,currency:'USD',cadence:'monthly'}],readiness:{provider:'paytr',mode:'sandbox',liveEnabled:false,subscriptionEnabled:false,ready:true,checks:{gate:true,credentials:true,usdAcknowledged:true,origin:true,catalog:true}}};
  const billing=new ProjectBilling(db,scope,encryptionKey,()=>config);
  db.prepare('INSERT OR IGNORE INTO platform_account_emails VALUES(?,?,?)').run(fixture.userId,'billing-qa@ryzevo.example',new Date().toISOString());
  const found={status:'payment_found',amountMinor:2900,totalMinor:2900,currency:'USD',testMode:true,card:true,installments:false,hasRefunds:false};
  const orders=[];
  for(const [i,name]of ['QA · Doğrulanmış test','QA · İade kontrolü','QA · Bekleyen sonuç'].entries()){
    config.plans[0].name=name;
    const order=await billing.start({planId:'qa',idempotencyKey:'qa-fixture-order-'+i,contact:{name:'QA Fixture',phone:'123456789',address:'Disposable QA only'}},'203.0.113.5',async()=>({state:'accepted',token:'qaonlyfixturecheckout123456789'}));
    orders.push(order);
    await billing.check({orderId:order.id,idempotencyKey:'qa-fixture-status-'+i},async()=>i===2?{status:'not_confirmed'}:found);
  }
  db.prepare('UPDATE platform_billing_checks SET created_at=? WHERE order_id=?').run(new Date(Date.now()-61000).toISOString(),orders[1].id);
  await billing.check({orderId:orders[1].id,idempotencyKey:'qa-fixture-refund-check'},async()=>({...found,hasRefunds:true}));
  console.log('Billing inquiry QA uses stub responses ONLY. The HTTP server keeps all provider gates OFF.');
}
if(plansQa){
  for(const username of ['trial-fixture','expired-trial-fixture']){
    const trial=insertStandardWorkspace(db,'disposable-qa',{organizationName:'Trial QA',projectName:username==='trial-fixture'?'Deneme Projesi':'Süresi Dolmuş Deneme',website:'https://example.com',username,password:'design-fixture-only-123'},'trial');
    const usage=new (load('project-usage.ts').ProjectUsage)(db,{subject:trial.userId,organizationId:trial.organizationId,projectId:trial.projectId});usage.complete(usage.reserve());
    if(username==='expired-trial-fixture'){const start=new Date(Date.now()-15*86400000).toISOString();db.prepare('UPDATE platform_project_entitlements SET started_at=?,ends_at=? WHERE project_id=?').run(start,new Date(Date.parse(start)+14*86400000).toISOString(),trial.projectId);}
  }
  console.log('Disposable trial QA: trial-fixture or expired-trial-fixture / design-fixture-only-123');
}
if(usageQa){
  for(let i=0;i<4;i++)operations.completeAi(operations.reserveAi());
  operations.refundAi(operations.reserveAi());
  const pending=operations.reserveAi();db.prepare('UPDATE platform_usage_reservations SET created_at=? WHERE id=?').run(new Date(Date.now()-11*60000).toISOString(),pending.id);
  for(let i=0;i<3;i++)operations.completeAi(operations.reserveAi('audits'));
  db.prepare("UPDATE platform_usage SET count=count+CASE WHEN resource='ai' THEN 35 ELSE 22 END WHERE organization_id=? AND project_id=? AND resource IN ('ai','audits')").run(fixture.organizationId,fixture.projectId);
}
Object.assign(process.env,{PLATFORM_AUTH_EMAIL_ENABLED:identityQa?'1':'0',PLATFORM_PUBLIC_SIGNUP_ENABLED:identityQa?'1':'0',PLATFORM_AUTH_ORIGIN:`http://${qaHost}:31450`,PLATFORM_AUTH_FROM_EMAIL:'accounts@ryzevo.example',PLATFORM_AUTH_SES_REGION:'eu-west-1',PLATFORM_AUTH_SES_ACCESS_KEY_ID:identityQa?'AKIA'+'A'.repeat(16):'',PLATFORM_AUTH_SES_SECRET_ACCESS_KEY:identityQa?'b'.repeat(40):''});
if(identityQa){
  const identity=new(load('identity.ts').PlatformIdentity)(db,encryptionKey);
  identity.requestVerification(fixture.userId,'qa@ryzevo.example','design-fixture-only-123','tr');
  await identity.deliverNext(async mail=>console.log(`Disposable verify fixture ONLY: http://${qaHost}:31450/account/verify#token=${mail.token}`));
  identity.request('signup','new@ryzevo.example','en');
  await identity.deliverNext(async mail=>console.log(`Disposable signup fixture ONLY: http://${qaHost}:31450/register#token=${mail.token}`));
}
if(organizationQa)Object.assign(process.env,{PLATFORM_LINKEDIN_CLIENT_ID:'qa-only-linkedin-app',PLATFORM_LINKEDIN_CLIENT_SECRET:'qa-only-not-real',PLATFORM_LINKEDIN_API_VERSION:'202609',PLATFORM_LINKEDIN_REDIRECT_URI:'http://127.0.0.1:31450/api/platform/social/callback'});
if(process.argv.includes('--product-data')) {
  const {ProductDataSources}=load('product-data.ts'),{ConnectionJobs}=load('connection-jobs.ts');
  const scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId};
  const sources=new ProductDataSources(db,scope),jobs=new ConnectionJobs(db,scope);
  const source=sources.save({name:'Örnek Eğitim API',token:'fixture-source-token',config:{url:'https://learning.example/api/users',auth:'bearer',itemsPath:'result.items',idPath:'studentId',updatedAtPath:'modifiedAt',entityType:'user',attributes:[{key:'completion',path:'learning.progress',type:'number'},{key:'active',path:'active',type:'boolean'},...(process.argv.includes('--recipients')?[{key:'email',path:'email',type:'string'}]:[])],nextCursorPath:'',cursorParam:''}},encryptionKey);
  const modifiedAt=new Date(Date.now()-60000).toISOString();
  const loader=async()=>({items:[{studentId:'learner-0001',modifiedAt,learning:{progress:0},active:true,email:'learner01@example.com'},{studentId:'learner-0002',modifiedAt,learning:{progress:65},active:false,email:'learner02@example.com'},...(process.argv.includes('--recipients')?Array.from({length:20},(_,i)=>({studentId:`learner-${String(i+3).padStart(4,'0')}`,modifiedAt,learning:{progress:20},active:true,email:i===0?'not-an-email':`learner${i+3}@example.com`})):[])],nextCursor:null});
  await sources.preview(source.id,encryptionKey,loader);sources.setEnabled(source.id,source.version,true);
  await jobs.run(jobs.enqueue(source.id,'fixture-sync','product.sync').id,encryptionKey,undefined,undefined,undefined,undefined,loader);
}
if(process.argv.includes('--product-webhooks')) {
  const {ProductWebhooks,authenticateProductWebhook}=load('product-webhooks.ts');
  const scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId};
  const hooks=new ProductWebhooks(db,scope),secret=randomBytes(32).toString('hex');
  const source=hooks.save({name:'Örnek Eğitim Olayları',secret,config:{entityType:'user',attributes:[{key:'completion',type:'number'},{key:'active',type:'boolean'}],eventNames:['lesson.progress']}},encryptionKey);
  const occurredAt=new Date(Date.now()-60000).toISOString();
  const payload={sourceVersion:source.version,events:[{id:'lesson-event-0001',entityId:'learner-0001',eventName:'lesson.progress',occurredAt,attributes:{completion:25,active:true}},{id:'lesson-event-0002',entityId:'learner-0002',eventName:'lesson.progress',occurredAt,attributes:{completion:65,active:false},consent:{channel:'email',status:'opted_out',evidenceRef:'qa-consent-0002',recordedAt:occurredAt}}]};
  hooks.preview(source.id,payload);hooks.state(source.id,source.version,'activate');
  const bytes=Buffer.from(JSON.stringify(payload)),timestamp=String(Math.floor(Date.now()/1000));
  const headers=new Headers({'X-Ryzevo-Timestamp':timestamp,'X-Ryzevo-Signature':'v1='+createHmac('sha256',Buffer.from(secret,'hex')).update(`${timestamp}.${source.id}.`).update(bytes).digest('hex')});
  authenticateProductWebhook(db,source.id,headers,encryptionKey)(bytes);
}
if(process.argv.includes('--segments')) {
  const {ProductSegments}=load('segments.ts'),segments=new ProductSegments(db,{subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId});
  for(const source of segments.sources()){
    const rules={kind:'group',op:'and',children:[source.kind==='rest'?{kind:'attribute',field:'completion',op:'lt',value:50}:{kind:'activity',op:'not_within',days:7}]};
    const item=segments.save({name:source.kind==='rest'?'Profilini tamamlamayanlar':'Henüz aktivite gözlenmeyenler',definition:{sourceId:source.id,sourceVersion:source.version,maxAgeHours:24,rules,goalId:'demo',stageIndex:0}});
    segments.preview({id:item.id,version:item.version});
  }
}
if(process.argv.includes('--campaign-review')) {
  const {ProductSegments}=load('segments.ts'),{ProjectMarketingStore}=load('marketing-store.ts');
  const scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId},segments=new ProductSegments(db,scope),segment=segments.list().find(item=>segments.sources().find(source=>source.id===item.definition.sourceId)?.kind==='rest');
  if(!segment)throw new Error('Use --product-data --segments for campaign review QA.');
  segments.preview({id:segment.id,version:segment.version});const binding=segments.binding(segment.id,segment.version,'demo'),now=new Date().toISOString();
  new ProjectMarketingStore(db,scope).saveCampaign({id:'cmp_review_fixture',name:'Profil tamamlama · Onay incelemesi',goalId:'demo',status:'draft',objective:'reactivation',audience:{fillBuckets:[]},channels:{email:true,social:[],whatsapp:false,telegram:false,paidAds:[]},content:{subject:'Bir sonraki adımınız: profilinizi tamamlayın',text:'Merhaba,\n\nProfilinizi tamamlayarak size uygun fırsatlara daha kolay ulaşabilirsiniz.\n\nBu mesaj yalnızca izole kalite kontrol örneğidir.',ctaUrl:'https://example.com/profile'},budget:{currency:'USD',dailyByPlatform:{}},timezone:'Europe/Istanbul',utm:{campaign:'review-fixture'},deliveries:[],segmentBinding:binding,createdAt:now,updatedAt:now},true);
}
if(process.argv.includes('--sender')) {
  const {ProjectMarketingStore}=load('marketing-store.ts'),{EmailRecipients}=load('email-recipients.ts'),{ProductSegments}=load('segments.ts');
  const scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId};
  const ses=process.argv.includes('--ses'),region='eu-west-1',accessKeyId='AKIA'+'A'.repeat(16),secretAccessKey='a'.repeat(40);
  new ProjectMarketingStore(db,scope).saveConnection({provider:'email',integrationId:'qa-sender',accountName:ses?'SES QA · Gerçek kimlik bilgisi yok':'QA SMTP · Gönderim yok',accessToken:ses?load('ses-provider.ts').sesSmtpPassword(secretAccessKey,region):'fixture-only-not-real-credentials',smtp:{host:ses?`email-smtp.${region}.amazonaws.com`:'smtp.sendgrid.net',port:587,user:ses?accessKeyId:'qa-only',fromEmail:'hello@example.com',fromName:'Ryzevo QA'}},encryptionKey);
  if(process.argv.includes('--recipients')){
    const source=new ProductSegments(db,scope).sources().find(source=>source.kind==='rest'),recipients=new EmailRecipients(db,scope,encryptionKey);
    if(source){recipients.saveMapping({sourceId:source.id,sourceVersion:source.version,field:'email',expectedRevision:null});for(const contact of recipients.list(source.id).contacts.filter(contact=>contact.validEmail).slice(0,8))recipients.review({sourceId:source.id,contactKey:contact.key,expectedDecisionId:null,decision:'reviewed',evidenceRef:'qa/disposable-fixture',recordedAt:new Date(Date.now()-60000).toISOString(),note:'Disposable QA permission fixture; not real consent.',acknowledged:true});}
  }
}
if(process.argv.includes('--pilot-queue')){
  const {EmailSenders}=load('email-sender.ts'),{CampaignReviews}=load('campaign-review.ts'),{ProjectMarketingStore}=load('marketing-store.ts');
  const scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId},senders=new EmailSenders(db,scope,encryptionKey),store=new ProjectMarketingStore(db,scope);
  const smtp=store.connections().find(connection=>connection.provider==='email');
  if(!smtp||!store.campaign('cmp_review_fixture'))throw new Error('Pilot queue QA requires --product-data --segments --campaign-review --recipients --sender.');
  senders.select({connectionId:smtp.id,maxRecipients:3,expectedRevision:0});
  if(process.argv.includes('--ses'))new (load('ses-provider.ts').SesProvider)(db,scope,encryptionKey).save({accessKeyId:'AKIA'+'A'.repeat(16),secretAccessKey:'a'.repeat(40),configurationSet:'ryzevo-qa',topicArn:'arn:aws:sns:eu-west-1:123456789012:ryzevo-qa',expectedRevision:0});
  for(const email of ['learner01@example.com','learner4@example.com','learner5@example.com','learner6@example.com'])senders.allow({email,acknowledged:true,expectedRevision:senders.get().readiness.revision});
  const reviews=new CampaignReviews(db,scope,encryptionKey),checked=reviews.check('cmp_review_fixture',reviews.get('cmp_review_fixture').digest);
  reviews.decide('cmp_review_fixture',{decision:'approved',expectedDigest:checked.digest,expectedReviewId:null,note:'Disposable queue QA fixture; no message sent.'});
}
if(process.argv.includes('--measurements')){
  const {ProjectMeasurements}=load('measurements.ts'),{defaultMeasurementPeriod}=load('measurement-types.ts');
  const scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId},measurements=new ProjectMeasurements(db,scope,encryptionKey),source=measurements.sources().find(item=>item.provider==='product_webhook');
  if(!source)throw new Error('Measurement QA requires --product-webhooks.');
  const period=defaultMeasurementPeriod();
  // Explicit historical coverage exists only in this disposable visual fixture.
  db.prepare('UPDATE platform_product_sources SET event_coverage_from=? WHERE connection_id=?').run(`${period.from}T00:00:00.000Z`,source.id);
  db.prepare('UPDATE platform_product_events SET occurred_at=? WHERE connection_id=?').run(`${period.from}T12:00:00.000Z`,source.id);
  const binding=measurements.save({goalId:'demo',stageIndex:0,connectionId:source.id,metric:'event_count',eventName:'lesson.progress',enabled:false,expectedVersion:0});
  const job=measurements.enqueue({bindingId:binding.id,expectedVersion:binding.version,...period,idempotencyKey:'visual-measurement-fixture'});await measurements.process(job.id);
}
if(process.argv.includes('--publications')||process.argv.includes('--facebook-publications')||process.argv.includes('--instagram-publications')||process.argv.includes('--x-publications')||organizationQa){
  const {SocialPublications}=load('social-publications.ts'),{ProjectMarketingStore}=load('marketing-store.ts');
  const scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId},store=new ProjectMarketingStore(db,scope),publications=new SocialPublications(db,scope,encryptionKey);
  const connection=store.saveConnection({provider:'social',integrationId:'fixture',accountName:'Örnek LinkedIn hesabı',accessToken:'not-a-real-provider-token',social:{platform:'linkedin',accountId:'qa_member'}},encryptionKey);
  store.saveContent({id:'qa-publication-content',platform:'linkedin',language:'tr',headline:'Büyüme notları · İlk yayın',content:'Ürünümüzün yeni çalışma alanını tanıtıyoruz.\n\nEkibin hedeflerini, içeriklerini ve sonuçlarını aynı yerde buluşturuyoruz.\n\n#Ryzevo\n\nYalnızca izole kalite kontrol örneği; gerçek paylaşım yapılmaz.',timestamp:Date.now(),prompt:''},true);
  const view=publications.workspace(),source=view.sources[0],input={sourceKind:'content',sourceId:source.id,expectedDigest:source.digest,expectedTargetRevision:view.targets.find(item=>item.id===connection.id).revision,connectionId:connection.id,mode:'rehearsal',idempotencyKey:'qa-social-rehearsal'};
  const job=publications.enqueue(input);await publications.process(job.id);
  publications.enqueue({...input,idempotencyKey:'qa-social-future',scheduledAt:new Date(Date.now()+86400000).toISOString()});
  if(organizationQa){
    const {OAuthRequests}=load('oauth-requests.ts'),{linkedinOrganizationConfiguration}=load('linkedin-organization-publishing.ts');
    const config=linkedinOrganizationConfiguration(),company=store.saveConnection({provider:'social',integrationId:'qa-company',accountName:'Ryzevo QA · Örnek şirket sayfası',accessToken:'not-a-real-company-token',expiresAt:Date.now()+7200000,social:{platform:'linkedin',accountType:'organization',accountId:'100'}},encryptionKey);
    const companyView=publications.workspace(),source=companyView.sources.find(s=>s.id==='qa-publication-content'),intent={sourceKind:'content',sourceId:source.id,connectionId:company.id,expectedDigest:source.digest,expectedTargetRevision:companyView.targets.find(t=>t.id===company.id).revision,mode:'rehearsal',idempotencyKey:'qa-company-rehearsal'};
    const job=publications.enqueue(intent);await publications.process(job.id);publications.enqueue({...intent,idempotencyKey:'qa-company-future',scheduledAt:new Date(Date.now()+86400000).toISOString()});
    const pending=new OAuthRequests(db,scope,encryptionKey).create('linkedin_organization_selection','','QA ONLY',{accessToken:'not-a-real-selection-token',expiresAt:Date.now()+7200000,memberSub:'qa_only',publishing:true,revision:config.revision,version:config.version,pages:[{id:'100',name:'Örnek Denizcilik Teknolojileri ve Büyüme Ekibi',roles:['ADMINISTRATOR'],available:true,canPublish:true,start:0},{id:'200',name:'Örnek Analitik Şirketi',roles:['ANALYST'],available:true,canPublish:false,start:0},{id:'300',name:'Örnek İçerik Ekibi',roles:['CONTENT_ADMINISTRATOR'],available:true,canPublish:true,start:0}],next:25,hasMore:false,loaded:true});
    const nonce=randomBytes(24).toString('hex');
    selectionPortal=require('node:http').createServer((req,res)=>{if(req.url!==`/${nonce}`){res.writeHead(404);res.end();return;}res.writeHead(302,{'Set-Cookie':`platform_linkedin_organization_selection=${pending.state}.${pending.browser}; Path=/api/platform/linkedin-organizations; HttpOnly; SameSite=Lax; Max-Age=600`,'Location':`http://${qaHost}:31450/?tab=project&settings=connections`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();selectionPortal.close();});
    await new Promise((resolve,reject)=>{selectionPortal.once('error',reject);selectionPortal.listen(31451,qaHost,resolve);});
    console.log(`Disposable selection fixture ONLY: http://${qaHost}:31451/${nonce}`);
  }
  if(process.argv.includes('--x-publications')){
    const x=store.saveConnection({provider:'social',integrationId:'twitter:123',accountName:'ryzevo_qa · Örnek X',accessToken:'not-a-real-x-token',expiresAt:Date.now()+7200000,social:{platform:'twitter',accountId:'123'}},encryptionKey);
    store.saveContent({id:'qa-x-content',platform:'twitter',language:'tr',headline:'Ryzevo · Yeni bir adım',content:'Bir sonraki iyi adım, birlikte.\n\nHedeflerimizi, içeriklerimizi ve sonuçlarımızı aynı yerde buluşturuyoruz.\n\nhttps://example.com/ryzevo\n\n#Ryzevo\n\nYalnızca izole QA örneği; gerçek paylaşım yapılmaz.',timestamp:Date.now(),prompt:''},true);
    store.saveContent({id:'qa-x-long-content',platform:'twitter',language:'tr',headline:'Sınır kontrolü · Örnek X',content:'X '.repeat(150),timestamp:Date.now(),prompt:''},true);
    const xView=publications.workspace(),source=xView.sources.find(s=>s.id==='qa-x-content'),intent={sourceKind:'content',sourceId:source.id,expectedDigest:source.digest,expectedTargetRevision:xView.targets.find(t=>t.id===x.id).revision,connectionId:x.id,mode:'rehearsal',idempotencyKey:'qa-x-rehearsal'};
    const job=publications.enqueue(intent);await publications.process(job.id);
    publications.enqueue({...intent,idempotencyKey:'qa-x-future',scheduledAt:new Date(Date.now()+86400000).toISOString()});
  }
  if(process.argv.includes('--facebook-publications')){
    const fb=store.saveConnection({provider:'social',integrationId:'facebook:100',accountName:'Örnek Facebook sayfası',accessToken:'not-a-real-page-token',social:{platform:'facebook',accountId:'100',graphVersion:'v25.0'}},encryptionKey);
    store.saveContent({id:'qa-facebook-content',platform:'facebook',language:'tr',headline:'Topluluğumuzdan · Yeni bir adım',content:'Birlikte büyüyen ekipler için yeni bir çalışma alanı.\n\nHedeflerimizi, içeriklerimizi ve sonuçlarımızı tek bir yerde buluşturuyoruz.\n\nBu içerik yalnızca izole QA örneğidir; gerçek paylaşım yapılmaz.',timestamp:Date.now(),prompt:''},true);
    const fbView=publications.workspace(),fbSource=fbView.sources.find(s=>s.id==='qa-facebook-content'),fbInput={sourceKind:'content',sourceId:fbSource.id,expectedDigest:fbSource.digest,expectedTargetRevision:fbView.targets.find(t=>t.id===fb.id).revision,connectionId:fb.id,mode:'rehearsal',idempotencyKey:'qa-facebook-rehearsal'};
    const fbJob=publications.enqueue(fbInput);await publications.process(fbJob.id);
    publications.enqueue({...fbInput,idempotencyKey:'qa-facebook-future',scheduledAt:new Date(Date.now()+86400000).toISOString()});
  }
  if(process.argv.includes('--instagram-publications')){
    const ig=store.saveConnection({provider:'social',integrationId:'instagram:300',accountName:'ryzevo_qa · Örnek Instagram',accessToken:'not-a-real-page-token',social:{platform:'instagram',accountId:'300',pageId:'100',graphVersion:'v25.0'}},encryptionKey);
    const imageData=require('node:fs').readFileSync(path.join(__dirname,'../public/brand/ryzevo-brand-board.png')).toString('base64');
    store.saveContent({id:'qa-instagram-content',platform:'instagram',language:'tr',headline:'Ryzevo · Birlikte büyüyoruz',content:'Bir sonraki iyi adım, birlikte.\n\nHedeflerimizi, içeriklerimizi ve sonuçlarımızı tek bir yerde buluşturuyoruz.\n\nBu içerik yalnızca izole QA örneğidir; gerçek paylaşım yapılmaz.\n\n#Ryzevo',imageData,imageMime:'image/png',timestamp:Date.now(),prompt:''},true);
    const igView=publications.workspace(),igSource=igView.sources.find(s=>s.id==='qa-instagram-content'),igInput={sourceKind:'content',sourceId:igSource.id,expectedDigest:igSource.digest,expectedTargetRevision:igView.targets.find(t=>t.id===ig.id).revision,connectionId:ig.id,mode:'rehearsal',idempotencyKey:'qa-instagram-rehearsal'};
    const igJob=await publications.create(igInput);await publications.process(igJob.id);
    await publications.create({...igInput,idempotencyKey:'qa-instagram-future',scheduledAt:new Date(Date.now()+86400000).toISOString()});
  }
}
if(socialExtensionsQa){
  const {SocialPublications}=load('social-publications.ts'),{ProjectMarketingStore}=load('marketing-store.ts');
  const scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId},store=new ProjectMarketingStore(db,scope),publications=new SocialPublications(db,scope,encryptionKey);
  const sharp=require('sharp'),brand=require('node:fs').readFileSync(path.join(__dirname,'../public/brand/ryzevo-brand-board.png'));
  const images=[];for(const width of [640,720])images.push({data:(await sharp(brand).resize(width,width,{fit:'contain',background:'#ffffff'}).jpeg({quality:85}).toBuffer()).toString('base64'),mime:'image/jpeg'});
  for(const platform of ['facebook','instagram']){
    const connection=store.saveConnection({provider:'social',integrationId:`${platform}:100`,accountName:`QA ONLY · ${platform}`,accessToken:'qa-only-no-real-provider-token',expiresAt:Date.now()+86400000,social:{platform,accountId:'100',graphVersion:'v25.0',...(platform==='instagram'?{pageId:'200'}:{})}},encryptionKey);
    const id=`qa-${platform}-media`;
    store.saveContent({id,platform,language:'tr',headline:platform==='instagram'?'QA · Marka hikayesi / çoklu görsel':'QA · Yeni ürün / Facebook görsel',content:'İzole kalite kontrol taslağı. Gerçek hesap, yayın veya etkileşim ölçümü değildir.',...(platform==='instagram'?{images}:{imageData:images[0].data,imageMime:'image/jpeg'}),timestamp:Date.now(),prompt:''},true);
    const view=publications.workspace(),source=view.sources.find(s=>s.id===id),target=view.targets.find(t=>t.id===connection.id),job=await publications.create({sourceKind:'content',sourceId:id,connectionId:connection.id,expectedDigest:source.digest,expectedTargetRevision:target.revision,mode:'rehearsal',idempotencyKey:`qa-${platform}-media-rehearsal`});await publications.process(job.id);
    // Display-only acceptance states in a disposable database. Never a real receipt or measurement.
    db.prepare("UPDATE platform_social_publications SET mode='publish',state='accepted',provider_post_id=? WHERE job_id=?").run(platform==='facebook'?'100_555':'800',job.id);
    db.prepare("INSERT INTO platform_social_engagement(job_id,organization_id,project_id,counts_json,observed_at,attempted_at,state) VALUES(?,?,?,?,?,?,?)").run(job.id,fixture.organizationId,fixture.projectId,platform==='facebook'?JSON.stringify({likes:0,comments:2,shares:1}):JSON.stringify({likes:6,comments:0}),new Date().toISOString(),new Date().toISOString(),platform==='facebook'?'unavailable':'ready');
  }
  console.log('Social format QA: disposable fixture counters ONLY. All live provider gates remain OFF.');
}
if(mobileQa){
  const {MobileGrowth}=load('mobile-store.ts'),{MobileDelivery}=load('mobile-delivery.ts'),{recordMobileEvents,registerMobileContact}=load('mobile-ingestion.ts');
  const scope={subject:fixture.userId,organizationId:fixture.organizationId,projectId:fixture.projectId},service=new MobileGrowth(db,scope,encryptionKey),delivery=new MobileDelivery(service);
  const app=service.saveApp({name:'QA · Örnek Mobil Uygulama',platform:'both',appleId:'123456789',bundleId:'com.example.qa',packageName:'com.example.qa',country:'TR',locale:'tr-TR',website:'https://example.com',scheme:'qamobile',attributionProvider:'bridge',revenueProvider:'bridge',identityConfirmed:false});service.setSource(app.id,true);
  service.store.saveCampaign({id:'qa-mobile-campaign',name:'QA · Mobil karşılama',status:'draft',updatedAt:new Date().toISOString(),content:{subject:'Bir sonraki adımınız hazır',text:'Bu içerik yalnız izole mobil QA provasıdır. Gerçek bir kullanıcıya gönderilmez.',ctaUrl:'https://example.com'},channels:{email:true,social:[],whatsapp:false,telegram:false,paidAds:[]}},true);
  for(const provider of ['bridge','appsflyer','adjust','revenuecat','onesignal','branch'])service.saveIntegration({appId:app.id,provider,config:{appId:'aaaaaaaa-bbbb-4ccc-addd-eeeeeeeeeeee',externalAppId:'qa-provider-app',linkDomain:'example.app.link'},credentials:provider==='onesignal'?{apiKey:'qa-only-not-real-key'}:provider==='branch'?{branchKey:'key_test_onlyfixture123'}:{webhookSecret:randomBytes(32).toString('hex')}});
  const at=new Date(Date.now()-2*86400000).toISOString(),base={entityId:'qa-mobile-user1',occurredAt:at,platform:'ios',details:{identity:'customer',environment:'production',channel:'qa-fixture',campaign:'qa-mobile-launch'}};
  recordMobileEvents(service,app,'bridge',[{...base,id:'qa-install',kind:'install'},{...base,id:'qa-session',kind:'session'},{...base,id:'qa-purchase',kind:'purchase',details:{...base.details,currency:'USD',amount:10,transaction:'qa-only-transaction'}}]);
  const id=registerMobileContact(service,app,{entityId:'qa-mobile-user1',provider:'onesignal',destination:'qa-only-no-real-device',recordedAt:at,evidenceRef:'qa-only/consent',consent:{push:true,inApp:true}}).id;delivery.setPilot(app.id,id,true);
  await service.auditStore({appId:app.id,store:'android',mode:'manual',title:'QA mobile application listing title is too long',subtitle:'',description:'Disposable QA store metadata only.',screenshotCount:0});
  console.log('MOBILE QA: disposable sample events and contacts ONLY; no provider/network calls.');
}
db.close();
Object.assign(process.env,{PLATFORM_X_CLIENT_ID:process.argv.includes('--x-publications')?'qa-x-app':'',PLATFORM_X_CLIENT_SECRET:process.argv.includes('--x-publications')?'qa-only-not-real':'',PLATFORM_X_REDIRECT_URI:'http://127.0.0.1:31450/api/platform/x/callback'});
const development=process.argv.includes('--dev');
const server = spawn(process.execPath,[require.resolve('next/dist/bin/next'),development?'dev':'start','--hostname',qaHost,'-p','31450'],{cwd:path.join(__dirname,'..'),windowsHide:true,stdio:'inherit',env:{...process.env,NEXT_DIST_DIR:development?'.next-design-qa':'.next-monolith-platform',PLATFORM_DATABASE_PATH:database,AUTH_SECRET:randomBytes(32).toString('hex'),PLATFORM_ENCRYPTION_KEY:encryptionKey,ADMIN_USERNAME:'design-fixture-admin',ADMIN_PASSWORD:randomBytes(32).toString('hex'),PLATFORM_GEMINI_API_KEY:'',PLATFORM_EMAIL_PILOT_SEND_ENABLED:'0',PLATFORM_SOCIAL_PUBLISH_ENABLED:'0',PLATFORM_MOBILE_SEND_ENABLED:'0',PLATFORM_MOBILE_LINKS_ENABLED:'0',PLATFORM_LINKEDIN_CLIENT_ID:organizationQa?'qa-only-linkedin-app':'',PLATFORM_LINKEDIN_CLIENT_SECRET:organizationQa?'qa-only-not-real':'',PLATFORM_LINKEDIN_API_VERSION:organizationQa?'202609':'',PLATFORM_META_APP_ID:process.argv.includes('--instagram-publications')?'12345':'',PLATFORM_META_APP_SECRET:process.argv.includes('--instagram-publications')?'qa-only-not-real':'',PLATFORM_META_GRAPH_VERSION:'v25.0',PLATFORM_META_REDIRECT_URI:'http://127.0.0.1:31450/api/platform/meta/callback',PLATFORM_PUBLIC_ORIGIN:'',PLATFORM_PAYTR_SANDBOX_ENABLED:'0',PLATFORM_PAYTR_MERCHANT_ID:'',PLATFORM_PAYTR_MERCHANT_KEY:'',PLATFORM_PAYTR_MERCHANT_SALT:'',PLATFORM_PAYTR_TEST_CATALOG:'[]'}});
console.log(`Isolated QA: http://${qaHost}:31450/login | design-fixture / design-fixture-only-123`);
process.on('SIGINT',()=>{selectionPortal?.close();server.kill();});
process.on('SIGTERM',()=>{selectionPortal?.close();server.kill();});
// Geçici fixture veritabanı her çalıştırmada yeniden üretilir; sunucu kapanınca klasörü de kaldır.
server.on('exit',code=>{selectionPortal?.close();try{require('node:fs').rmSync(directory,{recursive:true,force:true});}catch{}process.exitCode=code || 0;});
}
void start().catch(()=>{try{db.close();}catch{}console.error('Visual QA fixture could not start.');process.exitCode=1;});
