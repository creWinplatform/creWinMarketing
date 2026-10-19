import { NextRequest,NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readBoundedJsonBytes } from '@/lib/platform/request-json';
import { MarketingStoreError } from '@/lib/platform/errors';
import { GrowthCoach,type CoachGenerator } from '@/lib/platform/coach';
export const dynamic='force-dynamic';
export const maxDuration=40;
async function body(request:NextRequest){
  let input:unknown;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedJsonBytes(request,98304)));}catch{throw new MarketingStoreError('Geçersiz istek.');}
  if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz istek.');return input as Record<string,unknown>;
}
const gemini=():CoachGenerator|undefined=>{
  const key=process.env.PLATFORM_GEMINI_API_KEY,modelId=process.env.PLATFORM_GEMINI_MODEL;if(!key||!modelId)return undefined;
  const model=new GoogleGenerativeAI(key).getGenerativeModel({model:modelId,generationConfig:{temperature:0.4,maxOutputTokens:6000,responseMimeType:'application/json'}});
  return async prompt=>(await model.generateContent(prompt,{timeout:30000})).response.text();
};
async function handle(request:NextRequest){const headers={'Cache-Control':'private, no-store'};try{
  const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
  if(request.method!=='GET'&&!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
  const coach=new GrowthCoach(platformDatabase(),{subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId});coach.authorize();
  if(request.method==='GET')return NextResponse.json(coach.read(),{headers});
  const raw=await body(request);let result:unknown;
  if(raw.action==='diagnose')result=await coach.diagnose(raw,raw.mode==='ai'?gemini():undefined);
  else if(raw.action==='save')result=coach.saveDraft(raw);
  else if(raw.action==='approve')result=coach.approve(raw);
  else if(raw.action==='act')result=coach.act(raw);
  else if(raw.action==='schedule')result=coach.schedule(raw);
  else throw new MarketingStoreError('Geçersiz büyüme koçu işlemi.');
  return NextResponse.json(result,{headers});
}catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Büyüme koçu şu anda yüklenemedi. Mevcut araçlarınızı kullanmaya devam edebilirsiniz.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}}
export const GET=handle,POST=handle;
