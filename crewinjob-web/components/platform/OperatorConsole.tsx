'use client';
import { useCallback, useEffect, useState } from 'react';
import { Activity, CheckCircle2, CircleSlash, RefreshCw, TriangleAlert, XCircle } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import type { FunnelSnapshot, FunnelStep, ProbeResult, ReadinessGroup, ReadinessSnapshot, ReadinessState } from '@/lib/platform/operator-types';
import { localeTag } from '@/lib/i18n/shared';
import Msg from '@/components/Msg';
import ServerSetupGuide from './ServerSetupGuide';

const GROUPS: Record<ReadinessGroup, [string, string]> = { core: ['Temel ve güvenlik', 'Core and security'], email: ['E-posta', 'Email'], social: ['Sosyal medya', 'Social media'], messaging: ['Mesajlaşma', 'Messaging'], ads: ['Reklam', 'Ads'], ai: ['AI', 'AI'], billing: ['Ödeme', 'Billing'] };
const STATES: Record<ReadinessState, [string, string]> = { ready: ['Hazır', 'Ready'], warning: ['Dikkat', 'Attention'], missing: ['Eksik', 'Missing'], off: ['Kapalı', 'Off'] };
const ICONS = { ready: CheckCircle2, warning: TriangleAlert, missing: XCircle, off: CircleSlash } as const;
const STEPS: Record<FunnelStep, [string, string]> = { created: ['Hesap açıldı', 'Account created'], diagnosis: ['Teşhis başladı', 'Diagnosis started'], brief: ['Strateji onaylandı', 'Strategy approved'], path: ['Rota seçildi', 'Path chosen'], connection: ['İlk kanal bağlandı', 'First channel connected'], rehearsal: ['İlk prova', 'First rehearsal'], live: ['İlk canlı gönderim', 'First live send'] };
const PROVIDERS: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', twitter: 'X', telegram: 'Telegram', whatsapp: 'WhatsApp', ses: 'SES', ga4: 'GA4', search_console: 'Search Console', google_ads: 'Google Ads', meta_ads: 'Meta Ads', linkedin_ads: 'LinkedIn Ads' };

// Operator console for the team running Ryzevo: server readiness before go-live and the customer setup funnel.
// Only presence and counts are shown; setting values, customer names and addresses never reach this page.
export default function OperatorConsole({ lang }: { lang: Locale }) {
  const tr = lang === 'tr', idx = tr ? 0 : 1;
  const [readiness, setReadiness] = useState<ReadinessSnapshot | null>(null), [funnel, setFunnel] = useState<FunnelSnapshot | null>(null);
  const [days, setDays] = useState(90), [error, setError] = useState(''), [loading, setLoading] = useState(true), [probe, setProbe] = useState<ProbeResult | null>(null), [probing, setProbing] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [ready, flow] = await Promise.all([fetch('/api/platform/operator', { cache: 'no-store' }), fetch(`/api/platform/operator?view=funnel&days=${days}`, { cache: 'no-store' })]);
      if (!ready.ok || !flow.ok) throw new Error();
      setReadiness(await ready.json()); setFunnel(await flow.json());
    } catch { setError(tr ? 'Operasyon bilgisi alınamadı. Yenileyerek tekrar deneyin.' : 'Could not load the operations view. Refresh to try again.'); }
    finally { setLoading(false); }
  }, [days, tr]);
  useEffect(() => { void load(); }, [load]);
  const runProbe = async () => {
    setProbing(true);
    try { const response = await fetch('/api/platform/operator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'probe', id: 'gemini' }) }); setProbe(response.ok ? await response.json() : null); }
    finally { setProbing(false); }
  };
  const when = (value: string) => new Date(value).toLocaleString(localeTag(lang), { dateStyle: 'medium', timeStyle: 'short' });
  const counts = readiness ? (['missing', 'warning', 'off', 'ready'] as ReadinessState[]).map(state => [state, readiness.items.filter(item => item.state === state).length] as const) : [];
  const total = funnel?.steps[0]?.reached || 0;
  return <section className="operator-console" aria-busy={loading} aria-labelledby="operator-title">
    <header className="studio-section-title"><h2 id="operator-title">{tr ? 'Operasyon' : 'Operations'}</h2>
      <button type="button" className="icon-button" onClick={() => void load()} disabled={loading} aria-label={tr ? 'Yenile' : 'Refresh'} title={tr ? 'Yenile' : 'Refresh'}><RefreshCw size={16} /></button></header>
    <p className="studio-note">{tr ? 'Yalnız Ryzevo’yu işleten yönetici görür. Ayarların değeri değil, yalnız tanımlı olup olmadığı gösterilir; huni yalnız sayılardan oluşur, müşteri adı veya adresi içermez.' : 'Only the administrator running Ryzevo sees this. Settings are shown as present or missing, never their values; the funnel is counts only, with no customer names or addresses.'}</p>
    {error && <p role="alert" className="studio-error"><Msg text={error} /></p>}

    <ServerSetupGuide lang={lang} />

    {readiness && <div className="studio-band operator-readiness">
      <div className="plan-section-heading"><h3>{tr ? 'Canlıya geçiş durumu' : 'Go-live readiness'}</h3><p className="coach-muted">{when(readiness.generatedAt)}</p></div>
      <p className="operator-summary">{counts.map(([state, n]) => <span key={state} className={`operator-state ${state}`}>{STATES[state][idx]}: {n}</span>)}</p>
      {(Object.keys(GROUPS) as ReadinessGroup[]).map(group => { const list = readiness.items.filter(item => item.group === group); return list.length ? <div key={group} className="operator-group"><h4>{GROUPS[group][idx]}</h4><ul>
        {list.map(item => { const Icon = ICONS[item.state]; return <li key={item.id} className={`operator-item ${item.state}`}>
          <Icon size={18} aria-hidden="true" /><div><p><strong>{item.label[lang]}</strong> <span className={`operator-state ${item.state}`}>{STATES[item.state][idx]}</span></p>
            <p className="coach-muted">{item.detail[lang]}</p>
            {item.env.length > 0 && <p className="operator-env">{item.env.map(name => <code key={name}>{name}</code>)}</p>}
            {item.probe === 'gemini' && <p><button type="button" className="studio-text-button" disabled={probing} onClick={() => void runProbe()}><Activity size={14} />{probing ? (tr ? 'Deneniyor…' : 'Checking…') : (tr ? 'Dene' : 'Check')}</button>
              {probe && <span role="status" className={`operator-state ${probe.ok ? 'ready' : 'missing'}`}>{probe.ok ? (tr ? 'Anahtar ve model çalışıyor' : 'Key and model work') : (tr ? `Yanıt alınamadı${probe.status ? ` (HTTP ${probe.status})` : ''}` : `No valid answer${probe.status ? ` (HTTP ${probe.status})` : ''}`)}</span>}</p>}
          </div></li>; })}
      </ul></div> : null; })}
      <div className="operator-group"><h4>{tr ? 'Müşteri bağlantıları' : 'Customer connections'}</h4>
        {readiness.connections.length ? <div className="studio-table-scroll" tabIndex={0} aria-label={tr ? 'Müşteri bağlantıları' : 'Customer connections'}><table className="studio-table"><thead><tr><th scope="col">{tr ? 'Sağlayıcı' : 'Provider'}</th><th scope="col">{tr ? 'Etkin bağlantı' : 'Active'}</th><th scope="col">{tr ? 'Proje' : 'Projects'}</th><th scope="col">{tr ? 'Son 7 günde yayın kontrolünden geçen' : 'Passed a publish check in 7 days'}</th></tr></thead>
          <tbody>{readiness.connections.map(row => <tr key={row.provider}><th scope="row">{PROVIDERS[row.provider] || row.provider}</th><td>{row.active}</td><td>{row.projects}</td><td>{row.checkedRecently}</td></tr>)}</tbody></table></div>
          : <p className="coach-muted">{tr ? 'Henüz müşteri bağlantısı yok.' : 'No customer connections yet.'}</p>}
        <p className="coach-muted">{tr ? 'Yayın kontrolü yalnız sosyal hesaplar için var ve müşteri yayın öncesi kendisi çalıştırır.' : 'Publish checks exist only for social accounts and are run by the customer before publishing.'}</p></div>
      <div className="operator-group"><h4>{tr ? 'Sağlayıcılara verilecek adresler' : 'Addresses to give providers'}</h4><ul className="operator-webhooks">{readiness.webhooks.map(hook => <li key={hook.path}><code>{hook.path}</code> <span className="coach-muted">· {hook.label[lang]}</span></li>)}</ul></div>
    </div>}

    {funnel && <div className="studio-band operator-funnel">
      <div className="plan-section-heading"><h3>{tr ? 'Müşteri kurulum hunisi' : 'Customer setup funnel'}</h3>
        <label className="operator-period">{tr ? 'Dönem' : 'Period'}<select value={days} onChange={event => setDays(Number(event.target.value))}>{[30, 90, 365].map(value => <option key={value} value={value}>{tr ? `Son ${value} gün` : `Last ${value} days`}</option>)}</select></label></div>
      <p className="coach-muted">{tr ? `Bu dönemde açılan standart projeler. “Takılı” = adıma ulaşıp ${funnel.stalledAfterDays} günden uzun süredir bir sonrakine geçmeyen.` : `Standard projects opened in this period. “Stalled” = reached the step but not the next one for more than ${funnel.stalledAfterDays} days.`}</p>
      {total === 0 ? <p className="coach-muted">{tr ? 'Bu dönemde açılan proje yok.' : 'No projects were opened in this period.'}</p>
        : <ol className="operator-steps">{funnel.steps.map(step => { const share = Math.round(step.reached / total * 100); return <li key={step.id}>
          <div className="operator-step-head"><strong>{STEPS[step.id][idx]}</strong><span>{step.reached} <span className="coach-muted">· %{share}</span></span></div>
          <div className="operator-bar" role="img" aria-label={tr ? `${STEPS[step.id][0]}: ${step.reached} / ${total}` : `${STEPS[step.id][1]}: ${step.reached} of ${total}`}><span style={{ width: `${share}%` }} /></div>
          {step.stalled > 0 && <p className="operator-stalled">{tr ? `${step.stalled} proje burada takılı` : `${step.stalled} stalled here`}</p>}
        </li>; })}</ol>}
      <p className="operator-summary"><span className="operator-state ready">{tr ? `Süren deneme: ${funnel.trials.active}` : `Active trials: ${funnel.trials.active}`}</span><span className="operator-state off">{tr ? `Biten deneme: ${funnel.trials.ended}` : `Ended trials: ${funnel.trials.ended}`}</span><span className="operator-state warning">{tr ? `Pilot: ${funnel.trials.pilot}` : `Pilot: ${funnel.trials.pilot}`}</span></p>
    </div>}
  </section>;
}
