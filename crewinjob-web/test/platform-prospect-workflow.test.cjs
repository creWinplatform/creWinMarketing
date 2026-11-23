const assert=require('node:assert/strict'),{test}=require('node:test');
const {load}=require('./platform-loader.cjs'),{coachRun,plain}=require('./coach-fixture.cjs');
const {ProspectBooking,ProspectProposals,bookingSlots,publicBooking,bookMeeting,openProposal}=load('prospect-workflow.ts');
const {ProspectOutreach,autoAssignProspect,pruneStaleProspects,suppressProspectHost,prospectSuppressed}=load('prospect-outreach.ts');
const {ProjectProspects}=load('prospects.ts');
const KEY='56'.repeat(32);
const withOrigin=fn=>coachRun(async f=>{const saved=process.env.PLATFORM_PUBLIC_ORIGIN;process.env.PLATFORM_PUBLIC_ORIGIN='https://ryzevo.example';try{await fn(f);}finally{if(saved===undefined)delete process.env.PLATFORM_PUBLIC_ORIGIN;else process.env.PLATFORM_PUBLIC_ORIGIN=saved;}});
// An approved company with a checked page, written straight into the fixture database.
const approved=(f,company,website,sector='Diş')=>{const id=`prospect_${company.replace(/\W/g,'')}`,now=new Date().toISOString();
  f.db.prepare("INSERT INTO platform_prospects(id,organization_id,project_id,company,website,sector,country,reason,contact_role,check_status,source_url,reason_source,state,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,'','Strong fit','','ok',?,'human','approved',?,?,?)").run(id,f.a.organizationId,f.a.projectId,company,website,sector,website,f.scope.subject,now,now);return id;};

test('free times follow the weekdays, hours, length and notice in the project time zone',()=>{
  const settings={enabled:true,title:'Tanışma',durationMin:30,weekdays:[1,2,3,4,5],startHour:10,endHour:12,noticeHours:1,horizonDays:3};
  const now=Date.parse('2026-11-20T06:00:00Z'),slots=bookingSlots(settings,'Europe/Istanbul',new Set(['2026-11-23T07:30:00.000Z']),now);
  assert.deepEqual(plain(slots),['2026-11-20T07:00:00.000Z','2026-11-20T07:30:00.000Z','2026-11-20T08:00:00.000Z','2026-11-20T08:30:00.000Z','2026-11-23T07:00:00.000Z','2026-11-23T08:00:00.000Z','2026-11-23T08:30:00.000Z'],'Friday after the notice, no weekend, Monday without the taken slot');
});

test('the booking page: settings by an approver, a booking makes a task and moves a known company to meeting',withOrigin(async f=>{
  const booking=new ProspectBooking(f.db,f.scope,KEY),editor=await f.member('editor');
  await assert.rejects(new ProspectBooking(f.db,editor,KEY).save({enabled:true,durationMin:30,weekdays:[1],startHour:10,endHour:12,noticeHours:1,horizonDays:7}),e=>e.status===403);
  await assert.rejects(booking.save({enabled:true,durationMin:25,weekdays:[1],startHour:10,endHour:12,noticeHours:1,horizonDays:7}),e=>e.status===400);
  let snap=plain(await booking.save({enabled:true,title:'Tanışma',durationMin:30,weekdays:[0,1,2,3,4,5,6],startHour:6,endHour:23,noticeHours:1,horizonDays:7}));
  const key=/#k=(rzb_[A-Za-z0-9_-]{24})$/.exec(snap.link)[1];assert.ok(snap.link.startsWith('https://ryzevo.example/randevu#k='));
  const page=plain(await publicBooking(f.db,key));assert.equal(page.title,'Tanışma');assert.ok(page.slots.length>10);assert.equal(await publicBooking(f.db,'rzb_'+'x'.repeat(24)),null);
  const id=approved(f,'Gülüş','https://gulus.example');
  await assert.rejects(bookMeeting(f.db,key,{start:page.slots[0],name:'Ayşe',email:'ayse@gulus.example'},KEY),e=>e.status===400,'the notice must be accepted');
  await assert.rejects(bookMeeting(f.db,key,{start:'2020-01-01T00:00:00.000Z',name:'Ayşe',email:'ayse@gulus.example',consent:true},KEY),e=>e.status===409);
  const done=plain(await bookMeeting(f.db,key,{start:page.slots[0],name:'Ayşe Kaya',email:'Ayse@Gulus.example',company:'Gülüş',note:'Randevu sistemi',consent:true},KEY));assert.equal(done.startsAt,page.slots[0]);
  await assert.rejects(bookMeeting(f.db,key,{start:page.slots[0],name:'Başka',email:'b@c.example',consent:true},KEY),e=>e.status===409,'the slot is taken');
  assert.ok(!plain(await publicBooking(f.db,key)).slots.includes(page.slots[0]));
  assert.equal(f.db.prepare('SELECT stage FROM platform_prospect_pipeline WHERE prospect_id=?').get(id).stage,'meeting');
  assert.ok(f.db.prepare("SELECT 1 FROM platform_work_items WHERE organization_id=? AND project_id=? AND title LIKE 'Görüşme: Gülüş%'").get(f.a.organizationId,f.a.projectId));
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_bookings').all()).includes('Ayşe'),'contact details are stored encrypted');
  snap=plain(await booking.read());assert.equal(snap.upcoming[0].email,'ayse@gulus.example');assert.equal(snap.upcoming[0].prospectId,id);
  snap=plain(await new ProspectBooking(f.db,editor,KEY).cancel({id:snap.upcoming[0].id}));assert.equal(snap.upcoming[0].state,'cancelled');
  assert.ok(plain(await publicBooking(f.db,key)).slots.includes(page.slots[0]),'a cancelled time is free again');
  // The booking page is the meeting link of sales emails when no other link is set.
  assert.equal(plain(await new ProspectOutreach(f.db,f.scope,KEY).read()).settings.bookingUrl,snap.link);
  await booking.save({enabled:false,durationMin:30,weekdays:[1],startHour:10,endHour:12,noticeHours:1,horizonDays:7});assert.equal(await publicBooking(f.db,key),null);
}));

test('proposals: drafted from the brief and findings, edited, shared through a link that moves the stage',withOrigin(async f=>{
  const proposals=new ProspectProposals(f.db,f.scope),id=approved(f,'Moda','https://moda.example'),reserved=()=>f.db.prepare("SELECT COUNT(*) n FROM platform_usage_reservations WHERE status='reserved'").get().n;
  await assert.rejects(proposals.share({id},'https://ryzevo.example'),e=>e.status===404);
  await assert.rejects(proposals.draft({id,price:'20.000 TL'},async()=>JSON.stringify({title:'T',summary:'S',solution:'Bakın https://x.example',needs:[],scope:[]})),e=>e.status===422);assert.equal(reserved(),0);
  let view=plain(await proposals.draft({id,price:'20.000 TL + KDV',notes:'Online randevu istiyorlar'},async prompt=>{assert.ok(prompt.includes('Online randevu istiyorlar'));assert.ok(!prompt.includes('20.000'),'the price never goes to the AI');return JSON.stringify({title:'Online randevu kurulumu',summary:'Kısa özet.',needs:['Online randevu'],solution:'Kurulum ve eğitim.',scope:['Kurulum','Eğitim'],timeline:'2 hafta',nextStep:'Başlangıç görüşmesi'});})).proposal;
  assert.equal(view.source,'ai');assert.equal(view.content.price,'20.000 TL + KDV');
  await assert.rejects(proposals.save({id,expectedRevision:view.revision,content:{...view.content,summary:'Yüzde 50 % garanti'}}),e=>e.status===400);
  await assert.rejects(proposals.save({id,expectedRevision:view.revision-1,content:view.content}),e=>e.status===409);
  view=plain(await proposals.save({id,expectedRevision:view.revision,content:{...view.content,timeline:'3 hafta'}})).proposal;assert.equal(view.source,'human');
  const shared=plain(await proposals.share({id},'https://ryzevo.example')),token=/#token=([A-Za-z0-9_-]{43})$/.exec(shared.url)[1];
  assert.equal(f.db.prepare('SELECT stage FROM platform_prospect_pipeline WHERE prospect_id=?').get(id).stage,'proposal');
  const open=plain(await openProposal(f.db,token));assert.equal(open.company,'Moda');assert.equal(open.content.timeline,'3 hafta');
  await openProposal(f.db,token,true);assert.equal(plain(await proposals.read({id})).proposal.shared.views,1,'a preview is not counted');
  const again=/#token=([A-Za-z0-9_-]{43})$/.exec(plain(await proposals.share({id},'https://ryzevo.example')).url)[1];assert.equal(await openProposal(f.db,token),null,'a new link closes the old one');
  await proposals.revoke({id});assert.equal(await openProposal(f.db,again),null);
  assert.equal(plain(await new ProspectProposals(f.db,f.other).read({id}).catch(e=>({status:e.status}))).status,404);
}));

test('team sharing, the organisation-wide never-contact list and the data-keeping rule',coachRun(async f=>{
  const outreach=new ProspectOutreach(f.db,f.scope,KEY),editor=await f.member('editor'),viewer=await f.member('viewer');
  const members=plain(await outreach.members()).map(item=>item.id);assert.ok(members.includes(editor.subject));assert.ok(!members.includes(viewer.subject),'viewers cannot follow companies');
  await outreach.saveSettings({followUpDays:[3,7],assignMode:'by_sector',assignRules:[{sector:'diş',userId:editor.subject},{sector:'x',userId:'stranger'}]});
  assert.deepEqual(plain(await outreach.read()).settings.assignRules,[{sector:'diş',userId:editor.subject}],'unknown people are dropped');
  const dental=approved(f,'Diş Bir','https://dis1.example','Diş kliniği'),cafe=approved(f,'Kafe','https://kafe.example','Kafe');
  assert.equal(await autoAssignProspect(f.db,f.scope,dental),editor.subject);
  const first=await autoAssignProspect(f.db,f.scope,cafe);assert.ok(members.includes(first),'no rule: in turn');
  await assert.rejects(outreach.assign({id:dental,userId:viewer.subject}),e=>e.status===400);
  assert.equal(plain(await outreach.assign({id:dental,userId:null})).pipeline[dental].assignedTo,null);
  // Approving through the prospect list assigns too.
  const prospects=new ProjectProspects(f.db,f.scope),now=new Date().toISOString();
  f.db.prepare("INSERT INTO platform_prospects(id,organization_id,project_id,company,website,sector,reason,check_status,source_url,state,created_by,created_at,updated_at) VALUES('prospect_new',?,?,'Diş İki','https://dis2.example','Diş','Strong fit','ok','https://dis2.example','candidate',?,?,?)").run(f.a.organizationId,f.a.projectId,f.scope.subject,now,now);
  await prospects.decide({id:'prospect_new',decision:'approve',expectedRevision:1});assert.equal(f.db.prepare("SELECT assigned_to FROM platform_prospect_pipeline WHERE prospect_id='prospect_new'").get().assigned_to,editor.subject);
  // The never-contact list covers the organisation unless the project limits it to itself.
  await suppressProspectHost(f.db,f.scope,'https://www.yasak.example','unsubscribe');
  assert.equal(await prospectSuppressed(f.db,f.scope,'https://yasak.example/x'),true);
  assert.equal(await prospectSuppressed(f.db,{organizationId:f.a.organizationId,projectId:'another-project'},'https://yasak.example'),true,'another project of the organisation');
  assert.equal(await prospectSuppressed(f.db,f.other,'https://yasak.example'),false,'never another organisation');
  await outreach.saveSettings({followUpDays:[3,7],orgWide:false});assert.equal(await prospectSuppressed(f.db,f.scope,'https://yasak.example'),true,'its own list still applies');
  // Data keeping: untouched candidates and rejected companies go after the chosen months; approved ones stay.
  const old=new Date(Date.now()-200*86400000).toISOString();
  for(const [id,state] of [['prospect_old1','candidate'],['prospect_old2','rejected'],['prospect_old3','approved']])f.db.prepare("INSERT INTO platform_prospects(id,organization_id,project_id,company,website,state,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(id,f.a.organizationId,f.a.projectId,id,`https://${id}.example`,state,f.scope.subject,old,old);
  assert.equal(await pruneStaleProspects(f.db),0,'off by default');
  await assert.rejects(outreach.saveSettings({followUpDays:[3,7],retentionMonths:5}),e=>e.status===400);
  await outreach.saveSettings({followUpDays:[3,7],retentionMonths:6});assert.equal(await pruneStaleProspects(f.db),2);
  assert.deepEqual(f.db.prepare("SELECT id FROM platform_prospects WHERE id LIKE 'prospect_old%'").all().map(row=>row.id),['prospect_old3']);
}));
