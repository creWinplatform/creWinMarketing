import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { jobGuide } from '@/lib/platform/job-guide';
import { crewinJobGuide, type CrewinStats } from '@/lib/platform/crewin-job-guide';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { agentDir, agentModule, cachedAgentRead, cachedAllData } from '@/lib/agent-bridge';
import { loadTokens, twitterOAuth1Creds } from '@/lib/social-tokens';
import { coachRoute } from '../coach/shared';
import { serverSetup } from '@/lib/platform/server-setup';
import { panelOrigin } from '@/lib/platform/request-origin';
export const dynamic='force-dynamic';
export const fetchCache='force-no-store';

const platformGuide=coachRoute(async scope=>await jobGuide(platformDatabase(),scope));
const SOCIAL={instagram:'Instagram',facebook:'Facebook',linkedin:'LinkedIn',twitter:'X',tiktok:'TikTok'} as const;
// Crewin's workspace (the single legacy account): the same guide, read from its JSON stores and the Crewin backend.
async function crewinGuide(origin:string){
  const api=()=>agentModule('modules/api.js');
  return crewinJobGuide({
    webData:path.join(process.cwd(),'data'),agentRoot:agentDir(),now:Date.now(),env:process.env,
    agentEnv:()=>{try{return agentModule<{collectAgentConfig:(env:NodeJS.ProcessEnv)=>Record<string,string>}>('modules/agent-config.js').collectAgentConfig(process.env);}catch{return {};}},
    socialConnected:async()=>{const tokens=await loadTokens();return (Object.keys(SOCIAL) as (keyof typeof SOCIAL)[]).filter(platform=>{const token=tokens[platform]||null;const refreshable=platform==='twitter'&&Boolean(token?.refreshToken&&process.env.TWITTER_CLIENT_ID);return (platform==='twitter'&&Boolean(twitterOAuth1Creds()))||Boolean(token?.accessToken&&!(token.expiresAt&&token.expiresAt<Date.now()&&!refreshable));}).map(platform=>SOCIAL[platform]);},
    // Step states from the Crewin backend: the last answer at once, refreshed in the background (a minute fresh).
    stats:()=>cachedAllData() as Promise<CrewinStats>,
    leads:()=>cachedAgentRead('guide:leads',()=>api().marketingProspectGet('GetAll',{page:1,pageSize:100})),
    pendingOrders:()=>cachedAgentRead('guide:orders',()=>api().firmaKrediGet('GetBekleyenSiparisler',{sayfa:'1',boyut:'1'})),
    campaigns:()=>cachedAgentRead('guide:campaigns',()=>api().marketingCampaignV2Get('GetAll',{skipCount:0,maxResultCount:100})),
    posts:()=>cachedAgentRead('guide:posts',()=>api().marketingPostHistoryGet('GetAll',{skipCount:0,maxResultCount:20})),
    db:platformDatabase(),
    setup:(await serverSetup(platformDatabase(),origin)).sections.map(({id,state,problems})=>({id,state,problems})),
  });
}

// "What would you like to do?": jobs with their steps, each step read from the project's records for this member.
export async function GET(request:NextRequest){
  const access=await getPlatformAccess();
  if(access?.identity.mode==='legacy'){
    const headers={'Cache-Control':'private, no-store'};
    try{return NextResponse.json(await crewinGuide(panelOrigin(request)),{headers});}
    catch{return NextResponse.json({error:'İş rehberi şu anda yüklenemedi; araçları menüden kullanabilirsiniz.'},{status:500,headers});}
  }
  return platformGuide(request);
}
