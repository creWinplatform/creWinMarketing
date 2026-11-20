const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {ProspectFinder,readSignals,readContacts,scoreOf,siteOrigin,openProspectAnalysis}=load('prospect-finder.ts');
const {ProjectProspects}=load('prospects.ts');
const {FINDER_TERMS_VERSION}=load('prospect-finder-types.ts');
const year=new Date().getUTCFullYear();
// A company home page with a booking widget missing, a pixel present, a role address and a personal one.
const HOME=`<html><head><title>Gülüş Diş Kliniği</title><meta name="viewport" content="width=device-width"><meta name="description" content="Kadıköy'de implant, ortodonti ve estetik diş tedavileri sunan diş kliniği."><script src="https://connect.facebook.net/en_US/fbevents.js"></script></head>
<body><h1>Gülüş Diş Kliniği</h1><a href="https://wa.me/905551112233">WhatsApp</a><a href="/iletisim">İletişim</a><a href="https://instagram.com/gulusdis">Instagram</a>
<p>Bize yazın: info@gulusdis.example veya dr.ayse.yilmaz@gulusdis.example</p><a href="tel:+90 216 555 11 22">Ara</a><footer>© 2019-${year} Gülüş</footer></body></html>`;
const CONTACT=`<html><body><h1>İletişim</h1><a href="mailto:randevu@gulusdis.example?subject=Randevu">randevu@gulusdis.example</a><img src="logo@2x.png"><p>x@example.com</p></body></html>`;
const sites=(pages=>async url=>{const key=url.replace(/\/$/,'');const page=pages[key];if(!page)throw new Error('unreachable');return {finalUrl:key.endsWith('/iletisim')?key:`${key}/`,html:page};})({'https://gulusdis.example':HOME,'https://gulusdis.example/iletisim':CONTACT});
// Disposable providers: Nominatim, DataForSEO and Overpass answer from fixtures; every request is recorded.
function http(mode={}){const calls=[];const fn=async(url,init)=>{calls.push({url,init,body:init.body});
  if(url.startsWith('https://nominatim.openstreetmap.org/'))return {status:200,text:JSON.stringify([{osm_type:'relation',osm_id:1276548,lat:'40.99',lon:'29.03',name:'Kadıköy',address:{country:'Türkiye'}}])};
  if(url.startsWith('https://api.dataforseo.com/')){if(mode.mapsFail)return {status:500,text:'{}'};
    return {status:200,text:JSON.stringify({status_code:20000,tasks:[{status_code:20000,result:[{items:[
      {type:'maps_search',title:'Gülüş Diş Kliniği',url:'https://gulusdis.example/',phone:'+90 216 555 11 22',address:'Bağdat Cd. 1, Kadıköy',address_info:{city:'Kadıköy'},category:'Diş hekimi',rating:{value:4.8,votes_count:212},place_id:'ChIJ1'},
      {type:'maps_search',title:'Sitesiz Diş',url:null,phone:'+90 216 555 00 00',address:'Moda',address_info:{city:'Kadıköy'},category:'Diş hekimi',rating:{value:4.1,votes_count:9},place_id:'ChIJ2'},
      {type:'maps_search',title:'Instagram Diş',url:'https://instagram.com/dis',category:'Diş hekimi',place_id:'ChIJ3'},
      {type:'maps_search',title:'Var Olan',url:'https://www.existing.example/hakkimizda',category:'Diş hekimi',place_id:'ChIJ4'},
    ]}]}]})};}
  if(url.includes('overpass')){if(mode.overpassBusy&&url.includes('kumi'))return {status:504,text:'busy'};
    return {status:200,text:JSON.stringify({elements:[{type:'node',id:42,tags:{name:'OSM Diş',website:'https://osmdis.example',email:'info@osmdis.example','addr:district':'Kadıköy','addr:street':'Moda Cd.'}}]})};}
  throw new Error(`unexpected ${url}`);};fn.calls=calls;return fn;}
const ENV=['PLATFORM_DATAFORSEO_LOGIN','PLATFORM_DATAFORSEO_PASSWORD'];
const run=fn=>coachRun(async f=>{const saved=Object.fromEntries(ENV.map(key=>[key,process.env[key]]));try{for(const key of ENV)delete process.env[key];await fn(f);}finally{for(const key of ENV)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});
const finder=(f,h=http(),scope=f.scope)=>new ProspectFinder(f.db,scope,h,sites);

test('signals, role contact addresses and the score come from the company page only',()=>{
  const signals=plain(readSignals(HOME,'https://gulusdis.example/')),get=key=>signals.find(item=>item.key===key);
  assert.equal(get('https').present,true);assert.equal(get('mobile').present,true);assert.equal(get('meta_pixel').present,true);assert.equal(get('whatsapp').present,true);assert.equal(get('social').present,true);
  assert.equal(get('online_booking').present,false);assert.equal(get('google_tag').present,false);assert.equal(get('contact_form').present,false);assert.equal(get('meta_description').present,true);assert.equal(get('fresh').present,true);
  assert.equal(readSignals('<p>© 2015 Eski</p>','http://old.example/').find(item=>item.key==='fresh').present,false);
  assert.equal(readSignals('<p>no year</p>','https://x.example/').find(item=>item.key==='fresh').present,null,'unknown stays unknown');
  const home=plain(readContacts(HOME,'https://gulusdis.example/'));assert.deepEqual(home.emails,['info@gulusdis.example'],'role addresses only, never a person');assert.deepEqual(home.phones,['+902165551122']);
  assert.deepEqual(plain(readContacts(CONTACT,'https://gulusdis.example/iletisim')).emails,['randevu@gulusdis.example'],'image names and example domains are ignored');
  assert.equal(siteOrigin('instagram.com/dis'),null);assert.equal(siteOrigin('https://www.firma.example/x?y=1'),'https://www.firma.example');
  const settings={signals:{online_booking:'missing',meta_pixel:'present',google_tag:'missing',contact_form:'present'}};
  const score=plain(scoreOf({reason:'Güçlü uyum: implant kliniği',reason_source:'ai'},signals,settings,[{kind:'email'}]));
  assert.deepEqual(score,{total:90,fit:40,signals:30,reach:20,signalsCounted:true});
  assert.deepEqual(plain(scoreOf({reason:'',reason_source:null},null,{signals:{}},[{kind:'phone'}])),{total:17,fit:0,signals:0,reach:10,signalsCounted:false},'without chosen signals the score is over fit and reach');
});

test('Google Maps search needs the provider, the owner’s acceptance of the terms, and adds only companies with a site',run(async f=>{
  await new ProjectProspects(f.db,f.scope).add({company:'Existing',website:'https://existing.example'});
  let h=http();
  await assert.rejects(finder(f,h).discover({city:'Kadıköy',sector:'Diş kliniği',source:'maps'}),error=>error.status===503,'not configured');
  process.env.PLATFORM_DATAFORSEO_LOGIN='qa-login';process.env.PLATFORM_DATAFORSEO_PASSWORD='qa-password';
  await assert.rejects(finder(f,h).discover({city:'Kadıköy',sector:'Diş kliniği',source:'maps'}),error=>error.status===409,'terms first');
  const editor=await f.member('editor');
  await assert.rejects(finder(f,h,editor).acceptTerms({accepted:true,version:FINDER_TERMS_VERSION}),error=>error.status===403,'only the owner accepts');
  await assert.rejects(finder(f,h).acceptTerms({accepted:true,version:'old'}),/kabul edin/);
  let snapshot=await finder(f,h).acceptTerms({accepted:true,version:FINDER_TERMS_VERSION});assert.ok(snapshot.termsAccepted);assert.equal(snapshot.canAcceptTerms,true);
  assert.ok(f.db.prepare("SELECT 1 FROM platform_audit WHERE operation=?").get(`prospect.finder.terms.accept:${FINDER_TERMS_VERSION}`),'recorded with the version');
  assert.equal(h.calls.length,0,'nothing was searched yet');
  const result=await finder(f,h,editor).discover({city:'Kadıköy',sector:'Diş kliniği',source:'maps'});
  assert.equal(result.found,4);assert.equal(result.added,1);assert.equal(result.withoutWebsite,2,'no site and a social profile are not company sites');
  const request=h.calls.find(call=>call.url.startsWith('https://api.dataforseo.com/'));assert.match(request.init.headers.Authorization,/^Basic /);
  assert.deepEqual(JSON.parse(request.body).map(task=>[task.keyword,task.language_code,task.location_coordinate]),[['Diş kliniği Kadıköy','tr','40.990000,29.030000,13z']]);
  const list=(await new ProjectProspects(f.db,f.scope).read()).prospects,added=list.find(item=>item.company==='Gülüş Diş Kliniği');
  assert.equal(added.website,'https://gulusdis.example');assert.equal(added.country,'Türkiye');assert.equal(list.length,2,'the existing site was skipped');
  snapshot=plain(await finder(f,h).read());const insight=snapshot.insights[added.id];
  assert.equal(insight.source,'maps');assert.equal(insight.rating,4.8);assert.equal(insight.reviews,212);assert.equal(insight.city,'Kadıköy');
  assert.deepEqual(insight.contacts.map(item=>[item.kind,item.value,item.source]),[['phone','+902165551122','maps']]);
  assert.equal(snapshot.searchesLeft,9);assert.equal(snapshot.searches[0].added,1);
  await assert.rejects(finder(f,http({mapsFail:true})).discover({city:'Moda',sector:'Diş kliniği',source:'maps'}),error=>error.status===502,'a new search (not cached) that fails at the provider');
  assert.equal(plain(await finder(f,h).read()).searches[0].status,'failed');
  const viewer=await f.member('viewer');await assert.rejects(finder(f,h,viewer).discover({city:'Kadıköy',sector:'Diş kliniği',source:'osm'}),error=>error.status===403);
  assert.equal(Object.keys((await finder(f,h,f.other).read()).insights).length,0,'other projects see nothing');
}));

test('OpenStreetMap search tries the next server when one is busy; listed sectors only',run(async f=>{
  await assert.rejects(finder(f).discover({city:'Kadıköy',sector:'Uzay ajansı',source:'osm'}),/listedeki sektörlerle/);
  const h=http({overpassBusy:true}),result=await finder(f,h).discover({city:'Kadıköy',sector:'Diş kliniği',source:'osm'});
  assert.equal(result.added,1);assert.ok(h.calls.filter(call=>call.url.includes('overpass')).length>=2,'fell back to another server');
  const query=new URLSearchParams(h.calls.find(call=>call.url.includes('overpass')).body).get('data');assert.match(query,/area\(3601276548\)/);assert.match(query,/"amenity"="dentist"/);
  const snapshot=plain(await finder(f,h).read()),insight=Object.values(snapshot.insights)[0];
  assert.equal(insight.source,'osm');assert.deepEqual(insight.contacts.map(item=>item.value),['info@osmdis.example']);
  for(let n=0;n<9;n++)f.db.prepare("UPDATE platform_usage SET count=count+1 WHERE resource='prospect_search'").run();
  await assert.rejects(finder(f,h).discover({city:'Kadıköy',sector:'Diş kliniği',source:'osm'}),error=>error.status===429);
}));

test('scanning reads the home and contact pages; the mini analysis link works once, counts views and can be turned off',run(async f=>{
  const id=(await new ProjectProspects(f.db,f.scope).add({company:'Gülüş Diş Kliniği',website:'https://gulusdis.example'})).prospects[0].id;
  await assert.rejects(finder(f).createReport({id},'https://ryzevo.example'),error=>error.status===409,'scan first');
  await finder(f).saveSettings({signals:{online_booking:'missing',meta_pixel:'present',nonsense:'missing',https:'maybe'}});
  let snapshot=plain(await finder(f).scan({id}));let insight=snapshot.insights[id];
  assert.deepEqual(snapshot.settings.signals,{online_booking:'missing',meta_pixel:'present'},'unknown keys and values are dropped');
  assert.deepEqual(insight.contacts.map(item=>[item.kind,item.value,item.source]).sort(),[['email','info@gulusdis.example','site'],['email','randevu@gulusdis.example','site'],['phone','+902165551122','site']]);
  assert.equal(insight.contacts.find(item=>item.value==='randevu@gulusdis.example').sourceUrl,'https://gulusdis.example/iletisim');
  assert.equal(insight.score.signals,40);assert.equal(insight.score.reach,20);
  const prospect=(await new ProjectProspects(f.db,f.scope).read()).prospects[0];assert.equal(prospect.check.status,'ok','the scan is also the website check');assert.equal(prospect.check.pageTitle,'Gülüş Diş Kliniği');
  assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT value FROM platform_prospect_contacts').all()),/ayse/,'personal addresses are never stored');
  // The link: shown once, only its hash is kept, views counted (not the team's previews), off on demand.
  const {url}=await finder(f).createReport({id},'https://ryzevo.example');const token=new URLSearchParams(new URL(url).hash.slice(1)).get('token');
  assert.match(url,/^https:\/\/ryzevo\.example\/analiz#token=[A-Za-z0-9_-]{43}$/);assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM platform_prospect_reports').all()),new RegExp(token));
  let analysis=plain(await openProspectAnalysis(f.db,token,true));assert.equal(analysis.company,'Gülüş Diş Kliniği');assert.equal(analysis.language,'tr');
  assert.equal(analysis.findings[0].key,'online_booking','the team’s opportunities come first');assert.equal(analysis.findings.some(item=>item.key==='ecommerce'),false,'an unrelated missing item (no web shop) is not listed');assert.ok(analysis.findings.some(item=>item.key==='google_tag'&&!item.present),'core gaps are listed');assert.match(analysis.findings[0].text,/online randevu/);
  assert.equal(plain(await finder(f).read()).insights[id].report.views,0,'a preview is not a view');
  await openProspectAnalysis(f.db,token);await openProspectAnalysis(f.db,token);
  insight=plain(await finder(f).read()).insights[id];assert.equal(insight.report.views,2);assert.equal(insight.report.active,true);
  assert.equal(await openProspectAnalysis(f.db,'x'.repeat(43)),null);
  const second=await finder(f).createReport({id},'https://ryzevo.example'),other=new URLSearchParams(new URL(second.url).hash.slice(1)).get('token');
  assert.equal(await openProspectAnalysis(f.db,token),null,'a new link replaces the old one');assert.ok(await openProspectAnalysis(f.db,other,true));
  await finder(f).revokeReport({id});assert.equal(await openProspectAnalysis(f.db,other),null);
  f.db.prepare("UPDATE platform_prospect_reports SET revoked_at=NULL,expires_at=? WHERE prospect_id=?").run(new Date(Date.now()-1000).toISOString(),id);assert.equal(await openProspectAnalysis(f.db,other),null,'expired');
  // Removing a contact, then the prospect with everything that belongs to it.
  const contact=insight.contacts[0];snapshot=plain(await finder(f).removeContact({contactId:contact.id}));assert.equal(snapshot.insights[id].contacts.length,2);
  await new ProjectProspects(f.db,f.scope).remove({id});
  for(const table of ['platform_prospect_insights','platform_prospect_contacts','platform_prospect_reports'])assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0,table);
  // A redirect to another site is not this company.
  const moved=(await new ProjectProspects(f.db,f.scope).add({company:'Moved',website:'https://moved.example'})).prospects.find(item=>item.company==='Moved');
  const elsewhere=new ProspectFinder(f.db,f.scope,http(),async()=>({finalUrl:'https://elsewhere.example/',html:HOME}));
  assert.equal(plain(await elsewhere.scan({id:moved.id})).insights[moved.id].signals,null);
}));

test('paid Google Maps requests: plan quota, a shared 30-day cache, a personal and a platform ceiling, no slipping through in parallel',run(async f=>{
  process.env.PLATFORM_DATAFORSEO_LOGIN='qa-login';process.env.PLATFORM_DATAFORSEO_PASSWORD='qa-password';
  const h=http(),paid=()=>h.calls.filter(call=>call.url.startsWith('https://api.dataforseo.com/')).length,search=(city,scope=f.scope,sector='Diş kliniği')=>finder(f,h,scope).discover({city,sector,source:'maps'});
  // The fixture project becomes a running 14-day trial.
  const start=Date.now();f.db.prepare("UPDATE platform_project_entitlements SET mode='trial',trial_owner_id=?,started_at=?,ends_at=? WHERE organization_id=? AND project_id=?").run(f.scope.subject,new Date(start).toISOString(),new Date(start+14*86400000).toISOString(),f.scope.organizationId,f.scope.projectId);
  await finder(f,h).acceptTerms({accepted:true,version:FINDER_TERMS_VERSION});
  let quota=plain((await finder(f,h).read()).maps);assert.deepEqual(quota,{usedToday:0,usedMonth:0,dayLimit:2,monthLimit:5,blocked:null},'a trial gets 2 a day, 5 a month');
  await search('Kadıköy');assert.equal(paid(),1);
  await search('  kadıköy ');assert.equal(paid(),1,'the same search again comes from the cache, at no cost');
  assert.equal(plain((await finder(f,h).read()).maps).usedToday,1,'a cached answer uses no allowance');
  await search('Moda');assert.equal(paid(),2);
  await assert.rejects(search('Üsküdar'),error=>error.status===429&&/bugünkü Google Haritalar hakkı \(2\)/.test(error.message));assert.equal(paid(),2,'refused before the provider is asked');
  assert.equal(plain((await finder(f,h).read()).maps).blocked,'project');
  assert.equal(f.db.prepare("SELECT requests FROM platform_provider_usage WHERE scope_key=? AND period=?").get(`project:${f.scope.projectId}`,new Date().toISOString().slice(0,10)).requests,2,'the refused request was not counted');
  // Another project reuses the cache; its own allowance is untouched.
  const viewerOfOther=f.other;await finder(f,h,viewerOfOther).acceptTerms({accepted:true,version:FINDER_TERMS_VERSION});
  await search('Kadıköy',viewerOfOther);assert.equal(paid(),2,'shared cache across projects');
  // A paid project: 10 a day. Parallel requests cannot pass the limit.
  f.db.prepare("UPDATE platform_project_entitlements SET mode='pilot',trial_owner_id=NULL,started_at=?,ends_at=NULL WHERE organization_id=? AND project_id=?").run(new Date().toISOString(),f.other.organizationId,f.other.projectId);
  f.db.prepare("INSERT INTO platform_provider_usage(provider,scope_key,period,requests) VALUES('dataforseo_maps',?,?,8)").run(`project:${f.other.projectId}`,new Date().toISOString().slice(0,10));
  const results=await Promise.allSettled(['A','B','C','D'].map(city=>search(`İlçe ${city}`,viewerOfOther)));
  assert.equal(results.filter(item=>item.status==='fulfilled').length,2,'only the 2 left of 10 went through');assert.equal(paid(),4);
  // The person’s own ceiling across all projects.
  f.db.prepare("UPDATE platform_provider_usage SET requests=10 WHERE scope_key=?").run(`user:${f.other.subject}`);
  f.db.prepare("DELETE FROM platform_provider_usage WHERE scope_key=?").run(`project:${f.other.projectId}`);
  await assert.rejects(search('Beşiktaş',viewerOfOther),error=>error.status===429&&/tüm projelerinizde/.test(error.message));
  // The platform ceiling (the wallet guard) from the server setting.
  f.db.prepare("DELETE FROM platform_provider_usage WHERE scope_key=?").run(`user:${f.other.subject}`);
  process.env.PLATFORM_DATAFORSEO_DAY_CAP='4';
  try{await assert.rejects(search('Şişli',viewerOfOther),error=>error.status===429&&/geçici olarak kapalı/.test(error.message));assert.equal(plain((await finder(f,h,viewerOfOther).read()).maps).blocked,'platform');}
  finally{delete process.env.PLATFORM_DATAFORSEO_DAY_CAP;}
  // An ended trial: no paid searches at all; OpenStreetMap still works.
  f.db.prepare("UPDATE platform_project_entitlements SET started_at=?,ends_at=? WHERE organization_id=? AND project_id=?").run(new Date(start-20*86400000).toISOString(),new Date(start-6*86400000).toISOString(),f.scope.organizationId,f.scope.projectId);
  await assert.rejects(search('Ataşehir'),error=>error.status===402);assert.equal(plain((await finder(f,h).read()).maps).blocked,'inactive');
}));
