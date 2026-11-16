const assert=require('node:assert/strict'),{test}=require('node:test'),{createHash,randomBytes}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{Experts,partnerDirectory,expertAttention}=load('experts.ts'),{teamAlerts}=load('team-alerts.ts');
const {EXPERT_PART_BYTES}=load('experts-types.ts');
const DAY=86400000,iso=value=>new Date(value).toISOString(),plain=value=>JSON.parse(JSON.stringify(value));
// An agency (with the agency package), a client and an unrelated project, in memory. No network, no payment.
async function fixture(){
  const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);await repo.bootstrapLegacy('admin');
  const create=async name=>await repo.provision('legacy-admin',{organizationName:`${name} org`,projectName:name,website:`https://${name}.example`,username:name,password:'fixture-password-123'});
  const agency=await create('agency'),client=await create('client'),other=await create('other'),now=Date.now();
  for(const w of [agency,client,other])db.prepare("UPDATE platform_project_entitlements SET mode='trial',trial_owner_id=?,started_at=?,ends_at=? WHERE organization_id=? AND project_id=?").run(w.userId,iso(now),iso(now+14*DAY),w.organizationId,w.projectId);
  const scope=w=>({subject:w.userId,organizationId:w.organizationId,projectId:w.projectId});
  const grant=(starts=Date.now()-DAY,ends=Date.now()+29*DAY)=>{const id='RZLIVE'+randomBytes(16).toString('hex');
    db.prepare("INSERT INTO platform_billing_live_orders(id,organization_id,project_id,actor_id,idempotency_key,request_digest,merchant_revision,catalog_version,plan_id,cadence,amount_minor,state,terms_url,created_at,expires_at,updated_at,package) VALUES(?,?,?,?,?,'d','m','v','growth','monthly',29900,'paid','https://ryzevo.example/terms',?,?,?,'agency')").run(id,agency.organizationId,agency.projectId,agency.userId,id,iso(starts),iso(starts),iso(starts));
    db.prepare("INSERT INTO platform_project_subscriptions(order_id,organization_id,project_id,plan_id,cadence,starts_at,ends_at,grace_ends_at,created_at,package) VALUES(?,?,?,'growth','monthly',?,?,?,?,'agency')").run(id,agency.organizationId,agency.projectId,iso(starts),iso(ends),iso(ends+7*DAY),iso(starts));};
  // The agency's owner joins another project with the given role (to check rights there).
  const member=(w,role)=>db.prepare('INSERT INTO platform_memberships VALUES(?,?,?,?,1)').run(agency.userId,w.organizationId,w.projectId,role);
  return {db,repo,agency,client,other,scope,grant,member,home:new Experts(db,scope(agency)),buyer:new Experts(db,scope(client))};
}
const profile=(extra={})=>({displayName:'QA Studio',summary:'Ürün çekimi, kısa video ve banner setleri hazırlayan küçük bir ekip.',services:['design','photo'],languages:['tr','en'],website:'https://studio.example',contact:'hello@studio.example',listed:true,...extra});
const due=days=>iso(Date.now()+days*DAY).slice(0,10);
const brief=(partnerId,extra={})=>({partnerId,service:'photo',title:'Yeni koleksiyon çekimi',details:'Sonbahar koleksiyonu için beyaz fonda ürün çekimi istiyoruz.',deliverables:'10 adet 1080×1350 JPEG',dueDate:due(10),budgetNote:'',brand:'Marka: client',contact:'Ayşe · +90 555 000 00 00',shareAcknowledged:true,...extra});
const png=size=>{const bytes=randomBytes(size);Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(bytes);return bytes;};
// The browser's upload: start, parts, finish.
async function upload(service,requestId,bytes,mime='image/png',name='kapak.png'){
  const started=await service.startFile({id:requestId,name,mime,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  for(let part=0;part<started.parts;part++)await service.filePart(started.fileId,part,bytes.subarray(part*started.partBytes,Math.min(bytes.length,(part+1)*started.partBytes)));
  return {started,snapshot:await service.finishFile({id:requestId,fileId:started.fileId})};
}

test('experts: a listed agency gets a brief, delivers files in parts, the client asks for a change and approves',async()=>{
  const f=await fixture();f.grant();
  assert.deepEqual(plain(await partnerDirectory(f.db,f.scope(f.client))),[],'nobody is listed yet');
  await assert.rejects(f.buyer.saveProfile(profile()),error=>error.status===403,'only agency package projects are partners');
  await assert.rejects(f.home.saveProfile(profile({services:[]})),/hizmet/);
  await assert.rejects(f.home.saveProfile(profile({website:'http://studio.example'})),/https/);
  let home=await f.home.saveProfile(profile());assert.equal(home.partner.profile.listed,true);assert.equal(home.partner.running,true);
  let partners=plain(await partnerDirectory(f.db,f.scope(f.client)));assert.equal(partners.length,1);assert.equal(partners[0].id,f.agency.projectId);assert.equal(partners[0].contact,undefined,'the contact is not in the directory');
  assert.equal((await partnerDirectory(f.db,f.scope(f.client),'video')).length,0,'filtered by service');
  assert.equal((await partnerDirectory(f.db,f.scope(f.agency))).length,0,'an agency does not see itself');
  // The brief's brand part comes from the brand voice and the brand kit, and is the client's to edit.
  await f.repo.updateBrandVoice(f.client.userId,f.client.organizationId,f.client.projectId,'Samimi, kısa ve net.');
  f.db.prepare("INSERT INTO platform_brand_kits(organization_id,project_id,revision,kit_json,logo_data,logo_mime,updated_by,updated_at) VALUES(?,?,1,?,NULL,NULL,?,?)").run(f.client.organizationId,f.client.projectId,JSON.stringify({colors:{primary:'#112233',accent:'#baf331',dark:'#111111',light:'#ffffff'},font:'serif',handle:'clientco',tagline:'Her gün yeni'}),f.client.userId,iso(Date.now()));
  const draft=await f.buyer.briefDraft();assert.match(draft.brand,/Samimi, kısa ve net/);assert.match(draft.brand,/#112233/);assert.match(draft.brand,/@clientco/);assert.match(draft.brand,/Her gün yeni/);
  const id=f.agency.projectId;
  await assert.rejects(f.buyer.create(brief(id,{shareAcknowledged:false})),/paylaşılacağını/);
  await assert.rejects(f.buyer.create(brief(id,{dueDate:due(0)})),/Teslim tarihi/);
  await assert.rejects(f.buyer.create(brief(id,{service:'video'})),error=>error.status===409,'a service the partner does not offer');
  await assert.rejects(f.buyer.create(brief(id,{details:'x'.repeat(2001)})),/2000/,'too long is refused, not cut');
  f.member(f.client,'viewer');await assert.rejects(new Experts(f.db,{...f.scope(f.client),subject:f.agency.userId}).create(brief(id)),error=>error.status===403,'a viewer cannot send');
  let mine=await f.buyer.create(brief(id));let request=mine.client.requests[0];assert.equal(request.state,'sent');assert.equal(request.partnerName,'QA Studio');assert.equal(request.partnerContact,null,'the contact only after acceptance');
  home=await f.home.snapshot();assert.equal(home.partner.requests.length,1);assert.equal(home.partner.requests[0].clientName,'client · client org','project and organization when they differ');assert.equal(home.partner.requests[0].brief.contact,'Ayşe · +90 555 000 00 00');
  assert.equal(home.client.requests.length,0,'the agency’s own client list is separate');
  assert.equal((await expertAttention(f.db,f.scope(f.agency),true,true)).length,1,'a new request waits for the partner');
  const alerts=await teamAlerts(f.db,f.scope(f.agency));assert.ok(alerts.some(alert=>alert.kind==='expert_request'&&alert.count===1&&alert.href==='/?tab=project&settings=experts'));
  assert.equal((await new Experts(f.db,f.scope(f.other)).snapshot()).client.requests.length,0,'other projects see nothing');
  // Files cannot be added before acceptance.
  await assert.rejects(f.home.startFile({id:request.id,name:'a.png',mime:'image/png',bytes:10,sha256:'0'.repeat(64)}),error=>error.status===409);
  home=await f.home.decide({id:request.id,decision:'accept'});assert.equal(home.partner.requests[0].state,'accepted');
  mine=await f.buyer.snapshot();assert.equal(mine.client.requests[0].partnerContact,'hello@studio.example');
  await assert.rejects(f.home.decide({id:request.id,decision:'accept'}),error=>error.status===409,'decided once');
  // A file larger than one part goes up in parts and is checked as a whole.
  const big=png(EXPERT_PART_BYTES+1000);
  const {started,snapshot}=await upload(f.home,request.id,big);assert.equal(started.parts,2);assert.equal(snapshot.partner.requests[0].files.length,1);assert.equal(snapshot.partner.requests[0].files[0].submitted,false);
  const wrong=await f.home.startFile({id:request.id,name:'b.png',mime:'image/png',bytes:big.length,sha256:createHash('sha256').update(big).digest('hex')});
  await assert.rejects(f.home.filePart(wrong.fileId,0,big.subarray(0,100)),/boyutu/,'each part has its exact size');
  await assert.rejects(f.home.finishFile({id:request.id,fileId:wrong.fileId}),/eksik veya bozuk/,'missing parts');
  await assert.rejects(upload(f.home,request.id,png(2000),'application/pdf','fake.pdf'),/eksik veya bozuk/,'the declared type must match the bytes');
  await assert.rejects(f.home.startFile({id:request.id,name:'x.gif',mime:'image/gif',bytes:10,sha256:'0'.repeat(64)}),/PNG, JPEG, WebP veya PDF/);
  await assert.rejects(f.home.startFile({id:request.id,name:'x.png',mime:'image/png',bytes:7*1024*1024,sha256:'0'.repeat(64)}),/6 MB/);
  assert.equal((await f.buyer.snapshot()).client.requests[0].files.length,0,'the client sees nothing before delivery');
  const fileId=snapshot.partner.requests[0].files[0].id;
  await assert.rejects(f.buyer.file(request.id,fileId),error=>error.status===404);
  home=await f.home.deliver({id:request.id,note:'İlk tur hazır.'});assert.equal(home.partner.requests[0].state,'delivered');
  mine=await f.buyer.snapshot();request=mine.client.requests[0];assert.equal(request.files.length,1);assert.equal(request.notes[0].text,'İlk tur hazır.');
  const got=await f.buyer.file(request.id,fileId);assert.equal(got.mime,'image/png');assert.ok(Buffer.from(got.data).equals(big),'the same bytes come back');
  await assert.rejects(new Experts(f.db,f.scope(f.other)).file(request.id,fileId),error=>error.status===404);
  assert.equal((await expertAttention(f.db,f.scope(f.client),false,true)).length,1,'the delivery waits for the client');
  // A change request, a second round, then approval.
  await assert.rejects(f.buyer.review({id:request.id,decision:'revision',note:'x'}),/5–1000/);
  mine=await f.buyer.review({id:request.id,decision:'revision',note:'Arka plan daha açık olsun.'});assert.equal(mine.client.requests[0].state,'revision');assert.equal(mine.client.requests[0].revisions,1);
  await assert.rejects(f.home.deliver({id:request.id}),/en az bir dosya/,'a new round needs a new file');
  await upload(f.home,request.id,png(3000),'image/png','ikinci.png');home=await f.home.deliver({id:request.id});
  assert.deepEqual(home.partner.requests[0].files.map(file=>file.round),[1,2]);
  mine=await f.buyer.review({id:request.id,decision:'approve'});assert.equal(mine.client.requests[0].state,'approved');
  await assert.rejects(f.buyer.review({id:request.id,decision:'approve'}),error=>error.status===409);
  await assert.rejects(f.home.removeFile({id:request.id,fileId}),/silinemez/,'delivered files stay');
  const operations=f.db.prepare("SELECT operation FROM platform_audit WHERE operation LIKE 'experts.%' ORDER BY rowid").all().map(row=>row.operation);
  for(const operation of ['experts.profile.list','experts.request.send','experts.request.receive','experts.request.accept','experts.delivery.submit','experts.delivery.revision','experts.delivery.approve'])assert.ok(operations.includes(operation),operation);
});

test('experts: declining, cancelling, the open-request limit and an ended package',async()=>{
  const f=await fixture();f.grant();await f.home.saveProfile(profile());const id=f.agency.projectId;
  let mine=await f.buyer.create(brief(id));const first=mine.client.requests[0].id;
  const home=await f.home.decide({id:first,decision:'decline',note:'Bu ay dolu takvimimiz var.'});assert.equal(home.partner.requests[0].state,'declined');
  mine=await f.buyer.snapshot();assert.equal(mine.client.requests[0].notes[0].kind,'decline');assert.equal(mine.client.requests[0].partnerContact,null);
  mine=await f.buyer.create(brief(id,{title:'İkinci iş'}));const second=mine.client.requests.find(item=>item.brief.title==='İkinci iş').id;
  mine=await f.buyer.cancel({id:second});assert.equal(mine.client.requests.find(item=>item.id===second).state,'cancelled');
  await assert.rejects(f.home.decide({id:second,decision:'accept'}),error=>error.status===409,'a cancelled request cannot be accepted');
  for(let n=0;n<10;n++)await f.buyer.create(brief(id,{title:`İş ${n}`}));
  await assert.rejects(f.buyer.create(brief(id,{title:'Fazla'})),error=>error.status===429);
  // The package ends: not listed, no new work, no new acceptance.
  f.db.prepare("UPDATE platform_project_subscriptions SET starts_at=?,ends_at=? WHERE project_id=?").run(iso(Date.now()-40*DAY),iso(Date.now()-DAY),f.agency.projectId);
  assert.equal((await partnerDirectory(f.db,f.scope(f.client))).length,0);
  const waiting=(await f.home.snapshot()).partner.requests.find(item=>item.state==='sent');
  await assert.rejects(f.home.decide({id:waiting.id,decision:'accept'}),/etkin değil/);
  await assert.rejects(f.home.saveProfile(profile()),/etkin/,'cannot be listed without a running package');
  assert.equal((await f.home.saveProfile(profile({listed:false}))).partner.profile.listed,false);
});
