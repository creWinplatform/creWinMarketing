const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts');
const {PlatformRepository}=load('repository.ts');
const {PlatformAccounts,consumeLoginAttempt,securityVersion}=load('account.ts');
const {ProjectOperations}=load('operations.ts');
const {ProjectMarketingStore}=load('marketing-store.ts');
test('Turkish tool searches accept case and accent variations without changing saved text',()=>{const {searchText}=load('client.ts');assert.equal(searchText('İçerik Kütüphanesi','tr'),'icerik kutuphanesi');assert.equal(searchText('KAYIT','tr'),searchText('Kayıt','tr'));assert.equal(searchText('Growth','en'),'growth');});
test('calendar day keys are timezone-aware and do not rely on locale date order',()=>{const {projectDateKey}=load('client.ts');const instant=new Date('2026-10-14T22:30:00Z');assert.equal(projectDateKey(instant,'Europe/Istanbul'),'2026-10-15');assert.equal(projectDateKey(instant,'UTC'),'2026-10-14');});
function fixture(){const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');const provision=name=>repo.provision('legacy-admin',{organizationName:name,projectName:name,website:'https://example.com',username:name,password:'fixture-password-123'}),a=provision('alpha'),b=provision('beta'),scope=value=>({subject:value.userId,organizationId:value.organizationId,projectId:value.projectId});return {db,repo,a,b,scope,ops:new ProjectOperations(db,scope(a)),accounts:new PlatformAccounts(db)};}
test('work plans enforce project ownership, references and write permissions',()=>{
 const {db,repo,a,b,scope,ops}=fixture();try{
 const task=ops.saveTask({title:'Draft review',dueAt:new Date().toISOString(),status:'planned'});
 assert.equal(ops.tasks().length,1);assert.equal(new ProjectOperations(db,scope(b)).tasks().length,0);
 assert.throws(()=>new ProjectOperations(db,scope(b)).saveTask({...task,id:task.id}));
 assert.throws(()=>ops.saveTask({title:'Bad reference',campaignId:'other-project',dueAt:new Date().toISOString()}));
 assert.throws(()=>ops.saveTask({title:'Bad status',dueAt:new Date().toISOString(),status:'published'}));
 const viewer=repo.addMember(a.userId,a.organizationId,a.projectId,{username:'viewer',password:'fixture-password-123',role:'viewer'});
 assert.throws(()=>new ProjectOperations(db,{...scope(a),subject:viewer.userId}).saveTask({title:'Denied',dueAt:new Date().toISOString()}));
 ops.saveTask({...task,status:'completed'});assert.equal(ops.tasks()[0].status,'completed');ops.removeTask(task.id);assert.equal(ops.tasks().length,0);
 }finally{db.close();}
});
test('manual measurements validate defined goal and stage, source cannot be spoofed',()=>{
 const {db,repo,a,ops}=fixture();try{
 repo.updateProject(a.userId,a.organizationId,a.projectId,{name:'Alpha',website:'https://example.com',timezone:'UTC',language:'en',brandVoice:'Precise',goals:[{id:'signup',label:{tr:'Kayıt',en:'Signup'},audience:{tr:'Müşteri',en:'Customer'},stages:[{tr:'Kayıt',en:'Signup'}]}]});
 const metric=ops.saveMetric({goalId:'signup',stageIndex:0,value:23,observedAt:new Date().toISOString(),source:'ga4',note:'CRM snapshot'});
 assert.equal(metric.source,'manual');assert.equal(ops.summary().metrics[0].value,23);
 assert.throws(()=>ops.saveMetric({goalId:'missing',stageIndex:0,value:3,observedAt:new Date().toISOString()}));
 assert.throws(()=>ops.saveMetric({goalId:'signup',stageIndex:2,value:3,observedAt:new Date().toISOString()}));
 assert.throws(()=>ops.saveMetric({goalId:'signup',stageIndex:0,value:-1,observedAt:new Date().toISOString()}));
 assert.throws(()=>ops.saveMetric({goalId:'signup',stageIndex:0,value:null,observedAt:new Date().toISOString()}));
 ops.removeMetric(metric.id);assert.equal(ops.metrics().length,0);
 }finally{db.close();}
});
test('AI reservations enforce atomic monthly quotas and refund failed attempts',()=>{
 const {db,ops}=fixture();try{let first;for(let i=0;i<50;i++){const reservation=ops.reserveAi();first||=reservation;}assert.throws(()=>ops.reserveAi());ops.refundAi(first);assert.equal(ops.summary().usage.ai,49);ops.refundAi(first);assert.equal(ops.summary().usage.ai,49);ops.reserveAi();assert.equal(ops.summary().usage.ai,50);for(let i=0;i<25;i++)ops.reserveAi('audits');assert.throws(()=>ops.reserveAi('audits'));}finally{db.close();}
});
test('single-use invitations are hashed, scoped and re-check the issuer',()=>{
 const {db,repo,a,b,scope,accounts}=fixture();try{
 const invitation=accounts.invite(scope(a),{username:'invited-member',role:'editor'});
 assert.ok(!JSON.stringify(db.prepare('SELECT * FROM platform_enrollments').all()).includes(invitation.token));
 const user=accounts.redeem(invitation.token,{password:'invite-password-123'});
 assert.equal(repo.workspaces(user.userId)[0].project.id,a.projectId);assert.equal(repo.workspace(user.userId,b.organizationId,b.projectId),null);
 assert.throws(()=>accounts.redeem(invitation.token,{password:'invite-password-123'}));
 const revoked=accounts.invite(scope(a),{username:'revoked-invite',role:'viewer'});
 db.prepare('UPDATE platform_memberships SET active=0 WHERE user_id=?').run(a.userId);
 assert.throws(()=>accounts.redeem(revoked.token,{password:'invite-password-123'}));
 }finally{db.close();}
});
test('deployment-owner onboarding creates independent organizations without public signup',()=>{
 const {db,repo,accounts}=fixture();try{
 const invitation=accounts.invite({subject:'legacy-admin',organizationId:'crewin',projectId:'crewinjob'},{username:'new-startup-owner',role:'viewer',newOrganization:true});
 const user=accounts.redeem(invitation.token,{organizationName:'New startup',projectName:'New product',website:'https://startup.example',password:'new-startup-password-123'});
 const workspace=repo.workspaces(user.userId)[0];assert.equal(workspace.project.productPack,'standard');assert.notEqual(workspace.project.organizationId,'crewin');assert.equal(repo.can(user.userId,workspace.organization.id,workspace.project.id,'members.manage'),true);
 }finally{db.close();}
});
test('password updates invalidate earlier session versions and clear OAuth requests',()=>{
 const {db,repo,a,scope,accounts}=fixture();try{
 assert.equal(securityVersion(db,a.userId),0);assert.throws(()=>accounts.changePassword(scope(a),'wrong','new-fixture-password-123'));
 accounts.changePassword(scope(a),'fixture-password-123','new-fixture-password-123');assert.equal(securityVersion(db,a.userId),1);assert.equal(repo.authenticate('alpha','fixture-password-123'),null);assert.ok(repo.authenticate('alpha','new-fixture-password-123'));
 }finally{db.close();}
});
test('login attempts have a persistent per-identity ceiling',()=>{
 const db=openPlatformDatabase(':memory:');try{for(let i=0;i<20;i++)assert.equal(consumeLoginAttempt(db,'Target'),true);assert.equal(consumeLoginAttempt(db,'target'),false);assert.equal(consumeLoginAttempt(db,'Different'),true);}finally{db.close();}
});
test('draft quotas are enforced server-side',()=>{
 const {db,a,scope}=fixture();try{const store=new ProjectMarketingStore(db,scope(a));db.transaction(()=>{for(let i=0;i<500;i++)db.prepare('INSERT INTO platform_campaigns VALUES(?,?,?,?,?)').run('quota-'+i,a.organizationId,a.projectId,JSON.stringify({id:'quota-'+i,status:'draft'}),new Date().toISOString());})();assert.throws(()=>store.saveCampaign({id:'over-quota',status:'draft',updatedAt:new Date().toISOString()},true));}finally{db.close();}
});
test('online backup preserves the database and generated credential key',()=>{
 const fs=require('node:fs'),path=require('node:path'),directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'platform-backup-test-')),source=path.join(directory,'platform.sqlite'),backups=path.join(directory,'backups');
 const db=openPlatformDatabase(source);const repo=new PlatformRepository(db);repo.bootstrapLegacy('backup-admin');db.close();fs.writeFileSync(path.join(directory,'platform-credentials.key'),'12'.repeat(32));
 const result=require('node:child_process').spawnSync(process.execPath,['scripts/platform-backup.mjs'],{cwd:path.join(__dirname,'..'),windowsHide:true,env:{...process.env,PLATFORM_DATABASE_PATH:source,PLATFORM_BACKUP_PATH:backups,PLATFORM_ENCRYPTION_KEY:''},encoding:'utf8',timeout:20000});
 assert.equal(result.status,0,result.stderr);
 const folder=path.join(backups,fs.readdirSync(backups)[0]),manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));assert.equal(manifest.keySource,'file');assert.equal(manifest.schemaVersion,64);assert.equal(fs.readFileSync(path.join(folder,'platform-credentials.key'),'utf8'),'12'.repeat(32));
 const restored=openPlatformDatabase(path.join(folder,'platform.sqlite'));try{assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM platform_users').get().n,1);assert.equal(restored.pragma('integrity_check',{simple:true}),'ok');}finally{restored.close();}
});
