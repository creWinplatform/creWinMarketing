'use client';
import { ArrowRight, Check, Compass, HelpCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
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
const openCoach = () => window.dispatchEvent(new Event('ryzevo:coach-open'));

export function NextStepCard({ lang }: { lang: Locale }) {
  const tr = lang === 'tr', { compass, data, stage } = useGuidedStage();
  if (!compass) return null;
  if (!data) return <section className="guided-start" aria-busy={compass.loading}><p role="status">{compass.error ? (tr ? 'Rehber şu an yüklenemedi; araçları menüden kullanabilirsiniz.' : 'The guide could not load; you can use the tools from the menu.') : (tr ? 'Sıradaki adımınız hazırlanıyor…' : 'Preparing your next step…')}</p></section>;
  const next = data.steps.find(item => item.id === data.nextStepId);
  // Diagnosis and approval come before the Compass path; they are counted in the same progress line.
  const done = (data.coach.hasDraft || data.coach.hasBrief ? 1 : 0) + (data.coach.hasBrief ? 1 : 0) + (data.preferences ? data.completed : 0);
  const total = 2 + (data.preferences ? data.total : 0);
  const body = {
    diagnose: { eyebrow: tr ? 'Adım 1 · yaklaşık 5 dakika' : 'Step 1 · about 5 minutes', title: tr ? 'Önce ürününüzü tanıyalım' : 'First, tell us about your product', text: tr ? 'Ana hedefinizi seçip 11 kısa soruyu yanıtlayın. Ryzevo yanıtlarınızdan ideal müşteri, öncelikli kanallar ve 30 günlük bir plan içeren strateji taslağı hazırlar; siz inceleyip onaylarsınız.' : 'Pick your main goal and answer 11 short questions. Ryzevo drafts a strategy with your ideal customer, priority channels and a 30-day plan; you review and approve it.' },
    approve: { eyebrow: tr ? 'Adım 2' : 'Step 2', title: tr ? 'Strateji taslağınız hazır' : 'Your strategy draft is ready', text: tr ? 'Taslağı okuyun, istediğiniz satırı düzeltin ve onaylayın. Onaydan sonra rotanız ve ilk haftanın işleri burada görünür.' : 'Read the draft, edit any line and approve it. After approval your path and the first week’s work appear here.' },
    waiting: { eyebrow: tr ? 'Kurulum' : 'Setup', title: tr ? 'Strateji henüz hazırlanmadı' : 'No strategy yet', text: tr ? 'Teşhisi içerik yetkisi olan bir ekip üyesi başlatır. Strateji onaylanınca rotanız burada görünecek; o zamana kadar aşağıdaki araçları inceleyebilirsiniz.' : 'A teammate with content permission starts the diagnosis. Once the strategy is approved your path appears here; meanwhile you can look around the tools below.' },
    path: { eyebrow: tr ? 'Adım 3' : 'Step 3', title: tr ? 'Rotanızı oluşturun' : 'Build your path', text: tr ? 'Strateji onaylandı. Pusula, seçtiğiniz hedefe göre hesap bağlama, ilk içerik, prova ve ölçüm adımlarını sıralar.' : 'The strategy is approved. The Compass orders the steps for your goal: connecting accounts, first content, rehearsal and measurement.' },
    step: { eyebrow: tr ? 'Sıradaki adımınız' : 'Your next step', title: next?.label[lang] || '', text: next?.reason?.[lang] || next?.detail[lang] || '' },
    done: { eyebrow: tr ? 'Kurulum tamamlandı' : 'Setup complete', title: tr ? 'Rotanızın bütün adımları doğrulandı' : 'Every step of your path is verified', text: tr ? 'Bundan sonra burada dikkat isteyen konular, onayınızı bekleyen işler ve bu haftanın planı öne çıkar.' : 'From now on, items that need attention, decisions waiting for you and this week’s plan come first here.' },
  }[stage!];
  const primary = stage === 'diagnose' ? <button type="button" className="studio-primary" onClick={openCoach}>{tr ? 'Teşhise başla' : 'Start the diagnosis'}<ArrowRight size={16} /></button>
    : stage === 'approve' ? <button type="button" className="studio-primary" onClick={openCoach}>{tr ? 'Taslağı incele' : 'Review the draft'}<ArrowRight size={16} /></button>
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
    </div>
    <div className="guided-start-progress">
      <strong>{done}<small> / {total}</small></strong>
      <span>{tr ? 'kurulum adımı' : 'setup steps'}</span>
      <progress max={total} value={done} aria-label={tr ? 'Doğrulanmış kurulum adımları' : 'Verified setup steps'} />
      <small className="guided-start-safety"><ShieldCheck size={13} />{tr ? 'Hiçbir şey kendiliğinden yayınlanmaz veya gönderilmez.' : 'Nothing is published or sent automatically.'}</small>
    </div>
  </section>;
}
