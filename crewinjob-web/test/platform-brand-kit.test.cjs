const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {coachRun}=require('./coach-fixture.cjs');
const {BrandKits,normalizeBrandKit,normalizeLogo}=load('brand-kit.ts');
const {AD_SIZES,POST_SIZES,PROFILE_SIZES,HIGHLIGHT_SIZE,DEFAULT_BRAND_KIT,contrast,inkOn,sizeName}=load('brand-kit-types.ts');
const {layoutDesign,carouselSlides,fit,wrap,estimateMeasure,EMPTY_CONTENT,shapeOf}=load('design-layout.ts');
const {zipStore,crc32}=load('zip-store.ts');

// A 1×1 transparent PNG and the first bytes of a JPEG: real magic numbers, nothing else.
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG=Buffer.from([0xff,0xd8,0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0]).toString('base64');
const kit={colors:{primary:'#123456',accent:'#FFCC00',dark:'#111111',light:'#fafafa'},font:'serif',handle:'  @qa   test ',tagline:'Short tagline'};
const kits=(f,scope=f.scope)=>new BrandKits(f.db,scope);
const plain=value=>JSON.parse(JSON.stringify(value));

test('brand kit: defaults, a validated save with a logo, optimistic revisions and an audit entry',coachRun(async f=>{
  let value=await kits(f).read();
  assert.equal(value.revision,0);assert.equal(value.logo,null);assert.equal(value.canEdit,true);assert.deepEqual(plain(value.colors),plain(DEFAULT_BRAND_KIT.colors));
  value=await kits(f).save({...kit,logo:{data:PNG,mime:'image/png'},expectedRevision:0});
  assert.equal(value.revision,1);assert.equal(value.colors.accent,'#ffcc00','colours are stored in lower case');assert.equal(value.handle,'@qa test','whitespace is collapsed');assert.equal(value.font,'serif');
  assert.deepEqual(plain(value.logo),{data:PNG,mime:'image/png'});
  await assert.rejects(kits(f).save({...kit,expectedRevision:0}),error=>error.status===409,'a save from an older revision is refused');
  value=await kits(f).save({...kit,tagline:'Second',expectedRevision:1});
  assert.equal(value.revision,2);assert.ok(value.logo,'an omitted logo is kept');
  value=await kits(f).save({...kit,logo:null,expectedRevision:2});
  assert.equal(value.logo,null,'null removes the logo');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM platform_audit WHERE operation='brand_kit.save' AND project_id=?").get(f.scope.projectId).n,3);
}));

test('brand kit: colours, fonts and logos are checked; the logo type comes from its bytes',coachRun(async f=>{
  for(const bad of [{colors:{...kit.colors,primary:'red'}},{colors:{...kit.colors,accent:'#12345'}},{font:'comic'},{colors:null}])assert.throws(()=>normalizeBrandKit({...kit,...bad}),/Renkler|yazı tipi/);
  assert.equal(normalizeBrandKit({...kit,handle:'x'.repeat(90)}).handle.length,40);
  assert.throws(()=>normalizeLogo({data:JPEG,mime:'image/png'}),/bildirilen türde değil/,'a JPEG declared as PNG is refused');
  assert.equal(normalizeLogo({data:JPEG,mime:'image/jpeg'}).mime,'image/jpeg');
  assert.throws(()=>normalizeLogo({data:PNG,mime:'image/svg+xml'}),/PNG, JPEG veya WebP/,'SVG is not stored (scripts)');
  assert.throws(()=>normalizeLogo({data:'not base64!',mime:'image/png'}));
  const big=Buffer.concat([Buffer.from(PNG,'base64'),Buffer.alloc(400*1024)]).toString('base64');
  assert.throws(()=>normalizeLogo({data:big,mime:'image/png'}),/400 KB/);
  await assert.rejects(kits(f).save({...kit,logo:{data:JPEG,mime:'image/png'},expectedRevision:0}),error=>error.status===400);
  assert.equal((await kits(f).read()).revision,0,'nothing is written by a refused save');
}));

test('brand kit: everyone in the project reads it; only project-settings managers change it; other projects see nothing',coachRun(async f=>{
  await kits(f).save({...kit,expectedRevision:0});
  const editor=await f.member('editor'),viewer=await f.member('viewer');
  for(const scope of [editor,viewer]){const value=await kits(f,scope).read();assert.equal(value.revision,1);assert.equal(value.canEdit,false);}
  for(const scope of [editor,viewer])await assert.rejects(kits(f,scope).save({...kit,expectedRevision:1}),error=>error.status===403);
  // The other organisation's member, pointed at this project, is not a member here.
  await assert.rejects(kits(f,{...f.scope,subject:f.other.subject}).read(),error=>error.status===403);
  const own=await kits(f,f.other).read();assert.equal(own.revision,0,'each project has its own kit');
}));

test('schema 80 (brand kits) is additive and repeatable',coachRun(async f=>{
  await kits(f).save({...kit,expectedRevision:0});
  const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'brand-kit-')),'fixture.sqlite');
  await f.db.backup(file);let db=openPlatformDatabase(file);
  const users=db.prepare('SELECT COUNT(*) n FROM platform_users').get().n;
  require('./schema-fixture.cjs').removeBrandKitSchema(db);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,79);db.close();
  db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) n FROM platform_migrations').get().n,81);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_brand_kits').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_users').get().n,users,'other data is untouched');assert.equal(db.pragma('foreign_key_check').length,0);db.close();
}));

// Every text box of every template stays inside its canvas, at every size the studio offers.
function assertInside(ops,w,h,label){
  for(const op of ops){
    if(op.kind==='text'){
      assert.ok(op.x>=-0.5&&op.x+op.w<=w+0.5,`${label}: text box inside horizontally`);
      assert.ok(op.y>=-0.5&&op.y+op.lines.length*op.lineHeight<=h+1,`${label}: text inside vertically (${op.y}+${op.lines.length}×${op.lineHeight} > ${h})`);
      for(const line of op.lines)assert.ok(estimateMeasure(line,`${op.weight} ${op.size}px x`)<=op.w+1,`${label}: line fits its box: ${line}`);
      assert.ok(op.size>=4,`${label}: readable size`);
    }
    if(op.kind==='rect'||op.kind==='logo'||op.kind==='photo')assert.ok(op.x>=-0.5&&op.y>=-0.5&&op.x+op.w<=w+0.5&&op.y+op.h<=h+0.5,`${label}: ${op.kind} inside`);
  }
}
const long={...EMPTY_CONTENT,headline:'Kış kampanyası başladı: tüm yıllık planlarda ilk üç ay yarı fiyatına, kurulum ücretsiz ve destek dahil',body:'Muhasebenizi tek ekrandan yönetin. Faturalar, giderler ve raporlar otomatik olarak düzenlenir; ekibiniz her yerden erişir.',items:['Faturaları otomatik eşleştirin','Giderleri fotoğraftan okuyun','Aylık raporu tek tuşla alın','Ekibi rollerle yönetin','Bankanızı bağlayın'],stat:'%38',statLabel:'daha az zaman harcayan ekipler',cta:'Hemen deneyin',date:'29 Ekim',author:'Ayşe K., dükkân sahibi'};
test('layout: every template fits every post, ad and profile size without overflowing, with or without a logo',()=>{
  const sizes=[...AD_SIZES,...Object.values(POST_SIZES).flat()];
  for(const template of ['announce','photo','tips','stat','quote','event'])for(const s of sizes)for(const hasLogo of [true,false]){
    const label=`${template} ${s.w}×${s.h} logo=${hasLogo}`,ops=layoutDesign(long,{template,w:s.w,h:s.h,kit:{...DEFAULT_BRAND_KIT,handle:'@ornek'},hasLogo,hasPhoto:template==='photo',theme:'primary',slide:{index:1,total:5}});
    assert.equal(ops[0].kind,'rect',label);assert.ok(ops.some(op=>op.kind==='text'),`${label}: has text`);assertInside(ops,s.w,s.h,label);
  }
  for(const s of [...PROFILE_SIZES,HIGHLIGHT_SIZE])for(const hasLogo of [true,false]){
    const template=s.id==='avatar'?'avatar':s.id==='highlight'?'highlight':'cover';
    assertInside(layoutDesign({...EMPTY_CONTENT,headline:template==='highlight'?'Kampanyalar':'Her gün daha düzenli bir işletme',body:'@ornek'},{template,w:s.w,h:s.h,kit:DEFAULT_BRAND_KIT,hasLogo,hasPhoto:false,theme:'primary'}),s.w,s.h,`${template} ${s.id}`);
  }
});
test('layout: shapes, wrapping, fitting with an ellipsis and readable colours',()=>{
  assert.equal(shapeOf(728,90),'strip');assert.equal(shapeOf(1200,628),'wide');assert.equal(shapeOf(1080,1350),'square');assert.equal(shapeOf(1080,1920),'tall');assert.equal(shapeOf(160,600),'tall');
  assert.deepEqual(plain(wrap('bir iki üç',estimateMeasure('bir iki','400 10px x'),'400 10px x',estimateMeasure)),['bir iki','üç']);
  assert.ok(wrap('a'.repeat(50),100,'400 10px x',estimateMeasure).length>1,'a long word is split');
  const cut=fit('kelime '.repeat(80),{w:200,h:40},{max:30,min:10,weight:700,family:'x',maxLines:2},estimateMeasure);
  assert.equal(cut.size,10);assert.ok(cut.lines.length<=2);assert.match(cut.lines.at(-1),/…$/);
  assert.ok(contrast('#000000','#ffffff')>20);assert.equal(inkOn('#111111',DEFAULT_BRAND_KIT.colors),DEFAULT_BRAND_KIT.colors.light);assert.equal(inkOn('#ffffff',DEFAULT_BRAND_KIT.colors),DEFAULT_BRAND_KIT.colors.dark);
  // On every theme the headline colour reads on its background (WCAG large text 3:1).
  for(const theme of ['primary','light','dark','accent']){const ops=layoutDesign({...EMPTY_CONTENT,headline:'Merhaba'},{template:'announce',w:1080,h:1080,kit:DEFAULT_BRAND_KIT,hasLogo:false,hasPhoto:false,theme});
    const bg=ops[0].color,text=ops.find(op=>op.kind==='text');assert.ok(contrast(bg,text.color)>=3,`${theme}: ${text.color} on ${bg}`);}
  // Whole words first: a highlight title is shrunk rather than split mid-word ("Hakkı / mızda").
  for(const label of ["Hakkımızda","Kampanyalar","Ürünler"]){const text=layoutDesign({...EMPTY_CONTENT,headline:label},{template:"highlight",w:1080,h:1920,kit:DEFAULT_BRAND_KIT,hasLogo:false,hasPhoto:false,theme:"light"}).find(op=>op.kind==="text");assert.deepEqual(plain(text.lines),[label],label);}
  assert.equal(sizeName('Google duyarlı 1:1','en'),'Google responsive 1:1');assert.equal(sizeName('Meta 1:1','en'),'Meta 1:1');
});
test('carousel: cover, one slide per point and a closing slide, never more than the channel allows',()=>{
  const slides=carouselSlides(long,5);
  assert.equal(slides.length,5);assert.equal(slides[0].template,'announce');assert.equal(slides.at(-1).content.headline,'Hemen deneyin');
  assert.deepEqual(plain(slides.slice(1,4).map(item=>item.content.stat)),['01','02','03']);
  assert.equal(carouselSlides({...long,cta:''},5).length,5,'without a closing slide there is room for four points');
  assert.equal(carouselSlides({...long,items:[]},5).length,1,'no points: only the cover');
  assert.equal(carouselSlides(long,1).length,1);
});
test('zip: stored entries with UTF-8 names, folders, unique names and correct checksums',()=>{
  const a=new TextEncoder().encode('ilk dosya'),b=new Uint8Array([1,2,3,4,5]);
  const zip=Buffer.from(zipStore([{name:'Meta/görsel.png',data:a},{name:'../x/görsel.png',data:b},{name:'Meta/görsel.png',data:b}],new Date(2026,10,16,12,30,10)));
  const end=zip.length-22;assert.equal(zip.readUInt32LE(end),0x06054b50);assert.equal(zip.readUInt16LE(end+10),3);
  let at=zip.readUInt32LE(end+16);const names=[];
  for(let i=0;i<3;i++){assert.equal(zip.readUInt32LE(at),0x02014b50);const length=zip.readUInt16LE(at+28),offset=zip.readUInt32LE(at+42),crc=zip.readUInt32LE(at+16),size=zip.readUInt32LE(at+24);
    const name=zip.subarray(at+46,at+46+length).toString('utf8');names.push(name);assert.equal(zip.readUInt16LE(at+8)&0x0800,0x0800,'UTF-8 flag');
    const local=offset,localName=zip.readUInt16LE(local+26),data=zip.subarray(local+30+localName,local+30+localName+size);assert.equal(crc32(data),crc,`${name} checksum`);at+=46+length;}
  assert.deepEqual(names,['Meta/görsel.png','x/görsel.png','Meta/görsel-2.png'],'.. is dropped and duplicates get a number');
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926,'standard CRC-32 check value');
});
