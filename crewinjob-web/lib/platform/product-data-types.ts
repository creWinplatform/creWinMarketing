export type ProductAttributeType = 'string' | 'number' | 'boolean';
export type ProductMapping = { key:string; path:string; type:ProductAttributeType };
export type ProductSourceConfig = {
  url:string; auth:'none'|'bearer'; itemsPath:string; idPath:string;
  updatedAtPath:string; entityType:'user'|'company'|'account'|'other';
  attributes:ProductMapping[]; nextCursorPath:string; cursorParam:string;
};
export type ProductSource = {
  id:string; name:string; version:number; state:'draft'|'ready'|'active'|'paused'|'revoked';
  config:ProductSourceConfig; previewAt:string|null; lastSyncedAt:string|null;
  recordCount:number; hasMore:boolean; credentialConfigured:boolean;
};
export type ProductPreview = {
  total:number; valid:number; errors:{row:number; field:string}[];
  samples:{externalId:string; attributes:Record<string,string|number|boolean>; observedAt:string; consentStatus:'unknown'}[];
  canActivate:boolean;
  // Signed webhooks only: events carrying a first-touch tag, and malformed tags that would be dropped.
  attribution?:{found:number; ignored:number};
};
export const PRODUCT_SOURCE_LIMITS = { sources:5, pageRecords:200, batchPages:3, records:10000, attributes:12, responseBytes:524288, previewsPerDay:50, syncsPerDay:100 } as const;

const sensitive = /password|passwd|secret|token|authorization|cookie|credential|consent|opted/i;
const forbidden = new Set(['__proto__','prototype','constructor']);
export function productPath(value:unknown, optional=false):string {
  if (optional && value === '') return '';
  if (typeof value!=='string' || value.length>160 || !/^[a-zA-Z_][a-zA-Z0-9_]*(\.(?:[a-zA-Z_][a-zA-Z0-9_]*|\d+))*$/.test(value) || value.split('.').some(part=>forbidden.has(part)||sensitive.test(part))) throw new Error('Geçerli ve hassas bilgi içermeyen bir JSON alan yolu gerekli.');
  return value;
}
export function productValue(value:unknown,path:string):unknown {
  if (!path) return value;
  for (const segment of path.split('.')) {
    if (!value || typeof value!=='object' || !Object.prototype.hasOwnProperty.call(value,segment)) return undefined;
    value=(value as Record<string,unknown>)[segment];
  }
  return value;
}
export function normalizeProductAttributes(value:unknown):ProductMapping[] {
  if (!Array.isArray(value) || value.length<1 || value.length>PRODUCT_SOURCE_LIMITS.attributes) throw new Error('1-12 özellik eşleştirmesi gerekli.');
  const keys=new Set<string>();
  return value.map(item=>{
    if (!item || typeof item!=='object') throw new Error('Özellik eşleştirmesi geçersiz.');
    const {key,path,type}=item;
    if (typeof key!=='string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || forbidden.has(key) || sensitive.test(key) || keys.has(key) || !['string','number','boolean'].includes(type)) throw new Error('Özellik adı veya türü geçersiz ya da mükerrer.');
    keys.add(key); return {key,path:productPath(path),type:type as ProductAttributeType};
  });
}
export function normalizeProductSource(value:unknown):ProductSourceConfig {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Veri kaynağı ayarları gerekli.');
  const raw=value as Record<string,unknown>;
  if (typeof raw.url!=='string' || raw.url.length>2048 || /[\r\n\x00]/.test(raw.url)) throw new Error('Geçerli HTTPS kaynak adresi gerekli.');
  const url=new URL(raw.url.trim());
  if (url.protocol!=='https:' || url.username || url.password || url.port || url.search || url.hash) throw new Error('Kaynak adresi HTTPS olmalı; özel port, kimlik bilgisi, sorgu veya fragment içermemeli.');
  if (!['none','bearer'].includes(String(raw.auth)) || !['user','company','account','other'].includes(String(raw.entityType))) throw new Error('Kaynak türü veya kimlik doğrulama geçersiz.');
  const attributes=normalizeProductAttributes(raw.attributes);
  const nextCursorPath=productPath(raw.nextCursorPath ?? '',true);
  const cursorParam=raw.cursorParam ?? '';
  if (typeof cursorParam!=='string' || (nextCursorPath && (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(cursorParam)||sensitive.test(cursorParam))) || (!nextCursorPath && cursorParam!=='')) throw new Error('Cursor alan yolu ve parametresi birlikte tanımlanmalı.');
  return {url:url.href,auth:raw.auth as ProductSourceConfig['auth'],entityType:raw.entityType as ProductSourceConfig['entityType'],itemsPath:productPath(raw.itemsPath ?? '',true),idPath:productPath(raw.idPath),updatedAtPath:productPath(raw.updatedAtPath),attributes,nextCursorPath,cursorParam:cursorParam as string};
}
