const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {load}=require('./platform-loader.cjs');
// Legacy panel: own one-click unsubscribe for prospect/company/manual recipients. Uses a temporary suppression file only.
const saved={AUTH_SECRET:process.env.AUTH_SECRET,TRACKING_SECRET:process.env.TRACKING_SECRET};
process.env.AUTH_SECRET='legacy-unsubscribe-fixture-secret-only';delete process.env.TRACKING_SECRET;
const m=load('../legacy-unsubscribe.ts');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-unsub-')),file=path.join(dir,'email-suppressions.json');
const token=url=>new URL(url).searchParams.get('token');

test('the link carries no address, only a one-way key, a signature and an expiry',()=>{
  const url=m.legacyUnsubscribeUrl('Ayse.Kaya@Example.com','https://panel.example.com');
  assert.match(url,/^https:\/\/panel\.example\.com\/unsubscribe\?token=cwl1_/);
  assert.doesNotMatch(url,/ayse|kaya|example\.com\/?.*%40/i,'no part of the address is in the link');
  assert.equal(m.isLegacyUnsubscribe(token(url)),true);
  assert.equal(m.legacyEmailKey('ayse.kaya@example.com'),m.legacyEmailKey(' AYSE.KAYA@example.com '),'case and spaces do not matter');
  assert.equal(m.legacyUnsubscribeUrl('a@b.co','not-a-url'),null);
});

test('unsubscribing suppresses exactly that address; forged, altered or expired links are refused',async()=>{
  const url=m.legacyUnsubscribeUrl('ayse.kaya@example.com','https://panel.example.com'),good=token(url);
  assert.equal(m.legacySuppressed(['ayse.kaya@example.com'],file).size,0);
  await m.processLegacyUnsubscribe(good,file);await m.processLegacyUnsubscribe(good,file);
  assert.deepEqual([...m.legacySuppressed(['Ayse.Kaya@example.com','mehmet@example.com'],file)],['ayse.kaya@example.com']);
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(file,'utf8'))).length,1,'repeating is harmless');
  assert.doesNotMatch(fs.readFileSync(file,'utf8'),/ayse|example/i,'the suppression file holds no address');
  const [, key, expires, sig]=/^cwl1_(.{43})\.(\d+)\.(.{22})$/.exec(good);
  const other=token(m.legacyUnsubscribeUrl('mehmet@example.com','https://panel.example.com'));
  for(const bad of [`cwl1_${key}.${expires}.${'A'.repeat(22)}`,`cwl1_${other.slice(5,48)}.${expires}.${sig}`,`cwl1_${key}.${Number(expires)+1}.${sig}`,'cwl1_short','rzv1_x'])
    await assert.rejects(m.processLegacyUnsubscribe(bad,file),bad);
  const old=Math.floor(Date.now()/86400000)-1,crypto=require('node:crypto');
  const expiredSig=crypto.createHmac('sha256',process.env.AUTH_SECRET).update(`legacy-unsubscribe-v1:${key}.${old}`).digest('base64url').slice(0,22);
  await assert.rejects(m.processLegacyUnsubscribe(`cwl1_${key}.${old}.${expiredSig}`,file),'an expired link is refused');
  assert.equal(m.legacySuppressed(['mehmet@example.com'],file).size,0,'no other address was suppressed');
});

test('without a signing secret no link is issued',()=>{
  const keep=process.env.AUTH_SECRET;delete process.env.AUTH_SECRET;
  try{assert.equal(m.legacyUnsubscribeUrl('a@b.co','https://panel.example.com'),null);}finally{process.env.AUTH_SECRET=keep;}
});

test('every legacy marketing send path checks the suppression list',()=>{
  const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  for(const f of ['app/api/messaging/email/send/route.ts','app/api/messaging/email/send-job-match/route.ts'])assert.match(read(f),/legacySuppressed\(/,f);
  assert.match(read('app/api/unsubscribe/route.ts'),/isLegacyUnsubscribe\(token\)[\s\S]*processLegacyUnsubscribe/);
  assert.match(read('app/api/messaging/email/send/route.ts'),/NEXT_PUBLIC_APP_URL/,'no localhost default links in production');
});

test.after(()=>{fs.rmSync(dir,{recursive:true,force:true});for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
