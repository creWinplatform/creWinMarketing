import 'server-only';
import { createHash } from 'node:crypto';
import { linkedinPublishingConfiguration, introspectLinkedInToken, type PublishCheck } from './linkedin-publishing';
import { hasOrganicRole, organizationId, readLinkedInOrganizationJson } from './linkedin-organizations';

export function linkedinOrganizationConfiguration(){
  const config=linkedinPublishingConfiguration();
  return {...config,revision:createHash('sha256').update(JSON.stringify([config.revision,config.redirectUri,'organization'])).digest('hex')};
}
export const checkLinkedInOrganizationPublishing:PublishCheck=async(token,id,credentials)=>{
  const config=linkedinOrganizationConfiguration(),grant=credentials?.linkedinOrganization;
  if(!organizationId(id)||!grant?.publishing||grant.configurationRevision!==config.revision||credentials?.accessToken!==token||credentials.social?.platform!=='linkedin'||credentials.social.accountType!=='organization'||credentials.social.accountId!==id||!credentials.expiresAt||credentials.expiresAt<=Date.now()+60000)throw new Error('Organization publishing grant unavailable.');
  const signal=AbortSignal.timeout(20000),access=await introspectLinkedInToken(token,['r_organization_admin','w_organization_social'],signal);
  const profile=await readLinkedInOrganizationJson('https://api.linkedin.com/v2/userinfo',token,{signal});
  if(profile.sub!==grant.memberSub||!await hasOrganicRole(readLinkedInOrganizationJson,token,config.version,id,signal))throw new Error('Organization role unavailable.');
  return {expiresAt:Math.min(access.expiresAt,credentials.expiresAt)};
};
export async function checkLinkedInOrganizationReadAccess(token:string,id:string){
  const config=linkedinOrganizationConfiguration();
  if(!organizationId(id)||!await hasOrganicRole(readLinkedInOrganizationJson,token,config.version,id,AbortSignal.timeout(20000),false))throw new Error('Organization access unavailable.');
}
