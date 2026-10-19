'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, Save, Pencil, Play, X, Database, Clock3, Download } from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import { projectRequest } from '@/lib/platform/client';
import { localeTag } from '@/lib/i18n/shared';
import { translateMessage } from '@/lib/i18n/messages';
import { MEASUREMENT_METRICS, MEASUREMENT_METRIC_LABELS, MEASUREMENT_STATUS, defaultMeasurementPeriod, type MeasurementWorkspace, type MeasurementBinding, type MeasurementJob } from '@/lib/platform/measurement-types';
import Msg from '@/components/Msg';

export default function AutomaticMeasurements({ workspace, lang }: { workspace: WorkspaceContext; lang: Locale }) {
  const tr = lang === 'tr', locale = localeTag(lang), failed = tr ? 'İstek tamamlanamadı.' : 'Request failed.';
  const [data, setData] = useState<MeasurementWorkspace | null>(null), [period, setPeriod] = useState(defaultMeasurementPeriod()), [draftPeriod, setDraftPeriod] = useState(defaultMeasurementPeriod());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [show, setShow] = useState(false);
  const [goalId, setGoal] = useState(workspace.project.goals[0]?.id || ''), [stage, setStage] = useState(0), [sourceId, setSource] = useState(''), [metric, setMetric] = useState(''), [eventName, setEvent] = useState(''), [enabled, setEnabled] = useState(false);
  const [expectedVersion, setExpectedVersion] = useState(0);
  const mounted = useRef(false), request = useRef<AbortController | null>(null), locked = useRef(false), intents = useRef(new Map<string, string>());
  const canManage = workspace.permissions?.includes('connections.manage'), selectedGoal = workspace.project.goals.find(item => item.id === goalId), source = data?.sources.find(item => item.id === sourceId);
  const prior = data?.bindings.find(item => item.goalId === goalId && item.stageIndex === stage);
  const date = (value: string | null) => value ? new Date(value).toLocaleString(locale, { timeZone: workspace.project.timezone }) : '—';
  async function load() {
    if (!mounted.current || locked.current) return;
    const controller = new AbortController(); request.current = controller; locked.current = true; setBusy(true);
    try {
      const value = await projectRequest<MeasurementWorkspace>(`/api/platform/measurements?from=${period.from}&to=${period.to}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) });
      if (mounted.current && !controller.signal.aborted) { setData(value); setError(''); }
    } catch (reason) { if (mounted.current && !controller.signal.aborted) setError(reason instanceof Error && reason.message ? reason.message : failed); }
    finally { if (mounted.current && request.current === controller) { locked.current = false; setBusy(false); } }
  }
  useEffect(() => { mounted.current = true; setData(null); void load(); return () => { mounted.current = false; request.current?.abort(); request.current = null; locked.current = false; }; }, [period.from, period.to]);
  useEffect(() => {
    if (busy || !data?.bindings.some(item => item.active)) return;
    const timer = setTimeout(() => void load(), 2500); return () => clearTimeout(timer);
  }, [busy, data]);
  const sourceChanged = (id: string) => { const item = data?.sources.find(value => value.id === id); setSource(id); setMetric(item ? MEASUREMENT_METRICS[item.provider][0] : ''); setEvent(item?.provider === 'product_webhook' ? item.eventNames[0] || '' : ''); };
  const edit = (item: MeasurementBinding) => { setGoal(item.goalId); setStage(item.stageIndex); setSource(item.connectionId); setMetric(item.definition.metric); setEvent(item.definition.eventName); setEnabled(item.enabled); setExpectedVersion(item.version); setShow(true); setError(''); };
  const chooseTarget = (goal: string, index: number) => {
    const existing = data?.bindings.find(item => item.goalId === goal && item.stageIndex === index);
    if (existing) { edit(existing); return; }
    setGoal(goal); setStage(index); setSource(''); setMetric(''); setEvent(''); setEnabled(false); setExpectedVersion(0);
  };
  const newMapping = () => {
    if (show) { setShow(false); return; }
    const targets = workspace.project.goals.flatMap(goal => goal.stages.map((_, index) => ({ id: goal.id, index })));
    const target = targets.find(item => !data?.bindings.some(row => row.goalId === item.id && row.stageIndex === item.index)) || targets[0];
    if (target) { chooseTarget(target.id, target.index); setShow(true); setError(''); }
  };
  async function act(body: Record<string, unknown>, sync?: MeasurementBinding) {
    if (!mounted.current || locked.current || !canManage) return;
    const controller = new AbortController(); request.current = controller; locked.current = true; setBusy(true); setError(''); setNotice('');
    const options = { method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) };
    try {
      if (sync) {
        const identity = `${sync.id}:${sync.version}:${period.from}:${period.to}`;
        if (!intents.current.has(identity)) intents.current.set(identity, crypto.randomUUID());
        let job = await projectRequest<MeasurementJob>('/api/platform/measurements', { ...options, body: JSON.stringify({ action: 'enqueue', bindingId: sync.id, expectedVersion: sync.version, ...period, idempotencyKey: intents.current.get(identity) }) });
        if (mounted.current && !controller.signal.aborted) setData(old => old ? { ...old, bindings: old.bindings.map(item => item.id === sync.id ? { ...item, latest: job, active: ['queued','running'].includes(job.status) ? job : null } : item) } : old);
        if (job.status === 'queued') job = await projectRequest<MeasurementJob>('/api/platform/measurements', { ...options, body: JSON.stringify({ action: 'run', id: job.id }) });
        intents.current.delete(identity);
      } else await projectRequest('/api/platform/measurements', { ...options, body: JSON.stringify(body) });
      if (!mounted.current || controller.signal.aborted) return;
      if (body.action === 'save') setShow(false);
      setNotice(tr ? 'Ölçüm kaydı güncellendi.' : 'Measurement record updated.');
      const value = await projectRequest<MeasurementWorkspace>(`/api/platform/measurements?from=${period.from}&to=${period.to}`, { signal: options.signal });
      if (mounted.current && !controller.signal.aborted) setData(value);
    } catch (reason) { if (mounted.current && !controller.signal.aborted) setError(reason instanceof Error && reason.message ? reason.message : failed); }
    finally { if (mounted.current && request.current === controller) { locked.current = false; setBusy(false); } }
  }
  const save = (event: FormEvent) => { event.preventDefault(); void act({ action: 'save', goalId, stageIndex: stage, connectionId: sourceId, metric, eventName, enabled, expectedVersion }); };
  return <section className="automatic-measurements" aria-labelledby="automatic-measurement-heading">
    <div className="studio-section-title"><h2 id="automatic-measurement-heading"><Database size={18}/>{tr ? 'Kaynağa bağlı ölçümler' : 'Source-linked measurements'}</h2><div className="studio-row-actions"><button className="icon-button" title={tr ? 'Ölçümleri yenile' : 'Refresh measurements'} aria-label={tr ? 'Ölçümleri yenile' : 'Refresh measurements'} disabled={busy} onClick={() => void load()}><RefreshCw size={16}/></button>{data && <a className="icon-button" title={tr ? 'Otomatik ölçümleri dışa aktar' : 'Export automatic measurements'} aria-label={tr ? 'Otomatik ölçümleri dışa aktar' : 'Export automatic measurements'} href={`/api/platform/operations?resource=export&mode=automatic&from=${period.from}&to=${period.to}`}><Download size={16}/></a>}{canManage && <button className="studio-secondary" disabled={busy || !data || !workspace.project.goals.length} onClick={newMapping}><Plus size={16}/>{tr ? 'Eşleştirme ekle' : 'Add mapping'}</button>}</div></div>
    <form className="measurement-period" onSubmit={event => { event.preventDefault(); if (!busy) { intents.current.clear(); setPeriod({ ...draftPeriod }); } }}><label>{tr ? 'Başlangıç' : 'From'}<input required type="date" value={draftPeriod.from} onChange={event => setDraftPeriod(old => ({ ...old, from: event.target.value }))}/></label><label>{tr ? 'Bitiş' : 'To'}<input required type="date" value={draftPeriod.to} onChange={event => setDraftPeriod(old => ({ ...old, to: event.target.value }))}/></label><button className="studio-secondary" disabled={busy}>{tr ? 'Dönemi göster' : 'Show period'}</button></form>
    <p className="studio-note">{tr ? 'Dönem toplamlarıdır; kaynaklar ve manuel kayıtlarla birleştirilmez. Saat dilimi her sonuçta belirtilir.' : 'Period totals; not combined across sources or with manual entries. Each result states its timezone.'}</p>
    {error && <p className="studio-error" role="alert">{translateMessage(error, lang)}</p>}{notice && <p className="studio-success" role="status"><Msg text={notice}/></p>}
    {!data && busy && <p role="status">{tr ? 'Ölçümler yükleniyor…' : 'Loading measurements…'}</p>}
    {show && data && <form className="studio-editor" onSubmit={save}><h3>{tr ? 'Hedef ve kaynak eşleştirmesi' : 'Goal and source mapping'}</h3><fieldset className="studio-form-grid" disabled={busy}>
      <label>{tr ? 'Hedef' : 'Goal'}<select value={goalId} required onChange={event => chooseTarget(event.target.value, 0)}>{workspace.project.goals.map(item => <option key={item.id} value={item.id}>{item.label[lang]}</option>)}</select></label>
      <label>{tr ? 'Aşama' : 'Stage'}<select value={stage} onChange={event => chooseTarget(goalId, Number(event.target.value))}>{selectedGoal?.stages.map((item, index) => <option key={index} value={index}>{item[lang]}</option>)}</select></label>
      <label>{tr ? 'Veri kaynağı' : 'Data source'}<select required value={sourceId} onChange={event => sourceChanged(event.target.value)}><option value="">{tr ? 'Kaynak seçin' : 'Choose source'}</option>{data.sources.map(item => <option key={item.id} value={item.id}>{item.name} · {item.provider === 'product_webhook' ? (tr ? 'Ürün olayları' : 'Product events') : item.provider}</option>)}</select></label>
      <label>{tr ? 'Ölçüm' : 'Metric'}<select required value={metric} onChange={event => { setMetric(event.target.value); if (!['eventCount','keyEvents'].includes(event.target.value) && source?.provider !== 'product_webhook') setEvent(''); }}><option value="">{tr ? 'Ölçüm seçin' : 'Choose metric'}</option>{source && MEASUREMENT_METRICS[source.provider].map(item => <option key={item} value={item}>{MEASUREMENT_METRIC_LABELS[item][tr ? 0 : 1]}</option>)}</select></label>
      {source?.provider === 'product_webhook' ? <label>{tr ? 'Ürün olayı' : 'Product event'}<select required value={eventName} onChange={event => setEvent(event.target.value)}>{source.eventNames.map(item => <option key={item} value={item}>{item}</option>)}</select></label> : source?.provider === 'ga4' && ['eventCount','keyEvents'].includes(metric) && <label>{tr ? 'GA4 olay filtresi (isteğe bağlı)' : 'GA4 event filter (optional)'}<input value={eventName} maxLength={64} onChange={event => setEvent(event.target.value)}/></label>}
      <label className="measurement-toggle"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/>{tr ? 'Günlük otomatik eşitle' : 'Sync automatically every day'}</label>
      {prior && <p className="studio-note studio-form-full">{tr ? 'Bu aşamadaki mevcut eşleştirme güncellenecek.' : 'The existing mapping for this stage will be updated.'}</p>}
      {!data.sources.length && <p className="studio-note studio-form-full">{tr ? 'Etkin kaynak yok.' : 'No active source.'} <a href="/?tab=project&settings=connections">{tr ? 'Bağlantılar' : 'Connections'}</a></p>}
      <div className="studio-form-actions studio-form-full"><button className="studio-secondary" type="button" onClick={() => setShow(false)}>{tr ? 'Vazgeç' : 'Cancel'}</button><button className="studio-primary" disabled={!source || !metric}><Save size={16}/>{tr ? 'Eşleştirmeyi kaydet' : 'Save mapping'}</button></div>
    </fieldset></form>}
    {data?.bindings.length === 0 && <div className="studio-empty"><Database size={28}/><h3>{tr ? 'Henüz otomatik ölçüm yok' : 'No automatic measurements yet'}</h3><p>{tr ? 'Hedef aşamalarına bağlı kaynak sonuçları burada görünecek.' : 'Source results linked to your goal stages will appear here.'}</p></div>}
    {data?.bindings.map(item => {
      const goal = workspace.project.goals.find(value => value.id === item.goalId), latest = item.latest, running = item.active, sourceName = latest?.sourceName || item.sourceName;
      const scheduled = !item.enabled ? (tr ? 'Günlük eşitleme kapalı' : 'Daily sync off') : running ? (tr ? 'Eşitleme kuyruğunda' : 'Sync queued') : item.nextSyncAt && Date.parse(item.nextSyncAt) <= Date.now() ? (tr ? 'Zamanlayıcı bekleniyor' : 'Waiting for scheduler') : `${tr ? 'Sonraki otomatik ölçüm' : 'Next automatic sync'}: ${date(item.nextSyncAt)}`;
      return <article className="measurement-row" key={item.id}><header><div><h3>{goal?.label[lang] || item.goalId} · {goal?.stages[item.stageIndex]?.[lang] || item.stageIndex}</h3><p>{sourceName || item.provider} · {MEASUREMENT_METRIC_LABELS[item.definition.metric]?.[tr ? 0 : 1]}{item.definition.eventName ? ` · ${item.definition.eventName}` : ''}</p></div><div className="studio-row-actions">{canManage && <button className="icon-button" title={tr ? 'Eşleştirmeyi düzenle' : 'Edit mapping'} aria-label={`${tr ? 'Eşleştirmeyi düzenle' : 'Edit mapping'} ${goal?.stages[item.stageIndex]?.[lang] || item.stageIndex}`} disabled={busy} onClick={() => edit(item)}><Pencil size={16}/></button>}{canManage && <button className="studio-secondary" disabled={busy || !item.valid || Boolean(running)} onClick={() => void act({}, item)}><RefreshCw size={16}/>{tr ? 'Şimdi eşitle' : 'Sync now'}</button>}</div></header>
        {!item.valid && <p className="studio-error">{tr ? 'Hedef, kaynak veya yetki değişti. Eşleştirmeyi güncelleyin.' : 'Goal, source or authority changed. Update the mapping.'}</p>}
        <div className="measurement-result"><strong>{latest?.value !== null && latest?.value !== undefined ? latest.value.toLocaleString(locale) : '—'}</strong><div><span className="studio-badge">{latest && ['queued','running'].includes(latest.status) ? (tr ? 'Ölçüm bekleniyor' : 'Measurement pending') : MEASUREMENT_STATUS[latest?.resultStatus || 'pending']?.[tr ? 0 : 1]}</span>{latest?.resultStatus === 'ready' && !latest.fresh && <span className="studio-badge">{tr ? 'Güncel değil' : 'Not current'}</span>}<p>{period.from} / {period.to}{latest?.timezone ? ` · ${latest.timezone}` : ''} · {latest ? latest.resource || '—' : item.resource}</p></div></div>
        {latest?.reason && <p className="studio-note">{latest.reason === 'coverage' ? (tr ? 'Dönemin tamamı gözlenmedi. Eksik günler sıfır sayılmadı.' : 'The entire period was not observed. Missing days were not treated as zero.') : latest.reason === 'provider_partial' ? (tr ? 'Sağlayıcı örnekleme veya gizlilik sınırlaması bildirdi.' : 'Provider reported sampling or privacy restrictions.') : latest.reason === 'no_rows' ? (tr ? 'Sağlayıcı bu dönem için satır döndürmedi.' : 'Provider returned no rows for this period.') : (tr ? 'Veri alınamadı veya ayarlar değişti. Bağlantıyı kontrol edin.' : 'Data unavailable or settings changed. Check the connection.')}</p>}
        <footer><span><Clock3 size={14}/>{tr ? 'Son kontrol' : 'Last check'}: {date(latest?.checkedAt || null)}</span><span>{scheduled}</span>{canManage && item.enabled && <button className="studio-text-button" disabled={busy} onClick={() => void act({ action: 'pause', id: item.id, expectedVersion: item.version })}>{tr ? 'Otomatik eşitlemeyi duraklat' : 'Pause automatic sync'}</button>}{canManage && running && <div className="studio-row-actions"><span>{running.from} / {running.to}</span>{running.status === 'queued' && <button className="icon-button" title={tr ? 'Ölçümü işle' : 'Process measurement'} aria-label={tr ? 'Ölçümü işle' : 'Process measurement'} disabled={busy} onClick={() => void act({ action: 'run', id: running.id })}><Play size={16}/></button>}<button className="icon-button" title={tr ? 'Ölçüm işini iptal et' : 'Cancel measurement job'} aria-label={tr ? 'Ölçüm işini iptal et' : 'Cancel measurement job'} disabled={busy} onClick={() => void act({ action: 'cancel', id: running.id })}><X size={16}/></button></div>}</footer>
      </article>;
    })}
    <p className="studio-data-notice">{tr ? 'Gözlenen sonuçlar kampanyanın neden olduğu artışı kanıtlamaz. GA4, Search Console ve ürün verileri farklı kapsamları ölçer.' : 'Observed results do not prove campaign-caused uplift. GA4, Search Console and product data measure different populations.'}</p>
  </section>;
}
