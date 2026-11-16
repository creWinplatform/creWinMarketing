const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createHash}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {coachRun}=require('./coach-fixture.cjs');
const {writeMp4,readMp4}=load('mp4-writer.ts');
const {MediaVideos,publicVideo,videoSignature,VIDEO_PART_BYTES}=load('media-videos.ts');
const KEY='12'.repeat(32);
// An avcC record and AVCC samples stand in for the browser encoder's output (the bytes are not decoded here).
const avcC=new Uint8Array([1,0x64,0,0x28,0xff,0xe1,0,4,0x67,0x64,0,0x28,1,0,2,0x68,0xee]);
const sample=(size,key,fill)=>({data:new Uint8Array(size).fill(fill),key});
const mp4=(frames=60,size=9000)=>Buffer.from(writeMp4({width:1080,height:1920,fps:30,avcC,samples:Array.from({length:frames},(_,i)=>sample(size+i,i%60===0,i%251))}));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const videos=(f,scope=f.scope)=>new MediaVideos(f.db,scope,KEY);
async function upload(f,file,scope=f.scope){
  const v=videos(f,scope),started=await v.start({bytes:file.length,sha256:sha(file),width:1080,height:1920,durationMs:2000});
  for(let part=0;part<started.parts;part++)await v.part(started.id,part,file.subarray(part*started.partBytes,(part+1)*started.partBytes));
  return {started,finished:await v.finish(started.id,'https://ryzevo.example')};
}

test('mp4 writer: ftyp, moov before mdat, one H.264 track with the right size, duration and sample table',()=>{
  const file=mp4(90,500),info=readMp4(file);
  assert.deepEqual([...info.types],['ftyp','moov','mdat'],'fast start: moov comes before the media');
  assert.equal(info.width,1080);assert.equal(info.height,1920);assert.equal(info.count,90);
  assert.equal(info.timescale,90000);assert.equal(info.duration,90*3000,'3 seconds at 30 fps');
  assert.equal(info.offset,info.mdatStart,'the chunk offset points at the first sample');
  assert.equal(info.sizes.reduce((a,b)=>a+b,0),info.mdatEnd-info.mdatStart,'sample sizes cover mdat exactly');
  assert.equal(file.indexOf(Buffer.from('avcC')),file.indexOf(Buffer.from(avcC))-4,'the encoder record is stored as is');
  assert.ok(file.includes(Buffer.from('stss')),'key frames are listed');
  assert.throws(()=>writeMp4({width:10,height:10,fps:30,avcC,samples:[]}),/No video samples/);
  assert.throws(()=>writeMp4({width:10,height:10,fps:30,avcC,samples:[sample(4,false,1)]}),/key frame/);
  assert.throws(()=>readMp4(Buffer.concat([file,Buffer.from([1,2,3])])),/Trailing|Broken/);
});

test('videos: parts, a checked finish and a signed public read; nothing else is public',coachRun(async f=>{
  const file=mp4(),{started,finished}=await upload(f,file);
  assert.ok(started.parts>1,'a larger file goes in several parts');assert.equal(started.partBytes,VIDEO_PART_BYTES);
  assert.match(finished.url,/^https:\/\/ryzevo\.example\/api\/platform\/media\/videos\/vid_[a-f0-9]{32}\?signature=[a-f0-9]{64}$/);
  const signature=new URL(finished.url).searchParams.get('signature'),id=started.id;
  const read=await publicVideo(f.db,KEY,id,signature);assert.ok(read);assert.equal(Buffer.compare(read.file,file),0);assert.equal(read.sha256,sha(file));
  assert.equal(await publicVideo(f.db,KEY,id,'0'.repeat(64)),null,'a wrong signature reads nothing');
  assert.equal(await publicVideo(f.db,'34'.repeat(32),id,signature),null,'a signature from another key reads nothing');
  assert.equal(await publicVideo(f.db,KEY,'vid_'+'0'.repeat(32),signature),null);
  assert.deepEqual(JSON.parse(JSON.stringify((await videos(f).list()).map(item=>item.id))),[id]);
  assert.equal((await videos(f).finish(id,'https://ryzevo.example')).url,finished.url,'finishing twice returns the same address');
  const operations=f.db.prepare("SELECT operation FROM platform_audit WHERE operation LIKE 'media.video.%' ORDER BY rowid").all().map(row=>row.operation);
  assert.deepEqual(operations,['media.video.start','media.video.ready']);
  await videos(f).remove(id);
  assert.equal(await publicVideo(f.db,KEY,id,signature),null,'a removed video is gone');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_media_video_parts').get().n,0,'its parts too');
}));

test('videos: sizes, digests and file type are checked; uploads stay inside the project',coachRun(async f=>{
  const file=mp4();
  for(const bad of [{bytes:0},{bytes:51*1024*1024},{width:8},{durationMs:200},{sha256:'abc'}])await assert.rejects(videos(f).start({bytes:file.length,sha256:sha(file),width:1080,height:1920,durationMs:2000,...bad}),error=>error.status===400);
  // A part of the wrong size is refused; a corrupted part fails the digest at the end and the video never becomes public.
  const v=videos(f),s=await v.start({bytes:file.length,sha256:sha(file),width:1080,height:1920,durationMs:2000});
  await assert.rejects(v.part(s.id,0,file.subarray(0,10)),/boyutu/);
  await assert.rejects(v.part(s.id,s.parts,file.subarray(0,10)),/parçası/);
  await assert.rejects(v.finish(s.id,'https://x.example'),error=>error.status===409,'missing parts');
  for(let part=0;part<s.parts;part++){const slice=Buffer.from(file.subarray(part*s.partBytes,(part+1)*s.partBytes));if(part===1)slice[10]^=0xff;await v.part(s.id,part,slice);}
  await assert.rejects(v.finish(s.id,'https://x.example'),error=>error.status===409&&/bozuk/.test(error.message));
  // Right size and digest, but not an MP4.
  const junk=Buffer.alloc(1000,7),j=await v.start({bytes:junk.length,sha256:sha(junk),width:1080,height:1920,durationMs:2000});
  await v.part(j.id,0,junk);await assert.rejects(v.finish(j.id,'https://x.example'),/MP4/);
  // Size in the file must match what was declared.
  const other=mp4(30,800),w=await v.start({bytes:other.length,sha256:sha(other),width:720,height:1280,durationMs:1000});
  for(let part=0;part<w.parts;part++)await v.part(w.id,part,other.subarray(part*w.partBytes,(part+1)*w.partBytes));
  await assert.rejects(v.finish(w.id,'https://x.example'),/MP4/);
  // Viewers cannot upload; another project cannot touch this one's videos.
  const viewer=await f.member('viewer');
  await assert.rejects(videos(f,viewer).start({bytes:file.length,sha256:sha(file),width:1080,height:1920,durationMs:2000}),error=>error.status===403);
  const {started}=await upload(f,file);
  await assert.rejects(videos(f,f.other).remove(started.id),error=>error.status===404);
  await assert.rejects(videos(f,f.other).part(started.id,0,file.subarray(0,10)),error=>error.status===404);
}));

test('videos: an abandoned upload is cleared after a day; the signature binds the project and the content',coachRun(async f=>{
  const v=videos(f),s=await v.start({bytes:1000,sha256:'a'.repeat(64),width:1080,height:1920,durationMs:2000});
  f.db.prepare('UPDATE platform_media_videos SET created_at=? WHERE id=?').run(new Date(Date.now()-2*86400000).toISOString(),s.id);
  await v.start({bytes:1000,sha256:'b'.repeat(64),width:1080,height:1920,durationMs:2000});
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM platform_media_videos WHERE id=?').get(s.id).n,0,'the stale upload is gone');
  const row={id:'vid_'+'1'.repeat(32),organization_id:'o',project_id:'p',sha256:'c'.repeat(64)};
  assert.notEqual(videoSignature(KEY,row),videoSignature(KEY,{...row,project_id:'q'}));
  assert.notEqual(videoSignature(KEY,row),videoSignature(KEY,{...row,sha256:'d'.repeat(64)}));
}));
