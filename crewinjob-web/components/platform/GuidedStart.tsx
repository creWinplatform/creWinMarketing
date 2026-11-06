'use client';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, Clock3, Compass, HelpCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import { useCompassState } from './GrowthCompass';

// One answer to "what do I do now?": the growth diagnosis, then approving the strategy, then the Compass path's next
// verified step. Progress comes from project records (the Compass), never from a click here.
export function useGuidedStage() {
  const compass = useCompassState(), data = compass?.data;
  if (!compass || !data) return { compass, data, stage: null as null };
  const stage = !data.coach.hasBrief ? (data.coach.hasDraft ? 'approve' : data.coach.canDiagnose ? 'diagnose' : 'waiting') : !data.preferences ? 'path' : data.nextStepId ? 'step' : 'done';
  return { compass, data, stage: stage as 'diagnose' | 'approve' | 'waiting' | 'path' | 'step' | 'done' };
}
// With a website the coach dialog opens on the questions and reads the site at once ("Start from your website").
const openCoach = (website?: string) => window.dispatchEvent(new CustomEvent('ryzevo:coach-open', { detail: website ? { website } : undefined }));

export function NextStepCard({ lang, website = '' }: { lang: Locale; website?: string }) {
  const tr = lang === 'tr', { compass, data, stage } = useGuidedStage(), [site, setSite] = useState(website);
  if (!compass) return null;
  if (!data) return compass.error ? <section className="guided-start"><p role="status">{tr ? 'Rehber şu an yüklenemedi; araçları menüden kullanabilirsiniz.' : 'The guide could not load; you can use the tools from the menu.'}</p></section>
    : <section className="guided-start guided-start-loading" aria-busy="true"><div className="guided-start-copy" aria-hidden="true"><span className="ws-line short" /><span className="ws-line wide" /><span className="ws-line" /><span className="ws-button" /></div><p role="status" className="sr-only">{tr ? 'Sıradaki adımınız hazırlanıyor…' : 'Preparing your next step…'}</p></section>;
  const next = data.steps.find(item => item.id === data.nextStepId), waiting = data.steps.filter(item => item.id !== data.nextStepId && (data.waitingStepIds || []).includes(item.id));
  // Diagnosis and approval come before the Compass path; they are counted in the same progress line.
  const done = (data.coach.hasDraft || data.coach.hasBrief ? 1 : 0) + (data.coach.hasBrief ? 1 : 0) + (data.preferences ? data.completed : 0);
  const total = 2 + (data.preferences ? data.total : 0);
  const body = {
    diagnose: { eyebrow: tr ? 'Adım 1 · yaklaşık 3 dakika' : 'Step 1 · about 3 minutes', title: tr ? 'Sitenizle başlayalım' : 'Let’s start from your website', text: tr ? 'Site adresinizi yazın; Ryzevo sitenizi okuyup soruların çoğunu doldurur. Kalan birkaç soruyu yanıtlayın, ideal müşteri, öncelikli kanallar ve 30 günlük plan içeren strateji taslağınız hazırlansın. Siz inceleyip onaylarsınız.' : 'Type your website; Ryzevo reads it and fills in most of the questions. Answer the few that are left and get a strategy draft with your ideal customer, priority channels and a 30-day plan. You review and approve it.' },
    approve: { eyebrow: tr ? 'Adım 2' : 'Step 2', title: tr ? 'Strateji taslağınız hazır' : 'Your strategy draft is ready', text: tr ? 'Taslağı okuyun, istediğiniz satırı düzeltin ve onaylayın. Onaydan sonra rotanız ve ilk haftanın işleri burada görünür.' : 'Read the draft, edit any line and approve it. After approval your path and the first week’s work appear here.' },
    waiting: { eyebrow: tr ? 'Kurulum' : 'Setup', title: tr ? 'Strateji henüz hazırlanmadı' : 'No strategy yet', text: tr ? 'Teşhisi içerik yetkisi olan bir ekip üyesi başlatır. Strateji onaylanınca rotanız burada görünecek; o zamana kadar aşağıdaki araçları inceleyebilirsiniz.' : 'A teammate with content permission starts the diagnosis. Once the strategy is approved your path appears here; meanwhile you can look around the tools below.' },
    path: { eyebrow: tr ? 'Adım 3' : 'Step 3', title: tr ? 'Rotanızı oluşturun' : 'Build your path', text: tr ? 'Strateji onaylandı. Pusula, seçtiğiniz hedefe göre hesap bağlama, ilk içerik, prova ve ölçüm adımlarını sıralar.' : 'The strategy is approved. The Compass orders the steps for your goal: connecting accounts, first content, rehearsal and measurement.' },
    step: { eyebrow: tr ? 'Sıradaki adımınız' : 'Your next step', title: next?.label[lang] || '', text: next?.reason?.[lang] || next?.detail[lang] || '' },
    done: { eyebrow: tr ? 'Kurulum tamamlandı' : 'Setup complete', title: tr ? 'Rotanızın bütün adımları doğrulandı' : 'Every step of your path is verified', text: tr ? 'Bundan sonra burada dikkat isteyen konular, onayınızı bekleyen işler ve bu haftanın planı öne çıkar.' : 'From now on, items that need attention, decisions waiting for you and this week’s plan come first here.' },
  }[stage!];
  const readSite = (event: FormEvent) => { event.preventDefault(); openCoach(site.trim()); };
  const primary = stage === 'diagnose' ? <form className="guided-start-site" onSubmit={readSite}>
      <label className="sr-only" htmlFor="guided-start-site">{tr ? 'Site adresi' : 'Website'}</label>
      <input id="guided-start-site" type="text" inputMode="url" autoComplete="url" maxLength={300} placeholder="ornek.com" value={site} onChange={event => setSite(event.target.value)} />
      <button className="studio-primary" disabled={!site.trim()}>{tr ? 'Sitemi oku ve başla' : 'Read my site and start'}<ArrowRight size={16} /></button>
      <button type="button" className="studio-text-button" onClick={() => openCoach()}>{tr ? 'Sitem yok, soruları yanıtlayacağım' : 'No site, I’ll answer the questions'}</button>
    </form>
    : stage === 'approve' ? <button type="button" className="studio-primary" onClick={() => openCoach()}>{tr ? 'Taslağı incele' : 'Review the draft'}<ArrowRight size={16} /></button>
    : stage === 'path' ? <button type="button" className="studio-primary" onClick={compass.open}>{tr ? 'Rotamı oluştur' : 'Build my path'}<ArrowRight size={16} /></button>
    : stage === 'step' && next ? (next.id === 'goal' || next.id === 'channels' ? <button type="button" className="studio-primary" onClick={compass.open}>{tr ? 'Seçimi yap' : 'Make the choice'}<ArrowRight size={16} /></button>
      : next.canAct ? <a className="studio-primary" href={next.href}>{tr ? 'Bu adıma git' : 'Go to this step'}<ArrowRight size={16} /></a>
      : <span className="guided-start-blocked"><LockKeyhole size={14} />{tr ? 'Bu adımı yetkili bir ekip üyesi yapmalı.' : 'An authorized teammate must do this step.'}</span>)
    : null;
  return <section className={`guided-start guided-start-${stage}`} aria-labelledby="guided-start-title">
    <div className="guided-start-copy">
      <p className="guided-start-eyebrow">{stage === 'done' ? <Check size={14} /> : <Compass size={14} />}{body.eyebrow}</p>
      <h2 id="guided-start-title">{body.title}</h2>
      <p>{body.text}</p>
      <div className="guided-start-actions">
        {primary}
        {stage === 'step' && next?.provider && <button type="button" className="studio-text-button" onClick={() => compass.guide(next.provider!)}><HelpCircle size={14} />{tr ? 'Hesap / izin rehberi' : 'Account / access guide'}</button>}
        {(stage === 'step' || stage === 'done') && <a className="studio-text-button guided-start-other" href="#task-launcher">{tr ? 'Başka bir iş yapacağım' : 'I want to do something else'}<ArrowRight size={14} /></a>}
        {(stage === 'step' || stage === 'done') && <button type="button" className="studio-text-button" onClick={compass.open}>{stage === 'done' ? (tr ? 'Rotayı veya hedefi değiştir' : 'Change path or goal') : (tr ? 'Bütün rotayı gör' : 'See the whole path')}<ArrowRight size={14} /></button>}
      </div>
      {stage === 'step' && waiting.length > 0 && <p className="guided-start-waiting"><Clock3 size={13} aria-hidden="true" />{tr ? 'Başkası bekleniyor: ' : 'Waiting for someone else: '}{waiting.map(item => item.label[lang]).join(', ')}{tr ? ' (Ryzevo yöneticisi veya yetkili bir ekip üyesi). Bu sırada yukarıdaki adımla devam edebilirsiniz.' : ' (the Ryzevo operator or an authorized teammate). Meanwhile you can go on with the step above.'}</p>}
    </div>
    <div className="guided-start-progress">
      <strong>{done}<small> / {total}</small></strong>
      <span>{tr ? 'kurulum adımı' : 'setup steps'}</span>
      <progress max={total} value={done} aria-label={tr ? 'Doğrulanmış kurulum adımları' : 'Verified setup steps'} />
      <small className="guided-start-safety"><ShieldCheck size={13} />{tr ? 'Hiçbir şey kendiliğinden yayınlanmaz veya gönderilmez.' : 'Nothing is published or sent automatically.'}</small>
    </div>
  </section>;
}
