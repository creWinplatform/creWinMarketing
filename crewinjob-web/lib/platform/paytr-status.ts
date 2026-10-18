import 'server-only';
import {createHmac} from 'node:crypto';
import type {PaytrConfiguration} from './paytr';
import {readBoundedBodyBytes} from './request-json';

export type PaytrStatusResult =
  | {status:'payment_found';amountMinor:number;totalMinor:number;currency:string;testMode:boolean;card:boolean;installments:boolean;hasRefunds:boolean}
  | {status:'not_confirmed'|'unavailable'|'invalid_response'};
export type PaytrStatusTransport=(form:URLSearchParams)=>Promise<PaytrStatusResult>;
export const paytrStatusEnabled=(config:PaytrConfiguration)=>config.readiness.checks.gate&&config.readiness.checks.credentials&&config.readiness.checks.usdAcknowledged;
export function paytrStatusForm(config:PaytrConfiguration,orderId:string){
  if(!paytrStatusEnabled(config)||!/^RZTEST[a-f0-9]{32}$/.test(orderId))throw new Error('Status check unavailable.');
  const token=createHmac('sha256',config.merchantKey).update(config.merchantId+orderId+config.merchantSalt).digest('base64');
  return new URLSearchParams({merchant_id:config.merchantId,merchant_oid:orderId,paytr_token:token});
}
// Status inquiry amounts are MAJOR units (unlike notification amounts). No floating-point conversion.
export function paytrMajorToMinor(value:unknown):number|null{
  if(typeof value!=='string'||! /^(0|[1-9]\d{0,4})([.,]\d{1,2})?$/.test(value))return null;
  const [whole,fraction='']=value.replace(',','.').split('.'),minor=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return minor<=1000000?minor:null;
}
export const requestPaytrStatus:PaytrStatusTransport=async form=>{
  try{
    if(!/^RZTEST[a-f0-9]{32}$/.test(form.get('merchant_oid')||'')||!/^\d{1,20}$/.test(form.get('merchant_id')||'')||!/^[A-Za-z0-9+/]{43}=$/.test(form.get('paytr_token')||'')||Array.from(form.keys()).sort().join(',')!=='merchant_id,merchant_oid,paytr_token')return {status:'invalid_response'};
    const response=await fetch('https://www.paytr.com/odeme/durum-sorgu',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form.toString(),signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});
    if(!response.ok)return {status:'unavailable'};
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBodyBytes(response as unknown as Request,16384)));
    if(value?.status==='error')return {status:value.err_no==='004'?'not_confirmed':'unavailable'};
    const amountMinor=paytrMajorToMinor(value?.payment_amount),totalMinor=paytrMajorToMinor(value?.payment_total);
    if(value?.status!=='success'||amountMinor===null||totalMinor===null||!['USD','TRY','TL','EUR','GBP','RUB'].includes(value.currency)||!['0','1'].includes(value.test_mode)||!['KART','EFT'].includes(value.odeme_tipi)||typeof value.taksit!=='string'||!/^\d{1,2}$/.test(value.taksit)||!Array.isArray(value.returns))return {status:'invalid_response'};
    // Masked PAN, customer data, authorization codes and refund details are deliberately discarded.
    return {status:'payment_found',amountMinor,totalMinor,currency:value.currency,testMode:value.test_mode==='1',card:value.odeme_tipi==='KART',installments:value.taksit!=='0',hasRefunds:value.returns.length>0};
  }catch{return {status:'unavailable'};}
};
