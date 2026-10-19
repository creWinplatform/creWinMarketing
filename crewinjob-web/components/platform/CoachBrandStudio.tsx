'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Plus, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import type { CoachBrandSnapshot, CoachCompetitor, CoachVoiceAnswers } from '@/lib/platform/coach-types';
import Msg from '@/components/Msg';

const emptyVoice:CoachVoiceAnswers={traits:'',avoid:'',address:'formal',useWords:'',avoidWords:'',example:''};
const emptyCompetitor:CoachCompetitor={name:'',url:'',says:'',strengths:'',weaknesses:''};
const sources={ai:['AI önerisi','AI suggestion'],template:['Başlangıç şablonu','Starter template'],human:['Ekip düzenledi','Edited by the team']} as const;

// Brand voice workshop and competitor notes. AI or the starter template suggests; people edit and apply.
export default function CoachBrandStudio({workspace,lang,onUpdate}:{workspace:WorkspaceContext;lang:Locale;onUpdate?:(workspace:WorkspaceContext)=>void}){
  const tr=lang==='tr',idx=tr?0:1;
  const [data,setData]=useState<CoachBrandSnapshot|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState('');
  const [answers,setAnswers]=useState<CoachVoiceAnswers>(emptyVoice),[draft,setDraft]=useState(''),[competitors,setCompetitors]=useState<CoachCompetitor[]>([]),[difference,setDifference]=useState(''),[positioning,setPositioning]=useState('');
  const apply=(value:CoachBrandSnapshot)=>{setData(value);setAnswers(value.voiceAnswers||emptyVoice);setDraft(value.voiceDraft||'');setCompetitors(value.competitors);setDifference(value.difference);setPositioning(value.analysis?.positioning||'');};
  const load=useCallback(()=>{projectRequest<CoachBrandSnapshot>('/api/platform/coach/brand').then(apply).catch(reason=>setError(reason.message));},[]);
  useEffect(()=>{load();},[load]);
  const run=async(key:string,body:object,message:string)=>{if(busy||!data)return false;setBusy(key);setError('');setNotice('');try{const value=await projectRequest<CoachBrandSnapshot>('/api/platform/coach/brand',{method:'POST',body:JSON.stringify({...body,expectedRevision:data.revision}),signal:AbortSignal.timeout(45000)});apply(value);setNotice(message);return value;}catch(reason){setError(reason instanceof Error?reason.message:(tr?'İstek tamamlanamadı.':'Request failed.'));load();return false;}finally{setBusy('');}};
  if(error&&!data)return <p className="studio-error" role="alert"><Msg text={error}/></p>;
  if(!data)return <p className="studio-skeleton" role="status">{tr?'Marka çalışması yükleniyor…':'Loading the brand workshop…'}</p>;
  const mode=data.aiConfigured?'ai':'template';
  const field=(key:keyof CoachVoiceAnswers,label:string,hint:string,max:number,required=false)=><label className="coach-field"><span>{label}</span><small>{hint}</small><input aria-label={label} required={required} maxLength={max} value={answers[key]} onChange={event=>setAnswers({...answers,[key]:event.target.value})} disabled={!data.canWrite}/></label>;
  const submitVoice=(event:FormEvent)=>{event.preventDefault();void run('voice',{action:'voice',mode,answers},tr?'Marka dili taslağı hazır. Okuyup düzenleyin; ürün profiline uygulanana kadar hiçbir şey değişmez.':'The brand voice draft is ready. Read and edit it; nothing changes until it is applied to the product profile.');};
  return <section className="coach-brand">
    {error&&<div className="studio-error" role="alert"><Msg text={error}/></div>}
    {notice&&<p className="studio-success" role="status"><Msg text={notice}/></p>}
    {!data.aiConfigured&&data.canWrite&&<p className="coach-note"><Sparkles size={14}/>{tr?'Bu platformda AI yapılandırılmadı; öneriler yanıtlarınızdan kural tabanlı hazırlanır.':'AI isn’t configured on this platform; suggestions are rule-based from your answers.'}</p>}
    <section className="studio-band"><div className="studio-section-title"><h2>{tr?'Marka dili atölyesi':'Brand voice workshop'}</h2></div>
      <form className="coach-brand-grid" onSubmit={submitVoice}>
        {field('traits',tr?'Markanız nasıl konuşur? (3 sıfat)':'How does your brand sound? (3 adjectives)',tr?'Ör. sakin, açık, yardımsever':'E.g. calm, clear, helpful',120,true)}
        {field('avoid',tr?'Nasıl konuşmaz?':'How does it never sound?',tr?'Ör. abartılı, resmî, ukala':'E.g. hyped, stiff, smug',120,true)}
        <fieldset className="coach-options" disabled={!data.canWrite}><legend>{tr?'Müşteriye hitap':'Addressing customers'}</legend>{(['formal','informal','mixed'] as const).map(value=><label key={value} className={answers.address===value?'selected':''}><input type="radio" name="coach-address" checked={answers.address===value} onChange={()=>setAnswers({...answers,address:value})}/>{({formal:['“Siz” / resmî','Formal'],informal:['“Sen” / samimi','Informal'],mixed:['Kanala göre','Depends on the channel']} as const)[value][idx]}</label>)}</fieldset>
        {field('useWords',tr?'Sık kullandığınız ifadeler':'Words you like to use',tr?'Virgülle ayırın':'Separate with commas',200)}
        {field('avoidWords',tr?'Kullanmak istemedikleriniz':'Words you avoid',tr?'Virgülle ayırın':'Separate with commas',200)}
        {field('example',tr?'Beğendiğiniz bir cümle':'A sentence you like',tr?'Kendi metinlerinizden':'From your own copy',300)}
        {data.canWrite&&<div className="coach-footer-buttons"><button className="studio-primary" disabled={Boolean(busy)}><Sparkles size={15}/>{busy==='voice'?(tr?'Hazırlanıyor…':'Preparing…'):data.aiConfigured?(tr?'AI ile marka dili öner':'Suggest a voice with AI'):(tr?'Marka dili taslağı hazırla':'Prepare a voice draft')}</button></div>}
      </form>
      {data.voiceDraft!==null&&<div className="coach-brand-draft">
        <div className="coach-action-meta">{data.voiceSource&&<span className="studio-badge">{sources[data.voiceSource][idx]}</span>}{data.voiceAppliedAt&&<span className="coach-state done">{tr?'Ürün profiline uygulandı':'Applied to the product profile'}</span>}</div>
        <label className="coach-field"><span>{tr?'Marka dili taslağı':'Brand voice draft'}</span><textarea aria-label={tr?'Marka dili taslağı':'Brand voice draft'} rows={8} maxLength={2000} value={draft} onChange={event=>setDraft(event.target.value)} disabled={!data.canWrite}/></label>
        <div className="coach-action-buttons">
          {data.canWrite&&<button type="button" className="studio-text-button" disabled={Boolean(busy)||draft===data.voiceDraft||!draft.trim()} onClick={()=>void run('edit',{action:'edit-voice',draft},tr?'Taslak kaydedildi.':'Draft saved.')}>{tr?'Taslağı kaydet':'Save the draft'}</button>}
          {data.canApplyVoice?<button type="button" className="studio-secondary" disabled={Boolean(busy)||draft!==data.voiceDraft} onClick={async()=>{if(!window.confirm(tr?'Bu metin ürün profilindeki marka dilinin yerine geçsin mi? AI içerik taslakları bundan sonra bunu kullanır.':'Replace the product profile’s brand voice with this text? AI content drafts will use it from now on.'))return;const value=await run('apply',{action:'apply-voice'},tr?'Marka dili ürün profiline uygulandı.':'Brand voice applied to the product profile.');if(value)onUpdate?.({...workspace,project:{...workspace.project,brandVoice:value.currentVoice}});}}><Check size={15}/>{tr?'Ürün profiline uygula':'Apply to the product profile'}</button>
            :<span className="coach-muted">{tr?'Ürün profiline uygulamak için proje ayarlarını yöneten bir ekip üyesi gerekir.':'Applying to the product profile needs a teammate who manages project settings.'}</span>}
        </div>
        {data.currentVoice&&<details><summary>{tr?'Şu anki marka dili':'Current brand voice'}</summary><p className="coach-muted coach-preline">{data.currentVoice}</p></details>}
      </div>}
    </section>
    <section className="studio-band"><div className="studio-section-title"><h2>{tr?'Rakipler ve konumlandırma':'Competitors & positioning'}</h2></div>
      <p className="studio-note">{tr?'Yalnız ekibin yazdığı notlar kullanılır. Rakip siteleri ziyaret edilmez, taranmaz ve hiçbir bilgi doğrulanmış gibi gösterilmez.':'Only the team’s own notes are used. Competitor sites are not visited or crawled, and nothing is shown as verified.'}</p>
      <form className="coach-competitors" onSubmit={event=>{event.preventDefault();void run('competitors',{action:'competitors',competitors,difference},tr?'Rakip notları kaydedildi.':'Competitor notes saved.');}}>
        {competitors.map((item,index)=><fieldset key={index} className="coach-plan-item" disabled={!data.canWrite}>
          <label className="coach-field"><span>{tr?'Rakip adı':'Competitor name'}</span><input aria-label={tr?'Rakip adı':'Competitor name'} required maxLength={80} value={item.name} onChange={event=>setCompetitors(competitors.map((value,i)=>i===index?{...value,name:event.target.value}:value))}/></label>
          <label className="coach-field"><span>{tr?'Adres (isteğe bağlı, ziyaret edilmez)':'Address (optional, never visited)'}</span><input aria-label={tr?'Rakip adresi':'Competitor address'} type="url" maxLength={300} value={item.url} onChange={event=>setCompetitors(competitors.map((value,i)=>i===index?{...value,url:event.target.value}:value))}/></label>
          <label className="coach-field coach-span"><span>{tr?'Kendilerini nasıl anlatıyorlar?':'How do they describe themselves?'}</span><textarea aria-label={tr?'Kendilerini nasıl anlatıyorlar?':'How do they describe themselves?'} rows={2} maxLength={300} value={item.says} onChange={event=>setCompetitors(competitors.map((value,i)=>i===index?{...value,says:event.target.value}:value))}/></label>
          <label className="coach-field"><span>{tr?'Güçlü yanları (sizin gözleminiz)':'Strengths (your view)'}</span><textarea aria-label={tr?'Güçlü yanları':'Strengths'} rows={2} maxLength={300} value={item.strengths} onChange={event=>setCompetitors(competitors.map((value,i)=>i===index?{...value,strengths:event.target.value}:value))}/></label>
          <label className="coach-field"><span>{tr?'Zayıf yanları (sizin gözleminiz)':'Weaknesses (your view)'}</span><textarea aria-label={tr?'Zayıf yanları':'Weaknesses'} rows={2} maxLength={300} value={item.weaknesses} onChange={event=>setCompetitors(competitors.map((value,i)=>i===index?{...value,weaknesses:event.target.value}:value))}/></label>
          {data.canWrite&&<button type="button" className="studio-text-button coach-remove" onClick={()=>setCompetitors(competitors.filter((_,i)=>i!==index))}><Trash2 size={14}/>{tr?'Rakibi kaldır':'Remove competitor'}</button>}
        </fieldset>)}
        {data.canWrite&&competitors.length<5&&<button type="button" className="studio-text-button" onClick={()=>setCompetitors([...competitors,emptyCompetitor])}><Plus size={14}/>{tr?'Rakip ekle':'Add a competitor'}</button>}
        <label className="coach-field"><span>{tr?'Sizi farklı kılan ne?':'What makes you different?'}</span><small>{tr?'Kendi kelimelerinizle, kanıtlayabileceğiniz şeyler.':'In your words, things you can back up.'}</small><textarea aria-label={tr?'Sizi farklı kılan ne?':'What makes you different?'} rows={2} maxLength={400} value={difference} onChange={event=>setDifference(event.target.value)} disabled={!data.canWrite}/></label>
        {data.canWrite&&<div className="coach-footer-buttons"><button className="studio-secondary" disabled={Boolean(busy)}>{tr?'Notları kaydet':'Save the notes'}</button><button type="button" className="studio-primary" disabled={Boolean(busy)||!data.competitors.length||JSON.stringify(competitors)!==JSON.stringify(data.competitors)||difference!==data.difference} onClick={()=>void run('analyze',{action:'analyze',mode},tr?'Karşılaştırma hazır. Konumlandırma önerisini inceleyin.':'The comparison is ready. Review the positioning suggestion.')}><Sparkles size={15}/>{busy==='analyze'?(tr?'Hazırlanıyor…':'Preparing…'):(tr?'Karşılaştırma öner':'Suggest a comparison')}</button></div>}
      </form>
      {data.analysis&&<div className="coach-brand-draft">
        <div className="coach-action-meta">{data.analysisSource&&<span className="studio-badge">{sources[data.analysisSource][idx]}</span>}</div>
        <div className="studio-table-scroll"><table className="coach-keywords"><thead><tr><th>{tr?'Rakip':'Competitor'}</th><th>{tr?'Onların söylediği (notlarınız)':'What they say (your notes)'}</th><th>{tr?'Sizin açınız':'Your angle'}</th></tr></thead><tbody>{data.analysis.rows.map((row,index)=><tr key={index}><td>{row.name}</td><td data-label={tr?'Onlar':'They'}>{row.theirClaim}</td><td data-label={tr?'Siz':'You'}>{row.ourAngle||'—'}</td></tr>)}</tbody></table></div>
        {data.analysis.notes&&<p className="coach-muted">{data.analysis.notes}</p>}
        <label className="coach-field"><span>{tr?'Önerilen konumlandırma':'Suggested positioning'}</span><textarea aria-label={tr?'Önerilen konumlandırma':'Suggested positioning'} rows={3} maxLength={500} value={positioning} onChange={event=>setPositioning(event.target.value)} disabled={!data.canApplyPositioning}/></label>
        {data.positioning&&<p className="coach-muted">{tr?'Onaylı briefteki konumlandırma: ':'Positioning in the approved brief: '}{data.positioning}</p>}
        {data.hasBrief?(data.canApplyPositioning?<button type="button" className="studio-secondary" disabled={Boolean(busy)||!positioning.trim()} onClick={()=>{if(window.confirm(tr?'Onaylı strateji briefindeki konumlandırma bu metinle değiştirilsin mi? Değişiklik brief geçmişine kaydedilir.':'Replace the positioning in the approved strategy brief with this text? The change is kept in the brief history.'))void run('positioning',{action:'apply-positioning',positioning,expectedCoachRevision:data.coachRevision},tr?'Konumlandırma onaylı briefe uygulandı.':'Positioning applied to the approved brief.');}}><Check size={15}/>{tr?'Briefe uygula':'Apply to the brief'}</button>
          :<span className="coach-muted">{tr?'Briefe uygulamak için onay yetkisi gerekir.':'Applying to the brief needs approval rights.'}</span>):<span className="coach-muted">{tr?'Konumlandırmayı uygulamak için önce bir strateji briefi onaylayın.':'Approve a strategy brief first to apply the positioning.'}</span>}
      </div>}
    </section>
    <p className="compass-safety"><ShieldCheck size={15}/>{tr?'Öneriler sizin yanıtlarınıza ve notlarınıza dayanır; rakam, garanti veya doğrulanmamış rakip bilgisi eklenmez.':'Suggestions rely only on your answers and notes; no numbers, promises or unverified competitor facts are added.'}</p>
  </section>;
}
