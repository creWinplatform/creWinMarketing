const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
// Voice features (ElevenLabs, later): the switch, the append-only consent record, the gates and what the screens may
// show. Temporary files and an in-memory database only: no network, no ElevenLabs, no real phone number (+90 555 000 00 xx).
const KEYS=['VOICE_FEATURES_ENABLED','NEXT_PUBLIC_VOICE_FEATURES_ENABLED','VOICE_PROVIDER_REGION','NEXT_PUBLIC_IYS_ENABLED','PLATFORM_LEGACY_STORE','AUTH_SECRET','TRACKING_SECRET','PLATFORM_PUBLIC_ORIGIN'];
const saved=Object.fromEntries(KEYS.map(key=>[key,process.env[key]]));
for(const key of KEYS)delete process.env[key];
process.env.AUTH_SECRET='voice-consent-fixture-secret-only';
process.env.PLATFORM_PUBLIC_ORIGIN='https://ryzevo.example';
const {load}=require('./platform-loader.cjs');
const {coachRun}=require('./coach-fixture.cjs');
const {isVoiceEnabled,voiceRegion}=load('voice-features.ts');
const texts=load('voice-consent-texts.ts');
const {recordVoiceConsent,withdrawVoiceConsent,canUseVoice,hasCallConsent,latestVoiceConsent}=load('voice-consent.ts');
const {assertOutboundCallAllowed}=load('voice-calls.ts');
const {bookingVoiceAction,bookingCallConsents,recordBookingCallConsents}=load('voice-booking.ts');
const {voicePrivacyAddendum,voiceSubprocessor}=load('voice-legal.ts');
const {PLAN_CATALOG,VOICE_PLAN_RIGHTS,visibleVoicePlanRights}=load('plan-catalog.ts');
const {BrandKits,normalizeBrandKit}=load('brand-kit.ts');
const {ProspectBooking}=load('prospect-workflow.ts');
const {ProjectIys}=load('iys.ts');

const plain=value=>JSON.parse(JSON.stringify(value));
const on=()=>{process.env.VOICE_FEATURES_ENABLED='1';process.env.NEXT_PUBLIC_VOICE_FEATURES_ENABLED='1';};
const off=()=>{delete process.env.VOICE_FEATURES_ENABLED;delete process.env.NEXT_PUBLIC_VOICE_FEATURES_ENABLED;};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-consent-'));
let files=0;const fresh=()=>path.join(dir,`voice-consents-${++files}.jsonl`);
const lines=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
const TENANT={organizationId:'org_fixture',projectId:'proj_fixture'},OTHER={organizationId:'org_fixture',projectId:'proj_other'};
const VISITOR={kind:'visitor',id:'0f8fad5b-d9cb-469f-a165-70867728950e'};
const PHONE='+905550000011',PHONE2='+905550000022';
const DEPS=f=>({db:f.db,credentialKey:'56'.repeat(32)});
const voice=(extra={})=>({tenant:TENANT,subject:VISITOR,type:'voice_assistant',textVersion:'voice-tr-1.0',lang:'tr',granted:true,source:'web',...extra});
const kit={colors:{primary:'#112233',accent:'#ffcc00',dark:'#111111',light:'#fafafa'},font:'serif',handle:'@qa',tagline:'Fixture'};
// A booking page of the fixture project (its key comes from the share link).
const bookingKey=async f=>{const snap=plain(await new ProspectBooking(f.db,f.scope,'56'.repeat(32)).save({enabled:true,title:'Tanışma',durationMin:30,weekdays:[0,1,2,3,4,5,6],startHour:6,endHour:23,noticeHours:1,horizonDays:7}));return /#k=(rzb_[A-Za-z0-9_-]{24})$/.exec(snap.link)[1];};

test.after(()=>{off();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}fs.rmSync(dir,{recursive:true,force:true});});

// (a) Switch off: nothing new is shown, recorded or allowed, and the headers and privacy text stay as they are.
test('off by default: the switch needs both variables on the server; the region defaults to the US',()=>{
  off();assert.equal(isVoiceEnabled(),false);
  process.env.NEXT_PUBLIC_VOICE_FEATURES_ENABLED='1';assert.equal(isVoiceEnabled(),false,'the browser variable alone does not open the server');
  delete process.env.NEXT_PUBLIC_VOICE_FEATURES_ENABLED;process.env.VOICE_FEATURES_ENABLED='true';assert.equal(isVoiceEnabled(),false);
  on();assert.equal(isVoiceEnabled(),true);off();
  assert.equal(voiceRegion(),'US');process.env.VOICE_PROVIDER_REGION='eu';assert.equal(voiceRegion(),'EU');process.env.VOICE_PROVIDER_REGION='mars';assert.equal(voiceRegion(),'US');delete process.env.VOICE_PROVIDER_REGION;
});

test('off: no consent is written, every gate says no and every voice screen helper is empty',coachRun(async f=>{
  off();const file=fresh();
  await assert.rejects(recordVoiceConsent(voice(),file),error=>error.status===404);
  assert.equal(fs.existsSync(file),false,'nothing was written');
  assert.equal(await canUseVoice(TENANT,VISITOR,'voice_assistant',file),false);
  assert.equal(await hasCallConsent(TENANT,PHONE,'call_informational',file),false);
  for(const purpose of ['informational','commercial'])await assert.rejects(assertOutboundCallAllowed(TENANT,PHONE,purpose,{...DEPS(f),file}),error=>error.reason==='voice_off'&&error.status===403);
  await assert.rejects(bookingVoiceAction(f.db,{key:await bookingKey(f),action:'voice_consent',visitor:VISITOR.id,consent:true},file),error=>error.status===404);
  assert.equal(voicePrivacyAddendum(false,'US','tr','kvkk@example.com'),null,'the privacy notice keeps today’s text');
  assert.equal(voiceSubprocessor(false,'US','tr'),null);assert.equal(voiceSubprocessor(false,'US','en'),null);
  for(const plan of PLAN_CATALOG){
    assert.equal(visibleVoicePlanRights(plan.id,false),null,plan.id);
    for(const field of ['voiceoverMinutes','agentMinutes','outboundCalls'])assert.equal(field in plan,false,'the plan catalog itself is unchanged');
  }
  assert.ok(!('voiceProfile' in plain(normalizeBrandKit({...kit,voiceProfile:{kind:'designed',voiceId:'v1',label:'Warm'}}))),'the brand voice is ignored');
}));

test('off: security headers are exactly today’s (no Permissions-Policy, same CSP)',async()=>{
  const config=(await import(pathToFileURL(path.join(__dirname,'..','next.config.mjs')).href)).default;
  assert.deepEqual(await config.headers(),[{source:'/(.*)',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'},{key:'Content-Security-Policy',value:"frame-ancestors 'self'; object-src 'none'; base-uri 'self'"}]}]);
});

test('off: the booking page and its requests carry no voice fields unless the server page passes voice',()=>{
  const page=fs.readFileSync(path.join(__dirname,'..','app','randevu','page.tsx'),'utf8'),booking=fs.readFileSync(path.join(__dirname,'..','components','platform','BookingPage.tsx'),'utf8');
  assert.match(page,/isVoiceEnabled\(\) \? \{ voice: \{ region: voiceRegion\(\) \} \} : \{\}/);
  assert.match(booking,/\.\.\.form, \.\.\.\(voice \? \{ \.\.\.calls, lang: tr \? 'tr' : 'en' \} : \{\}\)/,'the booking request is unchanged without voice');
  assert.match(booking,/\{voice && <VoiceAssistantConsent /);
  const route=fs.readFileSync(path.join(__dirname,'..','app','api','booking','route.ts'),'utf8');
  assert.match(route,/const calls = voice \? bookingCallConsents\(input\) : null/);
});

// Texts: versioned, word for word, never machine-translated.
test('texts: every current version exists; missing languages fall back and are marked; placeholders fill',()=>{
  for(const [type,byLang] of Object.entries(texts.CURRENT_VOICE_TEXTS))for(const version of Object.values(byLang))assert.ok(texts.VOICE_TEXTS[version],`${type} ${version}`);
  assert.equal(texts.voiceTextNeedsTranslation('voice_assistant','en'),false);assert.equal(texts.voiceTextNeedsTranslation('call_informational','en'),true);
  const body=texts.fillVoiceText(texts.VOICE_TEXTS['voice-tr-1.0'].body,texts.voiceFills('US'));
  assert.match(body,/^Sesli asistan için ses kaydınız, yazıya çevrilmek üzere hizmet sağlayıcımız ElevenLabs'e \(ABD\) gönderilir\./);
  assert.match(texts.fillVoiceText(texts.VOICE_TEXTS['voice-en-1.0'].body,texts.voiceFills('EU')),/^To use voice assistant, your recording is sent to our service provider ElevenLabs \(the European Union\)/);
  assert.equal(texts.fillVoiceText(texts.VOICE_TEXTS['call-tr-1.0'].checkbox,{'İşletme adı':'Gülüş Diş'}),'Randevumla ilgili olarak Gülüş Diş tarafından bir çalışan veya yapay zekâ asistanı aracılığıyla telefonla aranmayı kabul ediyorum.');
  assert.match(texts.fillVoiceText(texts.VOICE_AGENT_OPENING.tr,{}),/\[İşletme adı\]/,'an unfilled placeholder stays visible');
});

// (b) Switch on: a consent is recorded and opens the gate.
test('on: a voice consent is one new line, opens the gate for that person and business only, and keeps no raw identity',async()=>{
  on();const file=fresh();
  try{
    const record=plain(await recordVoiceConsent(voice(),file));
    assert.equal(record.type,'voice_assistant');assert.equal(record.textVersion,'voice-tr-1.0');assert.equal(record.lang,'tr');assert.equal(record.granted,true);assert.equal(record.source,'web');assert.match(record.at,/Z$/);
    assert.equal(await canUseVoice(TENANT,VISITOR,'voice_assistant',file),true);
    assert.equal(await canUseVoice(OTHER,VISITOR,'voice_assistant',file),false,'another business');
    assert.equal(await canUseVoice(TENANT,{kind:'visitor',id:'1f8fad5b-d9cb-469f-a165-70867728950e'},'voice_assistant',file),false,'another person');
    assert.equal(await canUseVoice(TENANT,VISITOR,'call_informational',file),false,'another type');
    const raw=fs.readFileSync(file,'utf8');
    assert.doesNotMatch(raw,/0f8fad5b|org_fixture|proj_fixture/,'only one-way keys');assert.doesNotMatch(raw,/"ip"|userAgent|fingerprint/i);
    await assert.rejects(recordVoiceConsent(voice({textVersion:'voice-tr-9.9'}),file),/sürümü/);
    await assert.rejects(recordVoiceConsent(voice({textVersion:'call-tr-1.0'}),file),/sürümü/,'a text of another type');
    await assert.rejects(recordVoiceConsent(voice({type:'call_informational',textVersion:'call-tr-1.0',phone:'0555 000 00 11'}),file),/ülke koduyla/);
    assert.equal(lines(file).length,1,'refused requests wrote nothing');
    off();assert.equal(await canUseVoice(TENANT,VISITOR,'voice_assistant',file),false,'switching off closes the gate at once');
  }finally{off();}
});

test('on: the booking page records the assistant consent and the call consents; outbound calls follow them',coachRun(async f=>{
  on();const file=fresh();
  try{
    const key=await bookingKey(f),tenant={organizationId:f.scope.organizationId,projectId:f.scope.projectId};
    await assert.rejects(bookingVoiceAction(f.db,{key,action:'voice_consent',visitor:VISITOR.id},file),/onay kutusunu/,'the box must be ticked');
    await assert.rejects(bookingVoiceAction(f.db,{key,action:'voice_consent',visitor:'device-123',consent:true},file),/oturumu/);
    await assert.rejects(bookingVoiceAction(f.db,{key:'rzb_'+'x'.repeat(24),action:'voice_consent',visitor:VISITOR.id,consent:true},file),error=>error.status===404);
    assert.deepEqual(plain(await bookingVoiceAction(f.db,{key,action:'voice_consent',visitor:VISITOR.id,consent:true,lang:'en'},file)),{granted:true});
    assert.deepEqual(plain(await bookingVoiceAction(f.db,{key,action:'voice_status',visitor:VISITOR.id},file)),{granted:true});
    assert.equal(lines(file)[0].textVersion,'voice-en-1.0','the English page records the English text');
    assert.equal(await canUseVoice(tenant,VISITOR,'voice_assistant',file),true);

    assert.equal(bookingCallConsents({}),null,'no box ticked, no phone needed');
    assert.throws(()=>bookingCallConsents({callConsent:true,phone:'0555'}),/ülke koduyla/);
    const calls=plain(bookingCallConsents({callConsent:true,iysCallConsent:true,phone:'+90 555 000 00 11'}));assert.deepEqual(calls,{phone:PHONE,informational:true,commercial:true});
    await recordBookingCallConsents(f.db,key,'ayse@gulus.example','tr',calls,file);
    const written=lines(file).slice(1);
    assert.deepEqual(written.map(item=>[item.type,item.textVersion,item.source,item.subjectKind,item.phoneHint]),[['call_informational','call-tr-1.0','form','lead','+90•••11'],['call_commercial','iys-call-tr-1.0','form','lead','+90•••11']]);
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),/5550000011|ayse@/,'no full number or email');
    assert.equal(await hasCallConsent(tenant,PHONE,'call_informational',file),true);assert.equal(await hasCallConsent(tenant,PHONE2,'call_informational',file),false);

    await assertOutboundCallAllowed(tenant,PHONE,'informational',{...DEPS(f),file});
    await assert.rejects(assertOutboundCallAllowed(tenant,PHONE2,'informational',{...DEPS(f),file}),error=>error.reason==='no_call_consent');
    await assert.rejects(assertOutboundCallAllowed(tenant,'+90 555 000 00 11','informational',{...DEPS(f),file}),error=>error.reason==='invalid_phone','only E.164');
    await assert.rejects(assertOutboundCallAllowed(tenant,PHONE,'survey',{...DEPS(f),file}),error=>error.reason==='invalid_purpose');
    // Commercial calls need İYS, whatever the form said.
    await assert.rejects(assertOutboundCallAllowed(tenant,PHONE,'commercial',{...DEPS(f),file}),error=>error.reason==='iys_off','İYS switched off: refused');
    await assert.rejects(assertOutboundCallAllowed(tenant,'+15550000011','commercial',{...DEPS(f),file}),error=>error.reason==='not_turkish');
    process.env.NEXT_PUBLIC_IYS_ENABLED='1';
    try{
      await assert.rejects(assertOutboundCallAllowed(tenant,PHONE,'commercial',{...DEPS(f),file}),error=>error.reason==='iys_scope_missing');
      await new ProjectIys(f.db,f.scope,'56'.repeat(32),async()=>({status:404,body:{}})).declare({scope:'none'});
      await assert.rejects(assertOutboundCallAllowed(tenant,PHONE,'commercial',{...DEPS(f),file}),error=>error.reason==='iys_scope_missing','"no İYS duty" never allows a commercial call');
    }finally{delete process.env.NEXT_PUBLIC_IYS_ENABLED;}
  }finally{off();}
}));

// (c) Withdrawal closes the gate; the record only grows.
test('withdrawal: a new line closes the gate, the consent line stays as it was, and a new consent opens it again',async()=>{
  on();const file=fresh();
  try{
    await recordVoiceConsent(voice(),file);const first=lines(file)[0];
    await withdrawVoiceConsent({tenant:TENANT,subject:VISITOR,type:'voice_assistant',textVersion:'voice-tr-1.0',lang:'tr',source:'web'},file);
    assert.equal(await canUseVoice(TENANT,VISITOR,'voice_assistant',file),false);
    const after=lines(file);assert.equal(after.length,2);assert.deepEqual(after[0],first,'the consent line is never changed');assert.equal(after[1].granted,false);
    assert.equal(plain(await latestVoiceConsent(TENANT,VISITOR,'voice_assistant',file)).granted,false);
    await recordVoiceConsent(voice(),file);assert.equal(await canUseVoice(TENANT,VISITOR,'voice_assistant',file),true);assert.equal(lines(file).length,3);

    const lead={kind:'lead',id:'ayse@gulus.example'},call={tenant:TENANT,subject:lead,type:'call_informational',textVersion:'call-tr-1.0',lang:'tr',source:'form',phone:PHONE};
    await recordVoiceConsent({...call,granted:true},file);assert.equal(await hasCallConsent(TENANT,PHONE,'call_informational',file),true);
    await withdrawVoiceConsent(call,file);assert.equal(await hasCallConsent(TENANT,PHONE,'call_informational',file),false);
  }finally{off();}
});

test('withdrawal on the booking page: the visitor takes the consent back and the gate closes',coachRun(async f=>{
  on();const file=fresh();
  try{
    const key=await bookingKey(f),tenant={organizationId:f.scope.organizationId,projectId:f.scope.projectId};
    await bookingVoiceAction(f.db,{key,action:'voice_consent',visitor:VISITOR.id,consent:true},file);
    assert.deepEqual(plain(await bookingVoiceAction(f.db,{key,action:'voice_withdraw',visitor:VISITOR.id},file)),{granted:false});
    assert.equal(await canUseVoice(tenant,VISITOR,'voice_assistant',file),false);assert.equal(lines(file).length,2);
  }finally{off();}
}));

test('plan rights: separate from AI units, 0 in every plan, so no plan screen shows them even when on',()=>{
  assert.deepEqual(plain(VOICE_PLAN_RIGHTS),{launch:{voiceoverMinutes:0,agentMinutes:0,outboundCalls:0},growth:{voiceoverMinutes:0,agentMinutes:0,outboundCalls:0},team:{voiceoverMinutes:0,agentMinutes:0,outboundCalls:0}});
  for(const plan of PLAN_CATALOG)assert.equal(visibleVoicePlanRights(plan.id,true),null,plan.id);
  assert.ok(Object.isFrozen(VOICE_PLAN_RIGHTS)&&Object.isFrozen(VOICE_PLAN_RIGHTS.growth));
});

test('brand voice: only a designed voice; cloning is refused; a stored voice survives saves while the switch is off',coachRun(async f=>{
  const kits=()=>new BrandKits(f.db,f.scope);
  on();
  try{
    assert.throws(()=>normalizeBrandKit({...kit,voiceProfile:{kind:'cloned',voiceId:'v1',label:'Owner'}}),/klonlama desteklenmez/);
    assert.throws(()=>normalizeBrandKit({...kit,voiceProfile:{kind:'designed',voiceId:'bad id!'}}),/ses kimliği/);
    let value=plain(await kits().save({...kit,voiceProfile:{kind:'designed',voiceId:'v_warm',label:'Sıcak'},expectedRevision:0}));
    assert.deepEqual(value.voiceProfile,{kind:'designed',voiceId:'v_warm',label:'Sıcak'});
    off();
    value=plain(await kits().save({...kit,tagline:'Off',expectedRevision:1}));
    assert.equal('voiceProfile' in value,false,'hidden while off');
    on();value=plain(await kits().read());assert.equal(value.voiceProfile.voiceId,'v_warm','kept through a save made while off');
    value=plain(await kits().save({...kit,voiceProfile:null,expectedRevision:2}));assert.equal('voiceProfile' in value,false,'null removes it');
  }finally{off();}
}));

test('privacy notice when on: the addendum names Ryzevo and the region and leaves undecided parts visible',()=>{
  const value=plain(voicePrivacyAddendum(true,'US','tr','kvkk@example.com'));
  const text=value.parts.map(part=>part.text??`[${part.placeholder}]`).join('');
  assert.equal(value.version,'privacy-voice-tr-1.0');
  assert.match(text,/^Sesli özellikler\. Ryzevo üzerinde sesli özellikleri kullanırsanız/);
  assert.match(text,/sesli asistan hizmetinin sunulması amacıyla/);assert.match(text,/ElevenLabs \(ABD\)/);assert.match(text,/haklarınız için: kvkk@example\.com\.$/);
  assert.deepEqual(value.parts.filter(part=>part.placeholder).map(part=>part.placeholder),['süre','LLM sağlayıcı','Twilio']);
  assert.equal(plain(voicePrivacyAddendum(true,'EU','en','')).untranslated,true);
  assert.match(voiceSubprocessor(true,'EU','tr'),/ElevenLabs \(AB\)/);assert.match(voiceSubprocessor(true,'US','en'),/ElevenLabs \(the United States\)/);
});
