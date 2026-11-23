'use client';
import {useEffect,useState} from 'react';
import { lazyTab } from '@/components/lazy-tab';
import {Megaphone,UsersRound,ShieldCheck,MailCheck,Workflow,Building2,BadgeDollarSign,MessagesSquare,MessageCircle,Inbox,Shapes,Radar} from 'lucide-react';
import type {WorkspaceContext,Locale} from '@/lib/platform/catalog';
import ProjectDrafts from './ProjectDrafts';
import GroupedTabs from './GroupedTabs';
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
  useEffect(()=>{const value=new URLSearchParams(window.location.search).get('campaignView');if(value==='segments'||value==='recipients'||value==='sender'||value==='automations'||value==='prospects'||value==='ads'||value==='banners'||value==='messaging'||value==='whatsapp'||value==='inbox'||value==='mentions')setView(value);},[]);

  return <div><GroupedTabs name="campaigns" label={tr?'Kampanya bölümleri':'Campaign sections'} value={view} onChange={id=>{setView(id);const url=new URL(window.location.href);url.searchParams.set('campaignView',id);window.history.replaceState({},'',url);}} groups={[
    {id:'email',Icon:Megaphone,label:tr?'Kampanya ve e-posta':'Campaigns & email',hint:tr?'Taslağı yazın, kime gideceğini seçin, gönderen adresi ve izinleri hazırlayın. Hiçbir şey onaysız gitmez.':'Write the draft, choose who gets it, prepare the sender address and consents. Nothing goes out without approval.',items:[{id:'drafts',Icon:Megaphone,label:tr?'Taslaklar':'Drafts'},{id:'segments',Icon:UsersRound,label:tr?'Kitleler':'Audiences'},{id:'recipients',Icon:ShieldCheck,label:tr?'Alıcılar ve izinler':'Recipients & consent'},{id:'sender',Icon:MailCheck,label:tr?'Gönderen ve pilot':'Sender & pilot'},{id:'automations',Icon:Workflow,label:tr?'Otomasyonlar':'Automations'}]},
    {id:'sales',Icon:Building2,label:tr?'Satış asistanı (B2B)':'Sales assistant (B2B)',hint:tr?'Firma bulun, puanlayın, onaylı e-postayla ulaşın; görüşme ve teklifle müşteriye çevirin.':'Find companies, score them, reach them with approved emails and turn them into customers with meetings and proposals.',items:[{id:'prospects',Icon:Building2,label:tr?'B2B adaylar':'B2B prospects'}]},
    {id:'ads',Icon:BadgeDollarSign,label:tr?'Reklam':'Ads',hint:tr?'Reklam hesabını bağlayın, harcama tavanı koyun, planı onaylayın; görselleri banner setinden alın.':'Connect the ad account, set a spend cap, approve the plan; take the images from the banner set.',items:[{id:'ads',Icon:BadgeDollarSign,label:tr?'Reklamlar':'Ads'},{id:'banners',Icon:Shapes,label:tr?'Banner seti':'Banner set'}]},
    {id:'messages',Icon:Inbox,label:tr?'Mesajlar':'Messages',hint:tr?'Yorum ve mesajlara tek yerden cevap verin; WhatsApp ve Telegram gönderimlerini yönetin.':'Answer comments and messages in one place; manage WhatsApp and Telegram sends.',items:[{id:'inbox',Icon:Inbox,label:tr?'Gelen kutusu':'Inbox'},{id:'whatsapp',Icon:MessageCircle,label:'WhatsApp'},{id:'messaging',Icon:MessagesSquare,label:tr?'Mesajlaşma':'Messaging'}]},
    {id:'mentions',Icon:Radar,label:tr?'Web takibi':'Web mentions',hint:tr?'İnternette markanızdan söz edilen haber ve yazılar; olumsuz olanlar için uyarı alırsınız.':'News and posts mentioning your brand on the web; you are alerted to negative ones.',items:[{id:'mentions',Icon:Radar,label:tr?'Web takibi':'Web mentions'}]},
  ]}/>{view==='drafts'?<ProjectDrafts kind="campaigns" lang={lang} canWrite={workspace.permissions?.includes('content.write')||false} goals={workspace.project.goals} contentLanguage={workspace.project.language}/>:view==='segments'?<ProjectSegments lang={lang}/>:view==='automations'?<ProjectAutomations lang={lang}/>:view==='prospects'?<ProjectProspects lang={lang}/>:view==='ads'?<ProjectAds lang={lang}/>:view==='banners'?<section className="design-ads" aria-labelledby="banner-set-title"><div className="studio-section-title"><h2 id="banner-set-title">{tr?'Banner seti: tek tasarım, bütün reklam boyutları':'Banner set: one design, every ad size'}</h2><p className="studio-note">{tr?'Metni ve şablonu bir kez seçin; Meta, Google Display ve duyarlı reklamlar, LinkedIn, TikTok, X ve Pinterest boyutları marka kitinizle hazırlanır. Dosyalar tarayıcınızda üretilir ve ZIP olarak iner; reklam hesabına siz yüklersiniz.':'Choose the text and template once; Meta, Google Display and responsive, LinkedIn, TikTok, X and Pinterest sizes are made with your brand kit. Files are made in your browser and download as a ZIP; you upload them to the ad account.'}</p></div><DesignStudio lang={lang} mode="ads"/></section>:view==='messaging'?<ProjectMessaging lang={lang}/>:view==='whatsapp'?<ProjectWhatsApp lang={lang}/>:view==='inbox'?<ProjectSocialInbox lang={lang}/>:view==='mentions'?<WebMentionsPanel lang={lang}/>:view==='recipients'?<ProjectRecipients lang={lang} canManage={workspace.permissions?.includes('recipients.manage')||false}/>:<ProjectEmailSender lang={lang} canManage={Boolean(workspace.permissions?.includes('connections.manage')&&workspace.permissions.includes('recipients.manage'))}/>}</div>;
}
