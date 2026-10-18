const {randomBytes,createHmac}=require('node:crypto');
const {load}=require('./platform-loader.cjs');
const {openPlatformDatabase}=load('database.ts'),{PlatformRepository}=load('repository.ts'),{ProjectMarketingStore}=load('marketing-store.ts'),{ConnectionJobs}=load('connection-jobs.ts');
const {EmailSenders}=load('email-sender.ts'),{EmailRecipients}=load('email-recipients.ts'),{ProductWebhooks,authenticateProductWebhook}=load('product-webhooks.ts'),{ProductSegments}=load('segments.ts'),{CampaignReviews}=load('campaign-review.ts'),{EmailPilotQueue}=load('email-pilots.ts');
const KEY='12'.repeat(32);
function fixture(){
 const db=openPlatformDatabase(':memory:'),repo=new PlatformRepository(db);repo.bootstrapLegacy('admin');
 const provision=username=>repo.provision('legacy-admin',{organizationName:username,projectName:username,website:'https://example.com',username,password:'fixture-password-123'}),a=provision('alpha'),b=provision('beta'),scope={subject:a.userId,organizationId:a.organizationId,projectId:a.projectId},other={subject:b.userId,organizationId:b.organizationId,projectId:b.projectId};
 const store=new ProjectMarketingStore(db,scope),senders=new EmailSenders(db,scope,KEY),connection=store.saveConnection({provider:'email',integrationId:'fixture-smtp',accountName:'QA SMTP',accessToken:'private-smtp-password',smtp:{host:'smtp.sendgrid.net',port:587,user:'fixture-user',fromEmail:'hello@example.com',fromName:'Fixture'}},KEY);
 senders.select({connectionId:connection.id,maxRecipients:5,expectedRevision:0});
 const hooks=new ProductWebhooks(db,scope),secret=randomBytes(32).toString('hex'),source=hooks.save({name:'Pilot contacts',secret,config:{entityType:'user',attributes:[{key:'email',type:'string'},{key:'completion',type:'number'}],eventNames:['profile.updated']}},KEY),at=new Date(Date.now()-10000).toISOString();
 const events=Array.from({length:7},(_,i)=>({id:`event-${i}`,entityId:`private-${i}`,eventName:'profile.updated',occurredAt:at,attributes:{email:`pilot${i}@example.com`,completion:20}})),body={sourceVersion:1,events};hooks.preview(source.id,body);hooks.state(source.id,1,'activate');const bytes=Buffer.from(JSON.stringify(body)),timestamp=String(Math.floor(Date.now()/1000)),headers=new Headers({'X-Ryzevo-Timestamp':timestamp,'X-Ryzevo-Signature':'v1='+createHmac('sha256',Buffer.from(secret,'hex')).update(`${timestamp}.${source.id}.`).update(bytes).digest('hex')});authenticateProductWebhook(db,source.id,headers,KEY)(bytes);
 const recipients=new EmailRecipients(db,scope,KEY);recipients.saveMapping({sourceId:source.id,sourceVersion:1,field:'email',expectedRevision:null});
 for(let i=0;i<7;i++)senders.allow({email:`pilot${i}@example.com`,acknowledged:true,expectedRevision:senders.get().readiness.revision});
 for(const contact of recipients.list(source.id).contacts)recipients.review({sourceId:source.id,contactKey:contact.key,expectedDecisionId:null,decision:'reviewed',evidenceRef:'qa/consent',recordedAt:at,note:'Disposable fixture proof.',acknowledged:true});
 const segments=new ProductSegments(db,scope),segment=segments.save({name:'Pilot audience',definition:{sourceId:source.id,sourceVersion:1,maxAgeHours:24,goalId:'',stageIndex:null,rules:{kind:'group',op:'and',children:[{kind:'attribute',field:'completion',op:'lt',value:50}]}}});segments.preview({id:segment.id,version:1});
 const campaign={id:'pilot-campaign',name:'Pilot',status:'draft',updatedAt:new Date().toISOString(),content:{subject:'QA pilot',text:'Only a fixture.',ctaUrl:'https://example.com'},channels:{email:true,social:[],whatsapp:false,telegram:false,paidAds:[]},segmentBinding:segments.binding(segment.id,1,'')};store.saveCampaign(campaign,true);
 const queue=new EmailPilotQueue(db,scope,KEY),reviews=new CampaignReviews(db,scope,KEY);
 const approve=(who=reviews)=>{const checked=who.check(campaign.id,who.get(campaign.id).digest);return who.decide(campaign.id,{decision:'approved',expectedDigest:checked.digest,expectedReviewId:checked.history[0]?.id||null,note:'Disposable fixture; no email.'});};
 const input=(review,key='fixture-idempotency')=>({campaignId:campaign.id,expectedDigest:review.digest,expectedReviewId:review.history[0].id,idempotencyKey:key,acknowledged:true});
 return {db,repo,a,b,scope,other,store,senders,connection,hooks,source,recipients,segments,segment,campaign,queue,reviews,approve,input,KEY,ConnectionJobs,EmailPilotQueue,CampaignReviews};
}
module.exports={fixture,KEY};
