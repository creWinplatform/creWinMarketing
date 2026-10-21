'use client';
import {useEffect,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import {Megaphone,UsersRound,ShieldCheck,MailCheck,Workflow,Building2,BadgeDollarSign,MessagesSquare,MessageCircle,Inbox} from 'lucide-react';
import type {WorkspaceContext,Locale} from '@/lib/platform/catalog';
import ProjectDrafts from './ProjectDrafts';
const ProjectSegments=dynamic(()=>import('./ProjectSegments'));
const ProjectRecipients=dynamic(()=>import('./ProjectRecipients'));
const ProjectEmailSender=dynamic(()=>import('./ProjectEmailSender'));
const ProjectAutomations=dynamic(()=>import('./ProjectAutomations'));
const ProjectProspects=dynamic(()=>import('./ProjectProspects'));
const ProjectAds=dynamic(()=>import('./ProjectAds'));
const ProjectMessaging=dynamic(()=>import('./ProjectMessaging'));
const ProjectWhatsApp=dynamic(()=>import('./ProjectWhatsApp'));
const ProjectSocialInbox=dynamic(()=>import('./ProjectSocialInbox'));
export default function ProjectCampaignCenter({workspace,lang}:{workspace:WorkspaceContext;lang:Locale}){
  const [view,setView]=useState<'drafts'|'segments'|'recipients'|'sender'|'automations'|'prospects'|'ads'|'messaging'|'whatsapp'|'inbox'>('drafts'),tr=lang==='tr';
  const navigation=useRef<HTMLElement>(null);
  useEffect(()=>{const value=new URLSearchParams(window.location.search).get('campaignView');if(value==='segments'||value==='recipients'||value==='sender'||value==='automations'||value==='prospects'||value==='ads'||value==='messaging'||value==='whatsapp'||value==='inbox')setView(value);},[]);
  useEffect(()=>{
    const nav=navigation.current;if(!nav)return;
    const reveal=()=>{const active=nav.querySelector<HTMLButtonElement>('button[aria-current]');if(!active)return;const left=active.getBoundingClientRect().left-nav.getBoundingClientRect().left,right=left+active.offsetWidth;if(left<0)nav.scrollBy({left:left-8});else if(right>nav.clientWidth)nav.scrollBy({left:right-nav.clientWidth+8});};
    reveal();const observer=new ResizeObserver(reveal);observer.observe(nav);return()=>observer.disconnect();
  },[view,lang]);
  return <div><nav ref={navigation} className="studio-settings-tabs segment-view-tabs" aria-label={tr?'Kampanya bölümleri':'Campaign sections'}>{([{id:'drafts',Icon:Megaphone,label:tr?'Taslaklar':'Drafts'},{id:'segments',Icon:UsersRound,label:tr?'Kitleler':'Audiences'},{id:'recipients',Icon:ShieldCheck,label:tr?'Alıcılar ve izinler':'Recipients & consent'},{id:'sender',Icon:MailCheck,label:tr?'Gönderen ve pilot':'Sender & pilot'},{id:'automations',Icon:Workflow,label:tr?'Otomasyonlar':'Automations'},{id:'prospects',Icon:Building2,label:tr?'B2B adaylar':'B2B prospects'},{id:'ads',Icon:BadgeDollarSign,label:tr?'Reklamlar':'Ads'},{id:'messaging',Icon:MessagesSquare,label:tr?'Mesajlaşma':'Messaging'},{id:'whatsapp',Icon:MessageCircle,label:'WhatsApp'},{id:'inbox',Icon:Inbox,label:tr?'Gelen kutusu':'Inbox'}] as const).map(({id,Icon,label})=><button key={id} aria-current={view===id?'page':undefined} onClick={()=>{setView(id);const url=new URL(window.location.href);url.searchParams.set('campaignView',id);window.history.replaceState({},'',url);}}><Icon size={16}/>{label}</button>)}</nav>{view==='drafts'?<ProjectDrafts kind="campaigns" lang={lang} canWrite={workspace.permissions?.includes('content.write')||false} goals={workspace.project.goals} contentLanguage={workspace.project.language}/>:view==='segments'?<ProjectSegments lang={lang}/>:view==='automations'?<ProjectAutomations lang={lang}/>:view==='prospects'?<ProjectProspects lang={lang}/>:view==='ads'?<ProjectAds lang={lang}/>:view==='messaging'?<ProjectMessaging lang={lang}/>:view==='whatsapp'?<ProjectWhatsApp lang={lang}/>:view==='inbox'?<ProjectSocialInbox lang={lang}/>:view==='recipients'?<ProjectRecipients lang={lang} canManage={workspace.permissions?.includes('recipients.manage')||false}/>:<ProjectEmailSender lang={lang} canManage={Boolean(workspace.permissions?.includes('connections.manage')&&workspace.permissions.includes('recipients.manage'))}/>}</div>;
}
