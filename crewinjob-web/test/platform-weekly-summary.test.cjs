const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {TeamAlerts}=load('team-alerts.ts'),{deliverNextWeeklySummary,weeklyFacts}=load('weekly-summary.ts'),{MobileGrowth}=load('mobile-store.ts');
const DAY=86400000,iso=value=>new Date(value).toISOString();
// The provider is a recorder: nothing is sent.
const CONFIG={origin:'https://ryzevo.example',from:'alerts@ryzevo.example',revision:'fixture'};
const monday=()=>{const date=new Date();date.setUTCHours(7,0,0,0);date.setUTCDate(date.getUTCDate()+((8-date.getUTCDay())%7||7));return date.getTime();};

test('the weekly summary: opted in on top of alert emails, counts only, once a Monday',async()=>{
  const f=await fixture();try{
    const alerts=new TeamAlerts(f.db,f.scope);
    await assert.rejects(async ()=>await alerts.setWeekly({enabled:true}),/önce e-posta uyarılarını açın/);
    f.db.prepare('INSERT OR REPLACE INTO platform_account_emails VALUES(?,?,?)').run(f.a.userId,'owner@ryzevo.example',iso(Date.now()));
    await alerts.subscribe({action:'subscribe',language:'tr'});let view=await alerts.setWeekly({enabled:true});assert.equal(view.email.weekly,true);
    await assert.rejects(async ()=>await alerts.setWeekly({enabled:'yes'}),/Geçersiz/);
    const now=monday(),service=new MobileGrowth(f.db,f.scope,f.KEY),app=await service.saveApp({name:'QA Ink',platform:'ios',appleId:'123456789',bundleId:'com.example.qa',packageName:'',country:'TR',locale:'tr-TR',website:'https://example.com',scheme:'qaink',attributionProvider:'bridge',revenueProvider:'bridge',identityConfirmed:true});
    for(const [id,rating] of [['r1',5],['r2',2]])f.db.prepare('INSERT INTO platform_mobile_reviews(id,organization_id,project_id,app_id,store,provider_id,rating,title,body,author,territory,language,app_version,reviewed_at,fetched_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,f.scope.organizationId,f.scope.projectId,app.id,'ios',`p-${id}`,rating,'Gizli başlık','Gizli metin','gizli-kişi','TUR','','',iso(now-2*DAY),iso(now));
    f.db.prepare('INSERT INTO platform_mobile_costs VALUES(?,?,?,?,?,?,?,?,?,?)').run(f.scope.organizationId,f.scope.projectId,app.id,'manual-1','Yaz',new Date(now-3*DAY).toISOString().slice(0,10),'TRY',120.5,f.scope.subject,iso(now));
    const facts=await weeklyFacts(f.db,f.scope,'tr',now);assert.equal(facts.apps[0].reviews,2);assert.equal(facts.apps[0].average,3.5);assert.equal(facts.apps[0].unanswered,2);assert.deepEqual(JSON.parse(JSON.stringify(facts.spend)),[{currency:'TRY',amount:120.5}]);
    const mails=[],deliver=async mail=>{mails.push(mail);};
    assert.equal(await deliverNextWeeklySummary(f.db,deliver,CONFIG,now+DAY),false,'not on Tuesday');
    assert.equal(await deliverNextWeeklySummary(f.db,deliver,CONFIG,now-5*3600000),false,'not before 06:00 UTC on Monday');
    assert.equal(await deliverNextWeeklySummary(f.db,deliver,CONFIG,now),true);
    assert.equal(mails[0].to,'owner@ryzevo.example');assert.match(mails[0].subject,/haftalık özet/);assert.match(mails[0].text,/QA Ink: 0 yükleme/);assert.match(mails[0].text,/2 yeni yorum \(ortalama 3,5★\)/);assert.match(mails[0].text,/120,5 TRY/);
    assert.doesNotMatch(mails[0].text,/Gizli|gizli-kişi/,'no review text or author');
    assert.equal(await deliverNextWeeklySummary(f.db,deliver,CONFIG,now+3600000),false,'once a week');
    assert.equal(f.db.prepare("SELECT state FROM platform_alert_deliveries WHERE id LIKE 'weekly_%'").get().state,'sent');
    await alerts.setWeekly({enabled:false});assert.equal(await deliverNextWeeklySummary(f.db,deliver,CONFIG,now+7*DAY),false,'turned off');
    assert.equal(await deliverNextWeeklySummary(f.db,deliver,null,now),false,'no email server, nothing sent');
  }finally{f.db.close();}
});
