const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {load}=require('./platform-loader.cjs');
const {coachRun}=require('./coach-fixture.cjs');
const {musicTracks,musicTrack}=load('music-library.ts');
const cwd=path.join(__dirname,'..');
// A one-second silent WAV: real header, so the type check passes.
function wav(){const n=48000,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);return b;}

test('music library: the operator script adds, lists and disables tracks; every project member can use active ones',coachRun(async f=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-')),file=path.join(dir,'platform.sqlite'),track=path.join(dir,'calm.wav'),junk=path.join(dir,'junk.wav');
  fs.writeFileSync(track,wav());fs.writeFileSync(junk,Buffer.from('not audio at all'));
  await f.db.backup(file);
  const run=(...args)=>spawnSync(process.execPath,['scripts/music-library.cjs',...args],{cwd,encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,PLATFORM_DATABASE_PROVIDER:'sqlite',PLATFORM_DATABASE_PATH:file}});
  const base=['--title','Sakin Sabah','--artist','QA Studio','--mood','calm','--license','QA SaaS license, terms at https://example.com/license','--source','QA'];
  assert.equal(run('add','--file',junk,...base).status,1,'not audio is refused');
  assert.match(run('add','--file',track,...base.slice(0,4),'--mood','loud',...base.slice(6)).stderr,/--mood must be one of/);
  assert.match(run('add','--file',track,...base.slice(0,6)).stderr,/--license/,'a licence is required');
  const added=run('add','--file',track,...base,'--duration','1');assert.equal(added.status,0,added.stderr);const id=/Added (trk_[a-f0-9]{24})/.exec(added.stdout)[1];
  assert.match(run('add','--file',track,...base).stderr,/already in the library/,'the same file once');
  assert.match(run('list').stdout,new RegExp(`${id}\\s+active\\s+calm\\s+Sakin Sabah — QA Studio`));
  // Read through the panel's store on that file.
  const {openPlatformDatabase}=load('database.ts'),db=openPlatformDatabase(file);
  try{
    const list=JSON.parse(JSON.stringify(await musicTracks(db,f.scope)));assert.equal(list.length,1);assert.equal(list[0].durationMs,1000);assert.match(list[0].license,/QA SaaS license/);
    const audio=await musicTrack(db,f.scope,id);assert.equal(audio.mime,'audio/wav');assert.equal(audio.data.length,wav().length);
    const viewer=await f.member('viewer');assert.equal((await musicTracks(f.db,viewer)).length,0,'the fixture database itself has no tracks');
    await assert.rejects(musicTrack(db,f.scope,'../etc'),error=>error.status===404);
  }finally{db.close();}
  assert.match(run('disable',id).stdout,/Disabled/);
  const db2=openPlatformDatabase(file);try{assert.equal((await musicTracks(db2,f.scope)).length,0,'disabled tracks are hidden');await assert.rejects(musicTrack(db2,f.scope,id),error=>error.status===404);}finally{db2.close();}
}));
