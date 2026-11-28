const assert=require('node:assert/strict'),{test}=require('node:test');
const {load}=require('./platform-loader.cjs'),{coachRun,plain}=require('./coach-fixture.cjs');
const {extractPeople,teamPageLinks,inferPattern,patternAddress}=load('prospect-people.ts');
const {ProspectSources}=load('prospect-sources.ts'),{SOURCE_TERMS_VERSION}=load('prospect-sources-types.ts');
const {ProspectNetwork}=load('prospect-network.ts');
const {ProspectSegments,joinSegment}=load('prospect-segments.ts'),{segmentAdvice}=load('prospect-segments-types.ts');
const {ProjectProspects}=load('prospects.ts');
const KEY='79'.repeat(32);
const approved=(f,id,company,website,sector='Diş kliniği')=>{const now=new Date().toISOString();f.db.prepare("INSERT INTO platform_prospects(id,organization_id,project_id,company,website,sector,reason,check_status,source_url,state,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'Strong fit','ok',?,'approved',?,?,?)").run(id,f.a.organizationId,f.a.projectId,company,website,sector,website,f.scope.subject,now,now);};
const HOME=`<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"Gülüş","founder":{"@type":"Person","name":"Ayşe Yılmaz"}}</script></head>
<body><nav><a href="/hakkimizda">Hakkımızda</a><a href="/hizmetler">Hizmetler</a><a href="https://other.example/ekip">Başka</a></nav><h1>Gülüş Diş Kliniği</h1><p>Genel Müdür</p><footer>© 2026</footer></body></html>`;
const ABOUT=`<html><body><p>Gülüş Diş Kliniği - Kurucu</p><h2>Ekibimiz</h2><div class="card"><h3>Dt. Mehmet KARA</h3><p>Kurucu Diş Hekimi</p></div><div class="card"><h3>Zeynep Ak</h3><p>Asistan</p></div><p>Can Demir - Genel Müdür</p></body></html>`;

test('names the company’s own pages give with a title; team pages on the same site; the company’s address pattern',()=>{
  assert.deepEqual(plain(teamPageLinks(HOME,'https://gulus.example/')),['https://gulus.example/hakkimizda'],'same site only, about pages only');
  const people=plain(extractPeople(ABOUT,'https://gulus.example/hakkimizda'));
  assert.deepEqual(people.map(item=>item.name).sort(),['Can Demir','Mehmet Kara']);
  assert.ok(!people.some(item=>item.name==='Zeynep Ak'),'no title, no person');
  assert.deepEqual(plain(extractPeople(HOME,'https://gulus.example/')).map(item=>[item.name,item.position]),[['Ayşe Yılmaz','Kurucu']],'structured data');
  assert.equal(patternAddress('Ayşe','Yılmaz','gulus.example',0),'ayse.yilmaz@gulus.example');
  assert.equal(patternAddress('Ayşe','Yılmaz','gulus.example',2),'ayilmaz@gulus.example');
  assert.equal(inferPattern([{value:'mkaya@gulus.example',note:'Mehmet Kaya · Satış'},{value:'info@gulus.example',note:''}],'gulus.example'),2);
  assert.equal(inferPattern([],'gulus.example'),null);
});

test('find the decision maker: the site, the team’s connections and Hunter; picking one adds the likely work address',coachRun(async f=>{
  approved(f,'p_gulus','Gülüş Diş Kliniği','https://gulus.example');
  const pages={'https://gulus.example':HOME,'https://gulus.example/':HOME,'https://gulus.example/hakkimizda':ABOUT};
  const site=async url=>{if(!pages[url])throw new Error('unreachable');return {finalUrl:url.endsWith('/')||url.includes('hakkimizda')?url:`${url}/`,html:pages[url]};};
  let mail='ok';const sources=new ProspectSources(f.db,f.scope,KEY,async()=>{throw new Error('no network');},site,async()=>mail);
  await assert.rejects(sources.people({id:'p_gulus'}),e=>e.status===409,'the owner accepts the person data text first');
  await sources.acceptTerms({kind:'list',accepted:true,version:SOURCE_TERMS_VERSION});
  await new ProspectNetwork(f.db,f.scope,KEY).importCsv({csv:'First Name,Last Name,URL,Email Address,Company,Position,Connected On\nSelin,Öz,https://www.linkedin.com/in/selin,,Gülüş Diş Kliniği,Kurucu Ortak,01 Jan 2024\n',part:0});
  let result=plain(await sources.people({id:'p_gulus'}));
  assert.equal(result.mail,'ok');assert.equal(result.pattern,null);assert.equal(result.pagesRead,2);
  const byName=Object.fromEntries(result.candidates.map(item=>[item.name,item]));
  assert.equal(byName['Selin Öz'].origin,'network');assert.equal(byName['Selin Öz'].email,'selin.oz@gulus.example');assert.equal(byName['Selin Öz'].emailKind,'guess');
  assert.equal(byName['Mehmet Kara'].origin,'site');assert.equal(byName['Mehmet Kara'].decisionMaker,true);assert.equal(byName['Mehmet Kara'].sourceUrl,'https://gulus.example/hakkimizda');
  assert.equal(byName['Ayşe Yılmaz'].origin,'site');
  assert.ok(!result.candidates.some(item=>/Gülüş/.test(item.name)),'the company’s own name is not a person');
  assert.ok(result.candidates.findIndex(item=>!item.decisionMaker)<0||result.candidates.findIndex(item=>!item.decisionMaker)>result.candidates.findIndex(item=>item.decisionMaker),'decision makers first');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_prospect_extra_contacts").get().n,0,'names are not stored until one is picked');
  // A Hunter result with a name teaches the company's pattern.
  const now=new Date().toISOString();f.db.prepare("INSERT INTO platform_prospect_extra_contacts(id,prospect_id,organization_id,project_id,kind,value,source,recipient_type,confidence,note,found_at) VALUES('pxh','p_gulus',?,?,'email','zkaya@gulus.example','hunter','person',90,'Zehra Kaya · Pazarlama',?)").run(f.a.organizationId,f.a.projectId,now);
  result=plain(await sources.people({id:'p_gulus'}));assert.equal(result.pattern,'asoyad');
  assert.equal(result.candidates.find(item=>item.name==='Mehmet Kara').email,'mkara@gulus.example');assert.equal(result.candidates.find(item=>item.name==='Mehmet Kara').emailKind,'pattern');
  assert.equal(result.candidates.find(item=>item.name==='Zehra Kaya').contactId,'pxh');
  // Picking one adds the address as a person's address, marked as a guess with where the name came from.
  const picked=plain(await sources.pickPerson({id:'p_gulus',name:'Mehmet Kara',position:'Kurucu Diş Hekimi',origin:'site'}));
  const row=f.db.prepare('SELECT * FROM platform_prospect_extra_contacts WHERE id=?').get(picked.contactId);
  assert.equal(row.value,'mkara@gulus.example');assert.equal(row.recipient_type,'person');assert.equal(row.source,'guess');assert.equal(row.note,'Mehmet Kara · Kurucu Diş Hekimi · site');
  assert.equal(plain(await sources.pickPerson({id:'p_gulus',name:'Mehmet Kara',position:'Kurucu Diş Hekimi',origin:'site'})).contactId,picked.contactId,'picking again keeps one address');
  assert.equal(plain(await sources.pickPerson({id:'p_gulus',name:'Zehra Kaya',origin:'hunter'})).contactId,'pxh');
  await assert.rejects(sources.pickPerson({id:'p_gulus',name:'x',origin:'site'}),e=>e.status===400);
  mail='none';await assert.rejects(sources.pickPerson({id:'p_gulus',name:'Can Demir',origin:'site'}),e=>e.status===409,'a domain without mail');
  const viewer=await f.member('viewer');await assert.rejects(new ProspectSources(f.db,viewer,KEY,undefined,site).people({id:'p_gulus'}),e=>e.status===403);
}));

test('customer groups: suggested from what the project knows, searched, counted, and advised to grow or stop',coachRun(async f=>{
  const segments=new ProspectSegments(f.db,f.scope);
  let snap=plain(await segments.read());assert.deepEqual(snap.segments,[]);assert.equal(snap.basis.approved,0);
  await assert.rejects(segments.suggest({mode:'template'}),e=>e.status===409,'nothing to rest on yet');
  approved(f,'p1','Gülüş','https://gulus.example');approved(f,'p2','Moda','https://moda.example');approved(f,'p3','Kent','https://kent.example','Lojistik');
  snap=plain(await segments.suggest({mode:'template'}));
  assert.deepEqual(snap.segments.map(item=>[item.keyword,item.source]),[['diş kliniği','template'],['lojistik','template']]);assert.equal(snap.basis.approved,3);
  // With AI: the answer must keep to the rules; earlier suggestions without companies are replaced.
  await assert.rejects(segments.suggest({},async()=>JSON.stringify({segments:[{name:'Klinikler',reason:'%100 garanti',fit:80,keyword:'klinik'}]})),e=>e.status===422);
  snap=plain(await segments.suggest({},async prompt=>{assert.match(prompt,/approvedSectors/);return JSON.stringify({segments:[{name:'Online randevusu olmayan diş klinikleri',reason:'Telefonla randevu alıyorlar.',fit:120,keyword:'diş kliniği',signals:['online_booking','nope']},{name:'Bakım',reason:'',fit:40,keyword:'x'}]});}));
  assert.deepEqual(snap.segments.map(item=>[item.name,item.fit,item.signals,item.source]),[['Online randevusu olmayan diş klinikleri',95,['online_booking'],'ai']]);
  await assert.rejects(segments.save({name:'Ok',keyword:'a'}),e=>e.status===400);
  await assert.rejects(segments.save({name:'İletişim grubu',keyword:'klinik',reason:'Yazın: info@x.example'}),e=>e.status===400);
  snap=plain(await segments.save({name:'Kurumsal ofisler',keyword:'ofis',fit:55,signals:['blog']}));assert.equal(snap.segments.length,2);
  const [dental,offices]=snap.segments;
  // Companies found for a group are counted under it; results come from the first emails and the replies.
  await joinSegment(f.db,f.scope,dental.id,['p1','p2']);await new ProspectSegments(f.db,f.scope).assign({prospectId:'p3',segmentId:offices.id});
  const event=(prospect,kind,detail)=>f.db.prepare('INSERT INTO platform_prospect_events(id,prospect_id,organization_id,project_id,kind,detail_json,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?)').run(`ev_${Math.random()}`,prospect,f.a.organizationId,f.a.projectId,kind,JSON.stringify(detail),f.scope.subject,new Date().toISOString());
  event('p1','email_sent',{step:0,segment:dental.id});event('p1','email_sent',{step:1,segment:dental.id});event('p2','touch',{channel:'linkedin'});event('p1','reply',{kind:'interested'});
  snap=plain(await segments.read());const d=snap.segments.find(item=>item.id===dental.id);
  assert.deepEqual([d.prospects,d.approved,d.sends,d.replies,d.interested],[2,2,2,1,1]);assert.equal(snap.members.p3,offices.id);
  assert.equal(segmentAdvice(2,1,1),'early');assert.equal(segmentAdvice(3,1,1),'scale');assert.equal(segmentAdvice(40,1,0),'steady');assert.equal(segmentAdvice(20,0,0),'pause');assert.equal(segmentAdvice(10,1,0),'scale');
  // Pausing, rights, and removing: the companies stay; a removed company leaves its group.
  snap=plain(await segments.state({id:offices.id,state:'paused'}));assert.equal(snap.segments.find(item=>item.id===offices.id).state,'paused');
  await assert.rejects(new ProspectSegments(f.db,await f.member('viewer')).save({name:'Okuyucu grubu',keyword:'ofis'}),e=>e.status===403);
  await new ProjectProspects(f.db,f.scope,async()=>{throw new Error('not used');}).remove({id:'p2'});
  assert.equal(plain(await segments.read()).segments.find(item=>item.id===dental.id).prospects,1);
  snap=plain(await segments.remove({id:offices.id}));assert.equal(snap.segments.length,1);assert.ok(f.db.prepare("SELECT 1 FROM platform_prospects WHERE id='p3'").get());
}));
