// Disposable growth-coach fixtures for Phase 2 tests; never loaded by application code.
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{GrowthCoach}=load('coach.ts');
const answers={offer:'Online bookkeeping software for small shops',customer:'Independent shop owners',market:'b2b',price:'high',sales:'sales',current:['website','linkedin'],hours:'2to5',skills:['writing'],obstacle:'start',success:'Ten qualified demo requests'};
const goals=[{id:'demo',label:{tr:'Talep',en:'Demand'},audience:{tr:'Kitle',en:'Audience'},stages:[{tr:'Ziyaret',en:'Visit'},{tr:'Talep',en:'Request'}]}];
const plain=value=>JSON.parse(JSON.stringify(value));
const coachRun=fn=>async()=>{
  const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
  const provision=username=>repo.provision('legacy-admin',{organizationName:username,projectName:username,website:'https://example.com',username,password:'fixture-password-123'}),a=provision('alpha'),b=provision('beta');
  const scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId},other={subject:b.userId,organizationId:b.organizationId,projectId:b.projectId};
  const member=role=>({...scope,subject:repo.addMember(scope.subject,a.organizationId,a.projectId,{username:`coach-${role}`,password:'fixture-password-123',role}).userId});
  const f={db,repo,a,scope,other,member,coach:new GrowthCoach(db,scope),answers,plain};
  f.setGoals=(list=goals)=>{const project=repo.workspace(scope.subject,a.organizationId,a.projectId).project;repo.updateProject(scope.subject,a.organizationId,a.projectId,{name:project.name,website:project.website,timezone:project.timezone,language:'en',brandVoice:'Clear',goals:list});};
  f.approve=async(input={},language='en')=>{const drafted=await f.coach.diagnose({answers:{...answers,...input},language,mode:'template',expectedRevision:f.coach.read().revision});return f.coach.approve({brief:drafted.draft,expectedRevision:drafted.revision});};
  f.aiUsage=()=>db.prepare("SELECT COALESCE(SUM(count),0) n FROM platform_usage WHERE organization_id=? AND project_id=? AND resource='ai'").get(a.organizationId,a.projectId).n;
  f.reserved=()=>db.prepare("SELECT COUNT(*) n FROM platform_usage_reservations WHERE status='reserved'").get().n;
  try{await fn(f);}finally{db.close();}
};
module.exports={coachRun,answers,goals,plain};
