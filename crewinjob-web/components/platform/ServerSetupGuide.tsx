'use client';
import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowRight, CheckCircle2, Clock, Copy, ExternalLink, RefreshCw, TriangleAlert, XCircle } from 'lucide-react';
import type { Locale } from '@/lib/platform/catalog';
import type { ProbeResult } from '@/lib/platform/operator-types';
import type { SetupGuide, SetupId, SetupState } from '@/lib/platform/server-setup-types';
import { localeTag } from '@/lib/i18n/shared';

const STATES: Record<SetupState, [string, string]> = { ready: ['Hazır', 'Ready'], missing: ['Eksik', 'Missing'], invalid: ['Hatalı', 'Needs a fix'], stale: ['Çalışmıyor', 'Not running'] };
const ICONS = { ready: CheckCircle2, missing: XCircle, invalid: TriangleAlert, stale: Clock } as const;
const CSS: Record<SetupState, string> = { ready: 'ready', missing: 'missing', invalid: 'warning', stale: 'warning' };

// Step-by-step setup of the server-side connections (Google, Meta, Gemini, scheduled jobs) for the team running Ryzevo.
// Values to register are derived from this panel's address; secrets are never shown, only where to put them.
// ?setup=google|meta|gemini|worker opens that card (the job guide and connection panels link here).
export default function ServerSetupGuide({ lang }: { lang: Locale }) {
  const tr = lang === 'tr', idx = tr ? 0 : 1;
  const [guide, setGuide] = useState<SetupGuide | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<SetupId | null>(() => { if (typeof window === 'undefined') return null; const value = new URLSearchParams(window.location.search).get('setup'); return ['google', 'meta', 'gemini', 'worker'].includes(value || '') ? value as SetupId : null; });
  const [copied, setCopied] = useState(''), [probe, setProbe] = useState<ProbeResult | null>(null), [probing, setProbing] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const response = await fetch('/api/platform/operator?view=setup', { cache: 'no-store' }); if (!response.ok) throw new Error(); const value = await response.json() as SetupGuide; setGuide(value); setOpen(current => current ?? value.sections.find(item => item.state !== 'ready')?.id ?? null); }
    catch { setError(tr ? 'Kurulum durumu alınamadı. Yeniden kontrol ederek tekrar deneyin.' : 'Could not load the setup status. Check again to retry.'); }
    finally { setLoading(false); }
  }, [tr]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (open && guide) document.getElementById(`setup-${open}`)?.scrollIntoView({ block: 'start' }); }, [guide, open]);
  const copy = (key: string, value: string) => { void navigator.clipboard?.writeText(value).then(() => { setCopied(key); window.setTimeout(() => setCopied(current => current === key ? '' : current), 2500); }).catch(() => setCopied('')); };
  const runProbe = async () => { setProbing(true); try { const response = await fetch('/api/platform/operator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'probe', id: 'gemini' }) }); setProbe(response.ok ? await response.json() : null); } finally { setProbing(false); } };
  const ready = guide?.sections.filter(item => item.state === 'ready').length || 0;
  const CopyButton = ({ id, value, label }: { id: string; value: string; label: string }) => <button type="button" className="studio-text-button setup-copy" onClick={() => copy(id, value)} aria-label={tr ? `${label}: kopyala` : `${label}: copy`}><Copy size={13} aria-hidden="true" />{copied === id ? (tr ? 'Kopyalandı' : 'Copied') : (tr ? 'Kopyala' : 'Copy')}</button>;
  return <section className="studio-band server-setup" aria-busy={loading} aria-labelledby="server-setup-title">
    <div className="plan-section-heading"><h3 id="server-setup-title">{tr ? 'Kurulum rehberi' : 'Setup guide'}</h3>
      <button type="button" className="studio-text-button" disabled={loading} onClick={() => void load()}><RefreshCw size={14} aria-hidden="true" />{tr ? 'Yeniden kontrol et' : 'Check again'}</button></div>
    <p className="coach-muted">{tr ? 'Google, Meta, AI modeli ve zamanlanmış işler sunucu ayarıyla açılır. Her kart neyi açtığını, ne eksik olduğunu ve adım adım ne yapacağınızı gösterir. Ayar değerleri burada görünmez ve buradan yazılmaz; yalnız nereye ne yazacağınız gösterilir.' : 'Google, Meta, the AI model and scheduled jobs are turned on with server settings. Each card shows what it opens, what is missing and what to do step by step. Setting values are never shown or written here; only what to put where.'}</p>
    {error && <p role="alert" className="studio-error">{error}</p>}
    {guide && <>
      <p className="operator-summary"><span className={`operator-state ${ready === guide.sections.length ? 'ready' : 'warning'}`}>{tr ? `${guide.sections.length} kurulumdan ${ready} tanesi hazır` : `${ready} of ${guide.sections.length} set up`}</span><span className="coach-muted">{tr ? `Bu panelin adresi: ${guide.origin}` : `This panel’s address: ${guide.origin}`}</span></p>
      {guide.sections.map(section => { const Icon = ICONS[section.state], expanded = open === section.id; return <article key={section.id} id={`setup-${section.id}`} className={`setup-card ${CSS[section.state]}${expanded ? ' expanded' : ''}`}>
        <button type="button" className="setup-head" aria-expanded={expanded} aria-controls={`setup-body-${section.id}`} onClick={() => setOpen(expanded ? null : section.id)}>
          <Icon size={18} aria-hidden="true" /><strong>{section.title[lang]}</strong><span className={`operator-state ${CSS[section.state]}`}>{STATES[section.state][idx]}</span></button>
        {expanded && <div id={`setup-body-${section.id}`} className="setup-body">
          <p className="setup-unlocks"><strong>{tr ? 'Açtığı özellikler: ' : 'What it opens: '}</strong>{section.unlocks.map(item => item[lang]).join(' · ')}</p>
          {section.problems.length > 0 && <ul className="setup-problems">{section.problems.map(item => <li key={item.en}><TriangleAlert size={13} aria-hidden="true" />{item[lang]}</li>)}</ul>}
          {section.state === 'ready' && section.id !== 'worker' && <p className="setup-done"><CheckCircle2 size={14} aria-hidden="true" />{tr ? 'Ayarlar tanımlı ve geçerli. Aşağıdaki son adımla panelde deneyin.' : 'The settings are present and valid. Try it in the panel with the last step below.'}</p>}
          {section.id === 'worker' && <p className="coach-muted">{section.lastRunAt ? (tr ? `Son başarılı çalışma: ${new Date(section.lastRunAt).toLocaleString(localeTag(lang), { dateStyle: 'medium', timeStyle: 'short' })}` : `Last successful run: ${new Date(section.lastRunAt).toLocaleString(localeTag(lang), { dateStyle: 'medium', timeStyle: 'short' })}`) : (tr ? 'Henüz hiç çalışmadı.' : 'It has not run yet.')}</p>}
          <ol className="setup-steps">{section.steps.map((step, index) => <li key={index}>
            <p>{step.text[lang]}</p>
            {(step.link || step.copy) && <div className="setup-step-tools">
              {step.link && <a className="studio-text-button" href={step.link.href} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" />{step.link.label[lang]}</a>}
              {step.copy && <span className="setup-value"><span className="coach-muted">{step.copy.label[lang]}</span><code>{step.copy.value}</code><CopyButton id={`${section.id}-${index}`} value={step.copy.value} label={step.copy.label[lang]} /></span>}
            </div>}
          </li>)}</ol>
          {section.env && <div className="setup-env"><div className="setup-env-head"><span>{guide.local ? '.env.local' : (tr ? 'Ortam değişkenleri' : 'Environment')}</span><CopyButton id={`${section.id}-env`} value={section.env} label={tr ? 'Ayar satırları' : 'Setting lines'} /></div><pre>{section.env}</pre></div>}
          <div className="setup-verify"><p><strong>{tr ? 'Son adım: ' : 'Last step: '}</strong>{section.verify.text[lang]}</p>
            <div className="setup-step-tools">
              {section.verify.probe === 'gemini' && <button type="button" className="studio-secondary" disabled={probing || section.state === 'missing'} onClick={() => void runProbe()}><Activity size={14} aria-hidden="true" />{probing ? (tr ? 'Deneniyor…' : 'Checking…') : (tr ? 'Dene' : 'Check')}</button>}
              {section.verify.probe === 'gemini' && probe && <span role="status" className={`operator-state ${probe.ok ? 'ready' : 'missing'}`}>{probe.ok ? (tr ? 'Anahtar ve model çalışıyor' : 'Key and model work') : (tr ? `Yanıt alınamadı${probe.status ? ` (HTTP ${probe.status})` : ''}` : `No valid answer${probe.status ? ` (HTTP ${probe.status})` : ''}`)}</span>}
              {section.verify.href && <a className="studio-primary" href={section.verify.href}>{tr ? 'Panelde dene' : 'Try it in the panel'}<ArrowRight size={14} aria-hidden="true" /></a>}
            </div></div>
        </div>}
      </article>; })}
    </>}
  </section>;
}
