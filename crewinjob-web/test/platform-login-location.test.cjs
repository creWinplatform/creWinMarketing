const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load}=require('./platform-loader.cjs');
const {loginLocation}=load('login-location.ts');
test('proxy login uses exact configured public origin and preserves legacy fallback',()=>{
  assert.equal(loginLocation('https://localhost:3033/private','ryzevo.com','https://ryzevo.com').href,'https://ryzevo.com/login');
  assert.equal(loginLocation('http://localhost:31450/','127.0.0.2:31450','http://127.0.0.2:31450').href,'http://127.0.0.2:31450/login');
  assert.equal(loginLocation('https://marketing.crewin.org/private','marketing.crewin.org').href,'https://marketing.crewin.org/login');
});
test('proxy login refuses untrusted host, scheme, path and malformed operator origin',()=>{
  const fallback='https://localhost:3033/login';
  for(const [host,origin] of [['evil.example','https://ryzevo.com'],['ryzevo.com.evil.example','https://ryzevo.com'],['ryzevo.com','http://ryzevo.com'],['ryzevo.com','https://ryzevo.com/path'],['ryzevo.com','https://user:pass@ryzevo.com'],['ryzevo.com','https://ryzevo.com?next=evil'],['ryzevo.com','not a url'],[null,'https://ryzevo.com']]) assert.equal(loginLocation('https://localhost:3033/private',host,origin).href,fallback);
  assert.equal(loginLocation('http://localhost:3033/','ryzevo.com','https://ryzevo.com').href,'http://localhost:3033/login');
});
