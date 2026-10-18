import 'server-only';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type net from 'node:net';
import type Mail from 'nodemailer/lib/mailer';
import {normalizeSmtpConfiguration,type SmtpConfiguration} from './email-configuration';
import {connectPinnedSmtp,smtpTransportOptions} from './email-connection';
import {resolvePublicAddress} from '../site-audit';
import {emailAddress} from './email-safety';

export type PilotMail={from:{name:string;address:string};to:string;subject:string;text:string;html:string;messageId:string;date:string;headers:Record<string,string>};
export type DeliveryResult={state:'accepted'|'rejected'|'uncertain'|'blocked';providerMessageId:string|null};
export type PilotDelivery=(smtp:SmtpConfiguration,password:string,mail:PilotMail,beforeSubmit:()=>boolean)=>Promise<DeliveryResult>;
type Transport={sendMail(message:Mail.Options):Promise<{accepted?:unknown[];rejected?:unknown[];response?:string}>;close():void};
const createTransport=(options:SMTPTransport.Options):Transport=>nodemailer.createTransport(options);
export async function submitSmtpPilot(raw:SmtpConfiguration,password:string,mail:PilotMail,beforeSubmit:()=>boolean,resolve=resolvePublicAddress,create=createTransport,connect=connectPinnedSmtp):Promise<DeliveryResult>{
  let socket:net.Socket|undefined,transport:Transport|undefined,timer:ReturnType<typeof setTimeout>|undefined,submitted=false,expired=false;
  const expiresAt=Date.now()+18000;
  try{
    const settings=normalizeSmtpConfiguration(raw);
    if(emailAddress(mail.to)!==mail.to||emailAddress(mail.from.address)!==settings.fromEmail.toLowerCase()||typeof password!=='string'||!password||/[\r\n\x00]/.test(password))throw new Error('Invalid message.');
    const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;socket?.destroy();transport?.close();reject(new Error('deadline'));},18000);});
    return await Promise.race([(async():Promise<DeliveryResult>=>{
      const address=await resolve(new URL(`https://${settings.host}/`));if(expired||Date.now()>=expiresAt)throw new Error('deadline');socket=await connect(address.address,settings.port);if(expired||Date.now()>=expiresAt){socket.destroy();throw new Error('deadline');}transport=create(smtpTransportOptions(settings,address.address,socket,password));
      if(!beforeSubmit())return {state:'blocked',providerMessageId:null};
      submitted=true;
      if(expired||Date.now()>=expiresAt)throw new Error('deadline');
      const result=await transport.sendMail({...mail,date:new Date(mail.date),envelope:{from:settings.fromEmail,to:[mail.to]},disableFileAccess:true,disableUrlAccess:true,attachDataUrls:false});
      if(result.accepted?.length!==1||result.accepted[0]!==mail.to||result.rejected?.length)return {state:'uncertain',providerMessageId:null};
      const messageId=/^250\s+Ok\s+([A-Za-z0-9_-]{1,200})\s*$/i.exec(result.response||'')?.[1]||null;
      return {state:'accepted',providerMessageId:messageId};
    })(),deadline]);
  }catch(error){
    const e=error as {code?:string;responseCode?:number};
    return {state:!submitted?'blocked':e.code==='EAUTH'||Number(e.responseCode)>=500?'rejected':'uncertain',providerMessageId:null};
  }finally{if(timer)clearTimeout(timer);socket?.destroy();transport?.close();}
}

const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function preparePilotMail(input:{fromEmail:string;fromName:string;to:string;subject:string;text:string;ctaUrl:string;brand:string;language:'tr'|'en';unsubscribeUrl:string;configurationSet:string;jobId:string;position:number;attemptId:string;createdAt:string}):PilotMail{
  for(const value of [input.unsubscribeUrl,input.ctaUrl]){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||/[\r\n\x00]/.test(value))throw new Error('Unsafe message URL.');}
  if(!emailAddress(input.fromEmail)||!emailAddress(input.to)||/[\r\n\x00]/.test(input.subject)||input.subject.length>200||!/^\w[\w-]{0,63}$/.test(input.configurationSet))throw new Error('Invalid message.');
  const tr=input.language==='tr',unsubscribe=tr?'Abonelikten çık':'Unsubscribe';
  return {from:{address:input.fromEmail,name:input.fromName},to:input.to,subject:input.subject,
    text:`${input.text}\n\n${input.ctaUrl}\n\n${unsubscribe}: ${input.unsubscribeUrl}`,
    html:`<!doctype html><html lang="${input.language}"><meta charset="utf-8"><body style="margin:0;background:#f3f5f1;font-family:Arial,sans-serif;color:#20271c"><main style="max-width:600px;margin:0 auto;padding:32px 24px;background:white"><header style="font-size:20px;font-weight:bold">${escape(input.brand)}</header><h1 style="font-size:24px">${escape(input.subject)}</h1><p style="font-size:15px;line-height:1.8">${escape(input.text).replace(/\r?\n/g,'<br>')}</p><p><a href="${escape(input.ctaUrl)}">${tr?'Devam et':'Continue'}</a></p><footer style="margin-top:32px;font-size:12px"><a href="${escape(input.unsubscribeUrl)}">${unsubscribe}</a></footer></main></body></html>`,
    messageId:`<${input.attemptId}@${input.fromEmail.split('@')[1]}>`,date:input.createdAt,
    headers:{'List-Unsubscribe':`<${input.unsubscribeUrl}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click','X-SES-CONFIGURATION-SET':input.configurationSet,'X-SES-MESSAGE-TAGS':`ryzevoJob=${input.jobId}, ryzevoPosition=${input.position}, ryzevoAttempt=${input.attemptId}`}};
}
