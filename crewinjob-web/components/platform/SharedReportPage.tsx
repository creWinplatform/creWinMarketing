'use client';
import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import Brand from '@/components/platform/Brand';
import type { SharedReport } from '@/lib/platform/monthly-report-types';
import MonthlyReportDocument from './MonthlyReportDocument';

// Opens a shared report with the token from the fragment. The page chrome follows the visitor's language; the report
// itself is in the language it was approved in.
export default function SharedReportPage({lang}:{lang:'tr'|'en'}){
  const tr=lang==='tr';
  const [report,setReport]=useState<SharedReport|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const token=new URLSearchParams(window.location.hash.slice(1)).get('token')||'',controller=new AbortController();
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)){setFailed(true);return;}
    fetch('/api/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])})
      .then(async response=>{if(!response.ok)throw new Error();setReport(await response.json() as SharedReport);}).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return()=>controller.abort();
  },[]);
  const expires=report?new Date(report.expiresAt).toLocaleDateString(report.facts.language==='tr'?'tr-TR':'en-GB',{day:'numeric',month:'long',year:'numeric'}):'';
  return <div className="shared-report-page">
    <header className="shared-report-bar"><Brand/>{report&&<button type="button" className="studio-secondary" onClick={()=>window.print()}><Printer size={15}/>{tr?'Yazdır / PDF':'Print / PDF'}</button>}</header>
    <main id="ryzevo-main" className="shared-report-main">
      {failed?<p role="alert" className="studio-error">{tr?'Bu rapor bağlantısı geçersiz, süresi dolmuş veya kapatılmış. Raporu paylaşan kişiden yeni bir bağlantı isteyin.':'This report link is invalid, has expired or was turned off. Ask the person who shared it for a new link.'}</p>
        :!report?<p role="status" className="studio-note">{tr?'Rapor yükleniyor…':'Loading the report…'}</p>
        :<><MonthlyReportDocument facts={report.facts} note={report.note} approvedAt={report.approvedAt}/><p className="monthly-report-muted shared-report-expiry">{tr?`Bu bağlantı ${expires} tarihine kadar geçerlidir. Ryzevo ile hazırlandı.`:`This link is valid until ${expires}. Prepared with Ryzevo.`}</p></>}
    </main>
  </div>;
}
