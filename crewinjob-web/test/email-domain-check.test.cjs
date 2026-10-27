const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
// Legacy panel: DNS check of a lead's email domain. The resolver is a stub; no real DNS query is made.
const {checkEmailDomains,checkDomain,emailDomain}=load('../email-domain-check.ts');
const error=code=>Object.assign(new Error(code),{code});
function resolver(table){const asked=[];return {asked,resolveMx:async domain=>{asked.push(domain);const answer=table[domain];if(answer instanceof Error)throw answer;return answer||[];}};}

test('the domain of each address is checked once; MX, no MX, a missing domain and a null MX are told apart',async()=>{
 const r=resolver({'crew.example':[{exchange:'mx2.crew.example',priority:20},{exchange:'mx1.crew.example',priority:10}],'site-only.example':error('ENODATA'),'missing.example':error('ENOTFOUND'),'nullmx.example':[{exchange:'',priority:0}],'flaky.example':error('ETIMEOUT')});
 const results=await checkEmailDomains(['info@crew.example','Jobs@CREW.example','info@site-only.example','info@missing.example','info@nullmx.example','info@flaky.example','not-an-email'],r);
 assert.equal(results['info@crew.example'].status,'mx');assert.deepEqual([...results['info@crew.example'].mx],['mx1.crew.example','mx2.crew.example']);
 assert.equal(results['jobs@crew.example'].status,'mx');
 assert.equal(r.asked.filter(domain=>domain==='crew.example').length,1,'one lookup per domain');
 assert.equal(results['info@site-only.example'].status,'no_mx');
 assert.equal(results['info@missing.example'].status,'not_found');
 assert.equal(results['info@nullmx.example'].status,'no_mx','a null MX accepts no email');
 assert.equal(results['info@flaky.example'].status,'error');
 assert.equal(results['not-an-email'].status,'not_found');
});

test('answers are cached for an hour, temporary failures are not',async()=>{
 const r=resolver({'cache.example':[{exchange:'mx.cache.example',priority:1}],'retry.example':error('ESERVFAIL')});
 const now=Date.now();
 await checkDomain('cache.example',r,now);await checkDomain('cache.example',r,now+1000);
 assert.equal(r.asked.filter(domain=>domain==='cache.example').length,1);
 await checkDomain('cache.example',r,now+2*3600000);assert.equal(r.asked.filter(domain=>domain==='cache.example').length,2);
 await checkDomain('retry.example',r,now);await checkDomain('retry.example',r,now+1000);
 assert.equal(r.asked.filter(domain=>domain==='retry.example').length,2);
});

test('only plausible domains are looked up and at most 200 addresses are taken',async()=>{
 assert.equal(emailDomain('a@b'),null);assert.equal(emailDomain('a@-bad-.com'),null);assert.equal(emailDomain(' Info@Ditas.COM.tr '),'ditas.com.tr');
 const r=resolver({});const many=Array.from({length:250},(_,i)=>`info@d${i}.example`);
 const results=await checkEmailDomains(many,r);assert.equal(Object.keys(results).length,200);assert.equal(r.asked.length,200);
});
