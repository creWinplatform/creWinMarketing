const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun,plain}=require('./coach-fixture.cjs');
const {postingTimes,postingSlot,localWhen,PostingTimes}=load('posting-times.ts');

// 2026-11-03 is a Tuesday; times are UTC so the slots are easy to read.
const at=(day,hour)=>`2026-11-${String(day).padStart(2,'0')}T${String(hour).padStart(2,'0')}:00:00.000Z`;
const rows=(platform,list)=>list.map(([day,hour,interactions])=>({platform,at:at(day,hour),interactions}));

test('slots and local weekdays follow the project time zone',()=>{
 assert.deepEqual([6,10,11,13,14,17,18,22,23,2].map(postingSlot),['morning','morning','noon','noon','afternoon','afternoon','evening','evening','night','night']);
 assert.deepEqual(plain(localWhen('2026-11-03T21:30:00.000Z','Europe/Istanbul')),{weekday:2,slot:'night'},'00:30 on Wednesday in Istanbul');
 assert.deepEqual(plain(localWhen('2026-11-08T12:00:00.000Z','UTC')),{weekday:6,slot:'noon'},'Sunday');
});

test('a slot is suggested only with enough posts and when it beats the channel’s usual result',()=>{
 const linkedin=rows('linkedin',[[3,12,50],[4,12,40],[5,12,60],[10,12,45],[3,8,10],[4,8,12],[5,8,8],[10,8,9],[7,9,5],[8,8,4],[1,9,6]]);
 const instagram=rows('instagram',[[3,12,5],[4,12,5],[5,12,5]]);
 const flat=rows('facebook',Array.from({length:9},(_,i)=>[3+i%5,8+(i%3)*5,10]));
 const [facebook,insta,li]=plain(postingTimes([...linkedin,...instagram,...flat],'UTC'));
 assert.equal(li.platform,'linkedin');assert.deepEqual(li.best,{slot:'noon',posts:4,median:47.5});assert.equal(li.posts,11);assert.equal(li.weekdays,'weekdays');
 assert.equal(insta.best,null);assert.equal(insta.posts,3);assert.equal(insta.needed,8,'too few measured posts');
 assert.equal(facebook.best,null,'no slot beats the usual result');
});

test('the view needs project access and is empty without measured posts',coachRun(async f=>{
 assert.deepEqual(plain(new PostingTimes(f.db,f.scope).view()).channels,[]);
 assert.equal(new PostingTimes(f.db,f.member('viewer')).view().days,180,'viewers can read it');
 assert.throws(()=>new PostingTimes(f.db,{...f.other,organizationId:f.scope.organizationId,projectId:f.scope.projectId}).view(),error=>error.status===403);
}));
