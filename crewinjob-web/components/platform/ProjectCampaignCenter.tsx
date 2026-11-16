'use client';
import {useEffect,useRef,useState} from 'react';
import { lazyTab } from '@/components/lazy-tab';
import {Megaphone,UsersRound,ShieldCheck,MailCheck,Workflow,Building2,BadgeDollarSign,MessagesSquare,MessageCircle,Inbox,Shapes,Radar} from 'lucide-react';
import type {WorkspaceContext,Locale} from '@/lib/platform/catalog';
import ProjectDrafts from './ProjectDrafts';
const ProjectSegments=lazyTab(() => import('./ProjectSegments'));
const ProjectRecipients=lazyTab(() => import('./ProjectRecipients'));
const ProjectEmailSender=lazyTab(() => import('./ProjectEmailSender'));
const ProjectAutomations=lazyTab(() => import('./ProjectAutomations'));
const ProjectProspects=lazyTab(() => import('./ProjectProspects'));
const ProjectAds=lazyTab(() => import('./ProjectAds'));
const DesignStudio=lazyTab(() => import('./DesignStudio'));
const WebMentionsPanel=lazyTab(() => import('./WebMentionsPanel'));
const ProjectMessaging=lazyTab(() => import('./ProjectMessaging'));
const ProjectWhatsApp=lazyTab(() => import('./ProjectWhatsApp'));
const ProjectSocialInbox=lazyTab(() => import('./ProjectSocialInbox'));
export default function ProjectCampaignCenter({workspace,lang}:{workspace:WorkspaceContext;lang:Locale}){
  const [view,setView]=useState<'drafts'|'segments'|'recipients'|'sender'|'automations'|'prospects'|'ads'|'banners'|'messaging'|'whatsapp'|'inbox'|'mentions'>('drafts'),tr=lang==='tr';
  const navigation=useRef<HTMLElement>(null);
  useEffect(()=>{const value=new URLSearchParams(window.location.search).get('campaignView');if(value==='segments'||value==='recipients'||value==='sender'||value==='automations'||value==='prospects'||value==='ads'||value==='banners'||value==='messaging'||value==='whatsapp'||value==='inbox'||value==='mentions')setView(value);},[]);
  useEffect(()=>{
    const nav=navigation.current;if(!nav)return;
    const reveal=()=>{const active=nav.querySelector<HTMLButtonElement>('button[aria-current]');if(!active)return;const left=active.getBoundingClientRect().left-nav.getBoundingClientRect().left,right=left+active.offsetWidth;if(left<0)nav.scrollBy({left:left-8});else if(right>nav.clientWidth)nav.scrollBy({left:right-nav.clientWidth+8});};
    reveal();const observer=new ResizeObserver(reveal);observer.observe(nav);return()=>observer.disconnect();
  },[view,lang]);
  return <div><nav ref={navigation} className="studio-settings-tabs segment-view-tabs" aria-label={tr?'Kampanya bölümleri':'Campaign sections'}>{([{id:'drafts',Icon:Megaphone,label:tr?'Taslaklar':'Drafts'},{id:'segments',Icon:UsersRound,label:tr?'Kitleler':'Audiences'},{id:'recipients',Icon:ShieldCheck,label:tr?'Alıcılar ve izinler':'Recipients & consent'},{id:'sender',Icon:MailCheck,label:tr?'Gönderen ve pilot':'Sender & pilot'},{id:'automations',Icon:Workflow,label:tr?'Otomasyonlar':'Automations'},{id:'prospects',Icon:Building2,label:tr?'B2B adaylar':'B2B prospects'},{id:'ads',Icon:BadgeDollarSign,label:tr?'Reklamlar':'Ads'},{id:'banners',Icon:Shapes,label:tr?'Banner seti':'Banner set'},{id:'messaging',Icon:MessagesSquare,label:tr?'Mesajlaşma':'Messaging'},{id:'whatsapp',Icon:MessageCircle,label:'WhatsApp'},{id:'inbox',Icon:Inbox,label:tr?'Gelen kutusu':'Inbox'},{id:'mentions',Icon:Radar,label:tr?'Web takibi':'Web mentions'}] as const).map(({id,Icon,label})=><button key={id} aria-current={view===id?'page':undefined} onClick={()=>{setView(id);const url=new URL(window.location.href);url.searchParams.set('campaignView',id);window.history.replaceState({},'',url);}}><Icon size={16}/>{label}</button>)}</nav>{view==='drafts'?<ProjectDrafts kind="campaigns" lang={lang} canWrite={workspace.permissions?.includes('content.write')||false} goals={workspace.project.goals} contentLanguage={workspace.project.language}/>:view==='segments'?<ProjectSegments lang={lang}/>:view==='automations'?<ProjectAutomations lang={lang}/>:view==='prospects'?<ProjectProspects lang={lang}/>:view==='ads'?<ProjectAds lang={lang}/>:view==='banners'?<section className="design-ads" aria-labelledby="banner-set-title"><div className="studio-section-title"><h2 id="banner-set-title">{tr?'Banner seti: tek tasarım, bütün reklam boyutları':'Banner set: one design, every ad size'}</h2><p className="studio-note">{tr?'Metni ve şablonu bir kez seçin; Meta, Google Display ve duyarlı reklamlar, LinkedIn, TikTok, X ve Pinterest boyutları marka kitinizle hazırlanır. Dosyalar tarayıcınızda üretilir ve ZIP olarak iner; reklam hesabına siz yüklersiniz.':'Choose the text and template once; Meta, Google Display and responsive, LinkedIn, TikTok, X and Pinterest sizes are made with your brand kit. Files are made in your browser and download as a ZIP; you upload them to the ad account.'}</p></div><DesignStudio lang={lang} mode="ads"/></section>:view==='messaging'?<ProjectMessaging lang={lang}/>:view==='whatsapp'?<ProjectWhatsApp lang={lang}/>:view==='inbox'?<ProjectSocialInbox lang={lang}/>:view==='mentions'?<WebMentionsPanel lang={lang}/>:view==='recipients'?<ProjectRecipients lang={lang} canManage={workspace.permissions?.includes('recipients.manage')||false}/>:<ProjectEmailSender lang={lang} canManage={Boolean(workspace.permissions?.includes('connections.manage')&&workspace.permissions.includes('recipients.manage'))}/>}</div>;
}
