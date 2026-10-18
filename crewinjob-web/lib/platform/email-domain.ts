import 'server-only';
import {createHash} from 'node:crypto';
import {Resolver} from 'node:dns/promises';

export function senderDomain(value:string){
  const domain=value.toLowerCase();
  if(domain.length>232||!domain.includes('.')||!/^[a-z0-9.-]+\.[a-z]{2,63}$/.test(domain)||domain.split('.').some(label=>!label||label.length>63||!/^([a-z0-9]|[a-z0-9][a-z0-9-]*[a-z0-9])$/.test(label))||/\.(localhost|local|internal|lan|home|onion|invalid|test)$/.test(domain))throw new Error('Invalid sender domain.');
  return domain;
}
export const domainRecordName=(domain:string)=>`_ryzevo-verification.${senderDomain(domain)}`;
export type TxtResolver={resolveTxt(name:string):Promise<string[][]>;cancel():void};
const resolver=():TxtResolver=>new Resolver({timeout:2000,tries:1});
export async function checkSenderDomain(domain:string,expectedHash:string,create:()=>TxtResolver=resolver):Promise<{verified:boolean;error:''|'not_found'|'unavailable'|'too_large'}>{
  const name=domainRecordName(domain);if(!/^[a-f0-9]{64}$/.test(expectedHash))throw new Error('Invalid challenge.');
  const dns=create();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const records=await Promise.race([dns.resolveTxt(name),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{dns.cancel();reject(new Error('DNS timeout.'));},4000);})]);
    if(!Array.isArray(records)||records.length>64||records.some(record=>!Array.isArray(record)||record.length>32||record.some(chunk=>typeof chunk!=='string'))||records.reduce((n,record)=>n+record.join('').length,0)>32768)return {verified:false,error:'too_large'};
    const verified=records.some(record=>createHash('sha256').update(record.join('')).digest('hex')===expectedHash);
    return {verified,error:verified?'':'not_found'};
  }catch(error){const code=(error as {code?:string})?.code;return {verified:false,error:code==='ENODATA'||code==='ENOTFOUND'?'not_found':'unavailable'};}
  finally{if(timer)clearTimeout(timer);dns.cancel();}
}
