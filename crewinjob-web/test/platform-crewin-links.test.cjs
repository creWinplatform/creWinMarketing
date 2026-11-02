const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHmac,randomBytes}=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {load}=require('./platform-loader.cjs');
// Crewin's workspace gets signed product events and the "Which work brought customers" report; its own share and email
// tools tag their crewinjob.com links with rz_ tags the report can name.
const {openPlatformDatabase}=load('database.ts');
const {PlatformRepository}=load('repository.ts');
const {ProductWebhooks,authenticateProductWebhook}=load('product-webhooks.ts');
const {ProductSegments}=load('segments.ts');
const {ProjectMeasurements}=load('measurements.ts');
const {ProjectAttribution}=load('attribution.ts');
const {linkTag}=load('link-tracking.ts');
const {crewinTag,newCrewinShareTag,tagCrewinLinks,registerCrewinTag,crewinTaggedItems}=load('crewin-links.ts');
const {resetFileSummaries}=load('file-summary.ts');
const KEY='12'.repeat(32),SECRET=randomBytes(32).toString('hex'),DAY=86400000;
const CREWIN={subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'};
const ago=(days,extra=0)=>new Date(Date.now()-days*DAY-extra).toISOString();
const plain=value=>JSON.parse(JSON.stringify(value));

function withData(work){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crewin-links-')),saved=process.env.CREWIN_WEB_DATA_DIR;
  process.env.CREWIN_WEB_DATA_DIR=dir;resetFileSummaries();
  const done=()=>{if(saved===undefined)delete process.env.CREWIN_WEB_DATA_DIR;else process.env.CREWIN_WEB_DATA_DIR=saved;resetFileSummaries();fs.rmSync(dir,{recursive:true,force:true});};
  try{const result=work(dir);if(result&&typeof result.then==='function')return result.finally(done);done();return result;}catch(error){done();throw error;}
}

test('Crewin tags are the Ryzevo tag of the Crewin scope; only crewinjob.com links without utm_ are tagged',()=>{
  assert.equal(crewinTag('campaign','c-1'),linkTag({organizationId:'crewin',projectId:'crewinjob'},'campaign','c-1'));
  assert.match(newCrewinShareTag(),/^rz_[a-f0-9]{10}$/);assert.notEqual(newCrewinShareTag(),newCrewinShareTag(),'every share gets its own tag');
  const tag=crewinTag('share','s-1');
  const result=tagCrewinLinks('Yeni ilanlar: https://www.crewinjob.com/jobs. Uygulama https://app.crewinjob.com/x?a=1 · başka https://example.com/a · eski https://crewinjob.com/?utm_campaign=spring',tag,'twitter','social');
  assert.equal(result.tagged,2);
  assert.ok(result.text.includes(`https://www.crewinjob.com/jobs?utm_source=x&utm_medium=social&utm_campaign=${tag}.`),'trailing punctuation stays outside; twitter is reported as x');
  assert.ok(result.text.includes(`https://app.crewinjob.com/x?a=1&utm_source=x&utm_medium=social&utm_campaign=${tag}`),'subdomains are the same site');
  assert.ok(result.text.includes('https://example.com/a ')&&result.text.includes('https://crewinjob.com/?utm_campaign=spring'),'other sites and already-tagged links stay as written');
  const html=tagCrewinLinks('<a href="https://www.crewinjob.com/a">a</a> <a href="https://www.crewinjob.com/b?x=1&amp;y=2">b</a>',tag,'email','email',true);
  assert.equal(html.tagged,1,'an HTML link with & is left alone');assert.ok(html.text.includes('href="https://www.crewinjob.com/b?x=1&amp;y=2"'));
  assert.deepEqual(plain(tagCrewinLinks('https://www.crewinjob.com',`rz_bad`,'email','email')),{text:'https://www.crewinjob.com',tagged:0});
  assert.equal(tagCrewinLinks('https://evilcrewinjob.com/',tag,'email','email').tagged,0,'a look-alike host is not Crewin');
});

test('the tag registry keeps the first title, prunes old entries, and campaign names win',()=>withData(dir=>{
  const share=crewinTag('share','s-1'),email=crewinTag('email','Profilinizi tamamlayın'),campaign=crewinTag('campaign','camp-1');
  assert.equal(registerCrewinTag(share,'share','Yeni ilanlar https://www.crewinjob.com/jobs?utm_campaign=x   bu hafta'),true);
  assert.equal(registerCrewinTag(share,'share','başka başlık'),false,'the first registration wins');
  registerCrewinTag(email,'email','Profilinizi tamamlayın');registerCrewinTag(campaign,'campaign','Konu satırı');
  assert.equal(registerCrewinTag('not-a-tag','share','x'),false);
  const old=crewinTag('share','old');registerCrewinTag(old,'share','Eski',Date.now()-401*DAY);
  registerCrewinTag(crewinTag('share','s-2'),'share','Bugün');
  const stored=JSON.parse(fs.readFileSync(path.join(dir,'crewin-link-tags.json'),'utf8'));
  assert.ok(!stored.some(entry=>entry.tag===old),'entries older than 400 days drop on the next write');
  fs.writeFileSync(path.join(dir,'campaigns.json'),JSON.stringify([{id:'camp-1',name:'Kış ilanları'}]));resetFileSummaries();
  const items=crewinTaggedItems();
  assert.deepEqual(plain(items.get(share)),{kind:'content',id:share,title:'Yeni ilanlar bu hafta'},'links are stripped from the title');
  assert.equal(items.get(email).kind,'campaign');assert.equal(items.get(campaign).title,'Kış ilanları','a campaign’s own name wins');
}));

test('Crewin receives signed events, maps its goal stages and sees which share brought sign-ups',()=>withData(()=>{
  const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
  try{
    const other=repo.provision('legacy-admin',{organizationName:'other',projectName:'other',website:'https://example.com',username:'other',password:'fixture-password-123'});
    const hooks=new ProductWebhooks(db,CREWIN);
    const saved=hooks.save({name:'Denizci olayları',config:{entityType:'user',attributes:[{key:'platform',type:'string'}],eventNames:['seafarer.registered','seafarer.profile_completed']},secret:SECRET},KEY);
    const preview=hooks.preview(saved.id,{sourceVersion:1,events:[{id:'preview-1',entityId:'p',eventName:'seafarer.registered',occurredAt:ago(0,1000),attributes:{platform:'web'}}]});
    assert.equal(preview.canActivate,true);const source=hooks.state(saved.id,1,'activate');assert.equal(source.state,'active');
    assert.equal(new ProductWebhooks(db,{subject:other.userId,organizationId:other.organizationId,projectId:other.projectId}).list().length,0,'other projects do not see Crewin’s source');
    assert.throws(()=>new ProductSegments(db,CREWIN).list(),error=>error.status===403,'segments stay standard-only');
    assert.deepEqual(new ProductSegments(db,CREWIN).eventSources().map(item=>item.id),[saved.id]);

    const measure=new ProjectMeasurements(db,CREWIN,KEY);
    assert.ok(measure.sources().some(item=>item.id===saved.id&&item.provider==='product_webhook'),'the source can be bound to Crewin’s goals');
    measure.save({goalId:'seafarer_activation',stageIndex:0,connectionId:saved.id,metric:'unique_entities',eventName:'seafarer.registered',enabled:false,expectedVersion:0});
    measure.save({goalId:'seafarer_activation',stageIndex:1,connectionId:saved.id,metric:'unique_entities',eventName:'seafarer.profile_completed',enabled:false,expectedVersion:0});

    const share=newCrewinShareTag();registerCrewinTag(share,'share','Kış ilanları yayında');
    const send=events=>{
      const bytes=Buffer.from(JSON.stringify({sourceVersion:1,events})),timestamp=String(Math.floor(Date.now()/1000));
      const signature='v1='+createHmac('sha256',Buffer.from(SECRET,'hex')).update(`${timestamp}.${saved.id}.`).update(bytes).digest('hex');
      return authenticateProductWebhook(db,saved.id,new Headers({'x-ryzevo-timestamp':timestamp,'x-ryzevo-signature':signature}),KEY)(bytes);
    };
    const registered=(id,entityId,attribution)=>({id,entityId,eventName:'seafarer.registered',occurredAt:ago(1),attributes:{platform:'web'},...(attribution?{attribution}:{})});
    const result=send([registered('r-1','48213',{campaign:share,source:'linkedin',medium:'social',touchedAt:ago(2)}),registered('r-2','48214')]);
    assert.equal(result.accepted,2);assert.equal(result.attribution.recorded,1);
    send([{id:'p-1',entityId:'48213',eventName:'seafarer.profile_completed',occurredAt:ago(0,60000),attributes:{platform:'android'}}]);

    const report=new ProjectAttribution(db,CREWIN).report(30);
    assert.deepEqual(report.stages.map(stage=>stage.label.tr),['Kayıt','Profil tamamlama'],'Crewin’s own goal stages');
    assert.equal(report.items.length,1);
    assert.deepEqual(plain({title:report.items[0].title,kind:report.items[0].kind,counts:report.items[0].counts,sources:report.items[0].sources}),{title:'Kış ilanları yayında',kind:'content',counts:[1,1],sources:['linkedin']},'the later event counts without a tag');
    assert.deepEqual(plain(report.coverage),{entities:2,touched:1,ryzevo:1});
    assert.equal(report.setup.activeSources,1);assert.equal(report.setup.stagesMapped,true);
    assert.equal(new ProjectAttribution(db,{subject:other.userId,organizationId:other.organizationId,projectId:other.projectId}).report(30).items.length,0,'nothing leaks into other projects');
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM platform_attribution_touches').all()).includes('48213'),'no backend id is kept');
  }finally{db.close();}
}));

test('unsubscribe links are never tagged; X keeps texts that a tag would push past 280; profile links have fixed tags',()=>{
  const {tagCrewinShare,crewinProfileLink}=load('crewin-links.ts'),tag=crewinTag('share','s-1');
  assert.equal(tagCrewinLinks('Çık: https://www.crewinjob.com/account/unsubscribe?token=abc',tag,'email','email').tagged,0);
  const long=`${'a'.repeat(240)} https://www.crewinjob.com/jobs`;
  assert.deepEqual(plain(tagCrewinShare(long,tag,'twitter')),{text:long,tagged:0},'X keeps the untagged text');
  assert.equal(tagCrewinShare(long,tag,'linkedin').tagged,1,'other platforms have room');
  const profile=new URL(crewinProfileLink('instagram'));
  assert.equal(profile.searchParams.get('utm_campaign'),crewinTag('profile','instagram'));assert.equal(profile.searchParams.get('utm_source'),'instagram');
});

test('the agent computes the same tags, and its appended registry names job posts (the last line for a tag wins)',()=>withData(dir=>{
  const agentDir=path.join(dir,'agent'),file=path.join(agentDir,'data','link-tags.jsonl'),saved=process.env.CREWINJOB_AGENT_DIR,savedFile=process.env.CREWIN_LINK_TAGS_FILE;
  process.env.CREWINJOB_AGENT_DIR=agentDir;process.env.CREWIN_LINK_TAGS_FILE=file;
  try{
    const agent=require('../../crewinjob-agent/modules/link-tags.js');
    for(const [kind,id] of [['job','48213'],['bot','telegram-bot'],['share','x-1']])assert.equal(agent.crewinTag(kind,id),crewinTag(kind,id),`${kind}/${id}`);
    const url=agent.jobLink('https://crewinjob.com/jobs/detail/48213',48213,'','group');
    assert.equal(new URL(url).searchParams.get('utm_campaign'),crewinTag('job','48213'));
    agent.jobLink('https://crewinjob.com/jobs/detail/48213?utm_source=telegram&utm_medium=channel','48213','Chief Officer · Bulk Carrier','channel');
    agent.jobLink('https://crewinjob.com/jobs/detail/48213','48213','Başka başlık','group');
    fs.appendFileSync(file,'{broken\n');
    const items=crewinTaggedItems();
    assert.deepEqual(plain(items.get(crewinTag('job','48213'))),{kind:'content',id:crewinTag('job','48213'),title:'İlan: Chief Officer · Bulk Carrier'},'a generic title is replaced once by the real one');
    assert.equal(items.get(crewinTag('profile','tiktok')).title,'TikTok profil linki');
  }finally{
    if(saved===undefined)delete process.env.CREWINJOB_AGENT_DIR;else process.env.CREWINJOB_AGENT_DIR=saved;
    if(savedFile===undefined)delete process.env.CREWIN_LINK_TAGS_FILE;else process.env.CREWIN_LINK_TAGS_FILE=savedFile;
  }
}));
