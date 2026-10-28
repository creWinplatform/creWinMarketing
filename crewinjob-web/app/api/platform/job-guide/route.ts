import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { platformDatabase } from '@/lib/platform/database';
import { jobGuide } from '@/lib/platform/job-guide';
import { crewinJobGuide, type CrewinStats } from '@/lib/platform/crewin-job-guide';
import { getPlatformAccess } from '@/lib/platform/workspace-server';
import { agentDir, agentModule, fetchAllData } from '@/lib/agent-bridge';
import { getToken, twitterOAuth1Creds } from '@/lib/social-tokens';
import { coachRoute } from '../coach/shared';
export const dynamic='force-dynamic';
export const fetchCache='force-no-store';

const platformGuide=coachRoute(async scope=>jobGuide(platformDatabase(),scope));
const SOCIAL={instagram:'Instagram',facebook:'Facebook',linkedin:'LinkedIn',twitter:'X',tiktok:'TikTok'} as const;
// Crewin's workspace (the single legacy account): the same guide, read from its JSON stores and the Crewin backend.
function crewinGuide(){
  const api=()=>agentModule('modules/api.js');
  return crewinJobGuide({
    webData:path.join(process.cwd(),'data'),agentRoot:agentDir(),now:Date.now(),env:process.env,
    agentEnv:()=>{try{return agentModule<{collectAgentConfig:(env:NodeJS.ProcessEnv)=>Record<string,string>}>('modules/agent-config.js').collectAgentConfig(process.env);}catch{return {};}},
    socialConnected:()=>(Object.keys(SOCIAL) as (keyof typeof SOCIAL)[]).filter(platform=>{const token=getToken(platform);const refreshable=platform==='twitter'&&Boolean(token?.refreshToken&&process.env.TWITTER_CLIENT_ID);return (platform==='twitter'&&Boolean(twitterOAuth1Creds()))||Boolean(token?.accessToken&&!(token.expiresAt&&token.expiresAt<Date.now()&&!refreshable));}).map(platform=>SOCIAL[platform]),
    stats:()=>fetchAllData() as Promise<CrewinStats>,
    leads:()=>api().marketingProspectGet('GetAll',{page:1,pageSize:100}),
    pendingOrders:()=>api().firmaKrediGet('GetBekleyenSiparisler',{sayfa:'1',boyut:'1'}),
    campaigns:()=>api().marketingCampaignV2Get('GetAll',{skipCount:0,maxResultCount:100}),
    posts:()=>api().marketingPostHistoryGet('GetAll',{skipCount:0,maxResultCount:20}),
  });
}

// "What would you like to do?": jobs with their steps, each step read from the project's records for this member.
export async function GET(request:NextRequest){
  const access=await getPlatformAccess();
  if(access?.identity.mode==='legacy'){
    const headers={'Cache-Control':'private, no-store'};
    try{return NextResponse.json(await crewinGuide(),{headers});}
    catch{return NextResponse.json({error:'İş rehberi şu anda yüklenemedi; araçları menüden kullanabilirsiniz.'},{status:500,headers});}
  }
  return platformGuide(request);
}
