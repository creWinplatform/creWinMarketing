const assert=require('node:assert/strict'),{test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{ProjectUsage}=load('project-usage.ts'),{PILOT_LIMITS}=load('limits.ts');
function fixture(){const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');const create=username=>repo.provision('legacy-admin',{organizationName:username,projectName:username,website:'https://example.com',username,password:'fixture-password-123'}),a=create('alpha'),b=create('beta'),scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId},other={subject:b.userId,organizationId:b.organizationId,projectId:b.projectId};return {db,repo,a,b,scope,other,usage:new ProjectUsage(db,scope)};}
const counter=(f,resource='ai',period=new Date().toISOString().slice(0,7))=>f.db.prepare('SELECT count FROM platform_usage WHERE organization_id=? AND project_id=? AND resource=? AND period=?').get(f.a.organizationId,f.a.projectId,resource,period)?.count||0;
test('plan is read-only pilot policy, using existing limits without invented prices, invoices or provider access',()=>{
 const f=fixture();try{const view=f.usage.read();assert.equal(view.plan.id,'pilot');assert.equal(view.plan.price,null);assert.equal(view.plan.currency,null);assert.equal(view.plan.provider,null);assert.equal(view.plan.checkoutEnabled,false);for(const row of view.resources)assert.equal(row.limit,PILOT_LIMITS[row.resource]);assert.equal(view.period.timezone,'UTC');assert.equal(new Date(view.period.startsAt).getUTCDate(),1);assert.equal(new Date(view.period.endsAt).getUTCDate(),1);assert.equal(view.resources.find(r=>r.resource==='members').used,1);assert.equal(view.recent.length,0);}finally{f.db.close();}
});
test('completion is idempotent and a completed operation cannot refund another request',()=>{
 const f=fixture();try{const item=f.usage.reserve();assert.equal(counter(f),1);assert.equal(f.usage.complete(item),'committed');assert.equal(f.usage.complete(item),'committed');assert.equal(f.usage.release(item),'committed');assert.equal(counter(f),1);assert.equal(f.usage.read().monthly.find(r=>r.resource==='ai').committed,1);}finally{f.db.close();}
});
test('exact reservation release is single-use and released work cannot become completed later',()=>{
 const f=fixture();try{const first=f.usage.reserve(),second=f.usage.reserve();assert.equal(f.usage.release(first),'released');assert.equal(f.usage.release(first),'released');assert.equal(counter(f),1);assert.throws(()=>f.usage.complete(first),e=>e.status===409);f.usage.complete(second);assert.equal(counter(f),1);}finally{f.db.close();}
});
test('reservation handles are bound to actor, project, resource and original UTC month',()=>{
 const f=fixture();try{const item=f.usage.reserve();const foreign=new ProjectUsage(f.db,f.other);assert.throws(()=>foreign.release(item),e=>e.status===404);assert.throws(()=>f.usage.release({...item,resource:'audits'}),e=>e.status===404);assert.throws(()=>f.usage.release({...item,period:'2025-01'}),e=>e.status===404);const editor=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'editor',password:'fixture-password-123',role:'editor'});assert.throws(()=>new ProjectUsage(f.db,{...f.scope,subject:editor.userId}).release(item),e=>e.status===404);assert.equal(counter(f),1);}finally{f.db.close();}
});
test('revocation blocks new reservations and completion but permits exact safe compensation',()=>{
 const f=fixture();try{const item=f.usage.reserve();f.db.prepare('UPDATE platform_memberships SET active=0 WHERE user_id=?').run(f.a.userId);assert.throws(()=>f.usage.reserve(),e=>e.status===403);assert.throws(()=>f.usage.complete(item),e=>e.status===403);assert.equal(f.usage.release(item),'released');assert.equal(counter(f),0);assert.throws(()=>f.usage.read(),e=>e.status===403);}finally{f.db.close();}
});
test('monthly quotas reuse the original counter and never reset earlier untracked usage',()=>{
 const f=fixture();try{const period=new Date().toISOString().slice(0,7);f.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'ai',49)").run(f.a.organizationId,f.a.projectId,period);const item=f.usage.reserve();assert.equal(counter(f),50);assert.throws(()=>f.usage.reserve(),e=>e.status===429);const summary=f.usage.read().monthly.find(r=>r.resource==='ai');assert.equal(summary.previousCounter,49);assert.equal(summary.reserved,1);assert.equal(summary.committed,0);f.usage.release(item);assert.equal(counter(f),49);}finally{f.db.close();}
});
test('AI and audits have independent monthly limits and reject unsupported resources',()=>{
 const f=fixture();try{for(let i=0;i<25;i++)f.usage.complete(f.usage.reserve('audits'));assert.throws(()=>f.usage.reserve('audits'),e=>e.status===429);assert.equal(f.usage.reserve('ai').resource,'ai');assert.equal(counter(f,'audits'),25);assert.throws(()=>f.usage.reserve('social'),e=>e.status===400);}finally{f.db.close();}
});
test('old-month compensation cannot change the new-month counter',()=>{
 const f=fixture();try{const old=f.usage.reserve();f.db.prepare("UPDATE platform_usage SET period='2025-01'").run();f.db.prepare("UPDATE platform_usage_reservations SET period='2025-01' WHERE id=?").run(old.id);f.usage.reserve();f.usage.release({...old,period:'2025-01'});assert.equal(counter(f),1);assert.equal(counter(f,'ai','2025-01'),0);}finally{f.db.close();}
});
test('viewer can read project counters but cannot reserve or view another project',()=>{
 const f=fixture();try{f.usage.reserve();const viewer=f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:'viewer',password:'fixture-password-123',role:'viewer'}),view=new ProjectUsage(f.db,{...f.scope,subject:viewer.userId});assert.equal(view.read().recent.length,1);assert.throws(()=>view.reserve(),e=>e.status===403);assert.throws(()=>new ProjectUsage(f.db,{...f.other,subject:viewer.userId}).read(),e=>e.status===403);const result=JSON.stringify(view.read());assert.ok(!result.includes(f.a.userId));assert.ok(!result.includes('password'));assert.equal(new ProjectUsage(f.db,f.other).read().recent.length,0);}finally{f.db.close();}
});
test('inconsistent counters are exposed as unknown, not manufactured legacy successes or repeated refunds',()=>{
 const f=fixture();try{const item=f.usage.reserve();f.db.prepare('UPDATE platform_usage SET count=0').run();const row=f.usage.read().monthly.find(r=>r.resource==='ai');assert.equal(row.consistent,false);assert.equal(row.previousCounter,null);assert.throws(()=>f.usage.release(item),e=>e.status===409);assert.equal(f.db.prepare('SELECT status FROM platform_usage_reservations WHERE id=?').get(item.id).status,'reserved');}finally{f.db.close();}
});
test('stale reservations hold quota and are marked unconfirmed without automatic release on read',()=>{
 const f=fixture();try{const item=f.usage.reserve();f.db.prepare('UPDATE platform_usage_reservations SET created_at=? WHERE id=?').run(new Date(Date.now()-11*60000).toISOString(),item.id);const row=f.usage.read().recent[0];assert.equal(row.needsReview,true);assert.equal(row.status,'reserved');assert.equal(counter(f),1);assert.equal(f.usage.read().monthly.find(r=>r.resource==='ai').reserved,1);}finally{f.db.close();}
});
test('stored overages are visible without deleting data; these limits never reset monthly',()=>{
 const f=fixture();try{f.db.transaction(()=>{for(let i=0;i<501;i++)f.db.prepare('INSERT INTO platform_campaigns VALUES(?,?,?,?,?)').run('over-'+i,f.a.organizationId,f.a.projectId,'{}',new Date().toISOString());})();const row=f.usage.read().resources.find(r=>r.resource==='campaigns');assert.equal(row.used,501);assert.equal(row.remaining,0);assert.equal(row.state,'over_limit');assert.equal(row.kind,'stored');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_campaigns').get().n,501);}finally{f.db.close();}
});
test('repeated failed operations have a persistent attempt ceiling even after quota refunds',()=>{
 const f=fixture();try{for(let i=0;i<1000;i++)f.usage.release(f.usage.reserve());assert.equal(counter(f),0);assert.throws(()=>f.usage.reserve(),e=>e.status===429);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_usage_reservations').get().n,1000);}finally{f.db.close();}
});
test('retention prunes old operation records but preserves all existing usage counters',()=>{
 const f=fixture();try{const old=f.usage.reserve();f.db.prepare("UPDATE platform_usage_reservations SET created_at='2024-01-01T00:00:00.000Z',period='2024-01' WHERE id=?").run(old.id);f.db.prepare("UPDATE platform_usage SET period='2024-01'").run();f.usage.reserve();assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM platform_usage_reservations').get().n,1);assert.equal(counter(f,'ai','2024-01'),1);assert.equal(counter(f),1);}finally{f.db.close();}
});
test('separate SQLite handles cannot allocate the same last quota unit twice',async()=>{
 const f=fixture(),fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'usage-last-unit-')),'fixture.sqlite');let first,second;
 try{const period=new Date().toISOString().slice(0,7);f.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'ai',49)").run(f.a.organizationId,f.a.projectId,period);await f.db.backup(file);first=openPlatformDatabase(file);second=openPlatformDatabase(file);new ProjectUsage(first,f.scope).reserve();assert.throws(()=>new ProjectUsage(second,f.scope).reserve(),e=>e.status===429);assert.equal(first.prepare("SELECT count FROM platform_usage WHERE resource='ai'").get().count,50);}finally{first?.close();second?.close();f.db.close();}
});
test('migration23 preserves the schema22 accounts and counters and is repeatable',async()=>{
 const f=fixture(),fs=require('node:fs'),path=require('node:path'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'usage-migration-')),'fixture.sqlite');let db;
 try{f.db.prepare('INSERT INTO platform_account_emails VALUES(?,?,?)').run(f.a.userId,'verified@example.com',new Date().toISOString());f.db.prepare("INSERT INTO platform_usage VALUES(?,?,?,'ai',17)").run(f.a.organizationId,f.a.projectId,new Date().toISOString().slice(0,7));require('./schema-fixture.cjs').removeUsageSchema(f.db);assert.equal(f.db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n,22);await f.db.backup(file);db=openPlatformDatabase(file);assert.equal(new ProjectUsage(db,f.scope).read().resources.find(r=>r.resource==='ai').used,17);assert.equal(db.prepare('SELECT email FROM platform_account_emails WHERE user_id=?').get(f.a.userId).email,'verified@example.com');db.close();db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) AS n FROM platform_migrations').get().n,62);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);}finally{db?.close();f.db.close();}
});
