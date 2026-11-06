const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {staleCache,sharedStaleCache}=load('stale-cache.ts');

test('a fresh value is reused, a stale one is returned at once while one refresh runs, a missing one is awaited',async()=>{
 let clock=0,calls=0,release;const values=['first','second','third'];
 const read=staleCache(()=>{calls++;const value=values[calls-1];return new Promise(resolve=>{release=()=>resolve(value);});},{freshMs:100,staleMs:1000,now:()=>clock});
 const waiting=read();release();assert.equal(await waiting,'first','nothing cached yet: the caller waits');
 clock=50;assert.equal(await read(),'first');assert.equal(calls,1,'fresh: no backend call');
 clock=500;assert.equal(await read(),'first','stale: the old value at once');assert.equal(calls,2,'and one refresh started');
 assert.equal(await read(),'first');assert.equal(calls,2,'a second caller joins the running refresh');
 release();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(await read(),'second','the refresh replaced the value');
 clock=5000;const old=read();assert.equal(calls,3,'too old: the caller waits for a new read');release();assert.equal(await old,'third');
});

test('a failed refresh keeps the stale value, a result keep() refuses is passed on but not stored',async()=>{
 let clock=0,fail=false,answer={ok:true,n:1};
 const read=staleCache(async()=>{if(fail)throw new Error('backend down');return answer;},{freshMs:10,staleMs:1000,keep:value=>value.ok,now:()=>clock});
 assert.deepEqual(await read(),{ok:true,n:1});
 fail=true;clock=100;assert.deepEqual(await read(),{ok:true,n:1});await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(await read(),{ok:true,n:1},'still the last good value');
 clock=5000;await assert.rejects(read(),/backend down/,'with nothing usable left, the error reaches the caller');
 fail=false;answer={ok:false,n:2};assert.deepEqual(await read(),{ok:false,n:2},'a partial answer is shown');
 answer={ok:true,n:3};assert.deepEqual(await read(),{ok:true,n:3},'but not kept: the next call reads again');
});

test('shared caches are one per key for the whole process',async()=>{
 let calls=0;const loader=async()=>++calls;
 const a=sharedStaleCache('qa:shared',loader,{freshMs:60000,staleMs:60000}),b=sharedStaleCache('qa:shared',async()=>-1,{freshMs:1,staleMs:1});
 assert.equal(a,b,'the first registration wins');assert.equal(await a(),1);assert.equal(await b(),1);assert.equal(calls,1);
});
