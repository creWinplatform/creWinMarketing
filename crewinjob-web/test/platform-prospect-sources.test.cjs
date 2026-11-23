const assert=require('node:assert/strict'),{test}=require('node:test');
const {load}=require('./platform-loader.cjs'),{coachRun,plain}=require('./coach-fixture.cjs');
const {ProspectSources,parseCsv,guessAddresses,recordVisit}=load('prospect-sources.ts');
const {ProspectFinder,readSignals}=load('prospect-finder.ts'),{ProjectProspects}=load('prospects.ts');
const {salesLearning,recordAgencyCustomer,suppressProspectHost}=load('prospect-outreach.ts');
const {SOURCE_TERMS_VERSION}=load('prospect-sources-types.ts');
const KEY='34'.repeat(32);
const page=(extra='')=>`<html><head><title>X</title><meta name="viewport" content="width=device-width"><script src="https://connect.facebook.net/en_US/fbevents.js"></script></head><body>${extra}<footer>© 2019</footer></body></html>`;

test('a CSV list is read with either separator, quotes and Turkish headers; name guesses fold Turkish letters',()=>{
  const {rows,more}=parseCsv('﻿Firma;Web sitesi;E-posta;Telefon;Sektör;Şehir\n"Gülüş; Diş";gulus.example;info@gulus.example;0216 555 11 22;Diş;Kadıköy\nBoş;;;;;\n',200);
  assert.equal(more,false);assert.equal(rows.length,2);assert.deepEqual(plain(rows[0]),{company:'Gülüş; Diş',website:'gulus.example',email:'info@gulus.example',phone:'0216 555 11 22',sector:'Diş',city:'Kadıköy'});
  assert.equal(parseCsv('company,website\nA,a.example\nB,b.example\nC,c.example',2).more,true);
  assert.throws(()=>parseCsv('ad,soyad\nx,y',10),e=>e.status===400,'company and website columns are required');
  assert.deepEqual(plain(guessAddresses('Şükrü','Çağlayan Öztürk','firma.example')),['sukru.ozturk@firma.example','sukru@firma.example','sozturk@firma.example','sukruozturk@firma.example','sukru_ozturk@firma.example']);
  assert.deepEqual(plain(guessAddresses('A','B','firma.example')),[]);
  assert.equal(readSignals(page('<a href="/kariyer">Kariyer</a>'),'https://x.example/').find(item=>item.key==='hiring').present,true);
  assert.equal(readSignals(page(),'https://x.example/').find(item=>item.key==='hiring').present,false);
});

test('lists, Hunter and guesses need the owner’s acceptance; personal mailboxes never become recipients',coachRun(async f=>{
  const calls=[],http=async(url,headers)=>{calls.push({url,headers});if(url.endsWith('/account'))return {status:headers['X-API-KEY']==='a'.repeat(40)?200:401,text:'{}'};
    if(url.includes('domain-search'))return {status:200,text:JSON.stringify({data:{emails:[{value:'ayse.kaya@gulus.example',type:'personal',confidence:91,first_name:'Ayşe',last_name:'Kaya',position:'Klinik müdürü'},{value:'info@gulus.example',type:'generic',confidence:80},{value:'spam@other.example',type:'generic'}]}})};
    throw new Error('unexpected');};
  const sources=new ProspectSources(f.db,f.scope,KEY,http),editor=await f.member('editor'),viewer=await f.member('viewer');
  const csv='Firma,Web sitesi,E-posta,Telefon,Sektör,Şehir\nGülüş Diş,https://www.gulus.example/,info@gulus.example,+90 216 555 11 22,Diş,Kadıköy\nKişisel,kisisel.example,ali@gmail.com,,,\nTekrar,gulus.example,,,,\nSitesiz,,x@y.example,,,\nEngelli,engelli.example,,,,';
  await assert.rejects(sources.importList({csv}),e=>e.status===409,'not before acceptance');
  await assert.rejects(new ProspectSources(f.db,editor,KEY,http).acceptTerms({kind:'list',accepted:true,version:SOURCE_TERMS_VERSION}),e=>e.status===403,'only the owner accepts');
  await assert.rejects(sources.acceptTerms({kind:'list',accepted:true,version:'old'}),e=>e.status===400);
  let snap=plain(await sources.acceptTerms({kind:'list',accepted:true,version:SOURCE_TERMS_VERSION}));assert.ok(snap.terms.list);assert.equal(snap.terms.visitors,null);
  await suppressProspectHost(f.db,f.scope,'https://engelli.example','unsubscribe');
  await assert.rejects(new ProspectSources(f.db,viewer,KEY,http).importList({csv}),e=>e.status===403);
  const result=plain(await sources.importList({csv}));assert.equal(result.added,2);assert.equal(result.skipped,3,'duplicate, no website and the never-contact list');
  const finder=plain(await new ProspectFinder(f.db,f.scope,async()=>{throw new Error('no');},async()=>{throw new Error('no');}).read()),list=plain(await new ProjectProspects(f.db,f.scope).read()).prospects;
  const gulus=list.find(item=>item.company==='Gülüş Diş'),personal=list.find(item=>item.company==='Kişisel');
  assert.equal(gulus.website,'https://www.gulus.example');assert.deepEqual(finder.insights[gulus.id].contacts.map(item=>[item.value,item.source,item.person]),[['info@gulus.example','import',false],['+902165551122','import',false]]);
  assert.equal(finder.insights[personal.id].contacts[0].person,true,'a gmail address is a person');
  // Hunter: the key is checked, stored encrypted and sent in a header, never in the address.
  await assert.rejects(new ProspectSources(f.db,editor,KEY,http).saveHunterKey({apiKey:'a'.repeat(40)}),e=>e.status===403);
  await assert.rejects(sources.saveHunterKey({apiKey:'b'.repeat(40)}),e=>e.status===400);
  snap=plain(await sources.saveHunterKey({apiKey:'a'.repeat(40)}));assert.equal(snap.hunter.masked,'aaaa…aaaa');
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_prospect_provider_keys').all()).includes('a'.repeat(40)));
  const found=plain(await new ProspectSources(f.db,editor,KEY,http).hunter({id:gulus.id}));assert.equal(found.found,1,'the role address already exists; another domain is ignored');
  assert.ok(calls.every(call=>!call.url.includes('a'.repeat(40))));
  const people=plain(await new ProspectFinder(f.db,f.scope).read()).insights[gulus.id].contacts.filter(item=>item.source==='hunter');
  assert.deepEqual(people.map(item=>[item.value,item.person,item.confidence,item.note]),[['ayse.kaya@gulus.example',true,91,'Ayşe Kaya · Klinik müdürü']]);
  const guessed=plain(await sources.guess({id:gulus.id,firstName:'Mehmet',lastName:'Yılmaz'}));assert.equal(guessed.added,5);
  await assert.rejects(sources.guess({id:gulus.id,firstName:'M',lastName:''}),e=>e.status===400);
  // Removing a company removes its extra addresses too.
  await new ProjectProspects(f.db,f.scope).remove({id:personal.id});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_prospect_extra_contacts WHERE prospect_id=?').get(personal.id).n,0);
  // Withdrawing the acceptance closes the source again.
  await sources.revokeTerms({kind:'list'});await assert.rejects(sources.hunter({id:gulus.id}),e=>e.status===409);
}));

test('visitor companies: consented beacons from the own site only, organisations only, never an IP',coachRun(async f=>{
  const sources=new ProspectSources(f.db,f.scope,KEY);
  await assert.rejects(sources.setVisitors({enabled:true}),e=>e.status===409,'terms first');
  await sources.acceptTerms({kind:'visitors',accepted:true,version:SOURCE_TERMS_VERSION});
  const saved=process.env.PLATFORM_PUBLIC_ORIGIN;process.env.PLATFORM_PUBLIC_ORIGIN='https://ryzevo.example';
  try{
    const snap=plain(await sources.setVisitors({enabled:true}));const key=snap.visitors.siteKey;assert.match(key,/^rzk_[A-Za-z0-9_-]{24}$/);assert.ok(snap.visitors.snippet.includes(`data-key="${key}"`));
    const lookup=async ip=>ip==='81.0.0.1'?{name:'Türk Telekom',domain:'turktelekom.com.tr',kind:'isp'}:ip==='81.0.0.2'?{name:'Deniz Mobilya A.Ş.',domain:'denizmobilya.example',kind:'business'}:null;
    assert.equal(await recordVisit(f.db,{key,origin:'https://evil.example',path:'/fiyat',ip:'81.0.0.2'},lookup),'ignored','another site');
    assert.equal(await recordVisit(f.db,{key,origin:'https://example.com',path:'/fiyat',ip:'10.0.0.5'},lookup),'ignored','a private address');
    assert.equal(await recordVisit(f.db,{key,origin:'https://example.com',path:'/',ip:'81.0.0.1'},lookup),'ignored','an access provider');
    assert.equal(await recordVisit(f.db,{key,origin:'https://www.example.com',path:'/fiyat?email=a@b.c#x',ip:'81.0.0.2'},lookup),'recorded');
    assert.equal(await recordVisit(f.db,{key,origin:'https://example.com',path:'/iletisim',ip:'81.0.0.2'},lookup),'recorded');
    const companies=plain(await sources.read()).visitors.companies;assert.equal(companies.length,1);assert.equal(companies[0].visits,2);assert.deepEqual(companies[0].pages,['/iletisim','/fiyat']);
    assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_visitor_companies').all()).includes('81.0.0.2'),'the IP is not stored');
    const added=plain(await sources.addVisitor({key:companies[0].key}));assert.ok(added.visitors.companies[0].prospectId);
    await sources.setVisitors({enabled:false});assert.equal(await recordVisit(f.db,{key,origin:'https://example.com',path:'/',ip:'81.0.0.2'},lookup),'ignored','switched off');
  }finally{if(saved===undefined)delete process.env.PLATFORM_PUBLIC_ORIGIN;else process.env.PLATFORM_PUBLIC_ORIGIN=saved;}
}));

test('lookalike profiles, site-change triggers, learning figures and agency customers',coachRun(async f=>{
  const pages={'https://a.example':page('<a href="https://wa.me/90555">WhatsApp</a>'),'https://b.example':page('<a href="https://wa.me/90555">WA</a><a href="/kariyer">Kariyer</a>'),'https://c.example':page()};
  const finder=new ProspectFinder(f.db,f.scope,async()=>{throw new Error('no');},async url=>{const key=url.replace(/\/$/,'');if(!pages[key])throw new Error('x');return {finalUrl:`${key}/`,html:pages[key]};});
  await assert.rejects(finder.lookalike({websites:['a.example']}),e=>e.status===400);
  await assert.rejects(finder.lookalike({from:'won'}),e=>e.status===409);
  const profile=plain(await finder.lookalike({websites:['a.example','b.example','c.example']}));
  assert.equal(profile.examples,3);assert.equal(profile.signals.meta_pixel,'present');assert.equal(profile.signals.online_booking,'missing');assert.equal(profile.signals.whatsapp,undefined,'two of three is not shared enough');
  // A rescan that finds a changed site is a trigger.
  const prospects=new ProjectProspects(f.db,f.scope),id=(await prospects.add({company:'C',website:'https://c.example'})).prospects[0].id;
  await finder.scan({id});pages['https://c.example']=page('<a href="/careers">Careers</a><a href="https://calendly.com/x">Book</a>');
  const insight=plain(await finder.scan({id})).insights[id];assert.equal(insight.triggers.hiring,true);assert.ok(insight.triggers.siteChangedAt);
  // Learning: replies by sector and by the signal the first email rested on.
  const event=(prospect,kind,detail)=>f.db.prepare('INSERT INTO platform_prospect_events(id,prospect_id,organization_id,project_id,kind,detail_json,actor_id,created_at) VALUES(?,?,?,?,?,?,NULL,?)').run(`e_${Math.random()}`,prospect,f.a.organizationId,f.a.projectId,kind,JSON.stringify(detail),new Date().toISOString());
  for(let i=0;i<6;i++){event(`p${i}`,'email_sent',{step:0,sector:i<3?'Diş':'Kafe',source:'ai',signals:['online_booking']});if(i<2)event(`p${i}`,'reply',{kind:i?'interested':'not_now'});}
  event('p5','reply',{kind:'auto_reply'});
  const learning=plain(await salesLearning(f.db,f.scope));assert.equal(learning.sends,6);assert.equal(learning.replies,2,'automatic replies do not count');assert.equal(learning.interested,1);
  assert.deepEqual(learning.sectors.map(row=>[row.key,row.sends,row.replies]),[['Diş',3,2],['Kafe',3,0]]);assert.deepEqual(learning.signals[0],{key:'online_booking',sends:6,replies:2,interested:1});
  // Agency mode: an accepted expert request is a won customer.
  await recordAgencyCustomer(f.db,f.scope,{company:'Müşteri',website:'https://musteri.example/yol',service:'Logo',actor:f.scope.subject});
  const row=f.db.prepare("SELECT p.state,p.reason,l.stage FROM platform_prospects p JOIN platform_prospect_pipeline l ON l.prospect_id=p.id WHERE p.website='https://musteri.example'").get();
  assert.deepEqual(plain(row),{state:'approved',reason:'Ryzevo uzman talebi: Logo',stage:'won'});
}));
