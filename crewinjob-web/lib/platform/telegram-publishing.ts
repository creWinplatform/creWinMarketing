import 'server-only';
import { readSocialJson, readSocialResponse } from './social-connection';
import type { PublishCheck, PublishTransport } from './linkedin-publishing';

// Telegram channel publishing through the project's own bot (Bot API). The bot only posts to the one channel it was
// connected to; it never reads private chats or groups. Text only, up to 4096 characters.
export const TELEGRAM_TEXT_LIMIT=4096;
export const telegramChannel=(value:unknown):value is string=>typeof value==='string'&&/^(-100\d{6,15}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(value);
export const telegramToken=(value:unknown):value is string=>typeof value==='string'&&/^\d{5,15}:[A-Za-z0-9_-]{30,64}$/.test(value);
export const telegramPostId=(value:unknown):value is string=>typeof value==='string'&&/^-?\d{1,20}:\d{1,12}$/.test(value);
// No server-side app registration is needed; the revision pins the Bot API contract this adapter was written for.
export const telegramPublishingConfiguration=()=>({revision:'telegram:bot-api:v1'});
const api=(token:string,method:string)=>`https://api.telegram.org/bot${token}/${method}`;
const call=async(token:string,method:string,body?:Record<string,unknown>)=>{
  const payload=await readSocialJson(api(token,method),'',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)}:{signal:AbortSignal.timeout(8000)});
  if(payload.ok!==true||!payload.result||typeof payload.result!=='object')throw new Error('Telegram request failed.');
  return payload.result as Record<string,unknown>;
};
// Connection check: the token belongs to a bot and the target is a channel the bot can see.
export async function verifyTelegramChannel(token:string,channel:string){
  if(!telegramToken(token)||!telegramChannel(channel))throw new Error('Invalid Telegram bot or channel.');
  const bot=await call(token,'getMe');if(bot.is_bot!==true||!Number.isSafeInteger(bot.id))throw new Error('Not a bot.');
  const chat=await call(token,'getChat',{chat_id:channel});if(chat.type!=='channel')throw new Error('Not a channel.');
  return {botId:bot.id as number,chatId:String(chat.id),username:typeof chat.username==='string'?chat.username:null};
}
// Publish proof: the bot is an administrator of the channel with the right to post messages.
export const checkTelegramPublishing:PublishCheck=async(token,accountId,credentials)=>{
  if(credentials?.social?.platform!=='telegram'||credentials.social.accountId!==accountId||credentials.accessToken!==token)throw new Error('Telegram connection changed.');
  const {botId}=await verifyTelegramChannel(token,accountId);
  const member=await call(token,'getChatMember',{chat_id:accountId,user_id:botId});
  if(member.status!=='administrator'||member.can_post_messages!==true)throw new Error('The bot cannot post in this channel.');
  // Bot tokens do not expire; the proof itself is capped to a few minutes by the publication store.
  return {expiresAt:Date.now()+3600000};
};
export const publishTelegramText:PublishTransport=async(token,accountId,text,reserve)=>{
  if(!telegramToken(token)||!telegramChannel(accountId)||!text.trim()||text.length>TELEGRAM_TEXT_LIMIT||/\{\{[\s\S]*?\}\}|[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))return {state:'blocked',postId:null};
  if(!reserve())return {state:'blocked',postId:null};
  try{
    const response=await fetch(api(token,'sendMessage'),{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({chat_id:accountId,text}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
    if([400,401,403,404,409,429].includes(response.status)){await response.body?.cancel();return {state:'rejected',postId:null};}
    if(response.status!==200){await response.body?.cancel();return {state:'uncertain',postId:null};}
    const payload=await readSocialResponse(response),result=payload.result as Record<string,unknown>|undefined,chat=result?.chat as Record<string,unknown>|undefined;
    if(payload.ok!==true||!Number.isSafeInteger(result?.message_id)||chat?.id===undefined)return {state:'uncertain',postId:null};
    const username=typeof chat.username==='string'&&/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(chat.username)?chat.username:null;
    return {state:'accepted',postId:`${chat.id}:${result!.message_id}`,postUrl:username?`https://t.me/${username}/${result!.message_id}`:null};
  }catch{return {state:'uncertain',postId:null};}
};
