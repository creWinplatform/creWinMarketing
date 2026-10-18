import 'server-only';
import {createHash} from 'node:crypto';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';

export function normalizeAccountEmail(value:unknown) {
  if(typeof value!=='string'||value.length>160)throw new Error('Invalid email.');
  const email=value.trim().toLowerCase();
  if(!/^[a-z0-9](?:[a-z0-9._+\-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)||email.includes('..'))throw new Error('Invalid email.');
  return email;
}
export function identityEmailConfiguration(){
  try{
    if(process.env.PLATFORM_AUTH_EMAIL_ENABLED!=='1')return null;
    const origin=new URL(process.env.PLATFORM_AUTH_ORIGIN||'');
    if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||(origin.protocol!=='https:'&&!(origin.protocol==='http:'&&['localhost','127.0.0.1','127.0.0.2'].includes(origin.hostname))))return null;
    const region=process.env.PLATFORM_AUTH_SES_REGION||'',from=normalizeAccountEmail(process.env.PLATFORM_AUTH_FROM_EMAIL),accessKeyId=process.env.PLATFORM_AUTH_SES_ACCESS_KEY_ID||'',secretAccessKey=process.env.PLATFORM_AUTH_SES_SECRET_ACCESS_KEY||'';
    if(!/^[a-z]{2}-[a-z]+-\d$/.test(region)||!/^AKIA[A-Z0-9]{16}$/.test(accessKeyId)||!/^[A-Za-z0-9/+=]{40}$/.test(secretAccessKey))return null;
    const revision=createHash('sha256').update(JSON.stringify([origin.origin,region,from,accessKeyId,secretAccessKey])).digest('hex');
    return {origin:origin.origin,region,from,accessKeyId,secretAccessKey,revision};
  }catch{return null;}
}
export type IdentityEmail={to:string;kind:'verify'|'reset'|'signup';token:string;language:'tr'|'en'};
export function identityEmailMessage(mail:IdentityEmail,origin:string){
  const tr=mail.language==='tr',path=mail.kind==='reset'?'/recover':mail.kind==='signup'?'/register':'/account/verify';
  const link=`${origin}${path}#token=${encodeURIComponent(mail.token)}`;
  const subject=mail.kind==='reset'?(tr?'Ryzevo şifre sıfırlama':'Reset your Ryzevo password'):(tr?'Ryzevo e-posta doğrulama':'Verify your Ryzevo email');
  const text=tr?`${subject}\n\nDevam etmek için bağlantıyı açın:\n${link}\n\nBu bağlantı 30 dakika geçerlidir ve bir kez kullanılabilir. Bu işlemi siz başlatmadıysanız e-postayı yok sayın.`:`${subject}\n\nOpen this link to continue:\n${link}\n\nThis single-use link expires in 30 minutes. Ignore this email if you did not request it.`;
  return {subject,text};
}
export type IdentityDelivery=(mail:IdentityEmail,configuration:NonNullable<ReturnType<typeof identityEmailConfiguration>>)=>Promise<void>;
type IdentitySesClient={send(command:SendEmailCommand,options:{abortSignal:AbortSignal}):Promise<{MessageId?:string}>;destroy():void};
export async function deliverIdentityEmail(mail:IdentityEmail,configuration:NonNullable<ReturnType<typeof identityEmailConfiguration>>,createClient:(configuration:NonNullable<ConstructorParameters<typeof SESv2Client>[0]>)=>IdentitySesClient=options=>new SESv2Client(options)){
  const message=identityEmailMessage(mail,configuration.origin);
  const client=createClient({region:configuration.region,endpoint:`https://email.${configuration.region}.amazonaws.com`,credentials:{accessKeyId:configuration.accessKeyId,secretAccessKey:configuration.secretAccessKey},maxAttempts:1});
  try{
    const result=await client.send(new SendEmailCommand({FromEmailAddress:configuration.from,Destination:{ToAddresses:[mail.to]},ConfigurationOverrides:{Tracking:{ClickTrackingEnabled:'DISABLED',OpenTrackingEnabled:'DISABLED'}},Content:{Simple:{Subject:{Data:message.subject,Charset:'UTF-8'},Body:{Text:{Data:message.text,Charset:'UTF-8'}}}}}),{abortSignal:AbortSignal.timeout(8000)});
    if(!result.MessageId)throw new Error('Unconfirmed delivery.');
  }finally{client.destroy();}
}
