const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {load}=require('./platform-loader.cjs'),{removeSalesFollowUpSchema}=require('./schema-fixture.cjs');
const {openPlatformDatabase}=load('database.ts');

// A database as schema 83 shipped (before the follow-up columns and the five-email limits) with sales data in it.
function shipped83(file){
  const db=openPlatformDatabase(file);
  removeSalesFollowUpSchema(db);
  const narrow=(table,from,to)=>{
    const {sql}=db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table);
    const indexes=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table).map(r=>r.sql);
    assert.ok(sql.includes(from),table);
    db.exec(`PRAGMA defer_foreign_keys = ON; ${sql.replace(table,`${table}_old`).replace(from,to)}; INSERT INTO ${table}_old SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_old RENAME TO ${table}; ${indexes.join('; ')};`);
  };
  db.exec('BEGIN');narrow('platform_prospect_outreach','sent_steps <= 5','sent_steps <= 3');narrow('platform_prospect_outreach_sends','step <= 4','step <= 2');db.exec('COMMIT');
  const now='2026-11-20T10:00:00.000Z';
  db.prepare('INSERT INTO platform_organizations VALUES(?,?,?)').run('org_1','Org',now);
  db.prepare('INSERT INTO platform_projects VALUES(?,?,?,?,?,?,?)').run('prj_1','org_1','Project','https://example.com','Europe/Istanbul','standard','[]');
  db.prepare('INSERT INTO platform_prospects(id,organization_id,project_id,company,website,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run('pro_1','org_1','prj_1','Clinic','https://clinic.example','u1',now,now);
  db.prepare(`INSERT INTO platform_prospect_outreach(id,prospect_id,organization_id,project_id,language,steps_json,channels_json,source,state,sent_steps,revision,created_by,created_at,updated_at)
    VALUES('out_1','pro_1','org_1','prj_1','tr','[]','[]','human','active',3,1,'u1',?,?)`).run(now,now);
  db.prepare("INSERT INTO platform_prospect_outreach_sends(id,outreach_id,organization_id,project_id,step,state,created_at,updated_at) VALUES('snd_1','out_1','org_1','prj_1',2,'delivered',?,?)").run(now,now);
  db.prepare("INSERT INTO platform_prospect_pipeline(prospect_id,organization_id,project_id,stage,currency,lost_reason,updated_by,updated_at) VALUES('pro_1','org_1','prj_1','contacted','TRY','','u1',?)").run(now);
  db.prepare("INSERT INTO platform_outreach_settings(organization_id,project_id,from_name,signature,calendar_url,follow_up_days) VALUES('org_1','prj_1','Team','','','[3,7]')").run();
  assert.throws(()=>db.prepare("UPDATE platform_prospect_outreach SET sent_steps=4").run(),/CHECK/,'the shipped 83 limit');
  assert.equal(db.prepare('SELECT MAX(version) v FROM platform_migrations').get().v,85);
  db.close();
}

test('schema 86 brings a shipped schema-83 database up to the sales follow-up without losing its rows',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ryzevo-86-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'platform.sqlite');
  shipped83(file);
  const db=openPlatformDatabase(file);
  try{
    assert.equal(db.prepare('SELECT MAX(version) v FROM platform_migrations').get().v,87);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],'the sends still point at their sequence');
    assert.equal(db.prepare('SELECT sent_steps FROM platform_prospect_outreach WHERE id=?').get('out_1').sent_steps,3);
    assert.equal(db.prepare('SELECT outreach_id FROM platform_prospect_outreach_sends WHERE id=?').get('snd_1').outreach_id,'out_1');
    assert.deepEqual({...db.prepare('SELECT qual_problem,qual_budget,qual_signer,next_step,next_step_at,stage_changed_at,feature_gap FROM platform_prospect_pipeline').get()},
      {qual_problem:'unknown',qual_budget:'unknown',qual_signer:'',next_step:'',next_step_at:null,stage_changed_at:null,feature_gap:''});
    assert.equal(db.prepare('SELECT weekly_goal FROM platform_outreach_settings').get().weekly_goal,25);
    db.prepare('UPDATE platform_prospect_outreach SET sent_steps=5').run();
    db.prepare("INSERT INTO platform_prospect_outreach_sends(id,outreach_id,organization_id,project_id,step,state,created_at,updated_at) VALUES('snd_5','out_1','org_1','prj_1',4,'reserved','x','x')").run();
    assert.throws(()=>db.prepare("INSERT INTO platform_prospect_outreach_sends(id,outreach_id,organization_id,project_id,step,state,created_at,updated_at) VALUES('snd_6','out_1','org_1','prj_1',5,'reserved','x','x')").run(),/CHECK/);
    assert.throws(()=>db.prepare('UPDATE platform_outreach_settings SET weekly_goal=0').run(),/CHECK/);
    assert.throws(()=>db.prepare("UPDATE platform_prospect_pipeline SET qual_problem='maybe'").run(),/CHECK/);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='platform_network_contacts'").get());
    for(const index of ['platform_prospect_outreach_due','platform_prospect_outreach_scope','platform_prospect_outreach_sends_recent','platform_network_contacts_company'])
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(index),index);
  }finally{db.close();}
});

test('a new database and an upgraded one end with the same tables and columns',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ryzevo-86-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'platform.sqlite');
  shipped83(file);
  const shape=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare(`PRAGMA table_info("${name}")`).all().map(c=>`${c.name} ${c.type} ${c.notnull} ${c.dflt_value} ${c.pk}`)]));
  const upgraded=openPlatformDatabase(file),fresh=openPlatformDatabase(':memory:');
  try{assert.deepEqual(shape(upgraded),shape(fresh));}finally{upgraded.close();fresh.close();}
});
