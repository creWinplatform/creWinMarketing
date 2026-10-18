import 'server-only';
import type Database from 'better-sqlite3';
import { MarketingStoreError, type MarketingScope } from './marketing-store';
import { PRODUCT_SOURCE_LIMITS, productValue, type ProductPreview, type ProductSourceConfig } from './product-data-types';

export type ProductRecord = {externalId:string;attributes:Record<string,string|number|boolean>;observedAt:string};
export function productTimestamp(value:unknown):string {
  if(typeof value!=='string')throw new Error('Invalid source date.');
  const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if(!parts)throw new Error('Invalid source date.');
  const [,year,month,day,hour,minute,second,,offsetHour='0',offsetMinute='0']=parts;
  if(+year<1970 || +month<1 || +month>12 || +day<1 || +day>new Date(Date.UTC(+year,+month,0)).getUTCDate() || +hour>23 || +minute>59 || +second>59 || +offsetHour>14 || +offsetMinute>59 || (+offsetHour===14&&+offsetMinute!==0) || !Number.isFinite(Date.parse(value)) || Date.parse(value)>Date.now()+300000)throw new Error('Invalid source date.');
  return new Date(value).toISOString();
}
export function normalizeProductRecords(items:unknown[],config:Pick<ProductSourceConfig,'idPath'|'updatedAtPath'|'attributes'>) {
  if(!Array.isArray(items)||items.length>PRODUCT_SOURCE_LIMITS.pageRecords)throw new MarketingStoreError('Kaynak sayfası 200 kayıt sınırını aşıyor.');
  const records:ProductRecord[]=[],errors:ProductPreview['errors']=[];
  items.forEach((item,index)=>{
    let field=config.idPath;
    try{
      const rawId=productValue(item,config.idPath);
      if((typeof rawId!=='string'&&!(typeof rawId==='number'&&Number.isSafeInteger(rawId)))||!String(rawId).trim()||String(rawId).length>200||/[\x00-\x1f]/.test(String(rawId)))throw new Error();
      field=config.updatedAtPath;const observedAt=productTimestamp(productValue(item,field));
      const attributes:ProductRecord['attributes']={};
      for(const mapping of config.attributes){
        field=mapping.path;const value=productValue(item,mapping.path);
        if(typeof value!==mapping.type||(typeof value==='number'&&!Number.isFinite(value))||(typeof value==='string'&&(value.length>500||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))))throw new Error();
        attributes[mapping.key]=value as string|number|boolean;
      }
      records.push({externalId:String(rawId).trim(),attributes,observedAt});
    }catch{errors.push({row:index+1,field});}
  });
  return {records,errors};
}
// Call inside the source/job transaction so projections and receipt/checkpoint stay atomic.
export function writeProductRecords(db:Database.Database,scope:MarketingScope,id:string,version:number,entityType:string,records:ProductRecord[],receivedAt:string) {
  const args=[scope.organizationId,scope.projectId] as const;
  const current=(db.prepare('SELECT COUNT(*) AS n FROM platform_product_records WHERE organization_id=? AND project_id=?').get(...args) as {n:number}).n;
  const existing=db.prepare('SELECT attributes_json,observed_at FROM platform_product_records WHERE connection_id=? AND version=? AND external_id=?');
  const ids=new Set(records.map(item=>item.externalId));
  const additional=[...ids].filter(externalId=>!existing.get(id,version,externalId)).length;
  if(current+additional>PRODUCT_SOURCE_LIMITS.records)throw new MarketingStoreError('Pilot ürün verisi sınırına ulaşıldı.',429);
  let written=0;
  for(const item of records){
    const old=existing.get(id,version,item.externalId) as {attributes_json:string;observed_at:string}|undefined;
    const attributes=JSON.stringify(item.attributes);
    if(old?.observed_at===item.observedAt&&old.attributes_json!==attributes)throw new MarketingStoreError('Kaynak aynı zamanda çelişen özellikler döndürdü.',422);
    written+=db.prepare(`INSERT INTO platform_product_records VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,version,external_id) DO UPDATE SET attributes_json=excluded.attributes_json,observed_at=excluded.observed_at,received_at=excluded.received_at WHERE platform_product_records.observed_at<excluded.observed_at`).run(id,version,...args,item.externalId,entityType,attributes,item.observedAt,receivedAt).changes;
  }
  return written;
}
