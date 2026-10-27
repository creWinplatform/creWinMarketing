const assert=require('node:assert/strict'),{test}=require('node:test'),{createHmac}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{ProjectLiveBilling,receivePaytrLiveNotification}=load('billing-live.ts');
const {termsSnapshot,contractEmailMessage,deliverNextContractEmail}=load('billing-contract.ts'),{salesTermsDocument,salesTermsPlainText}=load('sales-terms-document.ts');
// The accepted terms are frozen with the order and emailed once after PayTR confirms the payment (schema 56).
// Disposable merchant values and a stub mail transport only; no request reaches PayTR or SES.
const KEY='34'.repeat(32),keys=['PLATFORM_PAYTR_MERCHANT_ID','PLATFORM_PAYTR_MERCHANT_KEY','PLATFORM_PAYTR_MERCHANT_SALT','PLATFORM_PAYTR_ORIGIN','PLATFORM_PAYTR_USD_ENABLED','PLATFORM_PAYTR_LIVE_ENABLED','PLATFORM_BILLING_TERMS_URL'];
const env={PLATFORM_PAYTR_MERCHANT_ID:'123456',PLATFORM_PAYTR_MERCHANT_KEY:'live-key-fixture-only-1234',PLATFORM_PAYTR_MERCHANT_SALT:'live-salt-fixture-only-1234',PLATFORM_PAYTR_ORIGIN:'https://ryzevo.example',PLATFORM_PAYTR_USD_ENABLED:'1',PLATFORM_PAYTR_LIVE_ENABLED:'1',PLATFORM_BILLING_TERMS_URL:'https://ryzevo.example/satis-sozlesmesi'};
const config={origin:'https://ryzevo.example',region:'eu-central-1',from:'no-reply@ryzevo.example',accessKeyId:'AKIAFIXTUREONLY00000',secretAccessKey:'x'.repeat(40),revision:'r'};
const run=fn=>async()=>{
  const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));Object.assign(process.env,env);
  const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
  try{
    const a=repo.provision('legacy-admin',{organizationName:'alpha',projectName:'alpha',website:'https://example.com',username:'alpha',password:'fixture-password-123'});
    const scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId};db.prepare('INSERT INTO platform_account_emails VALUES(?,?,?)').run(a.userId,'owner@alpha.example',new Date().toISOString());
    const start=new Date(),end=new Date(start.getTime()+14*86400000);
    db.prepare("UPDATE platform_project_entitlements SET mode='trial',trial_owner_id=?,started_at=?,ends_at=? WHERE organization_id=? AND project_id=?").run(a.userId,start.toISOString(),end.toISOString(),a.organizationId,a.projectId);
    const service=new ProjectLiveBilling(db,scope,KEY);
    const order=async(language='tr',key='contract-attempt-001')=>service.start({planId:'launch',cadence:'monthly',idempotencyKey:key,acceptTerms:true,language,contact:{name:'Fixture Ltd',phone:'+90 555 000 0000',address:'Fixture address only'}},'203.0.113.5',async()=>({state:'accepted',token:'livecheckouttoken1234567890'}));
    const pay=id=>{const value={merchant_oid:id,status:'success',total_amount:'2900',currency:'USD',test_mode:'0',payment_amount:'2900',payment_type:'card'};value.hash=createHmac('sha256',env.PLATFORM_PAYTR_MERCHANT_KEY).update(value.merchant_oid+env.PLATFORM_PAYTR_MERCHANT_SALT+value.status+value.total_amount).digest('base64');return receivePaytrLiveNotification(db,new URLSearchParams(value).toString());};
    const queue=()=>db.prepare('SELECT * FROM platform_billing_contract_emails').all();
    await fn({db,a,scope,service,order,pay,queue});
  }finally{db.close();for(const key of keys){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}}
};

test('the page and the email use one document; the plain text keeps every section, link addresses and placeholders',()=>{
  for(const lang of ['tr','en']){
    const doc=salesTermsDocument(lang),text=salesTermsPlainText(lang,'https://ryzevo.example');
    assert.equal(doc.sections.length,10);for(const section of doc.sections)assert.ok(text.includes(section.title.toLocaleUpperCase(lang==='tr'?'tr-TR':'en-US')),section.title);
    if(lang==='tr')assert.match(text,/^ÖN BİLGİLENDİRME FORMU/,'Turkish capitals keep the dotted İ');
    assert.match(text,/https:\/\/ryzevo\.example\/legal\/privacy/);assert.match(text,/\[[^\]]+\]/,'unfilled seller fields stay visible as placeholders');
    assert.match(text,/\$29 \| \$290/);
  }
  const tr=termsSnapshot('tr','https://ryzevo.example'),en=termsSnapshot('en','https://ryzevo.example');
  assert.doesNotMatch(tr.text,/ENGLISH TRANSLATION/);assert.ok(en.text.startsWith(tr.text),'the Turkish text comes first and prevails');assert.match(en.text,/ENGLISH TRANSLATION/);
  assert.match(tr.digest,/^[a-f0-9]{64}$/);assert.notEqual(tr.digest,en.digest);
});

test('the accepted text is frozen with the order and a copy is queued only when the payment is confirmed',run(async f=>{
  const created=await f.order('en');const row=f.db.prepare('SELECT terms_version,terms_language,terms_text,terms_digest FROM platform_billing_live_orders WHERE id=?').get(created.id);
  assert.equal(row.terms_language,'en');assert.match(row.terms_text,/MESAFELİ SATIŞ SÖZLEŞMESİ/);assert.match(row.terms_digest,/^[a-f0-9]{64}$/);
  assert.equal(created.contract,true);assert.equal(created.contractEmail,null);assert.equal(f.queue().length,0,'nothing is queued before PayTR confirms');
  const download=f.service.contract(created.id);assert.equal(download.text,row.terms_text);assert.match(download.filename,/^ryzevo-sozlesme-RZLIVE[a-f0-9]{32}\.txt$/);
  assert.throws(()=>f.service.contract('RZLIVE'+'0'.repeat(32)),error=>error.status===404);assert.throws(()=>f.service.contract('../etc'),error=>error.status===404);
  f.pay(created.id);f.pay(created.id);
  assert.equal(f.queue().length,1,'a repeated notification does not queue a second copy');assert.equal(f.queue()[0].state,'queued');
  assert.equal(f.service.read().orders[0].contractEmail,'queued');
}));

test('the worker sends the copy once to the verified email, with the order details and the frozen text',run(async f=>{
  const created=await f.order('tr');f.pay(created.id);const sent=[];
  assert.equal(await deliverNextContractEmail(f.db,async mail=>{sent.push(mail);},null),false,'without account email configured the copy waits');assert.equal(f.queue()[0].state,'queued');
  assert.equal(await deliverNextContractEmail(f.db,async mail=>{sent.push(mail);},config),'sent');
  assert.equal(sent.length,1);const mail=sent[0];assert.equal(mail.to,'owner@alpha.example');
  assert.match(mail.subject,new RegExp(created.id));assert.match(mail.text,/Plan: Ryzevo Launch \(aylık\)/);assert.match(mail.text,/Tutar: \$29 \(USD\)/);assert.match(mail.text,/Dönem: \d{4}-\d{2}-\d{2} – \d{4}-\d{2}-\d{2} \(UTC\)/);
  assert.ok(mail.text.endsWith(f.db.prepare('SELECT terms_text t FROM platform_billing_live_orders WHERE id=?').get(created.id).t),'the email carries the exact frozen text');
  assert.equal(await deliverNextContractEmail(f.db,async mail=>{sent.push(mail);},config),null,'nothing left to send');assert.equal(sent.length,1);
  assert.equal(f.service.read().orders[0].contractEmail,'sent');
}));

test('an unclear provider outcome is uncertain and never resent; a buyer without a verified email is skipped',run(async f=>{
  const first=await f.order('tr','contract-attempt-002');f.pay(first.id);let calls=0;
  assert.equal(await deliverNextContractEmail(f.db,async()=>{calls++;throw new Error('timeout');},config),'uncertain');
  assert.equal(await deliverNextContractEmail(f.db,async()=>{calls++;},config),null);assert.equal(calls,1);
  f.db.prepare("UPDATE platform_billing_contract_emails SET state='queued'").run();f.db.prepare('DELETE FROM platform_account_emails').run();
  assert.equal(await deliverNextContractEmail(f.db,async()=>{calls++;},config),'skipped');assert.equal(calls,1);assert.equal(f.queue()[0].reason,'no_verified_email');
}));

test('the email message is bilingual by order language and states no figures beyond the order',()=>{
  const order={id:'RZLIVE'+'a'.repeat(32),plan_id:'growth',cadence:'yearly',amount_minor:79000,paid_at:'2026-10-23T10:00:00.000Z',terms_version:'2026-10-23',terms_language:'en',terms_text:'TEXT'};
  const mail=contractEmailMessage(order,{starts_at:'2026-10-23T10:00:00.000Z',ends_at:'2027-10-23T10:00:00.000Z'});
  assert.match(mail.subject,/Your Ryzevo order/);assert.match(mail.text,/Plan: Ryzevo Growth \(yearly\)/);assert.match(mail.text,/Amount: \$790 \(USD\)/);assert.match(mail.text,/Period: 2026-10-23 – 2027-10-23/);assert.ok(mail.text.endsWith('TEXT'));
});

test('migration 56 is additive and repeatable',async()=>{
  const fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'contract-')),'fixture.sqlite');
  let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeContractEmailSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,55);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,61);assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='platform_billing_contract_emails'").get());db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_migrations WHERE version=56').get().n,1);db.close();
});
