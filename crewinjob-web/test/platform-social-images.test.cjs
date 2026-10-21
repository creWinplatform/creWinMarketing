const assert=require('node:assert/strict');
const {test}=require('node:test');
const {load}=require('./platform-loader.cjs');
const {publishLinkedInImage,publishLinkedInOrganizationImage,publishXImage}=load('social-image-publishing.ts');
Object.assign(process.env,{PLATFORM_LINKEDIN_CLIENT_ID:'fixture-li-app',PLATFORM_LINKEDIN_CLIENT_SECRET:'fixture-li-secret',PLATFORM_LINKEDIN_REDIRECT_URI:'http://localhost:3033/api/platform/social/callback',PLATFORM_LINKEDIN_API_VERSION:'202609'});
const image={data:Buffer.from('fixture-jpeg-bytes').toString('base64'),digest:'d'.repeat(64),width:1080,height:1080,bytes:18};
// Disposable provider: answers by URL, records each request. No network is used.
const stub=(answers)=>{const calls=[],original=globalThis.fetch;globalThis.fetch=async(url,options={})=>{const href=String(url);calls.push({href,method:options.method,headers:options.headers,body:options.body});
  for(const [match,answer] of answers)if(href.includes(match)){if(answer instanceof Error)throw answer;return typeof answer==='function'?answer():answer;}return new Response('',{status:404});};
  return {calls,restore:()=>{globalThis.fetch=original;}};};
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});

test('LinkedIn: the image is uploaded before the post is reserved; the post carries the image urn',async()=>{
  let reserved=0;const api=stub([['images?action=initializeUpload',()=>json({value:{uploadUrl:'https://www.linkedin.com/dms-uploads/abc/uploaded-image/0?ut=1',image:'urn:li:image:C4E10AQFixture'}})],['dms-uploads',()=>new Response(null,{status:201})],['/rest/posts',()=>new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:7000000000000000001'}})]]);
  try{
    const result=await publishLinkedInOrganizationImage('fixture-token','123456','Yeni dönem başladı.',image,()=>{reserved++;return true;});
    assert.deepEqual({...result},{state:'accepted',postId:'urn:li:share:7000000000000000001'});assert.equal(reserved,1);
    assert.deepEqual(api.calls.map(call=>call.method),['POST','PUT','POST'],'upload, then the post');
    assert.equal(JSON.parse(api.calls[0].body).initializeUploadRequest.owner,'urn:li:organization:123456');assert.equal(api.calls[0].headers['LinkedIn-Version'],'202609');
    const post=JSON.parse(api.calls[2].body);assert.equal(post.content.media.id,'urn:li:image:C4E10AQFixture');assert.equal(post.author,'urn:li:organization:123456');
  }finally{api.restore();}
  const foreign=stub([['images?action=initializeUpload',()=>json({value:{uploadUrl:'https://evil.example/upload',image:'urn:li:image:X'}})]]);
  try{let reserved2=0;assert.equal((await publishLinkedInImage('t','member1','x',image,()=>{reserved2++;return true;})).state,'blocked');assert.equal(reserved2,0,'an upload address outside linkedin.com is refused before anything is reserved');assert.equal(foreign.calls.length,1);}finally{foreign.restore();}
  const lost=stub([['images?action=initializeUpload',()=>json({value:{uploadUrl:'https://www.linkedin.com/dms-uploads/a',image:'urn:li:image:A'}})],['dms-uploads',()=>new Response(null,{status:201})],['/rest/posts',new Error('reset')]]);
  try{assert.equal((await publishLinkedInImage('t','member1','x',image,()=>true)).state,'uncertain','a lost post answer is uncertain, never retried');assert.equal(lost.calls.filter(c=>c.href.includes('/rest/posts')).length,1);}finally{lost.restore();}
});
test('X: one-shot media upload with media.write, then the post with that media id',async()=>{
  const api=stub([['/2/media/upload',()=>json({data:{id:'1880000000000000001',media_key:'3_188'}})],['/2/tweets',()=>json({data:{id:'1880000000000000002',text:'x'}},201)]]);
  try{
    const result=await publishXImage('fixture-token','1234567890','Yeni dönem başladı.',image,()=>true);assert.deepEqual({...result},{state:'accepted',postId:'1880000000000000002'});
    const upload=JSON.parse(api.calls[0].body);assert.equal(upload.media_category,'tweet_image');assert.equal(upload.media,image.data);assert.equal(api.calls[0].headers.Authorization,'Bearer fixture-token');
    assert.deepEqual(JSON.parse(api.calls[1].body).media.media_ids,['1880000000000000001']);
  }finally{api.restore();}
  const refused=stub([['/2/media/upload',()=>json({errors:[{}]},403)]]);
  try{let reserved=0;assert.equal((await publishXImage('t','1234567890','x',image,()=>{reserved++;return true;})).state,'blocked');assert.equal(reserved,0,'a refused upload never reserves the post');}finally{refused.restore();}
});
