const assert=require('node:assert/strict'),{test}=require('node:test'),{createHmac}=require('node:crypto');
const {load}=require('./platform-loader.cjs'),{coachRun,plain}=require('./coach-fixture.cjs');
const {ProjectProspects}=load('prospects.ts'),{ProspectFinder}=load('prospect-finder.ts');
const {ProspectOutreach,salesAttention}=load('prospect-outreach.ts');
const {ManagedSending,ManagedOperator,managedSender}=load('managed-sending.ts');
const {replyAddress,readReplyAddress}=load('sending-providers.ts');
const {receiveInboundReply,processInboundReplies,parseMime,newReplyText,verifyInboundSignature,inboundFromJson,receiveManagedSesNotification}=load('outreach-inbound.ts');
const KEY='7a'.repeat(32);
const page=(name,email)=>`<html><head><title>${name}</title></head><body><h1>${name}</h1><p>${email}</p><footer>© 2018 ${name}</footer></body></html>`;
const SITES={'https://gulus.example':page('Gülüş Diş','info@gulus.example'),'https://moda.example':page('Moda Klinik','iletisim@moda.example'),'https://kent.example':page('Kent Ofis','bilgi@kent.example')};
const sites=async url=>{const key=url.replace(/\/$/,'');if(!SITES[key])throw new Error('unreachable');return {finalUrl:`${key}/`,html:SITES[key]};};
const ENV=['PLATFORM_PUBLIC_ORIGIN','PLATFORM_PROSPECT_EMAIL_ENABLED','PLATFORM_MANAGED_SENDING_ENABLED','PLATFORM_MANAGED_PRICE_USD','PLATFORM_MANAGED_FOLLOWUPS_CHARGED','PLATFORM_MANAGED_SES_TOPIC_ARN','PLATFORM_MANAGED_INBOUND_SECRET'];
// A test provider that records what would go out; state decides the provider's answer.
const provider=()=>{const p={id:'test',sent:[],state:'accepted',send:async(mail,before)=>{if(!await before())return {state:'blocked',providerMessageId:null};p.sent.push(mail);return {state:p.state,providerMessageId:p.state==='accepted'?`m-${p.sent.length}`:null};},checkDomain:async()=>({verified:true,detail:'ok'})};return p;};
const run=fn=>coachRun(async f=>{
  const saved=Object.fromEntries(ENV.map(key=>[key,process.env[key]]));
  process.env.PLATFORM_PUBLIC_ORIGIN='https://ryzevo.example';process.env.PLATFORM_PROSPECT_EMAIL_ENABLED='1';process.env.PLATFORM_MANAGED_SENDING_ENABLED='1';process.env.PLATFORM_MANAGED_PRICE_USD='0.04';delete process.env.PLATFORM_MANAGED_FOLLOWUPS_CHARGED;
  try{
    const prospects=new ProjectProspects(f.db,f.scope,async()=>{throw new Error('not used');}),finder=new ProspectFinder(f.db,f.scope,async()=>{throw new Error('no network');},sites);
    f.prospect=async(company,website)=>{const item=(await prospects.add({company,website})).prospects.find(p=>p.website===website);await finder.scan({id:item.id});
      const fresh=(await prospects.read()).prospects.find(p=>p.id===item.id);await prospects.update({id:item.id,reason:'Strong fit: books by phone only.',contactRole:'Manager',sector:'Dental',country:'TR',expectedRevision:fresh.revision});
      const again=(await prospects.read()).prospects.find(p=>p.id===item.id);await prospects.decide({id:item.id,decision:'approve',expectedRevision:again.revision});return item.id;};
    f.provider=provider();f.sales=(deps={})=>new ProspectOutreach(f.db,f.scope,KEY,{anyTime:true,managed:f.provider,deliver:async()=>{throw new Error('the own sender must never be used by a pilot');},...deps});
    f.operator=new ManagedOperator(f.db,'legacy-admin',f.provider);f.customer=(scope=f.scope)=>new ManagedSending(f.db,scope,KEY,f.provider);
    f.start=async id=>{const draft=plain(await f.sales().draft({id,mode:'template'})).outreach[id];return plain(await f.sales().approve({id,expectedRevision:draft.revision,acknowledged:true},'https://ryzevo.example')).outreach[id];};
    f.pilot=async()=>{const project={organizationId:f.a.organizationId,projectId:f.a.projectId};
      await f.operator.savePilot({...project,companyName:'Alpha Yazılım A.Ş.',dailyCap:20,verified:true});
      await f.operator.addDomain({domain:'alpha-mail.example',fromLocal:'ayse',fromName:'Ayşe · Alpha',registrant:'customer',renewsOn:'2027-11-27'});
      const id=plain(await f.operator.read()).domains[0].id;await f.operator.assignDomain({...project,domainId:id});await f.operator.checkDomain({domainId:id});
      await f.operator.grant({...project,amount:3,note:'pilot'});
      return id;};
    await fn(f);
  }finally{for(const key of ENV)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
});

test('reading a reply: MIME parts, encoded headers, only the new text; signed JSON from any provider',()=>{
  const raw=['From: =?UTF-8?B?QXnFn2UgS2F5YQ==?= <ayse@gulus.example>','To: r-x@alpha-mail.example','Subject: =?UTF-8?Q?Ynt:_G=C3=BCl=C3=BC=C5=9F_i=C3=A7in?=','Message-ID: <abc@gulus.example>','In-Reply-To: <osend_11111111-1111-1111-1111-111111111111@alpha-mail.example>','Content-Type: multipart/alternative; boundary="b1"','','--b1','Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: quoted-printable','','Merhaba, g=C3=B6r=C3=BC=C5=9Fmek isteriz.','','On Mon, 1 Dec 2026 Ayse wrote:','> eski metin','--b1','Content-Type: text/html; charset=utf-8','','<p>Merhaba</p>','--b1--',''].join('\r\n');
  const mail=plain(parseMime(raw));
  assert.equal(mail.from,'ayse@gulus.example');assert.equal(mail.subject,'Ynt: Gülüş için');assert.equal(mail.text,'Merhaba, görüşmek isteriz.');assert.deepEqual(mail.to,['r-x@alpha-mail.example']);
  assert.match(mail.headers['in-reply-to'],/osend_/);
  assert.equal(newReplyText('Tamam.\n\n12 Ara 2026 tarihinde Ali yazdı:\n> önceki'),'Tamam.');
  const body=JSON.stringify({to:['R-X@a.example'],from:'A@B.example',subject:'s',text:'t',headers:{'Auto-Submitted':'auto-replied'}}),secret='s'.repeat(40),now=Date.now(),ts=String(Math.floor(now/1000));
  const sig=`sha256=${createHmac('sha256',secret).update(`${ts}.${body}`).digest('hex')}`;
  assert.equal(verifyInboundSignature(body,ts,sig,secret,now),true);assert.equal(verifyInboundSignature(body+' ',ts,sig,secret,now),false);
  assert.equal(verifyInboundSignature(body,String(Math.floor(now/1000)-900),sig,secret,now),false,'too old');assert.equal(verifyInboundSignature(body,ts,sig,'short',now),false,'no secret, no entry');
  assert.deepEqual(plain(inboundFromJson(JSON.parse(body))).headers,{'auto-submitted':'auto-replied'});
  // Reply addresses carry a check; a made-up one matches nothing.
  const id='outreach_12345678-1234-1234-1234-123456789abc',address=replyAddress(KEY,id,'alpha-mail.example');
  assert.equal(readReplyAddress(KEY,address),id);assert.equal(readReplyAddress(KEY,address.replace(/\.[a-f0-9]{12}@/,'.000000000000@')),null);assert.equal(readReplyAddress('7b'.repeat(32),address),null);
});

test('the operator opens a pilot; the owner approves; emails go through the provider from the company’s own domain and use credits',run(async f=>{
  const id=await f.prospect('Gülüş Diş','https://gulus.example');
  assert.equal(await managedSender(f.db,f.scope,f.provider),null,'not a pilot: sends as before');
  assert.equal(plain(await f.customer().read()).waiting,'not_pilot');
  const project={organizationId:f.a.organizationId,projectId:f.a.projectId};
  await assert.rejects(f.operator.savePilot({...project,companyName:'Alpha'}),e=>e.status===400,'a person verifies the company first');
  await assert.rejects(f.operator.addDomain({domain:'nope',fromLocal:'ayse'}),e=>e.status===400);
  const domainId=await f.pilot();
  await assert.rejects(f.operator.addDomain({domain:'alpha-mail.example',fromLocal:'x'}),e=>e.status===409);
  let view=plain(await f.customer().read());
  assert.equal(view.waiting,'not_approved');assert.deepEqual(view.stages.map(s=>[s.key,s.state]),[['prepare','current'],['sender','todo'],['sending','todo'],['capacity','todo']]);
  assert.equal(view.domain.fromAddress,'ayse@alpha-mail.example');assert.equal(view.credits.balance,3);
  // Only the owner gives the company's authority, with the current text.
  const editor=await f.member('editor');
  await assert.rejects(f.customer(editor).approve({domainId,accepted:true,version:view.terms.version}),e=>e.status===403);
  await assert.rejects(f.customer().approve({domainId,accepted:true,version:'old'}),e=>e.status===400);
  let snap=plain(await f.sales().read());assert.equal(snap.readiness.managed.waiting,'not_approved');
  const draft=plain(await f.sales().draft({id,mode:'template'})).outreach[id];
  await assert.rejects(f.sales().approve({id,expectedRevision:draft.revision,acknowledged:true},'https://ryzevo.example'),e=>e.status===409&&/Yönetimli/.test(e.message));
  view=plain(await f.customer().approve({domainId,accepted:true,version:view.terms.version}));assert.equal(view.ready,true);
  assert.deepEqual(view.stages.map(s=>s.state),['done','done','current','todo']);
  // The first email: from the company's domain, a reply address of this sequence, the company as sender, one credit.
  await f.sales().approve({id,expectedRevision:draft.revision,acknowledged:true},'https://ryzevo.example');
  assert.equal(f.provider.sent.length,1);const mail=f.provider.sent[0];
  assert.equal(mail.from.address,'ayse@alpha-mail.example');assert.equal(mail.from.name,'Ayşe · Alpha');assert.equal(readReplyAddress(KEY,mail.replyTo),f.db.prepare('SELECT id FROM platform_prospect_outreach WHERE prospect_id=?').get(id).id);
  assert.match(mail.text,/Alpha Yazılım A\.Ş\./);assert.equal(mail.headers['X-SES-CONFIGURATION-SET'],undefined);assert.equal(mail.tenant,f.a.projectId);assert.match(mail.messageId,/@alpha-mail\.example>$/);
  view=plain(await f.customer().read());assert.equal(view.credits.balance,2);assert.equal(view.results.sent,1);assert.deepEqual(view.stages.map(s=>s.state),['done','done','done','current']);
  snap=plain(await f.sales().read());assert.equal(snap.readiness.dailyLimit,10);assert.equal(snap.readiness.salesDomain,null);
  // A provider refusal gives the credit back; with no credits left nothing goes.
  const second=await f.prospect('Moda Klinik','https://moda.example');f.provider.state='rejected';
  await f.start(second);assert.equal(plain(await f.customer().read()).credits.balance,2,'refunded');
  f.provider.state='accepted';await f.operator.grant({...project,amount:-2,kind:'adjust',note:'test'});
  const third=await f.prospect('Kent Ofis','https://kent.example'),draft3=plain(await f.sales().draft({id:third,mode:'template'})).outreach[third];
  await assert.rejects(f.sales().approve({id:third,expectedRevision:draft3.revision,acknowledged:true},'https://ryzevo.example'),e=>e.status===409&&/kredi/.test(e.message));
  // Releasing the domain stops sending; a pilot never falls back to its own sender.
  await f.operator.grant({...project,amount:5});
  const released=plain(await f.operator.releaseDomain({domainId}));assert.equal(released.domains[0].state,'released');
  snap=plain(await f.sales().read());assert.equal(snap.readiness.managed.waiting,'no_domain');assert.equal(snap.readiness.paused.reason,'sender_changed');
  await assert.rejects(f.operator.assignDomain({...project,domainId}),e=>e.status===409,'a released domain is never reused');
  // Pilot limits and stopping.
  await assert.rejects(f.operator.setPilotState({...project,state:'suspended'}),e=>e.status===400,'a reason');
  assert.equal(plain(await f.operator.setPilotState({...project,state:'suspended',reason:'complaint review'})).pilots[0].state,'suspended');
  assert.equal(plain(await f.customer().read()).waiting,'suspended');
}));

test('replies: matched by reply address or reference, follow-ups stop, sorted by rules or AI, passed on, kept encrypted',run(async f=>{
  const domainId=await f.pilot();await f.customer().approve({domainId,accepted:true,version:'2026-11-v1'});await f.operator.grant({organizationId:f.a.organizationId,projectId:f.a.projectId,amount:10});
  const gulus=await f.prospect('Gülüş Diş','https://gulus.example'),moda=await f.prospect('Moda Klinik','https://moda.example'),kent=await f.prospect('Kent Ofis','https://kent.example');
  for(const id of [gulus,moda,kent])await f.start(id);
  const mailOf=id=>f.provider.sent.find(item=>item.to===f.db.prepare('SELECT value FROM platform_prospect_contacts WHERE prospect_id=?').get(id).value);
  // Nothing matches a stranger.
  assert.deepEqual(plain(await receiveInboundReply(f.db,KEY,{to:['someone@alpha-mail.example'],from:'x@y.example',subject:'hi',text:'hi',headers:{},messageId:'<1@y>'})),{matched:false});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_outreach_inbound').get().n,0);
  // A real answer through the reply address: the sequence stops at once and waits for its kind.
  const first=mailOf(gulus),answer={to:[first.replyTo],from:'info@gulus.example',subject:`Ynt: ${first.subject}`,text:'Merhaba, fiyatınızı öğrenebilir miyiz? Gizli: 0532',headers:{},messageId:'<r1@gulus.example>'};
  let result=plain(await receiveInboundReply(f.db,KEY,answer));assert.equal(result.matched,true);assert.equal(result.kind,null);
  assert.equal(plain(await receiveInboundReply(f.db,KEY,answer)).duplicate,true);
  let snap=plain(await f.sales().read());assert.equal(snap.outreach[gulus].state,'replied');assert.equal(snap.outreach[gulus].nextDueAt,null);assert.equal(snap.pipeline[gulus].stage,'replied');
  assert.equal(snap.inbound[gulus][0].text,answer.text);assert.equal(snap.inbound[gulus][0].matched,'address');
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_outreach_inbound').all()).includes('fiyatınızı'),'kept encrypted');
  assert.deepEqual(plain(await salesAttention(f.db,f.scope)).inbound.map(item=>item.prospect_id),[gulus]);
  // An automatic reply quoting our message id only moves the next email by a week.
  const before=f.db.prepare('SELECT next_due_at FROM platform_prospect_outreach WHERE prospect_id=?').get(moda).next_due_at,messageId=mailOf(moda).messageId;
  result=plain(await receiveInboundReply(f.db,KEY,{to:['ayse@alpha-mail.example'],from:'iletisim@moda.example',subject:'Otomatik yanıt: izindeyim',text:'5 Aralık’a kadar izindeyim.',headers:{'in-reply-to':messageId,'auto-submitted':'auto-replied'},messageId:'<r2@moda.example>'}));
  assert.equal(result.kind,'auto_reply');snap=plain(await f.sales().read());assert.equal(snap.outreach[moda].state,'active');assert.ok(Date.parse(snap.outreach[moda].nextDueAt)>Date.parse(before));
  // "Remove me" blocks the address and the company.
  result=plain(await receiveInboundReply(f.db,KEY,{to:[mailOf(kent).replyTo],from:'bilgi@kent.example',subject:'Re',text:'Lütfen listeden çıkarın.',headers:{},messageId:'<r3@kent.example>'}));
  assert.equal(result.kind,'not_interested');snap=plain(await f.sales().read());assert.equal(snap.pipeline[kent].stage,'lost');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_prospect_suppressions WHERE host='kent.example'").get().n,1);
  // The worker sorts the open one with AI and passes every reply on to the person who approved the domain.
  f.db.prepare("INSERT INTO platform_account_emails(user_id,email,verified_at) VALUES(?,?,?)").run(f.a.userId,"owner@alpha.example",new Date().toISOString());
  const delivered=[],configuration={origin:'https://ryzevo.example',region:'eu-west-1',from:'no-reply@ryzevo.example',accessKeyId:'x',secretAccessKey:'y',revision:'r'};
  const done=await processInboundReplies(f.db,KEY,async prompt=>{assert.match(prompt,/fiyatınızı/);return JSON.stringify({kind:'interested',summary:'Fiyat soruyor.',draft:'Merhaba, kısa bir görüşmede anlatalım.'});},async mail=>{delivered.push(mail);},configuration);
  assert.equal(done,3);assert.equal(delivered.length,3);assert.equal(delivered[0].to,'owner@alpha.example');assert.match(delivered[0].text,/info@gulus\.example/);
  snap=plain(await f.sales().read());assert.equal(snap.outreach[gulus].reply.kind,'interested');
  assert.deepEqual(plain(await salesAttention(f.db,f.scope)).inbound,[]);
  assert.equal(plain(await f.customer().read()).results.interested,1);
  assert.equal(await processInboundReplies(f.db,KEY,undefined,async()=>{},configuration),0,'each reply once');
}));

test('Amazon SES notifications of the managed service: a received reply and a bounce',run(async f=>{
  const domainId=await f.pilot();await f.customer().approve({domainId,accepted:true,version:'2026-11-v1'});
  const id=await f.prospect('Gülüş Diş','https://gulus.example');await f.start(id);
  const mail=f.provider.sent[0],topic='arn:aws:sns:eu-west-1:123456789012:ryzevo-managed';
  await assert.rejects(receiveManagedSesNotification(f.db,KEY,{}),e=>e.status===404,'not configured');
  process.env.PLATFORM_MANAGED_SES_TOPIC_ARN=topic;
  const validate=async(raw,arn,_load,max)=>{assert.equal(arn,topic);assert.equal(max,200000);return raw;};
  const content=[`From: info@gulus.example`,`To: ${mail.replyTo}`,'Subject: Ynt','Message-ID: <ses1@gulus.example>','Content-Type: text/plain; charset=utf-8','','Görüşelim.'].join('\r\n');
  let result=plain(await receiveManagedSesNotification(f.db,KEY,{Type:'Notification',Message:JSON.stringify({notificationType:'Received',mail:{destination:[mail.replyTo]},receipt:{action:{type:'SNS',encoding:'UTF8'},spamVerdict:{status:'PASS'},virusVerdict:{status:'PASS'}},content})},validate));
  assert.equal(result.matched,true);assert.equal(plain(await f.sales().read()).outreach[id].state,'replied');
  const send=f.db.prepare('SELECT id,provider_message_id FROM platform_prospect_outreach_sends WHERE outreach_id=(SELECT id FROM platform_prospect_outreach WHERE prospect_id=?)').get(id);
  result=plain(await receiveManagedSesNotification(f.db,KEY,{Type:'Notification',Message:JSON.stringify({eventType:'Bounce',bounce:{bounceType:'Permanent',bouncedRecipients:[{emailAddress:'info@gulus.example'}]},mail:{messageId:send.provider_message_id,tags:{ryzevoOutreach:[mail.tags.ryzevoOutreach],ryzevoAttempt:[send.id]}}})},validate));
  assert.equal(result.recorded,true);
  assert.equal(plain(await receiveManagedSesNotification(f.db,KEY,{Type:'Notification',Message:JSON.stringify({notificationType:'Received',receipt:{virusVerdict:{status:'FAIL'}},content})},validate)).ignored,true);
}));
