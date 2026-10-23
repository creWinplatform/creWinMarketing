import 'server-only';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import type {BillingPlan,BillingReadiness} from './billing-types';
import {readBoundedBodyBytes} from './request-json';
import {SALES_TERMS_PATH,salesTermsReady} from './sales-terms';

export type PaytrConfiguration = {
  merchantId:string;merchantKey:string;merchantSalt:string;revision:string;merchantRevision:string;origin:string;
  plans:BillingPlan[];readiness:BillingReadiness;
};
export function paytrConfiguration():PaytrConfiguration {
  const merchantId=process.env.PLATFORM_PAYTR_MERCHANT_ID||'',merchantKey=process.env.PLATFORM_PAYTR_MERCHANT_KEY||'',merchantSalt=process.env.PLATFORM_PAYTR_MERCHANT_SALT||'';
  let origin='',plans:BillingPlan[]=[];
  try{
    const value=new URL(process.env.PLATFORM_PAYTR_ORIGIN||'');
    if(value.protocol==='https:'&&!value.username&&!value.password&&!value.search&&!value.hash&&value.pathname==='/'&&value.port===''&&!isIP(value.hostname)&&value.hostname.includes('.')&&!value.hostname.endsWith('.local')&&!value.hostname.endsWith('.localhost'))origin=value.origin;
  }catch{}
  try{
    const raw=process.env.PLATFORM_PAYTR_TEST_CATALOG||'[]';
    if(raw.length>8192)throw new Error();
    const list:unknown=JSON.parse(raw);
    if(!Array.isArray(list)||list.length>8)throw new Error();
    const ids=new Set<string>();
    plans=list.map(item=>{
      if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['id','name','amountMinor','currency','cadence'].includes(key))||typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>120||/[\x00-\x1f\x7f]/.test(item.name)||!Number.isSafeInteger(item.amountMinor)||item.amountMinor<100||item.amountMinor>1000000||item.currency!=='USD'||!['monthly','yearly'].includes(item.cadence))throw new Error();
      ids.add(item.id);return {id:item.id,name:item.name.trim(),amountMinor:item.amountMinor,currency:'USD',cadence:item.cadence};
    });
  }catch{plans=[];}
  const checks={gate:process.env.PLATFORM_PAYTR_SANDBOX_ENABLED==='1',credentials:/^\d{1,20}$/.test(merchantId)&&/^[\x21-\x7e]{16,256}$/.test(merchantKey)&&/^[\x21-\x7e]{16,256}$/.test(merchantSalt),usdAcknowledged:process.env.PLATFORM_PAYTR_USD_ENABLED==='1',origin:Boolean(origin),catalog:plans.length>0};
  return {merchantId,merchantKey,merchantSalt,origin,plans,merchantRevision:createHash('sha256').update(JSON.stringify([merchantId,merchantKey,merchantSalt])).digest('hex'),revision:createHash('sha256').update(JSON.stringify([merchantId,merchantKey,merchantSalt,origin,plans])).digest('hex'),readiness:{provider:'paytr',mode:'sandbox',liveEnabled:false,subscriptionEnabled:false,checks,ready:Object.values(checks).every(Boolean)}};
}
export type PaytrCheckoutInput = {orderId:string;amountMinor:number;name:string;email:string;phone:string;address:string;ip:string;planName:string;language:'tr'|'en'};
export function paytrCheckoutForm(config:PaytrConfiguration,input:PaytrCheckoutInput) {
  if(!config.readiness.ready)throw new Error('PayTR sandbox not configured.');
  if(!/^RZTEST[a-f0-9]{32}$/.test(input.orderId)||!Number.isSafeInteger(input.amountMinor)||input.amountMinor<100||input.amountMinor>1000000||!isIP(input.ip))throw new Error('Invalid checkout.');
  const basket=Buffer.from(JSON.stringify([[input.planName,(input.amountMinor/100).toFixed(2),1]])).toString('base64');
  const amount=String(input.amountMinor),testMode='1',currency='USD',noInstallment='1',maxInstallment='0';
  const token=createHmac('sha256',config.merchantKey).update(config.merchantId+input.ip+input.orderId+input.email+amount+basket+noInstallment+maxInstallment+currency+testMode+config.merchantSalt).digest('base64');
  // Return URLs only show status; settlement requires verified server-side provider evidence.
  const returnUrl=config.origin+'/?tab=project&settings=plan';
  return new URLSearchParams({merchant_id:config.merchantId,user_ip:input.ip,merchant_oid:input.orderId,email:input.email,payment_amount:amount,user_basket:basket,no_installment:noInstallment,max_installment:maxInstallment,currency,test_mode:testMode,paytr_token:token,user_name:input.name,user_address:input.address,user_phone:input.phone,merchant_ok_url:returnUrl,merchant_fail_url:returnUrl,debug_on:'0',timeout_limit:'10',lang:input.language});
}
export type PaytrTransport=(form:URLSearchParams)=>Promise<{state:'accepted';token:string}|{state:'rejected'|'uncertain'}>;
export const requestPaytrToken:PaytrTransport=async form=>{
  try{
    if(form.get('test_mode')!=='1'||form.get('currency')!=='USD')return {state:'rejected'};
    const response=await fetch('https://www.paytr.com/odeme/api/get-token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form.toString(),signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});
    if(!response.ok)return {state:'uncertain'};
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBodyBytes(response as unknown as Request,16384)));
    if(value?.status==='success'&&typeof value.token==='string'&&/^[a-zA-Z0-9]{20,256}$/.test(value.token))return {state:'accepted',token:value.token};
    return {state:value?.status==='failed'?'rejected':'uncertain'};
  }catch{return {state:'uncertain'};}
};
export type PaytrNotification={orderId:string;status:'success'|'failed';totalMinor:number;digest:string;metadataMatches:boolean};
export function verifyPaytrNotification(config:PaytrConfiguration,body:string):PaytrNotification {
  if(!config.readiness.checks.credentials)throw new Error('PayTR unavailable.');
  if(body.length>8192)throw new Error('Invalid notification.');
  const form=new URLSearchParams(body),fields=['merchant_oid','status','total_amount','hash','currency','test_mode','payment_amount','payment_type'];
  for(const key of fields)if(form.getAll(key).length>1)throw new Error('Duplicate notification field.');
  const orderId=form.get('merchant_oid')||'',status=form.get('status'),total=form.get('total_amount')||'',hash=form.get('hash')||'';
  if(!/^RZTEST[a-f0-9]{32}$/.test(orderId)||!['success','failed'].includes(status||'')||!/^(0|[1-9]\d{0,8})$/.test(total)||!Number.isSafeInteger(Number(total))||!/^[A-Za-z0-9+/]{43}=$/.test(hash))throw new Error('Invalid notification.');
  const expected=createHmac('sha256',config.merchantKey).update(orderId+config.merchantSalt+status+total).digest();
  if(!timingSafeEqual(expected,Buffer.from(hash,'base64')))throw new Error('Invalid signature.');
  // These fields are NOT covered by PayTR's HMAC. They can only reject/flag, never grant access.
  const metadataMatches=form.get('currency')==='USD'&&form.get('test_mode')==='1'&&form.get('payment_type')==='card'&&form.get('payment_amount')===total;
  return {orderId,status:status as 'success'|'failed',totalMinor:Number(total),digest:createHash('sha256').update(JSON.stringify([orderId,status,total])).digest('hex'),metadataMatches};
}

// ── Live mode (behind PLATFORM_PAYTR_LIVE_ENABLED) ────────────────────────────────────────────────────────────────
// Same merchant, origin and USD acknowledgement as the sandbox, plus a public terms page the buyer accepts. Orders are
// RZLIVE…, test_mode is 0, and a live token is never requested while the switch is off.
export type PaytrLiveReadiness={checks:{gate:boolean;credentials:boolean;usdAcknowledged:boolean;origin:boolean;terms:boolean};ready:boolean;termsUrl:string};
export function paytrLiveReadiness(config:PaytrConfiguration=paytrConfiguration()):PaytrLiveReadiness{
  let termsUrl='';
  // Our own /legal/sales page counts only once its seller details and legal review are complete.
  try{const url=new URL(process.env.PLATFORM_BILLING_TERMS_URL||'');if(url.protocol==='https:'&&!url.username&&!url.password&&!(url.pathname.replace(/\/$/,'')===SALES_TERMS_PATH&&!salesTermsReady()))termsUrl=url.href;}catch{termsUrl='';}
  const checks={gate:process.env.PLATFORM_PAYTR_LIVE_ENABLED==='1',credentials:config.readiness.checks.credentials,usdAcknowledged:config.readiness.checks.usdAcknowledged,origin:config.readiness.checks.origin,terms:Boolean(termsUrl)};
  return {checks,ready:Object.values(checks).every(Boolean),termsUrl};
}
export const LIVE_ORDER_ID=/^RZLIVE[a-f0-9]{32}$/;
export function paytrLiveCheckoutForm(config:PaytrConfiguration,input:PaytrCheckoutInput){
  if(!paytrLiveReadiness(config).ready)throw new Error('PayTR live not configured.');
  if(!LIVE_ORDER_ID.test(input.orderId)||!Number.isSafeInteger(input.amountMinor)||input.amountMinor<100||input.amountMinor>1000000||!isIP(input.ip))throw new Error('Invalid checkout.');
  const basket=Buffer.from(JSON.stringify([[input.planName,(input.amountMinor/100).toFixed(2),1]])).toString('base64');
  const amount=String(input.amountMinor),testMode='0',currency='USD',noInstallment='1',maxInstallment='0';
  const token=createHmac('sha256',config.merchantKey).update(config.merchantId+input.ip+input.orderId+input.email+amount+basket+noInstallment+maxInstallment+currency+testMode+config.merchantSalt).digest('base64');
  const returnUrl=config.origin+'/?tab=project&settings=plan';
  return new URLSearchParams({merchant_id:config.merchantId,user_ip:input.ip,merchant_oid:input.orderId,email:input.email,payment_amount:amount,user_basket:basket,no_installment:noInstallment,max_installment:maxInstallment,currency,test_mode:testMode,paytr_token:token,user_name:input.name,user_address:input.address,user_phone:input.phone,merchant_ok_url:returnUrl,merchant_fail_url:returnUrl,debug_on:'0',timeout_limit:'10',lang:input.language});
}
export const requestPaytrLiveToken:PaytrTransport=async form=>{
  try{
    if(process.env.PLATFORM_PAYTR_LIVE_ENABLED!=='1'||form.get('test_mode')!=='0'||form.get('currency')!=='USD'||!LIVE_ORDER_ID.test(form.get('merchant_oid')||''))return {state:'rejected'};
    const response=await fetch('https://www.paytr.com/odeme/api/get-token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form.toString(),signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});
    if(!response.ok)return {state:'uncertain'};
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBodyBytes(response as unknown as Request,16384)));
    if(value?.status==='success'&&typeof value.token==='string'&&/^[a-zA-Z0-9]{20,256}$/.test(value.token))return {state:'accepted',token:value.token};
    return {state:value?.status==='failed'?'rejected':'uncertain'};
  }catch{return {state:'uncertain'};}
};
export function verifyPaytrLiveNotification(config:PaytrConfiguration,body:string):PaytrNotification{
  if(!config.readiness.checks.credentials)throw new Error('PayTR unavailable.');
  if(body.length>8192)throw new Error('Invalid notification.');
  const form=new URLSearchParams(body),fields=['merchant_oid','status','total_amount','hash','currency','test_mode','payment_amount','payment_type'];
  for(const key of fields)if(form.getAll(key).length>1)throw new Error('Duplicate notification field.');
  const orderId=form.get('merchant_oid')||'',status=form.get('status'),total=form.get('total_amount')||'',hash=form.get('hash')||'';
  if(!LIVE_ORDER_ID.test(orderId)||!['success','failed'].includes(status||'')||!/^(0|[1-9]\d{0,8})$/.test(total)||!Number.isSafeInteger(Number(total))||!/^[A-Za-z0-9+/]{43}=$/.test(hash))throw new Error('Invalid notification.');
  const expected=createHmac('sha256',config.merchantKey).update(orderId+config.merchantSalt+status+total).digest();
  if(!timingSafeEqual(expected,Buffer.from(hash,'base64')))throw new Error('Invalid signature.');
  // Not covered by PayTR's HMAC: these can only send an order to review, never grant access.
  const metadataMatches=form.get('currency')==='USD'&&form.get('test_mode')==='0'&&form.get('payment_type')==='card'&&form.get('payment_amount')===total;
  return {orderId,status:status as 'success'|'failed',totalMinor:Number(total),digest:createHash('sha256').update(JSON.stringify([orderId,status,total])).digest('hex'),metadataMatches};
}
