import { NextRequest, NextResponse } from 'next/server';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { platformDatabase } from '@/lib/platform/database';
import { credentialEncryptionKey } from '@/lib/platform/credential-key';
import { ProjectLinkedInOAuth, LINKEDIN_BROWSER_COOKIE } from '@/lib/platform/linkedin-oauth';
import { linkedinConfiguration } from '@/lib/platform/linkedin-client';
import { OAuthRequests } from '@/lib/platform/oauth-requests';
import { LinkedInOrganizationOAuth, LINKEDIN_ORGANIZATION_SELECTION_COOKIE } from '@/lib/platform/linkedin-organization-oauth';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  let redirect: URL;
  try { redirect = new URL('/', linkedinConfiguration().redirectUri); }
  catch { return NextResponse.json({ error: 'LinkedIn OAuth yapılandırılmadı.' }, { status: 503 }); }
  let result = 'failed';
  let organization=false,selectionCookie='';
  try {
    const access = await getPlatformAccess('connections.manage');
    if (!access || access.identity.mode !== 'platform' || request.nextUrl.searchParams.has('error')) throw new Error();
    const scope={subject:access.subject,organizationId:access.identity.organizationId,projectId:access.identity.projectId},db=platformDatabase(),key=credentialEncryptionKey();
    const state=request.nextUrl.searchParams.get('state')||'',browser=request.cookies.get(LINKEDIN_BROWSER_COOKIE)?.value||'',code=request.nextUrl.searchParams.get('code')||'';
    const pending=new OAuthRequests(db,scope,key).get(state,browser,['linkedin','linkedin_organization']);
    organization=pending.provider==='linkedin_organization';
    if(organization){selectionCookie=await new LinkedInOrganizationOAuth(db,scope,key).complete(state,browser,code);result='select';}
    else {await new ProjectLinkedInOAuth(db,scope,key).complete(state,browser,code);result='connected';}
  } catch { /* Provider payloads, authorization codes and tokens must not enter logs/redirects. */ }
  redirect.searchParams.set(organization?'linkedinOrganizationConnection':'socialConnection', result);
  redirect.searchParams.set('tab','project');redirect.searchParams.set('settings','connections');
  const response = NextResponse.redirect(redirect);
  response.headers.set('Cache-Control', 'no-store'); response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.set(LINKEDIN_BROWSER_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: redirect.protocol === 'https:', path: '/api/platform/social/callback', maxAge: 0 });
  if(selectionCookie)response.cookies.set(LINKEDIN_ORGANIZATION_SELECTION_COOKIE,selectionCookie,{httpOnly:true,sameSite:'lax',secure:redirect.protocol==='https:',path:'/api/platform/linkedin-organizations',maxAge:600});
  return response;
}
