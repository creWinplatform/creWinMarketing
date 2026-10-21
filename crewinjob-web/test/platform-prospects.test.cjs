const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun}=require('./coach-fixture.cjs');
const {ProjectProspects}=load('prospects.ts');
const {ProjectOperations}=load('operations.ts');
const PAGE={finalUrl:'https://shop.example/',title:'Corner Shop Supplies',description:'Inventory and invoicing tools for independent shops.',headings:['Run your shop with less paperwork'],text:'Run your shop with less paperwork. We help 40 local shops every week. Contact sales.'};
const reader=pages=>async url=>{const page=pages[url];if(!page)throw new Error('unreachable');return page;};
const prospects=(f,scope=f.scope,pages={'https://shop.example':PAGE})=>new ProjectProspects(f.db,scope,reader(pages));

test('the team adds companies; personal contact data is refused and duplicates are rejected',coachRun(async f=>{
  let snapshot=prospects(f).add({company:'Corner Shop',website:'shop.example/about',sector:'Retail',contactRole:'Operations manager',reason:''});
  const item=snapshot.prospects[0];assert.equal(item.website,'https://shop.example','stored as the site origin');assert.equal(item.check.status,'not_checked');assert.equal(item.state,'candidate');
  assert.throws(()=>prospects(f).add({company:'Again',website:'https://shop.example'}),error=>error.status===409);
  for(const bad of [{company:'Named',website:'a.example',contactRole:'jane@a.example'},{company:'Phone',website:'b.example',reason:'Call +90 555 123 45 67'},{company:'Handle',website:'c.example',contactRole:'@jane_doe'}])assert.throws(()=>prospects(f).add(bad),/kişisel iletişim/);
  assert.equal(prospects(f).add({company:'Years ok',website:'d.example',reason:'Growing since 2020-2024 per their page'}).prospects.length,2,'years and ranges are not mistaken for phone numbers');
  assert.throws(()=>prospects(f).add({company:'Bad',website:'javascript:alert(1)'}),/web sitesi/);
  assert.equal(prospects(f,f.other).read().prospects.length,0,'other projects see nothing');
}));
test('checking stores what the company page shows, with its address and time; unreachable pages are recorded as such',coachRun(async f=>{
  const id=prospects(f).add({company:'Corner Shop',website:'https://shop.example'}).prospects[0].id;
  let item=(await prospects(f).check({id})).prospects.find(row=>row.id===id);
  assert.equal(item.check.status,'ok');assert.equal(item.check.sourceUrl,'https://shop.example/');assert.equal(item.check.pageTitle,'Corner Shop Supplies');assert.equal(item.check.evidence,PAGE.description);assert.ok(item.check.checkedAt);
  const other=prospects(f).add({company:'Gone',website:'https://gone.example'}).prospects.find(row=>row.company==='Gone');
  item=(await prospects(f).check({id:other.id})).prospects.find(row=>row.id===other.id);assert.equal(item.check.status,'unreachable');assert.equal(item.check.sourceUrl,null);
  // A redirect to a different site is not evidence for this company.
  const moved=prospects(f).add({company:'Moved',website:'https://moved.example'}).prospects.find(row=>row.company==='Moved');
  item=(await prospects(f,f.scope,{'https://moved.example':{...PAGE,finalUrl:'https://elsewhere.example/'}}).check({id:moved.id})).prospects.find(row=>row.id===moved.id);assert.equal(item.check.status,'unreachable');
  assert.equal(prospects(f).read().checksLeft,47);
}));
test('AI reasons must quote the page word for word and name roles, never people; failures are refunded',coachRun(async f=>{
  const id=prospects(f).add({company:'Corner Shop',website:'https://shop.example'}).prospects[0].id;
  await assert.rejects(prospects(f).suggest({id},async()=>'{}'),error=>error.status===409,'check the site first');
  await prospects(f).check({id});const usage=f.aiUsage();
  const answer=value=>async()=>JSON.stringify({fit:'strong',reason:'They sell to independent shops.',quote:'Inventory and invoicing tools for independent shops.',contactRole:'Operations manager',...value});
  await assert.rejects(prospects(f).suggest({id},answer({quote:'They serve 500 enterprise clients'})),error=>error.status===422,'a quote that is not on the page is rejected');
  await assert.rejects(prospects(f).suggest({id},answer({contactRole:'Jane, jane@shop.example'})),error=>error.status===422);
  await assert.rejects(prospects(f).suggest({id},answer({reason:'This guarantees more sales.'})),error=>error.status===422);
  assert.equal(f.aiUsage(),usage);assert.equal(f.reserved(),0);
  const item=(await prospects(f).suggest({id},answer({}))).prospects[0];
  assert.equal(item.reasonSource,'ai');assert.match(item.reason,/^(Strong fit|Güçlü uyum): They sell/);assert.equal(item.check.evidence,'Inventory and invoicing tools for independent shops.');assert.equal(item.contactRole,'Operations manager');assert.equal(f.aiUsage(),usage+1);
  await assert.rejects(prospects(f).suggest({id}),error=>error.status===503,'AI needs a configured provider');
}));
test('approval needs a checked page, a written reason and the approval right; outreach is one Calendar task, never a send',coachRun(async f=>{
  const editor=f.member('editor'),viewer=f.member('viewer');
  const id=prospects(f).add({company:'Corner Shop',website:'https://shop.example',contactRole:'Owner'}).prospects[0].id;let item=prospects(f).read().prospects[0];
  assert.throws(()=>prospects(f).decide({id,decision:'approve',expectedRevision:item.revision}),error=>error.status===409,'not checked and no reason yet');
  await prospects(f).check({id});item=prospects(f).update({id,expectedRevision:prospects(f).read().prospects[0].revision,reason:'Sells to the same independent shops we serve.',contactRole:'Owner',sector:'',country:''}).prospects[0];
  assert.throws(()=>prospects(f,editor).decide({id,decision:'approve',expectedRevision:item.revision}),error=>error.status===403);
  assert.throws(()=>prospects(f,viewer).add({company:'X',website:'x.example'}),error=>error.status===403);
  item=prospects(f).decide({id,decision:'approve',expectedRevision:item.revision,note:'Good fit'}).prospects[0];assert.equal(item.state,'approved');
  const first=prospects(f).plan({id}),again=prospects(f).plan({id});assert.equal(first.created,true);assert.equal(again.created,false);assert.match(first.task.note,/sends nothing|hiçbir şey göndermez/);
  assert.equal(new ProjectOperations(f.db,f.scope).tasks().filter(task=>task.note.startsWith('prospect:')).length,1);
  // Editing the reason after approval sends the prospect back for a new decision.
  item=prospects(f).update({id,expectedRevision:prospects(f).read().prospects[0].revision,reason:'Changed reason.',contactRole:'Owner',sector:'',country:''}).prospects[0];assert.equal(item.state,'candidate');
  item=prospects(f,editor).decide({id,decision:'reject',expectedRevision:item.revision}).prospects[0];assert.equal(item.state,'rejected','any writer can reject');
  assert.equal(prospects(f).remove({id}).prospects.length,0);
}));
test('schema42 is additive and repeatable',coachRun(async f=>{
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'prospects-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeProspectSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,41);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,53);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));
