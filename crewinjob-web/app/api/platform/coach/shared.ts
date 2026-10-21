import { NextRequest,NextResponse } from 'next/server';
import { GoogleGenerativeAI,type GenerationConfig } from '@google/generative-ai';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { hasSameRequestOrigin } from '@/lib/platform/request-origin';
import { readBoundedJsonBytes } from '@/lib/platform/request-json';
import { MarketingStoreError } from '@/lib/platform/errors';
import type { CoachGenerator } from '@/lib/platform/coach';
import type { MarketingScope } from '@/lib/platform/marketing-store';
// Shared by the growth coach routes: session scope, same-origin writes, bounded JSON and the optional Gemini generator.
export async function coachBody(request:NextRequest){
  let input:unknown;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedJsonBytes(request,98304)));}catch{throw new MarketingStoreError('Geçersiz istek.');}
  if(!input||typeof input!=='object'||Array.isArray(input))throw new MarketingStoreError('Geçersiz istek.');return input as Record<string,unknown>;
}
// Gemini 2.5 and later spend "thinking" tokens from the output budget; without a cap long JSON answers were cut off
// (finishReason MAX_TOKENS). Thinking is capped and added on top of the answer budget.
const THINKING_BUDGET=1024;
export const coachGemini=(maxOutputTokens=6000):CoachGenerator|undefined=>{
  const key=process.env.PLATFORM_GEMINI_API_KEY,modelId=process.env.PLATFORM_GEMINI_MODEL;if(!key||!modelId)return undefined;
  const thinking=/gemini-(?:2\.5|[3-9])/.test(modelId);
  const generationConfig={temperature:0.4,maxOutputTokens:maxOutputTokens+(thinking?THINKING_BUDGET:0),responseMimeType:'application/json',...(thinking?{thinkingConfig:{thinkingBudget:THINKING_BUDGET}}:{})} as GenerationConfig;
  const model=new GoogleGenerativeAI(key).getGenerativeModel({model:modelId,generationConfig});
  return async prompt=>{const {response}=await model.generateContent(prompt,{timeout:30000}),meta=response.usageMetadata as {promptTokenCount?:number;candidatesTokenCount?:number;thoughtsTokenCount?:number;totalTokenCount?:number}|undefined;
    return {text:response.text(),usage:meta?{provider:'gemini',model:modelId,prompt:meta.promptTokenCount??0,output:meta.candidatesTokenCount??0,thinking:meta.thoughtsTokenCount??0,total:meta.totalTokenCount??0}:null};};
};
export function coachRoute(run:(scope:MarketingScope,request:NextRequest)=>Promise<unknown>){
  return async (request:NextRequest)=>{const headers={'Cache-Control':'private, no-store'};try{
    const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    if(request.method!=='GET'&&!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    return NextResponse.json(await run({subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},request),{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Büyüme koçu şu anda yüklenemedi. Mevcut araçlarınızı kullanmaya devam edebilirsiniz.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}};
}
