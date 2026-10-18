import { MarketingStoreError } from './errors';
import { MOBILE_PROVIDERS,type MobileProvider } from './mobile-types';
export const mobileRecord=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
export function mobileText(value:unknown,max=160,optional=false):string {
  if(value===undefined&&optional)return '';
  if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)||!optional&&!value.trim())throw new MarketingStoreError('Geçerli bir metin gerekli.');return value.trim();
}
export function mobileId(value:unknown){const id=mobileText(value,80);if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new MarketingStoreError('Geçersiz kimlik.');return id;}
export function mobileDate(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new MarketingStoreError('Saat dilimi içeren geçerli tarih gerekli.');return new Date(value).toISOString();}
export function mobileDay(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw new MarketingStoreError('Geçerli gün gerekli.');return value;}
export function mobileOrigin(value:unknown){const url=new URL(mobileText(value,2048));if(url.protocol!=='https:'||url.username||url.password||url.port||url.hostname==='localhost'||!url.hostname.includes('.')||/^(?:\d+\.){3}\d+$/.test(url.hostname)||url.search||url.hash)throw new MarketingStoreError('Herkese açık HTTPS adresi gerekli.');return url.origin;}
export function mobilePath(value:unknown){const path=mobileText(value,200);if(!/^\/[a-zA-Z0-9/_-]*$/.test(path)||path.startsWith('//')||path.includes('..'))throw new MarketingStoreError('Uygulama yolu / ile başlamalı; yalnız harf, sayı, /, - ve _ içerebilir.');return path;}
export function mobileCurrency(value:unknown){if(typeof value!=='string'||!/^[A-Z]{3}$/.test(value))throw new MarketingStoreError('Üç harfli para birimi gerekli.');return value;}
export function mobileNumber(value:unknown,max=1e9){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max)throw new MarketingStoreError('Geçerli pozitif tutar gerekli.');return value;}
export function mobileProvider(value:unknown):MobileProvider{if(!MOBILE_PROVIDERS.includes(value as MobileProvider))throw new MarketingStoreError('Sağlayıcı desteklenmiyor.');return value as MobileProvider;}
export const MOBILE_EVENT_NAMES=['mobile.install','mobile.session','mobile.activation','mobile.purchase','mobile.refund','mobile.subscription','mobile.attribution','mobile.message_impression','mobile.message_click','mobile.message_dismiss'] as const;
export function normalizeMobileApp(raw:Record<string,unknown>){
  const name=mobileText(raw.name,100),platform=raw.platform;
  if(!['ios','android','both'].includes(String(platform)))throw new MarketingStoreError('iOS, Android veya ikisini seçin.');
  const appleId=mobileText(raw.appleId,30,true),bundleId=mobileText(raw.bundleId,200,true),packageName=mobileText(raw.packageName,200,true),country=mobileText(raw.country||'TR',2),locale=mobileText(raw.locale||'tr-TR',20),scheme=mobileText(raw.scheme,40,true);
  if(appleId&&!/^[1-9]\d{4,19}$/.test(appleId)||[bundleId,packageName].some(id=>id&&!/^[a-zA-Z][\w]*(?:\.[\w]+)+$/.test(id))||!/^[A-Z]{2}$/.test(country)||!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale)||scheme&&!/^[a-z][a-z0-9-]{1,39}$/.test(scheme)||['http','https','javascript','data','file'].includes(scheme))throw new MarketingStoreError('Mağaza, paket, dil veya uygulama şeması geçersiz.');
  const attributionProvider=raw.attributionProvider||'bridge',revenueProvider=raw.revenueProvider||'bridge';
  if(!['bridge','appsflyer','adjust'].includes(String(attributionProvider))||!['bridge','revenuecat'].includes(String(revenueProvider))||typeof raw.identityConfirmed!=='boolean')throw new MarketingStoreError('Ölçüm kaynağı veya kimlik eşleştirmesi geçersiz.');
  return {name,platform,appleId,bundleId,packageName,country,locale,scheme,website:mobileOrigin(raw.website),attributionProvider,revenueProvider,identityConfirmed:raw.identityConfirmed};
}
