'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CalendarClock, Check, Minus, Play, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import type { AiVisibilityCheck, AiVisibilityView } from '@/lib/platform/ai-visibility-types';
import Msg from '@/components/Msg';

// AI search visibility: the team's own questions asked to a search-grounded assistant. Each answer is a sample that
// can change from one run to the next; it shows whether the brand is named and the site cited, not a ranking.
export default function AiVisibilityPanel({ workspace, lang }: { workspace: WorkspaceContext; lang: Locale }) {
  const tr = lang === 'tr', locale = localeTag(lang);
  const [data, setData] = useState<AiVisibilityView | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(''), [draft, setDraft] = useState('');
  const load = useCallback(() => projectRequest<AiVisibilityView>('/api/platform/ai-visibility').then(setData).catch(reason => setError(reason.message)), []);
  useEffect(() => { void load(); }, [load]);
  const post = async (key: string, body: object) => {
    if (busy) return; setBusy(key); setError('');
    try { setData(await projectRequest<AiVisibilityView>('/api/platform/ai-visibility', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(44000) })); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : tr ? 'İstek tamamlanamadı.' : 'Request failed.'); void load(); return false; }
    finally { setBusy(''); }
  };
  const askAll = async () => { for (const question of data?.questions || []) { if (!(await post(`ask:${question.id}`, { action: 'ask', id: question.id }))) break; } };
  const add = async (event: FormEvent) => { event.preventDefault(); if (await post('add', { action: 'add', question: draft })) setDraft(''); };
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: workspace.project.timezone });
  const mark = (value: boolean | null, yes: string, no: string) => value === null ? <span className="ai-vis-mark unknown"><Minus size={13} />{tr ? 'Bilinmiyor' : 'Unknown'}</span> : value ? <span className="ai-vis-mark yes"><Check size={13} />{yes}</span> : <span className="ai-vis-mark no"><X size={13} />{no}</span>;
  if (!data) return error ? <p className="studio-error" role="alert"><Msg text={error} /></p> : <div className="studio-skeleton" role="status">{tr ? 'AI görünürlüğü yükleniyor…' : 'Loading AI visibility…'}</div>;
  const latest = (check: AiVisibilityCheck | null) => !check ? <p className="coach-muted">{tr ? 'Henüz sorulmadı.' : 'Not asked yet.'}</p>
    : check.status === 'failed' ? <p className="coach-muted">{tr ? `Son deneme (${date(check.askedAt)}) cevap alınamadı; bu “anılmadı” sayılmaz.` : `The last try (${date(check.askedAt)}) got no answer; this does not count as “not mentioned”.`}</p>
    : <div className="ai-vis-result">
      <div className="ai-vis-marks">{mark(check.brandMentioned, tr ? 'Marka anıldı' : 'Brand named', tr ? 'Marka anılmadı' : 'Brand not named')}{mark(check.siteCited, tr ? 'Siteniz kaynak' : 'Your site cited', tr ? 'Siteniz kaynak değil' : 'Your site not cited')}<small>{date(check.askedAt)}{check.via === 'schedule' ? (tr ? ' · haftalık' : ' · weekly') : ''}</small></div>
      {check.competitors.length > 0 && <p className="ai-vis-line"><strong>{tr ? 'Anılan rakipler: ' : 'Competitors named: '}</strong>{check.competitors.join(', ')}</p>}
      {check.sources.length > 0 && <p className="ai-vis-line"><strong>{tr ? 'Kaynak gösterilen siteler: ' : 'Sites cited: '}</strong>{check.sources.map(item => item.domain).filter((item, index, all) => all.indexOf(item) === index).join(', ')}</p>}
      {check.excerpt && <details><summary>{tr ? 'Cevabın başı' : 'Start of the answer'}</summary><p className="ai-vis-excerpt">{check.excerpt}</p></details>}
    </div>;
  return <section className="seo-ops ai-vis">
    <header className="studio-page-heading"><div><p className="studio-eyebrow">GEO</p><h1>{tr ? 'AI aramalarında görünürlük' : 'AI search visibility'}</h1>
      <p className="studio-subtitle">{tr ? 'Müşterilerinizin bir AI asistanına soracağı soruları yazın. Ryzevo bunları Google araması açık bir asistana sorar ve cevapta markanızın anılıp anılmadığını, sitenizin kaynak gösterilip gösterilmediğini kaydeder.' : 'Write the questions your customers would ask an AI assistant. Ryzevo asks them to an assistant with Google Search on and records whether the answer names your brand and cites your site.'}</p></div>
      {data.canWrite && data.questions.length > 0 && <div className="overview-header-actions"><button type="button" className="studio-primary" disabled={Boolean(busy) || !data.aiConfigured} onClick={() => void askAll()}><Play size={15} />{busy.startsWith('ask') ? (tr ? 'Soruluyor…' : 'Asking…') : (tr ? 'Hepsini şimdi sor' : 'Ask all now')}</button></div>}
    </header>
    {error && <p className="studio-error" role="alert"><Msg text={error} /></p>}
    {!data.aiConfigured && <div className="studio-empty"><p>{tr ? 'Bu sunucuda Google aramalı bir AI modeli (Gemini 2 veya üstü) yapılandırılmadı. Soruları şimdiden yazabilirsiniz; model açılınca sorulabilir.' : 'No search-grounded AI model (Gemini 2 or later) is configured on this server. You can write the questions now; they can be asked once a model is on.'}</p></div>}
    {data.summary.asked > 0 && <div className="studio-data-notice mt-4" role="status"><span className="status-dot" />{tr ? `Son cevaplarda: ${data.summary.asked} sorunun ${data.summary.mentioned} tanesinde marka anıldı, ${data.summary.cited} tanesinde siteniz kaynak gösterildi.` : `In the latest answers: the brand was named in ${data.summary.mentioned} of ${data.summary.asked} questions and your site cited in ${data.summary.cited}.`}</div>}
    <p className="coach-muted">{tr ? `Marka: “${data.brand}”${data.domain ? ` · site: ${data.domain}` : ''}${data.competitors.length ? ` · izlenen rakipler: ${data.competitors.join(', ')}` : ' · rakip listesi boş (Proje ayarları → Marka & rakipler)'}.` : `Brand: “${data.brand}”${data.domain ? ` · site: ${data.domain}` : ''}${data.competitors.length ? ` · tracked competitors: ${data.competitors.join(', ')}` : ' · no competitor list (Project settings → Brand & competitors)'}.`}</p>
    {data.questions.length === 0 ? <div className="studio-empty"><p>{tr ? 'Henüz soru yok. İyi bir soru, müşterinin markanızı bilmeden soracağı sorudur: “Kadıköy’de sessiz çalışılabilecek kafeler hangileri?” gibi.' : 'No questions yet. A good question is one a customer asks without knowing your brand, such as “Which quiet cafés in Kadıköy are good for working?”.'}</p></div>
      : <ul className="seo-ops-list">{data.questions.map(item => <li key={item.id} className="studio-draft-row">
        <div className="studio-draft-top"><div><h2>{item.question}</h2>
          {item.history.length > 1 && <p className="ai-vis-history" aria-label={tr ? 'Son cevaplar' : 'Recent answers'}>{item.history.slice().reverse().map((check, index) => <span key={index} title={date(check.askedAt)} className={check.status === 'failed' ? 'failed' : check.brandMentioned ? 'yes' : 'no'} />)}</p>}</div>
          {data.canWrite && <div className="coach-action-buttons">
            <button type="button" className="studio-secondary" disabled={Boolean(busy) || !data.aiConfigured} onClick={() => void post(`ask:${item.id}`, { action: 'ask', id: item.id })}><Play size={14} />{busy === `ask:${item.id}` ? (tr ? 'Soruluyor…' : 'Asking…') : (tr ? 'Şimdi sor' : 'Ask now')}</button>
            <button type="button" className="icon-button" disabled={Boolean(busy)} title={tr ? 'Soruyu kaldır' : 'Remove question'} aria-label={tr ? `Soruyu kaldır: ${item.question}` : `Remove question: ${item.question}`} onClick={() => void post(`remove:${item.id}`, { action: 'remove', id: item.id })}><Trash2 size={15} /></button>
          </div>}</div>
        {latest(item.latest)}
      </li>)}</ul>}
    {data.canWrite && data.questions.length < 10 && <form className="ai-vis-add" onSubmit={event => void add(event)}>
      <label htmlFor="ai-vis-question">{tr ? 'Yeni soru' : 'New question'}</label>
      <div><input id="ai-vis-question" value={draft} maxLength={300} onChange={event => setDraft(event.target.value)} placeholder={tr ? 'Müşteriniz AI asistanına ne sorar?' : 'What would your customer ask an AI assistant?'} />
        <button className="studio-secondary" disabled={Boolean(busy) || draft.trim().length < 8}><Plus size={15} />{tr ? 'Ekle' : 'Add'}</button></div>
    </form>}
    {data.canWrite && data.questions.length > 0 && <div className="seo-schedule" role="group" aria-label={tr ? 'Haftalık kontrol' : 'Weekly check'}>
      <CalendarClock size={16} aria-hidden="true" />
      <div><strong>{tr ? 'Haftalık kontrol' : 'Weekly check'}</strong>
        <small>{data.weekly.on ? (tr ? `Sıradaki: ${date(data.weekly.nextAt!)} · her soru bir AI hakkı kullanır.` : `Next: ${date(data.weekly.nextAt!)} · each question uses one AI credit.`) : (tr ? `Sorular haftada bir kendiliğinden sorulur; her soru bir AI hakkı kullanır (${data.questions.length} soru = haftada ${data.questions.length} hak).` : `Questions are asked once a week on their own; each uses one AI credit (${data.questions.length} questions = ${data.questions.length} credits a week).`)}</small>
        {data.weekly.lastError && <small className="seo-schedule-error"><Msg text={data.weekly.lastError} /></small>}</div>
      <button type="button" className="studio-secondary" disabled={Boolean(busy)} aria-pressed={data.weekly.on} onClick={() => void post('weekly', { action: 'weekly', on: !data.weekly.on })}>{data.weekly.on ? (tr ? 'Kapat' : 'Turn off') : (tr ? 'Aç' : 'Turn on')}</button>
    </div>}
    <p className="compass-safety"><ShieldCheck size={15} />{tr ? 'AI cevapları her soruşta değişebilir; bu bir örneklemdir, sıralama değildir. Ryzevo cevapları değiştirmez ve kimseye bir şey göndermez.' : 'AI answers can change each time; this is a sample, not a ranking. Ryzevo does not change the answers and sends nothing to anyone.'}</p>
  </section>;
}
