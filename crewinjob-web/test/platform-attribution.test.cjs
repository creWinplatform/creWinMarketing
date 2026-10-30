const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHmac,randomBytes}=require('node:crypto');
const vm=require('node:vm');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts');
const {PlatformRepository}=load('repository.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
const {ProductWebhooks,authenticateProductWebhook}=load('product-webhooks.ts');
const {ProjectMeasurements}=load('measurements.ts');
const {ProjectAttribution,normalizeAttribution,pruneAttribution}=load('attribution.ts');
const {ATTRIBUTION_SNIPPET}=load('attribution-types.ts');
const {LinkTracking,linkTag}=load('link-tracking.ts');
const {MonthlyReports}=load('monthly-report.ts');
const KEY='12'.repeat(32),SECRET=randomBytes(32).toString('hex'),DAY=86400000;
const plain=value=>JSON.parse(JSON.stringify(value));
const ago=(days,extra=0)=>new Date(Date.now()-days*DAY-extra).toISOString();

function fixture(){
 const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
 const provision=name=>repo.provision('legacy-admin',{organizationName:name,projectName:name,website:'https://example.com',username:name,password:'fixture-password-123'});
 const a=provision('attribution'),b=provision('elsewhere'),scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId};
 repo.updateProject(a.userId,a.organizationId,a.projectId,{name:'Attribution QA',website:'https://example.com',timezone:'Europe/Istanbul',language:'tr',brandVoice:'Fixture',goals:[{id:'growth',label:{tr:'Büyüme',en:'Growth'},audience:{tr:'Kurucular',en:'Founders'},stages:[{tr:'Kayıt',en:'Signup'},{tr:'Ödeme',en:'Payment'}]}]});
 const hooks=new ProductWebhooks(db,scope),store=new ProjectMarketingStore(db,scope);
 const source=(name,eventNames,attributes=[{key:'amount',type:'number'}])=>{const saved=hooks.save({name,config:{entityType:'user',attributes,eventNames},secret:SECRET},KEY);hooks.preview(saved.id,{sourceVersion:1,events:[{id:'preview-1',entityId:'preview',eventName:eventNames[0],occurredAt:ago(0,1000),attributes:Object.fromEntries(attributes.map(field=>[field.key,field.type==='number'?1:'x']))}]});return hooks.state(saved.id,1,'activate');};
 const app=source('App events',['user.signed_up']),billing=source('Billing',['payment.succeeded']);
 const send=(src,events)=>{
  const bytes=Buffer.from(JSON.stringify({sourceVersion:1,events})),timestamp=String(Math.floor(Date.now()/1000));
  const signature='v1='+createHmac('sha256',Buffer.from(SECRET,'hex')).update(`${timestamp}.${src.id}.`).update(bytes).digest('hex');
  return authenticateProductWebhook(db,src.id,new Headers({'x-ryzevo-timestamp':timestamp,'x-ryzevo-signature':signature}),KEY)(bytes);
 };
 const signup=(id,entityId,attribution,occurredAt=ago(1))=>({id,entityId,eventName:'user.signed_up',occurredAt,attributes:{amount:0},...(attribution===undefined?{}:{attribution})});
 const payment=(id,entityId,amount,occurredAt=ago(0,60000))=>({id,entityId,eventName:'payment.succeeded',occurredAt,attributes:{amount}});
 const measure=new ProjectMeasurements(db,scope,KEY);
 const bind=()=>{measure.save({goalId:'growth',stageIndex:0,connectionId:app.id,metric:'unique_entities',eventName:'user.signed_up',enabled:false,expectedVersion:0});measure.save({goalId:'growth',stageIndex:1,connectionId:billing.id,metric:'unique_entities',eventName:'payment.succeeded',enabled:false,expectedVersion:0});};
 return {db,repo,a,b,scope,hooks,store,app,billing,send,signup,payment,bind,attribution:new ProjectAttribution(db,scope)};
}
const close=async work=>{const f=fixture();try{await work(f);}finally{f.db.close();}};

test('the attribution field is optional, strict and never costs the event',()=>{
 const at=new Date().toISOString();
 assert.deepEqual(plain(normalizeAttribution(undefined,at)),{touch:null,invalid:false});
 const touched=ago(3);assert.deepEqual(plain(normalizeAttribution({campaign:'rz_0123456789',source:'linkedin',medium:'social',touchedAt:touched},at).touch),{campaign:'rz_0123456789',source:'linkedin',medium:'social',touchedAt:touched});
 assert.equal(normalizeAttribution({campaign:'spring sale'},at).invalid,true,'spaces are not a campaign');
 assert.equal(normalizeAttribution({campaign:'rz_0123456789',source:'linked in'},at).invalid,true);
 assert.equal(normalizeAttribution({campaign:'rz_0123456789',extra:'x'},at).invalid,true,'unknown keys are refused');
 assert.equal(normalizeAttribution({campaign:'rz_0123456789',touchedAt:'yesterday'},at).invalid,true);
 assert.equal(normalizeAttribution({campaign:'rz_0123456789',touchedAt:ago(401)},at).invalid,true,'older than the retention');
 assert.equal(normalizeAttribution('rz_0123456789',at).invalid,true);
 assert.equal(normalizeAttribution({campaign:'newsletter-2026',source:null},at).touch.source,null,'any clean campaign is kept, not only Ryzevo tags');
});

test('webhook events store a pseudonymous trail and the first touch; a malformed tag is dropped, the event kept',()=>close(async f=>{
 const first=f.signup('s-1','person-1',{campaign:'rz_0123456789',source:'linkedin',medium:'social',touchedAt:ago(2)}),second=f.signup('s-2','person-2',{campaign:'bad tag'});
 const result=f.send(f.app,[first,second]);
 assert.equal(result.accepted,2);assert.deepEqual(plain(result.attribution),{recorded:1,ignored:1});
 const touches=f.db.prepare('SELECT * FROM platform_attribution_touches').all(),events=f.db.prepare('SELECT * FROM platform_attribution_events').all();
 assert.equal(touches.length,1);assert.equal(events.length,2);assert.equal(touches[0].campaign,'rz_0123456789');
 assert.ok(!JSON.stringify([touches,events]).includes('person-1'),'no entity id is kept');
 assert.match(touches[0].entity_key,/^[a-f0-9]{64}$/);
 // Retrying the same events is a duplicate; changing an accepted event (adding a tag later) is refused like any change.
 assert.equal(f.send(f.app,[first]).duplicates,1);
 assert.throws(()=>f.send(f.app,[{...second,attribution:{campaign:'rz_0123456789'}}]),error=>error.code==='event_conflict');
 const untagged=f.signup('s-3','person-3');assert.equal(f.send(f.app,[untagged]).accepted,1);assert.equal(f.send(f.app,[untagged]).duplicates,1,'events without the field keep their old digest');
 // The preview counts tags without storing anything.
 const before=f.db.prepare('SELECT COUNT(*) n FROM platform_attribution_events').get().n;
 const preview=f.hooks.preview(f.app.id,{sourceVersion:1,events:[f.signup('p-1','x',{campaign:'rz_0123456789'}),f.signup('p-2','y',{campaign:'?'})]});
 assert.deepEqual(plain(preview.attribution),{found:1,ignored:1});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_attribution_events').get().n,before);
}));

test('the earliest touch wins, a touch never comes after its event and later events follow the person across sources',()=>close(async f=>{
 f.send(f.app,[f.signup('late','person-1',{campaign:'rz_aaaaaaaaaa',source:'facebook',touchedAt:ago(3)},ago(2))]);
 f.send(f.app,[f.signup('early','person-1',{campaign:'rz_bbbbbbbbbb',source:'linkedin',touchedAt:ago(10)},ago(2,1000))]);
 f.send(f.app,[f.signup('newer','person-1',{campaign:'rz_cccccccccc',source:'x',touchedAt:ago(1)},ago(1))]);
 assert.equal(f.db.prepare('SELECT campaign FROM platform_attribution_touches').get().campaign,'rz_bbbbbbbbbb');
 const signedUp=ago(1);f.send(f.app,[f.signup('future','person-2',{campaign:'rz_dddddddddd',touchedAt:new Date(Date.now()+60000).toISOString()},signedUp)]);
 assert.equal(f.db.prepare("SELECT touched_at FROM platform_attribution_touches WHERE campaign='rz_dddddddddd'").get().touched_at,signedUp,'clamped to the event that reported it');
 f.bind();f.send(f.billing,[f.payment('pay-1','person-1',49)]);
 const report=f.attribution.report(30);
 assert.deepEqual(report.stages.map(stage=>stage.label.en),['Signup','Payment']);
 assert.deepEqual(plain(report.unmatched),[2,1],'tags of no item in this project are counted apart');
}));

test('the report credits posts and emails per stage, by channel, with coverage, value and other campaigns',()=>close(async f=>{
 f.bind();
 f.store.saveContent({id:'guide-post',platform:'linkedin',language:'tr',content:'Rehber https://example.com/rehber',headline:'Rehber yazısı',prompt:'',timestamp:Date.now()},true);
 f.store.saveCampaign({id:'welcome-mail',name:'Hoş geldin e-postası',status:'draft',updatedAt:new Date().toISOString(),content:{subject:'Merhaba',text:'Selam',ctaUrl:'https://example.com/basla'},channels:{email:true,social:[],whatsapp:false,telegram:false,paidAds:[]}},true);
 const post=linkTag(f.scope,'content','guide-post'),mail=linkTag(f.scope,'campaign','welcome-mail');
 new ProjectAttribution(f.db,f.scope).saveSettings({valueConnectionId:f.billing.id,valueEvent:'payment.succeeded',valueKey:'amount',currency:'TRY'});
 f.send(f.app,[
  f.signup('a','p-a',{campaign:post,source:'linkedin',medium:'social',touchedAt:ago(5)}),f.signup('b','p-b',{campaign:post,source:'facebook',medium:'social',touchedAt:ago(5)}),
  f.signup('c','p-c',{campaign:mail,source:'email',medium:'email',touchedAt:ago(4)}),f.signup('d','p-d',{campaign:'google-ads-q4',source:'google',medium:'cpc',touchedAt:ago(4)}),
  f.signup('e','p-e'),f.signup('old','p-old',{campaign:post,source:'linkedin',touchedAt:ago(120)}),
 ]);
 f.send(f.billing,[f.payment('pa','p-a',100),f.payment('pa2','p-a',50,ago(0,120000)),f.payment('pc','p-c',30),f.payment('pold','p-old',999)]);
 const report=f.attribution.report(30);
 assert.deepEqual(plain(report.coverage),{entities:6,touched:4,ryzevo:3},'p-old touched outside the 90-day window');
 const byTag=Object.fromEntries(report.items.map(item=>[item.tag,item]));
 assert.deepEqual(plain(byTag[post].counts),[2,1]);assert.deepEqual(plain(byTag[post].sources).sort(),['facebook','linkedin']);assert.equal(byTag[post].title,'Rehber yazısı');assert.equal(byTag[post].kind,'content');
 assert.equal(byTag[post].value,150,'all payments of the person in the period');
 assert.deepEqual(plain(byTag[mail].counts),[1,1]);assert.equal(byTag[mail].kind,'campaign');assert.equal(byTag[mail].value,30);
 assert.equal(report.items[0].tag,post,'deepest stage first, then the earlier stages');
 assert.deepEqual(plain(report.channels.find(item=>item.source==='email').counts),[1,1]);
 assert.deepEqual(plain(report.other),[{campaign:'google-ads-q4',source:'google',counts:[1,0]}]);
 assert.deepEqual(plain(report.value),{currency:'TRY',eventName:'payment.succeeded'});
 assert.equal(byTag[post].sessions,null,'GA4 sessions only when a property is read');
 assert.deepEqual(plain(f.attribution.forTag(post,'linkedin').counts),[1,1]);assert.deepEqual(plain(f.attribution.forTag(post,null).counts),[2,1]);
 assert.equal(f.attribution.forTag('not-a-tag','linkedin'),null);
 assert.equal(report.setup.activeSources,2);assert.equal(report.setup.stagesMapped,true);assert.ok(report.setup.touches>=4);
 const month=new MonthlyReports(f.db,f.scope).facts(new Date().toISOString().slice(0,7));
 assert.ok(month.results,'the monthly report carries the month’s results');assert.deepEqual(month.results.stages.map(stage=>stage.en),['Signup','Payment']);
 assert.ok(!JSON.stringify(month).includes('p-a'),'no person id in the report');
}));

test('stages fall back to event names, settings are validated and only the project team reads it',()=>close(async f=>{
 f.send(f.app,[f.signup('a','p-a',{campaign:'rz_0123456789',source:'linkedin',touchedAt:ago(2)})]);
 assert.deepEqual(f.attribution.report(30).stages.map(stage=>stage.eventName),['user.signed_up'],'without a mapping the event names stand in');
 assert.throws(()=>f.attribution.saveSettings({valueConnectionId:f.billing.id,valueEvent:'payment.succeeded',valueKey:'missing',currency:'TRY'}),error=>error.status===409);
 assert.throws(()=>f.attribution.saveSettings({valueConnectionId:f.billing.id,valueEvent:'payment.succeeded',valueKey:'amount',currency:'lira'}),error=>error.status===400);
 assert.throws(()=>f.attribution.saveSettings({valueConnectionId:f.billing.id,valueEvent:'payment.succeeded',valueKey:'amount',currency:'TRY',extra:1}));
 assert.equal(f.attribution.saveSettings({valueConnectionId:null,valueEvent:null,valueKey:null,currency:null}).valueConnectionId,null);
 assert.throws(()=>new ProjectAttribution(f.db,{subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'}).report(30),error=>error.status===403,'Crewin has no product events');
 const viewer=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'viewer',password:'fixture-password-123',role:'viewer'});
 const asViewer=new ProjectAttribution(f.db,{...f.scope,subject:viewer.userId});
 assert.equal(asViewer.report(90).days,90);assert.equal(asViewer.settings().options.length,0);assert.throws(()=>asViewer.saveSettings({valueConnectionId:null}),error=>error.status===403);
 assert.throws(()=>new ProjectAttribution(f.db,{subject:f.b.userId,organizationId:f.a.organizationId,projectId:f.a.projectId}).report(30),error=>error.status===403);
 assert.equal(f.attribution.report(7).days,30,'unknown periods fall back to 30 days');
}));

test('old trail is pruned and a project over its cap loses its oldest rows first',()=>close(async f=>{
 f.send(f.app,[f.signup('a','p-a',{campaign:'rz_0123456789',touchedAt:ago(2)})]);
 f.db.prepare("UPDATE platform_attribution_events SET occurred_at=?").run(ago(401));f.db.prepare("UPDATE platform_attribution_touches SET touched_at=?").run(ago(501));
 assert.deepEqual(plain(pruneAttribution(f.db)),{events:1,touches:1});
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_attribution_events').get().n,0);
}));

test('email links to the project site carry the campaign tag in the reviewed and sent text',()=>close(async f=>{
 const {CampaignReviews}=load('campaign-review.ts');
 f.store.saveCampaign({id:'mail-1',name:'Mail',status:'draft',updatedAt:new Date().toISOString(),content:{subject:'Merhaba',text:'Rehber: https://example.com/rehber ve https://other.org/x',ctaUrl:'https://example.com/basla'},channels:{email:true,social:[],whatsapp:false,telegram:false,paidAds:[]}},true);
 const reviews=new CampaignReviews(f.db,f.scope,KEY),tag=linkTag(f.scope,'campaign','mail-1'),tagged=reviews.get('mail-1');
 assert.equal(tagged.ctaUrl,`https://example.com/basla?utm_source=email&utm_medium=email&utm_campaign=${tag}`);
 assert.ok(tagged.text.includes(`https://example.com/rehber?utm_source=email&utm_medium=email&utm_campaign=${tag}`));assert.ok(tagged.text.includes('https://other.org/x'),'other sites stay as written');
 assert.ok(tagged.html.includes(tag),'the preview shows the tagged link');
 new LinkTracking(f.db,f.scope,KEY).configure({enabled:false,connectionId:null});
 const untagged=reviews.get('mail-1');assert.equal(untagged.ctaUrl,'https://example.com/basla');assert.notEqual(untagged.digest,tagged.digest,'turning tagging off asks for a new approval');
 f.store.saveCampaign({id:'mail-2',name:'Mail 2',status:'draft',updatedAt:new Date().toISOString(),content:{subject:'Merhaba',text:'Selam',ctaUrl:'https://other.org/x'},channels:{email:true,social:[],whatsapp:false,telegram:false,paidAds:[]}},true);
 new LinkTracking(f.db,f.scope,KEY).configure({enabled:true,connectionId:null});
 assert.equal(reviews.get('mail-2').ctaUrl,'https://other.org/x');
}));

test('the snippet writes nothing before consent and keeps only the first clean touch',()=>{
 const run=(search,consent,cookie='')=>{
  const html=ATTRIBUTION_SNIPPET.replace(/^<script[^>]*>\n/,'').replace(/<\/script>$/,'');
  const writes=[],document={cookie,currentScript:{getAttribute:name=>name==='data-consent'?consent:null}};
  Object.defineProperty(document,'cookie',{get:()=>cookie,set:value=>{writes.push(value);cookie=value.split(';')[0];}});
  const window={location:{search}};vm.runInNewContext(html,{window,document,URLSearchParams,JSON,Date,encodeURIComponent,decodeURIComponent});
  return {writes,api:window.ryzevoTouch};
 };
 assert.equal(run('?utm_campaign=rz_0123456789&utm_source=linkedin','ask').writes.length,0,'no consent, no cookie');
 const allowed=run('?utm_campaign=rz_0123456789&utm_source=linkedin&utm_medium=social','ask');allowed.api.allow();
 assert.equal(allowed.writes.length,1);assert.match(allowed.writes[0],/^ryz_touch=.+; Max-Age=7776000; Path=\/; SameSite=Lax; Secure$/);
 assert.equal(allowed.api.get().campaign,'rz_0123456789');assert.equal(allowed.api.get().source,'linkedin');
 assert.equal(run('?utm_campaign=rz_0123456789','granted').writes.length,1,'data-consent="granted" writes at once');
 const existing=run('?utm_campaign=rz_aaaaaaaaaa','granted','ryz_touch='+encodeURIComponent(JSON.stringify({campaign:'rz_0123456789'})));
 assert.equal(existing.writes.length,0,'the first touch is kept');
 assert.equal(run('?utm_campaign=spring%20sale','granted').writes.length,0,'a value that is not clean is not stored');
});
