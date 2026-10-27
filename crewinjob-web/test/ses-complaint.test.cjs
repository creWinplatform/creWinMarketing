const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
// Legacy panel: SES spam complaints → Crewin backend (contract of 27 October 2026). The backend is a stub; nothing leaves.
const {complaintTasks,suppressionOutcome,COMPLAINT_LABELS}=load('../ses-complaint.ts');
function stub(answers={}){
 const calls=[],records=[];
 const api={
  trackActivationEvent:async(...args)=>{calls.push(['TrackActivationEvent',...args]);},
  growthAnalyticsPost:async(endpoint,body)=>{calls.push([endpoint,body]);const answer=answers[endpoint];if(answer instanceof Error)throw answer;return typeof answer==='function'?answer(body):answer;},
  growthAnalyticsPublicPost:async(endpoint,body)=>{calls.push(['public:'+endpoint,body]);const answer=answers['public:'+endpoint];if(typeof answer==='function')return answer(body);if(answer instanceof Error)throw answer;return answer;},
 };
 return {api,calls,records,record:(outcome,detail)=>{records.push([outcome,detail]);}};
}
const run=async tasks=>{for(const task of tasks)await task().catch(()=>undefined);};
const base={recipients:['ayse.kaya@example.com'],userId:42,campaignId:'camp-1',token:null,feedbackType:'abuse',providerMessageId:'ses-msg-1',eventId:'feedback-1'};

test('a complaint without a token is suppressed with SuppressContact and email_complained is tracked',async()=>{
 const s=stub({SuppressContact:{success:true,status:'ok'},TrackCampaignDeliveryEvent:{}});
 await run(complaintTasks(base,s.api,s.record));
 const track=s.calls.find(call=>call[0]==='TrackActivationEvent');assert.equal(track[1],'email_complained');assert.equal(track[2],42);assert.equal(track[4],'ses-webhook');
 const suppress=s.calls.find(call=>call[0]==='SuppressContact')[1];
 assert.deepEqual(JSON.parse(JSON.stringify(suppress)),{userId:42,email:'ayse.kaya@example.com',channel:'email',reason:'complaint',campaignId:'camp-1',providerEventId:'feedback-1:0'});
 assert.ok(s.calls.some(call=>call[0]==='TrackCampaignDeliveryEvent'&&call[1].eventType==='complained'));
 assert.deepEqual(s.records,[['ok','ay***@example.com']],'the activity log gets the masked address only');
});

test('ok, not_found and invalid are recorded separately; failures and unknown answers are errors',async()=>{
 for(const [answer,outcome] of [[{status:'ok'},'ok'],[{status:'not_found'},'not_found'],[{status:'invalid'},'invalid'],[{status:'weird'},'error'],[new Error('HTTP 500'),'error']]){
  const s=stub({SuppressContact:answer});await run(complaintTasks({...base,userId:null,campaignId:null},s.api,s.record));
  assert.deepEqual(s.records.map(item=>item[0]),[outcome]);
 }
 assert.equal(new Set(['ok','not_found','invalid','error','unsubscribed'].map(key=>COMPLAINT_LABELS[key])).size,5,'each outcome has its own label');
 assert.equal(suppressionOutcome(null),'error');
});

test('with several recipients only the address is sent, each with its own event id; no userId means no activation event',async()=>{
 const s=stub({SuppressContact:{status:'ok'}});
 await run(complaintTasks({...base,userId:42,recipients:['a@example.com','b@example.com']},s.api,s.record));
 const bodies=s.calls.filter(call=>call[0]==='SuppressContact').map(call=>call[1]);
 assert.equal(bodies.length,2);assert.ok(bodies.every(body=>!('userId' in body)));assert.deepEqual(bodies.map(body=>body.providerEventId),['feedback-1:0','feedback-1:1']);
 const t=stub({SuppressContact:{status:'ok'}});await run(complaintTasks({...base,userId:null},t.api,t.record));
 assert.ok(!t.calls.some(call=>call[0]==='TrackActivationEvent'||call[0]==='TrackCampaignDeliveryEvent'));
});

test('a complaint with the unsubscribe token goes to ProcessUnsubscribe with reason complaint, falling back on 400',async()=>{
 const s=stub({'public:ProcessUnsubscribe':{}});
 await run(complaintTasks({...base,token:'opaque-token'},s.api,s.record));
 assert.deepEqual(JSON.parse(JSON.stringify(s.calls.find(call=>call[0]==='public:ProcessUnsubscribe')[1])),{token:'opaque-token',channel:'email',reason:'complaint'});
 assert.ok(!s.calls.some(call=>call[0]==='SuppressContact'),'the token path does not also call SuppressContact');assert.deepEqual(s.records.map(item=>item[0]),['unsubscribed']);
 let first=true;const u=stub({'public:ProcessUnsubscribe':body=>{if(first){first=false;throw Object.assign(new Error('HTTP 400'),{status:400});}return body;}});
 await run(complaintTasks({...base,token:'opaque-token'},u.api,u.record));
 assert.deepEqual(u.calls.filter(call=>call[0]==='public:ProcessUnsubscribe').map(call=>call[1].reason),['complaint','user_request']);
 const e=stub({'public:ProcessUnsubscribe':Object.assign(new Error('HTTP 503'),{status:503})});await run(complaintTasks({...base,token:'opaque-token'},e.api,e.record));
 assert.deepEqual(e.records.map(item=>item[0]),['error']);
});
