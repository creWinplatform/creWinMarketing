'use client';
import { useState } from 'react';
import { RefreshCw,Sparkles,Save,Check,Send,Trash2,Star } from 'lucide-react';
import { localeTag } from '@/lib/i18n/shared';
import { translateMessage } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/platform/catalog';
import type { MobileApp,MobileReviewView,MobileReviewsSnapshot,MobileWorkspace } from '@/lib/platform/mobile-types';

type Props={lang:Locale;data:MobileWorkspace;app:MobileApp;busy:boolean;run:(action:()=>Promise<unknown>,text?:string)=>Promise<void>;post:<T,>(input:Record<string,unknown>)=>Promise<T>};
const stars=(rating:number)=>'★'.repeat(rating)+'☆'.repeat(5-rating);

// Store reviews: read from the stores, answered from a draft that an approver accepts on its exact text.
export default function MobileReviews({lang,data,app,busy,run,post}:Props){
  const tr=lang==='tr',t=(a:string,b:string)=>tr?a:b;
  const [snapshot,setSnapshot]=useState<MobileReviewsSnapshot|null>(null),[filter,setFilter]=useState('all'),[drafts,setDrafts]=useState<Record<string,string>>({}),[ack,setAck]=useState<Record<string,boolean>>({});
  const view=snapshot||data.reviews;if(!view)return null;
  const stores=[...(app.appleId&&app.platform!=='android'?['ios' as const]:[]),...(app.packageName&&app.platform!=='ios'?['android' as const]:[])];
  const connected=(store:'ios'|'android')=>data.integrations.some(item=>item.active&&item.provider===(store==='ios'?'app_store_connect':'google_play'));
  const act=(input:Record<string,unknown>,text?:string,after?:()=>void)=>void run(async()=>{const value=await post<MobileReviewsSnapshot|{snapshot:MobileReviewsSnapshot}>({...input,appId:app.id,filter});setSnapshot('snapshot' in value?value.snapshot:value);after?.();},text);
  const changeFilter=(value:string)=>{setFilter(value);void run(async()=>setSnapshot(await post<MobileReviewsSnapshot>({action:'reviewList',appId:app.id,filter:value})));};
  const stateText=(state:string)=>({draft:t('Taslak','Draft'),approved:t('Onaylı','Approved'),sending:t('Gönderiliyor','Sending'),sent:t('Yayınlandı','Published'),failed:t('Gönderilemedi','Failed')} as Record<string,string>)[state]||state;
  const limit=(review:MobileReviewView)=>view.limits[review.store];
  return <>
    <section className="studio-band">
      <div className="studio-section-title"><h2>{t('Mağaza yorumları','Store reviews')}</h2><div className="mobile-actions">{data.canWrite&&stores.map(store=><button key={store} className="studio-secondary" disabled={busy||!connected(store)} title={connected(store)?undefined:t('Entegrasyonlar bölümünden bağlantı kurun.','Set up the connection under Integrations.')} onClick={()=>act({action:'syncReviews',store},t('Yorumlar okundu.','Reviews read.'))}><RefreshCw size={16}/>{store==='ios'?t('App Store yorumlarını getir','Get App Store reviews'):t('Google Play yorumlarını getir','Get Google Play reviews')}</button>)}</div></div>
      <p className="studio-subtitle">{t('Yorumlar her gün bir kez kendiliğinden okunur. Google Play yalnız son bir haftada yazılan veya değişen yorumları verir.','Reviews are read once a day on their own. Google Play only returns reviews written or changed in the last week.')}</p>
      {!view.stats.length?<p className="studio-empty">{stores.some(connected)?t('Henüz yorum okunmadı.','No reviews read yet.'):t('Yorumları okumak için App Store Connect veya Google Play bağlantısını Entegrasyonlar bölümünden kurun.','To read reviews, set up App Store Connect or Google Play under Integrations.')}</p>:
      <div className="mobile-review-stats">{view.stats.map(item=><article key={item.store}>
        <h3>{item.store==='ios'?'App Store':'Google Play'}</h3>
        <div className="mobile-review-score"><strong>{item.average===null?'—':item.average.toLocaleString(localeTag(lang),{maximumFractionDigits:2})}</strong><span>{t(`${item.count} yorum`,`${item.count} reviews`)}</span></div>
        <ol className="mobile-review-bars" aria-label={t('Puan dağılımı','Rating distribution')}>{[5,4,3,2,1].map(rating=>{const count=item.distribution[rating-1],share=item.count?Math.round(count/item.count*100):0;return <li key={rating}><span>{rating}★</span><span className="mobile-review-bar"><span style={{width:`${share}%`}}/></span><span>{count}</span></li>;})}</ol>
        <p className="studio-note">{t('Son 30 gün','Last 30 days')}: {item.recentAverage===null?'—':`${item.recentAverage} · ${item.recentCount}`} · {t('Yanıtsız','Unanswered')}: {item.unanswered}{item.syncedAt?` · ${t('Son okuma','Last read')} ${new Date(item.syncedAt).toLocaleString(localeTag(lang))}`:''}</p>
      </article>)}</div>}
    </section>
    {view.stats.length>0&&<section className="studio-band">
      <div className="studio-section-title"><h2>{t('Son yorumlar','Latest reviews')}</h2><label className="mobile-review-filter">{t('Göster','Show')}<select value={filter} onChange={event=>changeFilter(event.target.value)}><option value="all">{t('Tümü','All')}</option><option value="unanswered">{t('Yanıtsız','Unanswered')}</option><option value="low">{t('1–3 yıldız','1–3 stars')}</option></select></label></div>
      {!view.reviews.length?<p className="studio-empty">{t('Bu filtrede yorum yok.','No reviews for this filter.')}</p>:view.reviews.map(review=>{const draft=drafts[review.id]??review.reply?.text??'',reply=review.reply,editable=!reply||['draft','approved','failed'].includes(reply.state),changed=draft!==(reply?.text??'');
        return <article className="mobile-review" key={review.id}>
          <header><span className={`mobile-review-stars mobile-review-stars-${review.rating}`} aria-label={t(`${review.rating} yıldız`,`${review.rating} stars`)}>{stars(review.rating)}</span><span className="studio-badge">{review.store==='ios'?'App Store':'Google Play'}{review.territory?` · ${review.territory}`:''}{review.appVersion?` · v${review.appVersion}`:''}</span><small>{review.author||t('İsimsiz','Anonymous')} · {new Date(review.reviewedAt).toLocaleDateString(localeTag(lang))}</small></header>
          {review.title&&<h3>{review.title}</h3>}{review.body&&<p className="mobile-review-body">{review.body}</p>}
          {review.storeReply&&<blockquote className="mobile-review-reply"><small>{t('Mağazadaki yanıtınız','Your reply in the store')}{review.storeReplyAt?` · ${new Date(review.storeReplyAt).toLocaleDateString(localeTag(lang))}`:''}</small><p>{review.storeReply}</p></blockquote>}
          {data.canWrite&&editable&&<div className="mobile-review-editor">
            <label><span className="mobile-field-head"><span>{reply?`${t('Yanıt taslağı','Reply draft')} · ${stateText(reply.state)}${reply.source==='ai'?' · AI':''}`:review.storeReply?t('Yanıtı güncelle','Update the reply'):t('Yanıt yaz','Write a reply')}</span><small className={[...draft].length>limit(review)?'mobile-over':undefined}>{[...draft].length} / {limit(review)}</small></span>
              <textarea rows={3} value={draft} onChange={event=>setDrafts({...drafts,[review.id]:event.target.value})}/></label>
            <div className="mobile-actions">
              <button className="studio-secondary" disabled={busy} onClick={()=>void run(async()=>{const value=await post<{reply:string}>({action:'aiReviewReply',appId:app.id,reviewId:review.id});setDrafts({...drafts,[review.id]:value.reply});},t('AI taslağı forma yazıldı; kaydetmeden gönderilmez.','The AI draft is in the form; nothing is saved or sent.'))}><Sparkles size={15}/>{t('AI ile taslak','Draft with AI')}</button>
              <button className="studio-primary" disabled={busy||!draft.trim()||!changed||[...draft].length>limit(review)} onClick={()=>act({action:'saveReviewReply',reviewId:review.id,text:draft,...(reply?{expectedRevision:reply.revision}:{})},t('Yanıt taslağı kaydedildi.','Reply draft saved.'),()=>setDrafts(({[review.id]:_,...rest})=>rest))}><Save size={15}/>{t('Taslağı kaydet','Save draft')}</button>
              {reply&&reply.state==='draft'&&data.canApprove&&!changed&&<button className="studio-secondary" disabled={busy} onClick={()=>act({action:'approveReviewReply',reviewId:review.id,expectedRevision:reply.revision},t('Yanıt onaylandı.','Reply approved.'))}><Check size={15}/>{t('Onayla','Approve')}</button>}
              {reply&&!['sending','sent'].includes(reply.state)&&<button className="studio-text-button" disabled={busy} onClick={()=>act({action:'deleteReviewReply',reviewId:review.id},undefined,()=>setDrafts(({[review.id]:_,...rest})=>rest))}><Trash2 size={15}/>{t('Taslağı sil','Delete draft')}</button>}
            </div>
            {reply?.approved&&!changed&&data.canManage&&<div className="mobile-actions"><label className="mobile-check"><input type="checkbox" checked={Boolean(ack[review.id])} onChange={event=>setAck({...ack,[review.id]:event.target.checked})}/>{t('Bu yanıtın mağazada herkese açık yayınlanmasını onaylıyorum.','I approve publishing this reply publicly in the store.')}</label>
              <button className="studio-primary" disabled={busy||!view.repliesEnabled||!ack[review.id]} onClick={()=>act({action:'sendReviewReply',reviewId:review.id,acknowledged:true},t('Yanıt mağazaya gönderildi; görünmesi biraz sürebilir.','Reply sent to the store; it can take a while to appear.'))}><Send size={15}/>{t('Mağazada yayınla','Publish in the store')}</button></div>}
            {reply?.lastError&&<p className="studio-error" role="alert">{translateMessage(reply.lastError,lang)}</p>}
          </div>}
        </article>;})}
      {!view.repliesEnabled&&<p className="studio-data-notice">{t('Yorumlara yanıt gönderme bu sunucuda kapalı (PLATFORM_MOBILE_REVIEW_REPLY_ENABLED). Taslaklar yazılıp onaylanabilir.','Sending review replies is off on this server (PLATFORM_MOBILE_REVIEW_REPLY_ENABLED). Drafts can still be written and approved.')}</p>}
      <p className="studio-data-notice">{t('Yanıtlar herkese açıktır ve her yorumun tek yanıtı olur; yeni yanıt eskisinin yerine geçer. Yanıtta kişisel bilgi, bağlantı veya vaat kullanmayın.','Replies are public and each review has one reply; a new reply replaces the old one. Do not use personal details, links or promises in a reply.')}</p>
    </section>}
  </>;
}
