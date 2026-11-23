const assert=require('node:assert/strict'),{test}=require('node:test'),{createHash,randomUUID}=require('node:crypto');
const {fixture,KEY}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {SesProvider,sesSmtpPassword}=load('ses-provider.ts'),{receiveSesFeedback}=load('ses-feedback.ts');
const {ProspectFinder,openProspectAnalysis}=load('prospect-finder.ts'),{ProjectProspects}=load('prospects.ts');
const {ProspectOutreach,deliverDueOutreach,processProspectUnsubscribe,salesAttention,salesMonth,inSendWindow,nextSendWindow}=load('prospect-outreach.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const accessKeyId='AKIA'+'B'.repeat(16),secretAccessKey='b'.repeat(40),region='eu-west-1',topicArn=`arn:aws:sns:${region}:123456789012:ryzevo-sales-qa`;
const proof={identity:true,dkim:true,account:true,events:true,sandbox:true,mailFrom:'provider_managed'};
const page=(name,email)=>`<html><head><title>${name}</title><meta name="viewport" content="width=device-width"></head><body><h1>${name}</h1><p>${email}</p><a href="tel:+90 216 555 11 22">Ara</a><footer>© 2018 ${name}</footer></body></html>`;
const SITES={'https://gulus.example':page('Gülüş Diş','info@gulus.example'),'https://moda.example':page('Moda Klinik','iletisim@moda.example'),'https://kent.example':page('Kent Ofis','bilgi@kent.example')};
const sites=async url=>{const key=url.replace(/\/$/,'');if(!SITES[key])throw new Error('unreachable');return {finalUrl:`${key}/`,html:SITES[key]};};
const ENV=['PLATFORM_PUBLIC_ORIGIN','PLATFORM_EMAIL_PILOT_SEND_ENABLED','PLATFORM_PROSPECT_EMAIL_ENABLED','PLATFORM_GEMINI_API_KEY','PLATFORM_GEMINI_MODEL'];
// A project with a verified SES sender (as the email pilot tests set it up) and approved, scanned prospects.
async function withSales(work){
 const saved=Object.fromEntries(ENV.map(key=>[key,process.env[key]]));process.env.PLATFORM_PUBLIC_ORIGIN='https://ryzevo.example';process.env.PLATFORM_EMAIL_PILOT_SEND_ENABLED='1';delete process.env.PLATFORM_PROSPECT_EMAIL_ENABLED;delete process.env.PLATFORM_GEMINI_API_KEY;delete process.env.PLATFORM_GEMINI_MODEL;
 const f=await fixture();
 try{
  const smtp={host:`email-smtp.${region}.amazonaws.com`,port:587,user:accessKeyId,fromEmail:'hello@example.com',fromName:'Fixture'};
  await f.store.saveConnection({id:f.connection.id,provider:'email',integrationId:'fixture-smtp',accountName:'SES fixture',accessToken:sesSmtpPassword(secretAccessKey,region),smtp},KEY);await f.senders.select({connectionId:f.connection.id,maxRecipients:5,expectedRevision:(await f.senders.get()).readiness.revision});await f.senders.verify((await f.senders.get()).readiness.revision,async()=>({verified:true,error:''}));
  const row=f.db.prepare('SELECT encrypted_credentials FROM platform_connections WHERE id=?').get(f.connection.id);f.db.prepare('INSERT INTO platform_connection_checks VALUES(?,?,?,?,?)').run(f.connection.id,createHash('sha256').update(row.encrypted_credentials).digest('hex'),'verified',new Date().toISOString(),'Isolated fixture access check.');
  const ses=new SesProvider(f.db,f.scope,KEY);await ses.save({accessKeyId,secretAccessKey,configurationSet:'ryzevo-sales',topicArn,expectedRevision:0});await ses.verify(1,async()=>proof);f.db.prepare('UPDATE platform_email_ses SET feedback_observed_at=?').run(new Date().toISOString());
  const prospects=new ProjectProspects(f.db,f.scope,async()=>{throw new Error('not used');}),finder=new ProspectFinder(f.db,f.scope,async()=>{throw new Error('no network');},sites);
  f.prospect=async(company,website)=>{const snap=await prospects.add({company,website});const item=snap.prospects.find(p=>p.website===website);await finder.scan({id:item.id});
   const fresh=(await prospects.read()).prospects.find(p=>p.id===item.id);await prospects.update({id:item.id,reason:'Strong fit: books appointments by phone only.',contactRole:'Clinic manager',sector:'Dental',country:'TR',expectedRevision:fresh.revision});
   const again=(await prospects.read()).prospects.find(p=>p.id===item.id);await prospects.decide({id:item.id,decision:'approve',expectedRevision:again.revision});return item.id;};
  f.mails=[];f.deliver=async(_smtp,_password,mail,reserve)=>{if(!await reserve())return {state:'blocked',providerMessageId:null};f.mails.push(mail);return {state:'accepted',providerMessageId:`ses-${f.mails.length}`};};
  f.sales=(scope=f.scope,deps={})=>new ProspectOutreach(f.db,scope,KEY,{deliver:f.deliver,anyTime:true,...deps});
  f.prospects=prospects;
  f.feedback=async(outreachId,attempt,kind,email,messageId)=>{const event={eventType:kind,mail:{sendingAccountId:'123456789012',source:'hello@example.com',messageId,tags:{ryzevoOutreach:[outreachId],ryzevoAttempt:[attempt]}},...(kind==='Delivery'?{delivery:{recipients:[email]}}:kind==='Bounce'?{bounce:{bounceType:'Permanent',bouncedRecipients:[{emailAddress:email}]}}:{complaint:{complainedRecipients:[{emailAddress:email}]}})};
   return await receiveSesFeedback(f.db,f.connection.id,{Type:'Notification',TopicArn:topicArn,MessageId:randomUUID(),Message:JSON.stringify(event)},KEY,async value=>value);};
  await work(f);
 }finally{f.db.close();for(const key of ENV)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
}

test('sales emails go out on weekdays 9–18 in the project time zone',()=>{
  const at=value=>Date.parse(value),tz='Europe/Istanbul';
  assert.equal(inSendWindow(at('2026-11-18T07:30:00Z'),tz),true,'Wednesday 10:30 in Istanbul');
  assert.equal(inSendWindow(at('2026-11-18T15:30:00Z'),tz),false,'Wednesday 18:30');
  assert.equal(new Date(nextSendWindow(at('2026-11-18T17:00:00Z'),tz)).toISOString(),'2026-11-19T06:00:00.000Z','evening → next morning 09:00');
  assert.equal(new Date(nextSendWindow(at('2026-11-21T09:00:00Z'),tz)).toISOString(),'2026-11-23T06:00:00.000Z','Saturday → Monday 09:00');
  assert.equal(nextSendWindow(at('2026-11-18T07:30:00Z'),tz),at('2026-11-18T07:30:00Z'),'already open');
});

test('a sequence is drafted, approved by a person and sent from the project sender with the analysis and opt-out links',()=>withSales(async f=>{
  const id=await f.prospect('Gülüş Diş','https://gulus.example'),sales=f.sales();
  let snap=plain(await sales.read());assert.equal(snap.readiness.switchOn,false);assert.equal(snap.readiness.senderReady,true);assert.equal(snap.stages.new,1);
  await assert.rejects(sales.draft({id:'missing'}),e=>e.status===404);
  snap=plain(await sales.draft({id,mode:'template'}));let item=snap.outreach[id];
  assert.equal(item.state,'draft');assert.equal(item.source,'template');assert.equal(item.steps.length,3);assert.equal(item.maskedEmail,'i***@g***');
  assert.equal(item.steps[0].body.split('{{analiz}}').length,2,'the first email carries the analysis token once');assert.ok(item.linkedin.length>20);
  // Texts keep to the rules: no links, addresses or numbers, the token in the first email, word limits.
  const steps=item.steps.map(step=>({...step}));
  await assert.rejects(sales.save({id,expectedRevision:item.revision,steps:[{...steps[0],body:'Merhaba, bakın https://spam.example'},...steps.slice(1)]}),e=>e.status===400);
  await assert.rejects(sales.save({id,expectedRevision:item.revision,steps:[{...steps[0],body:'Merhaba, analiz yok.'},...steps.slice(1)]}),e=>e.status===400);
  await assert.rejects(sales.save({id,expectedRevision:item.revision,steps:[{...steps[0],body:'Yüzde 50 % garanti {{analiz}}'},...steps.slice(1)]}),e=>e.status===400);
  await assert.rejects(sales.save({id,expectedRevision:item.revision,steps,linkedin:'Arayın: +90 532 111 22 33'}),e=>e.status===400);
  snap=plain(await sales.save({id,expectedRevision:item.revision,steps:[{subject:'Gülüş için kısa not',body:'Merhaba,\n\nsitenizde online randevu yolu görmedik. Bulgular: {{analiz}}\n\nKısa bir görüşme ister misiniz?'},...steps.slice(1)],linkedin:item.linkedin,whatsapp:item.whatsapp}));
  item=snap.outreach[id];assert.equal(item.source,'human');
  // Rights: a viewer reads only; a writer drafts but does not approve.
  const viewer=await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'sales-viewer',password:'fixture-password-123',role:'viewer'});
  await assert.rejects(f.sales({...f.scope,subject:viewer.userId}).draft({id,mode:'template'}),e=>e.status===403);
  await assert.rejects(f.sales().approve({id,expectedRevision:item.revision,acknowledged:true},'https://ryzevo.example'),e=>e.status===503,'switch off');
  process.env.PLATFORM_PROSPECT_EMAIL_ENABLED='1';
  await assert.rejects(f.sales().approve({id,expectedRevision:item.revision},'https://ryzevo.example'),e=>e.status===400,'acknowledgement needed');
  await assert.rejects(f.sales().approve({id,expectedRevision:item.revision-1,acknowledged:true},'https://ryzevo.example'),e=>e.status===409,'stale revision');
  await assert.rejects(f.sales(f.other).approve({id,expectedRevision:item.revision,acknowledged:true},'https://ryzevo.example'),e=>e.status===404,'another project');
  snap=plain(await sales.approve({id,expectedRevision:item.revision,acknowledged:true},'https://ryzevo.example'));item=snap.outreach[id];
  assert.equal(f.mails.length,1);assert.equal(item.state,'active');assert.equal(item.sentSteps,1);assert.equal(snap.pipeline[id].stage,'contacted');assert.equal(item.sends[0].state,'accepted');
  const mail=f.mails[0];assert.equal(mail.to,'info@gulus.example');assert.equal(mail.from.address,'hello@example.com');assert.equal(mail.subject,'Gülüş için kısa not');
  const link=/https:\/\/ryzevo\.example\/analiz#token=([A-Za-z0-9_-]{43})/.exec(mail.text);assert.ok(link,'the analysis link replaces the token');assert.ok(!mail.text.includes('{{analiz}}'));
  assert.match(mail.text,/https:\/\/ryzevo\.example\/unsubscribe\?token=rzvs1_/);assert.match(mail.headers['List-Unsubscribe'],/^<https:\/\/ryzevo\.example\/unsubscribe/);assert.equal(mail.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  assert.match(mail.headers['X-SES-MESSAGE-TAGS'],new RegExp(`ryzevoOutreach=${item.id}, ryzevoAttempt=osend_`));assert.ok(mail.html.includes('<a href="https://ryzevo.example/analiz#token='));
  assert.equal(plain(await openProspectAnalysis(f.db,link[1])).company,'Gülüş Diş');
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_prospect_outreach').all()).includes(link[1]),'the analysis link is stored encrypted');
  // Not due yet: nothing more goes out; once due, the worker sends follow-up 1 in the same thread.
  assert.equal(await f.sales().deliver(item.id),'skipped');
  assert.ok(Date.parse(item.nextDueAt)-Date.now()>2.9*86400000,'follow-up 1 after 3 days');
  f.db.prepare('UPDATE platform_prospect_outreach SET next_due_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),item.id);
  assert.equal(await deliverDueOutreach(f.db,KEY,{deliver:f.deliver,anyTime:true}),1);
  assert.equal(f.mails.length,2);assert.equal(f.mails[1].subject,'Ynt: Gülüş için kısa not');assert.equal(f.mails[1].headers['In-Reply-To'],f.mails[0].messageId);
  // A reply stops the rest; "interested" adds a meeting task and moves the stage.
  snap=plain(await sales.reply({id,kind:'interested'}));item=snap.outreach[id];
  assert.equal(item.state,'replied');assert.equal(item.nextDueAt,null);assert.equal(snap.pipeline[id].stage,'replied');assert.equal(item.reply.kind,'interested');
  assert.ok(f.db.prepare("SELECT 1 FROM platform_work_items WHERE organization_id=? AND project_id=? AND title LIKE 'Görüşme ayarla%'").get(f.a.organizationId,f.a.projectId));
  f.db.prepare('UPDATE platform_prospect_outreach SET next_due_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),item.id);
  assert.equal(await deliverDueOutreach(f.db,KEY,{deliver:f.deliver,anyTime:true}),0,'nothing goes after a reply');assert.equal(f.mails.length,2);
  // The pipeline and the month's figures.
  snap=plain(await sales.stage({id,stage:'won',valueMinor:1500000,currency:'TRY'}));assert.equal(snap.pipeline[id].stage,'won');assert.equal(snap.pipeline[id].valueMinor,1500000);
  const month=plain(await salesMonth(f.db,f.scope,new Date(Date.now()-86400000).toISOString(),new Date(Date.now()+86400000).toISOString()));
  assert.equal(month.emails,1);assert.equal(month.followUps,1);assert.equal(month.replies,1);assert.equal(month.won,1);assert.deepEqual(month.wonValues,[{currency:'TRY',minor:1500000}]);
  // Removing the company removes its sequence and pipeline row.
  await f.prospects.remove({id});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_prospect_outreach').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_prospect_pipeline').get().n,0);
}));

test('opt-outs, bounces and spam reports stop sending; too many bounces pause the project',()=>withSales(async f=>{
  process.env.PLATFORM_PROSPECT_EMAIL_ENABLED='1';
  const first=await f.prospect('Gülüş Diş','https://gulus.example'),second=await f.prospect('Moda Klinik','https://moda.example'),sales=f.sales();
  const start=async id=>{const draft=plain(await sales.draft({id,mode:'template'})).outreach[id];return plain(await sales.approve({id,expectedRevision:draft.revision,acknowledged:true},'https://ryzevo.example')).outreach[id];};
  // The opt-out link: the address is blocked, the sequence stops and the company is marked lost.
  await start(first);const token=/unsubscribe\?token=(rzvs1_[A-Za-z0-9_-]{43})/.exec(f.mails[0].text)[1];
  assert.deepEqual(plain(await processProspectUnsubscribe(f.db,token,true,KEY)),{projectName:'alpha',unsubscribed:false});assert.equal(plain(await sales.read()).outreach[first].state,'active','looking at the page changes nothing');
  await assert.rejects(processProspectUnsubscribe(f.db,'rzvs1_'+'x'.repeat(43),false,KEY),e=>e.status===400);
  await processProspectUnsubscribe(f.db,token,false,KEY);await processProspectUnsubscribe(f.db,token,false,KEY);
  let snap=plain(await sales.read());assert.equal(snap.outreach[first].state,'stopped');assert.equal(snap.outreach[first].stopReason,'unsubscribed');assert.equal(snap.pipeline[first].stage,'lost');
  const redraft=plain(await sales.draft({id:first,mode:'template'})).outreach[first];
  await assert.rejects(sales.approve({id:first,expectedRevision:redraft.revision,acknowledged:true},'https://ryzevo.example'),e=>e.status===409,'an opted-out address is never written to again');
  // A hard bounce through SES feedback blocks the address and stops the sequence.
  const two=await start(second),send=f.db.prepare('SELECT id,provider_message_id FROM platform_prospect_outreach_sends WHERE outreach_id=?').get(two.id);
  assert.equal(plain(await f.feedback(two.id,send.id,'Delivery','iletisim@moda.example',send.provider_message_id)).recorded,true);
  assert.equal(plain(await f.feedback(two.id,send.id,'Bounce','someone@else.example',send.provider_message_id)).ignored,true,'another address is ignored');
  assert.equal(plain(await f.feedback(two.id,send.id,'Bounce','iletisim@moda.example',send.provider_message_id)).recorded,true);
  snap=plain(await sales.read());assert.equal(snap.outreach[second].state,'bounced');assert.equal(snap.outreach[second].sends[0].state,'bounced');assert.equal(snap.readiness.paused,null,'one bounce does not pause');
  // Three bounces among few emails pause every sequence until a connection manager resumes.
  for(const step of [1,2])f.db.prepare("INSERT INTO platform_prospect_outreach_sends(id,outreach_id,organization_id,project_id,step,state,provider_message_id,created_at,submitted_at,updated_at) VALUES(?,?,?,?,?,'bounced',NULL,?,?,?)").run(`osend_${randomUUID()}`,two.id,f.a.organizationId,f.a.projectId,step,new Date().toISOString(),new Date().toISOString(),new Date().toISOString());
  await f.feedback(two.id,send.id,'Bounce','iletisim@moda.example',send.provider_message_id);
  snap=plain(await sales.read());assert.equal(snap.readiness.paused.reason,'bounces');
  const third=await f.prospect('Kent Ofis','https://kent.example'),draft=plain(await sales.draft({id:third,mode:'template'})).outreach[third];
  await assert.rejects(sales.approve({id:third,expectedRevision:draft.revision,acknowledged:true},'https://ryzevo.example'),e=>e.status===409,'paused');
  const writer=await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'sales-editor',password:'fixture-password-123',role:'editor'});
  await assert.rejects(f.sales({...f.scope,subject:writer.userId}).resume({acknowledged:true}),e=>e.status===403);
  await assert.rejects(sales.resume({}),e=>e.status===400);
  snap=plain(await sales.resume({acknowledged:true}));assert.equal(snap.readiness.paused,null);
  snap=plain(await sales.approve({id:third,expectedRevision:draft.revision,acknowledged:true},'https://ryzevo.example'));assert.equal(snap.outreach[third].state,'active');
  // The daily limit: 10 on the first day; a full day stops the next email until there is room.
  assert.equal(snap.readiness.dailyLimit,10);
}));

test('AI drafts and reply sorting keep to the rules; a "no" blocks the address and team alerts follow the activity',()=>withSales(async f=>{
  process.env.PLATFORM_PROSPECT_EMAIL_ENABLED='1';process.env.PLATFORM_GEMINI_API_KEY='qa';process.env.PLATFORM_GEMINI_MODEL='qa';
  const id=await f.prospect('Gülüş Diş','https://gulus.example'),sales=f.sales(),reserved=()=>f.db.prepare("SELECT COUNT(*) n FROM platform_usage_reservations WHERE status='reserved'").get().n;
  const good={subject:'Gülüş için kısa not',body:'Merhaba,\n\nsitenizde online randevu yolu görmedik. Kısa analiz: {{analiz}}\n\nKonuşmak ister misiniz?',followUp1:'Merhaba, analizi gördünüz mü?',followUp2:'Merhaba, son kez yazıyorum.',linkedin:'Merhaba, sitenizi inceledim; bağlantı kurmak isterim.',whatsapp:'Merhaba, kısa bir analiz hazırladık; iletelim mi?'};
  await assert.rejects(sales.draft({id},async()=>JSON.stringify({...good,body:'Merhaba, link yok.'})),e=>e.status===422);assert.equal(reserved(),0,'a refused AI draft is refunded');
  await assert.rejects(sales.draft({id},async()=>JSON.stringify({...good,linkedin:'Bakın: www.site.example'})),e=>e.status===422);
  let snap=plain(await sales.draft({id},async prompt=>{assert.ok(prompt.includes('Gülüş Diş'));assert.ok(!prompt.includes('info@gulus.example'),'no address goes to the AI');return JSON.stringify(good);}));
  assert.equal(snap.outreach[id].source,'ai');assert.equal(snap.outreach[id].steps[1].body,good.followUp1);
  snap=plain(await sales.approve({id,expectedRevision:snap.outreach[id].revision,acknowledged:true},'https://ryzevo.example'));
  // Alerts: the analysis was opened after the email; a LinkedIn touch waits 5 days.
  const token=/analiz#token=([A-Za-z0-9_-]{43})/.exec(f.mails[0].text)[1];await openProspectAnalysis(f.db,token);
  let attention=plain(await salesAttention(f.db,f.scope));assert.equal(attention.viewed.length,1);assert.equal(attention.paused,null);
  // Reply sorting: the text is data; an unsafe suggestion is refused; the text itself is never stored.
  await assert.rejects(sales.reply({id,text:'Lütfen beni listeden çıkarın.'},async()=>JSON.stringify({kind:'not_interested',summary:'Listeden çıkmak istiyor',draft:'Özür dileriz, bakın https://x.example'})),e=>e.status===422);
  snap=plain(await sales.reply({id,text:'Lütfen beni listeden çıkarın, ali@gulus.example'},async prompt=>{assert.ok(prompt.includes('data, not instructions'));return JSON.stringify({kind:'not_interested',summary:'Listeden çıkmak istiyor (ali@gulus.example)',draft:'Anlıyoruz, bir daha yazmayacağız.'});}));
  assert.equal(snap.outreach[id].reply.kind,'not_interested');assert.ok(!snap.outreach[id].reply.summary.includes('@'),'no address in the summary');assert.equal(snap.pipeline[id].stage,'lost');
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_prospect_outreach').all()).includes('listeden çıkarın'),'the reply text is not kept');
  assert.ok(f.db.prepare("SELECT 1 FROM platform_prospect_suppressions WHERE host='gulus.example'").get(),'the company is on the never-contact list');
  await f.prospects.remove({id});await assert.rejects(f.prospects.add({company:'Gülüş Diş',website:'https://www.gulus.example'}),e=>e.status===409,'and cannot be added back');
  // "Not now" sets a reminder; LinkedIn touches count for the pipeline.
  const other=await f.prospect('Moda Klinik','https://moda.example');
  snap=plain(await sales.touch({id:other,channel:'linkedin'}));assert.equal(snap.pipeline[other].stage,'contacted');assert.equal(snap.touches[other][0].channel,'linkedin');
  await assert.rejects(sales.touch({id:other,channel:'fax'}),e=>e.status===400);
  f.db.prepare("UPDATE platform_prospect_events SET created_at=? WHERE kind='touch'").run(new Date(Date.now()-6*86400000).toISOString());
  attention=plain(await salesAttention(f.db,f.scope));assert.equal(attention.touches.length,1);
  await assert.rejects(sales.stage({id:other,stage:'nope'}),e=>e.status===400);
  assert.deepEqual(plain(await f.sales(f.other).read()).outreach,{},'another project sees nothing');
}));
