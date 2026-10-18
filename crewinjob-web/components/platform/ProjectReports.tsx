'use client';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Plus,
  Download,
  Save,
  ChartNoAxesCombined,
  Trash2,
} from 'lucide-react';
import type { Locale, WorkspaceContext } from '@/lib/platform/catalog';
import type { OperationsSummary } from './ProjectOverview';
import { projectRequest } from '@/lib/platform/client';
import AutomaticMeasurements from './AutomaticMeasurements';
export default function ProjectReports({
  workspace,
  lang,
}: {
  workspace: WorkspaceContext;
  lang: Locale;
}) {
  const tr = lang === 'tr',
    [data, setData] = useState<OperationsSummary | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false),
    [mode, setMode] = useState<'automatic' | 'manual'>('automatic'),
    [goalId, setGoalId] = useState(workspace.project.goals[0]?.id || ''),
    [stage, setStage] = useState(0),
    [value, setValue] = useState(''),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [note, setNote] = useState(''),
    canWrite = workspace.permissions?.includes('content.write');
  const load = () =>
    projectRequest<OperationsSummary>('/api/platform/operations')
      .then(setData)
      .catch((reason) => setError(reason.message));
  useEffect(() => {
    void load();
  }, []);
  const goal = workspace.project.goals.find((item) => item.id === goalId);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const element = event.currentTarget as HTMLFormElement,
      dateValue =
        element.querySelector<HTMLInputElement>('input[type="date"]')?.value ||
        date,
      numberValue =
        element.querySelector<HTMLInputElement>('input[type="number"]')
          ?.value || value;
    setBusy(true);
    setError('');
    try {
      if (!dateValue || numberValue === '')
        throw new Error(
          tr
            ? 'Ölçüm değeri ve tarih gerekli.'
            : 'Measurement value and date are required.',
        );
      await projectRequest('/api/platform/operations?resource=metrics', {
        method: 'POST',
        body: JSON.stringify({
          goalId,
          stageIndex: stage,
          value: Number(numberValue),
          observedAt: new Date(dateValue + 'T12:00:00Z').toISOString(),
          note,
        }),
      });
      setShow(false);
      setValue('');
      setNote('');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <header className="studio-page-heading">
        <div>
          <p className="studio-eyebrow">{tr ? 'ÖLÇÜM' : 'MEASUREMENT'}</p>
          <h1>{tr ? 'Büyüme raporu' : 'Growth report'}</h1>
          <p className="studio-subtitle">
            {tr
              ? 'Proje hedeflerine bağlı, tarihli ölçüm kayıtları.'
              : 'Dated measurements linked to project goals.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mode === 'manual' && <a
            className="studio-secondary"
            href="/api/platform/operations?resource=export"
          >
            <Download size={16} />
            {tr ? 'CSV dışa aktar' : 'Export CSV'}
          </a>}
          {mode === 'manual' && canWrite && (
            <button
              className="studio-primary"
              disabled={!goal}
              onClick={() => setShow(!show)}
            >
              <Plus size={16} />
              {tr ? 'Ölçüm ekle' : 'Add measurement'}
            </button>
          )}
        </div>
      </header>
      <div className="product-data-modes" role="tablist" aria-label={tr ? 'Ölçüm kaynağı' : 'Measurement source'} onKeyDown={event => { if (['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); const next = mode === 'automatic' ? 'manual' : 'automatic'; setMode(next); (event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next === 'automatic' ? 0 : 1]).focus(); } }}>
        <button role="tab" aria-selected={mode === 'automatic'} onClick={() => setMode('automatic')}>{tr ? 'Otomatik ölçümler' : 'Automatic measurements'}</button>
        <button role="tab" aria-selected={mode === 'manual'} onClick={() => setMode('manual')}>{tr ? 'Manuel kayıtlar' : 'Manual entries'}</button>
      </div>
      {mode === 'automatic' && <AutomaticMeasurements workspace={workspace} lang={lang}/>}
      {mode === 'manual' && <>
      {error && (
        <p className="studio-error" role="alert">
          {error}
        </p>
      )}
      <div className="studio-data-notice">
        <span className="status-dot status-dot-amber" />
        <span>
          {tr
            ? 'Manuel girilen kayıtlar; otomatik kaynak sonuçlarından ayrı tutulur.'
            : 'Manually entered records; kept separate from automatic source results.'}
        </span>
      </div>
      {show && goal && (
        <form onSubmit={save} className="studio-editor">
          <h2>{tr ? 'Yeni ölçüm' : 'New measurement'}</h2>
          <div className="studio-form-grid">
            <label>
              {tr ? 'Hedef' : 'Goal'}
              <select
                value={goalId}
                onChange={(event) => {
                  setGoalId(event.target.value);
                  setStage(0);
                }}
              >
                {workspace.project.goals.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label[lang]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr ? 'Aşama' : 'Stage'}
              <select
                value={stage}
                onChange={(event) => setStage(Number(event.target.value))}
              >
                {goal.stages.map((item, index) => (
                  <option key={index} value={index}>
                    {item[lang]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tr ? 'Gözlenen değer' : 'Observed value'}
              <input
                type="number"
                required
                min={0}
                max={1e12}
                step="any"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            <label>
              {tr ? 'Ölçüm tarihi' : 'Measurement date'}
              <input
                type="date"
                required
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="studio-form-full">
              {tr ? 'Kaynak / dönem notu' : 'Source / period note'}
              <textarea
                rows={2}
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={
                  tr
                    ? 'Örn. Eylül CRM raporu, toplam şirket kayıtları'
                    : 'e.g. September CRM report, total company registrations'
                }
              />
            </label>
          </div>
          <div className="studio-form-actions">
            <button
              className="studio-secondary"
              type="button"
              onClick={() => setShow(false)}
            >
              {tr ? 'Vazgeç' : 'Cancel'}
            </button>
            <button className="studio-primary" disabled={busy}>
              <Save size={16} />
              {busy
                ? tr
                  ? 'Kaydediliyor…'
                  : 'Saving…'
                : tr
                  ? 'Kaydet'
                  : 'Save'}
            </button>
          </div>
        </form>
      )}
      {workspace.project.goals.map((item) => (
        <section className="studio-band mt-6" key={item.id}>
          <div className="studio-section-title">
            <h2>{item.label[lang]}</h2>
            <span className="studio-badge">
              {tr ? 'Son ölçüm' : 'Latest observation'}
            </span>
          </div>
          <div className="studio-metric-stages">
            {item.stages.map((label, index) => {
              const metric = data?.metrics.find(
                (entry) =>
                  entry.goalId === item.id && entry.stageIndex === index,
              );
              return (
                <div key={index}>
                  <span>{label[lang]}</span>
                  <strong>
                    {metric
                      ? metric.value.toLocaleString(tr ? 'tr-TR' : 'en-GB')
                      : '—'}
                  </strong>
                  <small>
                    {metric
                      ? `${new Date(metric.observedAt).toLocaleDateString(tr ? 'tr-TR' : 'en-GB')} · ${tr ? 'Manuel' : 'Manual'}`
                      : tr
                        ? 'Veri yok'
                        : 'No data'}
                  </small>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <section className="studio-band mt-6">
        <div className="studio-section-title">
          <h2>{tr ? 'Ölçüm geçmişi' : 'Measurement history'}</h2>
        </div>
        {!data ? (
          <p role="status">{tr ? 'Yükleniyor…' : 'Loading…'}</p>
        ) : data.metrics.length === 0 ? (
          <div className="studio-empty">
            <ChartNoAxesCombined size={28} />
            <p>
              {tr ? 'Henüz ölçüm kaydı yok.' : 'No measurements recorded yet.'}
            </p>
            {!goal && (
              <a href="/?tab=project" className="studio-text-button">
                {tr ? 'Proje hedefi ekle' : 'Add a project goal'}
              </a>
            )}
          </div>
        ) : (
          <div className="studio-table-scroll" tabIndex={0} role="region" aria-label={tr ? 'Ölçüm kayıtları tablosu' : 'Measurement records table'}>
            <table className="studio-table">
              <thead>
                <tr>
                  <th>{tr ? 'Hedef / aşama' : 'Goal / stage'}</th>
                  <th>{tr ? 'Değer' : 'Value'}</th>
                  <th>{tr ? 'Tarih' : 'Date'}</th>
                  <th>{tr ? 'Kaynak' : 'Source'}</th>
                  <th>{tr ? 'Not' : 'Note'}</th>
                  <th>
                    <span className="sr-only">{tr ? 'İşlem' : 'Action'}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.metrics.map((entry) => {
                  const current = workspace.project.goals.find(
                    (item) => item.id === entry.goalId,
                  );
                  return (
                    <tr key={entry.id}>
                      <td>
                        {current?.label[lang] || entry.goalId}
                        <small>
                          {current?.stages[entry.stageIndex]?.[lang] ||
                            entry.stageIndex}
                        </small>
                      </td>
                      <td>{entry.value.toLocaleString()}</td>
                      <td>
                        {new Date(entry.observedAt).toLocaleDateString(
                          tr ? 'tr-TR' : 'en-GB',
                        )}
                      </td>
                      <td>
                        <span className="studio-badge">
                          {tr ? 'Manuel' : 'Manual'}
                        </span>
                      </td>
                      <td>{entry.note || '—'}</td>
                      <td>
                        {canWrite && (
                          <button
                            className="icon-button text-red-500"
                            disabled={busy}
                            title={tr ? 'Ölçümü sil' : 'Delete measurement'}
                            aria-label={
                              tr ? 'Ölçümü sil' : 'Delete measurement'
                            }
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  tr
                                    ? 'Bu ölçüm silinsin mi?'
                                    : 'Delete this measurement?',
                                )
                              )
                                return;
                              setBusy(true);
                              try {
                                await projectRequest(
                                  '/api/platform/operations?resource=metrics',
                                  {
                                    method: 'DELETE',
                                    body: JSON.stringify({ id: entry.id }),
                                  },
                                );
                                await load();
                              } catch (reason) {
                                setError(
                                  reason instanceof Error
                                    ? reason.message
                                    : 'Request failed.',
                                );
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </>}
      {data && (
        <section className="studio-band mt-6">
          <div className="studio-section-title">
            <h2>{tr ? 'Kullanım & plan' : 'Usage & plan'}</h2>
            <span className="studio-badge">{data.plan==='trial'?(tr?'Deneme':'Trial'):'Pilot'}</span>
          </div>
          <div className="studio-usage">
            <div>
              <span>{data.plan==='trial'?(tr?'Deneme AI taslakları':'Trial AI drafts'):(tr ? 'Aylık AI taslakları' : 'Monthly AI drafts')}</span>
              <strong>
                {data.usage.ai} / {data.limits.ai}
              </strong>
              <progress value={data.usage.ai} max={data.limits.ai} />
            </div>
            <div>
              <span>{tr ? 'Kampanya taslakları' : 'Campaign drafts'}</span>
              <strong>
                {data.campaigns} / {data.limits.campaigns}
              </strong>
              <progress value={data.campaigns} max={data.limits.campaigns} />
            </div>
          </div>
          <p className="studio-note">
            {tr
              ? 'Ücretli abonelik ve ödeme entegrasyonu henüz aktif değil.'
              : 'Paid subscriptions and payment integration are not yet active.'}
          </p>
          <a className="studio-text-button mt-4" href="/?tab=project&settings=plan">{tr?'Tüm limitler ve kullanım':'All limits and usage'}</a>
        </section>
      )}
    </section>
  );
}
