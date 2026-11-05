import { platformDatabase } from '@/lib/platform/database';
import { MarketingStoreError } from '@/lib/platform/errors';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { goLiveStatus } from '@/lib/platform/go-live';
import { ProjectAds } from '@/lib/platform/ad-manager';
import { MobileGrowth } from '@/lib/platform/mobile-store';
import type { AdProvider } from '@/lib/platform/ad-providers';
import { coachBody,coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
export const maxDuration=40;
// The project's go-live panel: status from its own records, and read-only checks of a connection on request.
const handle=coachRoute(async(scope,request)=>{
  const db=platformDatabase();
  if(request.method==='GET')return goLiveStatus(db,scope);
  const raw=await coachBody(request);goLiveStatus(db,scope);
  if(raw.action==='verifyAds'){const provider=['meta','google','linkedin','tiktok','apple_search'].includes(String(raw.provider))?String(raw.provider) as AdProvider:null;if(!provider)throw new MarketingStoreError('Geçersiz reklam sağlayıcısı.');
    const result=await new ProjectAds(db,scope,credentialEncryptionKey(),undefined,provider).verify();return {result,status:goLiveStatus(db,scope)};}
  if(raw.action==='verifyMobile'){await new MobileGrowth(db,scope,credentialEncryptionKey()).probe(String(raw.id));return {result:{ok:true},status:goLiveStatus(db,scope)};}
  throw new MarketingStoreError('Geçersiz işlem.');
});
export const GET=handle,POST=handle;
