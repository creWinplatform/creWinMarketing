import 'server-only';
import type Database from 'better-sqlite3';
import type { MarketingScope } from './marketing-store';
import { MarketingStoreError } from './errors';
import { ProjectOperations } from './operations';
import type { CoachGenerator } from './coach';

// Parses a JSON-only model answer; prose or broken JSON is a provider error, never a partial result.
export function parseCoachJson(output:string):Record<string,unknown>{
  try{const value=JSON.parse(output.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));if(value&&typeof value==='object'&&!Array.isArray(value))return value;}catch{/* handled below */}
  throw new MarketingStoreError('AI yanıtı okunamadı. Başlangıç şablonunu kullanın veya tekrar deneyin.',502);
}
// One AI call under a usage reservation: completed together with the write, refunded on any failure.
export async function runCoachAi<T,R>(db:Database.Database,scope:MarketingScope,generator:CoachGenerator,prompt:string,parse:(output:string)=>T,commit:(value:T)=>R):Promise<R>{
  const operations=new ProjectOperations(db,scope),reservation=operations.reserveAi();let completed=false;
  try{
    const output=await generator(prompt),text=typeof output==='string'?output:output.text,usage=typeof output==='string'?null:output.usage||null;
    const value=parse(text);
    const result=db.transaction(()=>{const written=commit(value);operations.completeAi(reservation);if(usage)recordAiUsage(db,scope,reservation,usage);return written;}).immediate();
    completed=true;return result;
  }catch(error){
    if(!completed){try{operations.refundAi(reservation);}catch{console.error('platform_usage_release_failed');}}
    throw error instanceof MarketingStoreError?error:new MarketingStoreError('AI önerisi hazırlanamadı. Başlangıç şablonunu kullanabilir veya tekrar deneyebilirsiniz.',502);
  }
}

// Stores provider-reported token counts; values that are not plain non-negative integers are not stored at all.
export function recordAiUsage(db:Database.Database,scope:MarketingScope,reservation:{id:string;period:string},usage:{provider:string;model:string;prompt:number;output:number;thinking:number;total:number}){
  const counts=[usage.prompt,usage.output,usage.thinking,usage.total];if(!counts.every(value=>Number.isSafeInteger(value)&&value>=0)||!/^[a-z0-9._-]{1,40}$/i.test(usage.provider)||!/^[a-z0-9._:-]{1,80}$/i.test(usage.model))return;
  db.prepare('INSERT INTO platform_ai_provider_usage(organization_id,project_id,period,reservation_id,provider,model,prompt_tokens,output_tokens,thinking_tokens,total_tokens,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(scope.organizationId,scope.projectId,reservation.period,reservation.id,usage.provider,usage.model,...counts,new Date().toISOString());
}
