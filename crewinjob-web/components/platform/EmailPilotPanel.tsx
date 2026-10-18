'use client';

import {useCallback, useEffect, useId, useRef, useState} from 'react';
import {Check, ClipboardCheck, Clock3, LockKeyhole, Play, Plus, RefreshCw, X} from 'lucide-react';
import type {Locale} from '@/lib/platform/catalog';
import {projectRequest} from '@/lib/platform/client';
import {PILOT_REASON_LABELS, PILOT_STATE_LABELS, type EmailPilotJob, type EmailPilotWorkspace} from '@/lib/platform/email-pilot-types';
import '@/lib/platform/email-pilot.css';

type Props = {
  campaignId: string;
  expectedDigest: string;
  expectedReviewId: number | null;
  ready: boolean;
  lang: Locale;
  canManage: boolean;
};
type Action = 'enqueue' | 'run' | 'cancel';
type Pending = {action: Action | 'load'; id?: string};
type Intent = {key: string; digest: string; reviewId: number | null};
type Failure = {message: string; timeout: boolean};

const endpoint = '/api/platform/email-pilots';
const active = (job: EmailPilotJob) => job.status === 'queued' || job.status === 'running';
const recent = (jobs: EmailPilotJob[]) => [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
const statusLabels: Record<EmailPilotJob['status'], [string, string]> = {
  queued: ['Sırada', 'Queued'], running: ['Kontrol ediliyor', 'Running'], completed: ['Tamamlandı', 'Completed'],
  failed: ['Başarısız', 'Failed'], cancelled: ['İptal edildi', 'Cancelled'],
};
const outcomeLabels: Record<EmailPilotJob['outcome'], [string, string]> = {
  pending: ['Sonuç bekleniyor', 'Outcome pending'], checked: ['Alıcı kontrolleri tamamlandı', 'Recipient checks complete'],
  partial: ['Kontroller kısmen tamamlandı', 'Checks partially complete'], blocked: ['Gönderim kapalı', 'Sending blocked'],
  interrupted: ['Kontroller kesildi', 'Checks interrupted'], cancelled: ['Prova iptal edildi', 'Rehearsal cancelled'],
};

export default function EmailPilotPanel({campaignId, expectedDigest, expectedReviewId, ready, lang, canManage}: Props) {
  const tr = lang === 'tr', labelIndex = tr ? 0 : 1, headingId = useId(), boundaryId = useId();
  const [jobs, setJobs] = useState<EmailPilotJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [loadError, setLoadError] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<Action | null>(null);
  const [recovery, setRecovery] = useState<'required' | 'refreshed' | null>(null);
  const request = useRef<{controller: AbortController; pending: Pending} | null>(null);
  const mounted = useRef(false);
  const intent = useRef<Intent | null>(null);
  const recoveryRequired = useRef(false);

  const load = useCallback(async () => {
    if (!mounted.current || request.current) return;
    const operation = {controller: new AbortController(), pending: {action: 'load'} as Pending};
    request.current = operation;
    setPending(operation.pending);
    const signal = AbortSignal.any([operation.controller.signal, AbortSignal.timeout(35000)]);
    try {
      const workspace = await projectRequest<EmailPilotWorkspace>(`${endpoint}?${new URLSearchParams({campaignId})}`, {signal});
      if (!mounted.current || request.current !== operation || operation.controller.signal.aborted) return;
      setJobs(recent(workspace.jobs));
      setLoaded(true);
      setLoadError(null);
      if (recoveryRequired.current) {
        recoveryRequired.current = false;
        setRecovery('refreshed');
      }
    } catch (reason) {
      if (mounted.current && request.current === operation && !operation.controller.signal.aborted) {
        setLoadError({message: reason instanceof Error ? reason.message : '', timeout: signal.aborted});
      }
    } finally {
      if (request.current === operation) {
        request.current = null;
        if (mounted.current) setPending(null);
      }
    }
  }, [campaignId]);

  useEffect(() => {
    mounted.current = true;
    setJobs([]);
    setLoaded(false);
    setPending(null);
    setError(null);
    setLoadError(null);
    setNotice(null);
    void load();
    return () => {
      mounted.current = false;
      request.current?.controller.abort();
      request.current = null;
    };
  }, [campaignId, canManage, load]);

  useEffect(() => {
    intent.current = null;
    recoveryRequired.current = false;
    setRecovery(null);
    setAck(false);
    setError(null);
    setNotice(null);
  }, [campaignId, expectedDigest]);

  useEffect(() => { setAck(false); }, [ready, expectedReviewId, canManage]);

  useEffect(() => {
    if (pending || !jobs.some(active)) return;
    const timer = window.setTimeout(() => void load(), 2500);
    return () => window.clearTimeout(timer);
  }, [canManage, jobs, pending, load]);

  async function action(kind: Action, job?: EmailPilotJob) {
    if (!mounted.current || request.current || !canManage) return;
    if (kind === 'enqueue' && (!ready || !ack || !loaded || recoveryRequired.current)) return;
    if (kind !== 'enqueue' && (!job?.canManage || !active(job) || (kind === 'run' && job.status !== 'queued'))) return;
    setError(null);
    setNotice(null);

    // An unconfirmed enqueue keeps its original payload and key across refreshes and retries.
    let enqueueIntent: Intent | null = null;
    if (kind === 'enqueue') {
      try {
        intent.current ??= {key: crypto.randomUUID(), digest: expectedDigest, reviewId: expectedReviewId};
        enqueueIntent = intent.current;
      } catch {
        setError({message: tr ? 'Güvenli istek anahtarı oluşturulamadı.' : 'Could not create a secure request key.', timeout: false});
        return;
      }
    }
    const operation = {controller: new AbortController(), pending: {action: kind, id: job?.id}};
    request.current = operation;
    setPending(operation.pending);
    const signal = AbortSignal.any([operation.controller.signal, AbortSignal.timeout(35000)]);
    let refresh = false;
    try {
      const value = await projectRequest<EmailPilotJob>(endpoint, {
        method: 'POST', signal,
        body: JSON.stringify(enqueueIntent ? {
          action: kind, campaignId, expectedDigest: enqueueIntent.digest, expectedReviewId: enqueueIntent.reviewId,
          idempotencyKey: enqueueIntent.key, acknowledged: true,
        } : {action: kind, id: job!.id}),
      });
      if (!mounted.current || request.current !== operation || operation.controller.signal.aborted) return;
      setJobs(current => recent([value, ...current.filter(item => item.id !== value.id)]));
      setNotice(kind);
      if (enqueueIntent && intent.current === enqueueIntent) {
        intent.current = null;
        recoveryRequired.current = false;
        setRecovery(null);
        setAck(false);
      }
    } catch (reason) {
      if (!mounted.current || request.current !== operation || operation.controller.signal.aborted) return;
      setError({message: reason instanceof Error ? reason.message : '', timeout: signal.aborted});
      if (enqueueIntent && intent.current === enqueueIntent) {
        recoveryRequired.current = true;
        setRecovery('required');
      }
      refresh = true;
    } finally {
      if (request.current === operation) {
        request.current = null;
        if (mounted.current) setPending(null);
      }
    }
    if (refresh) await load();
  }

  const busy = pending !== null;
  const date = (value: string) => new Date(value).toLocaleString(tr ? 'tr-TR' : 'en-GB');
  const failureText = (failure: Failure) => failure.timeout
    ? (tr ? 'İstek zaman aşımına uğradı.' : 'The request timed out.')
    : failure.message || (tr ? 'İstek tamamlanamadı.' : 'The request could not be completed.');

  return <section className="email-pilot" aria-labelledby={headingId}>
    <header className="email-pilot-heading">
      <h3 id={headingId}><ClipboardCheck size={18} aria-hidden="true"/>{tr ? 'Pilot provası' : 'Pilot rehearsal'}</h3>
      <button type="button" className="icon-button" disabled={busy}
        title={tr ? 'Prova kuyruğunu yenile' : 'Refresh rehearsal queue'} aria-label={tr ? 'Prova kuyruğunu yenile' : 'Refresh rehearsal queue'}
        onClick={() => void load()}><RefreshCw size={16} aria-hidden="true"/></button>
    </header>
    <p className="email-pilot-boundary" id={boundaryId}><LockKeyhole size={16} aria-hidden="true"/>
      <strong>{tr ? 'Gerçek e-posta gönderilmez' : 'No real email is sent'}</strong>
      <span>{tr ? 'Gönderim kapalı' : 'Sending blocked'}</span>
    </p>
    {!canManage && <p className="email-pilot-note">{tr ? 'Pilot provalarını yalnız proje sahibi veya yöneticisi yönetebilir.' : 'Only project owners or administrators can manage pilot rehearsals.'}</p>}
      <div className="email-pilot-messages" aria-live="polite">
        {error && <p role="alert" className="email-pilot-error">{failureText(error)}</p>}
        {loadError && <p role="alert" className="email-pilot-error">{tr ? 'Kuyruk yenilenemedi: ' : 'Queue refresh failed: '}{failureText(loadError)}</p>}
        {recovery && <p className="email-pilot-note">{recovery === 'required'
          ? (tr ? 'Kuyruğa ekleme sonucu belirsiz. Tekrar denemeden önce kuyruğu yenileyin; aynı istek anahtarı korunur.' : 'The enqueue outcome is unknown. Refresh the queue before retrying; the same request key is retained.')
          : (tr ? 'Kuyruk yenilendi. Tekrar deneme aynı isteği kullanır; ek bir prova oluşturmaz.' : 'Queue refreshed. Retrying uses the same request and does not create an extra rehearsal.')}</p>}
        {notice && <p role="status" className="email-pilot-note">{notice === 'enqueue'
          ? (tr ? 'Prova kuyruğa alındı.' : 'Rehearsal queued.')
          : notice === 'cancel' ? (tr ? 'Prova durumu güncellendi.' : 'Rehearsal status updated.')
          : (tr ? 'Sınırlı prova işlemi tamamlandı.' : 'Bounded rehearsal processing completed.')}</p>}
      </div>
      {canManage && <form className="email-pilot-enqueue" onSubmit={event => {event.preventDefault(); void action('enqueue');}} aria-describedby={boundaryId}>
        {!ready && <p className="email-pilot-note">{tr ? 'Prova için geçerli içerik onayı, güncel kitle kontrolü ve en az bir planlı pilot alıcısı gerekir.' : 'Rehearsal requires current content approval, a fresh audience check and at least one planned pilot recipient.'}</p>}
        <label className="email-pilot-ack"><input type="checkbox" checked={ack} disabled={busy || !ready || !loaded}
          onChange={event => setAck(event.target.checked)}/><span>{tr ? 'Yalnız alıcı kontrolleri için pilot provasını onaylıyorum. Gerçek e-posta gönderilmez.' : 'I acknowledge a pilot rehearsal for recipient checks only. No real email is sent.'}</span></label>
        <button type="submit" className="studio-secondary" disabled={busy || !loaded || !ready || !ack || recovery === 'required'}>
          <Plus size={16} aria-hidden="true"/>{pending?.action === 'enqueue' ? (tr ? 'Kuyruğa alınıyor…' : 'Queueing…')
            : recovery ? (tr ? 'Aynı isteği tekrar dene' : 'Retry same request') : (tr ? 'Provayı kuyruğa al' : 'Queue rehearsal')}
        </button>
      </form>}
      {!loaded && pending?.action === 'load' && <p role="status" className="email-pilot-note">{tr ? 'Prova kuyruğu yükleniyor…' : 'Loading rehearsal queue…'}</p>}
      {loaded && <div className="email-pilot-jobs" aria-busy={busy}>
        <div className="email-pilot-list-heading"><h4>{tr ? 'Son provalar' : 'Recent rehearsals'}</h4><span>{Math.min(jobs.length, 10)} / 10</span></div>
        {jobs.length === 0 ? <p className="email-pilot-note">{tr ? 'Henüz pilot provası yok.' : 'No pilot rehearsals yet.'}</p>
          : jobs.slice(0, 10).map(job => <article className="email-pilot-job" key={job.id}>
            <header className="email-pilot-job-heading">
              <div><div className="email-pilot-job-status">{active(job) ? <Clock3 size={15} aria-hidden="true"/> : <ClipboardCheck size={15} aria-hidden="true"/>}
                <strong>{statusLabels[job.status][labelIndex]}</strong><span>{outcomeLabels[job.outcome][labelIndex]}</span></div>
                <p className="email-pilot-meta"><code title={job.id}>{job.id.slice(-12)}</code><time dateTime={job.createdAt}>{date(job.createdAt)}</time>
                  <span>{tr ? 'Deneme' : 'Attempt'}: {job.attempts}</span></p>
              </div>
              {canManage && job.canManage && active(job) && <div className="email-pilot-actions">
                {job.status === 'queued' && <button type="button" className="studio-secondary" disabled={busy}
                  title={tr ? 'Sınırlı alıcı kontrollerini şimdi çalıştır' : 'Run bounded recipient checks now'} onClick={() => void action('run', job)}>
                  <Play size={15} aria-hidden="true"/>{pending?.action === 'run' && pending.id === job.id ? (tr ? 'İşleniyor…' : 'Processing…') : (tr ? 'Şimdi işle' : 'Process now')}</button>}
                <button type="button" className="icon-button" disabled={busy} title={tr ? 'Provayı iptal et' : 'Cancel rehearsal'}
                  aria-label={`${tr ? 'Provayı iptal et' : 'Cancel rehearsal'} ${job.id.slice(-12)}`} onClick={() => void action('cancel', job)}><X size={17} aria-hidden="true"/></button>
              </div>}
            </header>
            <dl className="email-pilot-counts">
              {([
                [tr ? 'Toplam' : 'Total', job.total], [tr ? 'Doğrulanan' : 'Validated', job.checked],
                [tr ? 'Atlanan' : 'Skipped', job.skipped], [tr ? 'Belirsiz' : 'Uncertain', job.uncertain],
                [tr ? 'İptal edilen' : 'Cancelled', job.cancelled],
              ] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}
            </dl>
            <p className="email-pilot-meta email-pilot-sender"><span>{tr ? 'Gönderen' : 'Sender'}: {job.sender.maskedSender || (tr ? 'Seçilmedi' : 'Not selected')}</span>
              <span>{tr ? 'Alan adı' : 'Domain'}: {job.sender.domain || (tr ? 'Seçilmedi' : 'Not selected')}</span>
              <span>{tr ? 'Güncellendi' : 'Updated'}: <time dateTime={job.updatedAt}>{date(job.updatedAt)}</time></span></p>
            <div className="email-pilot-table" role="region" tabIndex={0} aria-label={`${tr ? 'Maskeli alıcı kontrolleri' : 'Masked recipient checks'} ${job.id.slice(-12)}`}>
              <table><thead><tr><th scope="col">{tr ? 'Maskeli alıcı' : 'Masked recipient'}</th><th scope="col">{tr ? 'Kontrol durumu' : 'Check status'}</th><th scope="col">{tr ? 'Neden' : 'Reason'}</th></tr></thead>
                <tbody>{job.recipients.length === 0 ? <tr><td colSpan={3}>{tr ? 'Alıcı kaydı yok.' : 'No recipient records.'}</td></tr>
                  : job.recipients.map(recipient => <tr key={recipient.id}><td>{recipient.maskedEmail}</td><td>{PILOT_STATE_LABELS[recipient.state][labelIndex]}</td><td>{recipient.reason ? PILOT_REASON_LABELS[recipient.reason][labelIndex] : (tr ? 'Yok' : 'None')}</td></tr>)}</tbody></table>
            </div>
            <dl className="email-pilot-gates" aria-label={tr ? 'Bağımsız gönderim kapıları' : 'Independent sending gates'}>
              {([
                ['SMTP', job.gates.smtp], [tr ? 'Alan adı sahipliği' : 'Domain ownership', job.gates.domain],
                [tr ? 'Kimlik doğrulaması (SPF/DKIM)' : 'Authentication (SPF/DKIM)', job.gates.authentication],
              ] as const).map(([label, passed]) => <div key={label}><dt>{label}</dt><dd>{passed ? <Check size={14} aria-hidden="true"/> : <LockKeyhole size={14} aria-hidden="true"/>}{passed ? (tr ? 'Uygun' : 'Passed') : (tr ? 'Kapalı' : 'Blocked')}</dd></div>)}
            </dl>
            <p className="email-pilot-blocked"><LockKeyhole size={14} aria-hidden="true"/>{tr ? 'Gönderim kapalı. Prova sonucu gönderim izni vermez.' : 'Sending blocked. Rehearsal results do not authorize sending.'}</p>
          </article>)}
      </div>}
  </section>;
}
