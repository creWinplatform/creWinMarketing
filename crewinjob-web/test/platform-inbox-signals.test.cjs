const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {inboxSignal,foldText}=load('inbox-signals.ts');
const {teamAlerts,alertMessage}=load('team-alerts.ts');
const HOUR=3600000,DAY=24*HOUR,iso=value=>new Date(value).toISOString();
const plain=value=>JSON.parse(JSON.stringify(value));

test('signals: Turkish and English complaints and escalations, spelling-insensitive, without false alarms',()=>{
  assert.equal(foldText('ŞİKÂYET ıııı Çok'),'sikayet iiii cok');
  for(const text of ['Siparişim hâlâ GELMEDİ, çok kötü bir deneyim','şikayet ediyorum','Uygulama çalışmıyor','I want a refund','Worst service ever','😡😡'])assert.equal(inboxSignal(text).level,'complaint',text);
  for(const text of ['Bu tam bir dolandırıcılık','Avukatıma ileteceğim, tüketici hakem heyetine başvurdum','şikayetvar.com’a yazdım','This is a scam','My lawyer will contact you'])assert.equal(inboxSignal(text).level,'urgent',text);
  // Words that only contain a listed word are not matches: davet (dava), ifade (iade), polisiye (polis).
  for(const text of ['Etkinlik davetiniz için teşekkürler','Güzel bir ifade olmuş','Polisiye dizileri seviyorum','Harika ürün, teşekkürler!','Fiyat bilgisi alabilir miyim?',''])assert.equal(inboxSignal(text).level,'none',text);
  assert.deepEqual(plain(inboxSignal('Dolandırıcı! Paramı geri istiyorum').matches),['Dolandırıcı'],'an escalation reports its own words');
  assert.ok(inboxSignal('İade istiyorum, ürün bozuk geldi, cevap yok').matches.length<=3,'at most three words are shown');
});

test('alerts: unanswered complaints of the last three days, urgent when one is an escalation; counts only in the email',async()=>{
  const f=await fixture();
  try{
    const page=await f.store.saveConnection({provider:'social',integrationId:'qa-only',accountName:'Private Page Name',accessToken:'private-page-token',expiresAt:Date.now()+30*DAY,social:{platform:'facebook',accountId:'100',graphVersion:'v25.0'}},KEY,{userAccessToken:'private-user-token',appId:'12345'});
    let n=0;const item=(text,hours,state='new')=>{const id=`signal-${++n}`;f.db.prepare("INSERT INTO platform_social_inbox(id,organization_id,project_id,connection_id,platform,kind,thread_id,item_id,author_hash,text,received_at,created_at,state) VALUES(?,?,?,?,'facebook','comment',?,?,?,?,?,?,?)").run(id,f.a.organizationId,f.a.projectId,page.id,`t-${id}`,`i-${id}`,'h',text,iso(Date.now()-hours*HOUR),iso(Date.now()),state);return id;};
    const kinds=async()=>plain((await teamAlerts(f.db,f.scope)).map(alert=>alert.kind));
    item('Harika ürün',1);item('Teşekkürler',2);
    assert.deepEqual(await kinds(),[],'friendly comments raise nothing');
    const late=item('Siparişim gelmedi',5);item('Bu ne rezalet',80);item('Ürün bozuk, iade istiyorum',3,'replied');
    let alert=(await teamAlerts(f.db,f.scope)).find(value=>value.kind==='inbox_negative');
    assert.equal(alert.count,1,'older than three days and answered items are left out');assert.equal(alert.severity,'warning');assert.deepEqual(plain(alert.keys),[`inbox-signal:${late}`]);
    const scam=item('Dolandırıcılar, avukatıma veriyorum',1);
    alert=(await teamAlerts(f.db,f.scope)).find(value=>value.kind==='inbox_negative');
    assert.equal(alert.count,2);assert.equal(alert.severity,'urgent');assert.ok(plain(alert.keys).includes(`inbox-signal:${scam}`));
    const mail=alertMessage([alert],'tr',{name:'QA',timezone:'Europe/Istanbul'},'https://ryzevo.example');
    assert.match(mail.text,/2 yorum veya mesaj şikâyet/);assert.doesNotMatch(mail.text,/Dolandırıcı|avukatıma|gelmedi/,'no customer text leaves the app');
    // People without the inbox reading duty do not see it.
    const viewer={...f.scope,subject:(await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'signals-viewer',password:'fixture-password-123',role:'viewer'})).userId};
    assert.ok(!plain((await teamAlerts(f.db,viewer)).map(value=>value.kind)).includes('inbox_negative'));
  }finally{f.db.close();}
});
