import { normalizeProductAttributes, type ProductAttributeType, type ProductPreview, type ProductSourceConfig } from './product-data-types';

export type WebhookConfig={entityType:ProductSourceConfig['entityType'];attributes:{key:string;type:ProductAttributeType}[];eventNames:string[]};
export type WebhookSource={id:string;name:string;version:number;state:'draft'|'ready'|'active'|'paused'|'revoked'|'blocked';config:WebhookConfig;endpointPath:string;previewAt:string|null;lastReceivedAt:string|null;eventCount:number;recordCount:number};
export type WebhookEventSample={id:string;entityId:string;eventName:string;occurredAt:string;receivedAt:string;version:number;consentStatus:'unknown'|'reported_opted_in'|'reported_opted_out';attributes:Record<string,string|number|boolean>};
export type WebhookPreview=ProductPreview;
export const WEBHOOK_LIMITS={bodyBytes:65536,batch:20,requestsPerMinute:120,eventsPerDay:1000,events:10000,receipts:100000,retentionDays:30,receiptDays:90,signatureSeconds:300} as const;
export function normalizeWebhookConfig(value:unknown):WebhookConfig {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Webhook şeması gerekli.');
  const raw=value as Record<string,unknown>;
  if(!['user','company','account','other'].includes(String(raw.entityType))||!Array.isArray(raw.attributes))throw new Error('Kayıt türü ve özellikler gerekli.');
  const attributes=normalizeProductAttributes(raw.attributes.map(item=>({...(item&&typeof item==='object'?item:{}),path:`attributes.${item?.key}`}))).map(({key,type})=>({key,type}));
  if(!Array.isArray(raw.eventNames)||raw.eventNames.length<1||raw.eventNames.length>20||raw.eventNames.some(name=>typeof name!=='string'||!/^[a-z][a-z0-9_.]{0,63}$/.test(name))||new Set(raw.eventNames).size!==raw.eventNames.length)throw new Error('1-20 benzersiz olay adı gerekli (ör. profile.updated).');
  return {entityType:raw.entityType as WebhookConfig['entityType'],attributes,eventNames:[...raw.eventNames].sort()};
}
export function webhookExample(version:number,config:WebhookConfig) {
  return {sourceVersion:version,events:[{id:'event-001',entityId:'user-001',eventName:config.eventNames[0],occurredAt:new Date().toISOString(),attributes:Object.fromEntries(config.attributes.map(field=>[field.key,field.type==='number'?25:field.type==='boolean'?true:'example']))}]};
}
