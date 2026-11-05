'use client';
import { useCallback,useEffect,useState,type FormEvent } from 'react';
import { ImagePlus,Check,Send,Trash2,Pencil } from 'lucide-react';
import { projectRequest } from '@/lib/platform/client';
import type { AdCreativeView,TikTokAdSetupView } from '@/lib/platform/ad-types';
import Msg from '@/components/Msg';

type List={creatives:AdCreativeView[];enabled:boolean;canWrite:boolean;canApprove:boolean;canUpload:boolean;ctas:string[];tiktok:TikTokAdSetupView|null};
const CTA:Record<string,[string,string]>={LEARN_MORE:['Daha fazla bilgi','Learn more'],SHOP_NOW:['Alışverişe başla','Shop now'],SIGN_UP:['Kaydol','Sign up'],BOOK_NOW:['Hemen rezervasyon yap','Book now'],CONTACT_US:['Bize ulaşın','Contact us'],DOWNLOAD:['İndir','Download'],INSTALL_MOBILE_APP:['Uygulamayı yükle','Install now']};
const readFile=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});

// The images of one created Meta or TikTok plan: drafted, approved, then sent on an explicit go-ahead.
export default function AdCreatives({planId,provider,tr}:{planId:string;provider:'meta'|'tiktok';tr:boolean}){
  const t=(a:string,b:string)=>tr?a:b,idx=tr?0:1;
  const [data,setData]=useState<List|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
  const [form,setForm]=useState<{id?:string;revision?:number;image:{data:string;mime:string}|null;preview:string;headline:string;primaryText:string;cta:string;pageId:string;videoUrl:string}|null>(null),[ack,setAck]=useState<Record<string,boolean>>({}),[setup,setSetup]=useState({displayName:'',tiktokAppId:'',ack:false});
  const load=useCallback(()=>{projectRequest<List>(`/api/platform/ad-creatives?provider=${provider}&planId=${encodeURIComponent(planId)}`).then(setData).catch(reason=>setError(reason instanceof Error?reason.message:t('Görseller yüklenemedi.','Images could not be loaded.')));},[planId,provider]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(open&&!data)load();},[open,data,load]);
  const post=async(body:Record<string,unknown>,message?:string)=>{if(busy)return false;setBusy(true);setError('');setNotice('');
    try{setData(await projectRequest<List>('/api/platform/ad-creatives',{method:'POST',body:JSON.stringify({...body,provider,planId}),signal:AbortSignal.timeout(65000)}));if(message)setNotice(message);return true;}
    catch(reason){setError(reason instanceof Error?reason.message:t('İstek tamamlanamadı.','Request failed.'));return false;}finally{setBusy(false);}};
  const save=(event:FormEvent)=>{event.preventDefault();if(!form)return;void post({action:'save',...(form.id?{id:form.id,expectedRevision:form.revision}:{}),...(form.image?{image:form.image}:{}),headline:form.headline,primaryText:form.primaryText,cta:form.cta,pageId:form.pageId,videoUrl:form.videoUrl.trim()},t('Görsel taslağı kaydedildi. Göndermek için onay gerekir.','Image draft saved. Sending it needs approval.')).then(ok=>{if(ok)setForm(null);});};
  const state=(item:AdCreativeView)=>({draft:t('Taslak','Draft'),approved:t('Onaylı','Approved'),uploading:t('Yükleniyor','Uploading'),uploaded:provider==='meta'?t('Meta’da duraklatılmış reklam','Paused ad on Meta'):item.adRef?t('TikTok’ta durdurulmuş reklam','Disabled ad on TikTok'):t('TikTok kütüphanesinde','In the TikTok library'),failed:t('Yüklenemedi','Failed')})[item.state];
  return <div className="ads-creatives">
    <button type="button" className="studio-text-button" aria-expanded={open} onClick={()=>setOpen(!open)}><ImagePlus size={15}/>{t('Reklam görselleri','Ad images')}{data?` (${data.creatives.length})`:''}</button>
    {open&&<div className="ads-creatives-body">
      {error&&<p className="studio-error" role="alert"><Msg text={error}/></p>}{notice&&<p className="coach-muted" role="status">{notice}</p>}
      {!data?<p className="coach-muted" role="status">{t('Yükleniyor…','Loading…')}</p>:<>
        <p className="coach-muted">{provider==='meta'?t('Onaylanan görsel, metniyle birlikte Meta’ya yüklenir ve planın reklam setinde duraklatılmış bir reklam oluşturulur. Harcama yine yalnız planın ayrı başlatma onayıyla başlar.','An approved image is uploaded to Meta with its text and a paused ad is created in the plan’s ad set. Spending still starts only with the plan’s own start approval.'):t('Onaylanan görsel ve video TikTok reklam hesabının kütüphanesine yüklenir. Planın TikTok reklam grubu kuruluysa video, o grupta durdurulmuş bir reklama dönüşür. TikTok reklamı video ister; yalnız görsel kütüphanede kalır.','An approved image and video go to the TikTok ad account’s library. If the plan’s TikTok ad group is set up, the video becomes a disabled ad in it. TikTok ads need a video; an image alone stays in the library.')}</p>
        {data.tiktok&&(data.tiktok.ready?<p className="coach-muted">{t(`TikTok reklam grubu kurulu (${data.tiktok.adgroupId}) · görünen ad: ${data.tiktok.displayName}`,`TikTok ad group set up (${data.tiktok.adgroupId}) · display name: ${data.tiktok.displayName}`)}</p>
          :data.canUpload&&<form className="ads-creative-form" onSubmit={event=>{event.preventDefault();void post({action:'setupTikTok',displayName:setup.displayName,tiktokAppId:setup.tiktokAppId,acknowledged:setup.ack},t('TikTok reklam grubu durdurulmuş olarak kuruldu.','The TikTok ad group was set up, disabled.'));}}>
            <strong>{t('TikTok reklam grubu','TikTok ad group')}</strong>
            <p className="coach-muted">{t('Planın onaylı bütçesi, tarihleri ve ülkeleriyle durdurulmuş bir reklam grubu ve reklamda görünecek bir ad oluşturulur. Ülkeler TikTok’un konum listesinden eşleşir; bulunamazsa hiçbir şey oluşturulmaz.','A disabled ad group with the plan’s approved budget, dates and countries, and a display name for the ads, are created. Countries are matched to TikTok’s location list; if one is missing nothing is created.')}</p>
            <label>{t('Reklamda görünecek ad','Display name on the ads')}<input required maxLength={40} value={setup.displayName} onChange={event=>setSetup({...setup,displayName:event.target.value})}/></label>
            {data.tiktok.needsAppId&&<label>{t('TikTok’taki uygulama kimliği (App ID)','App ID in TikTok')}<input required inputMode="numeric" pattern="[0-9]{5,25}" value={setup.tiktokAppId} onChange={event=>setSetup({...setup,tiktokAppId:event.target.value.trim()})}/></label>}
            <label className="ads-check"><input type="checkbox" checked={setup.ack} onChange={event=>setSetup({...setup,ack:event.target.checked})}/>{t('TikTok’ta durdurulmuş reklam grubu oluşturulmasını onaylıyorum.','I approve creating a disabled ad group on TikTok.')}</label>
            <div className="coach-action-buttons"><button className="studio-secondary" disabled={busy||!data.enabled||!setup.ack}>{t('Reklam grubunu kur','Set up the ad group')}</button></div>
          </form>)}
        {data.creatives.length>0&&<ul className="ads-creative-list">{data.creatives.map(item=><li key={item.id}>
          <img src={item.thumbnail} alt={item.headline||t('Reklam görseli','Ad image')} width={96} height={Math.round(96*item.height/Math.max(1,item.width))}/>
          <div><span className={`coach-state ${item.state==='uploaded'?'done':''}`}>{state(item)}</span>
            {item.headline&&<strong>{item.headline}</strong>}{item.primaryText&&<p>{item.primaryText}</p>}
            {item.videoUrl&&<small className="coach-muted">{t('Video','Video')}: {item.videoUrl.replace(/^https:\/\//,'').slice(0,60)}{item.videoBytes?` · ${Math.round(item.videoBytes/1048576)} MB`:''}{item.videoRef?` · ${item.videoRef.slice(0,12)}`:''}</small>}
            <small className="coach-muted">{CTA[item.cta]?.[idx]||item.cta}{item.pageId?` · ${t('Sayfa','Page')} ${item.pageId}`:''} · {item.width}×{item.height}{item.adRef?` · ${t('reklam','ad')} ${item.adRef}`:item.imageRef?` · ${item.imageRef.slice(0,12)}`:''}</small>
            {item.lastError&&<p className="studio-error"><Msg text={item.lastError}/></p>}
            <div className="coach-action-buttons">
              {data.canWrite&&['draft','approved','failed'].includes(item.state)&&<button type="button" className="studio-secondary" disabled={busy} onClick={()=>setForm({id:item.id,revision:item.revision,image:null,preview:item.thumbnail,headline:item.headline,primaryText:item.primaryText,cta:item.cta,pageId:item.pageId,videoUrl:item.videoUrl||''})}><Pencil size={14}/>{t('Düzenle','Edit')}</button>}
              {data.canApprove&&item.state==='draft'&&<button type="button" className="studio-secondary" disabled={busy} onClick={()=>void post({action:'approve',id:item.id,expectedRevision:item.revision},t('Görsel onaylandı.','Image approved.'))}><Check size={14}/>{t('Onayla','Approve')}</button>}
              {data.canUpload&&(item.approved||(provider==='tiktok'&&item.state==='uploaded'&&item.videoRef&&!item.adRef&&data.tiktok?.ready))&&<><label className="ads-check"><input type="checkbox" checked={Boolean(ack[item.id])} onChange={event=>setAck({...ack,[item.id]:event.target.checked})}/>{provider==='meta'?t('Görselin Meta’ya yüklenmesini ve duraklatılmış reklam oluşturulmasını onaylıyorum.','I approve uploading the image to Meta and creating a paused ad.'):t('Görselin TikTok kütüphanesine yüklenmesini onaylıyorum.','I approve uploading the image to the TikTok library.')}</label>
                <button type="button" className="studio-primary" disabled={busy||!data.enabled||!ack[item.id]} onClick={()=>void post({action:'upload',id:item.id,acknowledged:true},t('Görsel gönderildi.','Image sent.'))}><Send size={14}/>{t('Gönder','Send')}</button></>}
              {data.canWrite&&!['uploading','uploaded'].includes(item.state)&&<button type="button" className="studio-text-button" disabled={busy} onClick={()=>void post({action:'delete',id:item.id})}><Trash2 size={14}/>{t('Sil','Delete')}</button>}
            </div></div>
        </li>)}</ul>}
        {data.canWrite&&!form&&data.creatives.length<10&&<button type="button" className="studio-secondary" onClick={()=>setForm({image:null,preview:'',headline:'',primaryText:'',cta:data.ctas[0],pageId:data.creatives.find(item=>item.pageId)?.pageId||'',videoUrl:''})}><ImagePlus size={15}/>{t('Görsel ekle','Add image')}</button>}
        {form&&<form className="ads-creative-form" onSubmit={save}>
          <label>{t('Görsel (JPEG, PNG veya WebP; en/boy 0,5–1,91)','Image (JPEG, PNG or WebP; ratio 0.5–1.91)')}<input type="file" accept="image/jpeg,image/png,image/webp" required={!form.id} onChange={event=>{const file=event.target.files?.[0];if(!file)return;if(file.size>5*1024*1024){setError(t('Görsel en fazla 5 MB olabilir.','The image can be at most 5 MB.'));return;}void readFile(file).then(data=>setForm(value=>value&&{...value,image:{data,mime:file.type},preview:URL.createObjectURL(file)}));}}/></label>
          {form.preview&&<img className="ads-creative-preview" src={form.preview} alt="" width={160}/>}
          <label>{t('Video adresi (isteğe bağlı; görsel kapak olur)','Video address (optional; the image becomes its cover)')}<input type="url" placeholder="https://…/video.mp4" value={form.videoUrl} onChange={event=>setForm({...form,videoUrl:event.target.value})}/><small className="coach-muted">{t('Kendi sunucunuzdaki MP4 veya MOV (en çok 300 MB, yönlendirmesiz). Sağlayıcı videoyu bu adresten alır.','An MP4 or MOV on your own server (up to 300 MB, no redirect). The provider fetches the video from this address.')}</small></label>
          <label>{t('Başlık (isteğe bağlı)','Headline (optional)')}<input maxLength={40} value={form.headline} onChange={event=>setForm({...form,headline:event.target.value})}/></label>
          <label>{t('Reklam metni','Ad text')}<textarea rows={3} maxLength={provider==='tiktok'?100:500} required={provider==='meta'} value={form.primaryText} onChange={event=>setForm({...form,primaryText:event.target.value})}/></label>
          <label>{t('Eylem düğmesi','Call to action')}<select value={form.cta} onChange={event=>setForm({...form,cta:event.target.value})}>{data.ctas.map(item=><option key={item} value={item}>{CTA[item]?.[idx]||item}</option>)}</select></label>
          {provider==='meta'&&<label>{t('Facebook Sayfası kimliği','Facebook Page ID')}<input inputMode="numeric" pattern="[0-9]{5,25}" required value={form.pageId} onChange={event=>setForm({...form,pageId:event.target.value.trim()})}/></label>}
          <div className="coach-action-buttons"><button className="studio-primary" disabled={busy}>{t('Taslağı kaydet','Save draft')}</button><button type="button" className="studio-secondary" onClick={()=>setForm(null)}>{t('Vazgeç','Cancel')}</button></div>
        </form>}
        {!data.enabled&&<p className="coach-muted">{t('Reklam görseli gönderme bu sunucuda kapalı (PLATFORM_AD_CREATIVES_ENABLED). Görseller hazırlanıp onaylanabilir.','Sending ad images is off on this server (PLATFORM_AD_CREATIVES_ENABLED). Images can still be prepared and approved.')}</p>}
      </>}
    </div>}
  </div>;
}
