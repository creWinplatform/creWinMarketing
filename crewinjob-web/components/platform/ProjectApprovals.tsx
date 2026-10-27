'use client';
import { useEffect, useState } from 'react';
import { ClipboardCheck, ExternalLink } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { ApprovalItem, ApprovalsView } from '@/lib/platform/approvals-types';

// "Waiting for your decision": one list of what needs this member's approval across the workspace. Each row opens the
// screen where the decision is made; nothing is approved from here. Hidden when nothing is waiting.
export default function ProjectApprovals({lang}:{lang:Locale}){
  const tr=lang==='tr',locale=localeTag(lang);
  const [data,setData]=useState<ApprovalsView|null>(null);
  useEffect(()=>{const controller=new AbortController();
    projectRequest<ApprovalsView>('/api/platform/approvals',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])}).then(setData).catch(()=>{});
    return()=>controller.abort();},[]);
  if(!data?.items.length)return null;
  const n=(value:number)=>value.toLocaleString(locale);
  const since=(value:string|null)=>{if(!value)return '';const days=Math.floor((Date.now()-Date.parse(value))/86400000);return days<1?(tr?'bugün':'today'):tr?`${n(days)} gündür bekliyor`:`waiting ${n(days)} day(s)`;};
  const text=(item:ApprovalItem)=>{const c=n(item.count);switch(item.kind){
    case 'coach_brief':return tr?'Büyüme koçunun strateji taslağı onayınızı bekliyor.':'The growth coach’s strategy draft is waiting for your approval.';
    case 'coach_review':return tr?`Haftalık değerlendirmede ${c} plan önerisi kararınızı bekliyor.`:`${c} plan proposal(s) in the weekly review are waiting for your decision.`;
    case 'coach_renewal':return tr?'Bu ayın plan yenilemesi önerildi; onaylanana kadar plan değişmez.':'This month’s plan renewal was proposed; the plan doesn’t change until it is approved.';
    case 'content_plan':return tr?`${c} içerik planı önerisi onay veya ret bekliyor.`:`${c} content plan suggestion(s) are waiting to be approved or dismissed.`;
    case 'inbox_reply':return tr?`${c} kayıtlı cevap gönderilmeyi bekliyor (mesajlarda 24 saatlik pencere kapanmadan).`:`${c} saved repl(ies) are waiting to be sent (for messages, before the 24-hour window closes).`;
    case 'ad_plan':return tr?`${c} reklam planı taslağı onay bekliyor. Onaylamak harcama başlatmaz.`:`${c} ad plan draft(s) are waiting for approval. Approving does not start spend.`;
    case 'whatsapp_approve':return tr?`${c} WhatsApp gönderisi onay bekliyor.`:`${c} WhatsApp send(s) are waiting for approval.`;
    case 'whatsapp_send':return tr?`${c} onaylı WhatsApp gönderisi prova veya gönderim bekliyor.`:`${c} approved WhatsApp send(s) are waiting for a rehearsal or send.`;
    case 'automation':return tr?`Otomasyonlarda sırası gelen ${c} kişi pilot gönderim onayı bekliyor.`:`${c} due contact(s) in automations are waiting for a pilot send approval.`;
    case 'monthly_report':return tr?'Geçen ayın sonuç raporu hazır; onaylanmadan paylaşılamaz.':'Last month’s results report is ready; it can’t be shared until it is approved.';
  }};
  const open:Record<ApprovalItem['kind'],string>={coach_brief:tr?'Büyüme koçu':'Growth coach',coach_review:tr?'Haftalık değerlendirme':'Weekly review',coach_renewal:tr?'Aylık yenileme':'Monthly renewal',content_plan:tr?'İçerik planı':'Content plan',inbox_reply:tr?'Gelen kutusu':'Inbox',ad_plan:tr?'Reklamlar':'Ads',whatsapp_approve:'WhatsApp',whatsapp_send:'WhatsApp',automation:tr?'Otomasyonlar':'Automations',monthly_report:tr?'Aylık rapor':'Monthly report'};
  const total=data.items.reduce((sum,item)=>sum+item.count,0);
  return <section className="studio-band team-alerts project-approvals" aria-labelledby="project-approvals-title">
    <div className="studio-section-title"><h2 id="project-approvals-title"><ClipboardCheck size={16}/>{tr?'Kararınızı bekleyenler':'Waiting for your decision'}</h2><span className="studio-badge">{n(total)}</span></div>
    <ul className="team-alert-list">{data.items.map(item=><li key={item.kind} className="team-alert">
      <span>{text(item)}{item.oldest&&<small className="approval-age"> · {since(item.oldest)}</small>}</span>
      <a className="studio-text-button" href={item.href}>{open[item.kind]}<ExternalLink size={14}/></a></li>)}</ul>
    <p className="studio-note">{tr?'Burada yalnız sizin karar verebileceğiniz işler görünür. Onay, her işin kendi ekranında önizleme ve açık onayla verilir.':'Only work you can decide on appears here. Approval is given on each item’s own screen, with its preview and an explicit acknowledgement.'}</p>
  </section>;
}
