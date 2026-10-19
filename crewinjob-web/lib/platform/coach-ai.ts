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
    const value=parse(await generator(prompt));
    const result=db.transaction(()=>{const written=commit(value);operations.completeAi(reservation);return written;}).immediate();
    completed=true;return result;
  }catch(error){
    if(!completed){try{operations.refundAi(reservation);}catch{console.error('platform_usage_release_failed');}}
    throw error instanceof MarketingStoreError?error:new MarketingStoreError('AI önerisi hazırlanamadı. Başlangıç şablonunu kullanabilir veya tekrar deneyebilirsiniz.',502);
  }
}
