const assert=require('node:assert/strict'),{test}=require('node:test');
const {fixture}=require('./email-pilot-fixture.cjs'),{load}=require('./platform-loader.cjs');
const {MemberInvites,receivedInvites,decideInvite}=load('member-invites.ts'),{portfolio}=load('portfolio.ts'),{teamAlerts}=load('team-alerts.ts');
const plain=value=>JSON.parse(JSON.stringify(value)),DAY=86400000;
async function setup(){
 const f=await fixture();
 // Alpha is the client; beta's owner plays the agency, with a verified account email.
 f.verify=(user,email)=>f.db.prepare('INSERT OR REPLACE INTO platform_account_emails VALUES(?,?,?)').run(user,email,new Date().toISOString());
 await f.verify(f.b.userId,'Team@Agency.example');
 f.client=new MemberInvites(f.db,f.scope);
 f.invite=async (email='team@agency.example',role='editor',service=f.client)=>await service.invite({action:'invite',email,role});
 f.member=async role=>({...f.scope,subject:(await f.repo.addMember(f.a.userId,f.a.organizationId,f.a.projectId,{username:`invites-${role}`,password:'fixture-password-123',role})).userId});
 return f;
}
const close=async work=>{const f=await setup();try{await work(f);}finally{f.db.close();}};

test('an owner invites an existing account by verified email; it accepts and both projects appear in its portfolio',()=>close(async f=>{
 const list=await f.invite('  TEAM@agency.example ');assert.equal(list[0].maskedEmail,'t***@agency.example');assert.equal(list[0].state,'pending');
 assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_member_invites').all()).includes('team@agency.example'),'only a hash and a masked form are stored');
 const [received]=plain(await receivedInvites(f.db,f.b.userId));assert.equal(received.projectName,'alpha');assert.equal(received.role,'editor');assert.equal(received.invitedBy,'alpha');
 assert.deepEqual(plain((await teamAlerts(f.db,f.other)).map(item=>item.kind)),['invite_pending'],'the invitee hears about it in its own project');
 const result=await decideInvite(f.db,f.b.userId,{id:received.id,decision:'accept'});assert.equal(result.accepted,true);
 assert.equal(await f.repo.can(f.b.userId,f.a.organizationId,f.a.projectId,'content.write'),true);assert.equal(await f.repo.can(f.b.userId,f.a.organizationId,f.a.projectId,'members.manage'),false);
 const view=await portfolio(f.db,f.b.userId,{organizationId:f.b.organizationId,projectId:f.b.projectId});
 assert.deepEqual(plain(view.projects.map(item=>[item.projectName,item.role,item.current])).sort(),[['alpha','editor',false],['beta','owner',true]]);
 assert.equal(view.invites.length,0);assert.equal((await f.client.list())[0].state,'accepted');
 assert.equal((await portfolio(f.db,f.a.userId,{organizationId:f.a.organizationId,projectId:f.a.projectId})).projects.length,1,'the client does not see the agency’s other projects');
}));

test('the answer never reveals whether an account exists, and an invitation only reaches the matching verified email',()=>close(async f=>{
 assert.equal((await f.invite('nobody@example.org')).length,1,'saved like any other');
 assert.equal((await receivedInvites(f.db,f.b.userId)).length,0);
 await f.invite();const id=(await receivedInvites(f.db,f.b.userId))[0].id;
 await f.verify(f.a.userId,'owner@client.example');await assert.rejects(async ()=>await decideInvite(f.db,f.a.userId,{id,decision:'accept'}),error=>error.status===404,'someone else cannot accept it');
 const unverified=await f.repo.provision('legacy-admin',{organizationName:'gamma',projectName:'gamma',website:'https://gamma.example',username:'gamma',password:'fixture-password-123'});
 await assert.rejects(async ()=>await decideInvite(f.db,unverified.userId,{id,decision:'accept'}),error=>error.status===404,'no verified email, no invitation');
}));

test('only team managers invite; admins cannot invite admins; duplicates, members and limits are refused',()=>close(async f=>{
 await assert.rejects(async ()=>await f.invite('team@agency.example','editor',new MemberInvites(f.db,await f.member('editor'))),error=>error.status===403);
 const admin=new MemberInvites(f.db,await f.member('admin'));await assert.rejects(async ()=>await f.invite('team@agency.example','admin',admin),error=>error.status===403);await f.invite('team@agency.example','viewer',admin);
 await assert.rejects(async ()=>await f.invite(),error=>error.status===409,'one open invitation per email');await assert.rejects(async ()=>await f.invite('team@agency.example','owner'));await assert.rejects(async ()=>await f.invite('not-an-email'));
 await f.verify(f.a.userId,'owner@client.example');await assert.rejects(async ()=>await f.invite('owner@client.example'),error=>error.status===409,'already in the team');
 for(let i=0;i<19;i++)await f.invite(`person${i}@example.org`);await assert.rejects(async ()=>await f.invite('one-more@example.org'),error=>error.status===429);
 await assert.rejects(async ()=>await new MemberInvites(f.db,f.other).revoke({id:(await f.client.list())[0].id}),error=>error.status===404,'another project cannot revoke');
}));

test('revoked, declined, expired and orphaned invitations cannot be accepted; a full team is respected',()=>close(async f=>{
 await f.invite();let id=(await receivedInvites(f.db,f.b.userId))[0].id;await f.client.revoke({id});await assert.rejects(async ()=>await decideInvite(f.db,f.b.userId,{id,decision:'accept'}),error=>error.status===404);
 await f.invite();id=(await receivedInvites(f.db,f.b.userId))[0].id;await decideInvite(f.db,f.b.userId,{id,decision:'decline'});assert.equal((await f.client.list())[0].state,'declined');await assert.rejects(async ()=>await decideInvite(f.db,f.b.userId,{id,decision:'accept'}),error=>error.status===404);
 await f.invite();id=(await receivedInvites(f.db,f.b.userId))[0].id;f.db.prepare('UPDATE platform_member_invites SET expires_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),id);
 assert.equal((await receivedInvites(f.db,f.b.userId)).length,0);await assert.rejects(async ()=>await decideInvite(f.db,f.b.userId,{id,decision:'accept'}),error=>error.status===404);assert.equal((await f.client.list())[0].state,'expired');
 const admin=await f.member('admin');await f.invite('team@agency.example','viewer',new MemberInvites(f.db,admin));id=(await receivedInvites(f.db,f.b.userId))[0].id;
 f.db.prepare('UPDATE platform_memberships SET active=0 WHERE user_id=?').run(admin.subject);await assert.rejects(async ()=>await decideInvite(f.db,f.b.userId,{id,decision:'accept'}),error=>error.status===409,'the inviter lost the right to add people');
 f.db.prepare('UPDATE platform_memberships SET active=1 WHERE user_id=?').run(admin.subject);
 const start=Date.now();f.db.prepare("UPDATE platform_project_entitlements SET mode='trial',trial_owner_id=?,started_at=?,ends_at=? WHERE organization_id=? AND project_id=?").run(f.a.userId,new Date(start).toISOString(),new Date(start+14*DAY).toISOString(),f.a.organizationId,f.a.projectId);
 await assert.rejects(async ()=>await decideInvite(f.db,f.b.userId,{id,decision:'accept'}),error=>error.status===429,'a trial has two seats and they are taken');
}));

test('portfolio figures are read with the person’s rights in each project',()=>close(async f=>{
 await f.invite('team@agency.example','viewer');await decideInvite(f.db,f.b.userId,{id:(await receivedInvites(f.db,f.b.userId))[0].id,decision:'accept'});
 const conn=await f.store.saveConnection({provider:'social',integrationId:'unused',accountName:'Client Page',accessToken:'client-token',expiresAt:Date.now()+86400000,social:{platform:'linkedin',accountId:'client_member'}},'12'.repeat(32));
 f.db.prepare("INSERT INTO platform_social_inbox(id,organization_id,project_id,connection_id,platform,kind,thread_id,item_id,author_hash,text,received_at,created_at) VALUES('i1',?,?,?,'linkedin','message','t','i','h','Client customer words',?,?)").run(f.a.organizationId,f.a.projectId,conn.id,new Date(Date.now()-20*3600000).toISOString(),new Date().toISOString());
 const mine=(await portfolio(f.db,f.b.userId,{organizationId:f.b.organizationId,projectId:f.b.projectId})).projects.find(item=>item.projectName==='alpha');
 assert.equal(mine.inboxOpen,null,'a viewer without the reading duty sees no inbox count');assert.equal(mine.alerts.urgent,0);assert.equal(mine.approvals,0);
 const owner=(await portfolio(f.db,f.a.userId,{organizationId:f.a.organizationId,projectId:f.a.projectId})).projects[0];assert.equal(owner.inboxOpen,1);assert.equal(owner.alerts.urgent,1);
 assert.ok(!JSON.stringify(mine).includes('Client customer words')&&!JSON.stringify(owner).includes('client-token'));
}));

test('migration 60 is additive and repeatable',async()=>{
 const fs=require('node:fs'),path=require('node:path'),{openPlatformDatabase}=load('database.ts'),file=path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(),'member-invites-')),'fixture.sqlite');
 let db=openPlatformDatabase(file);require('./schema-fixture.cjs').removeMemberInviteSchema(db);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='platform_member_invites'").get().n,0);db.close();
 db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT MAX(version) v FROM platform_migrations').get().v,78);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='platform_member_invites'").get().n,1);assert.equal(db.pragma('foreign_key_check').length,0);db.close();
 db=openPlatformDatabase(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM platform_migrations WHERE version=60').get().n,1);db.close();
});
