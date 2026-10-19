import { NextRequest,NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
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
export const coachGemini=(maxOutputTokens=6000):CoachGenerator|undefined=>{
  const key=process.env.PLATFORM_GEMINI_API_KEY,modelId=process.env.PLATFORM_GEMINI_MODEL;if(!key||!modelId)return undefined;
  const model=new GoogleGenerativeAI(key).getGenerativeModel({model:modelId,generationConfig:{temperature:0.4,maxOutputTokens,responseMimeType:'application/json'}});
  return async prompt=>(await model.generateContent(prompt,{timeout:30000})).response.text();
};
export function coachRoute(run:(scope:MarketingScope,request:NextRequest)=>Promise<unknown>){
  return async (request:NextRequest)=>{const headers={'Cache-Control':'private, no-store'};try{
    const access=await getPlatformAccess();if(!access||access.identity.mode!=='platform')return NextResponse.json({error:'Proje oturumu gerekli.'},{status:403,headers});
    if(request.method!=='GET'&&!hasSameRequestOrigin(request))return NextResponse.json({error:'İstek kaynağı geçersiz.'},{status:403,headers});
    return NextResponse.json(await run({subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},request),{headers});
  }catch(error){return NextResponse.json({error:error instanceof MarketingStoreError?error.message:'Büyüme koçu şu anda yüklenemedi. Mevcut araçlarınızı kullanmaya devam edebilirsiniz.'},{status:error instanceof MarketingStoreError?error.status:400,headers});}};
}
