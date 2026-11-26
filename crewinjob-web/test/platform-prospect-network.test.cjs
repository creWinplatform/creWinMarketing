const assert=require('node:assert/strict'),{test}=require('node:test');
const {load}=require('./platform-loader.cjs'),{coachRun,plain}=require('./coach-fixture.cjs');
const {ProspectNetwork,parseConnections,companyKey,sameCompany}=load('prospect-network.ts');
const {ProspectSources}=load('prospect-sources.ts'),{SOURCE_TERMS_VERSION}=load('prospect-sources-types.ts');
const {ProspectOutreach,salesLearning}=load('prospect-outreach.ts');
const KEY='78'.repeat(32);
// The LinkedIn export starts with note lines before the header.
const CSV=`Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ayşe,Kaya,https://www.linkedin.com/in/aysekaya,,Gülüş Diş Kliniği Ltd. Şti.,Genel Müdür,12 Mar 2024
Mehmet,Öz,https://www.linkedin.com/in/mehmetoz,mehmet@example.com,"Moda Klinik, A.Ş.",Hemşire,01 Jan 2023
Zeynep,Ak,https://www.linkedin.com/in/zeynepak,,Kent Lojistik,Kurucu Ortak,05 Feb 2022
Can,Ak,https://www.linkedin.com/in/canak,,Kent Lojistik,Satış Uzmanı,05 Feb 2022
,Boş,,,Firma,Pozisyon,
`;
const approved=(f,id,company,website)=>{const now=new Date().toISOString();f.db.prepare("INSERT INTO platform_prospects(id,organization_id,project_id,company,website,reason,check_status,source_url,state,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'Strong fit','ok',?,'approved',?,?,?)").run(id,f.a.organizationId,f.a.projectId,company,website,website,f.scope.subject,now,now);};

test('LinkedIn connections are read after the note lines; company names meet without legal forms',()=>{
  const rows=plain(parseConnections(CSV));assert.equal(rows.length,4,'a row without a first name is skipped');
  assert.deepEqual(rows[1],{firstName:'Mehmet',lastName:'Öz',url:'https://www.linkedin.com/in/mehmetoz',email:'mehmet@example.com',company:'Moda Klinik, A.Ş.',position:'Hemşire',connected:'01 Jan 2023'});
  assert.equal(companyKey('Gülüş Diş Kliniği Ltd. Şti.'),'gulus dis klinigi');assert.equal(companyKey('Moda Klinik, A.Ş.'),'moda klinik');
  assert.equal(sameCompany(companyKey('Gülüş Diş Kliniği Ltd. Şti.'),{company:'Gülüş Diş Kliniği',website:'https://gulus.example'}),true);
  assert.equal(sameCompany(companyKey('Moda Klinik'),{company:'Başka',website:'https://www.modaklinik.example'}),true,'by the site name');
  assert.equal(sameCompany(companyKey('Kent'),{company:'Kent Lojistik',website:'https://kentlojistik.example'}),false,'too short to guess');
  assert.throws(()=>parseConnections('a,b\n1,2'),e=>e.status===400);
});

test('warm introductions: import with the owner’s acceptance, matches, network companies, a prepared message and the channel figures',coachRun(async f=>{
  const network=new ProspectNetwork(f.db,f.scope,KEY),viewer=await f.member('viewer');
  approved(f,'p_gulus','Gülüş Diş Kliniği','https://gulus.example');approved(f,'p_moda','Moda Klinik','https://modaklinik.example');
  await assert.rejects(network.importCsv({csv:CSV}),e=>e.status===409,'the owner accepts the responsibility text first');
  await new ProspectSources(f.db,f.scope,KEY).acceptTerms({kind:'list',accepted:true,version:SOURCE_TERMS_VERSION});
  await assert.rejects(new ProspectNetwork(f.db,viewer,KEY).importCsv({csv:CSV}),e=>e.status===403);
  let result=plain(await network.importCsv({csv:CSV,part:0}));assert.equal(result.added,4);
  result=plain(await network.importCsv({csv:CSV,part:1}));assert.equal(result.added,0);assert.equal(result.updated,4,'importing again updates, never doubles');
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_network_contacts').all()).includes('Ayşe'),'names are stored encrypted');
  let snap=plain(await network.read());assert.equal(snap.total,4);
  assert.deepEqual(snap.matches.map(item=>[item.contact.name,item.contact.decisionMaker,item.prospects[0].id]),[['Ayşe Kaya',true,'p_gulus'],['Mehmet Öz',false,'p_moda']],'decision makers first');
  assert.deepEqual(snap.companies,[{key:'kent lojistik',company:'Kent Lojistik',people:2,decisionMakers:1}]);
  assert.deepEqual(plain((await network.read({q:'lojist'})).results.map(item=>item.name)),['Zeynep Ak','Can Ak']);
  // The company cards know who the team knows there.
  const sales=plain(await new ProspectOutreach(f.db,f.scope,KEY).read());assert.deepEqual(sales.network.p_gulus,{count:1,first:'Ayşe K.',position:'Genel Müdür'});
  // A prepared message: the template without AI; the AI with its rules.
  const ayse=snap.matches[0].contact;
  const drafted=plain(await network.draft({contactId:ayse.id,prospectId:'p_gulus'}));assert.equal(drafted.source,'template');assert.match(drafted.text,/^Merhaba Ayşe/);
  await assert.rejects(network.draft({contactId:ayse.id,prospectId:'p_gulus'},async()=>JSON.stringify({text:'Bak https://x.example'})),e=>e.status===422);
  assert.equal(plain(await network.draft({contactId:ayse.id},async prompt=>{assert.match(prompt,/first-degree connection/);return JSON.stringify({text:'Merhaba Ayşe, 15 dakika fikrini alabilir miyim?'});})).source,'ai');
  // Sent from LinkedIn by the person: the contact is marked and the company counts as contacted by introduction.
  snap=plain(await network.mark({contactId:ayse.id,state:'asked',prospectId:'p_gulus'}));assert.equal(snap.asked,1);
  assert.equal(f.db.prepare("SELECT stage FROM platform_prospect_pipeline WHERE prospect_id='p_gulus'").get().stage,'contacted');
  await new ProspectOutreach(f.db,f.scope,KEY).stage({id:'p_gulus',stage:'meeting'});
  const learning=plain(await salesLearning(f.db,f.scope));assert.deepEqual(learning.channels,[{key:'network',sends:1,replies:1,interested:0}],'introductions that moved on');
  // A company from the network goes on the list with its website.
  await assert.rejects(network.addCompany({key:'kent lojistik',website:'yok'}),e=>e.status===400);
  snap=plain(await network.addCompany({key:'kent lojistik',website:'kent.example'}));assert.deepEqual(snap.companies,[]);assert.equal(snap.matches.length,4);
  await assert.rejects(network.mark({contactId:ayse.id,state:'nope'}),e=>e.status===400);
  snap=plain(await network.clear());assert.equal(snap.total,0);
}));
